import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 4320, strictPort: true },
  preview: { port: 4320, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    // 同 Spike A：vtk.js 存在 ESM 循环 + 模块级副作用建立继承链，摇树会把它摇掉
    rollupOptions: { treeshake: { moduleSideEffects: true } },
  },
});
