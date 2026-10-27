/**
 * CT Phantom 物理密度基准断言工具（测试与验证专用辅助函数）(N7)
 *
 * 遵循 GEMINI.md 5.2：
 * 断言水 ∈ [-5, 5] HU、空气 ∈ [-1050, -950] HU、皮质骨 > 300 HU。
 */

export interface PhantomAssertionResult {
  readonly pass: boolean;
  readonly reasons: readonly string[];
}

export function assertPhantomHU(
  waterHU: number,
  airHU: number,
  boneHU: number,
): PhantomAssertionResult {
  const reasons: string[] = [];
  if (waterHU < -5 || waterHU > 5) {
    reasons.push(`水密度偏差：当前 ${waterHU.toFixed(1)} HU 不在 [-5, 5] 范围内`);
  }
  if (airHU < -1050 || airHU > -950) {
    reasons.push(`空气密度偏差：当前 ${airHU.toFixed(1)} HU 不在 [-1050, -950] 范围内`);
  }
  if (boneHU <= 300) {
    reasons.push(`骨密度偏差：当前 ${boneHU.toFixed(1)} HU 未超过 300 HU 基线`);
  }
  return {
    pass: reasons.length === 0,
    reasons,
  };
}
