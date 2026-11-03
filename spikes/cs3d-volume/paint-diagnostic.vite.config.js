import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default mergeConfig(base, defineConfig({
  build: {
    outDir: 'dist/paint-diagnostic',
    rollupOptions: { input: 'paint-diagnostic.html' },
  },
}));
