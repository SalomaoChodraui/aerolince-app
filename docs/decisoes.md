# Aerolince — Laudos de TC por comando de voz

## Contexto

Salomão e Paulinho (radiologistas) querem um programa que transforme um **comando de voz semântico curto** ("essa tomo é uma diverticulite do colo direito não complicada") em um **laudo completo pronto**, usando as máscaras/modelos do próprio médico, copiado formatado para a área de transferência — para colar em qualquer RIS, sem integração e sem microfone dedicado.

Fluxo: botão flutuante (ou atalho global) sobre o visualizador DICOM → grava a fala → transcrição (STT) → LLM seleciona a máscara certa e aplica os achados ditados (troca a frase "normal" do órgão pela patológica, com as medidas exatas, e ajusta a Impressão) → laudo no clipboard (texto + HTML + RTF), exibido em janela de resultado com **refino por voz**, e salvo em pasta local.

**Requisitos confirmados:** app desktop para **Windows E macOS**; processamento em **nuvem com anonimização local** obrigatória antes de qualquer upload (LGPD); MVP focado em **TC**; perfis de estilo (conciso, completo, urgência, comparativo, oncológico); visão futura de onboarding com aprendizado do estilo do médico (testes A/B de conclusões) e produto comercial.

**Dado crítico descoberto:** `Modelos de Laudos/Exames_TC_2026/` contém **101 PDFs de laudos reais assinados, com nome de paciente no conteúdo E no nome do arquivo**. Não são máscaras limpas → o importador precisa de modo "destilar máscara a partir de N laudos do mesmo exame", e o **anonimizador local é o primeiro módulo a construir**. Esses dados nunca entram no git e nunca sobem para API sem sanitização.

**Concorrência (pesquisada):** Laudite (R$ 99–159/mês, transcrição+máscaras, empurra Philips SpeechMike — o "Macsym"), Iara Health (R$ 249–295/mês, sem integração), Laudos.AI (speech-to-report, desde R$ 29), WIND/VX; globais: Nuance PowerScribe, Rad AI, Solventum Fluency, Smart Reporting. **Diferencial nosso:** comando semântico curto → máscara própria do médico → clipboard universal, sem hardware dedicado e sem integração RIS.

## Decisões de arquitetura

- **Electron + TypeScript + React** (electron-vite, electron-builder). Decisivo: `clipboard.write({text, html, rtf})` nativo em Win+Mac; ecossistema maduro para desenvolver com Claude Code. (Descartados: Tauri 2 — sem RTF no clipboard, toolchain Rust; app web — sem always-on-top, sem atalho global; 2 apps nativos — 2× manutenção.)
- **Núcleo `core/` em Node puro, sem Electron** — usado primeiro pela CLI da Fase 0 e depois pelo app, sem retrabalho.
- **STT:** OpenAI `gpt-4o-transcribe` (fallback `whisper-1`) com `prompt` de glossário radiológico PT-BR editável; interface `STTProvider` para trocar de fornecedor depois.
- **LLM:** 2 chamadas — **seleção** com `claude-haiku-4-5` (catálogo compacto das ~200 máscaras com prompt caching, saída JSON structured output) + **geração** com `claude-sonnet-5` (ou Haiku no "modo rápido"; `thinking: disabled` para latência). **Refino** = chamada stateless com o laudo atual + comando.
- **Importação de PDFs:** extração de texto **local** (pdfjs-dist) → **anonimização local** (regex: CPF, datas, telefones, accession, nomes — inclusive o padrão do nome do arquivo) → tela de revisão com highlights → só então o texto sanitizado vai ao Claude (Batch API, 50% off) para estruturar a máscara. Dois modos: PDF único → máscara; **N laudos do mesmo exame → máscara-consenso**.
- **Armazenamento:** máscaras e perfis em arquivos **markdown** (índice em memória; sem SQLite — evita dependência nativa); config via electron-store; **API keys via `safeStorage`** do Electron (keytar está abandonado); laudos salvos como `.txt` + sidecar `.json` opcional (transcript, máscara, latências, diff — matéria-prima da Fase 2).
- **Latência-alvo:** fim da fala → clipboard **< 10 s** (estimado 4–7 s com Haiku, 6–10 s com Sonnet). **Custo/laudo:** ~R$ 0,06–0,16 → R$ 60–190/mês num volume de 1.000–1.200 laudos (competitivo vs Laudite/Iara).
- **Segurança clínica:** o app gera **rascunho**; o médico sempre revisa e assina (disclaimer permanente). Diff bloco-a-bloco vs máscara destaca o que mudou e alerta alteração inesperada (antialucinação + acelera revisão).

