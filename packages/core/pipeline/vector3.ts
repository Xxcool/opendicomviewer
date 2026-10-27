/**
 * 纯 3D 向量运算工具（纯数学计算，无外部依赖）
 */

export type Vec3 = readonly [number, number, number];

export function sub(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lengthSq(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

export function length(v: Vec3): number {
  return Math.sqrt(lengthSq(v));
}

export function normalize(v: Vec3): [number, number, number] {
  const len = length(v);
  if (len < 1e-9) {
    return [0, 0, 0];
  }
  const inv = 1 / len;
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}
