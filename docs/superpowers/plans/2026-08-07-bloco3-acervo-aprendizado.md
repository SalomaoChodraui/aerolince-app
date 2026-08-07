# Bloco 3 — Ingestão de acervo + aprendizado dentro do app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O médico importa os próprios laudos (PDF/DOCX/TXT) pelo app, revisa amostras sanitizadas, aprova o custo e o app destila máscaras/regras DELE para a camada por cima da base — com wizard no onboarding, janela "Meu estilo" e botão "Reaprender".

**Architecture:** Núcleo novo `core/acervo/` (extração pdfjs-dist/mammoth, classificação determinística por conteúdo, sanitização com frontmatter de proveniência) e `core/aprendizado/` (corpus/destilar/aprender/custo/aplicar movidos da CLI, com callbacks de progresso, cancelamento, escrita SEMPRE em `_rascunhos/` e re-sanitização no envio). Main ganha `acervo.ts`/`aprendizado.ts` com IPC de progresso; renderer ganha `importar/` (wizard) e `estilo/`; onboarding vira wizard com passo de importação pulável.

**Tech Stack:** pdfjs-dist (PDF texto puro JS, sem binário), mammoth (DOCX), TypeScript strict ESM, zod, vitest, Electron IPC, React 19.

**Spec:** `docs/superpowers/specs/2026-08-07-inteligencia-do-medico-byok-design.md` (§3 Bloco 3, §4, §5)

**Desvio registrado do spec:** a classificação de indecididos por LLM fica para o backlog — na v1 o wizard oferece rotulagem MANUAL (dropdown de exames conhecidos + "deixar de fora"). Motivo: zero custo pré-consentimento, menos superfície. Registrar no ESTADO.md (T9).

## Global Constraints

- TypeScript strict, ESM, imports `.js`; sem `any`. `src/core/` é Node puro (pdfjs-dist/mammoth rodam em Node; NENHUM import de Electron no core).
- PRIVACIDADE (CLAUDE.md, INEGOCIÁVEL): originais NUNCA saem da máquina; TODO texto passa por `sanitize()` local antes de persistir no acervo E re-sanitização no momento do envio ao LLM; nomes de arquivo do acervo sem nome de paciente; NENHUM conteúdo clínico real em testes/fixtures (tudo sintético); nunca logar chave.
- CUSTO: nenhuma chamada de LLM sem (a) consentimento explícito da amostra sanitizada e (b) estimativa de custo aceita (decisões 4 e 5 do spec). Cancelamento sempre possível; falha em um alvo não derruba os demais.
- CURADORIA: `aprender`/`destilar` escrevem SEMPRE em `_rascunhos/` (nunca sobrescrever `regras/<id>.md` ou máscara existente); `aplicar` faz backup `.bak` do arquivo substituído; escrita atômica (`writeFileAtomicSync`).
- Corpus: arquivos novos têm frontmatter de proveniência; TODO leitor de corpus tolera arquivos legados SEM frontmatter (tmp-sanitized) — ler via gray-matter e usar `content`.
- Suíte verde (`npm test`, `npm run typecheck`) antes de cada commit; UI também `npm run build:app`.
- Janela nova = checklist completo: entry no `electron.vite.config.ts`, ref+`abrirAux` no main, union do `abrir` no preload + cadeia if/else no main (o else cai no onboarding!), broadcast `config-mudou`, `brand.css`+`window.css`+`iniciarTema()`.
- Branch `bloco3-acervo-aprendizado` a partir de `main` (baa93a4 + commit deste plano).

---

### Task 1: Dependências + `core/acervo/extrair.ts`

**Files:**
- Modify: `package.json` (deps: `pdfjs-dist@^4`, `mammoth@^1`)
- Create: `src/core/acervo/extrair.ts`
- Create: `src/core/acervo/fixtures/mini.pdf`, `src/core/acervo/fixtures/mini.docx`, `src/core/acervo/fixtures/mini.txt` (SINTÉTICOS, gerados no Step 1 — conteúdo "TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO … Técnica: exemplo sintético.")
- Test: `src/core/acervo/extrair.test.ts`

