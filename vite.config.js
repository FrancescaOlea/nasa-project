import { defineConfig } from 'vite';

export default defineConfig({
  // three.js (the 3D globes) makes the bundle ~630 kB; that's expected.
  build: { chunkSizeWarningLimit: 800 },
});
