import dicomParser from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import {
  decodeDicomText,
  decodeFilenameForDisplay,
  scoreCjk,
  stripIso2022Escapes,
} from '../src/charset';
import { hasDicomPrefix, isDicomdirCandidate } from '../src/magic';
import { buildDicomBuffer } from '../testing/dicom-fixture';

describe('魔数识别与文件名判定 (magic.ts)', () => {
  it('用例 1：无扩展名的 DICOM 文件能仅靠魔数正确识别', () => {
    const validDicom = buildDicomBuffer({
      patientId: 'ANON-001',
    });
    // 无文件名，仅校验字节流
    expect(hasDicomPrefix(validDicom)).toBe(true);
  });

  it('魔数识别：字节不足 132 字节或魔数不匹配时安全返回 false', () => {
    // 短于 132 字节
    const shortBuffer = new Uint8Array(100);
    expect(hasDicomPrefix(shortBuffer)).toBe(false);

    // 132 字节但魔数为 NOPE
    const invalidMagic = buildDicomBuffer({ invalidMagic: true });
    expect(hasDicomPrefix(invalidMagic)).toBe(false);

    // 缺少 128 字节 preamble
    const noPreamble = buildDicomBuffer({ skipPreamble: true });
    expect(hasDicomPrefix(noPreamble)).toBe(false);
  });

  it('DICOMDIR 文件名判定：支持常见大小写与 ISO 9660 光盘版本号尾缀', () => {
    expect(isDicomdirCandidate('DICOMDIR')).toBe(true);
    expect(isDicomdirCandidate('dicomdir')).toBe(true);
    expect(isDicomdirCandidate('/Volumes/CDROM/IMAGES/DICOMDIR')).toBe(true);
    expect(isDicomdirCandidate('D:\\DISC\\DICOMDIR.;1')).toBe(true);
    expect(isDicomdirCandidate('DICOMDIR.')).toBe(true);
    expect(isDicomdirCandidate('CT0001.dcm')).toBe(false);
    expect(isDicomdirCandidate('DIRFILE')).toBe(false);
  });
});

describe('字符集与编码解码 (charset.ts)', () => {
  it('用例 3：GBK 编码文件名在展示层不乱码（线 1：文件名启发式还原）', () => {
    // "胸部CT平扫" GBK 编码: 0xD0 0xD8 0xB2 0xBF 0x43 0x54 0xC6 0xBD 0xC9 0xA8
    const gbkBytes = [0xd0, 0xd8, 0xb2, 0xbf, 0x43, 0x54, 0xc6, 0xbd, 0xc9, 0xa8];
    // 浏览器拿到的 latin-1 字符串乱码
    const latin1Name = String.fromCharCode(...gbkBytes) + '.dcm';

    const restored = decodeFilenameForDisplay(latin1Name);
    expect(restored).toBe('胸部CT平扫.dcm');

    // 常规纯英文文件名不受影响
    expect(decodeFilenameForDisplay('NORMAL_SCAN_001.dcm')).toBe('NORMAL_SCAN_001.dcm');
  });

  it('用例 4：SpecificCharacterSet 缺失时，中文标签值仍能靠 gb18030 兜底正确解码（线 2：标签值解码）', () => {
    // "张三" 的 GBK/GB18030 字节: 0xD5 0xC5 0xC8 0xFD
    const gbkPatientName = new Uint8Array([0xd5, 0xc5, 0xc8, 0xfd]);

    // 未声明 SpecificCharacterSet（即 undefined / 空）
    const decodedWithoutCharset = decodeDicomText(gbkPatientName, undefined);
    expect(decodedWithoutCharset).toBe('张三');

    // 声明为空字符串
    const decodedWithEmptyCharset = decodeDicomText(gbkPatientName, '');
    expect(decodedWithEmptyCharset).toBe('张三');
  });

  it('标签值解码：支持标准 UTF-8 (ISO_IR 192)', () => {
    const utf8Bytes = new TextEncoder().encode('李四');
    const decoded = decodeDicomText(utf8Bytes, 'ISO_IR 192');
    expect(decoded).toBe('李四');
  });

  it('标签值解码：支持 ISO 2022 IR 58 剥离转义序列后解码', () => {
    // 模拟 ISO 2022 IR 58 转义序列 ESC $ ) A 加上 GB2312/GBK "王五" (0xcd 0xf5 0xce 0xe5)
    const rawWithEsc = new Uint8Array([
      0x1b, 0x24, 0x29, 0x41, 0xcd, 0xf5, 0xce, 0xe5,
    ]);
    const stripped = stripIso2022Escapes(rawWithEsc);
    expect(stripped).toEqual(new Uint8Array([0xcd, 0xf5, 0xce, 0xe5]));

    const decoded = decodeDicomText(rawWithEsc, 'ISO 2022 IR 58');
    expect(decoded).toBe('王五');
  });

  it('CJK 计分辅助函数 scoreCjk（包含 Extension B 补充平面汉字 codePointAt 支持）', () => {
    expect(scoreCjk('张三')).toBe(2);
    expect(scoreCjk('ABC 123')).toBe(0);
    expect(scoreCjk('CT 胸部扫描 001')).toBe(4);
    // \u{20000} 是 Extension B 生僻字，占 2 个 UTF-16 code units 但为 1 个 code point
    expect(scoreCjk('𠀀')).toBe(1);
    expect(scoreCjk('测试𠀀生僻字')).toBe(6);
  });
});

