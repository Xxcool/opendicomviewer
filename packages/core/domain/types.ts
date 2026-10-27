/**
 * OpenDicomViewer Core Domain Models
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
  | (string & {});

export interface ModalityLUT {
  /** 查表输入起始像素值，对应 (0028,3002) Descriptor[1] */
  readonly firstMappedPixelValue: number;
  /** 查表输出存储位深，对应 Descriptor[2] */
  readonly bitsStored: number;
  /** LUT 查表数据，对应 (0028,3006) LUTData */
  readonly lutData: readonly number[] | Uint16Array;
}

export interface ImagePlane {
  /** 唯一标识符或文件 URI */
  readonly imageId: string;
  /** 切片 SOP Instance UID（脱敏或原始） */
  readonly sopInstanceUid: string;
  /** 空间参考坐标系 UID (0020,0052)，用于多序列几何一致性与配准检测 */
  readonly frameOfReferenceUID?: string;
  /** 字符集声明 (0008,0005)，用于文本解码派发 */
  readonly specificCharacterSet?: string;
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
  /** Modality LUT 序列查表项，存在时优先于线性 Rescale（S2） */
  readonly modalityLUT?: ModalityLUT;
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
  /** 传输语法 UID (0002,0010)，用于解码格式识别与字节序处理 (P1-3, P1-4) */
  readonly transferSyntaxUid?: string;
  /** 是否缺失空间几何坐标 (0020,0032)/(0020,0037)，禁止静默降级为 [0,0,0] (P1-5) */
  readonly hasMissingGeometry?: boolean;
}

export interface DataWarning {
  readonly code:
    | 'SLICE_GAP'
    | 'IRREGULAR_SPACING'
    | 'DUPLICATE_SLICE'
    | 'ORIENTATION_MISMATCH'
    | 'NON_AXIAL_ORIENTATION'
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
  /**
   * 序列包含的总可渲染切片/帧数 (N4)。
   * 说明：对于单文件单切片序列，该值等于 sortedPlanes.length；
   * 后续接入 Enhanced Multi-frame 序列时，单文件多帧展开后的切片集合亦计入此数。
   * （此字段代表整条序列的呈现帧总数，与单个 DICOM 物理文件内的 (0028,0008) NumberOfFrames 区分）。
   */
  readonly numberOfFrames: number;
  /** 经过 IPP 投影排好序的切片列表（严禁依赖 InstanceNumber 排序） */
  readonly planes: readonly ImagePlane[];
  /** 因朝向冲突或其他严重几何不一致而被排除的切片列表（S5） */
  readonly excludedPlanes?: readonly ImagePlane[];
  /** 各向异性物理间距 [rowSpacing, colSpacing, sliceSpacing] mm */
  readonly spacing: [number, number, number];
  readonly warnings: readonly DataWarning[];
}

export interface StudyMeta {
  readonly studyInstanceUid: string;
  /**
   * 患者身份相关字段属于受保护健康信息（PHI）。
   * 仅存在于内存态，严格禁止落盘、写入本地日志或通过任何网络上报（R5/R8）。
   */
  readonly patientId: string;
  readonly patientName: string;
  readonly studyDate?: string;
  readonly studyDescription: string;
  readonly modalities: readonly Modality[];
  readonly seriesCount: number;
}

export interface VOIRange {
  /** 窗宽 Window Width (必须 >= 1) */
  readonly windowWidth: number;
  /** 窗位 Window Center */
  readonly windowCenter: number;
}

/**
 * DICOM PS3.3 C.11.2.1.2 线性 VOI LUT 映射边界
 * lower = windowCenter - 0.5 - (windowWidth - 1) / 2
 * upper = windowCenter - 0.5 + (windowWidth - 1) / 2
 */
export interface VOIBounds {
  /** 映射下限：输入 <= lower 时输出 ymin (0) */
  readonly lower: number;
  /** 映射上限：输入 > upper 时输出 ymax (255) */
  readonly upper: number;
}

export interface PixelFrame {
  readonly width: number;
  readonly height: number;
  /** 灰度或原始像素数据 */
  readonly pixelData: Int16Array | Uint16Array | Uint8Array;
  readonly rescaleSlope: number;
  readonly rescaleIntercept: number;
  readonly modalityLUT?: ModalityLUT;
  readonly photometricInterpretation?: string;
  readonly bitsAllocated?: number;
  readonly pixelRepresentation?: number;
  /** 默认窗宽窗位（若有） */
  readonly defaultVOI?: VOIRange;
}

/**
 * 测量与参考几何（仅供非诊断参考使用）
 */
export interface MeasurementRecord {
  readonly id: string;
  readonly seriesInstanceUid: string;
  readonly sopInstanceUid: string;
  readonly type: 'length' | 'probe' | 'rectangleRoi' | 'ellipseRoi' | 'angle' | 'cobbAngle';
  /** 标注控制点坐标（像素或患者世界坐标） */
  readonly points: readonly [number, number, number][];
  /** 物理测量结果，如长度(mm)、面积(mm²)、角度(度)、HU 均值与标准差 */
  readonly stats: {
    readonly lengthMm?: number;
    readonly areaMm2?: number;
    readonly angleDeg?: number;
    readonly meanHU?: number;
    readonly stdDevHU?: number;
    readonly minHU?: number;
    readonly maxHU?: number;
  };
  readonly createdAt: number;
  readonly text?: string;
}
