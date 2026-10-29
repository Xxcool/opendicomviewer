import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../vite.config';
import type { SampleManifest } from '../src/bridge/sample-loader';

describe('示例数据静态构建', () => {
  it('实际输出目录包含清单及其引用的全部 DICOM 文件，无需 preview 中间件', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'odv-sample-build-')));
    try {
      await writeFile(join(root, 'index.html'), '<!doctype html><title>sample build</title>');
      const outDir = join(root, 'static-site');
      await build({
        ...config,
        configFile: false,
        root,
        logLevel: 'silent',
        build: { outDir },
      });

      // 只读取产物，防止开发服务器动态生成清单而掩盖发布文件缺失。
      const manifest: SampleManifest = JSON.parse(
        await readFile(join(outDir, 'samples/manifest.json'), 'utf8'),
      );
      expect(manifest.datasets.map((dataset) => dataset.id)).toEqual(
        expect.arrayContaining(['brain-mr', 'ct-body']),
      );
      for (const dataset of manifest.datasets) {
        expect(dataset.files.length).toBeGreaterThan(0);
        for (const file of dataset.files) {
          const bytes = await readFile(join(outDir, 'samples', dataset.id, file));
          expect(bytes.subarray(128, 132).toString('ascii')).toBe('DICM');
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