**Interfaces:**
- Produces: `extrairTexto(caminho: string): Promise<ResultadoExtracao>` com
  `type ResultadoExtracao = { ok: true; texto: string } | { ok: false; motivo: 'sem-texto' | 'formato' | 'erro'; detalhe?: string }`.
  Regras: `.pdf` via pdfjs-dist (import `pdfjs-dist/legacy/build/pdf.mjs`, `getDocument({ data, useSystemFonts: true })`, concatenar `getTextContent()` de todas as páginas com quebra de linha por página; worker desabilitado — Node); `.docx` via `mammoth.extractRawText({ path })`; `.txt` leitura direta utf8; texto extraído com `< 40` chars não-espaço → `{ ok: false, motivo: 'sem-texto' }` (nunca descartar em silêncio — o chamador conta e reporta); extensão desconhecida → `'formato'`; exceção → `'erro'` com mensagem.

- [ ] **Step 1: Instalar deps e gerar fixtures**

```bash
npm i pdfjs-dist@^4 mammoth@^1
```

Gerar fixtures sintéticas via script descartável no scratchpad (NUNCA usar laudo real): o mini.pdf pode ser gerado com o próprio `pdfkit`? NÃO adicionar dep — gerar com `Printf`/heredoc um PDF mínimo válido de 1 página com o texto sintético (formato PDF 1.4 simples com um objeto de texto Tj) OU, mais robusto: gerar com `qlmanage`/`textutil`+`cupsfilter` do macOS a partir de um .txt (`textutil -convert html` → `cupsfilter` → pdf). O mini.docx: `textutil -convert docx mini.txt -output mini.docx` (nativo do macOS). Validar as fixtures no próprio teste (se `extrairTexto` as lê, estão boas). Commitar as fixtures (são sintéticas e minúsculas).

- [ ] **Step 2: Teste que falha** — `src/core/acervo/extrair.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extrairTexto } from './extrair.js';

const FX = resolve(import.meta.dirname, 'fixtures');

describe('extrairTexto', () => {
  it('extrai texto de PDF sintético', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.pdf'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toContain('TOMOGRAFIA COMPUTADORIZADA');
  });
  it('extrai texto de DOCX sintético', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.docx'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.texto).toContain('TOMOGRAFIA COMPUTADORIZADA');
  });
  it('extrai TXT direto', async () => {
    const r = await extrairTexto(resolve(FX, 'mini.txt'));
    expect(r.ok && r.texto.includes('TOMOGRAFIA')).toBe(true);
  });
  it('arquivo sem texto útil → sem-texto; extensão estranha → formato; inexistente → erro', async () => {
    // criar um .txt de 10 chars num tmpdir dentro do teste
    // …
    expect((await extrairTexto('/nao/existe.pdf')) as { ok: boolean }).toMatchObject({ ok: false, motivo: 'erro' });
    expect(await extrairTexto(resolve(FX, 'mini.txt').replace('.txt', '.xyz'))).toMatchObject({ ok: false });
  });
});
```

(completar o caso `sem-texto` com arquivo tmp real; ajustar asserts ao shape exato.)

- [ ] **Step 3: Implementar** conforme a interface acima. pdfjs em Node: `const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');` dentro da função (import dinâmico evita custo no boot do app); `data: new Uint8Array(readFileSync(caminho))`.

- [ ] **Step 4: Rodar** — teste PASS; `npm test` + `npm run typecheck` verdes (atenção: pdfjs pode exigir `"moduleResolution"` compatível — se o typecheck brigar com o subpath, use `// @ts-expect-error` NUNCA; prefira declarar um `.d.ts` mínimo local `src/core/acervo/pdfjs.d.ts` com o que usamos).