## Modelo de dados

**Máscara** (`.md`, uma por exame): frontmatter `id, modalidade, regiao[], nome, sinonimos[], contraste, versao, origem` + corpo com `## Técnica`, `## Análise` (cada órgão precedido de marcador `<!-- orgao: figado -->` delimitando a frase normal substituível) e `## Impressão` (`<!-- impressao -->`).

**Perfil de estilo** (`perfis/<id>.md`): frontmatter + fragmento de instruções injetado no prompt de geração (5 padrão, editáveis).

**Config:** pastas (laudos, máscaras, perfis), atalho global, perfil padrão, provider/modelos, glossário STT, flags de privacidade (`salvarAudio: false`, `salvarSidecar: true`).

## Fluxo de prompts (arquivo central: `app/src/core/engine/prompts.ts`)

1. **Seleção (Haiku):** system cacheado = instruções + catálogo (`id | nome | sinônimos | região`); user = transcript; saída `{mask_id, confianca}`. Confiança baixa → pedir confirmação na janela de resultado (nunca gerar sobre máscara errada em silêncio).
2. **Geração (Sonnet/Haiku):** system cacheado = regras duras (reproduzir a máscara literalmente exceto órgãos citados; incorporar medidas exatas ditadas; **nunca inventar achado/medida/lateralidade**; atualizar Impressão com achado principal primeiro; preservar marcadores) + few-shot (caso diverticulite) + bloco do perfil de estilo; user = máscara completa + transcript. Pós-processamento: remover marcadores, diff vs máscara, destacar mudanças.
3. **Refino:** user = laudo atual + comando ditado + máscara de referência; devolve laudo completo; janela guarda versões (undo).
4. **Importação (Batch):** system = schema da máscara + "sinalize qualquer dado pessoal remanescente"; user = texto(s) sanitizado(s); modo consenso para N laudos do mesmo exame.

## Fases

### Fase 0 — Protótipo CLI de validação (1–2 semanas) — GATE antes do app
1. Criar repo `Aerolince/app` (git init): scaffold TS + vitest + tsx; `CLAUDE.md` (convenções + regras de privacidade); `.gitignore` cobrindo `Modelos de Laudos/`, PDFs, áudios e laudos gerados.
2. `core/anonymizer` + testes (CPF, datas, telefones, nomes no padrão dos arquivos reais) — **primeiro módulo**.
3. Preparar 5 máscaras reais à mão (ABDOME-TOTAL, TORAX, CRANIO, SEIOS-DA-FACE…): extrair texto localmente, sanitizar, estruturar no formato.
4. `core/stt`, `core/llm`, `core/masks`, `core/engine` mínimos.
5. CLI `laudo gravar` (ffmpeg, já instalado) e `laudo <audio>` → pipeline → stdout + pbcopy + salvar `.txt`.
6. **Golden set:** Paulinho grava 15–25 comandos reais (diverticulite; cálculo 1 cm rim direito 500 UH a 10 cm da pele; normal; multiachado; ambíguo). `laudo eval` mede seleção, latência, custo e diff vs referência.
7. Iterar prompts contra o eval; A/B Sonnet vs Haiku.

**Pronto quando:** seleção ≥95%; ≥80% dos laudos "usaria com edição mínima" (avaliação do Paulinho); p50 < 8 s; custo/laudo medido.

