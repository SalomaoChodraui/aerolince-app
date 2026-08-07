# Bloco 1 — BYOK e provedor único — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O app roda 100% com as chaves do próprio médico — OpenAI sempre obrigatória (STT), Anthropic obrigatória só no motor padrão — com modo de provedor único (só OpenAI) e custo estimado honesto para modelos GPT.

**Architecture:** Extrair a interface `LLMProvider` do wrapper Anthropic concreto; criar `OpenAIProvider` (chat.completions) e uma factory `criarLLM(config)` que resolve provider+modelos a partir do novo campo `llm.provider`; gate de chaves passa a ser derivado da config (`chavesNecessarias`). UI: componente compartilhado `ChavesApi` (Settings + onboarding), seletor "Motor de geração" na Settings e onboarding bloqueante até as chaves necessárias estarem válidas.

**Tech Stack:** TypeScript strict ESM, Electron, React 19, zod, vitest, `@anthropic-ai/sdk`, `openai` (já é dependência do STT).

**Spec:** `docs/superpowers/specs/2026-08-07-inteligencia-do-medico-byok-design.md`

## Global Constraints

- TypeScript strict, ESM, imports relativos com extensão `.js` (mesmo em .ts).
- Validação zod em TODAS as fronteiras (config, respostas de LLM).
- `src/core/` é Node puro: PROIBIDO importar Electron lá.
- Strings voltadas ao usuário em PT-BR com acentuação correta; identificadores em PT sem acento (`criarLLM`, `chavesNecessarias`).
- Testes vitest ao lado do código (`*.test.ts`). Nenhum teste usa laudo real — fixtures sintéticas.
- Nunca commitar chave de API; nunca logar valor de chave.
- Suíte inteira verde antes de cada commit: `npm test` (149 testes hoje) e `npm run typecheck`.
- Trabalhar em branch `bloco1-byok` a partir de `main`.

---

### Task 1: Extrair a interface `LLMProvider` para `core/llm/types.ts`

**Files:**
- Create: `src/core/llm/types.ts`
- Modify: `src/core/llm/anthropic.ts` (tipos saem; classe implementa a interface; re-export para compat)
- Modify: `src/core/engine/engine.ts` (anotações de tipo `LLMClient` → `LLMProvider` nos parâmetros `llm` de `selectMask`, `generate`, `refine` e helpers internos que o typecheck apontar)
- Test: `src/core/llm/types.test.ts`

**Interfaces:**
- Produces: `interface LLMProvider { complete(params: CompleteParams): Promise<LLMResult> }`, tipos `LLMUsage`, `LLMResult`, `SystemBlock`, `CompleteParams` em `core/llm/types.ts`. `anthropic.ts` continua exportando os mesmos nomes (re-export) — nenhum import existente quebra.

- [ ] **Step 1: Escrever o teste que falha**

`src/core/llm/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LLMClient } from './anthropic.js';
import type { CompleteParams, LLMProvider, LLMResult } from './types.js';

describe('LLMProvider', () => {
  it('LLMClient satisfaz a interface (atribuição estrutural)', () => {
    const p: LLMProvider = new LLMClient({ apiKey: 'sk-teste-nao-usada' });
    expect(typeof p.complete).toBe('function');
  });

  it('um provider fake mínimo satisfaz a interface', async () => {
    const fake: LLMProvider = {
      complete: async (params: CompleteParams): Promise<LLMResult> => ({
        text: `eco:${params.user}`,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const r = await fake.complete({ model: 'x', system: [], user: 'oi', maxTokens: 10 });
    expect(r.text).toBe('eco:oi');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/llm/types.test.ts`
Expected: FAIL — `Cannot find module './types.js'`

- [ ] **Step 3: Criar `src/core/llm/types.ts`**

Mover (recortar) de `anthropic.ts` as interfaces `LLMUsage`, `LLMResult`, `SystemBlock`, `CompleteParams` e acrescentar a interface do provedor:

```ts
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage;
}

export interface SystemBlock {
  text: string;
  /** Marca este bloco como fronteira de prompt caching (conteúdo estável). */
  cache?: boolean;
}

export interface CompleteParams {
  model: string;
  system: SystemBlock[];
  user: string;
  maxTokens: number;
}

/** Contrato mínimo de um provedor de LLM (Anthropic, OpenAI, …). */
export interface LLMProvider {
  complete(params: CompleteParams): Promise<LLMResult>;
}
```

- [ ] **Step 4: Adaptar `anthropic.ts`**

No topo, substituir as definições movidas por:

```ts
import type { CompleteParams, LLMProvider, LLMResult, LLMUsage, SystemBlock } from './types.js';

export type { CompleteParams, LLMProvider, LLMResult, LLMUsage, SystemBlock } from './types.js';
```

E a classe passa a declarar a interface (assinatura de `complete` inalterada):

```ts
export class LLMClient implements LLMProvider {
```

- [ ] **Step 5: Ajustar `engine.ts`**

Trocar a anotação de tipo do parâmetro `llm` (hoje `LLMClient`) para `LLMProvider` em `selectMask`, `generate`, `refine` e em qualquer helper interno que receba `llm` (ex.: `runPatches`). Trocar o import de tipo correspondente para `import type { LLMProvider } from '../llm/types.js'` (mantendo os imports de valor que já existam). Nenhuma lógica muda.

- [ ] **Step 6: Rodar teste novo + suíte + typecheck**

Run: `npx vitest run src/core/llm/types.test.ts` → PASS
Run: `npm test` → 149 + 2 PASS; `npm run typecheck` → sem erros

- [ ] **Step 7: Commit**

```bash
git add src/core/llm/types.ts src/core/llm/types.test.ts src/core/llm/anthropic.ts src/core/engine/engine.ts
git commit -m "core/llm: extrai interface LLMProvider (precedente STTProvider) — engine aceita qualquer provedor"
```

