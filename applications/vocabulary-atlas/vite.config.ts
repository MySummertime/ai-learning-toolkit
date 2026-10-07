import server from './server.json';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiUrl = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VITE_API_URL || `http://${server.host}:${server.servicePort}`;

export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
  preview: { host: server.host, port: server.pagePort, strictPort: true },
  plugins: [react()],
  base: './',
  server: { host: server.host, port: server.pagePort, strictPort: true, proxy: { '/api': apiUrl, '/health': apiUrl } },
  build: { outDir: '../../outputs/vocabulary-atlas/build', emptyOutDir: true },
});
