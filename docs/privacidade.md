# Privacidade e LGPD

## Princípios
1. **Anonimização local antes de qualquer envio.** Todo texto derivado de laudos reais passa pelo `src/core/anonymizer` no próprio computador antes de qualquer chamada de API. O que sobe é só texto sanitizado ([NOME], [CPF], [DATA], [ID], [TEL], [CRM]).
2. **Dados de pacientes nunca entram no git.** `.gitignore` cobre PDFs, áudios, laudos gerados e as pastas de dados. A pasta `Modelos de Laudos/` fica fora do repositório.
3. **Nomes de arquivos derivados não contêm nome de paciente** (padrão: exame + data + índice).
4. **O ditado do médico** normalmente não contém identificadores; ainda assim, o pipeline trata o transcript como dado a proteger (não é logado fora da máquina; sidecar `.json` é local e desligável).
5. **APIs**: Anthropic e OpenAI, por padrão contratual das APIs, não treinam modelos com dados enviados via API. Formalizar DPA/termos na Fase 2 (produto comercial).
6. **O produto gera rascunho.** Laudo é ato médico: o radiologista sempre revisa e assina. Isso é parte do posicionamento jurídico do produto.

## Fluxo dos 280 PDFs reais (acervo do Paulinho)
PDF (local) → `pdftotext` (local) → `sanitize()` (local) → `tmp-sanitized/` (gitignorado, nomes sem paciente) → só então qualquer uso com IA.
O mapa arquivo-original ↔ sanitizado (`_mapa-local.tsv`) fica apenas na máquina.
