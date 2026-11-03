/**
 * 本地数据源端口实现（LocalDataSource）
 *
 * 遵循规范：
 * 实现了 core 的 DataSourcePort 接口。
 * 遵循 R6：不碰 DOM，只接收 ImportCandidate 抽象。
 * P0-1: 缓存隔离至 handle 实例，并使用 LRU 滑动窗口淘汰，杜绝内存无界增长。
 * P0-2: prefetch 统一走 loadFrame 并有效填充 LRU 缓存。
 * P1-3 & P1-4: 识别传输语法，对未支持的压缩格式明确报错，对大端字节序做字节反转。
 * P1-6: DICOMDIR 损坏回退时显式产生告警。
 * P1-8: 使用 O(1) 路径快速索引表。
 */

import type {
  CodecPort,
  DataWarning,
  DataSourcePort,
  ImagePlane,
  ImportCandidate,
  ImportInput,
  ImportOutcome,
  PixelFrame,
  SeriesHandle,
  SeriesMeta,
  SeriesRef,
  SeriesSummary,
  StudyMeta,
  VOIRange,
} from '@opendicomviewer/core';
import dicomParser from 'dicom-parser';
import {
  type DicomdirStudy,
  createCandidateIndex,
  dicomdirToStudyMetas,
  matchCandidateO1,
  parseDicomdir,
} from './dicomdir';
import { hasDicomPrefix, isDicomdirCandidate } from './magic';
import {
  type FileParseFailure,
  type InternalSeriesData,
  type ScanResult,
  buildSortedSeriesMeta,
  expandParsedPlanes,
  parseDicomMetadata,
  scanCandidates,
} from './scanner';
import { getParserPool } from './worker/parser-pool';

/**
 * 轻量固定容量 LRU 缓存（P0-1）
 */
export class LRUCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(readonly maxSize: number = 64) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * 16-bit 大端字节序反转（P1-4）
 */
function swap16InPlace(bytes: Uint8Array): void {
  for (let i = 0; i < bytes.length - 1; i += 2) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    if (b0 !== undefined && b1 !== undefined) {
      bytes[i] = b1;
      bytes[i + 1] = b0;
    }
  }
}

/**
 * 判断是否为封装压缩的 TransferSyntax（P1-3）
 */
function isEncapsulatedTransferSyntax(ts: string | undefined): ts is string {
  if (!ts) return false;
  // JPEG 系列 (1.2.840.10008.1.2.4.*), RLE (1.2.840.10008.1.2.5) 等
  return ts.startsWith('1.2.840.10008.1.2.4.') || ts === '1.2.840.10008.1.2.5';
}

export class LocalDataSource implements DataSourcePort {
  readonly kind = 'local' as const;

  /**
   * 压缩像素解码器由组合根注入（依赖方向 adapters → core，禁止 adapter 互相 import）。
   * 不注入时，封装压缩语法保持显式报错，绝不把压缩码流当裸像素画（P1-3 / R7）。
   */
  constructor(private readonly codec?: CodecPort) {}

  private lastInputFiles: readonly ImportCandidate[] = [];
  private candidateIndex = new Map<string, ImportCandidate>();
  private isDicomdirIndexed = false;
  private dicomdirStudies: DicomdirStudy[] = [];
  private scanResult: ScanResult | null = null;
  private probeWarnings: DataWarning[] = [];

