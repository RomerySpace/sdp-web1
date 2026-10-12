import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: Number(process.env.SDP_WEB_PORT || 5173),
    strictPort: true,
    https: process.env.SDP_LAN === '1' ? {
      cert: readFileSync(new URL('./.local/https.pem', import.meta.url)),
      key: readFileSync(new URL('./.local/https-key.pem', import.meta.url)),
    } : undefined,
    proxy: {
      '/multiplayer': {
        target: `http://127.0.0.1:${process.env.SDP_BACKEND_PORT || 2567}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/multiplayer/, ''),
      },
      '/voice': {
        target: `http://127.0.0.1:${process.env.SDP_LIVEKIT_PORT || 7880}`,
        ws: true,
        rewrite: (path) => path.replace(/^\/voice/, ''),
      },
    },
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/.local/**', '**/server/**'] },
  },
  // Skip the optional request entirely when the asset is absent. Restart Vite
  // after adding ambient.mp3 so this flag is refreshed (also evaluated at build).
  define: {
    __HAS_AMBIENT_AUDIO__: JSON.stringify(
      existsSync(fileURLToPath(new URL('./public/audio/ambient.mp3', import.meta.url))),
    ),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('three/examples/jsm/loaders/GLTFLoader.js')) return 'model-loader';
          if (id.includes('node_modules/three') && !id.includes('/examples/')) return 'three';
          if (id.includes('node_modules/@dimforge/rapier3d-compat')) return 'shooter-physics';
        },
      },
    },
  },
});
