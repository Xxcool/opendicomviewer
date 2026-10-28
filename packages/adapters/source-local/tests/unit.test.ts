import dicomParser from 'dicom-parser';
import { describe, expect, it } from 'vitest';
import type { ImportCandidate } from '@opendicomviewer/core';
import {
  decodeDicomText,
  decodeFilenameBytes,
  scoreCjk,
  stripIso2022Escapes,
} from '../src/charset';
import { hasDicomPrefix, isDicomdirCandidate } from '../src/magic';
import { buildDicomBuffer } from '../testing/dicom-fixture';
import {
  GBK_CHEST_CT_FILENAME,
  buildZip,
  buildZip64PlaceholderZip,
} from '../testing/zip-fixture';
import { extractZipEntriesFromCandidate } from '../src/zip';
import {
  ParserPool,
  isWorkerRuntimeAvailable,
  type WorkerLike,
} from '../src/worker/parser-pool';
import type {
  WorkerParseRequest,
  WorkerParseResponse,
} from '../src/worker/types';
import type { ParsedDicomMeta } from '../src/parse';

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
  it('用例 3（N5）：ZIP 中央目录里的 GBK 文件名能按字节正确还原', () => {
    // "胸部CT平扫" 的 GBK 字节
    const gbkBytes = new Uint8Array([
      0xd0, 0xd8, 0xb2, 0xbf, 0x43, 0x54, 0xc6, 0xbd, 0xc9, 0xa8,
    ]);

    // 关键场景：打包工具没置 bit 11，但写入的确实是 GBK 字节。
    // 旧实现无条件 new TextDecoder()（宽松 UTF-8）会得到一堆 U+FFFD，信息直接丢失。
    expect(decodeFilenameBytes(gbkBytes, false)).toBe('胸部CT平扫');

    // 打包工具撒谎：声称 UTF-8 实际是 GBK，仍要尽力还原
    expect(decodeFilenameBytes(gbkBytes, true)).toBe('胸部CT平扫');

    // 声明 UTF-8 且确实是 UTF-8
    const utf8Bytes = new TextEncoder().encode('胸部CT平扫');
    expect(decodeFilenameBytes(utf8Bytes, true)).toBe('胸部CT平扫');

    // 纯 ASCII 文件名不能被改写（绝大多数光盘都是这种）
    const asciiBytes = new TextEncoder().encode('CT0001.DCM');
    expect(decodeFilenameBytes(asciiBytes, false)).toBe('CT0001.DCM');

    // 任何输入都不得返回替换字符 U+FFFD
    expect(decodeFilenameBytes(new Uint8Array([0xff, 0xfe, 0x80]), false)).not.toContain(
      '\uFFFD',
    );
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

  it('P1-2（交叉评审）：UID 奇数长度必须填 0x00，文本 VR 仍填 0x20', () => {
    const findBytes = (haystack: Uint8Array, needle: Uint8Array): number => {
      for (let i = 0; i <= haystack.length - needle.length; i++) {
        let hit = true;
        for (let k = 0; k < needle.length; k++) {
          if (haystack[i + k] !== needle[k]) {
            hit = false;
            break;
          }
        }
        if (hit) return i;
      }
      return -1;
    };

    // 9 字符 = 奇数长度 UID
    const oddUid = '1.2.3.4.5';
    const oddName = 'ABC'; // 3 字符 PN，同样奇数
    const bytes = buildDicomBuffer({ sopInstanceUid: oddUid, patientName: oddName });

    const uidNeedle = new TextEncoder().encode(oddUid);
    const uidAt = findBytes(bytes, uidNeedle);
    expect(uidAt).toBeGreaterThan(-1);
    // PS3.5 Table 6.2-1：UI 必须以 NULL 补齐，填空格会让 UID 非法
    expect(bytes[uidAt + uidNeedle.length]).toBe(0x00);

    const nameNeedle = new TextEncoder().encode(oddName);
    const nameAt = findBytes(bytes, nameNeedle);
    expect(nameAt).toBeGreaterThan(-1);
    // 文本 VR 反过来必须是空格，别把它们一起改坏
    expect(bytes[nameAt + nameNeedle.length]).toBe(0x20);
  });

  it('fixture 支持写入像素数据与灰度换算标签（供 golden 与 Spike A 复用）', () => {
    const rows = 4;
    const columns = 4;
    const pixels = new Uint16Array(rows * columns);
    for (let i = 0; i < pixels.length; i++) pixels[i] = 1024 + i; // 1024 对应 HU 0

    const bytes = buildDicomBuffer({
      rows,
      columns,
      pixelData: new Uint8Array(pixels.buffer),
      bitsAllocated: 16,
      bitsStored: 16,
      pixelRepresentation: 0,
      photometricInterpretation: 'MONOCHROME2',
      rescaleIntercept: -1024,
      rescaleSlope: 1,
      windowCenter: 40,
      windowWidth: 400,
    });

    const dataSet = dicomParser.parseDicom(bytes);
    const pixelElement = dataSet.elements.x7fe00010;
    expect(pixelElement).toBeDefined();
    expect(pixelElement?.length).toBe(rows * columns * 2);
    expect(dataSet.uint16('x00280100')).toBe(16);
    expect(dataSet.uint16('x00280102')).toBe(15); // HighBit = BitsStored - 1
    expect(dataSet.uint16('x00280002')).toBe(1); // SamplesPerPixel
    expect(dataSet.string('x00280004')).toBe('MONOCHROME2');
    expect(dataSet.floatString('x00281052')).toBe(-1024);
    expect(dataSet.floatString('x00281053')).toBe(1);
    expect(dataSet.floatString('x00281050')).toBe(40);
    expect(dataSet.floatString('x00281051')).toBe(400);

    // 未传 pixelData 时不得写入像素模块，避免影响既有纯元数据用例
    const noPixel = dicomParser.parseDicom(
      buildDicomBuffer({ rows: 4, columns: 4 }),
    );
    expect(noPixel.elements.x7fe00010).toBeUndefined();
    expect(noPixel.elements.x00280100).toBeUndefined();
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

/**
 * ParserPool 用例（GEMINI §10.1）
 *
 * 前提事实：Node 没有全局 Worker（`typeof Worker === 'undefined'`），
 * 所以**任何跑在 vitest 里的用例都不可能覆盖真实 Worker 分支**。
 * 「解析是否真在独立线程执行」只能由浏览器断言（ARCHITECTURE §12.2 第 3 条）。
 * 调度逻辑本身通过注入 `createWorker` 获得可测性，下面第 2~6 组用例均走 fake worker。
 */
class FakeWorker implements WorkerLike {
  public readonly posted: WorkerParseRequest[] = [];
  public terminateCount = 0;
  private messageHandler: ((response: WorkerParseResponse) => void) | null = null;
  private errorHandler: ((message: string) => void) | null = null;

  public postMessage(message: WorkerParseRequest): void {
    this.posted.push(message);
  }

  public onMessage(handler: (response: WorkerParseResponse) => void): void {
    this.messageHandler = handler;
  }

  public onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
  }

  public terminate(): void {
    this.terminateCount += 1;
  }

  /** 模拟 worker 回包（默认回最后一条已投递任务的 id） */
  public respondWith(meta: ParsedDicomMeta): void {
    const last = this.posted[this.posted.length - 1];
    this.messageHandler?.({
      id: last?.id ?? '',
      success: true,
      result: meta,
    });
  }

  /** 模拟 worker 线程级错误（OOM / 脚本异常） */
  public failWith(message: string): void {
    this.errorHandler?.(message);
  }
}

function makeMeta(overrides: Partial<ParsedDicomMeta> = {}): ParsedDicomMeta {
  return {
    plane: {
      imageId: 'img',
      sopInstanceUid: '1.2.3',
      imagePositionPatient: [0, 0, 0],
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
      pixelSpacing: [1, 1],
      rows: 2,
      columns: 2,
    },
    studyUid: '1.2',
    patientId: 'PID',
    patientName: 'PN',
    studyDescription: '',
    seriesUid: '1.2.3',
    seriesDescription: '',
    modality: 'CT',
    ...overrides,
  };
}

function makeCandidate(id: string, bytes: Uint8Array): ImportCandidate {
  return {
    id,
    name: `${id}.dcm`,
    size: bytes.byteLength,
    read: async (): Promise<ArrayBuffer> => new ArrayBuffer(bytes.byteLength),
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

describe('解析线程池 (parser-pool.ts)', () => {
  it('P1-1 用例 1：无 Worker 运行时走同步回退模式，解析结果正确', async () => {
    // 这条断言同时起到守卫作用：Node 哪天补上全局 Worker，这里会失败并提醒改测试假设
    expect(isWorkerRuntimeAvailable()).toBe(false);

    const pool = new ParserPool({ createWorker: null });
    expect(pool.isWorkerMode()).toBe(false);

    const bytes = buildDicomBuffer({
      patientId: 'POOL-FALLBACK-001',
      studyInstanceUid: '1.2.3.999',
    });
    const parsed = await pool.parse(toArrayBuffer(bytes), makeCandidate('fb', bytes));

    expect(parsed.patientId).toBe('POOL-FALLBACK-001');
    expect(parsed.studyUid).toBe('1.2.3.999');
    pool.terminate();
  });

  it('P1-1 用例 2：Worker 模式正确投递任务，且不 detach 调用方的 ArrayBuffer', async () => {
    const fake = new FakeWorker();
    const pool = new ParserPool({
      maxConcurrency: 1,
      timeoutMs: 0,
      createWorker: () => fake,
    });
    expect(pool.isWorkerMode()).toBe(true);

    const bytes = buildDicomBuffer({ patientId: 'POOL-WORKER-001' });
    const buffer = toArrayBuffer(bytes);
    const pending = pool.parse(buffer, makeCandidate('w1', bytes));

    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]?.candidateInfo.id).toBe('w1');

    fake.respondWith(makeMeta({ patientId: 'POOL-WORKER-001' }));
    await expect(pending).resolves.toMatchObject({ patientId: 'POOL-WORKER-001' });

    // 缺陷 c 回归：若用 transfer list 转移所有权，调用方 buffer 会被 detach（byteLength = 0），
    // 之后 source-local 复用同一个 buffer 就会抛 TypeError。
    expect(buffer.byteLength).toBe(bytes.byteLength);
    pool.terminate();
  });

  it('P1-1 用例 3：复用同一 Worker 时出错必须落到当前请求，而不是创建者', async () => {
    const fake = new FakeWorker();
    const pool = new ParserPool({
      maxConcurrency: 1,
      timeoutMs: 0,
      createWorker: () => fake,
    });

    const bytesA = buildDicomBuffer({ patientId: 'A' });
    const bytesB = buildDicomBuffer({ patientId: 'B' });

    const first = pool.parse(toArrayBuffer(bytesA), makeCandidate('a', bytesA));
    const second = pool.parse(toArrayBuffer(bytesB), makeCandidate('b', bytesB));

    // 并发上限 1：第二个任务必须排队，不能被无脑 postMessage 出去
    expect(fake.posted).toHaveLength(1);

    fake.respondWith(makeMeta({ patientId: 'A' }));
    await expect(first).resolves.toMatchObject({ patientId: 'A' });

    // 队列里的第二个被派发到同一个 worker
    expect(fake.posted).toHaveLength(2);

    // 此时 worker 出错：老实现会把错误投给已 settle 的 first，second 永久挂起
    fake.failWith('线程 OOM');
    await expect(second).rejects.toThrow(/解析线程异常.*线程 OOM/);
    pool.terminate();
  });

  it('P1-1 用例 4：terminate() 必须 reject 所有在途与排队任务，不能永久挂起', async () => {
    const fake = new FakeWorker();
    const pool = new ParserPool({
      maxConcurrency: 1,
      timeoutMs: 0,
      createWorker: () => fake,
    });

    const bytes = buildDicomBuffer({});
    const inFlight = pool.parse(toArrayBuffer(bytes), makeCandidate('t1', bytes));
    const queued = pool.parse(toArrayBuffer(bytes), makeCandidate('t2', bytes));

    pool.terminate();

    await expect(inFlight).rejects.toThrow('解析线程池已终止');
    await expect(queued).rejects.toThrow('解析线程池已终止');
    expect(fake.terminateCount).toBe(1);

    // 终止后再投递必须立即失败，而不是悄悄排队
    await expect(
      pool.parse(toArrayBuffer(bytes), makeCandidate('t3', bytes)),
    ).rejects.toThrow('解析线程池已终止');
  });

  it('P1-1 用例 5：解析超时后明确报错，不让导入无声卡住', async () => {
    const fake = new FakeWorker();
    const pool = new ParserPool({
      maxConcurrency: 1,
      timeoutMs: 10,
      createWorker: () => fake,
    });

    const bytes = buildDicomBuffer({});
    await expect(
      pool.parse(toArrayBuffer(bytes), makeCandidate('slow', bytes)),
    ).rejects.toThrow(/解析超时/);
  });

  /**
   * P1-3（交叉评审 CR-2026-10-28-selfcode）：createWorker 抛错时任务残留队列。
   * 不直接读私有 queue，而是用"下一次解析被谁顶掉"来观测。
   */
  it('Worker 构造抛错后队列必须干净，下一次解析不能被僵尸任务顶掉', async () => {
    const created: FakeWorker[] = [];
    let shouldFail = true;
    const pool = new ParserPool({
      maxConcurrency: 1,
      timeoutMs: 0,
      createWorker: () => {
        if (shouldFail) throw new Error('Worker spawn failed');
        const worker = new FakeWorker();
        created.push(worker);
        return worker;
      },
    });

    const bytes = buildDicomBuffer({});
    await expect(
      pool.parse(toArrayBuffer(bytes), makeCandidate('first', bytes)),
    ).rejects.toThrow(/Worker spawn failed/);

    shouldFail = false;
    const second = pool.parse(toArrayBuffer(bytes), makeCandidate('second', bytes));

    // 修复后：派发给新 worker 的第一条任务必须是 second，而不是残留的 first
    expect(created).toHaveLength(1);
    expect(created[0]?.posted[0]?.candidateInfo.id).toBe('second');

    created[0]?.respondWith(makeMeta());
    await expect(second).resolves.toBeDefined();
    pool.terminate();
  });

  it('P1-1 用例 6：队列超过上限时明确拒绝，避免 1000 帧全量排队拉满内存', async () => {
    const fake = new FakeWorker();
    const pool = new ParserPool({
      maxConcurrency: 1,
      maxQueueSize: 1,
      timeoutMs: 0,
      createWorker: () => fake,
    });

    const bytes = buildDicomBuffer({});
    const first = pool.parse(toArrayBuffer(bytes), makeCandidate('q1', bytes));
    const second = pool.parse(toArrayBuffer(bytes), makeCandidate('q2', bytes));

    await expect(
      pool.parse(toArrayBuffer(bytes), makeCandidate('q3', bytes)),
    ).rejects.toThrow(/解析队列已满/);

    pool.terminate();
    await expect(first).rejects.toThrow('解析线程池已终止');
    await expect(second).rejects.toThrow('解析线程池已终止');
  });
});

describe('ZIP 条目解析 (zip.ts)', () => {
  function makeSliceCandidate(id: string, bytes: Uint8Array): ImportCandidate {
    return {
      id,
      name: `${id}.zip`,
      size: bytes.byteLength,
      read: async (start?: number, end?: number): Promise<ArrayBuffer> => {
        const from = start ?? 0;
        const to = end ?? bytes.byteLength;
        const out = new ArrayBuffer(Math.max(0, to - from));
        new Uint8Array(out).set(bytes.subarray(from, to));
        return out;
      },
    };
  }

  const payload = new Uint8Array([0x44, 0x49, 0x43, 0x4d, 0x01, 0x02]);

  it('N5：中央目录里的 GBK 文件名（未置 bit 11）能正确解码，不再产出 U+FFFD', async () => {
    const zip = buildZip([
      { nameBytes: GBK_CHEST_CT_FILENAME, data: payload, utf8FilenameFlag: false },
    ]);

    const entries = await extractZipEntriesFromCandidate(
      makeSliceCandidate('gbk', zip),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.filename).toBe('胸部CT平扫.dcm');
    expect(entries[0]?.filename).not.toContain('\uFFFD');
    expect(entries[0]?.isDirectory).toBe(false);
    expect(entries[0]?.uncompressedSize).toBe(payload.byteLength);

    // 条目内容也要能按需取回（确认改动没破坏 Range 读取）
    const data = await entries[0]?.read();
    expect(new Uint8Array(data ?? new ArrayBuffer(0))).toEqual(payload);
  });

  it('N5：置了 bit 11 且确实是 UTF-8 的文件名同样正确', async () => {
    const zip = buildZip([
      {
        nameBytes: new TextEncoder().encode('胸片/CT0001.dcm'),
        data: payload,
        utf8FilenameFlag: true,
      },
    ]);

    const entries = await extractZipEntriesFromCandidate(
      makeSliceCandidate('utf8', zip),
    );
    expect(entries[0]?.filename).toBe('胸片/CT0001.dcm');
  });

  it('N4（交叉评审）：条目数占位值 0xFFFF 也要判定为 ZIP64', async () => {
    const zip = buildZip([
      { nameBytes: new TextEncoder().encode('CT0001.dcm'), data: payload },
    ]);
    const eocdStart = zip.length - 22;
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(eocdStart, true)).toBe(0x06054b50);
    // 只改条目数（总条目 / 本盘条目），cdSize 与 cdOffset 保持合法值
    view.setUint16(eocdStart + 8, 0xffff, true);
    view.setUint16(eocdStart + 10, 0xffff, true);

    await expect(
      extractZipEntriesFromCandidate(makeSliceCandidate('many', zip)),
    ).rejects.toThrow(/ZIP64/);
  });

  it('N6：ZIP64 占位值必须显式报错，不允许静默返回空条目', async () => {
    const zip64 = buildZip64PlaceholderZip();
    await expect(
      extractZipEntriesFromCandidate(makeSliceCandidate('zip64', zip64)),
    ).rejects.toThrow(/ZIP64/);
  });
});
