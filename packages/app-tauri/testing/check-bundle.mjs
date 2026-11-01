import { log } from 'node:console';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
for (const asset of ['sample-previews/brain-head-mr.png', 'sample-covers/reference.png', 'samples/manifest.json']) {
  if (!statSync(resolve(dist, asset)).isFile()) throw new Error(`桌面包缺少资源：${asset}`);
}
const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/href="([^"]+\.css)"/g)]
  .map(match => readFileSync(resolve(dist, match[1].replace(/^\.\//, '')), 'utf8')).join('\n');
for (const selector of ['.absolute{', '.flex{', '.h-screen{']) {
  if (!css.includes(selector)) throw new Error(`桌面包缺少共享布局样式：${selector}`);
}
log('桌面内嵌资源检查通过：共享布局、MR/CT 封面及样本清单齐全');