describe('Dicom Fixture Builder 与 dicom-parser 集成验证', () => {
  it('合成的标准 DICOM 字节流可被 dicom-parser 正常解析标签', () => {
    const buffer = buildDicomBuffer({
      patientId: 'TEST-PATIENT-888',
      modality: 'MR',
      studyInstanceUid: '1.2.3.4.5',
      seriesInstanceUid: '1.2.3.4.5.6',
      sopInstanceUid: '1.2.3.4.5.6.7',
      rows: 256,
      columns: 256,
    });

    const dataSet = dicomParser.parseDicom(buffer);
    expect(dataSet.string('x00100020')).toBe('TEST-PATIENT-888');
    expect(dataSet.string('x00080060')).toBe('MR');
    expect(dataSet.string('x0020000d')).toBe('1.2.3.4.5');
    expect(dataSet.string('x0020000e')).toBe('1.2.3.4.5.6');
    expect(dataSet.string('x00080018')).toBe('1.2.3.4.5.6.7');
    expect(dataSet.uint16('x00280010')).toBe(256);
    expect(dataSet.uint16('x00280011')).toBe(256);
  });

  it('P1-7 验证：DICOMDIR 记录物理乱序时，通过 offset 链树状遍历正确解析出层级关系', async () => {
    const { parseDicomdir } = await import('../src/dicomdir');
    const { buildDicomdirBuffer } = await import('../testing/dicom-fixture');

    // 1. 先用占位 offset 构建初始 buffer 获取 4 个 item 的绝对起始位置
    // 物理顺序故意错乱：[PATIENT, IMAGE, STUDY, SERIES]
    const baseRecords = [
      {
        recordType: 'PATIENT' as const,
        patientId: 'PID-OFFSET-001',
        lowerLevelOffset: 0,
      },
      {
        recordType: 'IMAGE' as const,
        referencedFileId: 'DICOM\\IMG001',
        referencedSopInstanceUid: '1.2.3.900.1.1',
      },
      {
        recordType: 'STUDY' as const,
        studyInstanceUid: '1.2.3.900',
        studyDescription: 'Offset Tree Test',
        lowerLevelOffset: 0,
      },
      {
        recordType: 'SERIES' as const,
        seriesInstanceUid: '1.2.3.900.1',
        modality: 'MR',
        lowerLevelOffset: 0,
      },
    ];
    const initialBuf = buildDicomdirBuffer(baseRecords, { rootOffset: 0 });
    const parsedInitial = dicomParser.parseDicom(initialBuf);
    const items = parsedInitial.elements.x00041220?.items;
    expect(items).toBeDefined();
    expect(items?.length).toBe(4);

    // 获取每个 item 的 Item Tag 偏移 (dataOffset - 8)
    const offsets = items!.map((it) => (it.dataOffset ?? 0) - 8);
    const [patientOffset, imageOffset, studyOffset, seriesOffset] = offsets;

    // 2. 用真实的树状指针重新构建 DICOMDIR（字段完全相同，字节长度严格一致）：
    // root -> PATIENT
    // PATIENT.lowerLevel -> STUDY
    // STUDY.lowerLevel -> SERIES
    // SERIES.lowerLevel -> IMAGE
    const treeRecords = [
      {
        recordType: 'PATIENT' as const,
        patientId: 'PID-OFFSET-001',
        lowerLevelOffset: studyOffset,
      },
      {
        recordType: 'IMAGE' as const,
        referencedFileId: 'DICOM\\IMG001',
        referencedSopInstanceUid: '1.2.3.900.1.1',
      },
      {
        recordType: 'STUDY' as const,
        studyInstanceUid: '1.2.3.900',
        studyDescription: 'Offset Tree Test',
        lowerLevelOffset: seriesOffset,
      },
      {
        recordType: 'SERIES' as const,
        seriesInstanceUid: '1.2.3.900.1',
        modality: 'MR',
        lowerLevelOffset: imageOffset,
      },
    ];

    const treeDicomdirBuf = buildDicomdirBuffer(treeRecords, {
      rootOffset: patientOffset,
    });

    const result = parseDicomdir(treeDicomdirBuf);

    // 验证：虽然物理排列顺序错乱 (IMAGE 排在 STUDY 与 SERIES 前面)，
    // 但通过 offset 指针链仍能精准恢复出 Study -> Series -> Image 层次
    expect(result.length).toBe(1);
    expect(result[0]?.studyInstanceUid).toBe('1.2.3.900');
    expect(result[0]?.patientId).toBe('PID-OFFSET-001');
    expect(result[0]?.series.length).toBe(1);
    expect(result[0]?.series[0]?.seriesInstanceUid).toBe('1.2.3.900.1');
    expect(result[0]?.series[0]?.images.length).toBe(1);
    expect(result[0]?.series[0]?.images[0]?.referencedFileId).toBe('DICOM\\IMG001');
  });
});
