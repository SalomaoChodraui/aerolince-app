# Estado do projeto — ponto de retomada

_Atualizado em 07/08/2026, após a verificação final do Bloco 3 (acervo + aprendizado in-app). Este é o arquivo para ler primeiro ao retomar o desenvolvimento._

## ⏩ Comece por aqui

1. **Bloco 1 do reposicionamento (spec 2026-08-07) mergeado** — BYOK com motor selecionável
   (anthropic|openai), factory `criarLLM`, gate `chavesNecessarias`, `ChavesApi` compartilhado,
   onboarding bloqueante (spec e plano em `docs/superpowers/specs/2026-08-07-inteligencia-do-medico-byok-design.md`
   e `docs/superpowers/plans/2026-08-07-bloco1-byok-provedores.md`).
2. **Bloco 2 (biblioteca base embarcada em camadas) mergeado na main em 07/08/2026** (branch
   `bloco2-biblioteca-base`, baa93a4, 8 tasks aprovadas + verificação final; plano em
   `docs/superpowers/plans/2026-08-07-bloco2-biblioteca-base.md`) — smoke manual com GUI segue
   pendente (ver "Pendências de teste").
3. **Bloco 3 (acervo + aprendizado in-app) concluído em 07/08/2026** na branch
   `bloco3-acervo-aprendizado` (base 51c4f13 → 16c8d84, 9 tasks aprovadas + verificação final;
   plano em `docs/superpowers/plans/2026-08-07-bloco3-acervo-aprendizado.md`) — pendente smoke
   manual com GUI (wizard completo, onboarding, Meu estilo, Reaprender) e decisão de merge. Ver
   "O que foi construído em 07/08 (Bloco 3)" abaixo.
4. **Próxima frente por definir.** Em paralelo segue pendente a **Fase B da auditoria** —
   STATE-01 (`ReportSession` canônica), SAFE-02 (patch JSON estruturado), QA-01 (golden set
   clínico) — plano SDD próprio (decisão de 20/07; definições em
   `docs/AUDITORIA-TECNICA-PRODUTO-2026-07-18.md`, P0-03/04/05).
5. **Gate de campo continua pendente**: colar no RIS real da clínica + plantão inteiro de TC +
   **validar o ditado segmentado com fala real** (itens novos em "Pendências de teste").

## O que o produto faz (funcionando)

Radiologista dita um comando curto → o app seleciona a máscara do próprio médico,
aplica os achados, devolve o laudo pronto no clipboard, exibe em janela editável e salva.
Fluxo validado ponta a ponta com voz real. Custo ~R$ 0,02–0,09/laudo. Latência 1–6 s.

**Fase atual:** Fase 1 (app MVP) + Fase A de contenção mergeada + **áudio segmentado e ajustes
de UX mergeados em 20/07/2026** (`main` em `ef58651`). Os 6 P0s da auditoria de 18/07 fechados
(`docs/AUDITORIA-TECNICA-PRODUTO-2026-07-18.md`). Falta o gate de campo (colar no RIS real +
aceitação em plantão + fala real no ditado segmentado).

## Como rodar

```bash
# App (dev) — de qualquer pasta:
laudo-app                     # abre o app Electron (botão flutuante + bandeja)

# CLI (Fase 0, ainda útil para testes rápidos e para destilar/aprender):
laudo texto "<comando>"       # gera um laudo sem áudio
laudo texto "…" --sonnet      # modo qualidade (Sonnet em vez de Haiku)
laudo masks                   # lista as 18 máscaras
npm run eval                  # golden set (13 casos) — acurácia de seleção

# Dentro de app/:
npm run dev                   # app em dev (hot reload)
npm run build:app             # compila renderer/main/preload
npm run dist                  # gera instaladores (DMG + NSIS) em release/
npm test                      # 331 testes (vitest)
npm run typecheck

# Curadoria da biblioteca (rodar quando entrarem laudos novos no acervo):
laudo destilar <id> <PREFIXO> [--contendo "…"]   # cria máscara-consenso nova
laudo aprender [<id>|todos]                       # re-extrai Regras do Médico
npm run sanitize -- "../Modelos de Laudos/Exames_TC_2026"   # sanitiza PDFs (local)
```

**Instaladores prontos:** `release/Aerolince-0.1.0-arm64.dmg` (Mac) e
`release/Aerolince Setup 0.1.0.exe` (Windows). Sem assinatura (fase piloto).

