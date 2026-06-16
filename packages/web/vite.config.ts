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
 * scans `src/**/*.{ts,tsx}` and emits the utility CSS imported by
 * `src/index.css`).
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
