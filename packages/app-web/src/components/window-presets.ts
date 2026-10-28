import type { VOIRange } from '@opendicomviewer/core';

/**
 * 窗宽窗位预设的单一真源。
 *
 * 底栏 chip、快捷键 1-5、设置面板的预设画廊都读这一份，
 * 避免三处各写一套数值后出现「设置里显示 1500，实际点下去是别的值」。
 *
 * Phase 2 将按 BodyPartExamined 分组并从 core 层读取，这里先保持 5 个通用预设。
 */
export interface WindowPreset {
  readonly name: string;
  readonly en: string;
  readonly voi: VOIRange;
}

export const WINDOW_PRESETS: readonly WindowPreset[] = [
  { name: '肺窗', en: 'Lung', voi: { windowWidth: 1500, windowCenter: -600 } },
  { name: '纵隔', en: 'Mediastinum', voi: { windowWidth: 350, windowCenter: 40 } },
  { name: '骨窗', en: 'Bone', voi: { windowWidth: 2000, windowCenter: 350 } },
  { name: '脑窗', en: 'Brain', voi: { windowWidth: 80, windowCenter: 40 } },
  { name: '软组织', en: 'Soft Tissue', voi: { windowWidth: 400, windowCenter: 40 } },
];
