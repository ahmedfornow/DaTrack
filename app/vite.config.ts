import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The rebuild owns the site root. The legacy app stays published at /legacy/ as
// a fallback until it is retired, and /next/ — the rebuild's old address —
// redirects here for anyone who installed the app from it.
const base = process.env.VITE_BASE ?? '/DaTrack/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
