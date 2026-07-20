# Fase A — Contenção para piloto (P0s da auditoria) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os P0s de contenção da auditoria de 18/07: laudo final validado (sem resíduo técnico), transcript sanitizado antes do LLM, gate de confiança na seleção de máscara, config/cofre atômicos e honestos, áudio sem tocar disco, textos de privacidade fiéis ao fluxo real.

**Architecture:** Toda a lógica nova entra em `src/core/` (puro, testável); `src/main/pipeline.ts` passa a devolver uma união discriminada (`laudo` | `confirmar-mascara`) que o `main/index.ts` roteia para a janela de resultado; a UI ganha painel de confirmação e avisos. Nada em `src/core/engine/prompts.ts` é alterado (zero risco de regressão de seleção/geração).

**Tech Stack:** TypeScript strict ESM (imports relativos com `.js`), zod, vitest, Electron, React 19.

## Global Constraints

- **NUNCA editar `src/core/engine/prompts.ts`** — evitaria regressão silenciosa de seleção/geração (o eval é pago e não roda sem chaves).
- ESM: todo import relativo termina em `.js` (mesmo de arquivos `.ts`).
- Validação zod em toda fronteira nova (config, IPC no futuro — aqui: config).
- Strings voltadas ao usuário em PT-BR; identificadores seguem o padrão do arquivo vizinho (este código usa PT: `salvarChave`, `processarTexto`).
- `npm test` e `npm run typecheck` verdes em TODO commit.
- Nunca commitar: laudos reais, chaves, `secrets.enc.json`, `.env`, `laudo.config.json`.
- Branch de trabalho: `fase-a-contencao` (criada na Task 1). **Sem worktree** — o usuário testa `npm run dev` neste mesmo workspace.
- Commits pequenos, um por task, mensagem em PT-BR, terminando com:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014ymVEaer9R69HCWL1BFWuJ
  ```

---

### Task 1: Branch + typecheck cobre os `.tsx`

A auditoria apontou que `tsconfig.json` exclui os 6 renderers `.tsx` do typecheck. As tasks 7/10/12 editam `.tsx` — sem isso, trabalharíamos às cegas.

**Files:**
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: —
- Produces: typecheck protegendo todos os arquivos das tasks seguintes.

- [ ] **Step 1: Criar a branch**

Run: `git checkout -b fase-a-contencao`
Expected: `Switched to a new branch 'fase-a-contencao'`

- [ ] **Step 2: Incluir `.tsx` no tsconfig**

Em `tsconfig.json`, trocar a linha:

```json
  "include": ["src/**/*.ts", "scripts/**/*.ts", "eval/**/*.ts"]
```

por:

```json
  "include": ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "eval/**/*.ts"]
```

- [ ] **Step 3: Rodar typecheck e corrigir o que aparecer**

Run: `npm run typecheck`
Expected: idealmente sem erros (o build electron-vite já transpila esses arquivos). Se aparecerem erros de tipo nos renderers, corrigi-los um a um (são erros reais que estavam invisíveis). **Se aparecerem mais de 15 erros, PARAR e reportar antes de continuar.**

- [ ] **Step 4: Rodar a suíte**

Run: `npm test`
Expected: 27/27 passando (nada mudou em runtime).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.json src/renderer
git commit -m "typecheck passa a cobrir os renderers .tsx (lacuna da auditoria TEST-01)"
```

---

### Task 2: Validador do laudo final + `stripMarkers` abrangente

Defesa contra o P0-04: o laudo real `2026-07-18_181223` saiu com `<!-- orgao: vesícula-biliar -->` porque `stripMarkers` só aceita IDs ASCII. Além do fix, nasce o validador determinístico que a geração usará (Task 3).

**Files:**
- Create: `src/core/engine/validate.ts`
- Create: `src/core/engine/validate.test.ts`
- Modify: `src/core/engine/diff.ts` (função `stripMarkers`)
- Modify: `src/core/engine/diff.test.ts` (novo caso)

**Interfaces:**
- Consumes: —
- Produces: `validarLaudo(report: string): ValidacaoLaudo` com `ValidacaoLaudo { erros: string[]; avisos: string[] }`; `PLACEHOLDERS_ANONIMIZACAO: string[]`. `stripMarkers` passa a remover QUALQUER linha-comentário HTML.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/core/engine/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validarLaudo } from './validate.js';

const LAUDO_OK = `TOMOGRAFIA COMPUTADORIZADA DO ABDOME TOTAL

Técnica:

Exame realizado em aparelho multislice, sem contraste endovenoso.

Fígado de dimensões normais, contornos regulares e densidade preservada.

Vesícula biliar normodistendida, sem cálculos radiopacos.

Impressão:

Exame dentro dos padrões da normalidade.`;

