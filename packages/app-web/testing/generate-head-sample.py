"""从公开 ICBM152 T1 模板导出中线矢状面教学 DICOM，不推测缺失几何。"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE_NAME = 'mni_icbm152_t1_tal_nlin_asym_09c.nii'
EXPECTED_SOURCE_SHA256 = '67fe8b2e8fed7fa318d293e79a31416f5b31d70f0330312f58125fcd3dde43a1'
SOURCE_URL = 'https://nist.mni.mcgill.ca/icbm-152-nonlinear-atlases-2009/'
ARCHIVE_URL = 'https://packages.bic.mni.mcgill.ca/mni-models/icbm152/mni_icbm152_nlin_asym_09c_nifti.zip'


def element(group, tag, vr, value):
    if isinstance(value, str):
        value = value.encode('ascii')
    if len(value) % 2:
        value += b'\0' if vr in ('UI', 'OB', 'OW') else b' '
    head = struct.pack('<HH', group, tag) + vr.encode('ascii')
    return head + (b'\0\0' + struct.pack('<I', len(value)) if vr in ('OB', 'OW')
                   else struct.pack('<H', len(value))) + value


def generate(source):
    if source.suffix.lower() == '.zip':
        with zipfile.ZipFile(source) as archive:
            matches = [name for name in archive.namelist() if name.endswith('/' + SOURCE_NAME)]
            if len(matches) != 1:
                raise ValueError('未找到唯一的 ICBM152 T1 文件')
            data = archive.read(matches[0])
    else:
        data = source.read_bytes()
    if struct.unpack_from('<i', data)[0] != 348 or data[344:348] != b'n+1\0':
        raise ValueError('仅支持已经核实的 NIfTI-1 小端模板')
    dim = struct.unpack_from('<8h', data, 40)
    affine = struct.unpack_from('<12f', data, 280)
    if dim[:4] != (3, 193, 229, 193) or struct.unpack_from('<h', data, 70)[0] != 4:
        raise ValueError('源模板尺寸或 int16 存储类型与已核实版本不同')
    if data[123] & 7 != 2 or affine != (1, 0, 0, -96, 0, 1, 0, -132, 0, 0, 1, -78):
        raise ValueError('模板物理单位或 RAS 变换发生变化，请重新核实')
    offset, slope, intercept = struct.unpack_from('<3f', data, 108)
    if not all(math.isfinite(v) for v in (offset, slope, intercept)) or slope <= 0:
        raise ValueError('灰度缩放参数无效')
    nx, ny, nz = dim[1:4]
    if len(data) != int(offset) + nx * ny * nz * 2:
        raise ValueError('模板像素长度不匹配')
    x = 96  # RAS x=0，来源仿射明确给出的中线，不依赖文件名猜方向。
    pixels = bytearray()
    for z in range(nz - 1, -1, -1):
        for y in range(ny - 1, -1, -1):
            position = int(offset) + 2 * (x + nx * (y + ny * z))
            pixels.extend(data[position:position + 2])
    source_sha = hashlib.sha256(data).hexdigest()
    if source_sha != EXPECTED_SOURCE_SHA256:
        raise ValueError('源模板哈希与已核实版本不同，请勿转换其他模态或版本')

    def uid(name):
        return '2.25.' + str(uuid.uuid5(uuid.NAMESPACE_URL, source_sha + ':' + name).int)

    sop_class = '1.2.840.10008.5.1.4.1.1.4'
    sop = uid('sagittal-sop')
    meta = b''.join([
        element(2, 1, 'OB', b'\0\1'), element(2, 2, 'UI', sop_class),
        element(2, 3, 'UI', sop), element(2, 0x10, 'UI', '1.2.840.10008.1.2.1'),
        element(2, 0x12, 'UI', uid('implementation')),
    ])
    fields = [
        (8, 8, 'CS', 'DERIVED\\SECONDARY\\OTHER'), (8, 0x16, 'UI', sop_class),
        (8, 0x18, 'UI', sop), (8, 0x20, 'DA', ''), (8, 0x30, 'TM', ''),
        (8, 0x50, 'SH', ''), (8, 0x60, 'CS', 'MR'), (8, 0x70, 'LO', 'OpenDicomViewer'),
        (8, 0x90, 'PN', ''), (8, 0x1030, 'LO', 'ICBM152 Average Head Teaching Sample'),
        (8, 0x103e, 'LO', 'ICBM152 Head - Mid-sagittal T1 (derived)'),
        (8, 0x2111, 'ST', 'Mid-sagittal plane from McGill ICBM152 2009c average T1 template; not a patient scan.'),
        (0x10, 0x10, 'PN', ''), (0x10, 0x20, 'LO', ''), (0x10, 0x30, 'DA', ''), (0x10, 0x40, 'CS', ''),
        (0x18, 0x20, 'CS', 'RM'), (0x18, 0x21, 'CS', 'NONE'), (0x18, 0x22, 'CS', ''),
        (0x18, 0x23, 'CS', '3D'), (0x18, 0x50, 'DS', '1'),
        (0x18, 0x80, 'DS', ''), (0x18, 0x81, 'DS', ''), (0x18, 0x91, 'IS', ''),
        (0x18, 0x5100, 'CS', ''),
        (0x20, 0x0d, 'UI', uid('study')), (0x20, 0x0e, 'UI', uid('sagittal-series')),
        (0x20, 0x10, 'SH', 'ICBM152'), (0x20, 0x11, 'IS', '1'), (0x20, 0x13, 'IS', '1'),
        (0x20, 0x32, 'DS', '0\\-96\\114'), (0x20, 0x37, 'DS', '0\\1\\0\\0\\0\\-1'),
        (0x20, 0x52, 'UI', uid('frame-of-reference')), (0x20, 0x1040, 'LO', ''),
        (0x28, 2, 'US', struct.pack('<H', 1)), (0x28, 4, 'CS', 'MONOCHROME2'),
        (0x28, 0x10, 'US', struct.pack('<H', nz)), (0x28, 0x11, 'US', struct.pack('<H', ny)),
        (0x28, 0x30, 'DS', '1\\1'), (0x28, 0x100, 'US', struct.pack('<H', 16)),
        (0x28, 0x101, 'US', struct.pack('<H', 16)), (0x28, 0x102, 'US', struct.pack('<H', 15)),
        (0x28, 0x103, 'US', struct.pack('<H', 1)),
        (0x28, 0x1050, 'DS', '50'), (0x28, 0x1051, 'DS', '100'),
        (0x28, 0x1052, 'DS', f'{intercept:.10g}'), (0x28, 0x1053, 'DS', f'{slope:.10g}'),
        (0x7fe0, 0x10, 'OW', bytes(pixels)),
    ]
    result = bytes(128) + b'DICM' + element(2, 0, 'UL', struct.pack('<I', len(meta))) + meta
    result += b''.join(element(*field) for field in sorted(fields, key=lambda f: f[:2]))
    output = ROOT / 'sample-dicom/brain-head-mr'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'head-sagittal.dcm').write_bytes(result)
    (output / 'provenance.json').write_text(json.dumps({
        'name': 'ICBM152 2009c average head, mid-sagittal T1', 'sourceUrl': SOURCE_URL,
        'archiveUrl': ARCHIVE_URL, 'sourceFile': SOURCE_NAME, 'sourceSha256': source_sha,
        'outputSha256': hashlib.sha256(result).hexdigest(), 'derived': True,
        'sourceMidlineX': x, 'columns': ny, 'rows': nz, 'frames': 1,
        'iopLps': [0, 1, 0, 0, 0, -1], 'ippLps': [0, -96, 114],
        'pixelSpacing': [1, 1], 'rescaleSlope': float(f'{slope:.10g}'),
        'rescaleIntercept': float(f'{intercept:.10g}'),
        'description': 'Educational derived average-template image; not an individual patient scan.',
    }, indent=2) + '\n')
    print('Generated', output / 'head-sagittal.dcm', len(result), 'bytes')


if __name__ == '__main__':
    generate(Path(sys.argv[1]))
