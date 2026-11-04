/** 源图像素中心坐标；x 沿列增长，y 沿行增长，不接收屏幕坐标或降采样坐标。 */
export type ImagePixelPoint = readonly [x: number, y: number];

/** 由调用方核对源图标定；标签存在本身不等于物理标定可信。 */
export interface MeasurementCalibration {
  readonly trusted: boolean;
  /** DICOM (0028,0030)：行间距在前，列间距在后，单位 mm。 */
  readonly pixelSpacing: readonly [row: number, column: number];
}

export type GeometryMeasurement<Unit extends 'mm' | 'deg'> =
  | { readonly ok: true; readonly value: number; readonly unit: Unit }
  | { readonly ok: false; readonly reason: 'uncalibrated' | 'invalid-spacing' | 'invalid-point' | 'degenerate' };

type PhysicalVector = readonly [number, number];
type VectorResult = { readonly ok: true; readonly vector: PhysicalVector; readonly length: number }
  | Extract<GeometryMeasurement<'mm'>, { ok: false }>;

function physicalVector(
  from: ImagePixelPoint,
  to: ImagePixelPoint,
  calibration: MeasurementCalibration | undefined,
): VectorResult {
  if (!calibration?.trusted) return { ok: false, reason: 'uncalibrated' };
  const [row, column] = calibration.pixelSpacing;
  if (![row, column].every(value => Number.isFinite(value) && value > 0)) {
    return { ok: false, reason: 'invalid-spacing' };
  }
  if (![...from, ...to].every(Number.isFinite)) return { ok: false, reason: 'invalid-point' };
  // 屏幕 x 对应列，不能把 DICOM 的第一个间距乘到 x 上。
  const vector: PhysicalVector = [(to[0] - from[0]) * column, (to[1] - from[1]) * row];
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length)) return { ok: false, reason: 'invalid-point' };
  if (length === 0) return { ok: false, reason: 'degenerate' };
  return { ok: true, vector, length };
}

/** 同一原始帧内的物理直线长度；可信标定缺失时不返回伪毫米。 */
export function measureImageLength(
  start: ImagePixelPoint,
  end: ImagePixelPoint,
  calibration: MeasurementCalibration | undefined,
): GeometryMeasurement<'mm'> {
  const result = physicalVector(start, end, calibration);
  return result.ok ? { ok: true, value: result.length, unit: 'mm' } : result;
}

/** vertex 为中间顶点，返回 0–180 度内角；各向异性像素先转换至物理平面。 */
export function measureImageAngle(
  start: ImagePixelPoint,
  vertex: ImagePixelPoint,
  end: ImagePixelPoint,
  calibration: MeasurementCalibration | undefined,
): GeometryMeasurement<'deg'> {
  const first = physicalVector(vertex, start, calibration);
  if (!first.ok) return first;
  const second = physicalVector(vertex, end, calibration);
  if (!second.ok) return second;
  // 先按最大分量缩放，避免亚正规数的 hypot 舍入破坏单位向量。
  const normalize = ([x, y]: PhysicalVector): PhysicalVector => {
    const scale = Math.max(Math.abs(x), Math.abs(y));
    const length = Math.hypot(x / scale, y / scale);
    return [x / scale / length, y / scale / length];
  };
  const a = normalize(first.vector);
  const b = normalize(second.vector);
  const cosine = a[0] * b[0] + a[1] * b[1];
  return { ok: true, value: Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI, unit: 'deg' };
}

/** 两条无向直线的锐角（0–90°）；端点反向不改变结果。 */
export function measureImageCobbAngle(a: ImagePixelPoint, b: ImagePixelPoint, c: ImagePixelPoint, d: ImagePixelPoint, calibration: MeasurementCalibration | undefined): GeometryMeasurement<'deg'> {
  const first = physicalVector(a, b, calibration);
  if (!first.ok) return first;
  const second = physicalVector(c, d, calibration);
  if (!second.ok) return second;
  const normalize = ([x, y]: PhysicalVector): PhysicalVector => {
    const scale = Math.max(Math.abs(x), Math.abs(y));
    const length = Math.hypot(x / scale, y / scale);
    return [x / scale / length, y / scale / length];
  };
  const u = normalize(first.vector), v = normalize(second.vector);
  const cosine = Math.abs(u[0] * v[0] + u[1] * v[1]);
  return { ok: true, value: Math.acos(Math.min(1, cosine)) * 180 / Math.PI, unit: 'deg' };
}
