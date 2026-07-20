# Áudio segmentado (VAD + spool + consolidação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Primeiro passo da execução:** salvar este arquivo como `docs/superpowers/plans/2026-07-20-audio-segmentado.md` na branch (Task 1, Step 1).

## Contexto

O médico dita ENQUANTO analisa as imagens: fala um achado, pausa 1–2 min rolando séries no PACS, fala de novo. Hoje o app grava um WebM monolítico do clique inicial ao final — paga STT pelo silêncio todo, mantém tudo na memória do renderer e perde a sessão inteira em qualquer falha antes do `onstop`. A proposta aceita em 19/07 (`docs/PROPOSTA-ARQUITETURA-AUDIO-RESILIENTE-2026-07-19.md`) descreve a arquitetura-alvo; o usuário refinou o escopo em 20/07:

- **Sem pedal e sem atalho de teclado.** Clique no balão abre a sessão de escuta; VAD local separa fala de silêncio sozinho (silêncio de ~1,2 s pausa o registro; voltar a falar retoma). **Novo clique encerra** — silêncio nunca encerra a sessão (decisão do usuário, 20/07).
- **Consolidação local:** ao encerrar, os segmentos de fala viram UM WAV menor (só fala, com gaps curtos de silêncio inseridos) → **1 chamada** de STT. Custo cai de `custo × duração_total` para `custo × duração_da_fala`.
- **Spool cifrado** (decisão do usuário, 20/07): segmentos persistidos no disco cifrados (AES-256-GCM, chave da sessão protegida pelo `safeStorage`), apagados após a transcrição; crash não perde o ditado (recovery no boot). Substitui a política "áudio nunca toca o disco" da Fase A por "áudio nunca toca o disco em claro" — docs atualizados na Task 12.
- **Escopo desta branch: só o áudio segmentado** (decisão do usuário, 20/07). STATE-01/SAFE-02/QA-01 (Fase B da auditoria) ficam para plano próprio. CLI `laudo gravar` (ffmpeg → WAV) não muda.

**Goal:** clique abre escuta → VAD (Silero, local) registra só a fala → segmentos cifrados no disco → novo clique consolida em 1 WAV só-fala → 1 chamada `gpt-4o-transcribe` → pipeline atual intocado; custo STT entra no custo exibido; crash recupera o ditado no boot.

**Architecture:** captura no renderer com `@ricky0123/vad-web` (Silero v5 via onnxruntime-web/WASM, assets locais — nunca CDN); segmentos Int16 atravessam o IPC e são cifrados/spoolados pelo main (`src/main/audio/`); consolidação/WAV/particionamento/custo são funções puras em `src/core/audio/` e `src/core/stt/pricing.ts`; o pipeline ganha uma entrada que recebe WAV(s) consolidado(s) e telemetria. Caminho clássico (MediaRecorder) preservado atrás de `stt.captura: 'classica'` como fallback clínico por uma release.

**Tech Stack:** TypeScript strict ESM, Electron 43 + electron-vite 5 (renderer via `file://` no empacotado), React 19, zod, vitest, `@ricky0123/vad-web@0.0.29` (pinado) + `onnxruntime-web@1.22.0` (pinado), `node:crypto` (AES-256-GCM), OpenAI SDK (retries default do próprio SDK).

## Global Constraints

- **NUNCA editar `src/core/engine/prompts.ts`** (regressão de seleção/geração; eval é pago).
- ESM: todo import relativo termina em `.js` (mesmo de `.ts`). TS strict; zod em TODA fronteira nova (IPC de áudio, manifest do spool, config).
- Strings de UI em PT-BR; identificadores em PT sem acentos, seguindo o módulo vizinho (`consolidarSegmentos`, `iniciarSessao`).
- `npm test` e `npm run typecheck` verdes em TODO commit.
- `src/core/` continua Node puro sem Electron; `src/renderer/` só importa de `src/core/audio/pcm.ts` (módulo sem Node APIs — sem `Buffer`, sem `node:`).
- Assets do VAD (onnx/wasm/mjs/worklet) servidos **localmente** (copiados de `node_modules` por script; `src/renderer/public/` gitignorado). Proibido carregar da CDN default do vad-web. Nenhum binário de modelo commitado.
- Nunca commitar: laudos reais, áudio real, chaves, `secrets.enc.json`, `.env`, `laudo.config.json`, spool.
- Branch: `audio-segmentado`. Sem worktree — o usuário testa `npm run dev` neste workspace.
- Commits pequenos, um por task, mensagem em PT-BR, terminando com:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01JDYbGCEtNN5VCVNzRsZVBB
  ```

## Estratégia de execução e delegação (pedido explícito do usuário)

**Fable (a sessão orquestradora) NÃO escreve código de produção.** Processo = `superpowers:subagent-driven-development`, como na Fase A (briefs/reports em `.superpowers/sdd/`):

1. Fable despacha **um subagente fresco por task** com: o texto da task + `## Global Constraints` + o bloco *Interfaces* das tasks anteriores citadas. Nada além disso — o plano foi escrito para dispensar re-exploração do repo.
2. O subagente implementa TDD (steps da task), roda `npm test` + `npm run typecheck`, commita e devolve report curto.
3. Fable revisa o **diff** da task (gate): aderência ao plano, constraints, qualidade de teste. Reprovou → 1 rodada de fix no mesmo modelo; reprovou de novo → escala o modelo (sonnet→opus; opus→Fable decide manualmente).
4. Review final adversarial da branch inteira (Fable) + verificação manual com o usuário (seção final).

