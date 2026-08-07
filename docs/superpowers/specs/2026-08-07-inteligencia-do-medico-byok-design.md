# Design — Inteligência do médico + BYOK (reposicionamento do produto)

_Data: 07/08/2026. Aprovações do Salomão em conversa (10 perguntas respondidas). Execução autorizada de ponta a ponta._

## 1. Visão

O Aerolince deixa de ser "o app treinado no Paulinho" e vira **um automatizador de laudos
que aprende o jeito de cada médico**:

1. **Inteligência base embarcada** — o app instala com um pacote de máscaras TC genéricas +
   regras clínicas gerais + frasário patológico, útil desde o primeiro boot.
2. **Aprendizado do estilo** — no onboarding (e depois, sob demanda), o médico importa os
   próprios laudos (PDF/DOCX/TXT); o app destila máscaras, regras e frasário **dele** —
   sequência de preferência, jargões, detalhes técnicos — que passam por cima da base.
3. **BYOK** — o médico usa as próprias chaves OpenAI (obrigatória) e Anthropic (opcional).
   Nenhum custo de API é absorvido pela empresa. O onboarding ensina a criar as chaves e
   **bloqueia** o uso até haver chave válida.

Modelo de negócio: pago barato; mecanismo de licença fica para uma rodada futura (decisão
de 07/08). Nada nesta rodada pode impedir open-source futuro (nenhum laudo real, nenhuma
máscara literal de médico identificável no repo).

## 2. Decisões aprovadas (as 10 respostas)

| # | Decisão |
|---|---|
| 1 | Base = máscaras do Paulinho **genericizadas** (estrutura + fraseado neutro de laudário clássico). Frasário do Guilherme **pode** ser embarcado. |
| 2 | Base cobre só **TC**; arquitetura pronta para o médico criar RM/US/RX importando os laudos dele (modalidade é namespace, classificador detecta). |
| 3 | Ingestão: arrastar pasta/arquivos **PDF + DOCX + TXT**, contador por modalidade/exame. |
| 4 | Sanitização local + **revisão de amostra pelo médico + consentimento explícito** antes de qualquer envio. |
| 5 | **Estimativa de custo antes** de destilar/aprender, com confirmação. |
| 6 | Aprendizado **contínuo manual**: botão "Reaprender" acionado pelo médico (custo visível). |
| 7 | Onboarding **bloqueia** até chave válida. Modo de provedor único (só OpenAI) suportado. |
| 8 | Pago; licença/ativação **fora** desta rodada. |
| 9 | `biblioteca-mascaras` global vira **dado por usuário** (userData); base read-only embarcada; Paulinho = usuário que já fez onboarding (config existente continua valendo). |
| 10 | Executar os 3 blocos em sequência, autonomamente, com subagentes. |

## 3. Arquitetura — 3 blocos

### Bloco 1 — BYOK e provedor único

**Abstração de LLM** (hoje `LLMClient` é classe concreta Anthropic-only):

- `core/llm/types.ts` — `interface LLMProvider { complete(p: CompleteParams): Promise<LLMResult> }`
  (mesmos tipos `CompleteParams`/`LLMResult`/`SystemBlock` de hoje). Precedente do padrão:
  `STTProvider` em `stt/openai.ts:32`.
- `core/llm/anthropic.ts` — `LLMClient` passa a implementar a interface (comportamento
  intacto, incl. cache_control e baseURL Kimi).
- `core/llm/openai.ts` — novo `OpenAIProvider`: `SystemBlock[]` concatenados em uma mensagem
  `system`; `maxTokens → max_completion_tokens`; `usage.prompt_tokens_details.cached_tokens
  → cacheReadTokens` (cache automático da OpenAI; `cacheWriteTokens = 0`).
- `core/llm/factory.ts` — `criarLLM(config, papel: 'selecao'|'geracao'|'rapido')` devolve
  provider + modelo resolvidos. Substitui os 9 `new LLMClient()` espalhados
  (pipeline.ts ×3, cli/index.ts ×5, compactar-frasario.ts).

**Config** (`core/config/schema.ts`):

