import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createReadStream, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** 示例 DICOM 的唯一真源：仓库根目录 sample-dicom/（不外拷，避免两份漂移） */
const SAMPLE_ROOT = resolve(here, '../../sample-dicom');
const URL_PREFIX = '/samples';

interface SampleDatasetMeta {
  readonly id: string;
  readonly modality: string;
  readonly files: readonly string[];
}

/**
 * 扫描 sample-dicom/ 生成清单。
 *
 * 为什么需要清单：浏览器不能列目录，而真实数据集的文件名不规律
 * （brain-mr 下是 000018.dcm 这类），不能像以前那样拼 `0000NN.dcm`。
 */
function buildManifest(): { datasets: SampleDatasetMeta[] } {
  if (!existsSync(SAMPLE_ROOT)) return { datasets: [] };
  const datasets = readdirSync(SAMPLE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const dir = join(SAMPLE_ROOT, entry.name);
      const files = readdirSync(dir)
        .filter((f) => !f.startsWith('.') && f.toLowerCase().endsWith('.dcm'))
        .sort();
      const modality = entry.name.startsWith('brain')
        ? 'MR'
        : entry.name.startsWith('ct')
          ? 'CT'
          : 'OT';
      return { id: entry.name, modality, files };
    })
    .filter((dataset) => dataset.files.length > 0);

  return { datasets };
}

function sendJson(res: Parameters<Connect.NextHandleFunction>[1], body: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const serveSamples: Connect.NextHandleFunction = (req, res, next) => {
  const rawUrl = (req.url ?? '').split('?')[0] ?? '';
  const rel = decodeURIComponent(rawUrl.replace(/^\//, ''));

  if (rel === '' || rel === 'manifest.json') {
    sendJson(res, buildManifest());
    return;
  }

  // 防路径穿越：不允许 .. 与绝对路径
  if (rel.includes('..') || rel.startsWith('/')) {
    res.statusCode = 400;
    res.end('bad path');
    return;
  }

  const filePath = resolve(SAMPLE_ROOT, rel);
  if (!filePath.startsWith(SAMPLE_ROOT) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    next();
    return;
  }

  res.setHeader('Content-Type', 'application/dicom');
  res.setHeader('Cache-Control', 'no-cache');
  createReadStream(filePath).pipe(res);
};

/**
 * 示例 DICOM 服务：dev / preview 走中间件，build 时复制到 dist。
 * 这样仓库里只有一份数据，public/ 不再需要副本。
 */
function sampleDicomPlugin(): Plugin {
  let outDir: string;
  const mount = (middlewares: Connect.Server): void => {
    middlewares.use(URL_PREFIX, serveSamples);
  };

  return {
    name: 'odv-sample-dicom',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
    generateBundle() {
      // 静态托管没有 dev/preview 中间件，必须随产物提供同一份清单。
      this.emitFile({
        type: 'asset',
        fileName: 'samples/manifest.json',
        source: JSON.stringify(buildManifest()),
      });
    },
    closeBundle() {
      if (!existsSync(SAMPLE_ROOT)) {
        this.warn('未找到 sample-dicom/，构建产物将不含示例数据');
        return;
      }
      const target = resolve(outDir, 'samples');
      cpSync(SAMPLE_ROOT, target, { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), sampleDicomPlugin()],
  server: {
    port: 3000,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      treeshake: {
        moduleSideEffects: true,
      },
    },
  },
  optimizeDeps: {
    include: ['@cornerstonejs/core'],
  },
  worker: {
    format: 'es',
  },
});
