import { defineConfig } from 'vite';

export default defineConfig({
  // main.js uses top-level await to load the real-world assets before the city
  // is generated. That needs a 2022 target; the browsers we support all have it.
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  build: {
    target: 'es2022',
    // Split the big third-party libraries out of the app bundle so a code
    // change doesn't force users to re-download Three.js (~500 kB).
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          socket: ['socket.io-client'],
        },
      },
    },
    // The three.js chunk is legitimately large; warn only above 600 kB.
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow the sandboxed preview host (and any tunnel) to load the app.
    // `true` disables Vite's host allowlist — fine for local development;
    // set an explicit list if you deploy this somewhere public.
    allowedHosts: true,
    // Also accept requests proxied from an https preview origin.
    cors: true,
    proxy: {
      // Forward API requests to the Express server
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Forward Socket.IO WebSocket + HTTP polling to the Express server
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
