import type { ImportCandidate } from '@opendicomviewer/core';
import { describe, expect, it, vi } from 'vitest';
import { LocalDataSource } from '../src/source-local';
import {
  buildDicomBuffer,
  buildDicomdirBuffer,
} from '../testing/dicom-fixture';

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
    // 构造 DICOMDIR
    const dicomdirBytes = buildDicomdirBuffer([
      { recordType: 'PATIENT', patientId: 'PID-DIR-001', patientName: '王大爷' },
      { recordType: 'STUDY', studyInstanceUid: '1.2.840.999.1', studyDescription: '头颅CT' },
      { recordType: 'SERIES', seriesInstanceUid: '1.2.840.999.1.1', modality: 'CT' },
      { recordType: 'IMAGE', referencedFileId: 'IMAGES/CT001', referencedSopInstanceUid: '1.2.840.999.1.1.1' },
      { recordType: 'IMAGE', referencedFileId: 'IMAGES/CT002', referencedSopInstanceUid: '1.2.840.999.1.1.2' },
    ]);

    const dicomdirCand = createMockCandidate('DICOMDIR', dicomdirBytes);

    // 两个被引用的图像切片
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

    // 模拟全盘里还有 100 个无关的大文件，记录其 read 调用次数
    const otherReadSpy = vi.fn();
    const otherCand = createMockCandidate('OTHER/HUGE_FILE.DAT', new Uint8Array(1024), otherReadSpy);

    const source = new LocalDataSource();
    const studies = await source.probe({
      files: [dicomdirCand, ct1Cand, ct2Cand, otherCand],
    });

    // 验证：通过 DICOMDIR 快速产出 StudyMeta
    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.840.999.1');
    expect(studies[0]?.patientId).toBe('PID-DIR-001');

    // 关键断言：probe 阶段走 DICOMDIR 索引，完全没有读取 OTHER/HUGE_FILE.DAT
    expect(otherReadSpy).not.toHaveBeenCalled();

    // 验证按需打开序列
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

    // 损坏文件：前 132 字节正常含 DICM 魔数，但后面内容严重损坏/乱码
    const corruptedBytes = new Uint8Array(200);
    for (let i = 0; i < 128; i++) corruptedBytes[i] = 0;
    corruptedBytes[128] = 0x44; // D
    corruptedBytes[129] = 0x49; // I
    corruptedBytes[130] = 0x43; // C
    corruptedBytes[131] = 0x4d; // M
    for (let i = 132; i < 200; i++) corruptedBytes[i] = 0xff; // 畸形数据

    const corruptedCand = createMockCandidate('broken.dcm', corruptedBytes);

    const source = new LocalDataSource();
    const studies = await source.probe({
      files: [valid1, corruptedCand, valid2],
    });

    // 正常文件不受损坏文件影响，成功建立 Study
    expect(studies).toHaveLength(1);
    expect(studies[0]?.studyInstanceUid).toBe('1.2.3.100');

    // 打开序列并断言包含解析失败警告汇总
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
  });

  it('用例 6：AbortSignal 中断后不产生残留任务', async () => {
    const ac = new AbortController();

    const candidates = [
      createMockCandidate('f1.dcm', buildDicomBuffer()),
      createMockCandidate('f2.dcm', buildDicomBuffer()),
    ];

    // 立即发起中断
    ac.abort();

    const source = new LocalDataSource();
    await expect(source.probe({ files: candidates }, ac.signal)).rejects.toThrow(
      /中断/,
    );
  });
});
