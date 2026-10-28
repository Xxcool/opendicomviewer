import type { ImportCandidate } from '@opendicomviewer/core';
import { describe, expect, it, vi } from 'vitest';
import { LRUCache, LocalDataSource } from '../src/source-local';
import {
  buildDicomBuffer,
  buildDicomdirBuffer,
} from '../testing/dicom-fixture';
import { GBK_CHEST_CT_FILENAME, buildZip } from '../testing/zip-fixture';

function createMockCandidate(
  name: string,
  buffer: ArrayBuffer | Uint8Array,
  onRead?: () => void,
): ImportCandidate {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return {
    id: `cand-${name}`,
    name,
    size: bytes.byteLength,
    async read(start?: number, end?: number): Promise<ArrayBuffer> {
      onRead?.();
      if (start === undefined && end === undefined) {
        return bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        );
      }
      const s = start ?? 0;
      const e = end ?? bytes.byteLength;
      return bytes.buffer.slice(
        bytes.byteOffset + s,
        bytes.byteOffset + e,
      );
    },
  };
}

describe('LocalDataSource 综合集成与验收用例', () => {
  it('用例 2：存在 DICOMDIR 时走索引路径，不重复全盘扫描', async () => {
    const dicomdirBytes = buildDicomdirBuffer([
      { recordType: 'PATIENT', patientId: 'PID-DIR-001', patientName: '王大爷' },
      { recordType: 'STUDY', studyInstanceUid: '1.2.840.999.1', studyDescription: '头颅CT' },
      { recordType: 'SERIES', seriesInstanceUid: '1.2.840.999.1.1', modality: 'CT' },
      { recordType: 'IMAGE', referencedFileId: 'IMAGES/CT001', referencedSopInstanceUid: '1.2.840.999.1.1.1' },
      { recordType: 'IMAGE', referencedFileId: 'IMAGES/CT002', referencedSopInstanceUid: '1.2.840.999.1.1.2' },
    ]);

    const dicomdirCand = createMockCandidate('DICOMDIR', dicomdirBytes);

    const ct1Cand = createMockCandidate(
      'IMAGES/CT001',
      buildDicomBuffer({
        studyInstanceUid: '1.2.840.999.1',
        seriesInstanceUid: '1.2.840.999.1.1',
        sopInstanceUid: '1.2.840.999.1.1.1',
        imagePositionPatient: [0, 0, 0],
      }),
    );
    const ct2Cand = createMockCandidate(
      'IMAGES/CT002',
      buildDicomBuffer({
        studyInstanceUid: '1.2.840.999.1',
        seriesInstanceUid: '1.2.840.999.1.1',
        sopInstanceUid: '1.2.840.999.1.1.2',
        imagePositionPatient: [0, 0, 5],
      }),
    );

    const otherReadSpy = vi.fn();
    const otherCand = createMockCandidate('OTHER/HUGE_FILE.DAT', new Uint8Array(1024), otherReadSpy);

    const source = new LocalDataSource();
    const studies = await source.probe({
      files: [dicomdirCand, ct1Cand, ct2Cand, otherCand],
    });

    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.840.999.1');
    expect(studies[0]?.patientId).toBe('PID-DIR-001');

    // 关键断言：probe 阶段走 DICOMDIR 索引，完全没有读取 OTHER/HUGE_FILE.DAT
    expect(otherReadSpy).not.toHaveBeenCalled();

    const handle = await source.openSeries({
      studyInstanceUid: '1.2.840.999.1',
      seriesInstanceUid: '1.2.840.999.1.1',
    });
    expect(handle.meta.numberOfFrames).toBe(2);
    expect(handle.meta.planes[0]?.imagePositionPatient[2]).toBe(0);
    expect(handle.meta.planes[1]?.imagePositionPatient[2]).toBe(5);
  });

  it('用例 5：混入 1 个损坏文件时，其余文件正常导入且给出失败汇总', async () => {
    const valid1 = createMockCandidate(
      'slice1.dcm',
      buildDicomBuffer({
        studyInstanceUid: '1.2.3.100',
        seriesInstanceUid: '1.2.3.100.1',
        sopInstanceUid: '1.2.3.100.1.1',
        imagePositionPatient: [0, 0, 0],
      }),
    );

    const valid2 = createMockCandidate(
      'slice2.dcm',
      buildDicomBuffer({
        studyInstanceUid: '1.2.3.100',
        seriesInstanceUid: '1.2.3.100.1',
        sopInstanceUid: '1.2.3.100.1.2',
        imagePositionPatient: [0, 0, 2],
      }),
    );

    const corruptedBytes = new Uint8Array(200);
    for (let i = 0; i < 128; i++) corruptedBytes[i] = 0;
    corruptedBytes[128] = 0x44;
    corruptedBytes[129] = 0x49;
    corruptedBytes[130] = 0x43;
    corruptedBytes[131] = 0x4d;
    for (let i = 132; i < 200; i++) corruptedBytes[i] = 0xff;

    const corruptedCand = createMockCandidate('broken.dcm', corruptedBytes);

    const source = new LocalDataSource();
    const studies = await source.probe({
      files: [valid1, corruptedCand, valid2],
    });

    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.3.100');

    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.100',
      seriesInstanceUid: '1.2.3.100.1',
    });

    expect(handle.meta.numberOfFrames).toBe(2);
    const failureWarning = handle.warnings.find(
      (w) => w.code === 'DECODE_PARTIAL_FAILURE',
    );
    expect(failureWarning).toBeDefined();
    expect(failureWarning?.message).toContain('1 个文件解析失败');

    // 端口级：失败文件必须能逐项读出，UI 才能列"失败 1 个 + 文件名 + 原因"
    const outcome = source.importOutcome();
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.name).toBe('broken.dcm');
    expect(outcome.failures[0]?.reason).toBeTruthy();
    // 成功的文件不能出现在失败清单里
    expect(outcome.failures.some((f) => f.name.startsWith('slice'))).toBe(false);
  });

  it('importOutcome 在 probe 之前返回空，且不与序列级告警混算', async () => {
    const source = new LocalDataSource();
    // 未 probe 时不得抛错，也不得凭空产出
    expect(source.importOutcome()).toEqual({ succeeded: 0, failures: [] });

    await source.probe({
      files: [
        createMockCandidate(
          'a.dcm',
          buildDicomBuffer({
            studyInstanceUid: '1.2.3.200',
            seriesInstanceUid: '1.2.3.200.1',
            sopInstanceUid: '1.2.3.200.1.1',
            imagePositionPatient: [0, 0, 0],
          }),
        ),
        createMockCandidate(
          'b.dcm',
          buildDicomBuffer({
            studyInstanceUid: '1.2.3.200',
            seriesInstanceUid: '1.2.3.200.1',
            sopInstanceUid: '1.2.3.200.1.2',
            // 故意留大层间距，产生 SLICE_GAP 之类的序列级告警
            imagePositionPatient: [0, 0, 40],
          }),
        ),
      ],
    });

    // 序列级告警 ≠ 导入失败：层间距告警不应把成功载入的文件算成失败
    expect(source.importOutcome()).toEqual({ succeeded: 2, failures: [] });

    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.200',
      seriesInstanceUid: '1.2.3.200.1',
    });
    expect(handle.meta.numberOfFrames).toBe(2);
  });

  it('用例 6：AbortSignal 中断后不产生残留任务', async () => {
    const ac = new AbortController();
    const candidates = [
      createMockCandidate('f1.dcm', buildDicomBuffer()),
      createMockCandidate('f2.dcm', buildDicomBuffer()),
    ];
    ac.abort();

    const source = new LocalDataSource();
    await expect(source.probe({ files: candidates }, ac.signal)).rejects.toThrow(
      /中断/,
    );
  });

  it('P0-1 & P0-2 验证：LRU 缓存独立隔离且 prefetch 有效填充缓存', async () => {
    let file1ReadCount = 0;
    const f1 = createMockCandidate(
      'f1.dcm',
      buildDicomBuffer({
        studyInstanceUid: '1.2.3.500',
        seriesInstanceUid: '1.2.3.500.1',
        sopInstanceUid: '1.2.3.500.1.1',
      }),
      () => {
        file1ReadCount++;
      },
    );

    const source = new LocalDataSource();
    await source.probe({ files: [f1] });
    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.500',
      seriesInstanceUid: '1.2.3.500.1',
    });

    // 记录初始读取次数（probe 期间读头）
    const initialReads = file1ReadCount;

    // 执行 prefetch
    await handle.prefetch?.([0]);
    // prefetch 必须真正触发了读取并完成解析
    expect(file1ReadCount).toBeGreaterThan(initialReads);

    // 随后调用 pixel(0)，必须命中 LRU 缓存，不再触发底层 I/O
    const readAfterPrefetch = file1ReadCount;
    await handle.pixel(0);
    expect(file1ReadCount).toBe(readAfterPrefetch);

    // dispose 后缓存清空，再次调用 pixel 会重新读取
    handle.dispose();
    await handle.pixel(0);
    expect(file1ReadCount).toBeGreaterThan(readAfterPrefetch);
  });

  it('P0-1 验证：LRU 缓存容量上限与淘汰机制', () => {
    const lru = new LRUCache<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.size).toBe(3);

    // 访问 a 使其变为最近使用
    expect(lru.get('a')).toBe(1);

    // 插入 d，最旧的 b 应该被淘汰
    lru.set('d', 4);
    expect(lru.size).toBe(3);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.has('d')).toBe(true);
  });

  it('P1-3 验证：遇到封装压缩传输语法明确报错，严禁直接当裸像素解读', async () => {
    const compressedCandidate = createMockCandidate(
      'jpeg.dcm',
      buildDicomBuffer({
        studyInstanceUid: '1.2.3.600',
        seriesInstanceUid: '1.2.3.600.1',
        sopInstanceUid: '1.2.3.600.1.1',
        transferSyntaxUid: '1.2.840.10008.1.2.4.70',
      }),
    );

    const source = new LocalDataSource();
    await source.probe({ files: [compressedCandidate] });
    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.600',
      seriesInstanceUid: '1.2.3.600.1',
    });

    await expect(handle.pixel(0)).rejects.toThrow(/封装压缩传输语法/);
  });

  it('P1-5 验证：切片缺失空间几何 (0020,0032) 时标记 hasMissingGeometry 且产生 MISSING_GEOMETRY 警告', async () => {
    // 构造显式省略 IPP 的切片数据
    const rawNoGeom = buildDicomBuffer({
      studyInstanceUid: '1.2.3.700',
      seriesInstanceUid: '1.2.3.700.1',
      sopInstanceUid: '1.2.3.700.1.1',
      omitImagePositionPatient: true,
    });

    const cand = createMockCandidate('no_geom.dcm', rawNoGeom);
    const source = new LocalDataSource();
    await source.probe({ files: [cand] });
    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.700',
      seriesInstanceUid: '1.2.3.700.1',
    });

    expect(handle.meta.planes[0]?.hasMissingGeometry).toBe(true);
    expect(handle.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_GEOMETRY' }),
      ]),
    );
  });

  /**
   * N5 端到端：ZIP 里用 GBK 文件名（未置 bit 11）打包的 DICOM，
   * 必须能正常导入并归类成序列——不是"文件名能显示对了"就够，
   * 而是候选 id 一路传到 SeriesRef 都不能是 U+FFFD。
   */
  it('N5 端到端：ZIP 内 GBK 文件名的 DICOM 能被正常导入并归类', async () => {
    const inner = buildDicomBuffer({
      studyInstanceUid: '1.2.3.880',
      seriesInstanceUid: '1.2.3.880.1',
      sopInstanceUid: '1.2.3.880.1.1',
      patientId: 'PID-GBK-ZIP',
    });

    const zipBytes = buildZip([
      { nameBytes: GBK_CHEST_CT_FILENAME, data: inner, utf8FilenameFlag: false },
    ]);

    const source = new LocalDataSource();
    const studies = await source.probe({
      files: [createMockCandidate('disc.zip', zipBytes)],
    });

    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.3.880');
    expect(studies[0]?.seriesCount).toBe(1);

    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.880',
      seriesInstanceUid: '1.2.3.880.1',
    });

    expect(handle.meta.planes).toHaveLength(1);
    expect(handle.meta.planes[0]?.imageId).toContain('胸部CT平扫.dcm');
    expect(handle.meta.planes[0]?.imageId).not.toContain('\uFFFD');
  });

  it('P1-6 验证：DICOMDIR 损坏回退时产生明确 warning 告警', async () => {
    // 损坏的 DICOMDIR（魔数存在但内部全损坏）
    const corruptedDir = new Uint8Array(200);
    corruptedDir[128] = 0x44;
    corruptedDir[129] = 0x49;
    corruptedDir[130] = 0x43;
    corruptedDir[131] = 0x4d;

    const dirCand = createMockCandidate('DICOMDIR', corruptedDir);
    const normalSlice = createMockCandidate('CT.dcm', buildDicomBuffer({
      studyInstanceUid: '1.2.3.800',
      seriesInstanceUid: '1.2.3.800.1',
    }));

    const source = new LocalDataSource();
    const studies = await source.probe({ files: [dirCand, normalSlice] });

    // 成功回退至全盘扫描并找到正常切片
    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.3.800');

    // 打开序列并检查告警
    const handle = await source.openSeries({
      studyInstanceUid: '1.2.3.800',
      seriesInstanceUid: '1.2.3.800.1',
    });
    expect(handle.warnings.some((w) => w.message.includes('DICOMDIR'))).toBe(true);
  });
});
