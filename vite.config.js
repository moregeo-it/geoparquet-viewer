import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
    // See https://github.com/vitejs/vite/discussions/14801#discussioncomment-15550931 for details
    include: [
      'vuetify',
    ],
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@duckdb/duckdb-wasm')) return 'duckdb';
          if (id.includes('@deck.gl/')) return 'deckgl';
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('vuetify')) return 'vuetify';
        },
      },
    },
  },
})
