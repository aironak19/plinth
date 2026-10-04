import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Served from https://<user>.github.io/plinth/ in production; heavy modules
// (three.js, PDF, exporters) are code-split through dynamic imports.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/plinth/' : '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
}));
