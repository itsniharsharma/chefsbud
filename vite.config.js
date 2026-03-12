import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    allowedHosts: ['.ngrok-free.dev', '.ngrok.io', 'localhost', 'chefsbud.com', '.chefsbud.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    allowedHosts: ['chefsbud.com', 'www.chefsbud.com', 'localhost'],
  },
})