- [ ] **Step 5: Commit** — `git add package.json package-lock.json src/core/acervo/ && git commit -m "acervo: extração de texto local (pdfjs-dist/mammoth/txt) sem binário externo"`

---

### Task 2: `core/acervo/classificar.ts` — classificador determinístico + clusters

**Files:**
- Create: `src/core/acervo/classificar.ts`
- Test: `src/core/acervo/classificar.test.ts`

**Interfaces:**
- Produces:
  - `classificarDocumento(texto: string): Classificacao` com `interface Classificacao { modalidade: 'tc'|'rm'|'us'|'rx'|'mg'|'desconhecida'; exame: string | null; contraste: 'com'|'sem'; lateral: boolean }` — `exame` é um slug kebab SEM lateralidade (ex.: `cranio`, `abdome-total`, `joelho`), null quando o título não é reconhecível.
  - `agruparClusters(docs: { arquivo: string; c: Classificacao }[]): Cluster[]` com `interface Cluster { chave: string; modalidade: string; exame: string | null; contraste: 'com'|'sem'; lateral: boolean; arquivos: string[] }` — chave = `${modalidade}-${exame ?? 'nao-reconhecido'}${contraste === 'com' ? '-com-contraste' : ''}`; laterais colapsam num cluster só (`lateral: true`).
  - `sugerirMaskId(cluster: Cluster): string` — a própria chave (compatível com o padrão `tc-abdome-total-com-contraste`).
- Regras de detecção (100% local):
  - Modalidade pela primeira linha de título que casar (case/acento-insensível): `TOMOGRAFIA COMPUTADORIZADA` → tc; `RESSONÂNCIA MAGNÉTICA`/`RESSONANCIA` → rm; `ULTRASSONOGRAFIA`/`ECOGRAFIA`/`ULTRA-SONOGRAFIA` → us; `RADIOGRAFIA`/`RAIOS X`/`RAIO-X` → rx; `MAMOGRAFIA` → mg; nada → desconhecida.
  - Exame: o complemento do título após `DA|DE|DO|DOS|DAS` até o fim da linha, normalizado (sem acento, kebab), com tabela de sinônimos mínima: `encefalo|cranio → cranio`, `abdome total|abdome e pelve → abdome-total`, `torax → torax`, `coluna lombar|lombo-sacra → coluna-lombar` (e cervical/torácica análogos), `seios da face|face → seios-da-face`, membros (`joelho|ombro|punho|cotovelo|tornozelo|pe|mao|bacia|quadril → slug`); remover sufixos de lateralidade (`direito|direita|esquerdo|esquerda|dir|esq|bilateral` → marca `lateral: true`).
  - Contraste: reusar a convenção existente — texto contém `com contraste` / `administração intravenosa` / `uso do meio de contraste` SEM negação próxima (`sem a administração`, `sem contraste`, `não foi administrado`) → 'com'; caso contrário 'sem'. (Espelhar a lógica de `citaContraste` de `masks/matcher.ts` e o `corpus_sem` real "com a administração intravenosa".)
- Test: fixtures sintéticas de cabeçalhos (≥12 casos: tc crânio, tc abdome com/sem contraste, rm coluna, us abdome, rx tórax, joelho esq/dir colapsando, título irreconhecível, negação de contraste, acentos variados). Sem arquivo em disco — strings inline.

- [ ] **Step 1: Teste que falha** (casos acima, asserts em modalidade/exame/contraste/lateral e no colapso de clusters)
- [ ] **Step 2: Implementar** (funções puras; normalização compartilhada com um helper local `slug()`)
- [ ] **Step 3: Rodar** — PASS; suíte + typecheck verdes
- [ ] **Step 4: Commit** — `git commit -m "acervo: classificador determinístico por conteúdo (modalidade/exame/contraste/lateralidade) e clusters"`

---

### Task 3: `config.acervoDir` + `core/acervo/sanitizar.ts` + compat da CLI

