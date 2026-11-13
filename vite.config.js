import { defineConfig } from 'vite';

export default defineConfig({
  // three.js (the 3D globes) makes the bundle ~650 kB; that's expected.
  build: { chunkSizeWarningLimit: 800 },
  // Faster start in development: bundle the big libraries up front instead of
  // discovering them on the first page load, and prepare the app's files as soon
  // as the server starts.
  optimizeDeps: { include: ['three', 'leaflet'] },
  server: { warmup: { clientFiles: ['./src/main.js'] } },
});