---

### Task 2: Preços GPT-5 e fim do custo-zero silencioso em `estimateCostUSD`

**Files:**
- Modify: `src/core/llm/anthropic.ts:91-109` (`estimateCostUSD`)
- Modify: `src/main/pipeline.ts:280-285` e `:318` (soma com null + aviso)
- Modify: `src/cli/index.ts:119,183,298,332` (imprimir "não estimado" quando null)
- Modify: `scripts/compactar-frasario.ts:50` (idem)
- Test: `src/core/llm/anthropic.test.ts` (criar ou estender o existente ao lado)

**Interfaces:**
- Produces: `estimateCostUSD(model: string, usage: LLMUsage): number | null` — **null** para modelo fora da tabela (antes retornava 0 silencioso).
- Consumes: `LLMUsage` de `core/llm/types.ts` (Task 1).

- [ ] **Step 1: Teste que falha**

Em `src/core/llm/anthropic.test.ts` (criar se não existir; se existir, acrescentar o describe):

```ts
import { describe, expect, it } from 'vitest';
import { estimateCostUSD } from './anthropic.js';

const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe('estimateCostUSD', () => {
  it('conhece a família gpt-5 (prefixos mais específicos primeiro)', () => {
    expect(estimateCostUSD('gpt-5-mini', usage)).toBeCloseTo(0.25 + 2.0, 5);
    expect(estimateCostUSD('gpt-5-nano', usage)).toBeCloseTo(0.05 + 0.4, 5);
    expect(estimateCostUSD('gpt-5', usage)).toBeCloseTo(1.25 + 10.0, 5);
  });

  it('cache read da OpenAI é 0,1× o input', () => {
    const u = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    expect(estimateCostUSD('gpt-5', u)).toBeCloseTo(0.125, 5);
  });

  it('modelo desconhecido devolve null, não 0', () => {
    expect(estimateCostUSD('modelo-misterioso', usage)).toBeNull();
  });

  it('tabela Anthropic continua igual', () => {
    expect(estimateCostUSD('claude-haiku-4-5', usage)).toBeCloseTo(1 + 5, 5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/llm/anthropic.test.ts` → FAIL (gpt devolve 0; desconhecido devolve 0)

- [ ] **Step 3: Implementar**

Substituir `estimateCostUSD` em `anthropic.ts`:

```ts
/**
 * Estimativa de custo em USD (preços por MTok; atualizar se a tabela mudar).
 * ATENÇÃO: o match é por prefixo — prefixos mais específicos vêm ANTES
 * ('gpt-5-mini' antes de 'gpt-5'). Modelo fora da tabela → null (o chamador
 * mostra "custo não estimado"; nunca 0 silencioso).
 */
export function estimateCostUSD(model: string, usage: LLMUsage): number | null {
  const prices: Record<string, [number, number]> = {
    'claude-haiku-4-5': [1, 5],
    'claude-sonnet-5': [3, 15],
    // Moonshot/Kimi K2 — aproximado; conferir a tabela vigente em platform.moonshot.ai
    'kimi-': [0.6, 2.5],
    // OpenAI GPT-5 (BYOK modo provedor único) — cached input = 0,1× (cobre o termo cacheRead)
    'gpt-5-nano': [0.05, 0.4],
    'gpt-5-mini': [0.25, 2],
    'gpt-5': [1.25, 10],
  };
  const key = Object.keys(prices).find((k) => model.startsWith(k));
  if (!key) return null;
  const [inP, outP] = prices[key]!;
  // Cache: escrita custa 1,25× o input; leitura custa 0,1× (OpenAI não tem cacheWrite — termo zera)
  return (
    (usage.inputTokens * inP +
      usage.cacheWriteTokens * inP * 1.25 +
      usage.cacheReadTokens * inP * 0.1 +
      usage.outputTokens * outP) /
    1_000_000
  );
}
```

- [ ] **Step 4: Adaptar os chamadores**

`src/main/pipeline.ts` — em `gerarLaudo` (linhas ~280-285), trocar o cálculo por:

```ts
const custoSel = sel.usage ? estimateCostUSD(config.llm.selectionModel, sel.usage) : 0;
const custoGer = estimateCostUSD(config.llm.generationModel, gen.usage);
const avisosCusto =
  custoSel === null || custoGer === null
    ? ['custo não estimado — o modelo configurado não está na tabela de preços']
    : [];
```

e no objeto retornado: `avisos: [...avisosSanitizacao, ...gen.avisos, ...avisosCusto],` e
`custoUSD: Number(((custoSel ?? 0) + (custoGer ?? 0)).toFixed(4)),`.

Em `refinarTranscript` (linha ~318), mesmo padrão:

```ts
const custoRef = estimateCostUSD(config.llm.generationModel, gen.usage);
```

`avisos: [...san.avisos, ...gen.avisos, ...(custoRef === null ? ['custo não estimado — o modelo configurado não está na tabela de preços'] : [])],` e `custoUSD: Number((custoRef ?? 0).toFixed(4)),`.

`src/cli/index.ts` — nos 4 pontos que imprimem custo, usar o padrão (adaptar ao texto existente de cada linha):

```ts
const custo = estimateCostUSD(modelo, usage);
console.log(custo === null ? '   custo: não estimado (modelo fora da tabela)' : `   custo: US$ ${custo.toFixed(4)}`);
```

`scripts/compactar-frasario.ts:50` — mesmo padrão do CLI.

- [ ] **Step 5: Rodar suíte + typecheck** — `npm test` e `npm run typecheck` → verdes (o typecheck é o guia: qualquer soma com `number | null` esquecida quebra a compilação)

- [ ] **Step 6: Commit**