**Files:**
- Modify: `src/core/config/schema.ts` (`acervoDir: z.string()` + default `resolve(appRoot, 'acervo')` em `defaultsDe`), `src/renderer/shared/types.ts` (espelho), `.gitignore` (`acervo/`)
- Create: `src/core/acervo/sanitizar.ts`
- Modify: `src/cli/index.ts` (`sanitizedDir()` → usa `config.acervoDir` com fallback legado `tmp-sanitized`)
- Test: `src/core/acervo/sanitizar.test.ts` (+ helpers cfg() dos testes que constroem ConfigSchema.parse ganham `acervoDir: '/x'` — MESMA quebra conhecida da B2-T1: `factory.test.ts`, `pipeline.gate.test.ts`, `contexto.test.ts` e quaisquer outros que o typecheck apontar)

**Interfaces:**
- Produces: `sanitizarParaAcervo(params: { texto: string; nomeOriginal: string; classif: Classificacao; acervoDir: string; indice: number }): { arquivo: string; findings: number; suspeito: boolean }` — sanitiza (`sanitize()` com `extraNames` de `patientNameFromFilename(nomeOriginal)` quando houver), grava `<acervoDir>/<chaveCluster>_<AAAA-MM-DD|s-d>_<NNN>.md` com frontmatter:

```markdown
---
exame: tc-cranio
modalidade: tc
contraste: sem
origem_hash: <sha256 do texto ORIGINAL, 12 chars>
confianca: alta|baixa
---
<texto sanitizado>
```

  `suspeito` = nome no filename e zero findings tipo nome (heurística atual do sanitize-pdfs). Escrita atômica. Data: extraída do nome original se seguir o padrão da clínica; senão `s-d` (sem data — NUNCA usar data de hoje, que vira dado derivável).
- Leitor de corpus (T4) usa gray-matter: frontmatter presente → `content`; ausente (legado) → arquivo inteiro.
- CLI `sanitizedDir()`: `config.acervoDir` se existir e tiver arquivos; senão `tmp-sanitized` legado se existir; senão o erro atual.

- [ ] **Step 1: Testes que falham** (frontmatter correto; hash estável; `s-d` sem data; suspeito true/false; arquivo legado sem frontmatter lido pelo helper `corpoDoArquivo(caminho)` também exportado daqui)
- [ ] **Step 2: Implementar** + campo de config + espelho + gitignore + helpers cfg() dos testes
- [ ] **Step 3: Rodar** — suíte + typecheck verdes
- [ ] **Step 4: Commit** — `git commit -m "acervo: sanitização com frontmatter de proveniência + config.acervoDir (fallback legado tmp-sanitized)"`

---

### Task 4: `core/aprendizado/` (corpus, destilar, aprender, custo, aplicar) + CLI vira casca

**Files:**
- Create: `src/core/aprendizado/corpus.ts`, `destilar.ts`, `aprender.ts`, `custo.ts`, `aplicar.ts`
- Modify: `src/cli/index.ts` (aprender/destilar delegam; comando novo `laudo aplicar <rascunho>`)
- Test: `src/core/aprendizado/*.test.ts` (fixtures sintéticas; LLM fake via `LLMProvider` injetado)

**Interfaces (exatas — o main e a CLI dependem delas):**

