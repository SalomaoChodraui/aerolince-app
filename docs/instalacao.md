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

## App instalado (DMG / instalador Windows)

Na primeira abertura o app cria a pasta de dados com perfis, máscaras de exemplo,
`laudo.config.json` e um `.env` vazio:

- **Mac:** `~/Library/Application Support/Aerolince/`
- **Windows:** `%APPDATA%/Aerolince/`

Para pôr em produção na máquina do médico:
1. Edite o `.env` dessa pasta com as chaves (ANTHROPIC_API_KEY e OPENAI_API_KEY).
2. Substitua a `biblioteca-mascaras/` de exemplo pela biblioteca real (máscaras + `regras/` + `frasario/`).
3. Reabra o app.

Apps sem assinatura (fase piloto): no mac, clique-direito → Abrir na primeira vez;
no Windows, SmartScreen → "Mais informações" → "Executar assim mesmo".
