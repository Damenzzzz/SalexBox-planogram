import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// IR-сервис SalesBox (uv run salesbox-api) слушает 127.0.0.1:8000; прокси убирает CORS при разработке
const IR = process.env.SALESBOX_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/v1': { target: IR, changeOrigin: true },
      '/readyz': { target: IR, changeOrigin: true },
    },
  },
})
