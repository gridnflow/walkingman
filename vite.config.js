import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 61235,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        overlay: 'overlay.html',
      },
    },
  },
});
