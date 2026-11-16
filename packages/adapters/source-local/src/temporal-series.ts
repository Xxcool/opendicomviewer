import { planVolumeDownsample, type ImagePlane, type SeriesMeta } from '@opendicomviewer/core';
import { buildSortedSeriesMeta, type FileParseFailure, type InternalSeriesData } from './scanner';

export interface TemporalSeries {
  readonly whole: SeriesMeta;
  readonly phases?: ReadonlyMap<number, SeriesMeta>;
}

function sameVector(a: readonly number[], b: readonly number[], tolerance: number) {
  return a.every((value, i) => Math.abs(value - b[i]!) <= tolerance);
}

function aligned(a: ImagePlane, b: ImagePlane) {
  return a.rows === b.rows && a.columns === b.columns
    && sameVector(a.imagePositionPatient, b.imagePositionPatient, 0.001)
    && sameVector(a.imageOrientationPatient, b.imageOrientationPatient, 0.0001)
    && sameVector(a.pixelSpacing, b.pixelSpacing, 0.00001);
}

export function organizeTemporalSeries(data: InternalSeriesData, failures: readonly FileParseFailure[]): TemporalSeries | undefined {
  const first = data.planes[0];
  const positions = new Set(data.planes.map(plane => plane.temporalAcquisition?.position));
  if (!first || (positions.size === 1 && !data.planes.some(plane => {
    const tag = plane.temporalAcquisition;
    return tag && (!Number.isInteger(tag.position) || tag.position < 1 || (tag.count !== undefined && tag.count !== 1));
  }))) return undefined;

  // 不对全时相集合做空间去重或剔除。无论是否符合 4D 条件，所有原始帧仍可逐张查看和引用。
  const whole: SeriesMeta = {
    studyInstanceUid: data.studyInstanceUid, seriesInstanceUid: data.seriesInstanceUid,
    modality: data.modality, seriesDescription: data.seriesDescription, seriesNumber: data.seriesNumber,
    planes: data.planes, numberOfFrames: data.planes.length, spacing: [...first.pixelSpacing, 0],
    warnings: [...data.extraWarnings ?? []],
  };
  const reject = (reason: string): TemporalSeries => ({ whole: { ...whole, volumeUnavailableReason: reason,
    warnings: [...whole.warnings, { code: 'NON_VOLUMETRIC_SERIES', severity: 'warning', message: reason }] } });
  const groups = new Map<number, ImagePlane[]>();
  const instances = new Set<string>();
  for (const plane of data.planes) {
    const tag = plane.temporalAcquisition;
    if (!tag?.supported || !Number.isSafeInteger(tag.position) || tag.position < 1
      || tag.contrastKey !== first.temporalAcquisition?.contrastKey || !plane.frameOfReferenceUID
      || plane.frameOfReferenceUID !== first.frameOfReferenceUID || plane.hasMissingPixelSpacing
      || instances.has(plane.sopInstanceUid)) return reject('时相标记、采集参数或空间参考不一致，仅可浏览原始帧');
    if (tag.count !== undefined && tag.count !== positions.size) return reject('已导入时相与声明的时相总数不符，仅可浏览原始帧');
    instances.add(plane.sopInstanceUid);
    const planes = groups.get(tag.position) ?? [];
    planes.push(plane);
    groups.set(tag.position, planes);
  }
  const phases = new Map<number, SeriesMeta>();
  for (const position of [...groups.keys()].sort((a, b) => a - b)) {
    if (position !== phases.size + 1) return reject('时相编号不连续，仅可浏览原始帧');
    const phase = buildSortedSeriesMeta({ ...data, planes: groups.get(position)! }, failures);
    const plan = planVolumeDownsample(phase);
    if (!plan.ok) return reject(`时相 ${position} 无法重建：${plan.message}`);
    if (phase.excludedPlanes?.length || phase.warnings.some(item => ['SLICE_GAP', 'IRREGULAR_SPACING', 'DUPLICATE_SLICE'].includes(item.code))) {
      return reject(`时相 ${position} 含缺层、重复位置或不一致方向，仅可浏览原始帧`);
    }
    const reference = phases.get(1);
    if (reference && (reference.planes.length !== phase.planes.length
      || phase.planes.some((plane, i) => !aligned(plane, reference.planes[i]!)))) {
      return reject(`时相 ${position} 与首相空间网格不一致，仅可浏览原始帧`);
    }
    phases.set(position, { ...phase, temporalPosition: position });
  }
  return { whole: { ...whole, planes: [...phases.values()].flatMap(phase => phase.planes),
    volumeUnavailableReason: '请按时相单独构建体积' }, phases };
}
