/**
 * OpenMedViewer Core Domain Models
 *
 * 严格遵循 R6（零宿主 API、零 DOM、零 Cornerstone3D 依赖）
 * 严格遵循 R10（禁止任何诊断表述）
 */

export type Modality =
  | 'CT'
  | 'MR'
  | 'CR'
  | 'DX'
  | 'US'
  | 'PT'
  | 'NM'
  | 'XA'
  | 'SC'
  | 'OT'
  | string;

export interface ImagePlane {
  /** 唯一标识符或文件 URI */
  readonly imageId: string;
  /** 切片 SOP Instance UID（脱敏或原始） */
  readonly sopInstanceUid: string;
  /** 实例序号，仅作为几何投影相同层时的 tie-breaker，严禁作为主排序列（R3） */
  readonly instanceNumber?: number;
  /** 患者空间三维坐标 [x, y, z]，对应 DICOM (0020,0032) */
  readonly imagePositionPatient: [number, number, number];
  /** 患者空间方向余弦 [Xx, Xy, Xz, Yx, Yy, Yz]，对应 DICOM (0020,0037) */
  readonly imageOrientationPatient: [number, number, number, number, number, number];
  /** 像素间距 [行间距, 列间距] mm，对应 DICOM (0028,0030) */
  readonly pixelSpacing: [number, number];
  /** 切片物理厚度 mm，对应 DICOM (0018,0050) */
  readonly sliceThickness?: number;
  /** 切片间距 mm，对应 DICOM (0018,0088) */
  readonly spacingBetweenSlices?: number;
  /** 图像矩阵行数 */
  readonly rows: number;
  /** 图像矩阵列数 */
  readonly columns: number;
  /** 线性灰度换算斜率，默认 1.0 */
  readonly rescaleSlope?: number;
  /** 线性灰度换算截距，默认 0.0 */
  readonly rescaleIntercept?: number;
  /** 默认窗宽 */
  readonly windowWidth?: number;
  /** 默认窗位 */
  readonly windowCenter?: number;
  /** 存储位数，如 16 */
  readonly bitsAllocated?: number;
  /** 像素位深度，如 12 或 16 */
  readonly bitsStored?: number;
  /** 像素数据表示：0 为无符号，1 为补码有符号 */
  readonly pixelRepresentation?: number;
  /** 光度学解释，如 MONOCHROME1, MONOCHROME2, RGB */
  readonly photometricInterpretation?: string;
}

export interface DataWarning {
  readonly code:
    | 'SLICE_GAP'
    | 'IRREGULAR_SPACING'
    | 'ORIENTATION_MISMATCH'
    | 'MISSING_GEOMETRY'
    | 'BURNED_IN_INFO'
    | 'UNSUPPORTED_TRANSFER_SYNTAX'
    | 'DECODE_PARTIAL_FAILURE';
  /** 面向用户的自然语言中文提示（R7） */
  readonly message: string;
  readonly severity: 'warning' | 'error';
  readonly details?: Record<string, string | number | boolean>;
}

export interface SeriesMeta {
  readonly seriesInstanceUid: string;
  readonly studyInstanceUid: string;
  readonly seriesNumber?: number;
  readonly seriesDescription: string;
  readonly modality: Modality;
  readonly numberOfFrames: number;
  /** 经过 IPP 投影排好序的切片列表（严禁依赖 InstanceNumber 排序） */
  readonly planes: readonly ImagePlane[];
  /** 各向异性物理间距 [rowSpacing, colSpacing, sliceSpacing] mm */
  readonly spacing: [number, number, number];
  readonly warnings: readonly DataWarning[];
}

export interface StudyMeta {
  readonly studyInstanceUid: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly studyDate?: string;
  readonly studyDescription: string;
  readonly modalities: readonly Modality[];
  readonly seriesCount: number;
}

export interface VOIRange {
  /** 窗宽 Window Width */
  readonly windowWidth: number;
  /** 窗位 Window Center */
  readonly windowCenter: number;
}

export interface VOIBounds {
  /** 映射下限 (WL - WW / 2) */
  readonly lower: number;
  /** 映射上限 (WL + WW / 2) */
  readonly upper: number;
}

export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  /** 灰度或原始像素数据 */
  readonly pixelData: Int16Array | Uint16Array | Uint8Array;
  readonly rescaleSlope: number;
  readonly rescaleIntercept: number;
  /** 窗宽窗位（若有） */
  readonly defaultVOI?: VOIRange;
}

/**
 * 测量与参考几何（仅供非诊断参考使用）
 */
export interface MeasurementRecord {
  readonly id: string;
  readonly seriesInstanceUid: string;
  readonly sopInstanceUid: string;
  readonly type: 'length' | 'probe' | 'rectangleRoi' | 'ellipseRoi';
  /** 标注控制点坐标（像素或患者世界坐标） */
  readonly points: readonly [number, number, number][];
  /** 物理测量结果，如长度(mm)、面积(mm²)、HU 均值与标准差 */
  readonly stats: {
    readonly lengthMm?: number;
    readonly areaMm2?: number;
    readonly meanHU?: number;
    readonly stdDevHU?: number;
    readonly minHU?: number;
    readonly maxHU?: number;
  };
  readonly createdAt: number;
  readonly text?: string;
}
