import test from 'node:test';
import assert from 'node:assert/strict';

// 向量运算逻辑
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function normalize(v) {
  const len = length(v);
  if (len < 1e-9) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function computeNormal(iop) {
  const rowDir = [iop[0], iop[1], iop[2]];
  const colDir = [iop[3], iop[4], iop[5]];
  return normalize(cross(rowDir, colDir));
}

function computeMedian(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function sortByPosition(planes) {
  if (planes.length <= 1) {
    return { sortedPlanes: planes, warnings: [] };
  }
  const baseNormal = computeNormal(planes[0].imageOrientationPatient);
  const warnings = [];

  const projectables = planes.map((plane, index) => {
    const proj = dot(plane.imagePositionPatient, baseNormal);
    return { plane, projection: proj, instance: plane.instanceNumber ?? index };
  });

  projectables.sort((a, b) => {
    const diff = a.projection - b.projection;
    if (Math.abs(diff) > 1e-4) return diff;
    return a.instance - b.instance;
  });

  const sortedPlanes = projectables.map(p => p.plane);
  const sliceDistances = [];
  for (let i = 0; i < projectables.length - 1; i++) {
    sliceDistances.push(Math.abs(projectables[i + 1].projection - projectables[i].projection));
  }

  const medianSpacing = computeMedian(sliceDistances);
  if (medianSpacing > 1e-4) {
    for (let i = 0; i < sliceDistances.length; i++) {
      const dist = sliceDistances[i];
      if (dist > 1.5 * medianSpacing) {
        warnings.push({
          code: 'SLICE_GAP',
          message: `切片第 ${i + 1} 层与第 ${i + 2} 层之间存在疑似缺层`,
          actualDistance: dist,
          medianSpacing,
        });
      }
    }
  }

  return { sortedPlanes, warnings, medianSpacing };
}

function rawToHU(pixel, slope = 1.0, intercept = 0.0) {
  return pixel * slope + intercept;
}

function assertPhantomHU(waterHU, airHU, boneHU) {
  const pass = waterHU >= -5 && waterHU <= 5 && airHU >= -1050 && airHU <= -950 && boneHU > 300;
  return { pass };
}

test('R3 验证：严禁用 InstanceNumber 排序，必须以 IPP 投影物理坐标为准', () => {
  // 模拟医院光盘中 InstanceNumber 混乱颠倒的情况
  const axialIOP = [1, 0, 0, 0, 1, 0]; // 轴面法向为 [0, 0, 1]
  const mockPlanes = [
    { imageId: 'slice-3', instanceNumber: 999, imagePositionPatient: [0, 0, 30], imageOrientationPatient: axialIOP },
    { imageId: 'slice-1', instanceNumber: 100, imagePositionPatient: [0, 0, 10], imageOrientationPatient: axialIOP },
    { imageId: 'slice-2', instanceNumber: 5,   imagePositionPatient: [0, 0, 20], imageOrientationPatient: axialIOP },
  ];

  const result = sortByPosition(mockPlanes);
  assert.equal(result.sortedPlanes[0].imageId, 'slice-1');
  assert.equal(result.sortedPlanes[1].imageId, 'slice-2');
  assert.equal(result.sortedPlanes[2].imageId, 'slice-3');
  assert.equal(result.warnings.length, 0);
});

test('R7 验证：缺层检测当相邻层间距 > 1.5 倍中位数时间必须产生告警', () => {
  const axialIOP = [1, 0, 0, 0, 1, 0];
  const mockPlanes = [
    { imageId: 'slice-1', instanceNumber: 1, imagePositionPatient: [0, 0, 0], imageOrientationPatient: axialIOP },
    { imageId: 'slice-2', instanceNumber: 2, imagePositionPatient: [0, 0, 2], imageOrientationPatient: axialIOP },
    { imageId: 'slice-3', instanceNumber: 3, imagePositionPatient: [0, 0, 4], imageOrientationPatient: axialIOP },
    // 此处缺层：跳过了 6，直接到了 10（间距 6mm，中位数为 2mm，6 > 1.5 * 2）
    { imageId: 'slice-4', instanceNumber: 4, imagePositionPatient: [0, 0, 10], imageOrientationPatient: axialIOP },
    { imageId: 'slice-5', instanceNumber: 5, imagePositionPatient: [0, 0, 12], imageOrientationPatient: axialIOP },
  ];

  const result = sortByPosition(mockPlanes);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, 'SLICE_GAP');
  assert.equal(result.warnings[0].actualDistance, 6);
});

test('5.2 灰度换算验证：CT Phantom 物理密度基准断言', () => {
  // 水: 1024 * 1 - 1024 = 0 HU
  const water = rawToHU(1024, 1.0, -1024.0);
  // 空气: 24 * 1 - 1024 = -1000 HU
  const air = rawToHU(24, 1.0, -1024.0);
  // 骨: 1524 * 1 - 1024 = 500 HU
  const bone = rawToHU(1524, 1.0, -1024.0);

  assert.equal(water, 0);
  assert.equal(air, -1000);
  assert.equal(bone, 500);

  const assertion = assertPhantomHU(water, air, bone);
  assert.equal(assertion.pass, true);
});
