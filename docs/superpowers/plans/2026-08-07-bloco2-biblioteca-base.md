# Bloco 2 — Biblioteca base embarcada em camadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O app instala com uma biblioteca base de 18 máscaras TC genéricas + regras gerais + frasário patológico (útil desde o primeiro boot), e a biblioteca do médico vira uma camada por cima que substitui a base por `id`/arquivo — Paulinho continua funcionando sem mudar nada.

**Architecture:** `loadLibrary` passa a aceitar N diretórios em precedência crescente (máscara de mesmo id em camada posterior substitui); `loadRegras` resolve `gerais.md`/`<maskId>.md` por arquivo (usuário vence) e o frasário por união (mesmo nome de arquivo, vence o do usuário). Config ganha `bibliotecaBaseDir` (read-only, aponta para `app/biblioteca-base` em dev/CLI e `process.resourcesPath/biblioteca-base` no empacotado, auto-corrigido no boot). Conteúdo novo versionado no repo em `app/biblioteca-base/`.

**Tech Stack:** TypeScript strict ESM, zod, gray-matter, vitest, electron-builder.

**Spec:** `docs/superpowers/specs/2026-08-07-inteligencia-do-medico-byok-design.md` (§3 Bloco 2)

## Global Constraints

- TypeScript strict, ESM, imports relativos com extensão `.js`; sem `any`.
- `src/core/` é Node puro: PROIBIDO importar Electron.
- Validação zod em todas as fronteiras.
- Identificadores PT sem acento; strings de usuário PT-BR acentuado.
- Testes vitest ao lado do código; fixtures SINTÉTICAS (nenhum laudo real; nenhum dado de paciente).
- PRIVACIDADE: `biblioteca-base/` NÃO pode conter nome de médico, nome de paciente, CPF, CRM, telefone, data pessoal — há um teste automático disso (Task 5). O fraseado idiossincrático do Paulinho deve ser neutralizado; o frasário do Guilherme/autotextos foi AUTORIZADO a embarcar como está (decisão 1 do spec).
- Compat: instalação existente (masksDir → biblioteca real com as 18 máscaras de mesmos ids) se comporta EXATAMENTE como hoje — a camada do médico cobre a base inteira; eval continua 13/13.
- Suíte inteira verde antes de cada commit: `npm test` e `npm run typecheck`.
- Trabalhar em branch `bloco2-biblioteca-base` a partir de `main` (d61a1e7).

---

### Task 1: Config `bibliotecaBaseDir` + `origem: 'base'` no schema de máscara

**Files:**
- Modify: `src/core/config/schema.ts` (campo novo + default em `defaultsDe`)
- Modify: `src/core/masks/schema.ts` (enum `origem` ganha `'base'`)
- Modify: `src/renderer/shared/types.ts` (espelho: `bibliotecaBaseDir: string` em `RendererConfig`)
- Test: `src/core/config/schema.test.ts` (estender o existente; se não existir, criar)

**Interfaces:**
- Produces: `config.bibliotecaBaseDir: string` (default `resolve(appRoot, 'biblioteca-base')`); `MaskFrontmatterSchema.origem` aceita `'base'`.

- [ ] **Step 1: Teste que falha**

