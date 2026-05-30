import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      // Don't let the SW intercept WebLLM's own cache writes (model weights go to
      // IndexedDB / Cache Storage managed by WebLLM — SW shouldn't touch those).
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB limit for build assets
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
      manifest: {
        name: 'TreePlot Assistant',
        short_name: 'TreePlot',
        description: 'Forestry field measurement assistant',
        theme_color: '#020915',
        background_color: '#020915',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'tree-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'tree-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    https: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    exclude: ['@mlc-ai/web-llm'],
  },
})