```bash
git add src/core/llm/anthropic.ts src/core/llm/anthropic.test.ts src/main/pipeline.ts src/cli/index.ts scripts/compactar-frasario.ts
git commit -m "custo: tabela gpt-5 + modelo desconhecido vira aviso 'não estimado' (nunca mais 0 silencioso)"
```

---

### Task 3: `OpenAIProvider` em `core/llm/openai.ts`

**Files:**
- Create: `src/core/llm/openai.ts`
- Test: `src/core/llm/openai.test.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `CompleteParams`, `LLMResult` de `core/llm/types.ts` (Task 1).
- Produces: `class OpenAIProvider implements LLMProvider`, construtor `(opts?: { apiKey?: string; client?: ChatClient })` — `client` é injeção para teste. `ChatClient` = `Pick<OpenAI, 'chat'>`.

- [ ] **Step 1: Teste que falha**

`src/core/llm/openai.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from './openai.js';

function fakeClient(resposta: unknown) {
  const create = vi.fn().mockResolvedValue(resposta);
  return { client: { chat: { completions: { create } } } as never, create };
}

const RESPOSTA = {
  choices: [{ message: { content: 'laudo aqui' } }],
  usage: {
    prompt_tokens: 1200,
    completion_tokens: 300,
    prompt_tokens_details: { cached_tokens: 1000 },
  },
};

describe('OpenAIProvider', () => {
  it('concatena os SystemBlocks numa única mensagem system e mapeia o usage', async () => {
    const { client, create } = fakeClient(RESPOSTA);
    const p = new OpenAIProvider({ client });
    const r = await p.complete({
      model: 'gpt-5-mini',
      system: [{ text: 'A', cache: true }, { text: 'B' }],
      user: 'comando',
      maxTokens: 500,
    });
    expect(create).toHaveBeenCalledWith({
      model: 'gpt-5-mini',
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: 'A\n\nB' },
        { role: 'user', content: 'comando' },
      ],
    });
    expect(r.text).toBe('laudo aqui');
    // prompt_tokens da OpenAI INCLUI os cacheados — inputTokens é o restante
    expect(r.usage).toEqual({ inputTokens: 200, outputTokens: 300, cacheReadTokens: 1000, cacheWriteTokens: 0 });
  });

  it('resposta sem usage ou sem texto não explode', async () => {
    const { client } = fakeClient({ choices: [{ message: { content: null } }] });
    const p = new OpenAIProvider({ client });
    const r = await p.complete({ model: 'gpt-5', system: [], user: 'x', maxTokens: 10 });
    expect(r.text).toBe('');
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/llm/openai.test.ts` → FAIL (módulo não existe)

- [ ] **Step 3: Implementar `src/core/llm/openai.ts`**

```ts
/**
 * Provedor OpenAI (modo provedor único do BYOK): mapeia o contrato LLMProvider
 * para chat.completions. Os SystemBlocks viram UMA mensagem system (a OpenAI
 * não tem blocos nem cache_control — o caching lá é automático, e aparece em
 * usage.prompt_tokens_details.cached_tokens). prompt_tokens INCLUI os tokens
 * cacheados; inputTokens aqui é o restante, para o estimateCostUSD não cobrar
 * duas vezes.
 */
import OpenAI from 'openai';
import type { CompleteParams, LLMProvider, LLMResult } from './types.js';

type ChatClient = Pick<OpenAI, 'chat'>;

export interface OpenAIProviderOptions {
  apiKey?: string;
  /** Injeção para testes — objeto compatível com o cliente oficial. */
  client?: ChatClient;
}

export class OpenAIProvider implements LLMProvider {
  private client: ChatClient;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.client = opts.client ?? new OpenAI(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
  }

  async complete(params: CompleteParams): Promise<LLMResult> {
    const system = params.system.map((b) => b.text).join('\n\n');
    const r = await this.client.chat.completions.create({
      model: params.model,
      max_completion_tokens: params.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: params.user },
      ],
    });
    const texto = r.choices[0]?.message?.content ?? '';
    const u = r.usage;
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: texto,
      usage: {
        inputTokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached),
        outputTokens: u?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }
}
```

Nota: se o typecheck reclamar do retorno de `create` (união com stream), tipar a chamada com `as OpenAI.Chat.Completions.ChatCompletion` após o `await` — nunca usar `any`.

- [ ] **Step 4: Rodar** — `npx vitest run src/core/llm/openai.test.ts` → PASS; `npm run typecheck` → ok

- [ ] **Step 5: Commit**

```bash
git add src/core/llm/openai.ts src/core/llm/openai.test.ts
git commit -m "core/llm: OpenAIProvider — modo provedor único do BYOK (chat.completions, usage com cached_tokens)"
```

---

### Task 4: `llm.provider` na config + factory `criarLLM` + `chavesNecessarias`

**Files:**
- Modify: `src/core/config/schema.ts:37-46` (campo novo no objeto `llm`)
- Create: `src/core/llm/factory.ts`
- Modify: `src/renderer/shared/types.ts` (espelho manual da config)
- Test: `src/core/llm/factory.test.ts`

**Interfaces:**
- Produces:
  - Config: `llm.provider: 'anthropic' | 'openai'` (default `'anthropic'`).
  - `MODELOS_PADRAO: { anthropic: {selecao, geracao, rapido}, openai: {selecao, geracao, rapido} }`
  - `criarLLM(config: Config): { llm: LLMProvider; modelos: { selecao: string; geracao: string; rapido: string } }` — resolve provider e CORRIGE modelo incompatível (modelo `claude-*`/`kimi-*` com provider openai → default openai; modelo `gpt-*` com provider anthropic → default anthropic).
  - `chavesNecessarias(config: Config): NomeChaveNecessaria[]` com `type NomeChaveNecessaria = 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY'` — OpenAI sempre; Anthropic só se `provider === 'anthropic'`.

