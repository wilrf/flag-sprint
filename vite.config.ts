import { defineConfig } from 'vite';

// GitHub Pages serves the site from /flag-sprint/
export default defineConfig({
  base: '/flag-sprint/',
  build: { target: 'es2022' },
});
