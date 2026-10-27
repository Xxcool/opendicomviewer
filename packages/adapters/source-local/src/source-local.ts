/**
 * 本地数据源端口实现（LocalDataSource）
 *
 * 遵循规范：
 * 实现了 core 的 DataSourcePort 接口。
 * 遵循 R6：不碰 DOM，只接收 ImportCandidate 抽象。
 * 优先使用 DICOMDIR 索引树避免冗余扫描；无 DICOMDIR 时全盘递归扫描并逐文件隔离错误。
 */

import type {
  DataSourcePort,
  ImportCandidate,
  ImportInput,
  PixelFrame,
  SeriesHandle,
  SeriesMeta,
  SeriesRef,
  StudyMeta,
  VOIRange,
} from '@opendicomviewer/core';
import dicomParser from 'dicom-parser';
import {
  type DicomdirStudy,
  dicomdirToStudyMetas,
  matchCandidateByRefId,
  parseDicomdir,
} from './dicomdir';
import { hasDicomPrefix, isDicomdirCandidate } from './magic';
import {
  type FileParseFailure,
  type InternalSeriesData,
  type ScanResult,
  buildSortedSeriesMeta,
  parseDicomMetadata,
  scanCandidates,
} from './scanner';

export class LocalDataSource implements DataSourcePort {
  readonly kind = 'local' as const;

  // 内部扫描与索引缓存
  private lastInputFiles: readonly ImportCandidate[] = [];
  private isDicomdirIndexed = false;
  private dicomdirStudies: DicomdirStudy[] = [];
  private scanResult: ScanResult | null = null;
  private readonly pixelFrameCache = new Map<string, PixelFrame>();