- [ ] **Step 1: Teste que falha**

`src/core/llm/factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config/schema.js';
import { LLMClient } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { chavesNecessarias, criarLLM, MODELOS_PADRAO } from './factory.js';

function cfg(llm: Record<string, unknown>) {
  return ConfigSchema.parse({
    masksDir: '/x',
    profilesDir: '/x',
    outputDir: '/x',
    stt: {},
    llm,
  });
}

describe('criarLLM', () => {
  it('default é Anthropic com os modelos configurados', () => {
    const r = criarLLM(cfg({}));
    expect(r.llm).toBeInstanceOf(LLMClient);
    expect(r.modelos).toEqual({ selecao: 'claude-haiku-4-5', geracao: 'claude-haiku-4-5', rapido: 'claude-haiku-4-5' });
  });

  it('provider openai com modelos claude-* cai nos defaults gpt', () => {
    const r = criarLLM(cfg({ provider: 'openai' }));
    expect(r.llm).toBeInstanceOf(OpenAIProvider);
    expect(r.modelos).toEqual(MODELOS_PADRAO.openai);
  });

  it('provider openai respeita modelo gpt explícito', () => {
    const r = criarLLM(cfg({ provider: 'openai', generationModel: 'gpt-5' }));
    expect(r.modelos.geracao).toBe('gpt-5');
    expect(r.modelos.selecao).toBe(MODELOS_PADRAO.openai.selecao);
  });

  it('provider anthropic com modelo gpt-* volta ao default claude', () => {
    const r = criarLLM(cfg({ provider: 'anthropic', generationModel: 'gpt-5-mini' }));
    expect(r.modelos.geracao).toBe('claude-haiku-4-5');
  });
});

describe('chavesNecessarias', () => {
  it('anthropic exige as duas chaves; openai só a da OpenAI', () => {
    expect(chavesNecessarias(cfg({}))).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
    expect(chavesNecessarias(cfg({ provider: 'openai' }))).toEqual(['OPENAI_API_KEY']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/llm/factory.test.ts` → FAIL

- [ ] **Step 3: Campo na config**

Em `src/core/config/schema.ts`, dentro do objeto `llm` (linha 37), adicionar como primeiro campo:

```ts
    // Motor de geração: 'anthropic' (padrão — Claude gera, OpenAI transcreve) ou
    // 'openai' (provedor único: uma chave só para voz e laudos)
    provider: z.enum(['anthropic', 'openai']).default('anthropic'),
```

(`defaultsDe` e `mesclar` não mudam — o default do zod cobre; o merge raso de `llm` em `saveConfig` já preserva o campo.)

- [ ] **Step 4: Implementar `src/core/llm/factory.ts`**

```ts
/**
 * Resolve provider + modelos a partir da config (BYOK). Modelo incompatível
 * com o provider escolhido cai no default do provider — troca de motor na
 * Settings nunca deixa um claude-* indo parar na OpenAI (ou vice-versa).
 */
import type { Config } from '../config/schema.js';
import { LLMClient } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { LLMProvider } from './types.js';

export const MODELOS_PADRAO = {
  anthropic: { selecao: 'claude-haiku-4-5', geracao: 'claude-haiku-4-5', rapido: 'claude-haiku-4-5' },
  openai: { selecao: 'gpt-5-mini', geracao: 'gpt-5-mini', rapido: 'gpt-5-mini' },
} as const;

export type NomeChaveNecessaria = 'OPENAI_API_KEY' | 'ANTHROPIC_API_KEY';

export interface LLMResolvido {
  llm: LLMProvider;
  modelos: { selecao: string; geracao: string; rapido: string };
}

function ajustar(provider: 'anthropic' | 'openai', modelo: string, papel: keyof typeof MODELOS_PADRAO.anthropic): string {
  const incompativel =
    provider === 'openai' ? modelo.startsWith('claude-') || modelo.startsWith('kimi-') : modelo.startsWith('gpt-');
  return incompativel ? MODELOS_PADRAO[provider][papel] : modelo;
}

export function criarLLM(config: Config): LLMResolvido {
  const p = config.llm.provider;
  return {
    llm: p === 'openai' ? new OpenAIProvider() : new LLMClient(),
    modelos: {
      selecao: ajustar(p, config.llm.selectionModel, 'selecao'),
      geracao: ajustar(p, config.llm.generationModel, 'geracao'),
      rapido: ajustar(p, config.llm.fastModel, 'rapido'),
    },
  };
}

/** OpenAI é sempre necessária (STT); Anthropic só quando é o motor de geração. */
export function chavesNecessarias(config: Config): NomeChaveNecessaria[] {
  return config.llm.provider === 'anthropic' ? ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] : ['OPENAI_API_KEY'];
}
```

- [ ] **Step 5: Espelhar no renderer**

Em `src/renderer/shared/types.ts`, adicionar após `HistoricoConfig`:

```ts
export interface LlmConfig {
  provider: 'anthropic' | 'openai';
  selectionModel: string;
  generationModel: string;
  fastModel: string;
}
```

e em `RendererConfig`, após `stt: SttConfig;`: `llm: LlmConfig;`

- [ ] **Step 6: Rodar** — `npx vitest run src/core/llm/factory.test.ts` → PASS; `npm test` + `npm run typecheck` → verdes

- [ ] **Step 7: Commit**

```bash
git add src/core/config/schema.ts src/core/llm/factory.ts src/core/llm/factory.test.ts src/renderer/shared/types.ts
git commit -m "config+factory: llm.provider (anthropic|openai), criarLLM com guarda de modelo e chavesNecessarias"
```

---

