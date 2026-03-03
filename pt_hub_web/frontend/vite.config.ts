import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Read API key from project root for dev proxy
const projectRoot = path.resolve(__dirname, '../..')
let apiKey = ''
try {
  apiKey = fs.readFileSync(path.join(projectRoot, '.api_key'), 'utf-8').trim()
} catch {
  console.warn('No .api_key file found — API requests will fail auth')
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 8081,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        headers: { 'X-API-Key': apiKey },
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
