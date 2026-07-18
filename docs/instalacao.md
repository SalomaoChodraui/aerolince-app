# Instalação e uso (Fase 0 — CLI)

## Pré-requisitos
- Node 22+ (`brew install node`), ffmpeg (`brew install ffmpeg`), poppler (`brew install poppler`, para o pdftotext)
- Chaves de API (arquivo `app/.env`):

```
ANTHROPIC_API_KEY=sk-ant-…   # console.anthropic.com → API Keys
OPENAI_API_KEY=sk-…          # platform.openai.com → API Keys (usada só para transcrição de voz)
```

## Comandos
```bash
npm install                # uma vez
npm run laudo -- texto "essa tomo é uma diverticulite do colo direito não complicada"
npm run laudo -- gravar    # grava do microfone; ENTER para parar
npm run laudo -- masks     # lista a biblioteca de máscaras
npm run eval               # golden set (acurácia da seleção de máscara)
npm run sanitize -- "../Modelos de Laudos/Exames_TC_2026"   # re-sanitizar PDFs (local)
npm test && npm run typecheck
```

Flags úteis: `--fast` (gera com Haiku, mais rápido), `--perfil urgencia`, `--mask tc-torax` (pula a seleção), `--dry-run` (não chama API).

O laudo sai no terminal, vai para a área de transferência e é salvo em `../Laudos Gerados/`.
As máscaras reais ficam em `../biblioteca-mascaras/` (edite os .md à vontade — o texto é o fraseado do próprio médico).
