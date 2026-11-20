import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives at the root of its own domain: push subscriptions are bound to the origin,
// so it must not move after the first real subscriber.
export default defineConfig({
  plugins: [react()],
  base: '/',
  // Local runs serve the api on the same origin: /auth (sign-in) and /api (everything else, admin included).
  server: { port: 5173, strictPort: true, proxy: { '/auth': process.env.API_PROXY ?? 'http://localhost:8787', '/api': process.env.API_PROXY ?? 'http://localhost:8787' } },
  preview: { port: 5173, strictPort: true, proxy: { '/auth': process.env.API_PROXY ?? 'http://localhost:8787', '/api': process.env.API_PROXY ?? 'http://localhost:8787' } },
});