describe('validarLaudo', () => {
  it('aprova laudo limpo', () => {
    const v = validarLaudo(LAUDO_OK);
    expect(v.erros).toEqual([]);
    expect(v.avisos).toEqual([]);
  });

  it('bloqueia marcador de bloco vazado (caso real da auditoria)', () => {
    const v = validarLaudo(`${LAUDO_OK}\n<!-- orgao: vesícula-biliar -->`);
    expect(v.erros.length).toBeGreaterThan(0);
  });

  it('bloqueia cabeçalho de patch vazado', () => {
    const v = validarLaudo(`${LAUDO_OK}\n@@ substituir: rins`);
    expect(v.erros.length).toBeGreaterThan(0);
  });

  it('bloqueia laudo suspeitamente curto (truncamento)', () => {
    expect(validarLaudo('Fígado normal.').erros.length).toBeGreaterThan(0);
  });

  it('avisa (sem bloquear) placeholder de anonimização', () => {
    const v = validarLaudo(`${LAUDO_OK}\nComparado ao exame de [NOME].`);
    expect(v.erros).toEqual([]);
    expect(v.avisos.length).toBe(1);
  });
});
```

Adicionar em `src/core/engine/diff.test.ts` (dentro do describe existente de `stripMarkers`, ou novo bloco):

```ts
it('remove marcador com id acentuado (vazamento real da auditoria)', () => {
  const texto = 'Fígado normal.\n<!-- orgao: vesícula-biliar -->\nVesícula sem cálculos.';
  const limpo = stripMarkers(texto);
  expect(limpo).not.toContain('<!--');
  expect(limpo).toContain('Vesícula sem cálculos.');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/engine/validate.test.ts src/core/engine/diff.test.ts`
Expected: FAIL — `validate.js` não existe; teste novo do stripMarkers falha (marcador acentuado permanece).

- [ ] **Step 3: Implementar**

Criar `src/core/engine/validate.ts`:

```ts
/**
 * Validação determinística do laudo final — última linha de defesa antes do
 * clipboard: resíduo técnico (marcador, cabeçalho de patch, truncamento)
 * BLOQUEIA a entrega; placeholder de anonimização vira aviso ao médico.
 */

/** Placeholders que o anonymizer pode ter injetado no comando ditado. */
export const PLACEHOLDERS_ANONIMIZACAO = ['[NOME]', '[CPF]', '[ID]', '[CRM]', '[DATA]', '[TEL]'];

export interface ValidacaoLaudo {
  /** Impedem a entrega. */
  erros: string[];
  /** O médico precisa ver, mas não bloqueiam. */
  avisos: string[];
}

export function validarLaudo(report: string): ValidacaoLaudo {
  const erros: string[] = [];
  const avisos: string[] = [];
  if (report.trim().length < 100) erros.push('laudo suspeitamente curto — geração provavelmente truncada');
  if (/<!--|-->/.test(report)) erros.push('marcador técnico interno vazou para o texto');
  if (/^@@/m.test(report)) erros.push('cabeçalho de patch vazou para o texto');
  for (const ph of PLACEHOLDERS_ANONIMIZACAO) {
    if (report.includes(ph)) {
      avisos.push(`o laudo contém ${ph} — um dado pessoal foi removido do comando; complete à mão se fizer falta`);
    }
  }
  return { erros, avisos };
}
```

Em `src/core/engine/diff.ts`, trocar `stripMarkers` para remover qualquer linha-comentário (laudo médico não tem comentário HTML legítimo):

```ts
/** Linha que é só um comentário HTML — qualquer marcador, mesmo malformado/acentuado. */
const COMMENT_LINE_RE = /^<!--.*-->$/;

/** Remove os marcadores HTML do laudo final (o que vai para o clipboard). */
export function stripMarkers(report: string): string {
  return report
    .split('\n')
    .filter((line) => !COMMENT_LINE_RE.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

(`MARKER_RE` continua existindo e inalterado — `parseOrganBlocks` o usa para parsear máscaras, que são ASCII por schema.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/core/engine/validate.test.ts src/core/engine/diff.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Suíte inteira + typecheck**

Run: `npm test && npm run typecheck`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/validate.ts src/core/engine/validate.test.ts src/core/engine/diff.ts src/core/engine/diff.test.ts
git commit -m "validador determinístico do laudo final + stripMarkers remove qualquer comentário (P0-04)"
```

---

### Task 3: Parser de patches normaliza IDs, proíbe bloco vazio; geração valida o resultado

Fecha a raiz do vazamento (ID acentuado emitido pelo modelo) e liga o `validarLaudo` dentro do ciclo de retry da geração: resultado inválido → 1 retry → falha explícita (nunca entrega).

**Files:**
- Modify: `src/core/engine/patch.ts`
- Modify: `src/core/engine/patch.test.ts` (novos casos)
- Modify: `src/core/engine/engine.ts` (`runPatches`, `buildResult`, `GenerationResult`)

**Interfaces:**
- Consumes: `validarLaudo`, `stripMarkers` (Task 2).
- Produces: `GenerationResult` ganha `avisos: string[]`. `parsePatches` normaliza `alvo`/`novoId` para ASCII kebab-case e lança `PatchError` para texto vazio. Consumidores de `generate`/`refine` (pipeline, CLI) NÃO quebram — só ganham o campo novo.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/core/engine/patch.test.ts`, trocar a linha de import por (adiciona `PatchError`):

```ts
import { PatchError, applyPatches, parsePatches, patchedIds } from './patch.js';
```

E adicionar ao fim do arquivo:

```ts
describe('normalização de ids (P0-04)', () => {
  it('normaliza novoId acentuado para ascii kebab-case', () => {
    const ops = parsePatches('@@ inserir-apos: figado | id: vesícula-biliar\nVesícula com cálculo.');
    expect(ops[0]!.novoId).toBe('vesicula-biliar');
  });

  it('normaliza alvo acentuado para casar bloco ascii da máscara', () => {
    const ops = parsePatches('@@ substituir: fígado\nFígado com esteatose.');
    expect(ops[0]!.alvo).toBe('figado');
  });

  it('rejeita substituição com texto vazio', () => {
    expect(() => parsePatches('@@ substituir: rins\n')).toThrow(PatchError);
  });

  it('rejeita inserção com texto vazio', () => {
    expect(() => parsePatches('@@ inserir-apos: rins | id: novo\n')).toThrow(PatchError);
  });
});
```

(Confirmar no arquivo os imports existentes — `parsePatches` e `PatchError` já são importados pelos testes atuais.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/engine/patch.test.ts`
Expected: FAIL nos 4 casos novos.

- [ ] **Step 3: Implementar em `patch.ts`**

Adicionar o helper (acima de `parsePatches`):

```ts
/** Normaliza um id de bloco para o formato canônico ASCII kebab-case (o único que stripMarkers/máscaras usam). */
function normalizarId(id: string): string {
  return id
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

Em `parsePatches`, aplicar a normalização:

- No ramo `substituir` (linha do `else current = { tipo: 'substituir', alvo, texto: '' };`), trocar para:
  ```ts
  else current = { tipo: 'substituir', alvo: normalizarId(alvo), texto: '' };
  ```
- No ramo `inserir-apos`/`inserir-antes`, trocar a montagem de `current` para:
  ```ts
  current = {
    tipo,
    alvo: normalizarId(alvo!.trim()),
    novoId: normalizarId(idParte?.replace(/^\s*id:\s*/, '').trim() ?? '') || 'novo',
    texto: '',
  };
  ```

Após o `flush()` final e antes do `if (ops.length === 0)`, adicionar a checagem de texto vazio:

```ts
for (const op of ops) {
  if (op.tipo !== 'sem-alteracoes' && !op.texto) {
    throw new PatchError(`patch "${op.tipo}${op.alvo ? `: ${op.alvo}` : ''}" com texto vazio`);
  }
}
```

(Isso também cobre `titulo`/`tecnica` vazios — hoje uma `tecnica` vazia apagaria a linha de técnica silenciosamente.)

- [ ] **Step 4: Ligar `validarLaudo` na geração (`engine.ts`)**

Adicionar import:

```ts
import { validarLaudo } from './validate.js';
```

Trocar a interface `PatchRun` e o corpo de `runPatches`:

```ts
interface PatchRun {
  reportRaw: string;
  report: string;
  changed: string[];
  usage: LLMUsage;
  avisos: string[];
}
```

Dentro do `try` de `runPatches`, trocar:

```ts
      const ops = parsePatches(result.text);
      return { reportRaw: applyPatches(baseBody, ops), changed: patchedIds(ops), usage };
```

por:

```ts
      const ops = parsePatches(result.text);
      const reportRaw = applyPatches(baseBody, ops);
      const report = stripMarkers(reportRaw);
      const val = validarLaudo(report);
      if (val.erros.length > 0) throw new PatchError(val.erros.join('; '));
      return { reportRaw, report, changed: patchedIds(ops), usage, avisos: val.avisos };
```

E a mensagem final de erro (fora do loop):

```ts
  throw new Error(`geração falhou na validação do laudo: ${lastErr}`);
```

Em `GenerationResult`, adicionar o campo:

```ts
  /** Avisos não bloqueantes do validador (ex.: placeholder de anonimização no texto). */
  avisos: string[];
```

Em `buildResult`, usar o que `runPatches` já calculou:

```ts
function buildResult(maskBody: string, run: PatchRun, t0: number): GenerationResult {
  const organIds = parseOrganBlocks(maskBody).map((b) => b.id);
  return {
    report: run.report,
    reportRaw: run.reportRaw,
    avisos: run.avisos,
    diff: {
      changed: run.changed,
      kept: organIds.filter((id) => !run.changed.includes(id)),
    },
    durationMs: performance.now() - t0,
    usage: run.usage,
  };
}
```

- [ ] **Step 5: Rodar tudo**

Run: `npm test && npm run typecheck`
Expected: PASS. (Typecheck: `pipeline.ts` e `cli` não referenciam `avisos` ainda — campo extra não quebra nada.)

- [ ] **Step 6: Commit**

```bash
git add src/core/engine/patch.ts src/core/engine/patch.test.ts src/core/engine/engine.ts
git commit -m "patches: ids normalizados p/ ascii, bloco vazio rejeitado; geração valida laudo final com retry (P0-04)"
```

---

### Task 4: `sanitizeComando` — sanitização do ditado antes do LLM

P0-01/PRIV-02: o app hoje envia o transcript cru ao Claude. Nasce a função canônica de sanitização de COMANDO (política própria: datas ditadas são conteúdo clínico → aviso, não remoção).

**Files:**
- Modify: `src/core/anonymizer/patterns.ts` (campo `escopo` no `PatternDef`)
- Modify: `src/core/anonymizer/anonymizer.ts`
- Modify: `src/core/anonymizer/anonymizer.test.ts` (novos casos)

**Interfaces:**
- Consumes: `PATTERNS` de `./patterns.js`.
- Produces: `sanitizeComando(transcript: string): ComandoSanitizado` com `ComandoSanitizado { texto: string; avisos: string[] }`. Avisos em PT-BR prontos para a UI. `PatternDef` ganha `escopo?: 'documento'` (o `sanitize()` de acervo NÃO muda de comportamento).

**Cuidado de design:** o pattern de nome rotulado dos PDFs (`paciente: <resto da linha>`) mascara a LINHA INTEIRA — em ditado corrido isso engoliria os achados clínicos ("paciente João, com diverticulite" viraria só `[NOME]`). Por isso ele é marcado `escopo: 'documento'` e o comando usa padrões próprios, que param no fim do nome próprio.

- [ ] **Step 1: Escrever os testes que falham**

Em `src/core/anonymizer/anonymizer.test.ts`, estender o import da linha 2:

```ts
import { examTypeFromFilename, patientNameFromFilename, sanitize, sanitizeComando } from './anonymizer.js';
```

E adicionar ao fim do arquivo:

```ts
describe('sanitizeComando (ditado → LLM)', () => {
  it('mascara nome e CPF, PRESERVANDO o conteúdo clínico ao redor', () => {
    const r = sanitizeComando('tomografia de abdome do paciente João da Silva, CPF 123.456.789-00, com diverticulite');
    expect(r.texto).toContain('[NOME]');
    expect(r.texto).toContain('[CPF]');
    expect(r.texto).not.toContain('João');
    expect(r.texto).toContain('com diverticulite'); // o achado sobrevive à sanitização
    expect(r.avisos.length).toBe(2);
  });

  it('mascara nome ditado com pontuação de rótulo ("paciente: João da Silva")', () => {
    const r = sanitizeComando('paciente: João da Silva, apendicite aguda');
    expect(r.texto).not.toContain('João da Silva');
    expect(r.texto).toContain('apendicite aguda');
  });

  it('mascara número de prontuário ditado sem pontuação', () => {
    const r = sanitizeComando('prontuário 123456, tomografia de crânio normal');
    expect(r.texto).not.toContain('123456');
    expect(r.texto).toContain('tomografia de crânio normal');
  });

  it('NÃO remove data (conteúdo clínico), mas avisa', () => {
    const r = sanitizeComando('comparar com exame de 15/03/2026, estável');
    expect(r.texto).toContain('15/03/2026');
    expect(r.avisos.length).toBe(1);
  });

  it('comando limpo passa intacto e sem avisos', () => {
    const cmd = 'tomografia de abdome total com contraste, diverticulite do cólon direito não complicada';
    const r = sanitizeComando(cmd);
    expect(r.texto).toBe(cmd);
    expect(r.avisos).toEqual([]);
  });

  it('deduplica avisos do mesmo tipo', () => {
    const r = sanitizeComando('paciente João da Silva e solicitante Maria Souza Lima');
    expect(r.texto).not.toContain('João');
    expect(r.texto).not.toContain('Maria');
    expect(r.avisos.length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/anonymizer/anonymizer.test.ts`
Expected: FAIL — `sanitizeComando` não existe.

- [ ] **Step 3: Marcar o pattern de linha inteira em `patterns.ts`**

Em `PatternDef`, adicionar o campo:

```ts
  /** 'documento': só faz sentido em laudo/PDF (linha rotulada) — o sanitizeComando o ignora. */
  escopo?: 'documento';
```

E no PRIMEIRO item de `PATTERNS` (nome rotulado com `[:.]` que mascara o resto da linha), adicionar a propriedade:

```ts
    escopo: 'documento',
```

(`sanitize()` não lê `escopo` — o fluxo de acervo/PDF continua idêntico.)

- [ ] **Step 4: Implementar (ao fim de `anonymizer.ts`)**

```ts
export interface ComandoSanitizado {
  texto: string;
  /** Avisos legíveis para o médico (dedup por tipo). */
  avisos: string[];
}

const TIPO_LEGIVEL: Record<string, string> = {
  nome: 'um nome',
  cpf: 'um CPF',
  id: 'um número de registro',
  crm: 'um CRM',
  telefone: 'um telefone',
};

/**
 * Padrões próprios do ditado: param no fim do nome próprio / número, preservando
 * o conteúdo clínico ao redor (diferente dos rótulos de linha inteira dos PDFs).
 */
const COMANDO_EXTRA: PatternDef[] = [
  {
    tipo: 'nome',
    // "paciente João da Silva" / "paciente: João da Silva" / "solicitante Maria Souza"
    regex:
      /\b([Pp]aciente|[Ss]olicitante)(\s*[:,]?\s+)((?:[A-ZÀ-Ú][a-zà-úü]+)(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][a-zà-úü]+)+)/g,
    replacement: '$1$2[NOME]',
  },
  {
    tipo: 'id',
    // "prontuário 123456" ditado sem a pontuação exigida pelo pattern de documento
    regex: /\b(prontu[aá]rio|registro|protocolo|atendimento)\s+(\d[\d.\-\/]{2,})/gi,
    replacement: '$1 [ID]',
  },
];

/**
 * Sanitização do COMANDO DITADO antes de qualquer LLM. Datas NÃO são removidas —
 * em ditado são conteúdo clínico legítimo ("comparar com exame de 15/03/2026");
 * geram apenas aviso. Os demais identificadores são mascarados.
 */
export function sanitizeComando(transcript: string): ComandoSanitizado {
  const tiposVistos = new Set<string>();
  let texto = transcript;
  let temData = false;
  const aplicaveis = [...COMANDO_EXTRA, ...PATTERNS.filter((p) => p.escopo !== 'documento')];
  for (const { tipo, regex, replacement } of aplicaveis) {
    if (tipo === 'data') {
      if (!temData) temData = new RegExp(regex.source, regex.flags.replace('g', '')).test(texto);
      continue;
    }
    texto = texto.replace(regex, (...args) => {
      tiposVistos.add(tipo);
      return replacement.replace(/\$(\d)/g, (_, n) => {
        const group = args[Number(n)];
        return typeof group === 'string' ? group : '';
      });
    });
  }
  const avisos = [...tiposVistos].map((t) => `removi ${TIPO_LEGIVEL[t] ?? t} do comando por privacidade`);
  if (temData) avisos.push('o comando cita uma data — confira se ela não identifica o paciente');
  return { texto, avisos };
}
```

(Import necessário no topo de `anonymizer.ts`: trocar a linha por `import { PATTERNS, PatternDef } from './patterns.js';`.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/core/anonymizer/anonymizer.test.ts`
Expected: PASS — inclusive os testes ANTIGOS de `sanitize` (o fluxo de acervo não pode mudar).

- [ ] **Step 6: Suíte + typecheck + commit**

Run: `npm test && npm run typecheck`

```bash
git add src/core/anonymizer/patterns.ts src/core/anonymizer/anonymizer.ts src/core/anonymizer/anonymizer.test.ts
git commit -m "sanitizeComando: ditado sanitizado antes do LLM preservando conteúdo clínico, datas viram aviso (PRIV-02)"
```

---

### Task 5: `rankMasks` — candidatos determinísticos para o gate de confiança

O gate (Task 6) precisa oferecer 2–3 candidatos quando a confiança é média — SEM mexer no prompt de seleção. Ranking local por sobreposição de tokens, determinístico e testável. De quebra, o `matcher.ts` ganha os testes que a auditoria cobrou.

**Files:**
- Modify: `src/core/masks/matcher.ts`
- Create: `src/core/masks/matcher.test.ts`

**Interfaces:**
- Consumes: `Mask` de `./schema.js`; helpers internos existentes (`normalizar`, `escapeRe`, `base`, `resolverContraste`).
- Produces: `rankMasks(transcript: string, masks: Mask[], topN?: number): Mask[]` — melhores máscaras (uma por família, variante de contraste já resolvida), maior score primeiro, score zero excluído.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/core/masks/matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Mask } from './schema.js';
import { matchLocal, rankMasks, resolverContraste } from './matcher.js';

function mk(id: string, nome: string, sinonimos: string[] = [], contraste: 'sem' | 'com' | 'opcional' = 'sem'): Mask {
  return {
    id,
    modalidade: 'TC',
    regiao: [],
    nome,
    sinonimos,
    contraste,
    versao: 1,
    origem: 'manual',
    prefixos: [],
    body: '',
    filePath: `${id}.md`,
  };
}

const MASKS: Mask[] = [
  mk('tc-abdome-total', 'TC de abdome total', ['abdome', 'abdômen']),
  mk('tc-abdome-total-com-contraste', 'TC de abdome total com contraste', ['abdome', 'abdômen'], 'com'),
  mk('tc-torax', 'TC de tórax', ['tórax', 'pulmão']),
  mk('tc-cranio', 'TC de crânio', ['crânio', 'cabeça']),
];

describe('matchLocal', () => {
  it('decide quando uma única família casa', () => {
    expect(matchLocal('tomografia de tórax com nódulo', MASKS)?.id).toBe('tc-torax');
  });
  it('devolve null em ambiguidade (duas famílias)', () => {
    expect(matchLocal('abdome e tórax', MASKS)).toBeNull();
  });
});

describe('resolverContraste', () => {
  it('sem citar contraste → variante sem contraste', () => {
    const m = resolverContraste(MASKS[1]!, 'tomo de abdome com diverticulite', MASKS);
    expect(m.id).toBe('tc-abdome-total');
  });
  it('citando contraste → variante com contraste', () => {
    const m = resolverContraste(MASKS[0]!, 'abdome com contraste, diverticulite', MASKS);
    expect(m.id).toBe('tc-abdome-total-com-contraste');
  });
});

describe('rankMasks', () => {
  it('ranqueia a família certa em primeiro', () => {
    const r = rankMasks('essa tomo de abdome mostra diverticulite', MASKS);
    expect(r[0]!.id).toBe('tc-abdome-total');
  });
  it('resolve a variante de contraste do candidato', () => {
    const r = rankMasks('abdome com contraste, diverticulite', MASKS);
    expect(r[0]!.id).toBe('tc-abdome-total-com-contraste');
  });
  it('exclui score zero e respeita topN', () => {
    const r = rankMasks('tomografia de crânio', MASKS, 2);
    expect(r.map((m) => m.id)).toEqual(['tc-cranio']); // tórax/abdome têm score zero
  });
  it('uma máscara por família', () => {
    const r = rankMasks('abdome', MASKS, 4);
    expect(r.filter((m) => m.id.startsWith('tc-abdome')).length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/core/masks/matcher.test.ts`
Expected: FAIL — `rankMasks` não existe.

- [ ] **Step 3: Implementar (ao fim de `matcher.ts`)**

```ts
/**
 * Ranking LOCAL de máscaras por sobreposição de tokens com o comando —
 * alimenta o gate de confiança (candidatos quando a seleção do LLM é "media").
 * Determinístico, custo zero. Uma máscara por família; variante de contraste
 * resolvida pela convenção do médico.
 */
export function rankMasks(transcript: string, masks: Mask[], topN = 3): Mask[] {
  const t = normalizar(transcript);
  const palavras = new Set(t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
  const porFamilia = new Map<string, { mask: Mask; score: number }>();
  for (const m of masks) {
    let score = 0;
    for (const s of [m.nome, ...m.sinonimos]) {
      const sn = normalizar(s);
      if (new RegExp(`\\b${escapeRe(sn)}\\b`).test(t)) score += 10;
      for (const w of sn.split(/[^a-z0-9]+/)) {
        if (w.length >= 3 && palavras.has(w)) score += 1;
      }
    }
    const fam = base(m.id);
    const atual = porFamilia.get(fam);
    if (!atual || score > atual.score) porFamilia.set(fam, { mask: m, score });
  }
  return [...porFamilia.values()]
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((x) => resolverContraste(x.mask, transcript, masks));
}
```

- [ ] **Step 4: Rodar e ver passar; suíte; commit**

Run: `npx vitest run src/core/masks/matcher.test.ts && npm test && npm run typecheck`

```bash
git add src/core/masks/matcher.ts src/core/masks/matcher.test.ts
git commit -m "rankMasks: candidatos locais p/ gate de confiança + testes do matcher (SAFE-01)"
```

---

### Task 6: Gate de confiança no pipeline do app + sanitização integrada

Coração do SAFE-01/PRIV-02 no app: `baixa` nunca gera; `media` devolve pedido de confirmação; sanitização na entrada; avisos fluem até o resultado; mensagem de chave aponta para Configurações.

**Files:**
- Modify: `src/main/pipeline.ts`

**Interfaces:**
- Consumes: `sanitizeComando` (T4), `rankMasks` (T5), `GenerationResult.avisos` (T3), `getMask` de `../core/masks/library.js`.
- Produces (para T7/T8):
  ```ts
  export interface ResultadoLaudo { tipo: 'laudo'; report; transcript; maskId; maskNome; confianca; blocosAlterados; avisos: string[]; tempos; custoUSD }
  export interface PedidoConfirmacao { tipo: 'confirmar-mascara'; transcript: string; confianca: 'media'; candidatos: { id: string; nome: string }[]; avisos: string[] }
  export type ResultadoPipeline = ResultadoLaudo | PedidoConfirmacao;
  export function processarTexto(t: string): Promise<ResultadoPipeline>
  export function processarAudio(a: Buffer): Promise<ResultadoPipeline>
  export function gerarComMascara(maskId: string, transcript: string): Promise<ResultadoLaudo>
  // refinarTexto/refinarAudio/desfazer continuam devolvendo ResultadoLaudo (com tipo/avisos)
  ```

- [ ] **Step 1: Reescrever `pipeline.ts`**

Substituir o conteúdo por (mudanças: imports, tipos, `exigirChave`, gate, `gerarLaudo` extraído, `gerarComMascara`, avisos; áudio ainda em disco — a Task 11 remove):

```ts
/**
 * Ponte entre o app Electron e o core: áudio/texto → laudo pronto.
 * Recarrega máscaras/regras a cada laudo (edições nos .md valem na hora).
 * Gates da Fase A: sanitização do ditado antes de qualquer LLM e política de
 * confiança (alta gera; media pede confirmação; baixa nunca gera).
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeComando } from '../core/anonymizer/anonymizer.js';
import { Config, loadConfig } from '../core/config/schema.js';
import { loadProfile, loadRegras } from '../core/contexto.js';
import { stripMarkers } from '../core/engine/diff.js';
import { generate, refine, selectMask } from '../core/engine/engine.js';
import { LLMClient, LLMUsage, estimateCostUSD } from '../core/llm/anthropic.js';
import { getMask, loadLibrary } from '../core/masks/library.js';
import { matchLocal, rankMasks } from '../core/masks/matcher.js';
import { Mask } from '../core/masks/schema.js';
import { OpenAISTT } from '../core/stt/openai.js';

export interface ResultadoLaudo {
  tipo: 'laudo';
  report: string;
  transcript: string;
  maskId: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  /** Avisos ao médico (sanitização do comando + validador do laudo). */
  avisos: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
}

/** Seleção com confiança média: o médico confirma a máscara antes de gerar. */
export interface PedidoConfirmacao {
  tipo: 'confirmar-mascara';
  transcript: string;
  confianca: 'media';
  /** Sugerida do modelo em primeiro; demais do ranking local. */
  candidatos: { id: string; nome: string }[];
  avisos: string[];
}

export type ResultadoPipeline = ResultadoLaudo | PedidoConfirmacao;

let appRoot = process.cwd();
export function initPipeline(root: string): void {
  appRoot = root;
}

/** Sessão do último laudo — base para refino por voz e desfazer. */
interface Sessao {
  mask: Mask;
  regras?: string;
  profileName: string;
  profileBody: string;
  versions: string[]; // reportRaw de cada versão (com marcadores)
}
let sessao: Sessao | null = null;

function getConfig(): Config {
  return loadConfig(appRoot);
}

function exigirChave(nome: 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY'): void {
  if (!process.env[nome]) {
    throw new Error(`chave ${nome} não configurada — abra Configurações → Chaves de API pelo menu da bandeja`);
  }
}

export function processarTexto(transcript: string): Promise<ResultadoPipeline> {
  return processarTranscript(transcript, 0);
}

export async function processarAudio(audio: Buffer): Promise<ResultadoPipeline> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  return processarTranscript(r.text, r.durationMs);
}

interface Selecao {
  mask: Mask;
  confianca: string;
  durationMs: number;
  usage: LLMUsage | null;
}

async function processarTranscript(transcript: string, sttMs: number): Promise<ResultadoPipeline> {
  exigirChave('ANTHROPIC_API_KEY');
  const config = getConfig();
  const masks = loadLibrary(config.masksDir);
  const san = sanitizeComando(transcript);
  const llm = new LLMClient();

  const local = matchLocal(san.texto, masks);
  const sel = local
    ? { mask: local, confianca: 'alta' as const, durationMs: 0, usage: null }
    : await selectMask(llm, config.llm.selectionModel, san.texto, masks);
  if (!sel.mask || sel.confianca === 'baixa') {
    throw new Error(
      'não tive certeza do exame — repita o comando citando o nome do exame (ex.: "tomografia de abdome total com contraste, …")',
    );
  }
  if (sel.confianca === 'media') {
    const candidatos = [{ id: sel.mask.id, nome: sel.mask.nome }];
    for (const m of rankMasks(san.texto, masks)) {
      if (candidatos.length >= 3) break;
      if (!candidatos.some((c) => c.id === m.id)) candidatos.push({ id: m.id, nome: m.nome });
    }
    return { tipo: 'confirmar-mascara', transcript: san.texto, confianca: 'media', candidatos, avisos: san.avisos };
  }
  return gerarLaudo(llm, config, { mask: sel.mask, confianca: sel.confianca, durationMs: sel.durationMs, usage: sel.usage }, san.texto, sttMs, san.avisos);
}

/** Geração com máscara escolhida explicitamente pelo médico (gate de confiança). */
export async function gerarComMascara(maskId: string, transcript: string): Promise<ResultadoLaudo> {
  exigirChave('ANTHROPIC_API_KEY');
  const config = getConfig();
  const masks = loadLibrary(config.masksDir);
  const mask = getMask(masks, maskId);
  if (!mask) throw new Error(`máscara não encontrada: ${maskId}`);
  const san = sanitizeComando(transcript);
  const llm = new LLMClient();
  return gerarLaudo(llm, config, { mask, confianca: 'manual', durationMs: 0, usage: null }, san.texto, 0, san.avisos);
}

async function gerarLaudo(
  llm: LLMClient,
  config: Config,
  sel: Selecao,
  transcript: string,
  sttMs: number,
  avisosSanitizacao: string[],
): Promise<ResultadoLaudo> {
  const profile = loadProfile(config, config.perfilPadrao);
  const regras = loadRegras(config, sel.mask.id);
  const gen = await generate(llm, {
    mask: sel.mask,
    transcript,
    profileName: profile.name,
    profileBody: profile.body,
    model: config.llm.generationModel,
    regras,
  });

  sessao = {
    mask: sel.mask,
    regras,
    profileName: profile.name,
    profileBody: profile.body,
    versions: [gen.reportRaw],
  };

  return {
    tipo: 'laudo',
    report: gen.report,
    transcript,
    maskId: sel.mask.id,
    maskNome: sel.mask.nome,
    confianca: sel.confianca,
    blocosAlterados: gen.diff.changed,
    avisos: [...avisosSanitizacao, ...gen.avisos],
    tempos: {
      sttMs: Math.round(sttMs),
      selecaoMs: Math.round(sel.durationMs),
      geracaoMs: Math.round(gen.durationMs),
    },
    custoUSD: Number(
      (
        (sel.usage ? estimateCostUSD(config.llm.selectionModel, sel.usage) : 0) +
        estimateCostUSD(config.llm.generationModel, gen.usage)
      ).toFixed(4),
    ),
  };
}

export function getOutputDir(): string {
  return getConfig().outputDir;
}

async function refinarTranscript(command: string, sttMs: number): Promise<ResultadoLaudo> {
  if (!sessao) throw new Error('nenhum laudo nesta sessão para refinar — gere um laudo primeiro');
  const config = getConfig();
  const san = sanitizeComando(command);
  const llm = new LLMClient();
  const gen = await refine(llm, {
    mask: sessao.mask,
    currentReportRaw: sessao.versions[sessao.versions.length - 1]!,
    command: san.texto,
    profileName: sessao.profileName,
    profileBody: sessao.profileBody,
    model: config.llm.generationModel,
    regras: sessao.regras,
  });
  sessao.versions.push(gen.reportRaw);
  return {
    tipo: 'laudo',
    report: gen.report,
    transcript: san.texto,
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'refino',
    blocosAlterados: gen.diff.changed,
    avisos: [...san.avisos, ...gen.avisos],
    tempos: { sttMs: Math.round(sttMs), selecaoMs: 0, geracaoMs: Math.round(gen.durationMs) },
    custoUSD: Number(estimateCostUSD(config.llm.generationModel, gen.usage).toFixed(4)),
  };
}

export function refinarTexto(command: string): Promise<ResultadoLaudo> {
  return refinarTranscript(command, 0);
}

export async function refinarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  const tmp = join(tmpdir(), `aerolince-refino-${Date.now()}.webm`);
  writeFileSync(tmp, audio);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribe(tmp);
  if (!r.text) throw new Error('não entendi o áudio do refino — tente de novo');
  return refinarTranscript(r.text, r.durationMs);
}

/** Volta uma versão do laudo da sessão (ou null se não houver o que desfazer). */
export function desfazer(): ResultadoLaudo | null {
  if (!sessao || sessao.versions.length < 2) return null;
  sessao.versions.pop();
  const raw = sessao.versions[sessao.versions.length - 1]!;
  return {
    tipo: 'laudo',
    report: stripMarkers(raw),
    transcript: '(desfazer)',
    maskId: sessao.mask.id,
    maskNome: sessao.mask.nome,
    confianca: 'desfeito',
    blocosAlterados: [],
    avisos: [],
    tempos: { sttMs: 0, selecaoMs: 0, geracaoMs: 0 },
    custoUSD: 0,
  };
}
```

(Nota: `getMask` vem de `library.js` — confirmar que é exportado lá; a CLI já o importa de lá.)

- [ ] **Step 2: Typecheck (vai acusar o `main/index.ts`)**

Run: `npm run typecheck`
Expected: erros APENAS em `src/main/index.ts` (`processar` recebe `ResultadoPipeline`). Se aparecer erro em outro lugar, corrigir antes de seguir. **NÃO commitar ainda** — a Task 7 conserta o `index.ts` e o commit é conjunto.

---

### Task 7: App roteia confirmação — IPC, preload e UI da janela de resultado

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/result/main.tsx`
- Modify: `src/renderer/result/index.html` (CSS)

**Interfaces:**
- Consumes: `ResultadoPipeline`, `PedidoConfirmacao`, `gerarComMascara` (T6).
- Produces: IPC `gerar-com-mascara(maskId, transcript)`; evento `confirmar-mascara` (payload `PedidoConfirmacao`); preload `gerarComMascara`, `onConfirmarMascara`. Janela de erro agora aparece (showInactive no catch).

- [ ] **Step 1: `src/main/index.ts`**

No bloco de imports do pipeline, adicionar `gerarComMascara` e `ResultadoPipeline`:

```ts
import {
  ResultadoLaudo,
  ResultadoPipeline,
  desfazer,
  gerarComMascara,
  getOutputDir,
  initPipeline,
  processarAudio,
  processarTexto,
  refinarAudio,
  refinarTexto,
} from './pipeline.js';
```

Trocar a função `processar` inteira por:

```ts
async function processar(fn: () => Promise<ResultadoPipeline>): Promise<{ ok: boolean; erro?: string }> {
  estado('processando');
  try {
    const r = await fn();
    if (r.tipo === 'confirmar-mascara') {
      resultWin?.webContents.send('confirmar-mascara', r);
      resultWin?.showInactive();
      estado('ok');
      return { ok: true };
    }
    await entregar(r);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    estado('erro', msg);
    resultWin?.webContents.send('resultado-erro', msg);
    resultWin?.showInactive();
    return { ok: false, erro: msg };
  }
}
```

(Duas mudanças: o ramo `confirmar-mascara` e o `resultWin?.showInactive()` no catch — a auditoria apontou que o erro detalhado ficava invisível.)

Em `registrarIpc()`, logo após o handler de `refinar-texto`, adicionar:

```ts
  ipcMain.handle('gerar-com-mascara', (_e, maskId: string, transcript: string) =>
    processar(() => gerarComMascara(maskId, transcript)),
  );
```

- [ ] **Step 2: `src/preload/index.ts`**

Após `refinarTexto`, adicionar:

```ts
  gerarComMascara: (maskId: string, transcript: string): Promise<Resp> =>
    ipcRenderer.invoke('gerar-com-mascara', maskId, transcript),
```

No bloco `// Eventos`, após `onResultadoErro`, adicionar:

```ts
  onConfirmarMascara: (cb: (p: Record<string, unknown>) => void): void =>
    void ipcRenderer.on('confirmar-mascara', (_e, p) => cb(p)),
```

- [ ] **Step 3: `src/renderer/result/main.tsx`**

Adicionar aos tipos locais (abaixo de `interface Resultado`, que ganha o campo `avisos`):

```ts
interface Resultado {
  report: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  avisos?: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
  savedPath: string;
  arquivo: string;
}

interface Confirmacao {
  transcript: string;
  candidatos: { id: string; nome: string }[];
  avisos?: string[];
}
```

Novos estados (junto dos existentes):

```ts
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [gerando, setGerando] = useState(false);
```

No `useEffect`, atualizar os handlers e registrar o novo:

```ts
    window.aerolince.onResultado((p) => {
      const r = p as unknown as Resultado;
      setResultado(r);
      setTexto(r.report);
      arquivo.current = r.arquivo ?? '';
      geradoRef.current = r.report;
      setErro(null);
      setCopiado(false);
      setRefinoFase('idle');
      setConfirmacao(null);
      setGerando(false);
    });
    window.aerolince.onResultadoErro((msg) => {
      setErro(msg);
      setRefinoFase('idle');
      setGerando(false);
    });
    window.aerolince.onConfirmarMascara((p) => {
      setConfirmacao(p as unknown as Confirmacao);
      setResultado(null);
      setErro(null);
      setGerando(false);
      setRefinoFase('idle');
    });
```

Nova função (junto de `copiar`):

```ts
  function confirmarMascara(id: string): void {
    if (!confirmacao || gerando) return;
    setGerando(true);
    setErro(null);
    void window.aerolince.gerarComMascara(id, confirmacao.transcript);
  }
```

No JSX, logo após `{erro && <div className="erro-box">{erro}</div>}`, adicionar o painel:

```tsx
      {confirmacao && !resultado && (
        <div className="confirmar">
          <div className="titulo">Não tive certeza do exame. Gerar como:</div>
          {confirmacao.candidatos.map((c, k) => (
            <button key={c.id} className={k === 0 ? 'primario' : ''} disabled={gerando} onClick={() => confirmarMascara(c.id)}>
              {c.nome}
            </button>
          ))}
          <button className="cancelar" disabled={gerando} onClick={() => setConfirmacao(null)}>
            Nenhum destes — vou ditar de novo citando o exame
          </button>
          {gerando && <div className="status">… gerando o laudo</div>}
        </div>
      )}
```

Dentro do ramo `resultado ? (...)`, imediatamente antes do `<textarea`, adicionar:

```tsx
          {(resultado.avisos?.length ?? 0) > 0 && (
            <div className="aviso-box">🛡️ {resultado.avisos!.join(' · ')}</div>
          )}
```

E no ramo vazio, trocar a condição `!erro && (` por `!erro && !confirmacao && (`.

- [ ] **Step 4: CSS em `src/renderer/result/index.html`**

Após o bloco `.erro-box { … }`, adicionar:

```css
      .aviso-box {
        margin: 12px 16px 0;
        padding: 10px 14px;
        background: color-mix(in srgb, #d9a03f 16%, transparent);
        border: 1px solid color-mix(in srgb, #d9a03f 55%, transparent);
        border-radius: 10px;
        font-size: 12.5px;
      }
      .confirmar {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 24px 20px;
        justify-content: center;
      }
      .confirmar .titulo { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
      .confirmar button { text-align: left; padding: 12px 16px; font-size: 13.5px; }
      .confirmar .cancelar {
        text-align: center;
        color: var(--texto-suave);
        background: none;
        border: none;
      }
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm test && npm run build:app`
Expected: tudo verde (os erros da Task 6 em `index.ts` somem).

- [ ] **Step 6: Commit (Tasks 6+7 juntas — o app só compila com as duas)**

```bash
git add src/main/pipeline.ts src/main/index.ts src/preload/index.ts src/renderer/result
git commit -m "gate de confiança: baixa nunca gera, media pede confirmação com candidatos; ditado sanitizado antes do LLM; avisos na UI; erro sempre visível (SAFE-01, PRIV-02)"
```

---

### Task 8: Gate de confiança e sanitização na CLI

A CLI também processa ditado real (`laudo texto`/`gravar`) — mesma política, modo terminal.

**Files:**
- Modify: `src/cli/index.ts`

**Interfaces:**
- Consumes: `sanitizeComando` (T4), `rankMasks` (T5); `getMask`/`createInterface` já importados no arquivo.
- Produces: comportamento — `baixa` aborta (exit 2) com lista; `media` pergunta no terminal (ENTER confirma a sugerida).

- [ ] **Step 1: Imports**

Adicionar aos imports existentes:

```ts
import { sanitizeComando } from '../core/anonymizer/anonymizer.js';
```

e na linha que importa do matcher:

```ts
import { matchLocal, rankMasks } from '../core/masks/matcher.js';
```

- [ ] **Step 2: Sanitizar o transcript**

Em `runPipeline`, logo após `if (!transcript) throw new Error('sem comando…');`, adicionar:

```ts
  const san = sanitizeComando(transcript);
  if (san.avisos.length > 0) console.warn(`⚠️  ${san.avisos.join(' | ')}`);
  transcript = san.texto;
```

- [ ] **Step 3: Gate no bloco de seleção via LLM**

Trocar o bloco atual:

```ts
  if (!mask) {
    const sel = await selectMask(llm, config.llm.selectionModel, transcript, masks);
    selMs = sel.durationMs;
    selCost = estimateCostUSD(config.llm.selectionModel, sel.usage);
    confianca = sel.confianca;
    if (!sel.mask) {
      console.error(`\nNão identifiquei o exame (confiança: ${sel.confianca}).`);
      console.error(`Máscaras disponíveis:\n${masks.map((m) => `  ${m.id} — ${m.nome}`).join('\n')}`);
      console.error(`\nRode de novo com --mask <id>.`);
      process.exit(2);
    }
    mask = sel.mask;
  }
```

por:

```ts
  if (!mask) {
    const sel = await selectMask(llm, config.llm.selectionModel, transcript, masks);
    selMs = sel.durationMs;
    selCost = estimateCostUSD(config.llm.selectionModel, sel.usage);
    confianca = sel.confianca;
    if (!sel.mask || sel.confianca === 'baixa') {
      console.error(`\nNão tive certeza do exame (confiança: ${sel.confianca}).`);
      console.error(`Máscaras disponíveis:\n${masks.map((m) => `  ${m.id} — ${m.nome}`).join('\n')}`);
      console.error(`\nRode de novo com --mask <id>.`);
      process.exit(2);
    }
    if (sel.confianca === 'media') {
      const sugerida = sel.mask;
      const candidatos = [sugerida, ...rankMasks(transcript, masks).filter((m) => m.id !== sugerida.id)].slice(0, 3);
      console.log('\nConfiança média — confirme o exame:');
      candidatos.forEach((m, k) => console.log(`  ${k + 1}. ${m.nome} [${m.id}]`));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const resp = await new Promise<string>((res) =>
        rl.question(`ENTER confirma "${sugerida.nome}", ou digite número/id: `, (x) => res(x.trim())),
      );
      rl.close();
      if (resp) {
        const porNumero = /^\d+$/.test(resp) ? candidatos[Number(resp) - 1] : undefined;
        const escolhida = porNumero ?? getMask(masks, resp);
        if (!escolhida) {
          console.error(`"${resp}" não é um número da lista nem um id válido.`);
          process.exit(2);
        }
        mask = escolhida;
        confianca = 'manual';
      } else {
        mask = sugerida;
      }
    } else {
      mask = sel.mask;
    }
  }
```

- [ ] **Step 4: Verificar sem gastar API**

Run: `npm run typecheck && npm run laudo -- texto "essa tomo é uma diverticulite do colo direito não complicada" --dry-run`
Expected: typecheck verde; dry-run imprime o comando (sanitizado — idêntico, pois é limpo) e o catálogo, sem chamadas de API.

Run: `npm run laudo -- texto "tomo do paciente João da Silva com apendicite" --dry-run`
Expected: linha `⚠️  removi um nome do comando por privacidade` e o comando exibido com `[NOME]`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts
git commit -m "CLI: ditado sanitizado + gate de confiança (baixa aborta, media confirma no terminal)"
```

---

### Task 9: Configuração atômica com backup, recuperação e schemaVersion

P0-06/CONFIG-01: hoje `saveConfig` grava ANTES de validar (um patch inválido corrompe o arquivo e impede o boot) e `loadConfig` explode com JSON inválido.

**Files:**
- Create: `src/core/atomic-write.ts`
- Create: `src/core/config/config.test.ts`
- Modify: `src/core/config/schema.ts`

**Interfaces:**
- Consumes: —
- Produces: `writeFileAtomicSync(path, data)` (usado também na T10). `loadConfig`/`saveConfig` mantêm as assinaturas — comportamento novo: corrompido nunca impede boot (preservado como `laudo.config.corrompido-<ts>.json`, `.bak` assume, senão defaults); save valida antes, faz backup e grava atômico; overlay ganha `schemaVersion: 1`.

- [ ] **Step 1: `src/core/atomic-write.ts`**

```ts
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Escrita atômica: tmp no mesmo diretório → fsync → rename. */
export function writeFileAtomicSync(path: string, data: string): void {
  const tmp = join(dirname(path), `.${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, data, 'utf8');
  const fd = openSync(tmp, 'r+');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `src/core/config/config.test.ts`:

```ts
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig } from './schema.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aerolince-config-'));
});

describe('loadConfig com recuperação', () => {
  it('sem arquivo → defaults', () => {
    const c = loadConfig(root);
    expect(c.masksDir.endsWith('biblioteca-mascaras')).toBe(true);
    expect(c.perfilPadrao).toBe('padrao');
  });

  it('JSON corrompido não impede o boot: preserva o arquivo e usa defaults', () => {
    writeFileSync(join(root, 'laudo.config.json'), '{{{ nem json', 'utf8');
    const c = loadConfig(root);
    expect(c.perfilPadrao).toBe('padrao');
    const arquivos = readdirSync(root);
    expect(arquivos.some((f) => f.startsWith('laudo.config.corrompido-'))).toBe(true);
    expect(arquivos.includes('laudo.config.json')).toBe(false);
  });

  it('overlay que viola o schema também cai em recuperação', () => {
    writeFileSync(join(root, 'laudo.config.json'), JSON.stringify({ ui: { tema: 'roxo' } }), 'utf8');
    const c = loadConfig(root);
    expect(c.ui.tema).toBe('auto');
    expect(readdirSync(root).some((f) => f.startsWith('laudo.config.corrompido-'))).toBe(true);
  });

  it('backup .bak assume quando o principal corrompe', () => {
    saveConfig(root, { perfilPadrao: 'meu-estilo' });
    saveConfig(root, { perfilPadrao: 'meu-estilo-2' }); // gera .bak com meu-estilo
    writeFileSync(join(root, 'laudo.config.json'), 'corrompido', 'utf8');
    const c = loadConfig(root);
    expect(c.perfilPadrao).toBe('meu-estilo'); // veio do .bak
    expect(readFileSync(join(root, 'laudo.config.json'), 'utf8')).toContain('meu-estilo');
  });
});

describe('saveConfig atômico', () => {
  it('roundtrip com schemaVersion no overlay', () => {
    saveConfig(root, { perfilPadrao: 'x' });
    expect(loadConfig(root).perfilPadrao).toBe('x');
    const bruto = JSON.parse(readFileSync(join(root, 'laudo.config.json'), 'utf8'));
    expect(bruto.schemaVersion).toBe(1);
  });

  it('patch inválido lança e NÃO toca o arquivo em disco', () => {
    saveConfig(root, { perfilPadrao: 'antes' });
    const antes = readFileSync(join(root, 'laudo.config.json'), 'utf8');
    expect(() => saveConfig(root, { ui: { tema: 'roxo' } })).toThrow();
    expect(readFileSync(join(root, 'laudo.config.json'), 'utf8')).toBe(antes);
  });

  it('merge aninhado de ui preserva os demais campos', () => {
    saveConfig(root, { ui: { tema: 'escuro' } });
    saveConfig(root, { ui: { opacidadeBalao: 0.5 } });
    const c = loadConfig(root);
    expect(c.ui.tema).toBe('escuro');
    expect(c.ui.opacidadeBalao).toBe(0.5);
  });

  it('não deixa arquivo temporário para trás', () => {
    saveConfig(root, { perfilPadrao: 'x' });
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
```

Run: `npx vitest run src/core/config/config.test.ts`
Expected: FAIL (vários — comportamento novo não existe).

- [ ] **Step 3: Reescrever a parte de load/save em `schema.ts`**

Trocar a linha de imports do fs por:

```ts
import { copyFileSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { writeFileAtomicSync } from '../atomic-write.js';
```

No `ConfigSchema`, adicionar como primeiro campo:

```ts
  schemaVersion: z.number().default(1),
```

Substituir `loadConfig` e `saveConfig` (e a const `CONFIG_FILE`) por:

```ts
const CONFIG_FILE = 'laudo.config.json';
const BACKUP_FILE = 'laudo.config.json.bak';

function defaultsDe(appRoot: string) {
  return {
    masksDir: resolve(appRoot, '..', 'biblioteca-mascaras'),
    profilesDir: resolve(appRoot, 'perfis'),
    outputDir: resolve(appRoot, '..', 'Laudos Gerados'),
    stt: { model: 'gpt-4o-transcribe', glossario: GLOSSARIO_PADRAO },
    llm: {
      kimiModel: 'kimi-k2-0905-preview',
      kimiBaseURL: 'https://api.moonshot.ai/anthropic',
    },
  };
}

/** Migrações do overlay por schemaVersion (idempotentes). Hoje só existe a v1. */
function migrarOverlay(raw: Record<string, unknown>): Record<string, unknown> {
  return raw;
}

function mesclar(defaults: ReturnType<typeof defaultsDe>, user: Record<string, unknown>): Config {
  return ConfigSchema.parse({
    ...defaults,
    ...user,
    stt: { ...defaults.stt, ...(user['stt'] as object | undefined) },
    llm: { ...defaults.llm, ...(user['llm'] as object | undefined) },
  });
}

function parseOverlay(texto: string): Record<string, unknown> {
  const raw: unknown = JSON.parse(texto);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('config não é um objeto');
  return migrarOverlay(raw as Record<string, unknown>);
}

/** Overlay bruto atual (sem recuperação) — base do merge do saveConfig. */
function lerOverlayBruto(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    return parseOverlay(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Carrega a configuração com recuperação: arquivo corrompido (JSON ou schema)
 * é PRESERVADO (renomeado laudo.config.corrompido-<ts>.json), o backup .bak
 * assume se for válido; sem backup, valem os defaults. Corrupção nunca
 * impede o boot (P0-06 da auditoria).
 */
export function loadConfig(appRoot: string): Config {
  const defaults = defaultsDe(appRoot);
  const file = join(appRoot, CONFIG_FILE);
  const bak = join(appRoot, BACKUP_FILE);
  if (!existsSync(file)) return mesclar(defaults, {});
  try {
    return mesclar(defaults, parseOverlay(readFileSync(file, 'utf8')));
  } catch {
    renameSync(file, join(appRoot, `laudo.config.corrompido-${Date.now()}.json`));
    if (existsSync(bak)) {
      try {
        const config = mesclar(defaults, parseOverlay(readFileSync(bak, 'utf8')));
        copyFileSync(bak, file);
        return config;
      } catch {
        /* backup também inválido — segue para defaults */
      }
    }
    return mesclar(defaults, {});
  }
}

/**
 * Aplica um patch raso à configuração persistida e devolve a config validada.
 * Valida ANTES de tocar o disco; grava com backup (.bak) e escrita atômica.
 */
export function saveConfig(appRoot: string, patch: Record<string, unknown>): Config {
  const file = join(appRoot, CONFIG_FILE);
  const atual = lerOverlayBruto(file);
  const merged: Record<string, unknown> = { ...atual, ...patch, schemaVersion: 1 };
  // Preserva os campos aninhados que a tela edita por objeto inteiro (ui/llm/stt)
  for (const chave of ['ui', 'llm', 'stt'] as const) {
    if (patch[chave]) merged[chave] = { ...((atual[chave] as object | undefined) ?? {}), ...(patch[chave] as object) };
  }
  const config = mesclar(defaultsDe(appRoot), merged); // lança se o patch for inválido — arquivo intacto
  if (existsSync(file)) copyFileSync(file, join(appRoot, BACKUP_FILE));
  writeFileAtomicSync(file, JSON.stringify(merged, null, 2));
  return config;
}
```

(Atenção: no schema atual, o campo `ui` usa `.prefault({})` — o teste "overlay que viola o schema" garante que `tema: 'roxo'` lança de fato. Se `prefault` engolir o valor inválido, trocar a expectativa do teste — verificar o comportamento real ao rodar.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/core/config/config.test.ts && npm test && npm run typecheck`
Expected: PASS. (`loadConfig` mantém a assinatura — pipeline/CLI/main intocados.)

- [ ] **Step 5: Commit**

```bash
git add src/core/atomic-write.ts src/core/config/schema.ts src/core/config/config.test.ts
git commit -m "config: valida antes de gravar, escrita atômica, backup .bak, recuperação de corrupção e schemaVersion (P0-06)"
```

---

### Task 10: Cofre honesto — status real, remoção, teste de chave, falha explícita

P0-06/SECRET-01: hoje `statusChaves` diz "configurada" para blob indecifrável, e salvar sem cofre disponível DELETA a chave silenciosamente.

**Files:**
- Create: `src/main/secrets.test.ts`
- Modify: `src/main/secrets.ts`
- Modify: `src/main/index.ts` (IPC `secrets-testar`)
- Modify: `src/preload/index.ts` (tipos novos + `secretsTestar`)
- Modify: `src/renderer/settings/main.tsx` (seção de chaves)
- Modify: `src/renderer/onboarding/main.tsx` (consumo do status novo)

**Interfaces:**
- Consumes: `writeFileAtomicSync` (T9).
- Produces:
  ```ts
  export type StatusChave = 'ok' | 'invalida' | 'ausente';
  export interface StatusCofre { cofreDisponivel: boolean; chaves: Record<NomeChave, StatusChave> }
  export function statusChaves(root: string): StatusCofre          // MUDANÇA DE SHAPE
  export function testarChave(nome: NomeChave): Promise<{ ok: boolean; erro?: string }>
  // salvarChave passa a LANÇAR se o cofre não estiver disponível (valor não-vazio)
  ```

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/main/secrets.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => {
      const t = b.toString();
      if (!t.startsWith('enc:')) throw new Error('blob inválido');
      return t.slice(4);
    }),
  },
}));

import { safeStorage } from 'electron';
import { salvarChave, statusChaves } from './secrets.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aerolince-secrets-'));
  delete process.env['MOONSHOT_API_KEY'];
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
});

describe('cofre honesto (P0-06)', () => {
  it('roundtrip: salvar → status ok', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    const s = statusChaves(root);
    expect(s.cofreDisponivel).toBe(true);
    expect(s.chaves.MOONSHOT_API_KEY).toBe('ok');
    expect(process.env['MOONSHOT_API_KEY']).toBe('sk-teste');
  });

  it('salvar com cofre indisponível LANÇA (não deleta silenciosamente)', () => {
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
    expect(() => salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste')).toThrow(/cofre/);
  });

  it('blob indecifrável aparece como invalida, não como configurada', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    vi.mocked(safeStorage.decryptString).mockImplementation(() => {
      throw new Error('corrompido');
    });
    delete process.env['MOONSHOT_API_KEY'];
    expect(statusChaves(root).chaves.MOONSHOT_API_KEY).toBe('invalida');
  });

  it('valor vazio remove a chave → ausente', () => {
    salvarChave(root, 'MOONSHOT_API_KEY', 'sk-teste');
    salvarChave(root, 'MOONSHOT_API_KEY', '');
    expect(statusChaves(root).chaves.MOONSHOT_API_KEY).toBe('ausente');
    expect(process.env['MOONSHOT_API_KEY']).toBeUndefined();
  });
});
```

Run: `npx vitest run src/main/secrets.test.ts`
Expected: FAIL (shape antigo de `statusChaves`; salvar não lança).

- [ ] **Step 2: Reescrever `src/main/secrets.ts`**

```ts
/**
 * Chaves de API guardadas com criptografia do SO (safeStorage: Keychain no mac,
 * DPAPI no Windows). Carregadas no boot e injetadas em process.env — o core
 * continua lendo process.env sem saber da existência deste módulo.
 * Migra automaticamente chaves que já estavam num .env legado.
 * Honestidade do status (P0-06): blob indecifrável = "invalida", nunca "ok";
 * salvar sem cofre disponível FALHA em vez de descartar a chave.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { writeFileAtomicSync } from '../core/atomic-write.js';

export type NomeChave = 'ANTHROPIC_API_KEY' | 'OPENAI_API_KEY' | 'MOONSHOT_API_KEY';
const CHAVES: NomeChave[] = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MOONSHOT_API_KEY'];

export type StatusChave = 'ok' | 'invalida' | 'ausente';
export interface StatusCofre {
  cofreDisponivel: boolean;
  chaves: Record<NomeChave, StatusChave>;
}

function arq(root: string): string {
  return join(root, 'secrets.enc.json');
}

function lerCofre(root: string): Record<string, string> {
  const p = arq(root);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

/** Grava uma chave criptografada (valor vazio remove). Lança se o cofre não estiver disponível. */
export function salvarChave(root: string, nome: NomeChave, valor: string): void {
  const cofre = lerCofre(root);
  if (valor.trim()) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('o cofre do sistema não está disponível — não dá para salvar a chave com segurança agora');
    }
    cofre[nome] = safeStorage.encryptString(valor.trim()).toString('base64');
    process.env[nome] = valor.trim();
  } else {
    delete cofre[nome];
    delete process.env[nome];
  }
  writeFileAtomicSync(arq(root), JSON.stringify(cofre, null, 2));
}

