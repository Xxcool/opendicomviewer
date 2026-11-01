import { defineConfig, mergeConfig } from 'vite';
import webConfig from '../app-web/vite.config';

/** 同一套 UI/Worker/样本打包规则；桌面只替换组合根和宿主读取方式。 */
export default mergeConfig(webConfig, defineConfig({
  publicDir: '../app-web/public',
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5174, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15' },
}));