### Task 5: Pipeline do app usa a factory e o gate por provedor

**Files:**
- Modify: `src/main/pipeline.ts`
- Test: `src/main/pipeline.gate.test.ts` (novo — só a lógica pura do gate; o pipeline em si já é coberto pelos testes existentes)

**Interfaces:**
- Consumes: `criarLLM`, `chavesNecessarias` (Task 4).
- Produces: `exigirChaves(config: Config): void` exportada de `pipeline.ts` (substitui `exigirChave` interna nos fluxos de LLM; a checagem de `OPENAI_API_KEY` isolada permanece nos fluxos só-STT).

- [ ] **Step 1: Teste que falha**

`src/main/pipeline.gate.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigSchema } from '../core/config/schema.js';
import { exigirChaves } from './pipeline.js';

function cfg(llm: Record<string, unknown>) {
  return ConfigSchema.parse({ masksDir: '/x', profilesDir: '/x', outputDir: '/x', stt: {}, llm });
}

const backup = { ...process.env };
afterEach(() => {
  process.env['OPENAI_API_KEY'] = backup['OPENAI_API_KEY'];
  process.env['ANTHROPIC_API_KEY'] = backup['ANTHROPIC_API_KEY'];
});

describe('exigirChaves', () => {
  it('modo anthropic sem chave Anthropic falha com mensagem acionável', () => {
    process.env['OPENAI_API_KEY'] = 'sk-x';
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => exigirChaves(cfg({}))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('modo openai só exige a chave OpenAI', () => {
    process.env['OPENAI_API_KEY'] = 'sk-x';
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).not.toThrow();
  });

  it('sem chave OpenAI falha em qualquer modo', () => {
    delete process.env['OPENAI_API_KEY'];
    expect(() => exigirChaves(cfg({ provider: 'openai' }))).toThrow(/OPENAI_API_KEY/);
  });
});
```

ATENÇÃO: importar `pipeline.ts` puxa módulos de Electron indiretos? Não — `pipeline.ts` só importa do core e é testado hoje. Se o vitest reclamar de algo de Electron, o teste deve importar apenas a função pura movida para `src/core/llm/factory.ts` (mover `exigirChaves` para lá seria o plano B; registrar no PR).

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/main/pipeline.gate.test.ts` → FAIL (`exigirChaves` não existe)

- [ ] **Step 3: Implementar no `pipeline.ts`**

1. Imports: trocar `import { LLMClient, LLMUsage, estimateCostUSD } from '../core/llm/anthropic.js';` por:

```ts
import { estimateCostUSD } from '../core/llm/anthropic.js';
import { chavesNecessarias, criarLLM } from '../core/llm/factory.js';
import type { LLMProvider } from '../core/llm/types.js';
import type { LLMUsage } from '../core/llm/types.js';
```

2. Substituir a função `exigirChave` por (mantendo-a para os fluxos só-STT):

```ts
function exigirChave(nome: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'): void {
  if (!process.env[nome]) {
    throw new Error(`chave ${nome} não configurada — abra Configurações → Chaves de API pelo menu da bandeja`);
  }
}

/** Gate BYOK: exige TODAS as chaves do modo configurado (OpenAI sempre; Anthropic só no motor padrão). */
export function exigirChaves(config: Config): void {
  for (const nome of chavesNecessarias(config)) exigirChave(nome);
}
```

3. Em `processarTranscript`: trocar `exigirChave('ANTHROPIC_API_KEY'); const config = getConfig(); ... const llm = new LLMClient();` por:

```ts
  const config = getConfig();
  exigirChaves(config);
  const masks = loadLibrary(config.masksDir);
  const san = sanitizeComando(transcript);
  const { llm, modelos } = criarLLM(config);
