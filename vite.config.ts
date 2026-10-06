import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative asset paths: the build works at any URL, e.g. <user>.github.io/<repo>/
  base: './',
})
