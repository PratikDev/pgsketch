import { resolve } from 'path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // core is TypeScript source in the workspace, so it is bundled into the main process
  main: { build: { externalizeDeps: { exclude: ['@pgsketch/core'] } } },
  // a sandboxed preload can't require packages, so zod is bundled into it
  preload: { build: { externalizeDeps: false } },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
