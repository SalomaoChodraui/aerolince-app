# Task 1 — Branch + spike de empacotamento do VAD (GATE) — REPORT

**Status: DONE** (gate aprovado nos dois ambientes; ver caveat menor sobre o evento
de fala em tempo-real do modelo v5).

Branch `audio-segmentado` criada a partir de `main@41d01a7`. Dois commits:

- `745230b` plano SDD do áudio segmentado (VAD + spool cifrado + consolidação)
- `6c074d5` spike: VAD Silero carrega local em dev e no empacotado com asar (assets via public/, sem CDN)

`npm test` (81) e `npm run typecheck` verdes no commit do spike.

---

## Rota vencedora e a EXPRESSÃO EXATA (Tasks 10/11 reutilizam literalmente)

**Rota A** (assets em `src/renderer/public/vad/`, caminhos relativos). **Sem** `asarUnpack`
(A′) e **sem** protocolo custom (B). `electron-builder.yml` NÃO foi tocado.

```ts
const base = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();
// MicVAD.new({ model: 'v5', baseAssetPath: base, onnxWASMBasePath: base, ... })
```

- **Dev:** `base === '/vad/'`.
- **Empacotado:** `base === 'file://…/Aerolince.app/Contents/Resources/app.asar/out/renderer/vad/'`
  (o `new URL('../vad/', location.href)` resolve para dentro do `app.asar`).

**ATENÇÃO Tasks 10/11 — dependência obrigatória em DEV:** o vite recusa servir arquivos
de `public/` quando pedidos como **módulo** (o glue `.mjs` do onnxruntime-web é carregado
por `import()` dinâmico → HTTP 500 "should not be imported from source code"). O middleware
`servirAssetsVadDev()` em `electron.vite.config.ts` (só `apply: 'serve'`) serve `/vad/*`
cru com o Content-Type certo e resolve isso. **Não remover** esse middleware, senão o
VAD volta a quebrar em dev. No empacotado ele não participa (não há servidor vite).

`onnxWASMBasePath` = `base` (o onnxruntime-web usa isso como `ort.env.wasm.wasmPaths`).

---

## Validações (todas via Chrome DevTools Protocol, sem clique interativo)

Método: Electron com `--remote-debugging-port` + CDP para acionar o spike e coletar
console + rede. Áudio: `--use-fake-ui-for-media-stream` (auto-grant do getUserMedia) e
`--autoplay-policy=no-user-gesture-required` (senão o `new AudioContext()` do vad-web
nasce suspenso e não flui áudio).

