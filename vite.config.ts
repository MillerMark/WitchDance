import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'

const commitHash = (() => {
  try {
    return execSync('git rev-list --count HEAD').toString().trim()
  } catch {
    return '0'
  }
})()

export default defineConfig({
  base: '/WitchDance/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'WitchDance',
        short_name: 'WitchDance',
        description: 'Crossfade music loop player',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        skipWaiting: true,
        clientsClaim: true,
      }
    })
  ],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
})
