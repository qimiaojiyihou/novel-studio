import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Electron loads the production entry through file://, so built assets must
  // stay relative to dist/index.html instead of resolving from /assets.
  base: './',
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
})