  async probe(
    input: ImportInput,
    signal?: AbortSignal,
  ): Promise<readonly StudyMeta[]> {
    this.lastInputFiles = input.files;
    this.candidateIndex = createCandidateIndex(input.files);
    this.probeWarnings = [];

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
        // P1-6: DICOMDIR 损坏回退全盘扫描时明确提示用户，禁止静默处理 (R7)
        this.probeWarnings.push({
          code: 'DECODE_PARTIAL_FAILURE',
          message: 'DICOMDIR 索引文件解析失败，已自动回退至全盘扫描模式',
          severity: 'warning',
          details: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    // 2. 无有效 DICOMDIR 时全盘扫描
    this.isDicomdirIndexed = false;
    this.dicomdirStudies = [];
    const result = await scanCandidates(input.files, signal);
    this.scanResult = result;
    return result.studies;
  }

  /**
   * 枚举指定 Study 或所有 Study 下已索引的序列清单（满足 DataSourcePort 契约）
   */
  async listSeries(studyInstanceUid?: string): Promise<readonly SeriesSummary[]> {
    if (this.isDicomdirIndexed) {
      const studies = studyInstanceUid
        ? this.dicomdirStudies.filter((s) => s.studyInstanceUid === studyInstanceUid)
        : this.dicomdirStudies;
      return studies.flatMap((study) =>
        study.series.map((s) => ({
          studyInstanceUid: study.studyInstanceUid,
          seriesInstanceUid: s.seriesInstanceUid,
          seriesNumber: s.seriesNumber,
          seriesDescription: s.seriesDescription ?? '',
          modality: (s.modality ?? 'OT') as SeriesSummary['modality'],
          numberOfFrames: s.images.length,
        })),
      );
    }

    if (!this.scanResult) return [];
    const list = studyInstanceUid
      ? this.scanResult.seriesList.filter(
          (s) => s.studyInstanceUid === studyInstanceUid,
        )
      : this.scanResult.seriesList;

    return list.map((s) => ({
      studyInstanceUid: s.studyInstanceUid,
      seriesInstanceUid: s.seriesInstanceUid,
      seriesNumber: s.seriesNumber,
      seriesDescription: s.seriesDescription ?? '',
      modality: (s.modality ?? 'OT') as SeriesSummary['modality'],
      numberOfFrames: s.planes.length,
    }));
  }

  /**
   * 最近一次 probe 的导入结果概览。
   *
   * 语义边界：只统计"文件级解析失败"（非 DICOM / 缺少必需标签 / 封装语法未支持），
   * 不含序列级告警（层间距跳跃、倾角等）——后者归 SeriesHandle.warnings。
   * 二者不合并，否则 UI 上会出现"失败 8 个"但其中 7 个其实成功载入的假象。
   */
  importOutcome(): ImportOutcome {
    if (!this.scanResult) return { succeeded: 0, failures: [] };
    return {
      succeeded: this.scanResult.parsedFileCount,
      failures: this.scanResult.failedFiles.map((f) => ({
        id: f.id,
        name: f.name,
        reason: f.reason,
      })),
    };
  }

  async openSeries(ref: SeriesRef, signal?: AbortSignal): Promise<SeriesHandle> {
    if (signal?.aborted) {
      throw new DOMException('打开序列已由用户中断', 'AbortError');
    }

    if (!ref.studyInstanceUid || !ref.seriesInstanceUid) {
      throw new Error(
        `缺少必要的序列定位参数: studyInstanceUid="${ref.studyInstanceUid}", seriesInstanceUid="${ref.seriesInstanceUid}"`,
      );
    }

    if (this.isDicomdirIndexed) {
      return this.openSeriesFromDicomdir(ref, signal);
    }

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
    const study = ref.studyInstanceUid
      ? this.dicomdirStudies.find((s) => s.studyInstanceUid === ref.studyInstanceUid)
      : this.dicomdirStudies[0];
    const series = ref.seriesInstanceUid
      ? study?.series.find((s) => s.seriesInstanceUid === ref.seriesInstanceUid)
      : study?.series[0];

    if (!study || !series) {
      throw new Error(`DICOMDIR 索引中不存在序列: ${ref.seriesInstanceUid}`);
    }

    const planes: InternalSeriesData['planes'] = [];
    const candidateMap = new Map<string, ImportCandidate>();
    const failures: FileParseFailure[] = [];
    const extraWarnings: DataWarning[] = [];

    for (const imgRef of series.images) {
      if (signal?.aborted) {
        throw new DOMException('打开序列已由用户中断', 'AbortError');
      }

      // P1-8: O(1) 查表快速匹配
      const candidate = matchCandidateO1(this.candidateIndex, imgRef.referencedFileId);

      if (!candidate) {
        failures.push({
          id: imgRef.referencedFileId,
          name: imgRef.referencedFileId,
          reason: '文件在输入列表中未找到',
        });
        continue;
      }

      try {
        // 读取前 128KB 元数据
        let metaBuf: ArrayBuffer;
        if (candidate.size > 0 && candidate.size <= 131072) {
          metaBuf = await candidate.read(0, candidate.size, signal);
        } else {
          metaBuf = await candidate.read(0, 131072, signal);
        }

        // P1-1: 采用 Worker 线程池解析切片元数据，转移 buffer 零拷贝
        let meta: ReturnType<typeof parseDicomMetadata>;
        try {
          meta = await getParserPool().parse(metaBuf, candidate);
        } catch {
          const fullBuf = await candidate.read(undefined, undefined, signal);
          meta = await getParserPool().parse(fullBuf, candidate);
        }

        const expanded = expandParsedPlanes(meta);
        for (const plane of expanded.planes) {
          planes.push(plane);
          candidateMap.set(plane.imageId, candidate);
        }
        extraWarnings.push(...expanded.warnings);
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
      extraWarnings,
    };

    const seriesMeta = buildSortedSeriesMeta(internalData, failures);
    return this.createSeriesHandle(seriesMeta, candidateMap);
  }

  private createSeriesHandle(
    seriesMeta: SeriesMeta,
    candidateMap: Map<string, ImportCandidate>,
  ): SeriesHandle {
    // P0-1: 缓存属于 handle 实例，最大容量 64，LRU 淘汰
    const lruCache = new LRUCache<string, PixelFrame>(64);

    // P0-2: 抽离公共 loadFrame，统一供 pixel() 与 prefetch() 调用
    const loadFrame = async (plane: SeriesMeta['planes'][0]): Promise<PixelFrame> => {
      if (!plane) {
        throw new Error('未提供有效切片信息');
      }

      const cached = lruCache.get(plane.imageId);
      if (cached) return cached;

      const candidate = candidateMap.get(plane.imageId);
      if (!candidate) {
        throw new Error(`找不到切片对应的数据源文件: ${plane.imageId}`);
      }

      // P1-3: 封装压缩语法必须交给 CodecPort 解码，禁止当裸像素解读
      const transferSyntax = plane.transferSyntaxUid;
      if (isEncapsulatedTransferSyntax(transferSyntax)) {
        const frame = await this.decodeCompressedFrame(
          plane,
          candidate,
          transferSyntax,
        );
        lruCache.set(plane.imageId, frame);
        return frame;
      }

      const buf = await candidate.read();
      const dataSet = dicomParser.parseDicom(new Uint8Array(buf));
      const pixelElement = dataSet.elements.x7fe00010;

      let pixelData: Int16Array | Uint16Array | Uint8Array;
      const bitsAllocated = plane.bitsAllocated ?? 16;
      const isSigned = plane.pixelRepresentation === 1;
      // D5: 单文件多帧展开后，plane 只对应文件内的第 frameIndex 帧，必须按帧字节切片
      const frameIndex = plane.frameIndex ?? 0;
      const frameSize = plane.rows * plane.columns * (bitsAllocated > 8 ? 2 : 1);

      if (pixelElement && pixelElement.length > 0) {
        const frameStart = pixelElement.dataOffset + frameIndex * frameSize;
        const frameEnd = frameStart + frameSize;
        if (frameEnd > pixelElement.dataOffset + pixelElement.length) {
          throw new Error(
            `像素数据不足以覆盖第 ${frameIndex} 帧（每帧需 ${frameSize} 字节）: ${plane.imageId}`,
          );
        }
        const rawSlice = dataSet.byteArray.slice(frameStart, frameEnd);

        // P1-4: 大端字节序处理 (Explicit VR Big Endian 1.2.840.10008.1.2.2)
        if (transferSyntax === '1.2.840.10008.1.2.2' && bitsAllocated === 16) {
          swap16InPlace(rawSlice);
        }

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

      lruCache.set(plane.imageId, frame);
      return frame;
    };

    const allWarnings = [...seriesMeta.warnings, ...this.probeWarnings];

    return {
      meta: {
        ...seriesMeta,
        warnings: allWarnings,
      },
      warnings: allWarnings,
      pixel: async (layerIndex: number): Promise<PixelFrame> => {
        const plane = seriesMeta.planes[layerIndex];
        if (!plane) {
          throw new RangeError(
            `切片索引越界: ${layerIndex}（共 ${seriesMeta.planes.length} 层）`,
          );
        }
        return loadFrame(plane);
      },
      prefetch: async (indices: readonly number[]): Promise<void> => {
        // P0-2: 批量预取加载并写入 LRU 缓存
        const promises = indices.map(async (idx) => {
          const plane = seriesMeta.planes[idx];
          if (plane && !lruCache.has(plane.imageId)) {
            await loadFrame(plane);
          }
        });
        await Promise.all(promises);
      },
      dispose: (): void => {
        // P0-1: 只清空当前实例的 LRU 缓存，不误伤其他活动序列
        lruCache.clear();
      },
    };
  }

  /**
   * 解封装并解码一帧压缩像素。
   *
   * 解封装（basic offset table / fragments）留在 source-local，是因为 codec-* 被禁止
   * 引入 DICOM 解析库（GEMINI §2）；codec 只接收单帧码流。
   */
  private async decodeCompressedFrame(
    plane: ImagePlane,
    candidate: ImportCandidate,
    transferSyntax: string,
  ): Promise<PixelFrame> {
    const codec = this.codec;
    if (!codec) {
      throw new Error(
        `暂不支持直接解码封装压缩传输语法 (${transferSyntax})，需经 CodecPort WASM 解码器`,
      );
    }
    if (!codec.canDecode(transferSyntax)) {
      throw new Error(
        `当前解码器不支持压缩传输语法 (${transferSyntax})，无法显示该切片`,
      );
    }

    const buf = await candidate.read();
    const dataSet = dicomParser.parseDicom(new Uint8Array(buf));
    const pixelElement = dataSet.elements.x7fe00010;
    if (!pixelElement) {
      throw new Error(`缺少像素数据 (7FE0,0010)，无法解码: ${plane.imageId}`);
    }

    // D5: 单文件多帧按 plane.frameIndex 定位；单帧文件即第 0 帧
    const numberOfFramesInFile = Math.max(1, dataSet.intString('x00280008') ?? 1);
    const frameIndex = plane.frameIndex ?? 0;
    if (frameIndex >= numberOfFramesInFile) {
      throw new Error(
        `帧索引越界（第 ${frameIndex} 帧，文件共 ${numberOfFramesInFile} 帧）: ${plane.imageId}`,
      );
    }

    // 空 Basic Offset Table 是真实文件的常见形态（如仅有单帧或多片段单帧）：
    // readEncapsulatedImageFrame 会直接抛 "basicOffsetTable has zero entries"；
    // 单帧时按 dicom-parser 的既有语义把全部片段视为同一帧，
    // 多帧时没有偏移表就无法可靠切分帧边界，必须显式报错而不是猜（R7）。
    const fragments = pixelElement.fragments;
    if (!fragments || fragments.length === 0) {
      throw new Error(`封装像素数据缺少片段 (7FE0,0010)，无法解码: ${plane.imageId}`);
    }
    const hasOffsetTable = (pixelElement.basicOffsetTable?.length ?? 0) > 0;
    let frameBytes: Uint8Array;
    if (hasOffsetTable) {
      frameBytes = dicomParser.readEncapsulatedImageFrame(
        dataSet,
        pixelElement,
        frameIndex,
      );
    } else if (numberOfFramesInFile === 1) {
      frameBytes = dicomParser.readEncapsulatedPixelDataFromFragments(
        dataSet,
        pixelElement,
        0,
        fragments.length,
      );
    } else {
      throw new Error(
        `封装多帧缺少基本偏移表（Basic Offset Table），无法定位第 ${frameIndex + 1}/${numberOfFramesInFile} 帧: ${plane.imageId}`,
      );
    }
    const frameBuffer = frameBytes.buffer.slice(
      frameBytes.byteOffset,
      frameBytes.byteOffset + frameBytes.byteLength,
    );

    return codec.decode(frameBuffer, transferSyntax, plane);
  }
}