/** Carrega o cofre e injeta em process.env. Importa (sem apagar) de um .env se preciso. */
export function carregarChaves(root: string): void {
  const cofre = lerCofre(root);
  for (const nome of CHAVES) {
    if (cofre[nome] && safeStorage.isEncryptionAvailable()) {
      try {
        process.env[nome] = safeStorage.decryptString(Buffer.from(cofre[nome]!, 'base64'));
      } catch {
        console.warn(`chave ${nome} no cofre está indecifrável — reconfigure em Configurações`);
      }
    }
  }
  // Importa de um .env existente para o cofre — NÃO altera o .env (a CLI ainda o usa)
  const envPath = join(root, '.env');
  if (existsSync(envPath) && safeStorage.isEncryptionAvailable()) {
    const linhas = readFileSync(envPath, 'utf8').split('\n');
    for (const nome of CHAVES) {
      if (process.env[nome]) continue;
      const valor = linhas.find((l) => l.startsWith(`${nome}=`))?.slice(nome.length + 1).trim();
      if (valor) salvarChave(root, nome, valor);
    }
  }
}

/** Estado REAL das chaves (valida a descriptografia; nunca revela o valor). */
export function statusChaves(root: string): StatusCofre {
  const cofre = lerCofre(root);
  const disponivel = safeStorage.isEncryptionAvailable();
  const chaves = {} as Record<NomeChave, StatusChave>;
  for (const nome of CHAVES) {
    if (cofre[nome]) {
      if (!disponivel) {
        chaves[nome] = 'invalida';
        continue;
      }
      try {
        safeStorage.decryptString(Buffer.from(cofre[nome]!, 'base64'));
        chaves[nome] = 'ok';
      } catch {
        chaves[nome] = 'invalida';
      }
    } else {
      chaves[nome] = process.env[nome] ? 'ok' : 'ausente';
    }
  }
  return { cofreDisponivel: disponivel, chaves };
}

