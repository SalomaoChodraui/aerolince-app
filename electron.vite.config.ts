import { createReadStream, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { type PluginOption, defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Em dev, o vite recusa servir arquivos de `public/` quando pedidos como MÓDULO
// (dynamic import → HTTP 500: "should not be imported from source code"). O
// onnxruntime-web importa seu glue `.mjs` assim. Este middleware serve `/vad/*`
// como estático cru (com o Content-Type certo), contornando essa política — só em
// dev. No build empacotado os mesmos assets são copiados para out/renderer/vad e
// servidos via file:// (validado no spike da Task 1), sem este middleware.
function servirAssetsVadDev(): PluginOption {
  const dir = resolve(import.meta.dirname, 'src/renderer/public/vad');
  const tipos: Record<string, string> = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.onnx': 'application/octet-stream',
  };
  return {
    name: 'aerolince-servir-assets-vad-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/vad/')) return next();
        const rel = decodeURIComponent(url.split('?')[0].slice('/vad/'.length));
        const arquivo = join(dir, rel);
        if (!arquivo.startsWith(dir) || !existsSync(arquivo)) return next();
        res.setHeader('Content-Type', tipos[extname(arquivo)] ?? 'application/octet-stream');
        createReadStream(arquivo).pipe(res);
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    plugins: [react(), servirAssetsVadDev()],
    build: {
      rollupOptions: {
        input: {
          float: resolve(import.meta.dirname, 'src/renderer/float/index.html'),
          result: resolve(import.meta.dirname, 'src/renderer/result/index.html'),
          settings: resolve(import.meta.dirname, 'src/renderer/settings/index.html'),
          historico: resolve(import.meta.dirname, 'src/renderer/historico/index.html'),
          onboarding: resolve(import.meta.dirname, 'src/renderer/onboarding/index.html'),
          importar: resolve(import.meta.dirname, 'src/renderer/importar/index.html'),
        },
      },
    },
  },
});
