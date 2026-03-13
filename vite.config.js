import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    cssCodeSplit: true,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          charting: ['recharts'],
          realtime: ['socket.io-client'],
          qrcode: ['qrcode.react'],
        },
      },
    },
  },
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