const ENDPOINTS: Record<NomeChave, { url: string; headers: (k: string) => Record<string, string> }> = {
  ANTHROPIC_API_KEY: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }),
  },
  OPENAI_API_KEY: {
    url: 'https://api.openai.com/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
  MOONSHOT_API_KEY: {
    url: 'https://api.moonshot.ai/v1/models',
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
  },
};

/** Testa a chave EM USO (process.env) contra a API do provedor — nenhum dado clínico é enviado. */
export async function testarChave(nome: NomeChave): Promise<{ ok: boolean; erro?: string }> {
  const valor = process.env[nome];
  if (!valor) return { ok: false, erro: 'chave não configurada' };
  const { url, headers } = ENDPOINTS[nome];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const resp = await fetch(url, { headers: headers(valor), signal: ctrl.signal });
    clearTimeout(timer);
    if (resp.ok) return { ok: true };
    if (resp.status === 401 || resp.status === 403) return { ok: false, erro: 'chave inválida ou revogada' };
    return { ok: false, erro: `serviço respondeu ${resp.status}` };
  } catch {
    return { ok: false, erro: 'sem conexão com o serviço' };
  }
}
```

Run: `npx vitest run src/main/secrets.test.ts`
Expected: PASS.

- [ ] **Step 3: IPC em `src/main/index.ts`**

No bloco de imports de `./secrets.js`, adicionar `testarChave`:

```ts
import { NomeChave, carregarChaves, salvarChave, statusChaves, testarChave } from './secrets.js';
```

Após o handler `secrets-set`, adicionar:

```ts
  ipcMain.handle('secrets-testar', (_e, nome: NomeChave) => testarChave(nome));
