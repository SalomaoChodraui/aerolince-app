# Estado do projeto — ponto de retomada

_Atualizado em 20/07/2026, após o merge da Fase A de contenção. Este é o arquivo para ler primeiro ao retomar o desenvolvimento._

## ⏩ Comece por aqui

1. **Próxima frente aceita: áudio segmentado** (pedal + VAD + spool) — proposta em
   `docs/PROPOSTA-ARQUITETURA-AUDIO-RESILIENTE-2026-07-19.md`. Fazer o plano SDD e executar
   em branch nova.
2. **Gate de campo continua pendente**: colar no RIS real da clínica + plantão inteiro de TC
   (itens finais de "Pendências de teste").

## O que o produto faz (funcionando)

Radiologista dita um comando curto → o app seleciona a máscara do próprio médico,
aplica os achados, devolve o laudo pronto no clipboard, exibe em janela editável e salva.
Fluxo validado ponta a ponta com voz real. Custo ~R$ 0,02–0,09/laudo. Latência 1–6 s.

**Fase atual:** Fase 1 (app MVP) + **Fase A de contenção da auditoria concluída e mergeada em
20/07/2026** (`main` em `19d6a0b`) — os 6 P0s da auditoria de 18/07 fechados
(`docs/AUDITORIA-TECNICA-PRODUTO-2026-07-18.md`). Falta o gate de campo (colar no RIS real +
aceitação em plantão).

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
npm test                      # 81 testes (vitest)
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
  - `masks/` — schema.ts (frontmatter zod), library.ts (catálogo), **matcher.ts** (seleção local + contraste determinístico)
  - `stt/` — OpenAI gpt-4o-transcribe
  - `llm/anthropic.ts` — wrapper Claude (aceita baseURL p/ Kimi; cache; custo)
  - `engine/` — **o coração**: prompts.ts (todas as regras), **patch.ts** (modo patch: @@ substituir/inserir-antes/inserir-apos/titulo/tecnica), engine.ts (orquestra), diff.ts
  - `contexto.ts` — carrega Regras do Médico + Frasário aplicável por máscara
  - `config/schema.ts` — Config (pastas, ui{tema,glass,opacidade,atalho}, macros) + loadConfig/saveConfig
  - `output/` — clipboard + salvar + sidecar
- `src/cli/index.ts` — CLI (texto/gravar/caso/eval/destilar/aprender)
- `src/main/` — Electron: index.ts (tray, janelas, IPC, tema), pipeline.ts (áudio/texto→laudo + refino/desfazer), secrets.ts (cofre safeStorage), historico.ts (lista + loop de feedback)
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

## Pendências de teste (o médico precisa validar)

- [x] Recolocar chaves na tela de Configurações e gerar um laudo (20/07, com botão Testar)
- [ ] **Sair** pelo menu da bandeja (era o "como fecho")
- [ ] Arrastar o balão (clique = ditar, arraste = mover) e conferir que a posição persiste
- [ ] Ditar em silêncio → ver o aviso "sem áudio" e o balão voltar ao normal
- [ ] Buscar um achado no histórico; copiar → janela fecha
- [ ] Criar um atalho ("abdome feminino padrão com colecistectomia") e acioná-lo pela bandeja
- [ ] Alternar tema claro/escuro/vidro nas configurações
- [ ] **Colar um laudo no RIS real da clínica** (Word + campo simples também) — teste-chave que falta
- [ ] Plantão inteiro de TC → medir aceitação (meta ≥80% "usaria com edição mínima")

## Backlog priorizado (próximas frentes)

0. **Áudio segmentado (aceito em 19/07)** — pedal + VAD + spool para gravações longas de plantão
   (custo, resiliência a falha de gravação): `docs/PROPOSTA-ARQUITETURA-AUDIO-RESILIENTE-2026-07-19.md`.
   Itens da Fase B da auditoria (STATE-01 estado canônico do laudo, SAFE-02, QA-01 golden set)
   entram no planejamento junto.
1. **Aprendizado do loop de feedback** — hoje o app só COLETA a versão editada (sidecar:
   `laudoGerado` vs `laudoFinalEditado`). Falta o passo que transforma isso em ajuste das
   Regras/Frasário (ex.: comando `laudo aprender-feedback` que lê os diffs e sugere edições).
2. **Wizard de importação de PDFs dentro do app** — hoje a curadoria é só por CLI
   (`destilar`/`aprender`). Para outros médicos usarem, precisa da tela de importação
   (selecionar PDFs → anonimizar → revisar → virar máscara).
3. **Editor de frases dentro do app** — hoje "editar frases padrão" abre a pasta; ideal é
   uma UI para editar máscaras/regras/frasário sem sair do app.
4. **Colagem robusta em RIS** — se algum RIS bloquear colar formatado, avaliar RTF/HTML no
   clipboard (Electron suporta) ou digitação simulada.
5. **Novos tipos de exame** — RM/US/RX (o schema de máscara já tem `modalidade`); repetir
   o método destilar→aprender→ordem canônica.
6. **Fase 2 (produto)**: backend próprio com as chaves da empresa (esconde chave, billing,
   margem), Kimi/DeepSeek auto-hospedado em VPS (a flag `--kimi` já existe para testar),
   assinatura de código (Apple US$ 99/ano; Windows Azure Trusted Signing), auto-update.

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
```
