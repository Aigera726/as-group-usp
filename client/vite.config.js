import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 9003,
    strictPort: true, // Чтобы он не прыгал на другие порты, если 8006 занят
  }
})
