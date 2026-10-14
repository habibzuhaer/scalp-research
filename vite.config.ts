import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        react: resolve(__dirname, 'react.html'),
      },
    },
  },
  server: {
    open: '/react.html',
  },
})
