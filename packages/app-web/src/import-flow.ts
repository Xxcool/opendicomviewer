/**
 * 导入流程（唯一入口）
 *
 * 顶栏「打开文件/文件夹」、视口拖拽、示例数据三条入口原先各写一份
 * probe → 打开首序列；其中顶栏那条绕过了 `importOutcome()`，
 * 部分失败被静默吞掉（违反 R7）。现在三条入口共用本 hook，
 * `App` 只负责渲染状态与确认弹窗。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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
      if (signal?.aborted) { handle.dispose(); signal.throwIfAborted(); }
      setActiveSeries(handle);
    },
    [dataSource, setActiveSeries],
  );

  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null; }, []);
  const runImport = useCallback(
    async (candidates: readonly ImportCandidate[], controller: AbortController): Promise<void> => {
      if (candidates.length === 0) throw new Error('未找到可导入的候选文件');

      if (controller.signal.aborted || abortRef.current !== controller) return;
      setImportStatus({
        loading: true,
        message: `正在解析 ${candidates.length} 个候选文件...`,
      });

      try {
        const studies = await dataSource.probe(
          { files: candidates, onProgress: progress => {
            if (abortRef.current === controller && !controller.signal.aborted) setImportStatus({ loading: true, message: progress.stage, progress });
          } },
          controller.signal,
        );

        if (abortRef.current !== controller || controller.signal.aborted) return;
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

        setImportStatus({ loading: true, message: '正在打开首个序列', progress: { stage: '构建原始影像序列' } });
        await openFirstSeries(studies, controller.signal);
        if (abortRef.current !== controller || controller.signal.aborted) return;
        setImportStatus({ loading: false });
      } catch (err: unknown) {
        if (abortRef.current !== controller) return;
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

  const begin = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setPendingFailures(null);
    return controller;
  }, []);
  const importCandidates = useCallback(async (candidates: readonly ImportCandidate[]) => {
    if (candidates.length) await runImport(candidates, begin());
  }, [runImport, begin]);
  const loadSample = useCallback(async (datasetId?: string): Promise<void> => {
    const controller = begin();
    setImportStatus({ loading: true, message: '正在读取示例清单', progress: { stage: '读取示例清单' } });
    try {
      const candidates = await loadSampleCandidates(datasetId, controller.signal, (completed, total) => {
        if (abortRef.current === controller && !controller.signal.aborted) setImportStatus({ loading: true,
          message: '正在加载示例文件', progress: { stage: '加载示例文件', completed, total } });
      });
      if (abortRef.current !== controller || controller.signal.aborted) return;
      await runImport(candidates, controller);
    } catch (err: unknown) {
      if (abortRef.current !== controller) return;
      setImportStatus(isAbortError(err) ? { loading: false } : { loading: false, error: `加载示例失败: ${describeError(err)}` });
    } finally { if (abortRef.current === controller) { controller.abort(); abortRef.current = null; } }
  }, [runImport, begin, setImportStatus]);

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
    const controller = begin();
    setImportStatus({ loading: true, message: '正在打开成功导入的序列', progress: { stage: '构建原始影像序列' } });
    void openFirstSeries(studies, controller.signal).then(() => {
      if (abortRef.current === controller && !controller.signal.aborted) setImportStatus({ loading: false });
    }).catch((err: unknown) => {
      if (abortRef.current !== controller) return;
      setImportStatus(isAbortError(err) ? { loading: false } : { loading: false, error: `打开首个序列失败: ${describeError(err)}` });
    }).finally(() => { if (abortRef.current === controller) abortRef.current = null; });
  }, [begin, openFirstSeries, setImportStatus]);

  return {
    pendingFailures,
    importCandidates,
    loadSample,
    cancel,
    confirmPendingFailures,
  };
}
