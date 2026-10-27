import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  publicDir: false,
  resolve: { dedupe: ['vue'] },
  server: {
    host: '127.0.0.1',
    fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))], deny: ['**/events/judging/**', '**/.env*', '**/.git/**', '**/repo-reference/**'] },
    watch: { ignored: ['**/events/**', '**/repo-reference/**', '**/.wrangler/**', '**/.output/**', '**/.nuxt/**'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