- `llm.provider: z.enum(['anthropic','openai']).default('anthropic')`.
- Modelos continuam em `selectionModel`/`generationModel`/`fastModel`. Guarda na factory:
  se `provider==='openai'` e o modelo configurado começa com `claude-`, usa os defaults
  OpenAI (`gpt-5-mini` geração, `gpt-5-mini` seleção — seleção quase sempre resolve local
  via matcher, o LLM é fallback); vice-versa para Anthropic. A Settings troca os defaults
  ao mudar o provedor.

**Custo** (`estimateCostUSD`): adicionar preços `gpt-5` [1.25, 10], `gpt-5-mini` [0.25, 2],
`gpt-5-nano` [0.05, 0.4] (cache read 0.1×, sem cache write na OpenAI). Modelo desconhecido
deixa de retornar 0 silencioso: retorna `null` e a telemetria mostra "custo não estimado".

**Gate de chaves** (regra nova, única em `main/pipeline.ts` e CLI):

- `OPENAI_API_KEY` é **sempre obrigatória** (STT é OpenAI).
- `ANTHROPIC_API_KEY` é obrigatória **somente se** `llm.provider === 'anthropic'` (default).
- `exigirChave` passa a receber a config e validar o conjunto necessário.

**UI**:

- `renderer/shared/ChavesApi.tsx` extraído da Settings (settings/main.tsx:194-249), com
  status/testar/cofre — reusado por Settings e onboarding.
- Settings ganha seletor "Motor de geração": "OpenAI + Anthropic (recomendado)" |
  "Só OpenAI". Texto honesto de qual chave é obrigatória em cada modo.
- Onboarding: passo BYOK bloqueante (ver Bloco 3) com instruções passo a passo de criação
  das chaves (links platform.openai.com/api-keys e console.anthropic.com), custo típico
  por laudo (~R$ 0,02–0,09) e teste embutido.

### Bloco 2 — Biblioteca base embarcada + camadas por usuário

**Conteúdo novo versionado no repo**: `app/biblioteca-base/`

- 18 máscaras TC genericizadas (mesmos ids `tc-*` de hoje; frontmatter ganha
  `origem: 'base'`; `prefixos: []`). Genericizar = manter título/Técnica/ordem de blocos
  `<!-- orgao: -->`/fechos clássicos, trocando fraseado idiossincrático por fraseado
  neutro de laudário. Sem qualquer dado de paciente (máscaras são templates de exame normal).
- `regras/gerais.md` base: guardas clínicas universais (classificações órgão-específicas,
  limites de protocolo sem contraste, nunca inventar medida/lateralidade) **sem** menção a
  médico específico.
- `frasario/` base: arquivos compactados atuais com frontmatter `aplica_a` (fonte Guilherme
  e autotextos — autorizado). Nada de `_originais/` no pacote.
- `.gitignore` hoje bloqueia `biblioteca-mascaras/` — o nome novo `biblioteca-base/` não
  colide; adicionar a `extraResources` no `electron-builder.yml`.

**Resolução em camadas** (usuário > base):

- `loadLibrary(dirs: string[])` — aceita N diretórios em ordem de precedência crescente;
  máscara de mesmo `id` em diretório posterior **substitui** (o erro atual de id duplicado
  vira override entre camadas; dentro da mesma camada continua erro).
- `contexto.loadRegras`: para `gerais.md` e `<maskId>.md`, arquivo do usuário **substitui**
  o da base (precedência por arquivo, sem merge — simples e previsível). Frasário: união
  dos dois diretórios; arquivo de mesmo nome, vence o do usuário.
- Config: novo campo `bibliotecaBaseDir: string` (default: `resolve(appRoot,'biblioteca-base')`
  na CLI/dev; no Electron empacotado o bootstrap grava explicitamente
  `join(process.resourcesPath,'biblioteca-base')`). Read-only — o app nunca escreve nela.
  Base atualiza junto com o app, sem mecanismo de upgrade/merge.
- `masksDir` continua sendo a **biblioteca do médico** (camada de cima). Default novo no
  empacotado: `userData/biblioteca-medico/` (criada vazia com `regras/`, `frasario/`,
  `_rascunhos/` no primeiro boot). Instalações existentes (Paulinho/Salomão) já têm
  `masksDir` apontando para a biblioteca real — nada muda para eles (a camada deles
  simplesmente cobre a base inteira).