## Arquitetura (mapa rápido)

- `src/core/` — Node puro, sem Electron, testável. **Não depende do app.**
  - `anonymizer/` — sanitização local (obrigatória antes de qualquer upload)
  - `audio/` — pcm/wav/consolidação/cripto do spool (puro; `pcm.ts` é o único módulo que o renderer importa)
  - `masks/` — schema.ts (frontmatter zod), library.ts (catálogo), **matcher.ts** (seleção local + contraste determinístico)
  - `stt/` — OpenAI gpt-4o-transcribe
  - `llm/anthropic.ts` — wrapper Claude (aceita baseURL p/ Kimi; cache; custo)
  - `engine/` — **o coração**: prompts.ts (todas as regras), **patch.ts** (modo patch: @@ substituir/inserir-antes/inserir-apos/titulo/tecnica), engine.ts (orquestra), diff.ts
  - `contexto.ts` — carrega Regras do Médico + Frasário aplicável por máscara
  - `config/schema.ts` — Config (pastas, ui{tema,glass,opacidade,atalho}, macros) + loadConfig/saveConfig
  - `output/` — clipboard + salvar + sidecar
- `src/cli/index.ts` — CLI (texto/gravar/caso/eval/destilar/aprender)
- `src/main/` — Electron: index.ts (tray, janelas, IPC, tema), pipeline.ts (áudio/texto→laudo + refino/desfazer), secrets.ts (cofre safeStorage), historico.ts (lista + apagar/retenção + loop de feedback), **audio/** (spool cifrado, sessão segmentada, recovery no boot)
- `src/preload/index.ts` — ponte tipada (window.aerolince)
- `src/renderer/` — float/ (botão), result/ (laudo+refino), settings/, historico/, onboarding/, shared/ (brand.css tokens, glass.ts, window.css, SimboloA.tsx)

**Biblioteca do médico (FORA do repo, em `../biblioteca-mascaras/`):**
18 máscaras `.md` + `regras/` (Regras do Médico com ordem canônica) + `frasario/` (~2.900 frases de 5 médicos).
Editável em qualquer editor de texto; o app usa a versão nova na hora.

## O que foi construído hoje (18/07)

Fase 0 (CLI validada) → Fase 1 completa num dia: anonimizador, 18 máscaras destiladas de 1.721
laudos reais e validadas pelo Paulinho, motor de patches (custo 36× menor), camada de inteligência
(Regras do Médico + ordem canônica derivada dos dados), frasário de 5 médicos, app Electron com
botão flutuante/refino por voz/histórico/configurações/onboarding/tray/tema dark+glass/loop de feedback,
identidade visual D1.3, instaladores Mac+Windows.

## O que foi construído em 19–20/07 (Fase A de contenção — mergeada)

Executada via subagentes com review por task + review final adversarial (18 commits, ledger em
`.superpowers/sdd/progress.md`):

- **Gate de confiança (SAFE-01)**: confiança baixa nunca gera; média pede confirmação com
  candidatos locais (`rankMasks`, sem tocar nos prompts) — painel no app, pergunta no terminal
  na CLI; erro sempre visível (janela aparece no catch).
- **Ditado sanitizado antes de QUALQUER LLM (PRIV-02)**: `sanitizeComando` no app, na CLI e em
  `laudo caso`/`laudo eval` (inclusive antes de persistir no golden set versionado); datas viram
  aviso, não remoção (conteúdo clínico); avisos propagados até a UI/terminal.
- **Validador determinístico do laudo (P0-04)**: nenhum marcador `<!-- -->`/`@@` sobrevive;
  placeholder de anonimização gera aviso; ids de patch normalizados p/ ASCII.
- **Áudio nunca toca o disco no app (PRIV-01)**: buffer → `toFile` → API, limite de 24 MB com
  erro acionável. (CLI de dev ainda grava `.wav` local, fora do git — documentado.)
- **Config atômica (CONFIG-01)**: valida antes de salvar, backup `.bak`, escrita atômica,
  recuperação de corrupção sem nunca impedir o boot; `schemaVersion: 1`.
- **Cofre honesto (SECRET-01)**: salvar exige cofre disponível; botão **Testar** valida a chave
  no provedor (com guarda de corrida); status ok/inválida/ausente na UI e no onboarding.
- **Textos honestos (PRIV-03)**: onboarding "Voz na nuvem, laudo no seu computador";
  `docs/privacidade.md` e CLAUDE.md reescritos e escopados ao app.

Verificação manual feita em 20/07 (chaves + Testar, painel de confirmação, config corrompida,
`/tmp` sem áudio): tudo ok.

## O que foi construído em 20/07 (áudio segmentado + ajustes de UX — mergeados)

Executado via subagentes (Opus/Sonnet/Haiku) orquestrados em Fable, com review por task +
review final adversarial (24 commits; plano em `docs/superpowers/plans/2026-07-20-audio-segmentado.md`):

- **Captura segmentada com VAD local, sem pedal/atalho**: clique no balão abre a escuta;
  Silero VAD (`@ricky0123/vad-web`, assets 100% locais via `scripts/copiar-assets-vad.mjs`,
  zero CDN) registra só a fala — pausa de ~1,2 s fecha o trecho (configurável em
  Configurações → Ditado), voltar a falar reabre; novo clique consolida os trechos num WAV
  só-fala (gaps de 200 ms) → **1 chamada** `gpt-4o-transcribe` → pipeline intocado. Fala
  contínua é fatiada em ≤60 s; consolidado >24 MB particiona com prompt encadeado.
- **Spool cifrado + recovery**: segmentos AES-256-GCM no disco (chave de sessão protegida
  pelo cofre do SO), apagados após a transcrição; crash → diálogo "Transcrever agora /
  Descartar" no próximo boot (expira em 48 h); sem cofre ou falha de disco → degrada para
  só-memória com aviso honesto no tooltip.
- **Custo do STT entra no custo exibido** (usage por token; fallback USD/min) + telemetria da
  sessão no sidecar (`capturedMs`/`speechMs`/`speechRatio`/`uploadedBytes`).
- **Fallback clínico**: `stt.captura: 'classica'` preserva o fluxo MediaRecorder antigo.
- **Ajustes de UX**: aviso de erro do balão legível com motivo real ("sem áudio"/"sem
  microfone"/"sem chave", 5 s, nunca fica preso na exclamação); histórico com apagar
  individual/todos (confirmação nativa; path traversal fechado) e retenção configurável
  (`historico.retencaoDias`, 0 = sempre; limpeza no boot); balão só o círculo (sem borda,
  fundo 100% transparente), transparência mínima 5% e ajuste por scroll no próprio balão.
- Textos de privacidade fiéis ao fluxo novo (spool cifrado com retenção zero pós-transcrição,
  expiração na próxima abertura, exceção da CLI-dev). Suíte: 81 → **149 testes**.
- **Fixes de campo pós-instalador (20/07 à noite)**: script `dist` respeitava a CLI e gerava
  NSIS arm64 em host Apple Silicon (agora usa os targets do yml → x64); ícones do tray não
  entravam no pacote (ícone invisível no instalado — `files` do electron-builder corrigido);
  userData herdado da instalação de 18/07 diagnosticado (onboarding não abria e `masksDir`
  apontava para cópia com 1 máscara-exemplo → "não tive certeza" sempre; config do app
  instalado agora aponta para a biblioteca real).

## O que foi construído em 07/08 (Bloco 2 — biblioteca base em camadas)

Executado via subagentes por task + review por task (B2-T1..T8, ledger em `.superpowers/sdd/progress.md`,
plano em `docs/superpowers/plans/2026-08-07-bloco2-biblioteca-base.md`), branch `bloco2-biblioteca-base`
(base 2750f77 → e419aa3):

- **`app/biblioteca-base/`**: 18 máscaras TC genéricas (mesmos ids da biblioteca real, fraseado
  neutro de laudário clássico, zero cópia literal) + `regras/gerais.md` (guardas clínicas
  universais, sem preferência pessoal) + frasário compactado + `LEIA-ME.md`. Teste automático de
  privacidade (`biblioteca-base.test.ts`) garante zero achado grave (nome/CPF/telefone/CRM) nos
  arquivos da base.
- **Camadas em `loadLibrary`/`loadRegras`**: `loadLibrary(dirs: string | string[])` aceita N
  diretórios em precedência crescente — máscara de mesmo id na camada do médico substitui a da
  base; camada ausente/vazia não derruba; zero máscaras no total lança erro. `loadRegras`
  resolve regras POR ARQUIVO (médico vence) e frasário por UNIÃO com dedup por conteúdo (mesmo
  nome de arquivo ou mesmo prompt já presente na biblioteca do médico não duplica).
  Nota (fragilidade triada no review final): o dedup do frasário é por conteúdo EXATO — se o
  médico EDITAR um arquivo seu que era idêntico a um da base, a cópia da base volta a aparecer
  (caveat documentado em `biblioteca-base/LEIA-ME.md`, com a saída: dar ao arquivo do médico o
  MESMO NOME do da base). Detecção de quase-duplicata (fuzzy, tolerando pequenas edições) fica
  para o Bloco 3.
- **Config `bibliotecaBaseDir`**: novo campo (default `app/biblioteca-base` em dev/CLI,
  `resourcesPath/biblioteca-base` no empacotado). `origem: 'base'` no schema de máscara.
- **Bootstrap novo + self-heal**: instalação limpa (empacotado, sem config) nasce com
  `userData/biblioteca-medico/` vazio (sem `masks-exemplo`) e `bibliotecaBaseDir` apontando pro
  resources da versão instalada. Instalação existente: self-heal realinha só o
  `bibliotecaBaseDir` (caminho de resources muda a cada versão) sem tocar `masksDir` do médico.
- **Settings**: linha read-only "Biblioteca base (do app)" nova; rótulos existentes distinguem
  base × "Minha biblioteca (aprendida)".
- Suíte: 165 → **178 testes**. Gates (typecheck/build) verdes em todo commit.

**Verificação final (Task 8, 07/08/2026):** `npm test` (178/178) + `npm run typecheck` +
`npm run build:app` verdes. `npm run eval` NÃO rodado — `.env` só tem placeholders vazios de
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`MOONSHOT_API_KEY` (sem chave real nesta máquina agora);
fica para o smoke com o usuário. Sanidade de camadas confirmada na prática: (a) config real
(`masksDir` → biblioteca do Paulinho) → `laudo masks` lista as 18 máscaras do médico, **zero**
`(base)`; (b) cwd temporário com config isolado (`masksDir` vazio, `bibliotecaBaseDir` →
`app/biblioteca-base` absoluto, `laudo.config.json` real intocado) → `laudo masks` lista as
mesmas 18, todas com `(base)`.

## O que foi construído em 07/08 (Bloco 3 — acervo + aprendizado in-app)

Executado via subagentes por task + review por task (B3-T1..T8, ledger em `.superpowers/sdd/progress.md`,
plano em `docs/superpowers/plans/2026-08-07-bloco3-acervo-aprendizado.md`), branch
`bloco3-acervo-aprendizado` (base 51c4f13):

- **Extração local de texto** (`src/core/acervo/extrair.ts`): PDF (pdfjs-dist), DOCX (mammoth) e TXT,
  sem binário externo e sem OCR (PDF só-imagem volta `sem-texto`, contabilizado, nunca descartado
  em silêncio).
- **Classificador determinístico** (`classificar.ts`): modalidade/exame/contraste/lateralidade por
  CONTEÚDO (sem LLM, custo zero); tabela de sinônimos testada por frase inteira (resolve colisões
  tipo "tornozelo e pé" vs "tornozelo" isolado); contraste por neutralização de negação de protocolo
  + vocabulário de fases multifásicas; `agruparClusters` sugere a máscara-consenso. Regressão real
  contra os 18 laudos da biblioteca do médico.
- **Sanitização com proveniência** (`sanitizar.ts`): `sanitize()` do anonymizer reforçado pelo nome
  extraído do arquivo original; grava com frontmatter (`exame`/`modalidade`/`contraste`/`origem_hash`/
  `confianca`); nome do arquivo gravado NUNCA contém paciente (chave do cluster + data do nome
  original, senão `s-d` — nunca a data de hoje).
- **Núcleo de aprendizado** (`src/core/aprendizado/`): `destilarMascara`/`aprenderRegras`/`aplicarRascunho`/
  `estimarCustoAprendizado`/`corpusPorArquivos`+`montarCorpus` (re-sanitização em profundidade antes
  de qualquer LLM); rascunhos em `_rascunhos/` — nunca gravam direto na biblioteca; traversal fechado
  via `validarNomeRascunho` (rejeita `/`, `\`, `.`, `..`, divergência de `basename()`) nos 5 pontos de
  entrada (aplicar/descartar/ler/promover). CLI virou casca fina sobre o core.
- **IPC main de acervo/aprendizado/rascunhos/estilo**: progresso por etapa e cancelamento entre itens
  de um lote; core intocado pela camada Electron.
- **Wizard de importação** (renderer `importar/`): 6 fases — seleção de arquivos → amostras +
  consentimento explícito (único caminho para a etapa de custo; sem bypass) → custo estimado →
  aprendizado com progresso → revisão de rascunhos → aplicar/descartar.
- **Janela "Meu estilo"** (renderer `estilo/`): máscaras/regras/frasário em camadas (base × médico)
  com editor (textarea) por arquivo; botão **"Reaprender com meus laudos"** monta o corpus de (a)
  acervo existente + (b) NOVO — laudos do histórico com `laudoFinalEditado` no sidecar
  (`corpusDoHistorico(outputDir, cap 40)`, peso de recência); dupla re-sanitização rastreada ponta a
  ponta; diretórios temporários do corpus do histórico limpos em `finally` (sucesso/falha/cancelamento)
  + sweep de órfãos no boot.
- **Onboarding de 8 passos**: passo de inteligência + passo de importação de acervo (PULÁVEL);
  progresso persistido (`versao` descarta passo salvo sob versão antiga); gate de chaves BYOK do
  Bloco 1 intocado.
- Suíte: 182 → **331 testes**. Gates (typecheck/build) verdes em todo commit.

**Desvio registrado do spec:** a classificação de indecididos (documentos que o classificador
determinístico não reconhece) por LLM ficou para o backlog — a v1 usa **rotulagem MANUAL** no
wizard (dropdown de exames conhecidos + "deixar de fora"). Motivo: zero custo pré-consentimento,
menos superfície de erro antes do médico decidir importar.

**Verificação final (Task 9, 07/08/2026):** `npm test` (331/331) + `npm run typecheck` +
`npm run build:app` verdes. `npx electron-builder --dir` empacotou com sucesso (Aerolince.app
gerado em `release/mac-arm64/`; ambiente sem GUI — só o empacotamento foi conferido, o app não foi
aberto). **Ensaio ponta-a-ponta sem LLM (custo zero)**, script descartável fora do repo: gerou 25
`.txt` sintéticos de "TC DO CRÂNIO" com achados variados (nenhum dado real) → `extrairTexto`
(25/25 ok) → `classificarDocumento`/`agruparClusters` (1 cluster `tc-cranio`, 25 arquivos) →
`sanitizarParaAcervo` (0 findings, 0 suspeitos — sintético sem PII, nome do arquivo original não
vazou) → `corpusPorArquivos`+`montarCorpus` (25 laudos, ~21 KB, frontmatter tolerado) →
`estimarCustoAprendizado` (~5.778 tokens de entrada, ~US$ 0,055 — plausível) → `destilarMascara`
com um LLM FAKE local (sem rede, custo zero) → rascunho gravado em `_rascunhos/tc-cranio.md` →
`aplicarRascunho` → `loadLibrary` no `masksDir` temporário carregou a máscara nova sem erro. Os 8
passos fecharam sem nenhum BUG do bloco.

## Pendências de teste (o médico precisa validar)

- [x] Recolocar chaves na tela de Configurações e gerar um laudo (20/07, com botão Testar)
- [ ] **Sair** pelo menu da bandeja (era o "como fecho")
- [ ] Arrastar o balão (clique = ditar, arraste = mover) e conferir que a posição persiste
- [ ] Ditar em silêncio → ver o aviso "sem áudio" e o balão voltar ao normal
- [ ] Buscar um achado no histórico; copiar → janela fecha
- [ ] Criar um atalho ("abdome feminino padrão com colecistectomia") e acioná-lo pela bandeja
- [ ] Alternar tema claro/escuro/vidro nas configurações
- [x] Balão sem borda/quadrado, transparência 5% e scroll (20/07, visual validado)
- [x] **Ditado real no app EMPACOTADO** (20/07, instalador DMG): fala real → VAD → transcrição →
      seleção certa entre as 19 máscaras → laudo correto. Valida captura segmentada + asar +
      assets locais de ponta a ponta.
- [ ] Cenários restantes do ditado segmentado: pausar ~10 s no meio (balão "ouvindo", sem
      registrar) → 1 laudo das duas frases; sidecar com `audio.speechMs` ≪ `capturedMs` e
      `custoUSD` incluindo o STT
- [ ] Matar o app no meio do ditado (`kill -9`) → reabrir → "Transcrever agora" → laudo;
      `<userData>/spool/` vazio ao final
- [ ] Configurações → Captura de voz "Clássica" → fluxo antigo funciona
- [ ] **Colar um laudo no RIS real da clínica** (Word + campo simples também) — teste-chave que falta
- [ ] Plantão inteiro de TC → medir aceitação (meta ≥80% "usaria com edição mínima")
- [ ] **Smoke manual do Bloco 1 (BYOK)** — gates automatizados (test/typecheck/build) passaram
      07/08, mas o smoke visual do `npm run dev` não foi possível no ambiente de execução (sem
      GUI) e fica pendente: (a) Settings mostra motor + chaves coerentes e trocar motor atualiza
      as descrições; (b) onboarding via "Guia rápido" com gate de chaves — Continuar/concluir
      desabilitados sem chave válida, dots redirecionam para o passo de chaves; (c) ditado real
      gera laudo no motor padrão; (d) modo "Só OpenAI" gera laudo com uma chave só.
- [ ] **Smoke manual do Bloco 2 (biblioteca base)** — gates automatizados (test/typecheck/build)
      + sanidade de camadas por CLI passaram 07/08 (ver seção acima); falta: (a) instalação limpa
      via DMG mostra as 18 máscaras da base logo no primeiro uso (sem `masksDir` do médico
      configurado); (b) instalação existente do Paulinho permanece intocada após o self-heal —
      `masksDir` não muda, só `bibliotecaBaseDir` realinha para o resources da versão nova.
      Nota: instalação nova (empacotada) usa `userData/biblioteca-medico` como `masksDir`
      inicial (vazio); dev/CLI usa `../biblioteca-mascaras` — caminhos diferentes por design
      (isolamento por usuário vs biblioteca de desenvolvimento compartilhada).
- [ ] **Smoke de instalação empacotada ANTIGA com `masksDir` em `masks-exemplo`** — já houve em
      campo uma instalação (18/07, ver "Fixes de campo pós-instalador" acima) cujo `masksDir`
      apontava para uma cópia de `masks-exemplo/`. Com as camadas do Bloco 2, esse cenário deixa
      de falhar silenciosamente ("não tive certeza") e passa a somar 18 máscaras da base + as de
      `masks-exemplo` no catálogo — conferir se essa instalação (ou outra parecida) ainda existe
      e, se achar, re-apontar o `masksDir` para a biblioteca real do médico.
- [ ] **Smoke manual do Bloco 3 (acervo + aprendizado in-app)** — gates automatizados
      (test/typecheck/build/`electron-builder --dir`) e o ensaio ponta-a-ponta sem LLM passaram
      07/08 (ver seção acima); falta NA MÁQUINA DO SALOMÃO: (a) **wizard de importação completo
      com 20+ PDFs reais** (seleção → amostras+consentimento → custo → aprendizado → revisar
      rascunhos → aplicar), **incluindo o custo REAL do LLM (~US$ 0,03–0,06 por máscara)**, não
      só a estimativa; (b) **onboarding novo de 8 passos** do zero, com o passo de importação de
      acervo pulado e depois feito; (c) janela **"Meu estilo"** (camadas base × médico, editor de
      máscara/regras/frasário); (d) **"Reaprender com meus laudos"** (acervo + histórico com
      `laudoFinalEditado`); (e) confirmar que o modo **"Só OpenAI"** (Bloco 1) continua íntegro
      com o fluxo de aprendizado novo.

## Backlog priorizado (próximas frentes)

-1. ~~Bloco 3 (ingestão de acervo + aprendizado in-app)~~ — **CONCLUÍDO 07/08/2026** (branch
   `bloco3-acervo-aprendizado`, pendente smoke manual com GUI e decisão de merge; ver "O que foi
   construído em 07/08 (Bloco 3)" acima). Resolveu os itens 1-3 antigos abaixo (mantidos riscados
   por rastro histórico).
0. **Fase B da auditoria** — STATE-01 (`ReportSession` canônica), SAFE-02 (patch JSON
   estruturado), QA-01 (golden set clínico reprodutível). Plano SDD próprio (decisão de 20/07).
0b. **Dívida técnica triada no review final do áudio** (pequena, entra quando tocar os arquivos):
   `app.requestSingleInstanceLock` (2ª instância confunde o recovery do spool); podar os `.wasm`
   não usados da cópia de assets (~53 MB; só o simd-threaded é carregado); guard `maxBytes≤44`
   em `particionarPorBytes`; testes que faltam (manifest zod-inválido no spool, `promptExtra`
   e2e no provider, "confirmação negada ⇒ nada apagado" no histórico); nota: retenção do
   histórico conta da **última edição** (mtime), não da geração; A/B de `gpt-4o-mini-transcribe`
   em shadow mode (proposta, Fase 2); handler de erro no middleware dev dos assets do VAD.
0c. **Backlog novo do Bloco 3 (acervo + aprendizado)**, triado no review final (07/08):
   - **OCR (tesseract)** — PDF só-imagem hoje volta `sem-texto` e é descartado da importação
     (contabilizado, nunca em silêncio); OCR local destravaria esses arquivos sem sair do app.
   - **Classificação de indecididos por LLM** — v1 usa rotulagem MANUAL no wizard (desvio
     registrado acima); upgrade natural quando o custo/UX valer a pena.
   - **Quase-duplicata de frasário (fuzzy dedup)** — herdado do Bloco 2: o dedup hoje é por
     conteúdo EXATO; detectar duplicatas com pequenas edições fica para uma rodada futura.
   - **Editor rico de máscara** — a janela "Meu estilo" (T7) tem um editor de textarea simples;
     falta estrutura (campos por seção, preview, validação inline do frontmatter).
   - **Cap 40 do "Reaprender com meus laudos" é POR MÁSCARA, não global** — hoje
     `corpusDoHistorico(outputDir, cap 40)` aplica o cap a cada máscara individualmente; reaprender
     várias máscaras de uma vez pode ler o histórico inteiro várias vezes sem um teto agregado.
1. ~~Aprendizado do loop de feedback~~ — **resolvido pelo Bloco 3**: "Reaprender com meus laudos"
   (janela Meu estilo, T7) já lê `laudoFinalEditado` do sidecar e alimenta o corpus de
   destilar/aprender com peso de recência.
2. ~~Wizard de importação de PDFs dentro do app~~ — **resolvido pelo Bloco 3**: wizard de 6 fases
   em `renderer/importar/` (seleção → amostras+consentimento → custo → aprendizado → rascunhos).
3. ~~Editor de frases dentro do app~~ — **resolvido (versão básica) pelo Bloco 3**: janela "Meu
   estilo" edita máscaras/regras/frasário em camadas sem sair do app; versão rica fica no item 0c.
4. **Colagem robusta em RIS** — se algum RIS bloquear colar formatado, avaliar RTF/HTML no
   clipboard (Electron suporta) ou digitação simulada.
5. **Novos tipos de exame** — RM/US/RX (o schema de máscara já tem `modalidade`); repetir
   o método destilar→aprender→ordem canônica.
6. ~~Fase 2 (produto): backend próprio com as chaves da empresa~~ — **morto pelo BYOK** (Bloco 1,
   07/08): o médico usa as próprias chaves (OpenAI e/ou Anthropic), motor selecionável na
   Settings. Licença/ativação fica p/ rodada futura. Segue valendo: Kimi/DeepSeek auto-hospedado
   em VPS (a flag `--kimi` já existe para testar), assinatura de código (Apple US$ 99/ano; Windows
   Azure Trusted Signing), auto-update.

## Notas e riscos

- **Kimi (K3) testado**: qualidade boa mas 17–31 s de latência (modelo pensante) e sem prompt
  caching no endpoint deles → Haiku ganha para uso interativo. Kimi só faz sentido auto-hospedado (Fase 2).
- **Privacidade**: `Modelos de Laudos/` tem laudos reais de pacientes — nunca no git, nunca em
  API sem passar pelo anonymizer. Regras em `docs/privacidade.md`.
- **Segurança clínica**: o app gera RASCUNHO; o médico sempre revisa e assina. Guardas no prompt
  (nunca inventar medida/lateralidade; classificações órgão-específicas; limites de protocolo).
- **Método para corrigir comportamento do modelo**: cada caso estranho que o médico traz vira
  regra permanente (no prompt ou em `regras/`) + caso de teste. Foi assim com pleura, Bosniak,
  líquido livre, ordem canônica.
- Plano original e decisões: `docs/decisoes.md`. Concorrência e posicionamento: lá também.