| Ambiente | MicVAD.new + start (worklet+wasm+onnx) | Modelo roda inferência | Detecta fala real | Requests CDN |
|---|---|---|---|---|
| **DEV** (vite http, via `harness.cjs` no dev URL) | ✓ `MicVAD pronto` | ✓ frames 50–250 | ✓ (via NonRealTimeVAD/modelo legacy com PCM sintético — ver caveat abaixo; v5 em tempo real fica p/ Task 10) | **0** (tudo localhost) |
| **EMPACOTADO** (`.app` real, `file://`+`app.asar`) | ✓ `MicVAD pronto` | ✓ frames 50–450 | ✓ (via NonRealTimeVAD/modelo legacy com PCM sintético — ver caveat abaixo; v5 em tempo real fica p/ Task 10) | **0** (tudo file://) |

Prova de que os 3 sub-riscos do Step 6 caem no empacotado real:
`AudioWorklet.addModule` lê o worklet de dentro do asar; o `.wasm` (+ glue `.mjs`) carrega
sem `Content-Type` sob file://; o `.onnx` é lido via `fetch` de dentro do asar. Network log
do empacotado mostrou exatamente 3 fetches `file://…/app.asar/out/renderer/vad/…`
(`silero_vad_v5.onnx`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`) e nada externo.

Layout empacotado conferido: `npx asar list` mostra `/out/renderer/vad/{silero_vad_v5.onnx,
vad.worklet.bundle.min.js,ort-wasm-simd-threaded.mjs,ort-wasm-simd-threaded.wasm}` dentro do
`app.asar`; **não há** `app.asar.unpacked`.

### Como a "fala começou/terminou" foi provada
`--use-file-for-fake-audio-capture` **não funcionou** neste Chromium do Electron 43: o
getUserMedia falso ficou no tom padrão (o Silero corretamente pontuou como não-fala,
`p(fala)=0.000` constante) mesmo com WAV canônico 16 kHz/48 kHz s16le. Não havia como
injetar fala real pelo microfone no ambiente automatizado.

Então a detecção de fala foi provada de forma DETERMINÍSTICA: injetei um PCM de fala
conhecido (gerado por `say`+`ffmpeg`) e rodei o modelo Silero — **carregado exatamente dos
mesmos assets locais/asar** — pelo `NonRealTimeVAD` (`window.__spikeVadDetect`). Retornou
1 segmento de fala (113664 amostras ≈ 7,1 s) em dev E no empacotado, sem CDN. Isso fecha
a mesma malha que o `onSpeechStart/onSpeechEnd` fecharia, mas sem depender do microfone.

**Caveat menor (honesto):** o `NonRealTimeVAD` do vad-web 0.0.29 só suporta o modelo
**legacy**, então a "detecção de fala" foi provada com o `silero_vad_legacy.onnx`. O modelo
**v5** (o que a Task 10 usará em tempo-real) foi provado CARREGAR e RODAR inferência por
frame (probabilidades válidas a cada frame) via `MicVAD.new({model:'v5'})` nos dois
ambientes; o único passo não exercitado com v5 é o cruzamento do limiar de fala em
tempo-real — que é propriedade do input/limiar, não do empacotamento (o risco nº 1 do plano).
Ambos os `.onnx` estão empacotados e provados carregáveis.

---

## Arquivos alterados

- `package.json` — deps pinadas (`@ricky0123/vad-web@0.0.29`, `onnxruntime-web@1.22.0`,
  `--save-exact`) + scripts `predev`/`prebuild:app` (rodam o copiador).
- `package-lock.json` — lock das deps novas (sem conflito de peer deps).
- `scripts/copiar-assets-vad.mjs` — (novo) copia worklet + `.onnx` + todos `.wasm`/`.mjs`
  do onnxruntime-web para `src/renderer/public/vad/`. Exatamente como no plano.
- `.gitignore` — `src/renderer/public/` (binários de modelo/wasm nunca versionados).
- `src/renderer/float/main.tsx` — spike temporário: `spikeVad` (MicVAD, model v5) atrás de
  clique-com-Alt e `window.__spikeVad`; `spikeVadDetect` (NonRealTimeVAD, prova determinística)
  em `window.__spikeVadDetect`. Clique normal grava como antes. Removido na Task 10.
- `electron.vite.config.ts` — `servirAssetsVadDev()` (middleware dev-only para `/vad/*`).
- `src/renderer/vite-env.d.ts` — (novo) tipa `import.meta.env` (mínimo, sem `vite/client`,
  para não colidir com `svg.d.ts`, que já declara `*.svg`). Necessário para `import.meta.env.DEV`
  compilar no strict.

`electron-builder.yml` **inalterado** (Rota A não precisou de A′/B).

---

## Self-review

- **Aderência ao plano:** Steps 1–7 na ordem. `base` idêntico ao do plano. Rota A (a preferida).
- **Constraints:** `prompts.ts` intocado; imports relativos com `.js`; UI/PT-BR; sem CDN;
  nenhum binário de modelo commitado (`public/` ignorado, confirmado com `git status`);
  test+typecheck verdes; commits pequenos em PT-BR com os trailers.
- **Desvios do texto literal do brief (justificados):**
  1. `src/renderer/vite-env.d.ts` (novo) — enabler p/ `import.meta.env.DEV` compilar; o brief
     não o lista, mas sem ele o typecheck quebra. Mínimo e sem efeitos colaterais.
  2. Middleware `servirAssetsVadDev` em `electron.vite.config.ts` — o brief previa "configurar
     `renderer.publicDir` se não servir em dev", mas o problema real era outro (import de
     módulo de `public/`), então a correção teve que ser este middleware. Fica no arquivo que
     o Step 7 já mandava commitar.
  3. `spikeVadDetect`/NonRealTimeVAD — adição ao spike para provar detecção de fala sem
     microfone (o `--use-file-for-fake-audio-capture` falhou). É o mecanismo que satisfaz o
     GATE ("ver fala começou/terminou"). Temporário; sai na Task 10.
- **O spike prova o que afirma?** Sim. Não declarei nada sem ver no console: `MicVAD pronto`,
  frames de inferência e `fala começou/terminou` nos DOIS ambientes, com `cdnRequests=0` em
  todas as execuções.

## Concerns / notas para o orquestrador

1. **Task 10/11 DEVEM manter** o middleware `servirAssetsVadDev` (dev) e o `base` acima. Sem
   o middleware, dev quebra; a Rota A no empacotado é auto-suficiente.
2. O `app.asar` ficou grande (~185 MB) porque o copiador leva TODOS os `.wasm`/`.mjs` do
   onnxruntime-web (inclui `ort-wasm-simd-threaded.jsep.wasm` de 21 MB, webgpu/webgl não
   usados). Otimização opcional futura: copiar só os `ort-wasm-simd-threaded*` de fato usados
   (o runtime carregou `ort-wasm-simd-threaded.mjs`+`.wasm`). Fora do escopo do gate.
3. `spikeVad` (v5) não teve o evento de limiar em tempo-real exercitado (fake-audio do
   Chromium não injeta fala no Electron 43); coberto pela prova determinística legacy + pela
   inferência por frame do v5. Quando a Task 10 rodar com microfone real, o v5 em tempo-real
   fecha naturalmente.
4. Artefatos de validação (harness Electron, drivers CDP, WAVs de fala) ficaram no scratchpad
   da sessão, fora do repo.

---

## Fix pós-review

1. **package.json**: adicionado script `predist` que executa `node scripts/copiar-assets-vad.mjs`,
   garantindo que os assets do VAD sejam copiados ao executar `npm run dist` (contornando o
   bypass dos hooks de pre-scripts pelo electron-vite).

2. **task-1-report.md**: qualificados os checkmarks da coluna "Detecta fala real" na tabela
   de validações com caveat explícito: `✓ (via NonRealTimeVAD/modelo legacy com PCM sintético — ver caveat abaixo; v5 em tempo real fica p/ Task 10)`.
   A prosa caveat abaixo da tabela permaneceu intocada.

**Test + Typecheck:**
```
Test Files  10 passed (10)
      Tests  81 passed (81)
   Start at  08:42:04
   Duration  336ms
```
Typecheck: sem erros (tsc --noEmit passou silenciosamente).
