import type { ImportOutcome } from '@opendicomviewer/core';
import { WarningIcon } from './Icons';

interface ImportFailuresDialogProps {
  readonly outcome: ImportOutcome;
  readonly onConfirm: () => void;
}

/** 列表最多展示条数：再长就靠滚动，避免模态撑满整屏 */
const MAX_VISIBLE_ROWS = 8;

/**
 * 部分失败汇总（docs/design/ui-spec.md §5）
 *
 * 为什么必须拦一道：probe 静默吞掉失败文件时，用户只会看到"导入了 35 层"，
 * 不知道少了哪 1 个、为什么少——这是 R7 明令禁止的静默失效。
 */
export function ImportFailuresDialog({
  outcome,
  onConfirm,
}: ImportFailuresDialogProps) {
  const { succeeded, failures } = outcome;
  const hiddenCount = Math.max(0, failures.length - MAX_VISIBLE_ROWS);

  return (
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="odv-import-failure-title"
    >
      <div className="w-full max-w-lg bg-[#121826] border border-amber-700/60 rounded-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-700/70 flex items-start space-x-2.5">
          <WarningIcon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2
              id="odv-import-failure-title"
              className="text-sm font-semibold text-gray-100"
            >
              部分文件未能导入
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              成功 {succeeded} 个 · 失败 {failures.length} 个
            </p>
          </div>
        </div>

        <div className="px-5 py-3 max-h-64 overflow-y-auto">
          <ul className="space-y-1.5">
            {failures.slice(0, MAX_VISIBLE_ROWS).map((f) => (
              <li
                key={f.id}
                className="flex flex-col px-2.5 py-1.5 rounded bg-gray-800/50 border border-gray-700/50"
              >
                <span
                  className="text-xs text-gray-200 font-mono truncate"
                  title={f.name}
                >
                  {f.name}
                </span>
                <span className="text-[11px] text-gray-400 mt-0.5">
                  {f.reason}
                </span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && (
            <p className="text-[11px] text-gray-500 mt-2">
              另有 {hiddenCount} 个失败文件未列出
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-700/70 flex items-center justify-between">
          <p className="text-[11px] text-gray-500 pr-4">
            失败文件不会被载入，也不影响已成功部分的显示。
          </p>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="shrink-0 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-medium transition cursor-pointer shadow"
          >
            仅载入成功的 {succeeded} 个
          </button>
        </div>
      </div>
    </div>
  );
}
