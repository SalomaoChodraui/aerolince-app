# Aerolince — Laudos de TC por comando de voz

Produto: o radiologista dita um comando curto ("essa tomo é uma diverticulite do colo direito
não complicada"), o sistema seleciona a máscara de laudo do próprio médico, aplica os achados
ditados e devolve o laudo completo no clipboard.

## 👉 AO RETOMAR: leia `docs/ESTADO.md` primeiro
É o ponto de retomada — estado atual, como rodar, arquitetura, pendências e backlog.
Plano original e decisões em `docs/decisoes.md`.

## Regras de privacidade (INEGOCIÁVEIS)

- `Modelos de Laudos/` (pasta irmã, fora do repo) contém **laudos reais de pacientes** — com
  nome no conteúdo E no nome do arquivo. Esses dados NUNCA entram no git, em logs commitados
  ou em prompts para APIs externas.
- Todo **texto** só pode ir para APIs **depois** de passar pelo `src/core/anonymizer` localmente
  (no app/CLI: `sanitizeComando` no pipeline). O **áudio** do ditado vai à OpenAI para transcrição sem
  anonimização prévia (limitação declarada no onboarding e em `docs/privacidade.md`) — no app, só os
  trechos com fala são retidos — cifrados em disco (spool AES-256-GCM com chave no cofre do SO) e
  apagados após a transcrição; em caso de crash, ficam ≤48 h para recuperação (a CLI de desenvolvimento
  grava `.wav` local, fora do git), e o transcript resultante é sanitizado antes do LLM.
- Nomes de arquivos derivados de laudos reais não podem conter nome de paciente
  (usar data + exame + hash).
- Chaves de API: no app, no cofre local (`secrets.enc.json` via safeStorage, gitignorado); na CLI/dev,
  em `.env` (gitignorado) ou variáveis de ambiente. Nunca hardcoded.
- O produto gera **rascunho**; o médico sempre revisa e assina. Nunca apresentar o output
  como laudo final autônomo.

## Arquitetura

- `src/core/` — Node puro, SEM dependência de Electron (será reusado pelo app na Fase 1).
  - `anonymizer/` — sanitização local (primeiro módulo, tudo depende dele)
  - `audio/` — PCM/WAV/consolidação/cripto do spool (puro; `pcm.ts` é o único módulo importável pelo renderer)
  - `masks/` — parser/validação/catálogo das máscaras (markdown + frontmatter zod)
  - `stt/` — providers de transcrição (OpenAI `gpt-4o-transcribe`, interface trocável)
  - `llm/` — wrapper fino do Claude (seleção: `claude-haiku-4-5`; geração: `claude-sonnet-5`)
  - `engine/` — orquestração: transcript → seleção → geração → diff antialucinação
  - `output/` — formato canônico do laudo + serializadores (txt; html/rtf na Fase 1)
  - `config/` — schema zod da configuração
- `src/cli/` — CLI da Fase 0 (`npm run laudo`)
- `scripts/` — utilitários locais (ex.: sanitizar PDFs)
- Máscaras reais do médico ficam FORA do repo em `../biblioteca-mascaras/` (configurável).
  `masks-exemplo/` contém só máscaras fictícias para dev/teste.

## Convenções

- TypeScript strict, ESM (`type: module`), imports relativos com extensão `.js`.
- Validação com zod em TODAS as fronteiras (config, frontmatter, respostas de LLM).
- Prompts centralizados em `src/core/engine/prompts.ts` — o coração da qualidade.
- Testes com vitest ao lado do código (`*.test.ts`).
- PT-BR em strings voltadas ao usuário e nos prompts; identificadores seguem o padrão do
  módulo vizinho (na prática, PT sem acentos: `gerarComMascara`, `salvarChave`).

## Comandos

App (de qualquer pasta, via wrapper global): `laudo-app` (Electron), `laudo <sub>` (CLI).
- `laudo texto "<comando>"` [`--sonnet` | `--kimi` | `--mask <id>` | `--perfil <id>`] — pipeline sem áudio
- `laudo gravar` / `laudo caso` / `laudo eval` / `laudo masks`
- `laudo destilar <id> <PREFIXO> [--contendo "…"]` — cria máscara-consenso do acervo
- `laudo aprender [<id>|todos]` — re-extrai Regras do Médico (com ordem canônica)
- `npm run sanitize -- <pasta>` — extrai texto local + anonimiza
- Dentro de `app/`: `npm run dev` | `build:app` | `dist` | `test` | `typecheck` | `eval`

Detalhes e backlog: `docs/ESTADO.md`.
