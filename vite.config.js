import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NIXXY runs as its own stack:
//   frontend (this Vite server / preview)  -> :5173
//   backend  (server/index.js, PORT in .env) -> :4100
// /api is proxied to the NIXXY backend so the two ports act as one origin.


const FRONTEND_PORT = 5173;
const API_TARGET = 'http://localhost:4000';

const allowedHosts = [
  'localhost',
  '127.0.0.1',
  '70.36.107.109',
  '.nixxy.com',
  'nixxy.com',
];

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: FRONTEND_PORT,
    strictPort: true,
    allowedHosts,

    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },

  preview: {
    host: '0.0.0.0',
    port: FRONTEND_PORT,
    strictPort: true,
    allowedHosts,

    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});