```ts
// corpus.ts
export interface FiltroCorpus { contendo?: string; sem?: string }
export function corpusPorPrefixos(dir: string, prefixos: string[], cap: number, filtro?: FiltroCorpus): string[]; // caminhos absolutos, mais recentes por último (lógica atual movida)
export function corpusPorArquivos(arquivos: string[], cap: number): string[]; // valida existência, aplica cap pelo FIM
export function montarCorpus(arquivos: string[]): { corpus: string; total: number }; // lê via corpoDoArquivo() (tolera legado), RE-SANITIZA cada corpo com sanitize().clean (defesa em profundidade) e junta com "─── LAUDO N ───"

// custo.ts
export function estimarCustoAprendizado(bytesCorpus: number, modelo: string, maxTokens: number): { tokensEntradaAprox: number; custoAproxUSD: number | null };
// tokens ≈ ceil(bytes/4) + 500 de overhead de prompt; custo via estimateCostUSD com usage sintético {inputTokens: aprox, outputTokens: maxTokens, cache*: 0}

// destilar.ts / aprender.ts — mesma forma:
export interface OpcoesAprendizado {
  llm: LLMProvider; modelo: string;
  onProgresso?: (p: { etapa: string; atual: number; total: number }) => void;
  cancelado?: () => boolean; // checado ANTES de cada chamada de LLM
}
export async function destilarMascara(params: { id: string; arquivos: string[]; masksDir: string }, o: OpcoesAprendizado): Promise<{ arquivo: string; custoUSD: number | null }>;
// prompt DESTILAR_SYSTEM intacto; maxTokens 2500; strip de cercas; escreve ATÔMICO em <masksDir>/_rascunhos/<id>.md
export async function aprenderRegras(params: { maskId: string; arquivos: string[]; masksDir: string }, o: OpcoesAprendizado): Promise<{ arquivo: string; custoUSD: number | null }>;
// APRENDER_SYSTEM intacto; maxTokens 4000; escreve em <masksDir>/_rascunhos/regras-<maskId>.md (NUNCA mais direto em regras/) com o header de rascunho atual

// aplicar.ts
export function listarRascunhos(masksDir: string): { arquivo: string; tipo: 'mascara' | 'regras'; alvo: string }[]; // regras-<id>.md → tipo regras/alvo id; <id>.md → mascara
export function aplicarRascunho(masksDir: string, arquivo: string): { destino: string; backup?: string };
// mascara → <masksDir>/<id>.md ; regras → <masksDir>/regras/<id>.md ; se o destino existe, copia antes para <destino>.bak; move atômico; valida frontmatter zod quando tipo mascara (rascunho inválido → erro claro, não aplica)
export function descartarRascunho(masksDir: string, arquivo: string): void;
```

- CLI: `aprender`/`destilar` chamam o core (mesma UX de terminal, custo impresso ao final), e o aviso de mudança: aprender agora aponta o rascunho (`_rascunhos/regras-<id>.md`) + dica `laudo aplicar regras-<id>.md`. `laudo aplicar <arquivo>` e `laudo rascunhos` (listar) novos, finos.
- Tests: fake LLM (`{ complete: async () => ({ text: '…', usage: {...} }) }`); cancelamento (cancelado() true antes da 2ª chamada → para sem escrever a 2ª); re-sanitização (corpus com "paciente João da Silva" plantado → corpus final contém `[NOME]`); aplicar com backup; aplicar rascunho de máscara inválido → erro sem tocar destino; corpus legado sem frontmatter lido inteiro.

- [ ] Steps TDD por módulo (teste → falha → implementa → passa), commit único ao final:
`git commit -m "aprendizado: destilar/aprender/aplicar no core com progresso, cancelamento, rascunhos e re-sanitização; CLI vira casca fina"`

---

### Task 5: IPC no main (`acervo.ts`, `aprendizado.ts`) + preload

**Files:**
- Create: `src/main/acervo.ts`, `src/main/aprendizado.ts`
- Modify: `src/main/index.ts` (registrar handlers; broadcast), `src/preload/index.ts`
- Test: lógica pura fica no core (já testada); os módulos main são orquestração fina — sem teste unitário novo (convenção do repo para main/), MAS o typecheck cobre os contratos.

**Interfaces (preload — nomes exatos p/ o wizard e o estilo):**