Acrescentar ao teste de config (ou criar `src/core/config/schema.test.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadConfig } from './schema.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('bibliotecaBaseDir', () => {
  it('default deriva do appRoot', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'aero-cfg-'));
    const c = loadConfig(root);
    expect(c.bibliotecaBaseDir).toBe(resolve(root, 'biblioteca-base'));
  });
});
```

E ao lado das máscaras (`src/core/masks/schema.test.ts`, estender/criar):

```ts
import { describe, expect, it } from 'vitest';
import { MaskFrontmatterSchema } from './schema.js';

describe('origem base', () => {
  it('aceita origem: base', () => {
    const fm = MaskFrontmatterSchema.parse({ id: 'tc-x', modalidade: 'TC', nome: 'X', origem: 'base' });
    expect(fm.origem).toBe('base');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/config/schema.test.ts src/core/masks/schema.test.ts` → FAIL

- [ ] **Step 3: Implementar**

`src/core/config/schema.ts`:
- No `ConfigSchema`, após `outputDir`: `bibliotecaBaseDir: z.string(),`
- Em `defaultsDe(appRoot)`, após `outputDir`: `bibliotecaBaseDir: resolve(appRoot, 'biblioteca-base'),`

`src/core/masks/schema.ts`: no campo `origem`, trocar o enum por `z.enum(['importado-pdf', 'consenso', 'manual', 'base']).default('manual')` (preservando o default atual).

`src/renderer/shared/types.ts`: em `RendererConfig`, após `outputDir: string;`: `bibliotecaBaseDir: string;`

ATENÇÃO — quebra conhecida: `bibliotecaBaseDir` é obrigatório no schema, e os helpers `cfg()` de `src/core/llm/factory.test.ts` e `src/main/pipeline.gate.test.ts` constroem config via `ConfigSchema.parse({...})` SEM esse campo — vão falhar. Atualize os dois helpers acrescentando `bibliotecaBaseDir: '/x'` ao objeto. É a única quebra esperada; se aparecer outra, o typecheck/suíte aponta.

- [ ] **Step 4: Rodar** — testes novos PASS; `npm test` + `npm run typecheck` verdes

- [ ] **Step 5: Commit**

```bash
git add src/core/config/schema.ts src/core/config/schema.test.ts src/core/masks/schema.ts src/core/masks/schema.test.ts src/renderer/shared/types.ts
git commit -m "config+masks: bibliotecaBaseDir na config e origem 'base' no schema de máscara"
```

---

### Task 2: `loadLibrary` em camadas

**Files:**
- Modify: `src/core/masks/library.ts`
- Test: `src/core/masks/library.test.ts` (estender o existente)

**Interfaces:**
- Produces: `loadLibrary(dirs: string | string[]): Mask[]` — string única = comportamento atual (compat com todos os chamadores até a Task 4). Array = camadas em precedência CRESCENTE (último vence). Regras exatas:
  - diretório inexistente ou sem `.md` de máscara → camada silenciosamente vazia (NUNCA lança por camada);
  - id duplicado DENTRO da mesma camada → erro (como hoje);
  - id repetido em camada posterior → SUBSTITUI a máscara anterior (override);
  - total 0 máscaras após todas as camadas → erro `nenhuma máscara .md encontrada em <dirs separados por ', '>`.

- [ ] **Step 1: Testes que falham**

Acrescentar a `src/core/masks/library.test.ts` (usar fixtures sintéticas em `mkdtempSync`; helper local `escreverMascara(dir, id, nome)` que grava um .md mínimo com frontmatter válido):

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function dirTemp(): string {
  return mkdtempSync(join(tmpdir(), 'aero-lib-'));
}
function escreverMascara(dir: string, id: string, nome: string): void {
  writeFileSync(
    join(dir, `${id}.md`),
    `---\nid: ${id}\nmodalidade: TC\nnome: ${nome}\norigem: base\n---\nTITULO\n\nTécnica:\n\nX.\n`,
    'utf8',
  );
}

describe('loadLibrary em camadas', () => {
  it('camada posterior substitui máscara de mesmo id', () => {
    const base = dirTemp();
    const medico = dirTemp();
    escreverMascara(base, 'tc-cranio', 'Base');
    escreverMascara(base, 'tc-torax', 'Base tórax');
    escreverMascara(medico, 'tc-cranio', 'Do médico');
    const masks = loadLibrary([base, medico]);
    expect(masks).toHaveLength(2);
    expect(masks.find((m) => m.id === 'tc-cranio')!.nome).toBe('Do médico');
    expect(masks.find((m) => m.id === 'tc-torax')!.nome).toBe('Base tórax');
  });

  it('camada inexistente ou vazia não derruba; total zero lança', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'Base');
    expect(loadLibrary([base, join(base, 'nao-existe')])).toHaveLength(1);
    expect(() => loadLibrary([join(base, 'nao-existe')])).toThrow(/nenhuma máscara/);
  });

  it('id duplicado NA MESMA camada continua erro', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'A');
    writeFileSync(join(base, 'outra.md'), `---\nid: tc-cranio\nmodalidade: TC\nnome: B\n---\nY\n`, 'utf8');
    expect(() => loadLibrary([base])).toThrow(/duplicado/);
  });

  it('string única preserva o comportamento antigo', () => {
    const base = dirTemp();
    escreverMascara(base, 'tc-cranio', 'A');
    expect(loadLibrary(base)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/masks/library.test.ts` → FAIL

- [ ] **Step 3: Implementar**

Substituir `loadLibrary` em `src/core/masks/library.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/** Carrega uma camada; devolve mapa id → Mask. Duplicata na MESMA camada = erro. */
function loadCamada(dir: string): Map<string, Mask> {
  const camada = new Map<string, Mask>();
  if (!existsSync(dir)) return camada;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const filePath = join(dir, file);
    const { data, content } = matter(readFileSync(filePath, 'utf8'));
    // Arquivos .md sem frontmatter de máscara (anotações, documentos) são ignorados
    if (typeof data.id !== 'string') continue;
    const fm = MaskFrontmatterSchema.parse(data);
    if (camada.has(fm.id)) throw new Error(`id de máscara duplicado: ${fm.id} (${file})`);
    camada.set(fm.id, { ...fm, body: content.trim(), filePath });
  }
  return camada;
}

/**
 * Carrega máscaras de uma ou mais camadas (precedência CRESCENTE: a última
 * vence por id — biblioteca do médico cobre a base). Camada ausente/vazia é
 * ignorada; zero máscaras no total é erro.
 */
export function loadLibrary(dirs: string | string[]): Mask[] {
  const lista = Array.isArray(dirs) ? dirs : [dirs];
  const porId = new Map<string, Mask>();
  for (const dir of lista) for (const [id, m] of loadCamada(dir)) porId.set(id, m);
  if (porId.size === 0) throw new Error(`nenhuma máscara .md encontrada em ${lista.join(', ')}`);
  return [...porId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
```

Atenção: a versão antiga lançava para diretório único inexistente via `readdirSync` (ENOENT). A nova lança `nenhuma máscara .md encontrada` — mensagem melhor e coberta pelo teste. Se algum teste existente esperar ENOENT, atualize-o para a nova mensagem (registre no report).

- [ ] **Step 4: Rodar** — testes da task PASS; `npm test` + `npm run typecheck` verdes

- [ ] **Step 5: Commit**

```bash
git add src/core/masks/library.ts src/core/masks/library.test.ts
git commit -m "masks: loadLibrary em camadas — biblioteca do médico cobre a base por id; camada ausente não derruba"
```

---

### Task 3: `loadRegras` em camadas (regras por arquivo; frasário por união)

**Files:**
- Modify: `src/core/contexto.ts`
- Test: `src/core/contexto.test.ts` (estender/criar)

**Interfaces:**
- Consumes: `config.bibliotecaBaseDir` (Task 1).
- Produces: `loadRegras(config, maskId)` com camadas `[bibliotecaBaseDir, masksDir]`:
  - `regras/gerais.md` e `regras/<maskId>.md`: resolvidos POR ARQUIVO — se existir no `masksDir`, usa o do médico; senão o da base (sem merge de conteúdo);
  - `frasario/*.md`: união dos dois diretórios; arquivo de MESMO NOME nos dois → vence o do médico; filtro `aplica_a` inalterado;
  - ordem final: gerais → específica da máscara → frasário (ordem alfabética por nome de arquivo, como hoje).

- [ ] **Step 1: Testes que falham**

`src/core/contexto.test.ts` (fixtures sintéticas em tmp; montar config mínima via `ConfigSchema.parse` com `masksDir`/`bibliotecaBaseDir` apontando para dirs temporários):

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from './config/schema.js';
import { loadRegras } from './contexto.js';

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'aero-base-'));
  const medico = mkdtempSync(join(tmpdir(), 'aero-med-'));
  mkdirSync(join(base, 'regras'), { recursive: true });
  mkdirSync(join(base, 'frasario'), { recursive: true });
  mkdirSync(join(medico, 'regras'), { recursive: true });
  mkdirSync(join(medico, 'frasario'), { recursive: true });
  const config = ConfigSchema.parse({
    masksDir: medico, bibliotecaBaseDir: base, profilesDir: medico, outputDir: medico, stt: {}, llm: {},
  });
  return { base, medico, config };
}

describe('loadRegras em camadas', () => {
  it('gerais.md do médico substitui o da base; específica cai para a base', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'regras', 'gerais.md'), 'GERAIS BASE', 'utf8');
    writeFileSync(join(medico, 'regras', 'gerais.md'), 'GERAIS DO MÉDICO', 'utf8');
    writeFileSync(join(base, 'regras', 'tc-cranio.md'), 'CRANIO BASE', 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r).toContain('GERAIS DO MÉDICO');
    expect(r).not.toContain('GERAIS BASE');
    expect(r).toContain('CRANIO BASE');
  });

  it('frasário: união com o médico vencendo por nome de arquivo', () => {
    const { base, medico, config } = setup();
    writeFileSync(join(base, 'frasario', 'a.md'), '---\naplica_a: []\n---\nFRASE BASE A', 'utf8');
    writeFileSync(join(base, 'frasario', 'b.md'), '---\naplica_a: []\n---\nFRASE BASE B', 'utf8');
    writeFileSync(join(medico, 'frasario', 'a.md'), '---\naplica_a: []\n---\nFRASE MEDICO A', 'utf8');
    const r = loadRegras(config, 'tc-cranio')!;
    expect(r).toContain('FRASE MEDICO A');
    expect(r).not.toContain('FRASE BASE A');
    expect(r).toContain('FRASE BASE B');
  });

  it('aplica_a continua filtrando por máscara', () => {
    const { base, config } = setup();
    writeFileSync(join(base, 'frasario', 'so-torax.md'), '---\naplica_a: [tc-torax]\n---\nSO TORAX', 'utf8');
    expect(loadRegras(config, 'tc-cranio') ?? '').not.toContain('SO TORAX');
    expect(loadRegras(config, 'tc-torax')!).toContain('SO TORAX');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npx vitest run src/core/contexto.test.ts` → FAIL

- [ ] **Step 3: Implementar**

Reescrever `loadRegras` em `src/core/contexto.ts`:

```ts
/** REGRAS DO MÉDICO (gerais + da máscara) e FRASÁRIO aplicável, em camadas base → médico. */
export function loadRegras(config: Config, maskId: string): string | undefined {
  const camadas = [config.bibliotecaBaseDir, config.masksDir]; // médico por último = vence
  const parts: string[] = [];

  // Regras: resolução POR ARQUIVO — a versão do médico substitui a da base
  for (const f of ['gerais.md', `${maskId}.md`]) {
    let escolhido: string | undefined;
    for (const dir of camadas) {
      const p = join(dir, 'regras', f);
      if (existsSync(p)) escolhido = p;
    }
    if (escolhido) parts.push(readFileSync(escolhido, 'utf8').trim());
  }

  // Frasário: união das camadas; mesmo nome de arquivo → vence o do médico
  const arquivos = new Map<string, string>(); // nome → caminho vencedor
  for (const dir of camadas) {
    const frasarioDir = join(dir, 'frasario');
    if (!existsSync(frasarioDir)) continue;
    for (const f of readdirSync(frasarioDir).filter((x) => x.endsWith('.md'))) {
      arquivos.set(f, join(frasarioDir, f));
    }
  }
  for (const [f, caminho] of [...arquivos.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const { data, content } = matter(readFileSync(caminho, 'utf8'));
    const aplica = Array.isArray(data.aplica_a) ? (data.aplica_a as string[]) : [];
    if (aplica.length === 0 || aplica.includes(maskId)) {
      parts.push(`FRASÁRIO PRONTO DOS MÉDICOS (${f}) — use estas frases quando o achado ditado corresponder:\n${content.trim()}`);
    }
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
```

- [ ] **Step 4: Rodar** — task PASS; `npm test` + `npm run typecheck` verdes

- [ ] **Step 5: Commit**

```bash
git add src/core/contexto.ts src/core/contexto.test.ts
git commit -m "contexto: regras e frasário em camadas — arquivo do médico vence o da base; frasário por união"
```

---

### Task 4: Call sites usam as duas camadas

**Files:**
- Modify: `src/main/pipeline.ts` (2 usos de `loadLibrary(config.masksDir)`)
- Modify: `src/cli/index.ts` (usos de `loadLibrary` — incl. fallback masks-exemplo e comandos `masks`, `aprender`)
- Test: nenhum novo (coberto pelas Tasks 2–3; o eval é o gate de regressão)

**Interfaces:**
- Consumes: `loadLibrary(string | string[])` (Task 2).
- Produces: helper `bibliotecasDe(config): string[]` exportado de `src/core/masks/library.ts` — `[config.bibliotecaBaseDir, config.masksDir]`. Todos os call sites de produção usam `loadLibrary(bibliotecasDe(config))`.

- [ ] **Step 1: Helper**

Em `src/core/masks/library.ts` (import type de Config):

```ts
import type { Config } from '../config/schema.js';

/** Camadas de biblioteca em precedência crescente: base do app → biblioteca do médico. */
export function bibliotecasDe(config: Config): string[] {
  return [config.bibliotecaBaseDir, config.masksDir];
}
```

- [ ] **Step 2: Trocar os call sites**

`src/main/pipeline.ts`: os dois `loadLibrary(config.masksDir)` viram `loadLibrary(bibliotecasDe(config))`.

`src/cli/index.ts`: onde hoje há o fallback (`masksDir` inexistente → `masks-exemplo` com `console.warn`), manter a semântica: se NENHUMA das camadas existir, cair para `masks-exemplo`; senão `loadLibrary(bibliotecasDe(config))`. Comando `masks` lista a biblioteca em camadas e ganha uma coluna de origem: `(base)` quando `origem === 'base'` (ajuda a ver o que está coberto). `aprender todos` continua filtrando por `prefixos.length > 0` (máscaras da base têm `prefixos: []` — não entram).

- [ ] **Step 3: Rodar** — `npm test` + `npm run typecheck` verdes; `npm run laudo -- masks` lista normalmente (com a biblioteca do Paulinho cobrindo tudo, sai igual a hoje).

- [ ] **Step 4: Commit**

```bash
git add src/core/masks/library.ts src/main/pipeline.ts src/cli/index.ts
git commit -m "pipeline+cli: biblioteca em camadas via bibliotecasDe(config); fallback masks-exemplo preservado"
```

---

### Task 5: Conteúdo da `biblioteca-base/` (18 máscaras genericizadas + regras gerais + frasário) + teste de privacidade

**Files:**
- Create: `app/biblioteca-base/tc-*.md` (18 arquivos — mesmos ids da biblioteca real)
- Create: `app/biblioteca-base/regras/gerais.md`
- Create: `app/biblioteca-base/frasario/*.md` (cópia dos compactados de `../biblioteca-mascaras/frasario/`, SEM `_originais/`)
- Create: `app/biblioteca-base/LEIA-ME.md` (sem frontmatter de máscara — explica o que é a base e que edições devem ser feitas na biblioteca do médico)
- Test: `src/core/masks/biblioteca-base.test.ts`

**Interfaces:**
- Consumes: máscaras reais em `/Users/salomao/Documents/05_Empresas/Aerolince/biblioteca-mascaras/*.md` como REFERÊNCIA DE ESTRUTURA (títulos, ordem dos blocos `<!-- orgao: -->`, seções Técnica/Análise/Conclusão-Opinião, fechos).
- Produces: biblioteca base instalável; `loadLibrary(['biblioteca-base'])` devolve 18 máscaras válidas.

**Método de genericização (por máscara):**
1. Ler a máscara real correspondente em `../biblioteca-mascaras/`.
2. MANTER: `id`, `modalidade`, `regiao`, `nome`, `sinonimos`, `contraste`, título em caixa alta, a SEQUÊNCIA dos blocos `<!-- orgao: id -->` (a ordem anatômica é o valor estrutural da base), o uso de `Opinião:`/`Nota:` no crânio e `Conclusão:` nos demais, o placeholder `[LADO]` onde houver.
3. REESCREVER cada frase normal em fraseado neutro de laudário clássico brasileiro (ex.: "Fígado de dimensões normais, contornos regulares e coeficiente de atenuação preservado." — correto, impessoal, sem tique de estilo). NUNCA copiar frase literal da máscara real; a estrutura é mantida, o texto é novo.
4. Frontmatter da base: `origem: base`, `versao: 1`, `prefixos: []`, SEM `corpus_contendo`/`corpus_sem`.
5. Fechos de conclusão: usar o clássico por exame ("Exame sem alterações significativas." como padrão; crânio: "Estudo tomográfico do crânio dentro dos limites da normalidade.").
6. `regras/gerais.md`: derivar de `../biblioteca-mascaras/regras/gerais.md` mantendo APENAS guardas clínicas universais (classificações órgão-específicas, limites de protocolo sem contraste, nunca inventar medida/lateralidade) — remover qualquer menção a médico, clínica ou preferência pessoal.
7. Frasário: copiar os `.md` de `../biblioteca-mascaras/frasario/` (não os `_originais/`), preservando frontmatter `aplica_a`. Autorizado pela decisão 1 do spec.

- [ ] **Step 1: Teste que falha** — `src/core/masks/biblioteca-base.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sanitize } from '../anonymizer/anonymizer.js';
import { loadLibrary } from './library.js';

const BASE = resolve(import.meta.dirname, '..', '..', '..', 'biblioteca-base');

describe('biblioteca-base', () => {
  it('tem 18 máscaras TC válidas com origem base e prefixos vazios', () => {
    const masks = loadLibrary(BASE);
    expect(masks).toHaveLength(18);
    for (const m of masks) {
      expect(m.origem).toBe('base');
      expect(m.prefixos).toEqual([]);
      expect(m.modalidade).toBe('TC');
      expect(m.body).toMatch(/<!-- orgao: /);
      expect(m.body).toMatch(/<!-- impressao -->/);
    }
  });

  it('nenhum arquivo contém dado pessoal detectável (anonymizer zero findings)', () => {
    const arquivos: string[] = [];
    const varrer = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) varrer(join(dir, f.name));
        else if (f.name.endsWith('.md')) arquivos.push(join(dir, f.name));
      }
    };
    varrer(BASE);
    expect(arquivos.length).toBeGreaterThan(19); // 18 máscaras + gerais + frasário
    for (const a of arquivos) {
      const { findings } = sanitize(readFileSync(a, 'utf8'));
      const graves = findings.filter((f) => ['nome', 'cpf', 'telefone', 'id'].includes(f.tipo));
      expect(graves, `${a}: ${JSON.stringify(graves)}`).toHaveLength(0);
    }
  });
});
```

Nota: confira o shape real de `findings` em `src/core/anonymizer/anonymizer.ts` (campo `tipo`) e ajuste o filtro se o nome do campo divergir — o teste deve falhar por AUSÊNCIA da pasta, não por API errada.

- [ ] **Step 2: Rodar e ver falhar** — pasta não existe → FAIL

- [ ] **Step 3: Gerar o conteúdo** conforme o método acima (18 máscaras + gerais.md + frasario + LEIA-ME.md). Trabalho de CONTEÚDO cuidadoso — uma máscara por vez, comparando com a real apenas para estrutura.

- [ ] **Step 4: Rodar** — os 2 testes PASS; `npm test` + `npm run typecheck` verdes.

- [ ] **Step 5: Verificação de fidelidade estrutural** — para 3 máscaras (crânio, tórax, abdome-total): confira lado a lado que a sequência de `<!-- orgao: -->` é idêntica à da máscara real e que NENHUMA frase é cópia literal (spot-check com grep de 2-3 frases da real dentro da base — zero hits). Registre no report.

- [ ] **Step 6: Commit**

```bash
git add biblioteca-base/ src/core/masks/biblioteca-base.test.ts
git commit -m "biblioteca-base: 18 máscaras TC genéricas + regras gerais + frasário embarcado (teste de privacidade automático)"
```

---

### Task 6: Bootstrap e empacotamento

**Files:**
- Modify: `electron-builder.yml` (extraResources ganha `biblioteca-base/**`)
- Modify: `src/main/index.ts` (`bootstrap()`)
- Test: manual/build (bootstrap é Electron; a lógica pura já está coberta)

**Interfaces:**
- Consumes: `config.bibliotecaBaseDir` (Task 1), biblioteca-base (Task 5).
- Produces: comportamento de boot:
  - **Instalação nova (empacotado, sem config):** cria `userData/biblioteca-medico/` com subpastas `regras/`, `frasario/`, `_rascunhos/` (vazias); config inicial grava `masksDir: userData/biblioteca-medico`, `bibliotecaBaseDir: process.resourcesPath/biblioteca-base`, `profilesDir`, `outputDir`. NÃO copia mais `masks-exemplo`.
  - **Instalação existente (empacotado, config presente):** self-heal — se `config.bibliotecaBaseDir` não existir no disco OU não for o caminho de resources atual, `saveConfig(root, { bibliotecaBaseDir: join(process.resourcesPath, 'biblioteca-base') })`. `masksDir` do médico fica INTOCADO.
  - **Dev:** default da config já resolve `app/biblioteca-base` (Task 1); nada a fazer.

- [ ] **Step 1: electron-builder.yml**

```yaml
extraResources:
  - perfis/**
  - masks-exemplo/**
  - biblioteca-base/**
```

- [ ] **Step 2: bootstrap()**

Em `src/main/index.ts`, substituir o miolo `if (app.isPackaged) { ... }` por:

```ts
  if (app.isPackaged) {
    const baseDir = join(process.resourcesPath, 'biblioteca-base');
    const cfgPath = join(root, 'laudo.config.json');
    if (!existsSync(cfgPath)) {
      const masksDir = join(root, 'biblioteca-medico');
      const profilesDir = join(root, 'perfis');
      const outputDir = join(root, 'Laudos Gerados');
      mkdirSync(outputDir, { recursive: true });
      for (const sub of ['regras', 'frasario', '_rascunhos']) mkdirSync(join(masksDir, sub), { recursive: true });
      cpSync(join(process.resourcesPath, 'perfis'), profilesDir, { recursive: true });
      writeFileSync(
        cfgPath,
        JSON.stringify({ masksDir, profilesDir, outputDir, bibliotecaBaseDir: baseDir }, null, 2),
        'utf8',
      );
    } else {
      // Self-heal: o caminho de resources muda a cada versão instalada — realinha
      // a base sem tocar na biblioteca do médico.
      try {
        const c = loadConfig(root);
        if (c.bibliotecaBaseDir !== baseDir) saveConfig(root, { bibliotecaBaseDir: baseDir });
      } catch { /* config irrecuperável já é tratada pelo loadConfig */ }
    }
  }
```

(import de `saveConfig` junto ao `loadConfig` já importado; `masks-exemplo` continua empacotado só para dev/testes.)

- [ ] **Step 3: Gates** — `npm test`, `npm run typecheck`, `npm run build:app` e `npm run dist -- --dir` se disponível rapidamente (senão registrar que o dist completo fica para o smoke); verificar no output do builder que `biblioteca-base` entrou em `extraResources`.

- [ ] **Step 4: Commit**

```bash
git add electron-builder.yml src/main/index.ts
git commit -m "bootstrap: instalação nova nasce com biblioteca-medico vazia + base de resources; self-heal do bibliotecaBaseDir"
```

---

### Task 7: Settings mostra a biblioteca base (read-only)

**Files:**
- Modify: `src/renderer/settings/main.tsx` (seção "Pastas e modelos")

**Interfaces:**
- Consumes: `cfg.bibliotecaBaseDir` (Task 1).
- Produces: linha nova read-only entre "Biblioteca de máscaras" e "Laudos gerados":

```tsx
<div className="linha">
  <div style={{ flex: 1, minWidth: 0 }}>
    <div className="rot">Biblioteca base (do app)</div>
    <div className="desc" style={{ wordBreak: 'break-all' }}>{cfg.bibliotecaBaseDir}</div>
  </div>
  <button onClick={() => api.abrirPasta(cfg.bibliotecaBaseDir)}>Abrir</button>
</div>
```

E na linha "Biblioteca de máscaras" existente, atualizar o `.rot` para `Minha biblioteca (aprendida)` e a `.desc` da linha "Editar minhas frases padrão" para deixar claro que edições valem na SUA biblioteca (a base é substituída por ela quando os ids coincidem).

- [ ] **Step 1: Implementar** conforme acima.
- [ ] **Step 2: Gates** — `npm run typecheck` + `npm test` + `npm run build:app`.
- [ ] **Step 3: Commit**

```bash
git add src/renderer/settings/main.tsx
git commit -m "settings: linha read-only da biblioteca base; rótulos distinguem base × minha biblioteca"
```

---

### Task 8: Verificação final do bloco

**Files:**
- Modify: `docs/ESTADO.md`

- [ ] **Step 1: Gates completos** — `npm test && npm run typecheck && npm run build:app`; rodar `npm run eval` SOMENTE se houver chaves no ambiente (seleção do golden set é local na maioria; se não houver chaves, registrar que o eval fica para o smoke com o usuário).
- [ ] **Step 2: Sanidade de camadas na prática** — com a config real desta máquina (masksDir → biblioteca do Paulinho): `npm run laudo -- masks` deve listar 18 máscaras SEM nenhuma `(base)` visível (a camada do médico cobre tudo); temporariamente apontar `masksDir` para um dir vazio num config de teste (NÃO tocar o laudo.config.json real; usar cwd temporário com config próprio) e conferir que `masks` lista as 18 da base com `(base)`. Registrar as duas saídas no report.
- [ ] **Step 3: ESTADO.md** — registrar Bloco 2 concluído (biblioteca base embarcada, camadas, bootstrap novo, self-heal), pendências de smoke (instalação limpa via DMG mostra 18 máscaras base; instalação do Paulinho intocada) e próxima frente (Bloco 3).
- [ ] **Step 4: Commit**

```bash
git add docs/ESTADO.md
git commit -m "docs: ESTADO.md registra Bloco 2 (biblioteca base em camadas) concluído"
```
