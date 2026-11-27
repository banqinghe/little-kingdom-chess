import { defineConfig } from 'vite';

// relative asset paths, so the build runs from any sub-path; three.js alone is about 1 MB
export default defineConfig({ base: './', worker: { format: 'es' }, build: { target: 'es2022', chunkSizeWarningLimit: 1500 } });
