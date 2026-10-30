/** 从仓库示例生成欢迎页预览：保留真实灰度和比例，不包含患者身份叠加层。 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sourceRequire = createRequire(path.join(root, 'packages/adapters/source-local/package.json'));
const dicom = (await import(pathToFileURL(sourceRequire.resolve('dicom-parser')).href)).default;
const output = path.join(root, 'packages/app-web/public/sample-previews');
const lut = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'packages/core/pipeline/lut.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, lut);

function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, bytes, checksum]);
}

fs.mkdirSync(output, { recursive: true });
const manifest = [];
for (const [id, file] of [
  ['brain-head-mr', 'sample-dicom/brain-head-mr/head-sagittal.dcm'],
  ['brain-mr', 'sample-dicom/brain-mr/000018.dcm'],
  ['ct-body', 'sample-dicom/ct-body/ct-slice-001.dcm'],
]) {
  const source = fs.readFileSync(path.join(root, file));
  const data = dicom.parseDicom(new Uint8Array(source));
  const pixel = data.elements.x7fe00010;
  const rows = data.uint16('x00280010'); const columns = data.uint16('x00280011');
  const syntax = data.string('x00020010');
  // 只接受这两份已核实的原始 16-bit 小端灰度样本，避免误解压或忽略 LUT。
  if (!['1.2.840.10008.1.2', '1.2.840.10008.1.2.1'].includes(syntax)
    || data.uint16('x00280100') !== 16 || data.uint16('x00280101') !== 16
    || data.uint16('x00280102') !== 15 || data.elements.x00283000
    || !pixel || !rows || !columns || pixel.length !== rows * columns * 2) {
    throw new Error(`预览生成器不支持该像素格式：${file}`);
  }
  const slope = Number(data.string('x00281053') ?? '1');
  const intercept = Number(data.string('x00281052') ?? '0');
  const voi = { windowWidth: Number(data.string('x00281051')?.split('\\')[0]), windowCenter: Number(data.string('x00281050')?.split('\\')[0]) };
  if (![slope, intercept, voi.windowCenter, voi.windowWidth].every(Number.isFinite) || voi.windowWidth < 1) throw new Error(`样本灰度参数无效：${file}`);
  const signed = data.uint16('x00280103') === 1;
  const scanlines = Buffer.alloc((columns + 1) * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const offset = pixel.dataOffset + (y * columns + x) * 2;
    const stored = signed ? source.readInt16LE(offset) : source.readUInt16LE(offset);
    scanlines[y * (columns + 1) + 1 + x] = lut.exports.mapHUToUint8(
      lut.exports.rawToHU(stored, slope, intercept), voi, data.string('x00280004'),
    );
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(columns); header.writeUInt32BE(rows, 4); header[8] = 8;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(output, `${id}.png`), png);
  manifest.push({ id, source: file, sha256: crypto.createHash('sha256').update(source).digest('hex'), width: columns, height: rows, ...voi });
}
fs.writeFileSync(path.join(output, 'provenance.json'), `${JSON.stringify(manifest, null, 2)}\n`);
log(`已生成 ${manifest.length} 份真实示例预览及来源记录。`);
