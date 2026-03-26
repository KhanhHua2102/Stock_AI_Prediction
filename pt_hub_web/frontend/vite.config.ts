import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Read API key from .env for dev proxy
const projectRoot = path.resolve(__dirname, '../..')
let apiKey = ''
try {
  const envContent = fs.readFileSync(path.join(projectRoot, '.env'), 'utf-8')
  const match = envContent.match(/^PT_API_KEY=(.+)$/m)
  if (match) apiKey = match[1].trim()
} catch {
  console.warn('No .env file found — API requests will fail auth')
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
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        headers: { 'X-API-Key': apiKey },
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
      },
    },
  },
})