```

- [ ] **Step 4: Preload — tipos novos**

Em `src/preload/index.ts`, acima da const `api`, adicionar:

```ts
type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };
```

Trocar as duas entradas de chaves e adicionar a terceira:

```ts
  secretsStatus: (): Promise<StatusCofre> => ipcRenderer.invoke('secrets-status'),
  secretsSet: (nome: string, valor: string): Promise<StatusCofre> =>
    ipcRenderer.invoke('secrets-set', nome, valor),
  secretsTestar: (nome: string): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('secrets-testar', nome),
```

- [ ] **Step 5: `src/renderer/settings/main.tsx` — seção de chaves**

Acima do componente `App`, adicionar:

```ts
type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };
```

Trocar o estado `chaves` e adicionar os novos:

```ts
  const [cofre, setCofre] = useState<StatusCofre | null>(null);
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [erroChave, setErroChave] = useState<string | null>(null);
```

No `useEffect`, trocar `setChaves(await api.secretsStatus());` por:

```ts
      setCofre(await api.secretsStatus());
```

Trocar `gravarChave` e adicionar `removerChave`/`rodarTeste`:

```ts
  async function gravarChave(nome: string) {
    const valor = novaChave[nome] ?? '';
    setErroChave(null);
    try {
      setCofre(await api.secretsSet(nome, valor));
      setNovaChave((s) => ({ ...s, [nome]: '' }));
      setTeste((s) => ({ ...s, [nome]: '' }));
      flashSalvo();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroChave(msg.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    }
  }
  async function removerChave(nome: string) {
    setErroChave(null);
    setCofre(await api.secretsSet(nome, ''));
    setTeste((s) => ({ ...s, [nome]: '' }));
    flashSalvo();
  }
  async function rodarTeste(nome: string) {
    setTeste((s) => ({ ...s, [nome]: '…' }));
    const r = await api.secretsTestar(nome);
    setTeste((s) => ({ ...s, [nome]: r.ok ? '✓ chave válida' : `✗ ${r.erro ?? 'falhou'}` }));
  }
```

Substituir a seção `<h2>Chaves de API</h2>` inteira por:

```tsx
        <div className="secao">
          <h2>Chaves de API</h2>
          {cofre && !cofre.cofreDisponivel && (
            <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>
              O cofre do sistema não está disponível — não é possível salvar chaves com segurança nesta sessão.
            </div>
          )}
          {erroChave && (
            <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>{erroChave}</div>
          )}
          {CHAVE_INFO.map(([nome, desc]) => {
            const st = cofre?.chaves[nome] ?? 'ausente';
            return (
              <div className="linha" key={nome}>
                <div style={{ flex: 1 }}>
                  <div className="rot">
                    {nome}{' '}
                    {st === 'ok' ? (
                      <span style={{ color: 'var(--oxido)' }}>● configurada</span>
                    ) : st === 'invalida' ? (
                      <span style={{ color: '#c0392b' }}>● inválida — recoloque</span>
                    ) : (
                      <span className="desc">não configurada</span>
                    )}
                    {teste[nome] && <span className="desc"> · {teste[nome]}</span>}
                  </div>
                  <div className="desc">{desc}</div>
                </div>
                <input
                  type="password"
                  placeholder={st === 'ok' ? '••••••••  (trocar)' : 'colar chave'}
                  value={novaChave[nome] ?? ''}
                  onChange={(e) => setNovaChave((s) => ({ ...s, [nome]: e.target.value }))}
                  style={{ width: 180 }}
                />
                <button onClick={() => gravarChave(nome)} disabled={!(novaChave[nome] ?? '').trim()}>
                  Salvar
                </button>
                {st === 'ok' && <button onClick={() => rodarTeste(nome)}>Testar</button>}
                {st !== 'ausente' && (
                  <button className="fantasma" onClick={() => removerChave(nome)} title="Remover a chave">
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <div className="desc" style={{ padding: '4px 14px' }}>
            As chaves ficam no cofre criptografado do sistema (Keychain / DPAPI). Ao ditar, o áudio é
            transcrito pela OpenAI e o texto sanitizado vai à Anthropic — não dite dados do paciente.
          </div>
        </div>
```

(Remover o estado antigo `const [chaves, setChaves] = …` — não sobra uso.)

- [ ] **Step 6: `src/renderer/onboarding/main.tsx` — status novo**

Trocar:

```ts
      const s = await api.secretsStatus();
      setTemChaves(Boolean(s.ANTHROPIC_API_KEY && s.OPENAI_API_KEY));
```

por:

```ts
      const s = await api.secretsStatus();
      setTemChaves(s.chaves.ANTHROPIC_API_KEY === 'ok' && s.chaves.OPENAI_API_KEY === 'ok');
```

- [ ] **Step 7: Verificar e commitar**

Run: `npm test && npm run typecheck && npm run build:app`
Expected: verde.

```bash
git add src/main/secrets.ts src/main/secrets.test.ts src/main/index.ts src/preload/index.ts src/renderer/settings/main.tsx src/renderer/onboarding/main.tsx
git commit -m "cofre honesto: status valida descriptografia, remoção e teste de chave na UI, falha explícita sem cofre (P0-06)"
```

---

### Task 11: Áudio sem tocar disco (elimina o resíduo em /tmp)

PRIV-01: em vez de "apagar em finally", o áudio deixa de existir em disco — vai da memória direto à API via `toFile`. Guarda de tamanho antes do upload.

**Files:**
- Create: `src/core/stt/audio-guard.ts`
- Create: `src/core/stt/audio-guard.test.ts`
- Modify: `src/core/stt/openai.ts`
- Modify: `src/main/pipeline.ts` (processarAudio/refinarAudio)

**Interfaces:**
- Consumes: —
- Produces: `validarAudio(byteLength: number): void` (lança erros PT-BR); `OpenAISTT.transcribeBuffer(data: Buffer, filename?: string): Promise<STTResult>`; `STTProvider` ganha `transcribeBuffer`. `transcribe(path)` continua existindo (a CLI usa).

- [ ] **Step 1: Teste do guard (falhando)**

Criar `src/core/stt/audio-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_AUDIO_BYTES, validarAudio } from './audio-guard.js';

describe('validarAudio', () => {
  it('aceita tamanho normal', () => {
    expect(() => validarAudio(500_000)).not.toThrow();
  });
  it('rejeita áudio vazio/minúsculo', () => {
    expect(() => validarAudio(100)).toThrow(/microfone/);
  });
  it('rejeita gravação acima do limite da API', () => {
    expect(() => validarAudio(MAX_AUDIO_BYTES + 1)).toThrow(/longa/);
  });
});
```

Run: `npx vitest run src/core/stt/audio-guard.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar o guard**

Criar `src/core/stt/audio-guard.ts`:

```ts
/** Limite da API de transcrição da OpenAI é 25 MB — margem de segurança. */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Guardas antes do upload: nada de buffer vazio nem gravação sem fim (P1 AUDIO-01 parcial). */
export function validarAudio(byteLength: number): void {
  if (byteLength < 1024) throw new Error('não captei áudio — confira o microfone e tente de novo');
  if (byteLength > MAX_AUDIO_BYTES) throw new Error('gravação longa demais — dite um comando mais curto');
}
```

Run: `npx vitest run src/core/stt/audio-guard.test.ts` → PASS.

- [ ] **Step 3: `transcribeBuffer` em `src/core/stt/openai.ts`**

Trocar o arquivo por:

```ts
import { createReadStream } from 'node:fs';
import OpenAI, { toFile } from 'openai';

export interface STTResult {
  text: string;
  durationMs: number;
}

export interface STTProvider {
  transcribe(audioPath: string): Promise<STTResult>;
  transcribeBuffer(data: Buffer, filename?: string): Promise<STTResult>;
}

/**
 * Transcrição via OpenAI (gpt-4o-transcribe por padrão). O `prompt` recebe o
 * glossário radiológico PT-BR para ancorar termos técnicos.
 */
export class OpenAISTT implements STTProvider {
  private client: OpenAI;

  constructor(
    private model: string,
    private glossario: string[],
    apiKey?: string,
  ) {
    this.client = new OpenAI(apiKey ? { apiKey } : undefined);
  }

  private async create(file: ReturnType<typeof createReadStream> | Awaited<ReturnType<typeof toFile>>): Promise<STTResult> {
    const t0 = performance.now();
    const result = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: 'pt',
      prompt: `Ditado de laudo de tomografia computadorizada em português. Termos: ${this.glossario.join(', ')}.`,
    });
    return { text: result.text.trim(), durationMs: performance.now() - t0 };
  }

  async transcribe(audioPath: string): Promise<STTResult> {
    return this.create(createReadStream(audioPath));
  }

  /** Do buffer direto à API — o áudio do ditado nunca toca o disco (PRIV-01). */
  async transcribeBuffer(data: Buffer, filename = 'audio.webm'): Promise<STTResult> {
    return this.create(await toFile(data, filename));
  }
}
```

- [ ] **Step 4: Pipeline sem arquivo temporário**

Em `src/main/pipeline.ts`:

Remover os imports que sobram:

```ts
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
```

Adicionar:

```ts
import { validarAudio } from '../core/stt/audio-guard.js';
```

Trocar `processarAudio`:

```ts
export async function processarAudio(audio: Buffer): Promise<ResultadoPipeline> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  validarAudio(audio.byteLength);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribeBuffer(audio, 'ditado.webm');
  if (!r.text) throw new Error('não entendi o áudio — tente de novo');
  return processarTranscript(r.text, r.durationMs);
}
```

Trocar `refinarAudio`:

```ts
export async function refinarAudio(audio: Buffer): Promise<ResultadoLaudo> {
  exigirChave('OPENAI_API_KEY');
  const config = getConfig();
  validarAudio(audio.byteLength);
  const stt = new OpenAISTT(config.stt.model, config.stt.glossario);
  const r = await stt.transcribeBuffer(audio, 'refino.webm');
  if (!r.text) throw new Error('não entendi o áudio do refino — tente de novo');
  return refinarTranscript(r.text, r.durationMs);
}
```

- [ ] **Step 5: Verificar e commitar**

Run: `npm test && npm run typecheck && npm run build:app`
Expected: verde; nenhuma referência restante a `tmpdir` em `src/main/` (`grep -rn "tmpdir" src/main/` vazio).

```bash
git add src/core/stt/audio-guard.ts src/core/stt/audio-guard.test.ts src/core/stt/openai.ts src/main/pipeline.ts
git commit -m "áudio do ditado nunca toca o disco (buffer → API) + guarda de tamanho (PRIV-01)"
```

---

### Task 12: Textos honestos sobre o fluxo de dados

PRIV-03: onboarding, docs e CLAUDE.md descrevem o fluxo REAL (áudio → OpenAI; texto sanitizado → Anthropic; limitações da sanitização por regex).

**Files:**
- Modify: `src/renderer/onboarding/main.tsx` (novo passo)
- Modify: `docs/privacidade.md`
- Modify: `CLAUDE.md` (bullet de privacidade)

**Interfaces:**
- Consumes: comportamento implementado nas tasks 4/6/11 (os textos descrevem o que agora é verdade).
- Produces: —

- [ ] **Step 1: Novo passo no onboarding**

Em `src/renderer/onboarding/main.tsx`, inserir no array `PASSOS`, entre o passo “Dite de qualquer lugar” e “Revise e cole”:

```tsx
  {
    icone: <span className="passo-emoji">🔒</span>,
    titulo: 'Voz na nuvem, laudo no seu computador',
    corpo: (
      <>
        Ao ditar, o <b>áudio</b> vai para a OpenAI virar texto, e o texto — após uma limpeza local de nomes e
        documentos — vai para a Anthropic (Claude) montar o laudo. Por isso, <b>dite achados, não dados do
        paciente</b>: nada de nome, prontuário ou data de nascimento. Máscaras e laudos ficam apenas no seu
        computador.
      </>
    ),
  },
```

- [ ] **Step 2: `docs/privacidade.md`**

Substituir o conteúdo da seção `## Princípios` por:

```markdown
## Princípios
1. **Texto sanitizado antes do LLM.** Todo texto (comando ditado transcrito ou laudo do acervo) passa pelo
   `src/core/anonymizer` no próprio computador antes de qualquer chamada de geração (Anthropic). O que sobe
   é texto sanitizado ([NOME], [CPF], [DATA], [ID], [TEL], [CRM]). No app, é o `sanitizeComando` no pipeline.
2. **O áudio do ditado vai à OpenAI para transcrição.** Anonimizar áudio localmente não é possível nesta
   fase; o fluxo é declarado no onboarding. O áudio não é gravado em disco (segue da memória direto para a
   API) e não deve conter dados do paciente — a melhor proteção é não ditá-los. STT local é alternativa
   avaliada para a Fase 2.
3. **Limitações conhecidas da sanitização (regex):** nomes ditados sem gatilho ("paciente", "doutor") podem
   escapar; datas NÃO são removidas do comando (são conteúdo clínico — comparativos) e geram apenas aviso
   na interface.
4. **Dados de pacientes nunca entram no git.** `.gitignore` cobre PDFs, áudios, laudos gerados e as pastas
   de dados. A pasta `Modelos de Laudos/` fica fora do repositório.
5. **Nomes de arquivos derivados não contêm nome de paciente** (padrão: exame + data + índice).
6. **O ditado do médico é tratado como dado a proteger**: não é logado fora da máquina; sidecar `.json` é
   local e desligável. O transcript persistido é a versão sanitizada.
7. **APIs**: Anthropic e OpenAI, por padrão contratual das APIs, não treinam modelos com dados enviados via
   API — mas "não treina" não equivale a "não retém" (logs de abuso podem reter por até 30 dias). Formalizar
   DPA/ZDR na Fase 2 (produto comercial).
8. **O produto gera rascunho.** Laudo é ato médico: o radiologista sempre revisa e assina. Isso é parte do
   posicionamento jurídico do produto.
```

(Manter a seção “Fluxo dos 280 PDFs reais” como está.)

- [ ] **Step 3: `CLAUDE.md`**

Na seção “Regras de privacidade (INEGOCIÁVEIS)”, trocar o bullet:

```markdown
- Todo texto só pode ir para APIs (Anthropic/OpenAI) **depois** de passar pelo
  `src/core/anonymizer` localmente. Sem exceção.
```

por:

```markdown
- Todo **texto** só pode ir para APIs **depois** de passar pelo `src/core/anonymizer` localmente
  (no app/CLI: `sanitizeComando` no pipeline). O **áudio** do ditado vai à OpenAI para transcrição sem
  anonimização prévia (limitação declarada no onboarding e em `docs/privacidade.md`) — nunca é gravado
  em disco, e o transcript resultante é sanitizado antes do LLM.
```

- [ ] **Step 4: Verificar e commitar**

Run: `npm run typecheck && npm run build:app`

```bash
git add src/renderer/onboarding/main.tsx docs/privacidade.md CLAUDE.md
git commit -m "textos honestos: onboarding, privacidade.md e CLAUDE.md descrevem o fluxo real de dados (PRIV-03)"
```

---

## Verificação final da fase (manual, com o usuário)

Depois da Task 12, com as chaves recolocadas pelo médico:

1. `npm run dev` → ditar comando claro → laudo gerado, sem marcador, avisos ausentes.
2. Ditar comando ambíguo (“tomografia com achado inespecífico”) → painel “Não tive certeza do exame” com 2–3 candidatos → escolher → laudo com confiança `manual`.
3. Ditar “tomo do paciente João da Silva com apendicite” → laudo + aviso 🛡️ “removi um nome…”.
4. Configurações → chave: status real, Testar (✓), Remover (✕), recolocar.
5. Corromper `laudo.config.json` na mão (`echo xxx > laudo.config.json`) → app abre normalmente, arquivo preservado como `laudo.config.corrompido-*.json`.
6. `ls /tmp/aerolince-*` → vazio após ditados (nenhum resíduo novo).

## Fora do escopo desta fase (próximas)

- STATE-01 (`ReportSession` canônica) — L, próxima sessão.
- SAFE-02 (patch JSON estruturado) e o restante de SAFE-03 (validador de medidas/lateralidade) — L.
- QA-01 (golden set clínico reprodutível) — XL.
- P1s: clipboard rico, diff inline, hardening Electron/IPC, acessibilidade, CI.