```ts
// Acervo / aprendizado
acervoEscolherArquivos: (): Promise<string[] | null> // dialog openFile+multiSelections+openDirectory, filtro pdf/docx/txt; pasta → expande 1 nível
acervoImportar: (paths: string[]): Promise<ResumoImportacao> // extrai+classifica+sanitiza TUDO local; progresso via evento
// ResumoImportacao = { clusters: {chave, exame, modalidade, contraste, quantidade, maskIdExistente: string|null}[], semTexto: string[], naoReconhecidos: number, amostras: {arquivo, texto}[] /*3 aleatórias sanitizadas*/, suspeitos: number }
aprendizadoEstimar: (alvos: AlvoAprendizado[]): Promise<{ porAlvo: {chave, custoAproxUSD: number|null}[]; totalUSD: number|null }>
// AlvoAprendizado = { tipo: 'destilar'|'aprender'; chave: string; maskId: string; arquivos: string[] }
aprendizadoRodar: (alvos: AlvoAprendizado[]): Promise<{ ok: {chave, arquivo, custoUSD}[]; falhas: {chave, erro}[] }>
aprendizadoCancelar: (): Promise<void>
rascunhosListar: (): Promise<{arquivo, tipo, alvo}[]>
rascunhoLer: (arquivo: string): Promise<string>
rascunhoAplicar: (arquivo: string): Promise<{destino: string}>
rascunhoDescartar: (arquivo: string): Promise<void>
// Meu estilo
estiloListar: (): Promise<{ mascaras: {id, nome, origemEfetiva: 'base'|'minha'}[]; regras: string[]; frasario: string[] }>
estiloLer: (tipo: 'mascara'|'regras'|'frasario', nome: string): Promise<string>
estiloSalvar: (tipo: 'mascara'|'regras'|'frasario', nome: string, texto: string): Promise<void> // grava SEMPRE na biblioteca do médico (masksDir), atômico — editar item da base cria override
// Eventos
onAcervoProgresso: (cb: (p: {fase: 'extraindo'|'classificando'|'sanitizando'; atual: number; total: number; arquivo?: string}) => void) => void
onAprendizadoProgresso: (cb: (p: {chave: string; etapa: string; atual: number; total: number}) => void) => void
```

**Regras de implementação:**
- `acervoImportar` roda 100% local (SEM LLM), grava no `config.acervoDir`, casa cluster→máscara existente comparando `sugerirMaskId(cluster)` com os ids de `loadLibrary(bibliotecasDe(config))` (match exato) — `maskIdExistente` orienta o wizard (aprender vs destilar).
- `aprendizadoRodar`: gate `exigirChaves(config)` ANTES de qualquer chamada; `criarLLM(config)`; roda alvos EM SEQUÊNCIA (não paralelo — custo previsível), cancelamento via flag de módulo; falha de um alvo entra em `falhas` e segue; eventos de progresso por `webContents.send` para TODAS as janelas vivas (padrão do canal `estado`).
- Validação zod nas fronteiras IPC (paths: array de strings; alvo: schema).
- `estiloSalvar` valida frontmatter quando tipo mascara antes de gravar.
- Segurança de caminho: `rascunho*`/`estilo*` fazem `basename()` no nome recebido (sem path traversal — mesmo padrão do histórico).

- [ ] Steps: implementar módulos → preload → registrar em `registrarIpc` → `npm run typecheck` + `npm test` + `npm run build:app` → commit
`git commit -m "main+preload: IPC de acervo/aprendizado/rascunhos/estilo com progresso e cancelamento"`

---

### Task 6: Wizard `renderer/importar/`

**Files:**
- Create: `src/renderer/importar/index.html`, `main.tsx`, `importar.css`
- Modify: `electron.vite.config.ts` (entry `importar`), `src/main/index.ts` (ref, `abrirImportar()`, cadeia `abrir`, broadcast, item no tray "Importar meus laudos…"), `src/preload/index.ts` (union `abrir`)

**Máquina de estados do wizard (6 passos do spec §3):**

```
selecionar → processando(local) → revisar-amostras(consentimento) → custo(confirmar) → rodando(progresso+cancelar) → rascunhos(aplicar/descartar) → fim
```

