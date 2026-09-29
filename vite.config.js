import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // TODO: replace with your own backend URL
        target: 'https://agadahealth.vercel.app',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
