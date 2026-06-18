import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// O front chama "/api/..." e o Vite faz proxy para o back-end (porta 3001),
// evitando problemas de CORS no ambiente de desenvolvimento.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