**Especificação por passo (usar `.janela`/`.secao`/`.linha` do window.css; estado central `useState<Fase>`):**
1. **selecionar**: botão "Escolher arquivos ou pasta…" (`acervoEscolherArquivos`) + área de drop (`onDrop` com `e.dataTransfer.files` → paths via `webUtils.getPathForFile` se necessário — se o drop não der paths confiáveis no Electron 43, manter só o dialog e registrar no report); lista dos selecionados com contagem.
2. **processando**: barra de progresso textual (`onAcervoProgresso`), 100% local, cancelável apenas fechando (não chama API).
3. **revisar-amostras**: tabela de clusters ("514 abdome-total, 354 torax, 12 não reconhecidos, 3 sem texto"); clusters `nao-reconhecido` ganham dropdown com os exames conhecidos (ids da biblioteca) + "deixar de fora"; as 3 amostras sanitizadas em `<pre>` roláveis; checkbox obrigatório: **"Revisei as amostras acima; autorizo o envio do texto anonimizado para a minha chave de API para aprendizado do meu estilo."** — botão Continuar `disabled` sem o check.
4. **custo**: monta `AlvoAprendizado[]` (cluster com `maskIdExistente` → `aprender`; cluster ≥ 20 laudos sem máscara → `destilar`+`aprender`; < 20 sem máscara → listado como "poucos laudos — fica de fora, importe mais depois"); mostra `aprendizadoEstimar` por alvo + total ("Aprender com seus 830 laudos custará ~US$ 1,10"); botão "Aprender meu estilo" confirma.
5. **rodando**: progresso por alvo (`onAprendizadoProgresso`), botão Cancelar (`aprendizadoCancelar`); ao final, resumo ok/falhas.
6. **rascunhos**: lista `rascunhosListar` com preview (`rascunhoLer` em `<pre>`) e botões Aplicar/Descartar por item; texto: "Aplicar coloca na SUA biblioteca — a partir do próximo laudo o app usa o seu fraseado."
- Reabrível a qualquer momento (tray/Settings/Meu estilo); wizard SEM estado persistido próprio (o acervo em disco é o estado).

- [ ] Steps: implementar → gates (`typecheck`+`test`+`build:app`) → verificação estática do checklist de janela nova (todos os 7 pontos) → commit
`git commit -m "renderer: wizard de importação de acervo (seleção → amostras+consentimento → custo → aprendizado → rascunhos)"`

---

### Task 7: Janela `renderer/estilo/` ("Meu estilo") + Reaprender

**Files:**
- Create: `src/renderer/estilo/index.html`, `main.tsx`, `estilo.css` (grid 260px/1fr como o histórico)
- Modify: `electron.vite.config.ts`, `src/main/index.ts` (janela + tray "Meu estilo…"), `src/preload/index.ts`, `src/renderer/settings/main.tsx` (botão "Meu estilo" no rodapé)
- Modify: `src/main/aprendizado.ts` (suporte ao corpus do Reaprender)

**Conteúdo:**
- Coluna esquerda: 3 grupos (Máscaras com badge `base`/`minha` via `origemEfetiva`; Regras; Frasário).
- Direita: editor `<textarea>` monoespaçada + Salvar (`estiloSalvar`; aviso quando o item era da base: "Você está criando a SUA versão — ela passa a valer no lugar da base").
- Botão **"Reaprender com meus laudos"**: abre o wizard de importação já na etapa 4 (custo) com alvos montados de: (a) acervo existente em `acervoDir` + (b) NOVO — laudos do histórico com `laudoFinalEditado` no sidecar (main varre `outputDir` pelos sidecars, extrai o texto final editado, re-sanitiza e injeta como arquivos extras do corpus com peso de recência — implementar `corpusDoHistorico(outputDir, cap 40)` em `src/main/aprendizado.ts`, filtrando `laudoFinalEditado` presente). A edição do médico é o sinal de estilo mais puro (decisão 6 / item 1 do backlog antigo).
- Comunicação wizard↔estilo: `abrir('importar')` + query `?modo=reaprender` (loadPage aceita sufixo) OU um IPC `importar-abrir-reaprender` — escolher o mais simples no código atual e registrar.

