import { defineConfig } from 'vite';

export default defineConfig({
  // Указываем, что проект стартует из src/demo
  root: 'src/demo',
  publicDir: 'public',

  // !!! ВАЖНО для GitHub Pages !!!
  // Если репозиторий называется sankey-ts, base = '/sankey-ts/'
  base: '/sankey-ts/',

  build: {
    outDir: '../../dist',   // итоговая папка сборки
    emptyOutDir: true
  },

  server: {
    open: true
  }
});