- `masks-exemplo/` continua existindo só para testes/dev fallback da CLI.

**Compatibilidade**: com `masksDir` cheio (18 máscaras do Paulinho), o comportamento é
idêntico ao atual. Com `masksDir` vazio (instalação nova), o app funciona 100% na base.

### Bloco 3 — Ingestão de acervo + aprendizado dentro do app

**`core/acervo/`** (Node puro, callbacks de progresso, zero Electron):

- `extrair.ts` — PDF via `pdfjs-dist` (JS puro, sem binário externo; `pdftotext` continua
  na CLI dev como caminho alternativo), DOCX via `mammoth`, TXT direto. Arquivo sem camada
  de texto (< 40 chars) é contado e reportado ("N digitalizações não importadas — OCR fica
  para uma versão futura"); nunca descartado em silêncio.
- `classificar.ts` — determinístico por conteúdo: título/cabeçalho ("TOMOGRAFIA
  COMPUTADORIZADA DE …", "RESSONÂNCIA…", "ULTRASSONO…", "RADIOGRAFIA…") → modalidade +
  região; contraste por frase de Técnica (reusa a convenção de `citaContraste` +
  "administração intravenosa"); lateralidade normalizada (ESQ/DIR → variante `[LADO]`).
  Indecididos vão em lote único para o LLM barato do médico (custo incluído na estimativa).
  Saída: clusters `{ modalidade, exame, contraste, arquivos[] }`.
- `sanitizar.ts` — `sanitize()` do anonymizer + detecção de nome por conteúdo (linhas de
  cabeçalho rotuladas, já cobertas por PATTERNS; nome de arquivo usado como reforço quando
  seguir o padrão da clínica). Grava corpus em `config.acervoDir`
  (default `userData/acervo/`) **com frontmatter**: `exame`, `modalidade`, `contraste`,
  `origem_hash`, `confianca`. Corpus é reclassificável sem re-extração.
- `tmp-sanitized` hardcoded morre: CLI e app passam a usar `config.acervoDir`.

**`core/aprendizado/`** (movido da CLI, que vira casca fina):

- `destilar.ts` / `aprender.ts` — mesma lógica e prompts (`DESTILAR_SYSTEM`/`APRENDER_SYSTEM`
  intactos), mas: recebem lista explícita de arquivos (cluster) OU prefixos (CLI legada);
  escrevem **sempre em `_rascunhos/`** (aprender deixa de sobrescrever `regras/<id>.md` —
  a curadoria manual tipo "Ordem canônica" nunca mais é apagada); escrita atômica;
  **re-sanitização no envio** (defesa em profundidade); callback de progresso e cancelamento.
- `custo.ts` — `estimarCustoAprendizado(bytesCorpus, modelo)`: pré-estimativa por
  `chars/4` tokens de input + teto de `maxTokens` de output, via tabela de preços.
  Mostrada SEMPRE antes de rodar (decisão 5).
- `aplicar.ts` — promove rascunho aprovado: `_rascunhos/<id>.md` → máscara na biblioteca
  do médico, ou `_rascunhos/regras-<id>.md` → `regras/<id>.md` (com backup do anterior).

**IPC novo** (main): `acervo-importar(paths)`, `acervo-status`, `aprendizado-estimar`,
`aprendizado-rodar(alvos)`, `aprendizado-cancelar`, `rascunhos-listar/aplicar/descartar`,
eventos `acervo-progresso`/`aprendizado-progresso` (padrão do canal `estado`).

**UI**:

- `renderer/importar/` — wizard reutilizável (chamado pelo onboarding e pela Settings):
  1. Selecionar/arrastar arquivos ou pasta (PDF/DOCX/TXT);
  2. Extração + classificação local com progresso → tabela "514 abdome, 354 tórax, 12 não
     reconhecidos, 3 sem texto";
  3. **Revisão de amostra**: 3 documentos sanitizados exibidos + checkbox de consentimento
     ("Revisei as amostras; autorizo o envio do texto anonimizado via minha chave de API");
  4. Estimativa de custo por alvo (destilar clusters ≥ 20 laudos sem máscara própria;
     aprender para máscaras com corpus) + confirmação;
  5. Execução com progresso e cancelamento;
  6. Revisão dos rascunhos (diff contra a máscara/regra atual quando existir) → aplicar/descartar.
- `renderer/estilo/` — "Meu estilo": lista máscaras (badge base/minha), regras e frasário;
  editor com escrita atômica; botão **"Reaprender com meus laudos"** (decisão 6) que
  reusa o wizard nos passos 4–6, incluindo no corpus os laudos do histórico com
  `laudoFinalEditado` (a edição do médico é o sinal de estilo mais puro que temos).
- Onboarding reescrito como wizard com estado (passos-componente, `podeAvancar`):
  1. Bem-vindo (o que é; rascunho — o médico sempre revisa e assina);
  2. **Como o app fica inteligente** (base embarcada + "ele aprende o SEU jeito com os seus
     laudos" — expectativa correta desde o início);
  3. **Suas chaves de API** (bloqueante; ChavesApi; instruções de criação; escolha do modo
     de provedor; custo típico por laudo);
  4. Privacidade (voz na nuvem, laudo local, anonimização antes de qualquer LLM);
  5. **Importar meus laudos** (wizard embutido; "quanto mais laudos das modalidades que você
     mais usa, mais o laudo sai com a sua cara"; pulável — dá para fazer depois em
     Configurações → Meu estilo);
  6. Uso (ditar, colar, tray, atalhos).
  Progresso persistido em `config.onboarding = { versao, passo, acervoImportado }` para
  retomar onde parou.

## 4. Fluxo de dados (ingestão → laudo)

```
PDFs/DOCX/TXT do médico
  → extrair (local, pdfjs/mammoth)
  → sanitize local (anonymizer + nome por conteúdo)     [nada saiu da máquina até aqui]
  → classificar local (regex; LLM só p/ indecididos, após consentimento)
  → corpus com frontmatter em userData/acervo/
  → [amostra revisada + consentimento + custo aceito]
  → destilar/aprender (chave do médico) → _rascunhos/
  → médico revisa → biblioteca-medico/ (camada acima da base)
  → geração de laudo: loadLibrary([base, medico]) + regras/frasário em camadas
```

## 5. Tratamento de erros

- Sem chave válida → app bloqueado com mensagem acionável (nunca "burro" silencioso).
- Extração: arquivo corrompido/sem texto entra no relatório final, nunca aborta o lote.
- Classificação incerta → cluster "não reconhecido", médico pode rotular manualmente ou
  deixar de fora; nunca envia para LLM sem consentimento.
- Destilação: falha em um cluster não derruba os demais; retry 1× por item; cancelamento
  limpa estado parcial (rascunhos completos permanecem, parciais são apagados).
- Custo real divergindo da estimativa: telemetria por item no relatório final.
- Cofre indisponível → mesmo comportamento atual (erro honesto, nunca grava em claro).

## 6. Testes

- Suíte atual (149) permanece verde; `loadLibrary` em camadas, factory de LLM, OpenAIProvider
  (mock), classificador (fixtures sintéticas de cabeçalhos TC/RM/US/RX, contraste,
  lateralidade), estimador de custo, extrator (PDF/DOCX fixtures sintéticos), gate de chaves
  por modo de provedor, promoção de rascunhos (nunca sobrescrever sem backup).
- Golden set continua o gate de regressão da seleção (eval 13/13 com biblioteca em camadas).
- Nenhum teste usa laudo real: fixtures 100% sintéticas (regra de privacidade).

## 7. Fora de escopo desta rodada

Licença/ativação; OCR (tesseract); aprendizado automático contínuo (fica o botão manual);
STT local (Whisper); edição rica de máscara com preview; RM/US/RX na base (arquitetura
pronta, conteúdo não); assinatura de código/auto-update; backend próprio (morto pelo BYOK).

## 8. Sequência de execução

1. **Bloco 1** — BYOK/provedores (core/llm + config + gate + ChavesApi + Settings).
2. **Bloco 2** — biblioteca-base (conteúdo genericizado + camadas + bootstrap + packaging).
3. **Bloco 3** — acervo/aprendizado (core novo + IPC + wizard + Meu estilo + onboarding novo).

Cada bloco: subagentes implementam com TDD, review por task, suíte verde antes do próximo.
