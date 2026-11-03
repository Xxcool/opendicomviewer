import type { ImagePlane } from '@opendicomviewer/core';
import type { DataSet } from 'dicom-parser';

type Position = ImagePlane['imagePositionPatient'];
type Orientation = ImagePlane['imageOrientationPatient'];

function macro(group: DataSet | undefined, sequence: string): DataSet | undefined {
  return group?.elements[sequence]?.items?.[0]?.dataSet;
}

function numbers(value: string | undefined, count: number): number[] | undefined {
  const parts = value?.split('\\');
  if (!parts || parts.some(part => !part.trim())) return undefined;
  const values = parts.map(Number);
  return values?.length === count && values.every(Number.isFinite) ? values : undefined;
}

function directionMatches(a: Orientation, b: Orientation): boolean {
  // 六个方向余弦不可整体求 dot：相同 IOP 的六维 dot 为 2，会漏掉真实旋转。
  return a.every((value, index) => Math.abs(value - b[index]!) <= 0.0001);
}

function framePlane(dataSet: DataSet, base: ImagePlane, index: number): ImagePlane {
  const group = dataSet.elements.x52009230?.items?.[index]?.dataSet;
  const shared = dataSet.elements.x52009229?.items?.[0]?.dataSet;
  const position = numbers((macro(group, 'x00209113') ?? macro(shared, 'x00209113'))?.string('x00200032'), 3);
  const orientation = numbers((macro(group, 'x00209116') ?? macro(shared, 'x00209116'))?.string('x00200037')
    ?? dataSet.string('x00200037'), 6);
  const measures = macro(group, 'x00289110') ?? macro(shared, 'x00289110');
  const spacing = numbers(measures?.string('x00280030') ?? dataSet.string('x00280030'), 2);
  const transform = macro(group, 'x00289145') ?? macro(shared, 'x00289145');
  const voi = macro(group, 'x00289132') ?? macro(shared, 'x00289132');
  const ipp: Position = position ? [position[0]!, position[1]!, position[2]!] : base.imagePositionPatient;
  const iop: Orientation = orientation
    ? [orientation[0]!, orientation[1]!, orientation[2]!, orientation[3]!, orientation[4]!, orientation[5]!]
    : base.imageOrientationPatient;
  return {
    ...base, imageId: `${base.imageId}#${index}`, frameIndex: index,
    imagePositionPatient: ipp, imageOrientationPatient: iop,
    hasMissingGeometry: !position || !orientation,
    pixelSpacing: spacing ? [spacing[0]!, spacing[1]!] : base.pixelSpacing,
    hasMissingPixelSpacing: !spacing,
    sliceThickness: measures?.floatString('x00180050') ?? base.sliceThickness,
    spacingBetweenSlices: measures?.floatString('x00180088') ?? base.spacingBetweenSlices,
    rescaleSlope: transform?.floatString('x00281053') ?? base.rescaleSlope,
    rescaleIntercept: transform?.floatString('x00281052') ?? base.rescaleIntercept,
    windowCenter: voi?.floatString('x00281050') ?? base.windowCenter,
    windowWidth: voi?.floatString('x00281051') ?? base.windowWidth,
  };
}

export function resolveMultiframePlanes(dataSet: DataSet, base: ImagePlane, count: number) {
  const planes = Array.from({ length: count }, (_, index) => framePlane(dataSet, base, index));
  const first = planes[0];
  const orientationVaried = !!first && planes.some(plane =>
    !directionMatches(plane.imageOrientationPatient, first.imageOrientationPatient));
  const unavailable = planes.some(plane => plane.hasMissingGeometry);
  // 同一空间位置重复可能代表时间维，不能把 Cine/多时相强行拼成空间体积。
  const uniquePositions = new Set(planes.map(plane => plane.imagePositionPatient.join(',')));
  const only2D = unavailable || orientationVaried || uniquePositions.size !== count;
  return {
    planes: planes.map(plane => ({ ...plane, isMultiframe2D: only2D })),
    unavailable, orientationVaried,
  };
}