- [ ] Steps: implementar → gates → commit
`git commit -m "renderer: janela Meu estilo (máscaras/regras/frasário em camadas, editor) + Reaprender com histórico editado"`

---

### Task 8: Onboarding vira wizard com importação embutida

**Files:**
- Modify: `src/renderer/onboarding/main.tsx`, `onboarding.css`
- Modify: `src/core/config/schema.ts` (+`onboarding: z.object({ versao: z.number().default(1), passo: z.number().default(0), acervoImportado: z.boolean().default(false) }).prefault({})` + entrar no array de merge de `saveConfig`), `src/renderer/shared/types.ts` (espelho)

**Passos novos (ordem final; manter ids existentes onde possível):**
1. `bem-vindo` (texto atual)
2. `inteligencia` (NOVO): "O Aerolince já sabe laudar TC com um laudário clássico embutido — e aprende o SEU jeito: quanto mais laudos seus você importar (das modalidades que você mais usa), mais o laudo sai com a sua cara. Sequência, jargões e detalhes técnicos: seus."
3. `chaves` (existente, bloqueante — intacto)
4. `privacidade` (existente)
5. `importar` (NOVO, pulável): resumo do que o passo 5 faz + botão "Importar meus laudos agora" (abre o wizard `importar` por cima; ao fechar, `acervoImportado` atualiza via `config-mudou`) + link "Fazer depois (Configurações → Meu estilo)". `podeAvancar` sempre true (decisão 5: importar é fortemente recomendado, não obrigatório).
6. `revisar` e `bandeja` (existentes; `bandeja` menciona "Meu estilo" e "Importar meus laudos" no tray).
- Progresso persistido: `configSet({ onboarding: { passo: i } })` a cada navegação; no mount, retomar de `cfg.onboarding.passo` (se < total). `concluirOnboarding` inalterado.

- [ ] Steps: teste do schema novo (default/merge) → implementar → gates → commit
`git commit -m "onboarding: wizard com passo de inteligência e importação de acervo pulável; progresso persistido"`

---

### Task 9: Verificação final do bloco

**Files:** `docs/ESTADO.md`

- [ ] **Step 1:** `npm test && npm run typecheck && npm run build:app`; `npx electron-builder --dir` e conferir que o app abre... (sem GUI: conferir empacotamento e registrar smoke).
- [ ] **Step 2 — ensaio ponta a ponta SEM LLM (custo zero):** script descartável no scratchpad que chama o core direto: gerar 25 arquivos .txt sintéticos de "TC DO CRÂNIO" variados → `extrairTexto` → `classificarDocumento`/`agruparClusters` (1 cluster tc-cranio, 25 arquivos) → `sanitizarParaAcervo` num tmpdir → `corpusPorArquivos`+`montarCorpus` (frontmatter tolerado, re-sanitização ok) → `estimarCustoAprendizado` (número plausível) → `destilarMascara` com LLM FAKE → rascunho em `_rascunhos/` → `aplicarRascunho` → máscara válida carregável por `loadLibrary`. Colar a saída no report. É a prova integrada do bloco.
- [ ] **Step 3:** ESTADO.md — Bloco 3 concluído (o que entrou), desvio registrado (classificação LLM → backlog; rotulagem manual na v1), pendências de smoke com GUI (wizard completo com 20+ PDFs reais NA MÁQUINA DO SALOMÃO, incluindo custo real ~US$ 0,03-0,06 por máscara; onboarding novo; Meu estilo; Reaprender), backlog novo (OCR tesseract; quase-duplicata de frasário; classificação LLM de indecididos; editor rico de máscara).
- [ ] **Step 4:** Commit — `git commit -m "docs: ESTADO.md registra Bloco 3 (acervo + aprendizado in-app) concluído"`
