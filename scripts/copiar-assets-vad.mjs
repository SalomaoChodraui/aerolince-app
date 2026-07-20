// Copia os assets do VAD para src/renderer/public/vad/ (gitignorado).
// O vite serve public/ na raiz em dev e copia para out/renderer/ no build.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'src/renderer/public/vad');
mkdirSync(destino, { recursive: true });

const vadDist = join(raiz, 'node_modules/@ricky0123/vad-web/dist');
for (const f of ['vad.worklet.bundle.min.js', 'silero_vad_v5.onnx', 'silero_vad_legacy.onnx']) {
  cpSync(join(vadDist, f), join(destino, f));
}

const ortDist = join(raiz, 'node_modules/onnxruntime-web/dist');
for (const f of readdirSync(ortDist).filter((f) => f.endsWith('.wasm') || f.endsWith('.mjs'))) {
  cpSync(join(ortDist, f), join(destino, f));
}
console.log(`assets do VAD copiados para ${destino}`);
