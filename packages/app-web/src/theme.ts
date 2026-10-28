/**
 * 主题读写（docs/design/tokens.md §2）
 *
 * 硬约束：`<html data-theme="dark|light">`，**不跟随** `prefers-color-scheme`
 * ——阅片主机常年深色、教学投屏要浅色，与实际系统主题无关。
 *
 * 默认深色；持久化键 `odv.theme`；首屏写入由 index.html 的内联脚本完成，
 * 这里只负责运行期切换。
 */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'odv.theme';

/** 当前生效主题以 DOM 为准（内联脚本已写过），避免与 localStorage 读到的值不一致 */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式下写入失败不影响本次会话
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
