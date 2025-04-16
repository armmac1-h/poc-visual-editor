import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error No type definitions for JS file
import inlineEditPlugin from './vite-inline-edit-plugin.js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    inlineEditPlugin(),
    react()
  ],
  server: {
    port: parseInt(process.env.VITE_PORT || '5173'),
    strictPort: false,
    host: true
  }
})
