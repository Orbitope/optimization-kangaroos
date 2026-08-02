import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'demo',
  server: { host: '127.0.0.1', port: 5173 },
  // The workspace deps are symlinks; Vite must not try to pre-bundle them as
  // opaque CommonJS or it serves a stale copy of the core.
  optimizeDeps: { exclude: ['@kangaroos/core', '@kangaroos/scene', '@contentkit/tokens'] },
})
