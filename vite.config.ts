import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/esoterica top photos/**', '**/brand assets - web photos/**', '**/feed/**', '**/.tmp/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        product: resolve(import.meta.dirname, 'product.html'),
        policies: resolve(import.meta.dirname, 'policies.html'),
        contact: resolve(import.meta.dirname, 'contact.html'),
      },
    },
  },
});
