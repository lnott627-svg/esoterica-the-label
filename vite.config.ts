import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    watch: {
      ignored: ['**/esoterica top photos/**', '**/brand assets - web photos/**', '**/feed/**', '**/.tmp/**', '**/data/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        product: resolve(import.meta.dirname, 'product.html'),
        policies: resolve(import.meta.dirname, 'policies.html'),
        contact: resolve(import.meta.dirname, 'contact.html'),
        checkout: resolve(import.meta.dirname, 'checkout.html'),
        checkoutSuccess: resolve(import.meta.dirname, 'checkout-success.html'),
        checkoutCancel: resolve(import.meta.dirname, 'checkout-cancel.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
