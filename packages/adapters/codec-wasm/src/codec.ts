/**
 * CodecPort 的本地实现
 *
 * 当前覆盖：
 * - RLE Lossless（1.2.840.10008.1.2.5）——纯 TS，零依赖
 * - JPEG Lossless（1.2.840.10008.1.2.4.57 / .70）——按需动态加载解码库
 *
 * 只解码像素。解封装（basic offset table / fragments）由 source-local 负责，
 * 因为这里不允许引入 DICOM 解析库（GEMINI §2）。
 */

import type {
  CodecPort,
  ImagePlane,
  PixelFrame,
  VOIRange,
} from '@opendicomviewer/core';
import { decodeJpegLosslessFrame } from './jpeg-lossless';
import { decodeRleFrame } from './rle';

export const RLE_LOSSLESS_UID = '1.2.840.10008.1.2.5';
export const JPEG_LOSSLESS_UID = '1.2.840.10008.1.2.4.57';
export const JPEG_LOSSLESS_SV1_UID = '1.2.840.10008.1.2.4.70';

interface PixelContext {
  readonly rows: number;
  readonly columns: number;
  readonly bitsAllocated: number;
  readonly pixelRepresentation: number;
  readonly photometricInterpretation?: string;
}

const GRAYSCALE_INTERPRETATIONS = new Set(['MONOCHROME1', 'MONOCHROME2']);

export class PixelCodec implements CodecPort {
  /**
   * 当前实现全部在调用线程内同步/异步解码，不经过 SharedArrayBuffer 通道，
   * 因此不存在"优先共享内存"的语义。迁移到 Worker 池后再按 COOP/COEP 探测。
   */
  readonly prefersSharedMemory = false;

  canDecode(transferSyntaxUid: string): boolean {
    return (
      transferSyntaxUid === RLE_LOSSLESS_UID ||
      transferSyntaxUid === JPEG_LOSSLESS_UID ||
      transferSyntaxUid === JPEG_LOSSLESS_SV1_UID
    );
  }

  async decode(
    buffer: ArrayBuffer,
    transferSyntaxUid: string,
    planeMeta?: Partial<ImagePlane>,
  ): Promise<PixelFrame> {
    const context = resolvePixelContext(planeMeta);
    const bitstream = new Uint8Array(buffer);

    let pixelData: Int16Array | Uint16Array | Uint8Array;
    if (transferSyntaxUid === RLE_LOSSLESS_UID) {
      pixelData = decodeRleFrame(bitstream, context);
    } else if (
      transferSyntaxUid === JPEG_LOSSLESS_UID ||
      transferSyntaxUid === JPEG_LOSSLESS_SV1_UID
    ) {
      pixelData = await decodeJpegLosslessFrame(bitstream, context);
    } else {
      // 走到这里说明调用方没先问 canDecode；仍然是显式失败，不返回空白帧
      throw new Error(`不支持的压缩传输语法: ${transferSyntaxUid}`);
    }

    let defaultVOI: VOIRange | undefined;
    if (
      planeMeta?.windowCenter !== undefined &&
      planeMeta?.windowWidth !== undefined
    ) {
      defaultVOI = {
        windowCenter: planeMeta.windowCenter,
        windowWidth: planeMeta.windowWidth,
      };
    }

    return {
      width: context.columns,
      height: context.rows,
      pixelData,
      rescaleSlope: planeMeta?.rescaleSlope ?? 1.0,
      rescaleIntercept: planeMeta?.rescaleIntercept ?? 0.0,
      modalityLUT: planeMeta?.modalityLUT,
      photometricInterpretation: context.photometricInterpretation,
      bitsAllocated: context.bitsAllocated,
      pixelRepresentation: context.pixelRepresentation,
      defaultVOI,
    };
  }
}

function resolvePixelContext(planeMeta?: Partial<ImagePlane>): PixelContext {
  const rows = planeMeta?.rows;
  const columns = planeMeta?.columns;
  if (!rows || !columns || rows <= 0 || columns <= 0) {
    throw new Error(
      `解码缺少图像矩阵尺寸（rows=${String(rows)}, columns=${String(columns)}），无法组装 PixelFrame`,
    );
  }

  const photometricInterpretation = planeMeta?.photometricInterpretation;
  if (
    photometricInterpretation &&
    !GRAYSCALE_INTERPRETATIONS.has(photometricInterpretation)
  ) {
    throw new Error(
      `暂不支持 ${photometricInterpretation} 压缩图像：PixelFrame 目前只承载单通道灰度`,
    );
  }

  return {
    rows,
    columns,
    bitsAllocated: planeMeta?.bitsAllocated ?? 16,
    pixelRepresentation: planeMeta?.pixelRepresentation ?? 0,
    photometricInterpretation,
  };
}
