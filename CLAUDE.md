# Aerolince — Laudos de TC por comando de voz

Produto: o radiologista dita um comando curto ("essa tomo é uma diverticulite do colo direito
não complicada"), o sistema seleciona a máscara de laudo do próprio médico, aplica os achados
ditados e devolve o laudo completo no clipboard. Plano completo em `docs/decisoes.md`.

## Regras de privacidade (INEGOCIÁVEIS)

- `Modelos de Laudos/` (pasta irmã, fora do repo) contém **laudos reais de pacientes** — com
  nome no conteúdo E no nome do arquivo. Esses dados NUNCA entram no git, em logs commitados
  ou em prompts para APIs externas.
- Todo texto só pode ir para APIs (Anthropic/OpenAI) **depois** de passar pelo
  `src/core/anonymizer` localmente. Sem exceção.
- Nomes de arquivos derivados de laudos reais não podem conter nome de paciente
  (usar data + exame + hash).
- Chaves de API só em `.env` (gitignorado) ou variáveis de ambiente. Nunca hardcoded.
- O produto gera **rascunho**; o médico sempre revisa e assina. Nunca apresentar o output
  como laudo final autônomo.

## Arquitetura

- `src/core/` — Node puro, SEM dependência de Electron (será reusado pelo app na Fase 1).
  - `anonymizer/` — sanitização local (primeiro módulo, tudo depende dele)
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
- PT-BR em strings voltadas ao usuário e nos prompts; código/identificadores em inglês.

## Comandos

- `npm run laudo -- texto "<comando ditado>"` — pipeline sem áudio (para testes)
- `npm run laudo -- gravar` — grava do microfone (ffmpeg) e roda o pipeline
- `npm run laudo -- <arquivo.m4a|wav>` — transcreve um áudio e roda o pipeline
- `npm run sanitize -- <pdfs...>` — extrai texto local + anonimiza (gera .txt sanitizado)
- `npm test` / `npm run typecheck` / `npm run eval`
