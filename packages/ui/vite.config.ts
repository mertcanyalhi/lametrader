import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite build/dev config for the web driving adapter.
 *
 * Vite owns the web build (the root `tsc --build` graph covers only the Node
 * packages); web type-checking runs separately via this package's `typecheck`.
 *
 * Plugins: React (Fast Refresh + JSX), Tailwind CSS v4 (`@tailwindcss/vite`
 * scans the `src` tree for `.ts` / `.tsx` files and emits the utility CSS
 * imported by `src/index.css`).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ponytail: dev-only proxy so `/api/*` (and WS upgrades) hit the API on :3000
  // instead of returning index.html. Override the target via VITE_API_TARGET.
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