| Task | Modelo | Racional |
|---|---|---|
| 1 (spike VAD/empacotamento) | **opus** | Integração incerta (file://, worklet, WASM) — precisa depurar sozinho |
| 2, 3, 4, 5 (core puro) | **sonnet** | Funções puras com testes dados no plano — mecânico |
| 6, 7 (spool + sessão/IPC) | **opus** | Atomicidade, cripto, estados, fronteira IPC |
| 8 (pipeline + custo + telemetria) | **opus** | Toca o caminho crítico de produção |
| 9 (config + settings UI) | **sonnet** | Schema + UI simples, padrão existente |
| 10 (renderer float/VAD) | **opus** | Arquivo mais delicado: 2 modos de captura, estados, UX |
| 11 (recovery no boot) | **opus** | Timing de boot, diálogo nativo, decifra |
| 12 (docs/textos honestos) | **sonnet** | Textos dados no plano |

## Mapa de arquivos

- **Create:** `src/core/audio/pcm.ts` (+`.test.ts`) · `src/core/audio/wav.ts` (+`.test.ts`) · `src/core/audio/consolidar.ts` (+`.test.ts`) · `src/core/audio/cripto.ts` (+`.test.ts`) · `src/core/stt/pricing.ts` (+`.test.ts`) · `src/core/stt/openai.test.ts` · `src/main/audio/spool.ts` (+`.test.ts`) · `src/main/audio/sessao.ts` (+`.test.ts`) · `src/main/audio/recovery.ts` (+`.test.ts`) · `src/renderer/float/captura-vad.ts` · `scripts/copiar-assets-vad.mjs`
- **Modify:** `src/core/stt/openai.ts` · `src/core/config/schema.ts` (+`config.test.ts`) · `src/main/pipeline.ts` (+`.test.ts`) · `src/main/index.ts` · `src/preload/index.ts` · `src/renderer/float/main.tsx` · `src/renderer/float/index.html` · `src/renderer/settings/main.tsx` · `package.json` · `.gitignore` · `electron-builder.yml` (se fallback A′/B) · `electron.vite.config.ts` (se `publicDir` precisar ser explícito) · `docs/privacidade.md` · `CLAUDE.md` · `src/renderer/onboarding/main.tsx` · `docs/ESTADO.md` (no fechamento da branch)

---

### Task 1: Branch + spike de empacotamento do VAD (GATE fail-fast)

O risco nº 1 do plano é servir `silero_vad_v5.onnx`, `vad.worklet.bundle.min.js` e os `.wasm`/`.mjs` do onnxruntime-web num renderer que em produção carrega via `file://` (electron-vite `loadFile`, sem CSP hoje). Este spike prova o carregamento em dev E no build empacotado antes de qualquer outra coisa.

**Files:**
- Modify: `package.json` (deps pinadas + scripts `predev`/`prebuild:app`), `.gitignore` (`src/renderer/public/`)
- Create: `scripts/copiar-assets-vad.mjs`
- Modify (temporário, só spike): `src/renderer/float/main.tsx` (log de prova; removido na Task 10)

**Interfaces:**
- Consumes: —
- Produces: assets do VAD disponíveis em dev (`/vad/*` no servidor vite) e no empacotado (`out/renderer/vad/*`); expressão de `baseAssetPath`/`onnxWASMBasePath` validada que as Tasks 10/11 reutilizam literalmente.

- [ ] **Step 1: Criar a branch e versionar o plano**

```bash
git checkout -b audio-segmentado
mkdir -p docs/superpowers/plans
cp <este arquivo> docs/superpowers/plans/2026-07-20-audio-segmentado.md
git add docs/superpowers/plans/2026-07-20-audio-segmentado.md
git commit -m "plano SDD do áudio segmentado (VAD + spool cifrado + consolidação)"
```

- [ ] **Step 2: Instalar dependências pinadas**

```bash
npm install --save-exact @ricky0123/vad-web@0.0.29 onnxruntime-web@1.22.0
```

Expected: sem conflito de peer deps. (`onnxruntime-web` explícito para controlar a versão dos `.wasm` copiados.)

- [ ] **Step 3: Script de cópia de assets + hooks npm**

Criar `scripts/copiar-assets-vad.mjs`:

```js
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
```

Em `package.json`, acrescentar aos scripts:

```json
"predev": "node scripts/copiar-assets-vad.mjs",
"prebuild:app": "node scripts/copiar-assets-vad.mjs",
```

E em `.gitignore`:

```
src/renderer/public/
```

Nota: `electron-vite` usa o `publicDir` padrão do vite por renderer root — se `src/renderer/public/` não for servido em dev (checar com `curl localhost:<porta>/vad/silero_vad_v5.onnx`), configurar explicitamente `renderer.publicDir` em `electron.vite.config.ts` apontando para `src/renderer/public`.

- [ ] **Step 4: Prova de carga no float (código temporário de spike)**

Em `src/renderer/float/main.tsx`, adicionar temporariamente (topo do componente, atrás de um clique com Alt pressionado ou similar — NÃO no fluxo normal):

```ts
import { MicVAD } from '@ricky0123/vad-web';

async function spikeVad() {
  const base = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: base,
    onnxWASMBasePath: base,
    onSpeechStart: () => console.log('[spike-vad] fala começou'),
    onSpeechEnd: (audio) => console.log('[spike-vad] fala terminou', audio.length, 'amostras @16kHz'),
  });
  vad.start();
}
```

- [ ] **Step 5: Validar em DEV**

Run: `npm run dev`, acionar o spike, falar e calar.
Expected: console do float loga `fala começou` / `fala terminou N amostras` (N > 0). Nenhum request de rede para CDN (verificar no devtools → Network: tudo de `localhost`).

- [ ] **Step 6: Validar no EMPACOTADO REAL (file:// + app.asar)**

`npm run dev` NÃO exercita o problema (dev serve via servidor vite). E `npx electron .` sobre `out/` também não: o **asar** só entra pelo electron-builder (`electron-builder.yml` tem asar default=true e `files: [out/**]` — os assets do VAD cairiam DENTRO de `app.asar`). Validar contra o pacote real:

Run: `npm run build:app && npx electron-builder --dir`
Abrir o app gerado (mac: `open release/mac-arm64/Aerolince.app` — conferir o caminho no output do builder) e acionar o spike.
Expected: mesmo comportamento do Step 5 sob `file://` com asar. Este step prova: (a) `AudioWorklet.addModule` lê de dentro do asar; (b) o `.wasm` carrega mesmo sem `Content-Type: application/wasm` (se `instantiateStreaming` falhar, a build do onnxruntime-web precisa cair no fallback `instantiate(arrayBuffer)`); (c) o `.onnx` é lido via fetch.

**Fallback A′ (tentar primeiro se falhar):** em `electron-builder.yml`, acrescentar:

```yaml
asarUnpack:
  - "out/renderer/vad/**"
```

(os assets vão para `app.asar.unpacked/` como arquivos reais de disco; caminho relativo continua o mesmo) → rebuildar e revalidar.

**Rota B (só se A e A′ falharem):** servir os assets por scheme custom — em `src/main/index.ts`, `protocol.registerSchemesAsPrivileged([{ scheme: 'vad', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } }])` ANTES do `app.whenReady`, e `protocol.handle('vad', …)` respondendo os arquivos de `out/renderer/vad/*` com `Content-Type` correto (`application/wasm`, `application/javascript`, `application/octet-stream`); `baseAssetPath = 'vad://assets/'`.

**GATE: se as três rotas falharem, PARAR e reportar ao orquestrador antes de qualquer outra task.**

- [ ] **Step 7: Registrar o resultado e commitar**

Registrar no report da task qual rota valeu e a expressão EXATA de `baseAssetPath`/`onnxWASMBasePath` que funcionou (as Tasks 10/11 a reutilizam literalmente). Remover o spike é desnecessário: ele fica atrás do acionador oculto até a Task 10 substituí-lo.

```bash
git add package.json package-lock.json scripts/copiar-assets-vad.mjs .gitignore src/renderer/float/main.tsx electron.vite.config.ts electron-builder.yml
git commit -m "spike: VAD Silero carrega local em dev e no empacotado com asar (assets via public/, sem CDN)"
```

---

### Task 2: `src/core/audio/pcm.ts` — conversão Float32→Int16 (segura para renderer)

Módulo SEM Node APIs (sem `Buffer`, sem `node:`) — é o único pedaço de `src/core/` que o renderer importa (constraint global).

**Files:**
- Create: `src/core/audio/pcm.ts`, `src/core/audio/pcm.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `float32ParaInt16(entrada: Float32Array): Int16Array` · `SAMPLE_RATE = 16000` (const exportada) · `duracaoMs(amostras: number, sampleRate?: number): number`

- [ ] **Step 1: Teste que falha**

Criar `src/core/audio/pcm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { duracaoMs, float32ParaInt16, SAMPLE_RATE } from './pcm.js';

describe('float32ParaInt16', () => {
  it('converte os extremos e o zero', () => {
    const out = float32ParaInt16(new Float32Array([0, 1, -1]));
    expect(Array.from(out)).toEqual([0, 32767, -32768]);
  });

  it('clampa valores fora de [-1, 1]', () => {
    const out = float32ParaInt16(new Float32Array([1.5, -2]));
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('escala linearmente um valor intermediário', () => {
    const out = float32ParaInt16(new Float32Array([0.5]));
    expect(out[0]).toBe(Math.round(0.5 * 32767));
  });
});

describe('duracaoMs', () => {
  it('16000 amostras a 16 kHz = 1000 ms', () => {
    expect(duracaoMs(16_000)).toBe(1000);
  });

  it('sample rate padrão é 16 kHz', () => {
    expect(SAMPLE_RATE).toBe(16_000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/audio/pcm.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementação mínima**

Criar `src/core/audio/pcm.ts`:

```ts
// Conversões PCM puras. ATENÇÃO: este módulo é importado pelo RENDERER —
// não pode usar Buffer nem APIs node:*.

export const SAMPLE_RATE = 16_000;

export function float32ParaInt16(entrada: Float32Array): Int16Array {
  const saida = new Int16Array(entrada.length);
  for (let i = 0; i < entrada.length; i++) {
    const s = Math.max(-1, Math.min(1, entrada[i]));
    saida[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return saida;
}

export function duracaoMs(amostras: number, sampleRate = SAMPLE_RATE): number {
  return Math.round((amostras / sampleRate) * 1000);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/core/audio/pcm.test.ts` → PASS. Depois `npm test && npm run typecheck` → tudo verde.

- [ ] **Step 5: Commit**

```bash
git add src/core/audio/pcm.ts src/core/audio/pcm.test.ts
git commit -m "core/audio: conversão PCM Float32→Int16 pura (importável pelo renderer)"
```

---

### Task 3: `src/core/audio/wav.ts` + `consolidar.ts` — WAV e consolidação com gaps

Duas funções puras: encodar Int16 como WAV PCM16 mono, e consolidar N segmentos num PCM único com gap de silêncio entre eles (o gap evita que o STT emende palavras de momentos distintos). Inclui particionamento para o caso raro de exceder `MAX_AUDIO_BYTES` (24 MB ≈ 12,5 min de FALA pura a 16 kHz/16-bit).

**Files:**
- Create: `src/core/audio/wav.ts`, `src/core/audio/wav.test.ts`, `src/core/audio/consolidar.ts`, `src/core/audio/consolidar.test.ts`

**Interfaces:**
- Consumes: `SAMPLE_RATE`, `duracaoMs` de `./pcm.js` (Task 2)
- Produces:
  - `encodeWavPcm16(pcm: Int16Array, sampleRate?: number): Buffer`
  - `GAP_MS = 200` (const exportada)
  - `consolidarSegmentos(segs: Int16Array[], gapMs?: number, sampleRate?: number): { pcm: Int16Array; speechMs: number }`
  - `particionarPorBytes(segs: Int16Array[], maxBytes: number, gapMs?: number, sampleRate?: number): Int16Array[][]` — grupos cujo WAV consolidado cabe em `maxBytes`; segmento único maior que o limite é cortado duro com overlap de 300 ms

- [ ] **Step 1: Testes que falham**

Criar `src/core/audio/wav.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeWavPcm16 } from './wav.js';

describe('encodeWavPcm16', () => {
  it('gera header RIFF/WAVE correto para 16 kHz mono 16-bit', () => {
    const wav = encodeWavPcm16(new Int16Array([0, 1000, -1000]));
    expect(wav.length).toBe(44 + 6);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + 6);
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM linear
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt32LE(28)).toBe(32_000); // byte rate
    expect(wav.readUInt16LE(34)).toBe(16); // bits/amostra
    expect(wav.readUInt32LE(40)).toBe(6); // bytes de dados
  });

  it('roundtrip das amostras', () => {
    const wav = encodeWavPcm16(new Int16Array([123, -456]));
    expect(wav.readInt16LE(44)).toBe(123);
    expect(wav.readInt16LE(46)).toBe(-456);
  });
});
```

Criar `src/core/audio/consolidar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { consolidarSegmentos, GAP_MS, particionarPorBytes } from './consolidar.js';

const seg = (n: number, valor = 100) => new Int16Array(n).fill(valor);

describe('consolidarSegmentos', () => {
  it('vazio → pcm vazio e 0 ms de fala', () => {
    const r = consolidarSegmentos([]);
    expect(r.pcm.length).toBe(0);
    expect(r.speechMs).toBe(0);
  });

  it('um segmento → sem gap, speechMs correto', () => {
    const r = consolidarSegmentos([seg(16_000)]);
    expect(r.pcm.length).toBe(16_000);
    expect(r.speechMs).toBe(1000);
  });

  it('dois segmentos → um gap de silêncio entre eles', () => {
    const gapAmostras = (GAP_MS / 1000) * 16_000;
    const r = consolidarSegmentos([seg(1600, 5), seg(1600, 7)]);
    expect(r.pcm.length).toBe(1600 + gapAmostras + 1600);
    expect(r.pcm[0]).toBe(5);
    expect(r.pcm[1600]).toBe(0); // início do gap
    expect(r.pcm[1600 + gapAmostras]).toBe(7);
    expect(r.speechMs).toBe(200); // só fala conta; gap não
  });
});

describe('particionarPorBytes', () => {
  it('tudo cabe → um grupo único', () => {
    expect(particionarPorBytes([seg(100), seg(100)], 24 * 1024 * 1024)).toHaveLength(1);
  });

  it('divide em grupos nos limites de segmento', () => {
    // Cada segmento: 16000 amostras = 32 kB de dados. Limite ~44+64k força 2 grupos.
    const grupos = particionarPorBytes([seg(16_000), seg(16_000), seg(16_000)], 70_000);
    expect(grupos).toHaveLength(2);
    expect(grupos[0]).toHaveLength(2);
    expect(grupos[1]).toHaveLength(1);
  });

  it('segmento único maior que o limite é cortado com overlap de 300 ms', () => {
    // 64000 amostras = 128 kB > 70 kB → 2 pedaços com overlap.
    const grupos = particionarPorBytes([seg(64_000)], 70_000);
    expect(grupos.length).toBeGreaterThan(1);
    const total = grupos.flat().reduce((s, p) => s + p.length, 0);
    expect(total).toBeGreaterThan(64_000); // overlap duplica ~300 ms por corte
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/audio/wav.test.ts src/core/audio/consolidar.test.ts` → FAIL.

- [ ] **Step 3: Implementação**

Criar `src/core/audio/wav.ts`:

```ts
import { SAMPLE_RATE } from './pcm.js';

// WAV PCM16 mono little-endian (assume plataforma LE — x86/ARM).
export function encodeWavPcm16(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM linear
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate = rate * canais * 2
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  new Uint8Array(buf.buffer, buf.byteOffset + 44, dataBytes).set(
    new Uint8Array(pcm.buffer, pcm.byteOffset, dataBytes),
  );
  return buf;
}
```

Criar `src/core/audio/consolidar.ts`:

```ts
import { duracaoMs, SAMPLE_RATE } from './pcm.js';

export const GAP_MS = 200; // silêncio inserido entre segmentos na consolidação
const OVERLAP_MS = 300; // sobreposição ao cortar segmento gigante (proposta §5.2)
const WAV_HEADER_BYTES = 44;

export function consolidarSegmentos(
  segs: Int16Array[],
  gapMs = GAP_MS,
  sampleRate = SAMPLE_RATE,
): { pcm: Int16Array; speechMs: number } {
  if (segs.length === 0) return { pcm: new Int16Array(0), speechMs: 0 };
  const gap = Math.round((gapMs / 1000) * sampleRate);
  const falaAmostras = segs.reduce((s, seg) => s + seg.length, 0);
  const pcm = new Int16Array(falaAmostras + gap * (segs.length - 1));
  let pos = 0;
  segs.forEach((seg, i) => {
    if (i > 0) pos += gap; // Int16Array já nasce zerado = silêncio
    pcm.set(seg, pos);
    pos += seg.length;
  });
  return { pcm, speechMs: duracaoMs(falaAmostras, sampleRate) };
}

function bytesDoGrupo(amostras: number, nSegs: number, gap: number): number {
  return WAV_HEADER_BYTES + 2 * (amostras + gap * Math.max(0, nSegs - 1));
}

export function particionarPorBytes(
  segs: Int16Array[],
  maxBytes: number,
  gapMs = GAP_MS,
  sampleRate = SAMPLE_RATE,
): Int16Array[][] {
  const gap = Math.round((gapMs / 1000) * sampleRate);
  const maxAmostrasSozinho = Math.floor((maxBytes - WAV_HEADER_BYTES) / 2);
  const overlap = Math.round((OVERLAP_MS / 1000) * sampleRate);

  // 1. Corta segmentos individualmente maiores que o limite (caso raro: fala contínua enorme).
  const normalizados: Int16Array[] = [];
  for (const seg of segs) {
    if (seg.length <= maxAmostrasSozinho) {
      normalizados.push(seg);
      continue;
    }
    let inicio = 0;
    while (inicio < seg.length) {
      const fim = Math.min(seg.length, inicio + maxAmostrasSozinho);
      normalizados.push(seg.slice(inicio, fim));
      if (fim === seg.length) break;
      inicio = fim - overlap;
    }
  }

  // 2. Agrupamento greedy respeitando o tamanho do WAV consolidado do grupo.
  const grupos: Int16Array[][] = [];
  let atual: Int16Array[] = [];
  let amostras = 0;
  for (const seg of normalizados) {
    if (atual.length > 0 && bytesDoGrupo(amostras + seg.length, atual.length + 1, gap) > maxBytes) {
      grupos.push(atual);
      atual = [];
      amostras = 0;
    }
    atual.push(seg);
    amostras += seg.length;
  }
  if (atual.length > 0) grupos.push(atual);
  return grupos;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/core/audio/` → PASS. `npm test && npm run typecheck` → verdes.

- [ ] **Step 5: Commit**

```bash
git add src/core/audio/wav.ts src/core/audio/wav.test.ts src/core/audio/consolidar.ts src/core/audio/consolidar.test.ts
git commit -m "core/audio: encoder WAV PCM16 e consolidação de segmentos com gap e particionamento em 24MB"
```

---

### Task 4: Custo do STT (usage de tokens + fallback USD/min) e prompt encadeável no provider

O custo exibido hoje soma só LLM. A API de transcrição JÁ devolve `usage` por token (`Transcription.usage` no SDK `openai` — só `whisper-1` usa duração), que `openai.ts` hoje descarta (`create()` só lê `.text`). Esta task: (a) captura `usage` no `STTResult`; (b) aceita um prompt extra por chamada (a cauda do transcript anterior, usada no particionamento da Task 8); (c) cria `pricing.ts` com custo por token e fallback USD/min. Importante: **`STTResult.durationMs` é latência da chamada (`performance.now()`), NÃO duração de áudio** — não renomear nem reaproveitar (alimenta `tempos.sttMs`).

**Files:**
- Create: `src/core/stt/pricing.ts`, `src/core/stt/pricing.test.ts`, `src/core/stt/openai.test.ts`
- Modify: `src/core/stt/openai.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `SttUsage { inputAudioTokens: number; inputTextTokens: number; outputTokens: number }` e `mapearUsage(u: unknown): SttUsage | undefined` (exports de `openai.ts`)
  - `STTResult` ganha campo `usage?: SttUsage`
  - `STTProvider.transcribe(audioPath, promptExtra?)` / `transcribeBuffer(data, filename?, promptExtra?)`
  - `estimateSttCostUSD(model: string, medida: { usage?: SttUsage; audioMs?: number }): number | null` (`null` = não sabe; o chamador não soma e não inventa)

- [ ] **Step 1: Testes que falham**

Criar `src/core/stt/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { estimateSttCostUSD } from './pricing.js';

describe('estimateSttCostUSD', () => {
  it('prioriza usage por token quando presente', () => {
    // gpt-4o-transcribe: áudio in $6/1M tokens
    const custo = estimateSttCostUSD('gpt-4o-transcribe', {
      usage: { inputAudioTokens: 1_000_000, inputTextTokens: 0, outputTokens: 0 },
      audioMs: 60_000, // ignorado quando há usage
    });
    expect(custo).toBeCloseTo(6, 6);
  });

  it('soma os três eixos de tokens', () => {
    const custo = estimateSttCostUSD('gpt-4o-transcribe', {
      usage: { inputAudioTokens: 10_000, inputTextTokens: 4_000, outputTokens: 2_000 },
    });
    // 10k×$6/1M + 4k×$2.50/1M + 2k×$10/1M
    expect(custo).toBeCloseTo(0.06 + 0.01 + 0.02, 6);
  });

  it('sem usage cai para USD/min sobre audioMs', () => {
    expect(estimateSttCostUSD('gpt-4o-transcribe', { audioMs: 60_000 })).toBeCloseTo(0.006, 6);
    expect(estimateSttCostUSD('gpt-4o-mini-transcribe', { audioMs: 60_000 })).toBeCloseTo(0.003, 6);
  });

  it('modelo desconhecido → null (nunca inventar custo)', () => {
    expect(estimateSttCostUSD('whisper-do-futuro', { audioMs: 60_000 })).toBeNull();
  });

  it('sem usage e sem audioMs → null', () => {
    expect(estimateSttCostUSD('gpt-4o-transcribe', {})).toBeNull();
  });
});
```

Criar `src/core/stt/openai.test.ts` (só a função pura):

```ts
import { describe, expect, it } from 'vitest';
import { mapearUsage } from './openai.js';

describe('mapearUsage', () => {
  it('mapeia usage type=tokens do SDK', () => {
    expect(
      mapearUsage({
        type: 'tokens',
        input_tokens: 14,
        output_tokens: 45,
        total_tokens: 59,
        input_token_details: { text_tokens: 4, audio_tokens: 10 },
      }),
    ).toEqual({ inputAudioTokens: 10, inputTextTokens: 4, outputTokens: 45 });
  });

  it('type=duration (whisper-1) ou ausente → undefined', () => {
    expect(mapearUsage({ type: 'duration', seconds: 12 })).toBeUndefined();
    expect(mapearUsage(undefined)).toBeUndefined();
  });

  it('tokens sem input_token_details usa input_tokens como áudio (conservador)', () => {
    expect(mapearUsage({ type: 'tokens', input_tokens: 10, output_tokens: 2, total_tokens: 12 }))
      .toEqual({ inputAudioTokens: 10, inputTextTokens: 0, outputTokens: 2 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/stt/` → FAIL.

- [ ] **Step 3: Implementação**

Criar `src/core/stt/pricing.ts`:

```ts
import type { SttUsage } from './openai.js';

// Preços públicos OpenAI (conferidos em 20/07/2026; equivalência por minuto na proposta de 19/07 §3).
// ⚠️ Executor: conferir em https://developers.openai.com/api/docs/pricing no dia da implementação
// e ajustar as constantes se divergirem — é indicador de custo, não faturamento.
const PRECOS_USD_POR_1M_TOKENS: Record<string, { audioIn: number; textIn: number; out: number }> = {
  'gpt-4o-transcribe': { audioIn: 6, textIn: 2.5, out: 10 },
  'gpt-4o-mini-transcribe': { audioIn: 3, textIn: 1.25, out: 5 },
};
const PRECOS_USD_POR_MIN: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
};

export function estimateSttCostUSD(
  model: string,
  medida: { usage?: SttUsage; audioMs?: number },
): number | null {
  const porToken = PRECOS_USD_POR_1M_TOKENS[model];
  if (medida.usage && porToken) {
    const u = medida.usage;
    return (
      (u.inputAudioTokens * porToken.audioIn +
        u.inputTextTokens * porToken.textIn +
        u.outputTokens * porToken.out) / 1_000_000
    );
  }
  const porMin = PRECOS_USD_POR_MIN[model];
  if (medida.audioMs !== undefined && porMin !== undefined) {
    return (medida.audioMs / 60_000) * porMin;
  }
  return null;
}
```

Em `src/core/stt/openai.ts`:

1. Adicionar os exports:

```ts
export interface SttUsage {
  inputAudioTokens: number;
  inputTextTokens: number;
  outputTokens: number;
}

export function mapearUsage(u: unknown): SttUsage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as {
    type?: string;
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { text_tokens?: number; audio_tokens?: number };
  };
  if (o.type !== 'tokens') return undefined;
  return {
    inputAudioTokens: o.input_token_details?.audio_tokens ?? o.input_tokens ?? 0,
    inputTextTokens: o.input_token_details?.text_tokens ?? 0,
    outputTokens: o.output_tokens ?? 0,
  };
}
```

2. `STTResult` ganha `usage?: SttUsage`.
3. A interface `STTProvider` e as implementações ganham o parâmetro opcional `promptExtra?: string` em `transcribe`/`transcribeBuffer`, repassado ao `create()` privado, que monta `prompt: [promptExtra, <glossário atual>].filter(Boolean).join(' ')` (mantendo o glossário como está quando `promptExtra` é undefined).
4. `create()` passa a retornar também `usage: mapearUsage((result as { usage?: unknown }).usage)` ao lado de `text`/`durationMs` (sem mudar `durationMs`).

- [ ] **Step 4: Rodar e ver passar** — `npm test && npm run typecheck` verdes (o parâmetro é opcional: chamadores atuais — pipeline e CLI — compilam sem mudança).

- [ ] **Step 5: Commit**

```bash
git add src/core/stt/pricing.ts src/core/stt/pricing.test.ts src/core/stt/openai.ts src/core/stt/openai.test.ts
git commit -m "core/stt: usage de tokens no STTResult, prompt encadeável e custo estimado (token, fallback USD/min)"
```

---

### Task 5: `src/core/audio/cripto.ts` — cifra AES-256-GCM dos segmentos

Cifra autenticada por segmento (IV único por segmento, tag verificada na decifra). A PROTEÇÃO da chave de sessão (via `safeStorage`) é responsabilidade do main (Task 6) — este módulo é `node:crypto` puro.

**Files:**
- Create: `src/core/audio/cripto.ts`, `src/core/audio/cripto.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `gerarChaveSessao(): Buffer` (32 bytes) · `cifrarSegmento(chave: Buffer, plano: Buffer): Buffer` (formato `[iv(12)][tag(16)][dados]`) · `decifrarSegmento(chave: Buffer, cifrado: Buffer): Buffer` (lança em adulteração/chave errada)

- [ ] **Step 1: Teste que falha**

Criar `src/core/audio/cripto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cifrarSegmento, decifrarSegmento, gerarChaveSessao } from './cripto.js';

describe('cripto do spool', () => {
  it('roundtrip cifra→decifra', () => {
    const chave = gerarChaveSessao();
    const plano = Buffer.from('pcm de teste 1234567890');
    const cifrado = cifrarSegmento(chave, plano);
    expect(cifrado.length).toBe(12 + 16 + plano.length);
    expect(cifrado.subarray(28).equals(plano)).toBe(false); // nada em claro
    expect(decifrarSegmento(chave, cifrado).equals(plano)).toBe(true);
  });

  it('IVs diferentes a cada chamada', () => {
    const chave = gerarChaveSessao();
    const a = cifrarSegmento(chave, Buffer.from('x'));
    const b = cifrarSegmento(chave, Buffer.from('x'));
    expect(a.subarray(0, 12).equals(b.subarray(0, 12))).toBe(false);
  });

  it('adulteração é detectada', () => {
    const chave = gerarChaveSessao();
    const cifrado = cifrarSegmento(chave, Buffer.from('conteudo'));
    cifrado[cifrado.length - 1] ^= 0xff;
    expect(() => decifrarSegmento(chave, cifrado)).toThrow();
  });

  it('chave errada é rejeitada', () => {
    const cifrado = cifrarSegmento(gerarChaveSessao(), Buffer.from('conteudo'));
    expect(() => decifrarSegmento(gerarChaveSessao(), cifrado)).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL (módulo não existe).

- [ ] **Step 3: Implementação**

Criar `src/core/audio/cripto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function gerarChaveSessao(): Buffer {
  return randomBytes(32);
}

// Formato no disco: [iv(12)][tag(16)][dados cifrados]
export function cifrarSegmento(chave: Buffer, plano: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, chave, iv);
  const dados = Buffer.concat([cipher.update(plano), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), dados]);
}

export function decifrarSegmento(chave: Buffer, cifrado: Buffer): Buffer {
  const iv = cifrado.subarray(0, IV_BYTES);
  const tag = cifrado.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const dados = cifrado.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALG, chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(dados), decipher.final()]);
}
```

- [ ] **Step 4: Rodar e ver passar** — suíte + typecheck verdes.

- [ ] **Step 5: Commit**

```bash
git add src/core/audio/cripto.ts src/core/audio/cripto.test.ts
git commit -m "core/audio: cifra AES-256-GCM autenticada para o spool de segmentos"
```

---

### Task 6: `src/main/audio/spool.ts` — spool cifrado no disco

Persistência durável dos segmentos: cada segmento cifrado num arquivo (`write` em `.tmp` + `rename` atômico), manifest JSON validado por zod, chave de sessão protegida pelo `safeStorage`. **Sem cofre disponível, `criar()` devolve `null`** — o chamador segue só em memória (espelha o padrão do repo: leitura degrada, escrita nova nunca acontece em claro). Sem campo de estado no manifest: se o diretório existe, a sessão não terminou (o fluxo feliz APAGA o diretório ao concluir) — existência = órfã.

**Files:**
- Create: `src/main/audio/spool.ts`, `src/main/audio/spool.test.ts`

**Interfaces:**
- Consumes: `cifrarSegmento`, `decifrarSegmento`, `gerarChaveSessao` (Task 5); helper de escrita atômica já usado por `src/main/secrets.ts` (usar o MESMO import que aparece no topo daquele arquivo)
- Produces:
  - `ManifestSchema` (zod) e `Manifest { schemaVersion: 1; sessionId; criadoEm; chaveCifradaB64; segmentos: { arquivo: string; durationMs: number }[] }`
  - `class SpoolSessao`: `static criar(spoolRoot): SpoolSessao | null` · `static abrir(dir): SpoolSessao | null` · `appendSegmento(pcm: Buffer, durationMs: number): void` · `listarSegmentos(): Buffer[]` · `get meta(): Manifest` · `descartar(): void`
  - `listarSessoesOrfas(spoolRoot): string[]` (dirs com manifest, mais recente primeiro) · `apagarSessoesAntigas(spoolRoot, maxIdadeMs): void`

- [ ] **Step 1: Testes que falham**

Criar `src/main/audio/spool.test.ts` (mock do Electron ANTES do import, padrão de `secrets.test.ts:6-16`):

```ts
import { mkdtempSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}));

const { SpoolSessao, apagarSessoesAntigas, listarSessoesOrfas } = await import('./spool.js');
const { safeStorage } = await import('electron');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'spool-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true); });

describe('SpoolSessao', () => {
  it('roundtrip: criar → append → abrir → listarSegmentos decifra', () => {
    const spool = SpoolSessao.criar(root)!;
    const pcm = Buffer.from('fala-em-pcm-1234');
    spool.appendSegmento(pcm, 750);
    spool.appendSegmento(Buffer.from('outro-trecho'), 500);

    const reaberto = SpoolSessao.abrir(spool.dir)!;
    const segs = reaberto.listarSegmentos();
    expect(segs).toHaveLength(2);
    expect(segs[0].equals(pcm)).toBe(true);
    expect(reaberto.meta.segmentos.map((s) => s.durationMs)).toEqual([750, 500]);
  });

  it('nada em claro no disco', () => {
    const spool = SpoolSessao.criar(root)!;
    spool.appendSegmento(Buffer.from('CONTEUDO-SENSIVEL'), 100);
    const arquivo = readFileSync(join(spool.dir, 'seg-000.bin'));
    expect(arquivo.includes(Buffer.from('CONTEUDO-SENSIVEL'))).toBe(false);
  });

  it('sem cofre → criar devolve null (nunca spool em claro)', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(SpoolSessao.criar(root)).toBeNull();
  });

  it('manifest corrompido → abrir devolve null', () => {
    const spool = SpoolSessao.criar(root)!;
    rmSync(join(spool.dir, 'manifest.json'));
    expect(SpoolSessao.abrir(spool.dir)).toBeNull();
  });

  it('descartar remove o diretório', () => {
    const spool = SpoolSessao.criar(root)!;
    spool.descartar();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });
});

describe('órfãs e expiração', () => {
  it('lista sessões existentes como órfãs', () => {
    SpoolSessao.criar(root);
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });

  it('apagarSessoesAntigas remove só as vencidas', () => {
    const velha = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 72 * 3600_000) / 1000;
    utimesSync(velha.dir, antes, antes);
    SpoolSessao.criar(root);
    apagarSessoesAntigas(root, 48 * 3600_000);
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/main/audio/spool.test.ts` → FAIL.

- [ ] **Step 3: Implementação**

Criar `src/main/audio/spool.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';
import { cifrarSegmento, decifrarSegmento, gerarChaveSessao } from '../../core/audio/cripto.js';
// + importar o helper de escrita atômica que secrets.ts já usa (mesmo caminho de import)

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  criadoEm: z.string(),
  chaveCifradaB64: z.string().min(1),
  segmentos: z.array(z.object({ arquivo: z.string().min(1), durationMs: z.number().int().nonnegative() })),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export class SpoolSessao {
  private constructor(
    readonly dir: string,
    private readonly chave: Buffer,
    private readonly manifest: Manifest,
  ) {}

  /** null se o cofre do SO não estiver disponível — o chamador segue só em memória. */
  static criar(spoolRoot: string): SpoolSessao | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const dir = join(spoolRoot, sessionId);
    mkdirSync(dir, { recursive: true });
    const chave = gerarChaveSessao();
    const manifest: Manifest = {
      schemaVersion: 1,
      sessionId,
      criadoEm: new Date().toISOString(),
      chaveCifradaB64: safeStorage.encryptString(chave.toString('base64')).toString('base64'),
      segmentos: [],
    };
    const spool = new SpoolSessao(dir, chave, manifest);
    spool.salvarManifest();
    return spool;
  }

  /** null se manifest inválido/ausente ou cofre indisponível (recovery degrada para "descartar"). */
  static abrir(dir: string): SpoolSessao | null {
    try {
      const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
      if (!safeStorage.isEncryptionAvailable()) return null;
      const chave = Buffer.from(safeStorage.decryptString(Buffer.from(manifest.chaveCifradaB64, 'base64')), 'base64');
      return new SpoolSessao(dir, chave, manifest);
    } catch {
      return null;
    }
  }

  appendSegmento(pcm: Buffer, durationMs: number): void {
    const arquivo = `seg-${String(this.manifest.segmentos.length).padStart(3, '0')}.bin`;
    const tmp = join(this.dir, `${arquivo}.tmp`);
    writeFileSync(tmp, cifrarSegmento(this.chave, pcm));
    renameSync(tmp, join(this.dir, arquivo));
    this.manifest.segmentos.push({ arquivo, durationMs });
    this.salvarManifest();
  }

  listarSegmentos(): Buffer[] {
    return this.manifest.segmentos.map((s) => decifrarSegmento(this.chave, readFileSync(join(this.dir, s.arquivo))));
  }

  get meta(): Manifest {
    return this.manifest;
  }

  descartar(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private salvarManifest(): void {
    writeFileAtomicSync(join(this.dir, 'manifest.json'), JSON.stringify(this.manifest, null, 2));
  }
}

export function listarSessoesOrfas(spoolRoot: string): string[] {
  try {
    return readdirSync(spoolRoot)
      .map((nome) => join(spoolRoot, nome))
      .filter((dir) => {
        try { statSync(join(dir, 'manifest.json')); return true; } catch { return false; }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

export function apagarSessoesAntigas(spoolRoot: string, maxIdadeMs: number): void {
  const agora = Date.now();
  for (const dir of listarSessoesOrfas(spoolRoot)) {
    try {
      if (agora - statSync(dir).mtimeMs > maxIdadeMs) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* melhor esforço — nunca impedir o boot */
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — suíte + typecheck verdes.

- [ ] **Step 5: Commit**

```bash
git add src/main/audio/spool.ts src/main/audio/spool.test.ts
git commit -m "main/audio: spool de segmentos cifrado (AES-GCM + chave no cofre), manifest zod, expiração"
```

---

### Task 7: Sessão de áudio no main + canais IPC + preload

Controller da sessão (memória como fonte primária para consolidar; spool como seguro contra crash) + 4 canais `invoke` novos + helper `gerarDeSegmentos` que o recovery (Task 11) reusa. O canal `processar-audio` atual permanece intocado (modo clássico).

**Files:**
- Create: `src/main/audio/sessao.ts`, `src/main/audio/sessao.test.ts`
- Modify: `src/main/index.ts` (handlers + helper), `src/preload/index.ts` (4 métodos)

**Interfaces:**
- Consumes: `SpoolSessao` (Task 6); `consolidarSegmentos`/`particionarPorBytes` (Task 3); `encodeWavPcm16` (Task 3); `MAX_AUDIO_BYTES` (`src/core/stt/audio-guard.ts`); `processarAudioSegmentado` (Task 8 — ver nota de ordem abaixo)
- Produces:
  - `class SessaoAudio`: `iniciar(spoolRoot): { ok: true; semCofre: boolean } | { ok: false; erro: string }` · `receberSegmento(pcm: Buffer, durationMs): { ok: boolean; erro?: string }` · `finalizar(): SessaoFinalizada | null` · `cancelar(): void`
  - `SessaoFinalizada { segmentos: Int16Array[]; capturedMs: number; speechMs: number; spool: SpoolSessao | null }`
  - Canais IPC: `sessao-iniciar`, `sessao-segmento`, `sessao-encerrar`, `sessao-cancelar`
  - Preload: `sessaoIniciar(): Promise<{ ok: boolean; semCofre?: boolean; erro?: string }>` · `sessaoSegmento(pcm: ArrayBuffer, durationMs: number): Promise<Resp>` · `sessaoEncerrar(): Promise<Resp>` · `sessaoCancelar(): Promise<Resp>`
  - `gerarDeSegmentos(segmentos: Int16Array[], capturedMs: number, speechMs: number): Promise<void>` (função interna de `main/index.ts`, reusada pela Task 11)

**Nota de ordem:** esta task usa `processarAudioSegmentado` da Task 8. Executar a Task 8 ANTES da 7, ou (preferível, mantendo a numeração) implementar aqui `sessao.ts` completo + preload + handlers `sessao-iniciar`/`sessao-segmento`/`sessao-cancelar`, deixando o handler `sessao-encerrar`/`gerarDeSegmentos` com corpo `return { ok: false, erro: 'pipeline segmentado entra na próxima task' }` e completando-o na Task 8. O commit da Task 8 fecha o fio.

- [ ] **Step 1: Testes que falham**

Criar `src/main/audio/sessao.test.ts` (mesmo mock de `electron` da Task 6; spool em `mkdtempSync`):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
}));

const { SessaoAudio } = await import('./sessao.js');
const { listarSessoesOrfas } = await import('./spool.js');

let root: string;
let sessao: InstanceType<typeof SessaoAudio>;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'sessao-')); sessao = new SessaoAudio(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pcmBuf = (n: number) => Buffer.from(new Int16Array(n).fill(7).buffer);

describe('SessaoAudio', () => {
  it('ciclo completo: iniciar → 3 segmentos → finalizar', () => {
    expect(sessao.iniciar(root)).toEqual({ ok: true, semCofre: false });
    for (let i = 0; i < 3; i++) expect(sessao.receberSegmento(pcmBuf(1600), 100).ok).toBe(true);
    const fin = sessao.finalizar()!;
    expect(fin.segmentos).toHaveLength(3);
    expect(fin.speechMs).toBe(300);
    expect(fin.capturedMs).toBeGreaterThanOrEqual(0); // relógio de parede do teste, não a soma da fala
    expect(fin.spool).not.toBeNull();
  });

  it('só uma sessão por vez', () => {
    sessao.iniciar(root);
    expect(sessao.iniciar(root).ok).toBe(false);
  });

  it('segmento sem sessão ativa é recusado', () => {
    expect(sessao.receberSegmento(pcmBuf(100), 10).ok).toBe(false);
  });

  it('segmento gigante é recusado', () => {
    sessao.iniciar(root);
    expect(sessao.receberSegmento(Buffer.alloc(5 * 1024 * 1024), 10).ok).toBe(false);
  });

  it('cancelar limpa o spool e permite nova sessão', () => {
    sessao.iniciar(root);
    sessao.receberSegmento(pcmBuf(1600), 100);
    sessao.cancelar();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(sessao.iniciar(root).ok).toBe(true);
  });

  it('finalizar sem sessão → null', () => {
    expect(sessao.finalizar()).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementar `sessao.ts`**

```ts
import { SpoolSessao } from './spool.js';

export interface SessaoFinalizada {
  segmentos: Int16Array[];
  capturedMs: number;
  speechMs: number;
  spool: SpoolSessao | null;
}

const MAX_SEGMENTO_BYTES = 4 * 1024 * 1024; // ~2 min de fala Int16@16 kHz — bem acima do esperado

export class SessaoAudio {
  private spool: SpoolSessao | null = null;
  private segmentos: Int16Array[] = [];
  private iniciadaEm = 0;
  private speechMs = 0;
  private ativa = false;

  iniciar(spoolRoot: string): { ok: true; semCofre: boolean } | { ok: false; erro: string } {
    if (this.ativa) return { ok: false, erro: 'Já existe um ditado em andamento.' };
    this.spool = SpoolSessao.criar(spoolRoot);
    this.segmentos = [];
    this.speechMs = 0;
    this.iniciadaEm = Date.now();
    this.ativa = true;
    return { ok: true, semCofre: this.spool === null };
  }

  receberSegmento(pcm: Buffer, durationMs: number): { ok: boolean; erro?: string } {
    if (!this.ativa) return { ok: false, erro: 'Nenhum ditado em andamento.' };
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_SEGMENTO_BYTES) {
      return { ok: false, erro: 'Segmento de áudio com tamanho inválido.' };
    }
    this.segmentos.push(new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)));
    this.speechMs += durationMs;
    this.spool?.appendSegmento(pcm, durationMs); // falha de disco não derruba o ditado:
    return { ok: true };                          // envolver em try/catch e seguir só-memória
  }

  finalizar(): SessaoFinalizada | null {
    if (!this.ativa) return null;
    this.ativa = false;
    const fin = {
      segmentos: this.segmentos,
      capturedMs: Date.now() - this.iniciadaEm,
      speechMs: this.speechMs,
      spool: this.spool,
    };
    this.segmentos = [];
    this.spool = null;
    return fin;
  }

  cancelar(): void {
    this.ativa = false;
    this.segmentos = [];
    this.spool?.descartar();
    this.spool = null;
  }
}
```

(No `receberSegmento`, o `appendSegmento` real deve ficar num `try/catch` que, em erro de disco, loga e segue — a sessão continua válida só em memória.)

- [ ] **Step 4: Preload + handlers**

Em `src/preload/index.ts`, junto dos métodos existentes (padrão de `processarAudio`, L8):

```ts
sessaoIniciar: () => ipcRenderer.invoke('sessao-iniciar') as Promise<{ ok: boolean; semCofre?: boolean; erro?: string }>,
sessaoSegmento: (pcm: ArrayBuffer, durationMs: number) =>
  ipcRenderer.invoke('sessao-segmento', pcm, durationMs) as Promise<Resp>,
sessaoEncerrar: () => ipcRenderer.invoke('sessao-encerrar') as Promise<Resp>,
sessaoCancelar: () => ipcRenderer.invoke('sessao-cancelar') as Promise<Resp>,
```

Em `src/main/index.ts` (junto do handler `processar-audio` existente, ~L284; validação de fronteira à mão + zod onde couber):

```ts
import { SessaoAudio } from './audio/sessao.js';
import { consolidarSegmentos, particionarPorBytes } from '../core/audio/consolidar.js';
import { encodeWavPcm16 } from '../core/audio/wav.js';
import { MAX_AUDIO_BYTES } from '../core/stt/audio-guard.js';

const sessaoAudio = new SessaoAudio();
const spoolRoot = () => join(app.getPath('userData'), 'spool');

ipcMain.handle('sessao-iniciar', () => sessaoAudio.iniciar(spoolRoot()));

ipcMain.handle('sessao-segmento', (_e, pcm: unknown, durationMs: unknown) => {
  if (!(pcm instanceof ArrayBuffer) || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 120_000) {
    return { ok: false, erro: 'Segmento inválido.' };
  }
  return sessaoAudio.receberSegmento(Buffer.from(pcm), Math.round(durationMs));
});

ipcMain.handle('sessao-cancelar', () => { sessaoAudio.cancelar(); return { ok: true }; });

ipcMain.handle('sessao-encerrar', async () => {
  const fin = sessaoAudio.finalizar();
  if (!fin) return { ok: false, erro: 'Nenhum ditado em andamento.' };
  try {
    await gerarDeSegmentos(fin.segmentos, fin.capturedMs, fin.speechMs);
    fin.spool?.descartar(); // só após sucesso; em erro fica p/ recovery (≤48 h)
    return { ok: true };
  } catch (e) {
    // replicar EXATAMENTE o tratamento do handler 'processar-audio' vizinho
    // (evento 'estado' de erro p/ o float + Resp{ok:false, erro}), sem descartar o spool
  }
});

// Consolida → particiona em ≤24 MB → WAVs → pipeline segmentado → entregar().
// Sessão sem fala vira WAV de 44 bytes e cai no validarAudio (<1024) → mesmo aviso "sem áudio" de hoje.
async function gerarDeSegmentos(segmentos: Int16Array[], capturedMs: number, speechMs: number): Promise<void> {
  const grupos = particionarPorBytes(segmentos, MAX_AUDIO_BYTES);
  const wavs = grupos.map((g) => encodeWavPcm16(consolidarSegmentos(g).pcm));
  if (wavs.length === 0) wavs.push(encodeWavPcm16(new Int16Array(0)));
  const res = await processarAudioSegmentado(wavs, { capturedMs, speechMs }); // Task 8
  await entregar(res); // mesma entrega do fluxo atual (janela de resultado + sidecar)
}
```

Os eventos `'estado'` (processando/ok/erro) seguem o padrão do handler `processar-audio` vizinho — replicar as mesmas emissões em volta de `gerarDeSegmentos`.

- [ ] **Step 5: Rodar e ver passar** — `npm test && npm run typecheck` verdes (com o stub da Task 8 se a ordem 7→8 for mantida).

- [ ] **Step 6: Commit**

```bash
git add src/main/audio/sessao.ts src/main/audio/sessao.test.ts src/main/index.ts src/preload/index.ts
git commit -m "main: sessão de áudio segmentada com spool + canais IPC sessao-* e preload tipado"
```

---

### Task 8: Pipeline segmentado — transcrição encadeada, custo STT no custo total, telemetria no sidecar

O coração da economia: N WAVs (quase sempre 1) transcritos em sequência com cauda do transcript anterior como `promptExtra`, custo STT somado ao `custoUSD` (usage de tokens; fallback USD/min), telemetria da sessão no sidecar. O caminho clássico e o refino também passam a somar custo STT via `usage` (de graça, sem duração conhecida).

**Files:**
- Modify: `src/main/pipeline.ts` (nova `transcreverConsolidado` + `processarAudioSegmentado`; custo STT no clássico e no refino; campo `audio` no `ResultadoLaudo`), `src/main/index.ts` (sidecar em `entregar()`, ~L227-236)
- Modify: `src/main/pipeline.test.ts` (novos casos)

**Interfaces:**
- Consumes: `STTProvider`/`SttUsage`/`promptExtra` (Task 4); `estimateSttCostUSD` (Task 4); `duracaoMs` (Task 2); `validarAudio`/`MAX_AUDIO_BYTES` (existentes)
- Produces:
  - `TelemetriaAudio { capturedMs: number; speechMs: number; speechRatio: number; uploadedBytes: number; segmentosStt: number; custoSttUSD?: number }`
  - `transcreverConsolidado(stt: STTProvider, wavs: Buffer[], model: string): Promise<{ transcript: string; sttMs: number; custoSttUSD?: number; uploadedBytes: number }>` (exportada, testável com provider fake)
  - `processarAudioSegmentado(wavs: Buffer[], tele: { capturedMs: number; speechMs: number }): Promise<ResultadoPipeline>`
  - `ResultadoLaudo` ganha `audio?: TelemetriaAudio`; sidecar ganha bloco `audio`

- [ ] **Step 1: Testes que falham**

Adicionar em `src/main/pipeline.test.ts`:

```ts
import { encodeWavPcm16 } from '../core/audio/wav.js';
import { transcreverConsolidado } from './pipeline.js';
import type { STTProvider, STTResult } from '../core/stt/openai.js';

function sttFake(respostas: string[]): STTProvider & { chamadas: { promptExtra?: string }[] } {
  const chamadas: { promptExtra?: string }[] = [];
  return {
    chamadas,
    async transcribe(): Promise<STTResult> { throw new Error('não usado'); },
    async transcribeBuffer(_d, _f, promptExtra) {
      chamadas.push({ promptExtra });
      return {
        text: respostas[chamadas.length - 1],
        durationMs: 5,
        usage: { inputAudioTokens: 1000, inputTextTokens: 0, outputTokens: 100 },
      };
    },
  };
}

const wavValido = () => encodeWavPcm16(new Int16Array(600)); // 1244 bytes > mínimo de 1024

describe('transcreverConsolidado', () => {
  it('encadeia a cauda do transcript anterior como promptExtra', async () => {
    const stt = sttFake(['primeira parte do laudo', 'segunda parte']);
    const r = await transcreverConsolidado(stt, [wavValido(), wavValido()], 'gpt-4o-transcribe');
    expect(r.transcript).toBe('primeira parte do laudo segunda parte');
    expect(stt.chamadas[0].promptExtra).toBeUndefined();
    expect(stt.chamadas[1].promptExtra).toContain('primeira parte do laudo');
  });

  it('soma custo por usage e uploadedBytes', async () => {
    const stt = sttFake(['a', 'b']);
    const r = await transcreverConsolidado(stt, [wavValido(), wavValido()], 'gpt-4o-transcribe');
    // 2 × (1000×$6/1M + 100×$10/1M)
    expect(r.custoSttUSD).toBeCloseTo(2 * (0.006 + 0.001), 6);
    expect(r.uploadedBytes).toBe(2 * 1244);
  });

  it('WAV vazio (44 bytes) dispara o guard "sem áudio" antes de qualquer chamada', async () => {
    const stt = sttFake(['x']);
    await expect(transcreverConsolidado(stt, [encodeWavPcm16(new Int16Array(0))], 'gpt-4o-transcribe'))
      .rejects.toThrow(); // mensagem do validarAudio existente
    expect(stt.chamadas).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementação em `pipeline.ts`**

```ts
import { duracaoMs } from '../core/audio/pcm.js';
import { estimateSttCostUSD } from '../core/stt/pricing.js';
import type { STTProvider } from '../core/stt/openai.js';

export interface TelemetriaAudio {
  capturedMs: number;
  speechMs: number;
  speechRatio: number;
  uploadedBytes: number;
  segmentosStt: number;
  custoSttUSD?: number;
}

const CAUDA_CHARS = 150; // contexto do trecho anterior no prompt (limite de prompt do STT é curto)

export async function transcreverConsolidado(
  stt: STTProvider,
  wavs: Buffer[],
  model: string,
): Promise<{ transcript: string; sttMs: number; custoSttUSD?: number; uploadedBytes: number }> {
  for (const wav of wavs) validarAudio(wav.byteLength); // inclui o caso "sem áudio" (44 bytes < 1024)
  let transcript = '';
  let sttMs = 0;
  let uploadedBytes = 0;
  let custoSttUSD: number | undefined;
  for (const wav of wavs) {
    const cauda = transcript ? transcript.slice(-CAUDA_CHARS) : undefined;
    const r = await stt.transcribeBuffer(wav, 'ditado.wav', cauda);
    transcript = transcript ? `${transcript} ${r.text}` : r.text;
    sttMs += r.durationMs;
    uploadedBytes += wav.byteLength;
    const custo = estimateSttCostUSD(model, {
      usage: r.usage,
      audioMs: duracaoMs((wav.byteLength - 44) / 2),
    });
    if (custo !== null) custoSttUSD = (custoSttUSD ?? 0) + custo;
  }
  return { transcript, sttMs, custoSttUSD, uploadedBytes };
}

export async function processarAudioSegmentado(
  wavs: Buffer[],
  tele: { capturedMs: number; speechMs: number },
): Promise<ResultadoPipeline> {
  // mesmo guard de chave do processarAudio atual (L74-78)
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const t = await transcreverConsolidado(stt, wavs, config.stt.model);
  const res = await processarTranscript(t.transcript);
  // enriquecer o resultado (sem tocar gerarComMascara):
  //   res.tempos.sttMs = t.sttMs
  //   se t.custoSttUSD: res.custoUSD = (res.custoUSD ?? 0) + t.custoSttUSD
  //   res.audio = { capturedMs: tele.capturedMs, speechMs: tele.speechMs,
  //                 speechRatio: tele.capturedMs > 0 ? tele.speechMs / tele.capturedMs : 1,
  //                 uploadedBytes: t.uploadedBytes, segmentosStt: wavs.length, custoSttUSD: t.custoSttUSD }
  return res;
}
```

Ajustes pontuais (paridade de custo):
- `ResultadoLaudo` (pipeline.ts:19-31): campo novo `audio?: TelemetriaAudio`.
- `processarAudio` (clássico) e `refinarTranscript` (~L231): após a chamada de STT, somar `estimateSttCostUSD(config.stt.model, { usage: r.usage })` ao custo quando não-null (sem `audioMs` — duração do webm é desconhecida; `usage` resolve).
- `entregar()` em `src/main/index.ts` (~L227-236): incluir `audio: res.audio` no objeto passado a `saveSidecar` (o sidecar aceita campos extras).
- Se a ordem 7→8 foi mantida: completar aqui o handler `sessao-encerrar`/`gerarDeSegmentos` stub da Task 7.

- [ ] **Step 4: Rodar e ver passar** — `npm test && npm run typecheck` verdes.

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline.ts src/main/pipeline.test.ts src/main/index.ts
git commit -m "pipeline segmentado: transcrição encadeada por partes, custo STT no custoUSD e telemetria audio no sidecar"
```

---

---

### Task 9: Config — `stt.captura` e `stt.pausaMs` + seção "Ditado" nas Configurações

Feature flag clínica (voltar ao fluxo antigo sem rebuild) e o único parâmetro de VAD exposto ao médico (a pausa que fecha um trecho). O float NÃO escuta `config-mudou` (e `floatWin` está fora do broadcast em `main/index.ts:312`) — por decisão de simplicidade, o float lê a config no INÍCIO de cada sessão (Task 10), então mudanças valem a partir do próximo ditado e nenhum broadcast novo é necessário.

**Files:**
- Modify: `src/core/config/schema.ts`, `src/core/config/config.test.ts` (ou o arquivo de teste de config existente), `src/renderer/settings/main.tsx`

**Interfaces:**
- Consumes: —
- Produces: `config.stt.captura: 'segmentada' | 'classica'` (default `'segmentada'`) · `config.stt.pausaMs: number` (int, 400–5000, default 1200). Merge raso de `stt` em `saveConfig` já existe (schema.ts:110/172-175) — nada a fazer ali.

- [ ] **Step 1: Testes que falham**

Adicionar em `src/core/config/config.test.ts`, usando o MESMO helper de tmpdir/fixture que os 9 testes existentes do arquivo já usam para `loadConfig`/`saveConfig` (adaptar as 3 chamadas abaixo ao padrão local — os asserts são estes):

```ts
it('config antiga sem os campos novos de stt ganha defaults', () => {
  // fixture: laudo.config.json contendo apenas { "schemaVersion": 1, "stt": { "model": "gpt-4o-transcribe" } }
  const config = loadConfig(root);
  expect(config.stt.captura).toBe('segmentada');
  expect(config.stt.pausaMs).toBe(1200);
  expect(config.stt.model).toBe('gpt-4o-transcribe');
});

it('pausaMs fora do intervalo é rejeitado', () => {
  expect(() => saveConfig(root, { stt: { pausaMs: 100 } })).toThrow();
});

it('merge raso de stt preserva campos não enviados', () => {
  saveConfig(root, { stt: { glossario: ['esteatose'] } });
  saveConfig(root, { stt: { pausaMs: 2000 } });
  const config = loadConfig(root);
  expect(config.stt.pausaMs).toBe(2000);
  expect(config.stt.glossario).toEqual(['esteatose']);
  expect(config.stt.captura).toBe('segmentada');
});
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL (campos não existem).

- [ ] **Step 3: Schema**

Em `src/core/config/schema.ts`, no objeto `stt` (L31-34), adicionar (mantendo o wrapper/`.prefault` como está):

```ts
captura: z.enum(['segmentada', 'classica']).default('segmentada'), // ditado do balão; refino por voz segue clássico
pausaMs: z.number().int().min(400).max(5000).default(1200), // silêncio que fecha um trecho de fala
```

- [ ] **Step 4: Seção "Ditado" nas Configurações**

Em `src/renderer/settings/main.tsx`, criar uma seção nova "Ditado" seguindo EXATAMENTE o padrão visual/JSX dos campos existentes (a tela hoje edita `ui.*` e `macros` via `configGet`/`configSet` — replicar um bloco existente):

- Select "Captura de voz": opções `Segmentada (recomendado)` → `'segmentada'` e `Clássica` → `'classica'`, valor de `config.stt.captura`, salvando com `configSet({ stt: { captura: valor } })`.
- Campo numérico "Pausa que fecha o trecho (s)": exibe `config.stt.pausaMs / 1000` com step 0.1, min 0.4, max 5; salva `configSet({ stt: { pausaMs: Math.round(valor * 1000) } })`.
- Texto auxiliar (classe de texto suave existente): "Na captura segmentada, só os trechos com fala são enviados para transcrição."

- [ ] **Step 5: Rodar e ver passar** — `npm test && npm run typecheck` verdes.

- [ ] **Step 6: Commit**

```bash
git add src/core/config/schema.ts src/core/config/*.test.ts src/renderer/settings/main.tsx
git commit -m "config: stt.captura (segmentada|classica) e stt.pausaMs com seção Ditado nas Configurações"
```

---

### Task 10: Renderer float — sessão VAD, novos estados `ouvindo`/`falando`, fallback clássico

O coração da UX. Fases novas: `idle → ouvindo ⇄ falando → processando → ok|erro` (segmentada) mantendo `gravando` para o modo clássico intocado. Pontos que o red-team mapeou e PRECISAM mudar juntos: `toggle()` (main.tsx:55-59), Esc (L91-93), timer (L124), tooltip `titulo` (L112-117) e `Icone()` (L8-13) — todos checam `fase === 'gravando'` literal e devem tratar `ouvindo`/`falando` no mesmo ramo de "sessão ativa". O float passa a ler config no início de cada sessão (`configGet`), primeira vez que essa janela consulta config. Erro de `getUserMedia` (hoje não tratado) vira fase `erro` com mensagem.

**Files:**
- Create: `src/renderer/float/captura-vad.ts`
- Modify: `src/renderer/float/main.tsx`, `src/renderer/float/index.html` (CSS dos estados)

**Interfaces:**
- Consumes: `float32ParaInt16`/`duracaoMs` (`src/core/audio/pcm.ts`, Task 2 — único import de core permitido no renderer); preload `sessaoIniciar`/`sessaoSegmento`/`sessaoEncerrar`/`sessaoCancelar` (Task 7); `configGet` (existente); expressão de `baseAssetPath` validada na Task 1
- Produces: `iniciarCapturaVad(opts): Promise<CapturaVad>` com `CapturaVad { parar(): Promise<void>; cancelar(): Promise<void> }`

- [ ] **Step 1: `captura-vad.ts`**

```ts
import { MicVAD } from '@ricky0123/vad-web';
import { duracaoMs, float32ParaInt16 } from '../../core/audio/pcm.js';

export interface CapturaVad {
  /** Encerra flushando o segmento em andamento (submitUserSpeechOnPause). */
  parar(): Promise<void>;
  /** Encerra descartando tudo (Esc). */
  cancelar(): Promise<void>;
}

export interface OpcoesCaptura {
  pausaMs: number; // silêncio que fecha um trecho (config.stt.pausaMs)
  aoFalar(): void;
  aoSilenciar(): void;
  aoSegmento(pcm: Int16Array, durationMs: number): void;
}

// Usar a expressão EXATA validada no spike da Task 1:
const BASE = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();

export async function iniciarCapturaVad(opts: OpcoesCaptura): Promise<CapturaVad> {
  const vad = await MicVAD.new({
    model: 'v5',
    baseAssetPath: BASE,
    onnxWASMBasePath: BASE,
    redemptionMs: opts.pausaMs, // silêncio que fecha o segmento
    preSpeechPadMs: 800,        // não corta a primeira sílaba (default da lib)
    minSpeechMs: 400,           // estalos/cliques não viram segmento
    submitUserSpeechOnPause: true, // parar() no meio de uma fala flusha o trecho via onSpeechEnd
    onSpeechStart: () => opts.aoFalar(),
    onVADMisfire: () => opts.aoSilenciar(),
    onSpeechEnd: (audio: Float32Array) => {
      opts.aoSilenciar();
      const pcm = float32ParaInt16(audio); // novo array → .buffer tem o tamanho exato
      opts.aoSegmento(pcm, duracaoMs(audio.length));
    },
  });
  vad.start();
  return {
    async parar() {
      vad.pause(); // dispara onSpeechEnd do trecho em andamento, se houver
      vad.destroy();
    },
    async cancelar() {
      vad.destroy();
    },
  };
}
```

(Se o typecheck apontar nomes de opções divergentes na versão pinada — ex.: sufixo `Frames` em vez de `Ms` —, ajustar para os nomes reais de `@ricky0123/vad-web@0.0.29` mantendo os MESMOS valores efetivos; registrar no report.)

- [ ] **Step 2: `main.tsx` — fases e fluxo segmentado**

Mudanças em `src/renderer/float/main.tsx`:

1. `type Fase = 'idle' | 'ouvindo' | 'falando' | 'gravando' | 'processando' | 'ok' | 'erro'` (L6). Definir `const SESSAO_ATIVA: Fase[] = ['ouvindo', 'falando']` e um helper `emSessao = (f: Fase) => SESSAO_ATIVA.includes(f)`.
2. Refs novos: `captura = useRef<CapturaVad | null>(null)`, `inicioSessao = useRef(0)`, `falaMs = useRef(0)`, `inicioFala = useRef<number | null>(null)`.
3. `iniciar()` bifurca por config (o caminho MediaRecorder atual vira `iniciarClassico()`, movido SEM alteração de lógica):

```ts
async function iniciar() {
  try {
    const config = await window.aerolince.configGet();
    if (config.stt.captura === 'classica') return iniciarClassico();
    const r = await window.aerolince.sessaoIniciar();
    if (!r.ok) throw new Error(r.erro ?? 'Não consegui iniciar o ditado.');
    // r.semCofre === true → seguir normalmente, mas registrar no tooltip:
    // "Sem cofre do sistema: o ditado não será recuperável se o app fechar."
    inicioSessao.current = Date.now();
    falaMs.current = 0;
    setFase('ouvindo');
    captura.current = await iniciarCapturaVad({
      pausaMs: config.stt.pausaMs,
      aoFalar: () => { inicioFala.current = Date.now(); setFase('falando'); },
      aoSilenciar: () => { inicioFala.current = null; setFase((f) => (f === 'falando' ? 'ouvindo' : f)); },
      aoSegmento: (pcm, ms) => {
        falaMs.current += ms;
        void window.aerolince.sessaoSegmento(pcm.buffer as ArrayBuffer, ms);
      },
    });
  } catch (e) {
    captura.current = null;
    void window.aerolince.sessaoCancelar();
    setFase('erro');
    // reutilizar o mecanismo de aviso existente (mesmo caminho do evento 'estado' de erro):
    // mensagem p/ NotAllowedError/NotFoundError de getUserMedia: 'Permita o acesso ao microfone para ditar.'
  }
}
```

4. `parar()`/`toggle()`: quando `emSessao(fase)`, encerrar = `await captura.current?.parar(); captura.current = null; setFase('processando'); const r = await window.aerolince.sessaoEncerrar();` — o restante (eventos `'estado'` → ok/erro) já é tratado pelo listener existente (L94-109), igual ao fluxo atual. Manter o ramo `fase === 'gravando'` como está (clássico).
5. Esc (L91-93): quando `emSessao(fase)`, `await captura.current?.cancelar(); captura.current = null; void window.aerolince.sessaoCancelar(); setFase('idle');` (mais o ramo atual do clássico).
6. Timer (L124): em sessão segmentada mostrar **fala · total** — `fala = falaMs.current + (inicioFala.current ? Date.now() - inicioFala.current : 0)`, `total = Date.now() - inicioSessao.current`, formatados com o mesmo `fmt` do contador atual: `0:42 · 3:10`. No clássico, contador atual inalterado.
7. `titulo` (L112-117): `ouvindo` → `'Ouvindo — clique para gerar o laudo (Esc cancela)'`; `falando` → `'Registrando sua fala…'`.
8. `Icone` (L8-13): `ouvindo` e `falando` usam o MESMO ícone de `gravando` (quadrado "parar" — clique encerra), diferenciação fica no CSS.
9. Remover o acionador oculto do spike (Task 1).

- [ ] **Step 3: CSS dos estados em `float/index.html`**

Junto das classes existentes (`.botao.gravando` etc., L43-69), usando SÓ tokens de `brand.css` (sem cores novas):

```css
/* sessão aberta, aguardando fala — respiração lenta */
.botao.ouvindo {
  box-shadow: 0 0 0 2px var(--oxido-suave);
  animation: respirar 2.4s ease-in-out infinite;
}
/* registrando fala — mesmo peso visual do gravando atual */
.botao.falando {
  box-shadow: 0 0 0 3px var(--oxido);
  animation: /* reutilizar o keyframe de pulso da classe .gravando existente */;
}
@keyframes respirar {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
```

- [ ] **Step 4: Validar manualmente em dev**

Run: `npm run dev` → clique → falar/pausar/falar → clique encerra → laudo. Conferir: balão alterna `ouvindo`/`falando`; contador `fala · total` avança só a fala durante silêncio… (total avança sempre); Esc cancela; Configurações → Clássica → fluxo antigo intacto.
Run: `npm run typecheck && npm test` → verdes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/float/captura-vad.ts src/renderer/float/main.tsx src/renderer/float/index.html
git commit -m "float: sessão de escuta com VAD (ouvindo/falando), consolidação no encerramento e fallback clássico por config"
```

---

### Task 11: Recovery no boot — ditado interrompido vira laudo, não perda

No boot (depois de `carregarChaves` dentro de `bootstrap()` — timing confirmado: `main/index.ts:356-357`), varrer o spool: expirar >48 h, oferecer a sessão órfã mais recente num diálogo nativo, transcrever pela MESMA rota da sessão normal (`gerarDeSegmentos`, Task 7). Cofre indisponível ou manifest inválido → só oferecer descarte (espelha a assimetria de `secrets.ts`: leitura degrada, nunca lança no boot).

**Files:**
- Create: `src/main/audio/recovery.ts`, `src/main/audio/recovery.test.ts`
- Modify: `src/main/index.ts` (chamada no `bootstrap()`)

**Interfaces:**
- Consumes: `SpoolSessao.abrir`/`listarSessoesOrfas`/`apagarSessoesAntigas` (Task 6); `gerarDeSegmentos` (Task 7); `dialog` do Electron
- Produces: `recuperarSpoolOrfao(spoolRoot: string, transcrever: (segmentos: Int16Array[], speechMs: number) => Promise<void>): Promise<void>` (callback injetado = testável sem pipeline)

- [ ] **Step 1: Testes que falham**

Criar `src/main/audio/recovery.test.ts` (mock de `electron` com `safeStorage` da Task 6 + `dialog.showMessageBox` mockável):

```ts
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().replace(/^enc:/, '')),
  },
  dialog: {
    showMessageBox: vi.fn(async () => ({ response: 0 })),
    showErrorBox: vi.fn(),
  },
}));

const { SpoolSessao, listarSessoesOrfas } = await import('./spool.js');
const { recuperarSpoolOrfao } = await import('./recovery.js');
const { dialog } = await import('electron');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rec-')); vi.clearAllMocks(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const pcm = (n: number) => Buffer.from(new Int16Array(n).fill(3).buffer);

describe('recuperarSpoolOrfao', () => {
  it('sem órfãs → nem diálogo nem transcrição', async () => {
    const transcrever = vi.fn();
    await recuperarSpoolOrfao(root, transcrever);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(transcrever).not.toHaveBeenCalled();
  });

  it('órfã com >48h é apagada em silêncio', async () => {
    const spool = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 72 * 3600_000) / 1000;
    utimesSync(spool.dir, antes, antes);
    await recuperarSpoolOrfao(root, vi.fn());
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it('Transcrever agora → callback recebe os segmentos e o spool é apagado', async () => {
    const spool = SpoolSessao.criar(root)!;
    spool.appendSegmento(pcm(1600), 100);
    spool.appendSegmento(pcm(800), 50);
    const transcrever = vi.fn(async () => {});
    await recuperarSpoolOrfao(root, transcrever);
    expect(transcrever).toHaveBeenCalledTimes(1);
    const [segs, speechMs] = transcrever.mock.calls[0];
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(1600);
    expect(speechMs).toBe(150);
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });

  it('Descartar → apaga sem transcrever', async () => {
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1 } as never);
    const transcrever = vi.fn();
    await recuperarSpoolOrfao(root, transcrever);
    expect(transcrever).not.toHaveBeenCalled();
    expect(listarSessoesOrfas(root)).toHaveLength(0);
  });

  it('falha na transcrição preserva o spool para o próximo boot', async () => {
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    const transcrever = vi.fn(async () => { throw new Error('rede caiu'); });
    await expect(recuperarSpoolOrfao(root, transcrever)).rejects.toThrow('rede caiu');
    expect(listarSessoesOrfas(root)).toHaveLength(1);
  });

  it('só a mais recente é oferecida; demais órfãs são apagadas', async () => {
    const velha = SpoolSessao.criar(root)!;
    const antes = (Date.now() - 3600_000) / 1000;
    utimesSync(velha.dir, antes, antes);
    SpoolSessao.criar(root)!.appendSegmento(pcm(100), 10);
    await recuperarSpoolOrfao(root, vi.fn(async () => {}));
    expect(listarSessoesOrfas(root)).toHaveLength(0);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementação**

Criar `src/main/audio/recovery.ts`:

```ts
import { rmSync } from 'node:fs';
import { dialog } from 'electron';
import { apagarSessoesAntigas, listarSessoesOrfas, SpoolSessao } from './spool.js';

const MAX_IDADE_MS = 48 * 60 * 60 * 1000;

export async function recuperarSpoolOrfao(
  spoolRoot: string,
  transcrever: (segmentos: Int16Array[], speechMs: number) => Promise<void>,
): Promise<void> {
  apagarSessoesAntigas(spoolRoot, MAX_IDADE_MS);
  const dirs = listarSessoesOrfas(spoolRoot);
  if (dirs.length === 0) return;

  const [maisRecente, ...demais] = dirs;
  for (const dir of demais) rmSync(dir, { recursive: true, force: true });

  const spool = SpoolSessao.abrir(maisRecente);
  if (!spool) {
    // manifest inválido ou cofre indisponível — não dá para decifrar; nunca travar o boot
    rmSync(maisRecente, { recursive: true, force: true });
    return;
  }

  const speechMs = spool.meta.segmentos.reduce((soma, s) => soma + s.durationMs, 0);
  const minutos = Math.max(1, Math.round(speechMs / 60_000));
  const quando = new Date(spool.meta.criadoEm).toLocaleString('pt-BR');
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Encontrei um ditado interrompido',
    detail: `De ${quando}, com ~${minutos} min de fala. Transcrever agora?`,
    buttons: ['Transcrever agora', 'Descartar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) {
    spool.descartar();
    return;
  }

  const segmentos = spool
    .listarSegmentos()
    .map((b) => new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  await transcrever(segmentos, speechMs); // se lançar, o spool FICA (próximo boot, ≤48 h)
  spool.descartar();
}
```

- [ ] **Step 4: Wiring no `bootstrap()`**

Em `src/main/index.ts`, dentro de `bootstrap()` DEPOIS de `carregarChaves(...)`:

```ts
void recuperarSpoolOrfao(spoolRoot(), (segmentos, speechMs) =>
  gerarDeSegmentos(segmentos, speechMs, speechMs), // capturedMs desconhecido → usar speechMs (ratio 1)
).catch((e) => {
  dialog.showErrorBox(
    'Recuperação do ditado falhou',
    `${e instanceof Error ? e.message : e}\n\nO ditado continua guardado (cifrado) e será oferecido de novo na próxima abertura, por até 48 h.`,
  );
});
```

- [ ] **Step 5: Rodar e ver passar** — `npm test && npm run typecheck` verdes.

- [ ] **Step 6: Commit**

```bash
git add src/main/audio/recovery.ts src/main/audio/recovery.test.ts src/main/index.ts
git commit -m "recovery no boot: ditado interrompido é oferecido (transcrever/descartar), expira em 48h, nunca trava o boot"
```

---

### Task 12: Docs e textos honestos — o spool cifrado muda a história de privacidade

A Fase A escreveu "o áudio não é gravado em disco". Com o spool cifrado isso deixa de ser verdade literal — a política vira "áudio nunca toca o disco **em claro**, retenção zero após transcrição, recuperação ≤48 h". Padrão PRIV-03: os textos contam o fluxo real.

**Files:**
- Modify: `docs/privacidade.md`, `CLAUDE.md`, `src/renderer/onboarding/main.tsx`

**Interfaces:**
- Consumes: comportamento implementado nas Tasks 6/7/11 (spool cifrado, retenção, recovery)
- Produces: — (só texto)

- [ ] **Step 1: `docs/privacidade.md`**

No princípio 2 (`## Princípios`), substituir a frase "O áudio não é gravado em disco (segue da memória direto para a API)" por:

```markdown
Durante a sessão de escuta, só os trechos com fala são registrados. Eles ficam temporariamente no
disco **cifrados** (AES-256-GCM, chave de sessão protegida pelo cofre do sistema operacional via
`safeStorage`) e são apagados logo após a transcrição. Se o app falhar no meio do ditado, os trechos
cifrados permanecem por até 48 h para recuperação e depois são apagados. Áudio em claro nunca toca o disco.
```

- [ ] **Step 2: `CLAUDE.md`**

No bullet de privacidade que diz "no app nunca é gravado em disco (a CLI de desenvolvimento grava `.wav` local, fora do git)", trocar por:

```markdown
no app, só os trechos com fala são retidos — cifrados em disco (spool AES-256-GCM com chave no
cofre do SO) e apagados após a transcrição; em caso de crash, ficam ≤48 h para recuperação (a CLI
de desenvolvimento grava `.wav` local, fora do git)
```

Na seção `## Arquitetura`, na lista de `src/core/`, acrescentar após a linha do `anonymizer/`:

```markdown
  - `audio/` — PCM/WAV/consolidação/cripto do spool (puro; `pcm.ts` é o único módulo importável pelo renderer)
```

- [ ] **Step 3: Onboarding**

Em `src/renderer/onboarding/main.tsx`, no passo "Voz na nuvem, laudo no seu computador", após a frase "Máscaras e laudos ficam apenas no seu computador.", acrescentar dentro do mesmo `<>`:

```tsx
{' '}O app só registra os trechos em que você fala — pausas não são enviadas nem cobradas — e esses
trechos ficam cifrados no seu computador só até a transcrição terminar.
```

- [ ] **Step 4: Verificar e commitar**

Run: `npm run typecheck && npm test`

```bash
git add docs/privacidade.md CLAUDE.md src/renderer/onboarding/main.tsx
git commit -m "textos honestos: spool cifrado com retenção zero pós-transcrição (privacidade, CLAUDE.md, onboarding)"
```

---

## Verificação final da fase (manual, com o usuário)

Depois da Task 12, com chaves no cofre:

1. `npm run dev` → clique no balão → falar uma frase → **pausar ~10 s** (balão deve mostrar "ouvindo", sem registrar) → falar outra frase → clique encerra → 1 laudo correto das duas frases. No sidecar da geração: bloco `audio` com `speechMs` ≪ `capturedMs`, `speechRatio` < 1, `custoSttUSD` > 0 e `custoUSD` total incluindo o STT.
2. Clique → ficar em silêncio → clique encerra → aviso "sem áudio" (comportamento atual preservado).
3. **Crash no meio**: clique → ditar → `kill -9 <pid do app>` → reabrir `npm run dev` → diálogo "ditado interrompido… Transcrever agora?" → Transcrever → laudo gerado; pasta `<userData>/spool/` vazia ao final.
4. **Esc durante a escuta** → sessão cancelada, `<userData>/spool/` sem resíduo da sessão.
5. Configurações → Captura de voz: **Clássica** → ditar → fluxo antigo (MediaRecorder) funciona igual ao de hoje.
6. Aumentar a pausa (`stt.pausaMs` = 2500 nas Configurações) → pausas curtas de fala deixam de fechar segmento (perceptível no balão).
7. **Empacotado real**: `npm run build:app && npx electron-builder --dir` → abrir o app de `release/` → ditar funciona sob `file://` com asar; devtools → Network sem NENHUM request a CDN.
8. Inspecionar `<userData>/spool/` durante um ditado: arquivos `seg-*.bin` ilegíveis (cifrados), nenhum `.wav`/`.webm` em claro.
9. No commit de fechamento da branch: atualizar `docs/ESTADO.md` (nova seção "Áudio segmentado" + "Comece por aqui" + contagem de testes), como no padrão da Fase A.

Testes de plantão real (60 min, memória estável, corpus da proposta §9) ficam para o **gate de campo**, já pendente no ESTADO.md.

## Fora do escopo desta fase (próximas)

- **Fase B da auditoria** — STATE-01 (`ReportSession` canônica), SAFE-02 (patch JSON estruturado), QA-01 (golden set clínico) — plano SDD próprio, na sequência (decisão do usuário em 20/07).
- Wake word / modo mãos-livres sem clique; pedal físico (a arquitetura de sessão aceita novas fronteiras de intenção depois).
- `whisper.cpp` local (proposta Fase 3) e A/B de `gpt-4o-mini-transcribe` (shadow mode) — a interface `TranscriptionProvider`/pricing já deixa o encaixe pronto.
- Transcript incremental visível durante o ditado; fila offline com retry persistente entre reinícios (o spool cobre crash; retry de rede fica no SDK).
- CLI `laudo gravar` segmentada (segue ffmpeg/WAV como está).
- Refino por voz segmentado — o refino é fala curta de segundos; continua no caminho clássico (confirmar na Task 10).
