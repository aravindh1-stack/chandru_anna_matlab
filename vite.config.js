import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import app from './server/index.js'

let apiServer

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'auto-start-api',
      configureServer() {
        if (!apiServer) {
          apiServer = app.listen(4000, () => {
            console.log('ThingSpeak proxy API running on http://localhost:4000')
          })
        }
      },
      closeBundle() {
        if (apiServer) {
          apiServer.close()
          apiServer = undefined
        }
      },
    },
  ],
  build: {
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
