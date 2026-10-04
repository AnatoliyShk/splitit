import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000',
        // Keep the browser's Host header so Django's ALLOWED_HOSTS/CSRF checks see localhost
        changeOrigin: false,
      },
      // Uploaded images (occasion photos), served by Django in development
      '/media': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: false,
      },
    },
  },
})
