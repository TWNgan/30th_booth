import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    // The MediaPipe wasm runtime is vendored in /public, so nothing large is
    // pulled through the bundler. Keep chunks readable for booth debugging.
    chunkSizeWarningLimit: 1500,
  },
});
