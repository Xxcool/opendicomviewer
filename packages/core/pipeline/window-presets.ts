import type { PixelFrame, SeriesMeta, VOIRange } from '../domain/types';
import { rawToHU } from './lut';

export type BodyPartGroup = '胸部' | '头颅' | '腹部' | '四肢' | '脊柱' | '未识别';
export interface WindowPreset { readonly name: string; readonly en: string; readonly voi: VOIRange }
const preset = (name: string, en: string, windowWidth: number, windowCenter: number): WindowPreset =>
  ({ name, en, voi: { windowWidth, windowCenter } });
const bone = preset('骨窗', 'Bone', 2000, 400);
const soft = preset('软组织', 'Soft Tissue', 400, 40);
const lung = preset('肺窗', 'Lung', 1500, -600);
/** 数值来自既定 ui-spec §3.3；仅供 CT 显示。 */
export const WINDOW_PRESETS_BY_BODYPART: Readonly<Record<BodyPartGroup, readonly WindowPreset[]>> = {
  胸部: [lung, preset('纵隔', 'Mediastinum', 350, 40), bone],
  头颅: [preset('脑窗', 'Brain', 80, 40), bone, preset('卒中窗', 'Stroke', 30, 30)],
  腹部: [preset('腹窗', 'Abdomen', 400, 50), preset('肝窗', 'Liver', 150, 30), bone],
  四肢: [bone, soft, preset('关节', 'Joint', 1200, 300)],
  脊柱: [bone, soft, preset('椎间盘', 'Disc', 500, 50)],
  未识别: [bone, soft, lung],
};
export function normalizeBodyPart(value?: string): BodyPartGroup {
  const key = value?.trim().toUpperCase().replace(/[ _-]/g, '') ?? '';
  if (['CHEST', 'THORAX'].includes(key)) return '胸部';
  if (['HEAD', 'BRAIN', 'SKULL'].includes(key)) return '头颅';
  if (['ABDOMEN', 'LIVER'].includes(key)) return '腹部';
  if (['SPINE', 'CSPINE', 'TSPINE', 'LSPINE'].includes(key)) return '脊柱';
  if (['EXTREMITY', 'EXTREMITIES', 'ARM', 'LEG', 'HAND', 'FOOT', 'KNEE', 'ANKLE', 'SHOULDER', 'ELBOW', 'WRIST', 'HIP', 'FEMUR', 'HUMERUS'].includes(key)) return '四肢';
  return '未识别';
}
export function getWindowPresets(meta?: SeriesMeta): readonly WindowPreset[] {
  return meta?.modality === 'CT' ? WINDOW_PRESETS_BY_BODYPART[normalizeBodyPart(meta.planes[0]?.bodyPartExamined)] : [];
}
/** 物理强度域估算；优先标签窗，分位塌缩才使用全范围。原始像素不变。 */
export function pickAdaptiveVOI(frame: PixelFrame): { voi: VOIRange; estimated: boolean } {
  const voi = frame.defaultVOI;
  if (voi && Number.isFinite(voi.windowWidth) && voi.windowWidth >= 1 && Number.isFinite(voi.windowCenter)) {
    return { voi, estimated: false };
  }
  const values = Array.from(frame.pixelData, value => rawToHU(value, frame.rescaleSlope, frame.rescaleIntercept, frame.modalityLUT))
    .filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) throw new Error('没有有效像素，无法估算自动窗');
  let low = values[Math.floor(values.length * 0.02)]!;
  let high = values[Math.ceil(values.length * 0.98) - 1]!;
  if (high <= low) { low = values[0]!; high = values[values.length - 1]!; }
  return { voi: { windowWidth: Math.max(1, high - low + 1), windowCenter: (low + high + 1) / 2 }, estimated: true };
}
