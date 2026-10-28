/**
 * 导入流程（唯一入口）
 *
 * 顶栏「打开文件/文件夹」、视口拖拽、示例数据三条入口原先各写一份
 * probe → 打开首序列；其中顶栏那条绕过了 `importOutcome()`，
 * 部分失败被静默吞掉（违反 R7）。现在三条入口共用本 hook，
 * `App` 只负责渲染状态与确认弹窗。
 */

import { useCallback, useRef, useState } from 'react';
import type {
  DataSourcePort,
  ImportCandidate,
  ImportOutcome,
  StudyMeta,
} from '@opendicomviewer/core';
import { loadSampleCandidates } from './bridge/sample-loader';
import { useViewerStore } from './state/viewer-store';

export interface ImportFlow {
  /** 部分失败汇总；非空时调用方需先让用户确认再载入成功部分 */
  readonly pendingFailures: ImportOutcome | null;
  readonly importCandidates: (
    candidates: readonly ImportCandidate[],
  ) => Promise<void>;
  readonly loadSample: (datasetId?: string) => Promise<void>;
  readonly cancel: () => void;
  readonly confirmPendingFailures: () => void;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function useImportFlow(dataSource: DataSourcePort): ImportFlow {
  const [pendingFailures, setPendingFailures] = useState<ImportOutcome | null>(
    null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const { setImportStatus, setStudies, setActiveSeries } = useViewerStore();

  /** 载入首个 Study 的首个序列（导入成功后与「仅载入成功的 n 个」共用） */
  const openFirstSeries = useCallback(
    async (
      studies: readonly StudyMeta[],
      signal?: AbortSignal,
    ): Promise<void> => {
      const firstStudy = studies[0];
      if (!firstStudy) return;

      const seriesList = await dataSource.listSeries(
        firstStudy.studyInstanceUid,
      );
      const firstSeries = seriesList[0];
      if (!firstSeries) return;

      const handle = await dataSource.openSeries(
        {
          studyInstanceUid: firstStudy.studyInstanceUid,
          seriesInstanceUid: firstSeries.seriesInstanceUid,
        },
        signal,
      );
      setActiveSeries(handle);
    },
    [dataSource, setActiveSeries],
  );

  const importCandidates = useCallback(
    async (candidates: readonly ImportCandidate[]): Promise<void> => {
      if (candidates.length === 0) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setImportStatus({
        loading: true,
        message: `正在解析 ${candidates.length} 个候选文件...`,
      });

      try {
        const studies = await dataSource.probe(
          { files: candidates },
          controller.signal,
        );

        if (studies.length === 0) {
          const outcome = dataSource.importOutcome();
          const hint =
            outcome.failures.length > 0
              ? `其中 ${outcome.failures.length} 个文件解析失败（如 ${outcome.failures[0]?.name ?? '未知文件'}）。`
              : '';
          setImportStatus({
            loading: false,
            error: `未发现有效的 DICOM 影像文件。${hint}`,
          });
          return;
        }

        setStudies(studies);

        // R7：部分失败不能只丢一句"1 个文件失败"，必须让用户看见少了哪些、为什么
        const outcome = dataSource.importOutcome();
        if (outcome.failures.length > 0) {
          setPendingFailures(outcome);
          setImportStatus({ loading: false });
          return;
        }

        await openFirstSeries(studies, controller.signal);
        setImportStatus({ loading: false });
      } catch (err: unknown) {
        if (isAbortError(err)) {
          setImportStatus({ loading: false });
          return;
        }
        setImportStatus({
          loading: false,
          error: `解析失败: ${describeError(err)}`,
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [dataSource, openFirstSeries, setImportStatus, setStudies],
  );

  const loadSample = useCallback(
    async (datasetId?: string): Promise<void> => {
      setImportStatus({
        loading: true,
        message: datasetId
          ? `正在加载示例数据集 ${datasetId}...`
          : '正在加载示例数据集（MR + CT）...',
      });
      try {
        const candidates = await loadSampleCandidates(datasetId);
        await importCandidates(candidates);
      } catch (err: unknown) {
        setImportStatus({
          loading: false,
          error: `加载示例失败: ${describeError(err)}`,
        });
      }
    },
    [importCandidates, setImportStatus],
  );

  const cancel = useCallback(() => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort();
    setImportStatus({ loading: false, message: undefined });
  }, [setImportStatus]);

  const confirmPendingFailures = useCallback(() => {
    const studies = useViewerStore.getState().studies;
    setPendingFailures(null);
    if (studies.length === 0) return;

    void openFirstSeries(studies).catch((err: unknown) => {
      setImportStatus({
        loading: false,
        error: `打开首个序列失败: ${describeError(err)}`,
      });
    });
  }, [openFirstSeries, setImportStatus]);

  return {
    pendingFailures,
    importCandidates,
    loadSample,
    cancel,
    confirmPendingFailures,
  };
}
