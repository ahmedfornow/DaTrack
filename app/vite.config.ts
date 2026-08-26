import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The legacy app owns the site root until parity is proven, so the rebuild is
// published under /next/. Cutover is a one-line change here (or VITE_BASE in CI).
const base = process.env.VITE_BASE ?? '/DaTrack/next/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