  /**
   * 扫描探测文件集合，产出 Study 摘要列表
   * 优先识别 DICOMDIR；无有效 DICOMDIR 则执行全盘递归扫描
   */
  async probe(
    input: ImportInput,
    signal?: AbortSignal,
  ): Promise<readonly StudyMeta[]> {
    this.lastInputFiles = input.files;
    this.pixelFrameCache.clear();

    if (signal?.aborted) {
      throw new DOMException('导入已由用户中断', 'AbortError');
    }

    // 1. 优先探测 DICOMDIR
    const dicomdirCandidate = input.files.find((f) => isDicomdirCandidate(f.name));
    if (dicomdirCandidate) {
      try {
        const header = await dicomdirCandidate.read(0, 132, signal);
        if (hasDicomPrefix(header)) {
          const fullBuf = await dicomdirCandidate.read(undefined, undefined, signal);
          const parsed = parseDicomdir(new Uint8Array(fullBuf));
          if (parsed.length > 0) {
            this.isDicomdirIndexed = true;
            this.dicomdirStudies = parsed;
            this.scanResult = null;
            return dicomdirToStudyMetas(parsed);
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        // DICOMDIR 损坏则静默回退全盘扫描
      }
    }

    // 2. 无 DICOMDIR 时执行全盘扫描（逐文件隔离错误）
    this.isDicomdirIndexed = false;
    this.dicomdirStudies = [];
    const result = await scanCandidates(input.files, signal);
    this.scanResult = result;
    return result.studies;
  }

  /**
   * 加载指定序列并排好序返回 SeriesHandle
   */
  async openSeries(ref: SeriesRef, signal?: AbortSignal): Promise<SeriesHandle> {
    if (signal?.aborted) {
      throw new DOMException('打开序列已由用户中断', 'AbortError');
    }

    // 路径 A：基于 DICOMDIR 索引按需提取文件
    if (this.isDicomdirIndexed) {
      return this.openSeriesFromDicomdir(ref, signal);
    }

    // 路径 B：基于已扫描序列
    if (!this.scanResult) {
      throw new Error('未执行 probe 或扫描结果为空，无法打开序列');
    }

    const seriesData = this.scanResult.seriesList.find(
      (s) =>
        s.studyInstanceUid === ref.studyInstanceUid &&
        s.seriesInstanceUid === ref.seriesInstanceUid,
    );

    if (!seriesData) {
      throw new Error(`找不到序列: ${ref.seriesInstanceUid}`);
    }

    const seriesMeta = buildSortedSeriesMeta(
      seriesData,
      this.scanResult.failedFiles,
    );

    return this.createSeriesHandle(seriesMeta, seriesData.candidateByImageId);
  }

  private async openSeriesFromDicomdir(
    ref: SeriesRef,
    signal?: AbortSignal,
  ): Promise<SeriesHandle> {
    const study = this.dicomdirStudies.find(
      (s) => s.studyInstanceUid === ref.studyInstanceUid,
    );
    const series = study?.series.find(
      (s) => s.seriesInstanceUid === ref.seriesInstanceUid,
    );

    if (!study || !series) {
      throw new Error(`DICOMDIR 索引中不存在序列: ${ref.seriesInstanceUid}`);
    }

    const planes: InternalSeriesData['planes'] = [];
    const candidateMap = new Map<string, ImportCandidate>();
    const failures: FileParseFailure[] = [];

    // 仅按需加载属于该序列的文件，避免加载全盘
    for (const imgRef of series.images) {
      if (signal?.aborted) {
        throw new DOMException('打开序列已由用户中断', 'AbortError');
      }

      const candidate = matchCandidateByRefId(
        this.lastInputFiles,
        imgRef.referencedFileId,
      );

      if (!candidate) {
        failures.push({
          id: imgRef.referencedFileId,
          name: imgRef.referencedFileId,
          reason: '文件在输入列表中未找到',
        });
        continue;
      }

      try {
        const buf = await candidate.read(undefined, undefined, signal);
        const meta = parseDicomMetadata(new Uint8Array(buf), candidate);
        planes.push(meta.plane);
        candidateMap.set(meta.plane.imageId, candidate);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        failures.push({
          id: candidate.id,
          name: candidate.name,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const internalData: InternalSeriesData = {
      studyInstanceUid: study.studyInstanceUid,
      seriesInstanceUid: series.seriesInstanceUid,
      seriesNumber: series.seriesNumber,
      seriesDescription: series.seriesDescription,
      modality: series.modality,
      planes,
      candidateByImageId: candidateMap,
    };

    const seriesMeta = buildSortedSeriesMeta(internalData, failures);
    return this.createSeriesHandle(seriesMeta, candidateMap);
  }

  private createSeriesHandle(
    seriesMeta: SeriesMeta,
    candidateMap: Map<string, ImportCandidate>,
  ): SeriesHandle {
    return {
      meta: seriesMeta,
      warnings: seriesMeta.warnings,
      pixel: async (layerIndex: number): Promise<PixelFrame> => {
        const plane = seriesMeta.planes[layerIndex];
        if (!plane) {
          throw new RangeError(`切片索引越界: ${layerIndex}（共 ${seriesMeta.planes.length} 层）`);
        }

        const cached = this.pixelFrameCache.get(plane.imageId);
        if (cached) return cached;

        const candidate = candidateMap.get(plane.imageId);
        if (!candidate) {
          throw new Error(`找不到切片对应的数据源文件: ${plane.imageId}`);
        }

        const buf = await candidate.read();
        const dataSet = dicomParser.parseDicom(new Uint8Array(buf));
        const pixelElement = dataSet.elements.x7fe00010;

        let pixelData: Int16Array | Uint16Array | Uint8Array;
        const bitsAllocated = plane.bitsAllocated ?? 16;
        const isSigned = plane.pixelRepresentation === 1;

        if (pixelElement && pixelElement.length > 0) {
          const rawSlice = dataSet.byteArray.slice(
            pixelElement.dataOffset,
            pixelElement.dataOffset + pixelElement.length,
          );
          if (bitsAllocated === 16) {
            pixelData = isSigned
              ? new Int16Array(
                  rawSlice.buffer,
                  rawSlice.byteOffset,
                  rawSlice.byteLength / 2,
                )
              : new Uint16Array(
                  rawSlice.buffer,
                  rawSlice.byteOffset,
                  rawSlice.byteLength / 2,
                );
          } else {
            pixelData = rawSlice;
          }
        } else {
          // 占位空像素缓冲
          pixelData = new Int16Array(plane.rows * plane.columns);
        }

        let defaultVOI: VOIRange | undefined;
        if (plane.windowCenter !== undefined && plane.windowWidth !== undefined) {
          defaultVOI = {
            windowCenter: plane.windowCenter,
            windowWidth: plane.windowWidth,
          };
        }

        const frame: PixelFrame = {
          width: plane.columns,
          height: plane.rows,
          pixelData,
          rescaleSlope: plane.rescaleSlope ?? 1.0,
          rescaleIntercept: plane.rescaleIntercept ?? 0.0,
          modalityLUT: plane.modalityLUT,
          photometricInterpretation: plane.photometricInterpretation,
          bitsAllocated: plane.bitsAllocated,
          pixelRepresentation: plane.pixelRepresentation,
          defaultVOI,
        };

        this.pixelFrameCache.set(plane.imageId, frame);
        return frame;
      },
      prefetch: async (indices: readonly number[]): Promise<void> => {
        // 批量预取底层文件进内存
        const promises = indices.map(async (idx) => {
          const plane = seriesMeta.planes[idx];
          if (plane && !this.pixelFrameCache.has(plane.imageId)) {
            const candidate = candidateMap.get(plane.imageId);
            if (candidate) {
              await candidate.read();
            }
          }
        });
        await Promise.all(promises);
      },
      dispose: (): void => {
        this.pixelFrameCache.clear();
      },
    };
  }
}