### Fase 1 — MVP app (6–8 semanas em ritmo parcial)
- **M1** Scaffold Electron (electron-vite + builder, IPC tipado, settings + safeStorage) com `core/` plugado.
- **M2** Botão flutuante frameless always-on-top arrastável + atalho global (default `Ctrl/Cmd+Shift+D`) + tray + permissões de microfone (mac: `askForMediaAccess` + `NSMicrophoneUsageDescription`) + estados visuais + Esc cancela.
- **M3** Pipeline completo no app → `clipboard.write({text, html, rtf})` → janela de resultado com destaques de diff → salvamento automático. **DoD inclui colar no RIS real do Paulinho, no Word e em campo de texto simples.**
- **M4** Importador: wizard com tela de revisão da anonimização (highlights + máscara manual) → estruturação → revisão da máscara → biblioteca. Importar o acervo completo (101 PDFs, modo consenso por tipo de exame).
- **M5** Perfis de estilo (5 padrão + seletor + default).
- **M6** Refino por voz na janela de resultado, com versões/undo.
- **M7** Empacotamento DMG (mac arm64) + NSIS (win x64) sem assinatura (instruções de bypass documentadas) + **piloto: um plantão inteiro de TC**.

**Pronto quando:** plantão completo laudado só com o app; ≥80% sem edição estrutural; colagem OK no RIS dele; p90 < 10 s; log de auditoria comprova que só texto sanitizado foi às APIs.

### Fase 2+ — Visão (esboço; arquitetura já prevê)
Aprendizado de estilo a partir do acervo (anonimização em lote + destilação + perguntas A/B de conclusões); assinatura de código (Apple US$ 99/ano; Windows via Azure Trusted Signing) + auto-update; licenças/billing multiusuário; RM/US/RX; OCR (tesseract.js) para PDFs escaneados; whisper local para modo offline; digitação simulada para RIS que bloqueiam colar.

## Estrutura do repositório (`Aerolince/app`)

```
app/
├── CLAUDE.md  package.json  tsconfig.json  electron.vite.config.ts  electron-builder.yml
├── src/
│   ├── core/        # Node puro: stt/ llm/ masks/ engine/ anonymizer/ importer/ output/ config/
│   ├── cli/         # Fase 0
│   ├── main/        # Electron main: windows, shortcuts, tray, ipc, secrets, mic
│   ├── preload/
│   └── renderer/    # float/ result/ settings/ importer/ shared/
├── masks-exemplo/   # máscaras fictícias p/ dev (sem dados reais)
├── perfis/          # 5 perfis de estilo padrão
├── eval/            # golden set + run-eval.ts
└── docs/            # decisoes.md, privacidade.md, instalacao.md
```

Arquivos críticos: `src/core/engine/prompts.ts` (coração da qualidade), `src/core/masks/schema.ts` (contrato de dados), `src/core/engine/engine.ts` (orquestração + antialucinação), `src/core/anonymizer/anonymizer.ts` (obrigatório antes de qualquer upload), `src/cli/index.ts` (primeiro entregável).

## Riscos principais

| Risco | Mitigação |
|---|---|
| Dados de pacientes nos 101 PDFs (nome no arquivo e conteúdo) | Extração+anonimização 100% locais; tela de revisão obrigatória; `.gitignore`; log de auditoria dos payloads; LGPD documentada em `docs/privacidade.md` |
| STT errar termos médicos PT-BR | Glossário no prompt do STT (editável); geração corrige com contexto da máscara; golden set mede |
| Latência > 10 s | Prompt caching, thinking disabled, opção Haiku, medição por etapa desde a Fase 0 |
| Alucinação clínica | Regras duras + diff com alerta de mudança inesperada + produto posicionado como rascunho (médico sempre assina) |
| Colagem falhar em algum RIS | 3 formatos no clipboard; teste real no M3; fallback futuro: digitação simulada |
| Apps sem assinatura (fase interna) | Instruções de bypass p/ 2 usuários; assinatura na Fase 2 |

## Verificação

- **`npm run eval`** (desde a Fase 0): golden set com áudios reais do Paulinho → acurácia de seleção, diff vs laudo de referência, latência por etapa, custo; roda a cada mudança de prompt.
- **Vitest:** anonymizer, parser de máscara, RTF com acentos (ã, ç, é) colado no Word/TextEdit, diff engine.
- **E2E manual (M7):** máquina limpa (VM Win + mac): instalar → configurar chaves → importar 3 PDFs → ditar os 2 casos canônicos → colar em Word/RIS/bloco de notas → refinar por voz → conferir arquivo salvo e persistência após reinício.
- **Piloto de aceitação:** um plantão de TC completo; % de laudos por categoria (aceito sem edição / edição menor / reescreveria) com meta ≥90% em "aceito+menor".