```

e usar `modelos.selecao` no `selectMask(...)` (no lugar de `config.llm.selectionModel`). Passar `modelos` adiante: `return gerarLaudo(llm, config, modelos, {...}, san.texto, sttMs, san.avisos);`

4. `gerarComMascara`: mesma troca (`exigirChaves(config)` + `criarLLM`) e repasse de `modelos` ao `gerarLaudo`.

5. `gerarLaudo`: nova assinatura e usos —

```ts
async function gerarLaudo(
  llm: LLMProvider,
  config: Config,
  modelos: { selecao: string; geracao: string; rapido: string },
  sel: Selecao,
  transcript: string,
  sttMs: number,
  avisosSanitizacao: string[],
): Promise<ResultadoLaudo> {
```

- `model: modelos.geracao` no `generate(...)`;
- custos: `estimateCostUSD(modelos.selecao, sel.usage)` / `estimateCostUSD(modelos.geracao, gen.usage)` (mantendo o padrão null/aviso da Task 2).

6. `refinarTranscript`: `exigirChaves(config)` + `const { llm, modelos } = criarLLM(config);`, `model: modelos.geracao` e custo com `modelos.geracao`.

7. `processarAudio` / `processarAudioSegmentado` / `refinarAudio`: manter `exigirChave('OPENAI_API_KEY')` como primeira linha (falha antes de gravar/subir áudio); a checagem completa acontece no `processarTranscript`/`refinarTranscript` logo depois.

- [ ] **Step 4: Rodar** — `npx vitest run src/main/pipeline.gate.test.ts` → PASS; `npm test` + `npm run typecheck` → verdes

- [ ] **Step 5: Commit**

```bash
git add src/main/pipeline.ts src/main/pipeline.gate.test.ts
git commit -m "pipeline: factory de LLM por provedor + gate de chaves derivado da config (BYOK)"
```

---

### Task 6: CLI e scripts usam a factory (`--sonnet` força Anthropic)

**Files:**
- Modify: `src/cli/index.ts` (pontos `new LLMClient()`: ~102, ~166, ~274, ~323, ~382, ~395; cascata de modelo ~156-162; `requireEnv` ~51-58)
- Modify: `scripts/compactar-frasario.ts:34`

**Interfaces:**
- Consumes: `criarLLM`, `chavesNecessarias`, `MODELOS_PADRAO` (Task 4).
- Produces: comportamento — `--kimi` continua com `LLMClient({ baseURL })` (caminho Anthropic-compat, intocado); `--sonnet` força motor Anthropic com `claude-sonnet-5` e exige `ANTHROPIC_API_KEY` mesmo se `llm.provider === 'openai'`.

- [ ] **Step 1: Adaptar a cascata de modelo/cliente da CLI**

No bloco de escolha (hoje ~`:156-170`), a lógica vira:

```ts
const resolvido = criarLLM(config);
let llm = resolvido.llm;
let modeloGeracao = resolvido.modelos.geracao;
if (flags.kimi) {
  requireEnv(['MOONSHOT_API_KEY']);
  llm = new LLMClient({ apiKey: process.env['MOONSHOT_API_KEY'], baseURL: config.llm.kimiBaseURL, supportsCache: false });
  modeloGeracao = config.llm.kimiModel;
} else if (flags.sonnet) {
  requireEnv(['ANTHROPIC_API_KEY']); // modo qualidade é sempre Claude, mesmo no provedor openai
  llm = new LLMClient();
  modeloGeracao = 'claude-sonnet-5';
} else if (flags.fast) {
  modeloGeracao = resolvido.modelos.rapido;
}
```

e `resolvido.modelos.selecao` no lugar de `config.llm.selectionModel` na seleção.

- [ ] **Step 2: `requireEnv` por modo**

Onde a CLI hoje exige chaves fixas para o pipeline (`requireEnv` em `run`/`texto`), trocar por:

```ts
requireEnv(chavesNecessarias(config));
```

(mantendo a exigência extra de `OPENAI_API_KEY` nos comandos com áudio — `gravar`, `caso`, `eval` com áudio.) Ajustar a assinatura de `requireEnv` para receber `string[]` se hoje for variádica/fixa — comportamento: lança listando TODAS as ausentes com a dica do `.env`.

- [ ] **Step 3: `aprender`/`destilar`/`caso`/`eval` e o script**

Nos demais `new LLMClient()` (aprender ~274, destilar ~323, caso ~382, eval ~395) e em `scripts/compactar-frasario.ts:34`:

```ts
const { llm, modelos } = criarLLM(config);
```

usando `modelos.geracao` (aprender/destilar/compactar) e `modelos.selecao` (caso/eval) no lugar dos campos crus da config. `requireEnv(chavesNecessarias(config))` substitui a exigência fixa de `ANTHROPIC_API_KEY`.

- [ ] **Step 4: Verificar manualmente (sem gastar API)**

Run: `npm run laudo -- masks` → lista as máscaras (nenhuma chamada de LLM).
Run: `ANTHROPIC_API_KEY= OPENAI_API_KEY= npm run laudo -- texto "tomografia de crânio normal" --dry-run 2>&1 | head -5`
Expected: erro citando a(s) chave(s) ausente(s) conforme o modo da config — nunca um stack trace.

- [ ] **Step 5: Suíte + typecheck** — `npm test` + `npm run typecheck` → verdes

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts scripts/compactar-frasario.ts
git commit -m "cli: factory de LLM por provedor; --sonnet força Claude; requireEnv derivado do modo"
```

---

### Task 7: Componente compartilhado `ChavesApi` (Settings passa a usá-lo)

**Files:**
- Create: `src/renderer/shared/ChavesApi.tsx`
- Modify: `src/renderer/settings/main.tsx` (remove estados/handlers/JSX de chaves; usa o componente)

**Interfaces:**
- Produces: `function ChavesApi(props: { provider: 'anthropic' | 'openai'; compacto?: boolean; onStatus?: (s: StatusCofre) => void }): JSX.Element` — autocontido: carrega o status no mount, salva/remove/testa, expõe cada mudança de status via `onStatus`. `type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> }` exportado do mesmo arquivo.
- Consumes: `window.aerolince` (`secretsStatus`, `secretsSet`, `secretsTestar`).

- [ ] **Step 1: Criar `src/renderer/shared/ChavesApi.tsx`**

Mover para cá, sem mudar comportamento, os estados `cofre/teste/erroChave/novaChave`, o ref `testeGen` e os handlers `gravarChave/removerChave/rodarTeste` de `settings/main.tsx:24-104`, e o JSX da seção de chaves (`:196-248`) SEM o `<div className="secao">`/`<h2>` externos (quem envolve é o chamador). Diferenças em relação ao original:

```tsx
import { useEffect, useRef, useState } from 'react';

const api = window.aerolince;

export type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };

/** Descrições por chave conforme o motor de geração escolhido. */
function chaveInfo(provider: 'anthropic' | 'openai'): [string, string, boolean][] {
  // [nome, descrição, obrigatória]
  return [
    [
      'OPENAI_API_KEY',
      provider === 'openai'
        ? 'OpenAI — transcrição da voz E geração dos laudos (obrigatória)'
        : 'OpenAI — transcrição da voz (obrigatória)',
      true,
    ],
    [
      'ANTHROPIC_API_KEY',
      provider === 'anthropic'
        ? 'Claude — geração dos laudos (obrigatória)'
        : 'Claude — não usada no motor atual (guarde se quiser voltar ao modo recomendado)',
      provider === 'anthropic',
    ],
    ['MOONSHOT_API_KEY', 'Kimi — opcional, para testes', false],
  ];
}

export function ChavesApi({ provider, compacto, onStatus }: {
  provider: 'anthropic' | 'openai';
  /** true no onboarding: esconde a linha do Moonshot. */
  compacto?: boolean;
  onStatus?: (s: StatusCofre) => void;
}) {
  // …estados e handlers movidos de settings/main.tsx, com uma mudança:
  // toda vez que `cofre` muda (mount, salvar, remover), chamar onStatus?.(novoStatus).
  // No JSX: `chaveInfo(provider)` no lugar de CHAVE_INFO, filtrando Moonshot quando `compacto`;
  // badge "● obrigatória" (classe .desc, cor #c0392b) ao lado do nome quando obrigatória e status !== 'ok'.
  // Salvar passa a encadear rodarTeste(nome) quando o status voltar 'ok' (feedback imediato).
}
```

O corpo é o código existente movido — a task é um refactor de extração + os 4 deltas descritos (onStatus, chaveInfo por provider, filtro compacto, teste automático pós-salvar). O texto-rodapé da seção ("As chaves ficam no cofre criptografado…") também se move para cá, com a frase final adaptada ao provider: no modo openai, "…o texto sanitizado vai à OpenAI".

- [ ] **Step 2: Usar na Settings**

Em `settings/main.tsx`: apagar os estados/handlers/JSX movidos; a seção vira:

```tsx
<div className="secao">
  <h2>Chaves de API</h2>
  <ChavesApi provider={cfg.llm.provider} />
</div>
```

com `import { ChavesApi } from '../shared/ChavesApi.js';`.

- [ ] **Step 3: Verificar em dev**

Run: `npm run dev` → abrir Configurações pela bandeja.
Expected: seção de chaves idêntica em função (status, salvar com teste automático, testar, remover, banner de cofre); descrição da Anthropic muda se `laudo.config.json` tiver `"llm": {"provider": "openai"}`.

- [ ] **Step 4: Typecheck + suíte** — `npm run typecheck` + `npm test` → verdes

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shared/ChavesApi.tsx src/renderer/settings/main.tsx
git commit -m "renderer: ChavesApi compartilhado (Settings) — descrições por motor, teste automático ao salvar"
```

---

### Task 8: Seletor "Motor de geração" na Settings

**Files:**
- Modify: `src/renderer/settings/main.tsx` (nova seção antes de "Chaves de API"; helper `patchLlm`)

**Interfaces:**
- Consumes: `RendererConfig['llm']` (Task 4), `MODELOS_PADRAO` — duplicar os literais aqui (renderer não importa do core): `'claude-haiku-4-5'` / `'gpt-5-mini'`.
- Produces: mudança de `cfg.llm.provider` persiste via `configSet({ llm: {...} })` trocando também os 3 modelos para os defaults do provedor.

- [ ] **Step 1: Helper + seção**

Adicionar junto aos outros helpers:

```tsx
async function patchLlm(patch: Partial<RendererConfig['llm']>) {
  const c = (await api.configSet({ llm: patch })) as RendererConfig;
  setCfg(c);
  flashSalvo();
}
```

Nova seção, imediatamente ANTES da seção "Chaves de API":

```tsx
<div className="secao">
  <h2>Motor de geração</h2>
  <div className="linha">
    <div>
      <div className="rot">Quem escreve os laudos</div>
      <div className="desc">
        {cfg.llm.provider === 'anthropic'
          ? 'Claude gera os laudos; OpenAI transcreve a voz. Precisa das duas chaves.'
          : 'A OpenAI transcreve a voz E gera os laudos. Precisa só da chave OpenAI.'}
      </div>
    </div>
    <select
      className="ctrl"
      value={cfg.llm.provider}
      onChange={(e) => {
        const p = e.target.value as RendererConfig['llm']['provider'];
        void patchLlm(
          p === 'openai'
            ? { provider: p, selectionModel: 'gpt-5-mini', generationModel: 'gpt-5-mini', fastModel: 'gpt-5-mini' }
            : { provider: p, selectionModel: 'claude-haiku-4-5', generationModel: 'claude-haiku-4-5', fastModel: 'claude-haiku-4-5' },
        );
      }}
    >
      <option value="anthropic">OpenAI + Anthropic (recomendado)</option>
      <option value="openai">Só OpenAI</option>
    </select>
  </div>
</div>
```

- [ ] **Step 2: Verificar em dev**

Run: `npm run dev` → Configurações.
Expected: trocar o motor atualiza na hora a descrição das chaves (ChavesApi re-renderiza com o provider novo); `laudo.config.json` ganha `llm.provider` + modelos trocados; "✓ salvo" pisca.

- [ ] **Step 3: Typecheck + suíte + commit**

```bash
npm run typecheck && npm test
git add src/renderer/settings/main.tsx
git commit -m "settings: seletor de motor de geração (OpenAI+Anthropic | só OpenAI) com troca dos modelos default"
```

---

### Task 9: Onboarding bloqueante com passo de chaves

**Files:**
- Modify: `src/renderer/onboarding/main.tsx`
- Modify: `src/renderer/onboarding/onboarding.css` (só se precisar de espaço para o bloco de chaves — reusar classes existentes `.onb-aviso`)

**Interfaces:**
- Consumes: `ChavesApi` + `StatusCofre` (Task 7), `api.configGet()` para saber o provider.
- Produces: onboarding com 6 passos; passo 4 = "Suas chaves de API" com `ChavesApi` embutido; botões "Continuar" (no passo de chaves) e "Começar a laudar" (último) desabilitados enquanto as chaves necessárias não estiverem `ok`. Nada de "modo burro": sem chave não conclui.

- [ ] **Step 1: Reestruturar os passos**

Em `onboarding/main.tsx`:

1. `interface Passo` ganha `id: string` (`{ id, icone, titulo, corpo }`); todos os passos atuais recebem ids (`'bem-vindo'`, `'ditar'`, `'privacidade'`, `'revisar'`, `'bandeja'`).
2. Inserir o passo novo com `id: 'chaves'` entre `'privacidade'` e `'revisar'`:

```tsx
{
  id: 'chaves',
  icone: <span className="passo-emoji">🔑</span>,
  titulo: 'Suas chaves de API',
  corpo: null, // renderizado como componente vivo (abaixo)
},
```

3. Estado novo no `App`:

```tsx
const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
const [chavesOk, setChavesOk] = useState(false);

function avaliar(s: { chaves: Record<string, string> }, p: 'anthropic' | 'openai') {
  const okOpenai = s.chaves['OPENAI_API_KEY'] === 'ok';
  return p === 'anthropic' ? okOpenai && s.chaves['ANTHROPIC_API_KEY'] === 'ok' : okOpenai;
}

useEffect(() => {
  void iniciarTema();
  void (async () => {
    const c = (await api.configGet()) as RendererConfig;
    setProvider(c.llm.provider);
    const s = await api.secretsStatus();
    setChavesOk(avaliar(s, c.llm.provider));
  })();
}, []);
```

(substitui o estado `temChaves` atual; import de `RendererConfig` de `../shared/types.js`.)

4. Render do passo de chaves (quando `passo.id === 'chaves'`, no lugar de `<p>{passo.corpo}</p>`):

```tsx
<div className="onb-chaves">
  <p>
    O Aerolince funciona com <b>as suas chaves de API</b> — você paga centavos por laudo direto ao
    provedor (~R$ 0,02–0,09 por laudo), sem mensalidade de inteligência embutida.
  </p>
  <p className="desc">
    Crie sua chave OpenAI em <b>platform.openai.com/api-keys</b>
    {provider === 'anthropic' && <> e sua chave Claude em <b>console.anthropic.com</b></>}
    . Cole abaixo — elas ficam só no cofre criptografado do seu computador.
  </p>
  <div className="onb-motor">
    <label>
      <input type="radio" checked={provider === 'anthropic'} onChange={() => trocarMotor('anthropic')} />
      OpenAI + Anthropic (recomendado)
    </label>
    <label>
      <input type="radio" checked={provider === 'openai'} onChange={() => trocarMotor('openai')} />
      Só OpenAI (uma chave para tudo)
    </label>
  </div>
  <ChavesApi provider={provider} compacto onStatus={(s) => setChavesOk(avaliar(s, provider))} />
</div>
```

com:

```tsx
async function trocarMotor(p: 'anthropic' | 'openai') {
  setProvider(p);
  const c = (await api.configSet({
    llm:
      p === 'openai'
        ? { provider: p, selectionModel: 'gpt-5-mini', generationModel: 'gpt-5-mini', fastModel: 'gpt-5-mini' }
        : { provider: p, selectionModel: 'claude-haiku-4-5', generationModel: 'claude-haiku-4-5', fastModel: 'claude-haiku-4-5' },
  })) as RendererConfig;
  const s = await api.secretsStatus();
  setChavesOk(avaliar(s, c.llm.provider));
}
```

5. Gate de navegação: no passo `'chaves'`, o botão Continuar fica `disabled={!chavesOk}` com `title` "Salve e valide as chaves para continuar"; o botão final "Começar a laudar" fica `disabled={!chavesOk}`. Os dots não pulam o gate: clicar num dot à frente do passo de chaves sem `chavesOk` leva ao passo de chaves.
6. Remover o `.onb-aviso` antigo do último passo (o gate agora é no passo próprio).
7. CSS: adicionar em `onboarding.css` classes mínimas `.onb-chaves` (coluna com gap 10px) e `.onb-motor` (linha com gap 16px; labels com `display:flex; gap:6px; align-items:center`).

- [ ] **Step 2: Verificar em dev**

Run: `npm run dev` (com `laudo.config.json` temporariamente sem `onboardingConcluido` ou via bandeja → "Guia rápido").
Expected: passo de chaves aparece na posição 4; sem chaves válidas, Continuar/concluir desabilitados; salvar chave válida libera; trocar o motor para "Só OpenAI" faz a exigência da Anthropic sumir na hora.

- [ ] **Step 3: Typecheck + suíte + commit**

```bash
npm run typecheck && npm test
git add src/renderer/onboarding/main.tsx src/renderer/onboarding/onboarding.css
git commit -m "onboarding: passo de chaves BYOK bloqueante com escolha do motor — sem chave não conclui"
```

---

### Task 10: Verificação final do bloco

**Files:**
- Modify: `docs/ESTADO.md` (registrar o Bloco 1 e a inversão da Fase 2 para BYOK)

- [ ] **Step 1: Suíte completa + typecheck + build**

Run: `npm test && npm run typecheck && npm run build:app`
Expected: tudo verde; build sem erros.

- [ ] **Step 2: Smoke manual em dev**

`npm run dev`: (a) Settings mostra motor + chaves coerentes; (b) trocar motor e ver descrições mudarem; (c) onboarding via "Guia rápido" com gate funcionando; (d) com chaves válidas no cofre, ditar por texto (macro ou balão) gera laudo normalmente no motor padrão.

- [ ] **Step 3: Atualizar `docs/ESTADO.md`**

Acrescentar ao topo do arquivo (seção "Comece por aqui") uma linha: Bloco 1 do reposicionamento (spec 2026-08-07) mergeado — BYOK com motor selecionável (anthropic|openai), factory `criarLLM`, gate `chavesNecessarias`, ChavesApi compartilhado, onboarding bloqueante. Atualizar o item 6 do backlog: backend próprio morto pelo BYOK.

- [ ] **Step 4: Commit final**

```bash
git add docs/ESTADO.md
git commit -m "docs: ESTADO.md registra Bloco 1 (BYOK/provedores) concluído"
```
