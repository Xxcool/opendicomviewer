import { useEffect, useState } from 'react';
import { useViewerStore } from '../state/viewer-store';
import { MoonIcon, SettingsIcon, SunIcon } from './Icons';
import { WINDOW_PRESETS } from './window-presets';

interface SettingsDialogProps {
  readonly onClose: () => void;
}

type TabId = 'general' | 'display' | 'privacy' | 'about';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'general', label: '常规' },
  { id: 'display', label: '显示与预设' },
  { id: 'privacy', label: '数据与隐私' },
  { id: 'about', label: '关于' },
];

/**
 * 设置面板（docs/design/ui-spec.md §1：设置 = 静态面板）
 *
 * 结构对齐参考稿：左导航 + 右侧分页内容。只放**能确认为真**的项——
 * 主题切换、窗预设只读画廊、隐私口径、能力现状。不摆假开关：
 * 未实现的（脱敏、按部位分组）明确写"尚未实现"，而不是给个点了没反应的控件。
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { reset, studies, theme, setTheme } = useViewerStore();
  const [tab, setTab] = useState<TabId>('general');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-canvas/70 backdrop-blur-xs flex items-center justify-center z-50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-settings-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl h-[460px] max-h-[85vh] bg-elevated border border-line rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-4 h-12 shrink-0 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SettingsIcon className="w-4 h-4 text-accent" />
            <h2 id="odv-settings-title" className="text-sm font-semibold text-txt">
              设置
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭设置"
            className="px-2 py-1 rounded-sm text-txt-dim hover:text-txt hover:bg-hover text-xs transition cursor-pointer"
          >
            关闭
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 左导航 */}
          <nav className="w-40 shrink-0 border-r border-line p-2 flex flex-col gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={`text-left px-2.5 py-1.5 rounded-sm text-[12px] transition cursor-pointer ${
                  tab === t.id
                    ? 'bg-accent/10 text-txt font-medium'
                    : 'text-txt-dim hover:text-txt hover:bg-hover'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* 右侧内容 */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 text-xs">
            {tab === 'general' && (
              <div className="space-y-4">
                <section className="space-y-2">
                  <h3 className="font-semibold text-txt-dim">主题</h3>
                  <div className="inline-flex p-0.5 rounded-md border border-line bg-panel">
                    {(['dark', 'light'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTheme(t)}
                        aria-pressed={theme === t}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-sm text-[12px] transition cursor-pointer ${
                          theme === t
                            ? 'bg-hover text-txt font-medium'
                            : 'text-txt-dim hover:text-txt'
                        }`}
                      >
                        {t === 'dark' ? (
                          <MoonIcon className="w-3.5 h-3.5" />
                        ) : (
                          <SunIcon className="w-3.5 h-3.5" />
                        )}
                        <span>{t === 'dark' ? '深色' : '浅色'}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-txt-muted leading-relaxed">
                    默认深色，不跟随系统主题；选择记在本机。
                  </p>
                </section>

                <section className="space-y-2 pt-3 border-t border-line">
                  <h3 className="font-semibold text-txt-dim">当前会话</h3>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-txt-muted text-[11px] leading-relaxed">
                      {studies.length > 0
                        ? `已载入 ${studies.length} 个检查，清空后需重新导入。`
                        : '当前没有载入任何影像。'}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        reset();
                        onClose();
                      }}
                      disabled={studies.length === 0}
                      className="shrink-0 px-3 py-1.5 rounded-md bg-danger hover:bg-danger/90 text-white text-[11px] font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      清空当前会话
                    </button>
                  </div>
                </section>
              </div>
            )}

            {tab === 'display' && (
              <div className="space-y-4">
                <section className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-semibold text-txt-dim">窗宽窗位预设</h3>
                    <span className="text-[10px] text-txt-muted font-mono">
                      快捷键 1–5
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {WINDOW_PRESETS.map((p, idx) => (
                      <div
                        key={p.name}
                        className="rounded-md border border-line bg-panel px-2.5 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-txt">
                            {p.name}
                          </span>
                          <span className="text-[10px] font-mono text-txt-muted">
                            {idx + 1}
                          </span>
                        </div>
                        <div className="text-[10px] text-txt-muted mt-0.5">
                          {p.en}
                        </div>
                        <div className="text-[11px] font-mono text-txt-dim mt-1">
                          WW {p.voi.windowWidth} · WL {p.voi.windowCenter}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-txt-muted leading-relaxed">
                    当前为 5 个通用预设。按 BodyPartExamined 自动分组、以及「自动」预设，
                    尚未实现。
                  </p>
                </section>

                <section className="space-y-2 pt-3 border-t border-line">
                  <h3 className="font-semibold text-txt-dim">标尺与叠加</h3>
                  <p className="text-[11px] text-txt-muted leading-relaxed">
                    比例尺需要渲染器提供缩放与相机信息，当前端口未暴露，故未绘制；
                    四角患者信息、方位标记、层位置已开启。
                  </p>
                </section>
              </div>
            )}

            {tab === 'privacy' && (
              <div className="space-y-3">
                <h3 className="font-semibold text-txt-dim">数据与隐私</h3>
                <p className="text-txt-dim leading-relaxed">
                  所有影像仅在本地浏览器内存中处理，不上传、不落盘、不发起任何外部网络请求。
                </p>
                <p className="text-txt-dim leading-relaxed">
                  隐私状态：当前版本尚未实现脱敏判定，导入数据一律按「含身份信息」保守显示。
                </p>
                <p className="text-warn/90 leading-relaxed">
                  脱敏导出：尚未实现。导出前请自行确认数据合规。
                </p>
              </div>
            )}

            {tab === 'about' && (
              <div className="space-y-3">
                <h3 className="font-semibold text-txt-dim">关于</h3>
                <p className="text-txt-dim leading-relaxed">
                  OpenDicomViewer · Phase 1 MVP。仅供科研教学与影像分析参考。
                </p>
                <p className="text-txt-muted leading-relaxed">
                  渲染能力与不可用项见右栏「能力与降级」；测量值仅供参考，不构成诊断依据。
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
