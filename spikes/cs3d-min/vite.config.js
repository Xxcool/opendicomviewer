import { defineConfig } from 'vite';

export default defineConfig({
  // 相对 base：验证"非根路径部署"时 CS3D 的 wasm / worker URL 是否仍然正确
  base: './',
  server: { port: 4319, strictPort: true },
  preview: { port: 4319, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    /**
     * vtk.js 36 内部存在 ESM 循环 + 依赖模块级副作用建立类继承链，
     * Rollup 默认摇树会把"看起来无副作用"的初始化丢掉，运行时表现为
     * "Class extends value undefined"。强制保留模块副作用。
     */
    rollupOptions: { treeshake: { moduleSideEffects: true } },
  },
  /**
   * CS3D + Vite 的两个坑（本 spike 实测得到，写进结论）：
   *
   * 1. `@cornerstonejs/dicom-image-loader` 必须**排除预打包**：
   *    esbuild 把它压成单 chunk 后，内部 ESM 循环依赖会变成
   *    "Class extends value undefined is not a constructor"（实测发生在 deps chunk）。
   * 2. `dicom-parser` 是 CJS，必须**显式 include** 走预打包：
   *    否则浏览器按原生 ESM 加载会报
   *    "does not provide an export named 'default'"。
   *
   * 注意：`@cornerstonejs/core` 不能一起 exclude——它经 vtk.js 依赖若干 CJS 包，
   * 排除后会触发同样的 CJS interop 错误。
   */
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: [
      'dicom-parser',
      // 必须写到 **子路径** 级别：loader 实际 import 的是 `.../decodewasmjs`，
      // 只写包名不会命中，浏览器仍会按原生 ESM 加载 CJS 工厂函数并报
      // "does not provide an export named 'default'"。
      '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasmjs',
      '@cornerstonejs/codec-charls/decodewasmjs',
      '@cornerstonejs/codec-openjpeg/decodewasmjs',
      '@cornerstonejs/codec-libjxl/decodewasmjs',
      '@cornerstonejs/codec-openjph/wasmjs',
      'jpeg-lossless-decoder-js',
    ],
  },
  // dicom-image-loader 的解码 worker 是 `type: 'module'`，构建时也要保持 ESM
  worker: { format: 'es' },
});
