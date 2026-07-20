# Privacidade e LGPD

## Princípios
1. **Texto sanitizado antes do LLM.** Todo texto (comando ditado transcrito ou laudo do acervo) passa pelo
   `src/core/anonymizer` no próprio computador antes de qualquer chamada de geração (Anthropic). O que sobe
   é texto sanitizado ([NOME], [CPF], [DATA], [ID], [TEL], [CRM]). No app, é o `sanitizeComando` no pipeline.
2. **O áudio do ditado vai à OpenAI para transcrição.** Anonimizar áudio localmente não é possível nesta
   fase; o fluxo é declarado no onboarding. Durante a sessão de escuta, só os trechos com fala são
   registrados. Eles ficam temporariamente no disco **cifrados** (AES-256-GCM, chave de sessão protegida
   pelo cofre do sistema operacional via `safeStorage`) e são apagados logo após a transcrição. Se o app
   falhar no meio do ditado, os trechos cifrados permanecem por até 48 h para recuperação e depois são
   apagados. Áudio em claro nunca toca o disco. (A CLI de desenvolvimento, fora do app, ainda grava
   `.wav` local — fora do git.) O áudio não deve conter dados do paciente — a melhor proteção é não
   ditá-los. STT local é alternativa avaliada para a Fase 2.
3. **Limitações conhecidas da sanitização (regex):** nomes ditados sem gatilho ("paciente", "doutor") podem
   escapar; datas NÃO são removidas do comando (são conteúdo clínico — comparativos) e geram apenas aviso
   na interface.
4. **Dados de pacientes nunca entram no git.** `.gitignore` cobre PDFs, áudios, laudos gerados e as pastas
   de dados. A pasta `Modelos de Laudos/` fica fora do repositório.
5. **Nomes de arquivos derivados não contêm nome de paciente** (padrão: exame + data + índice).
6. **O ditado do médico é tratado como dado a proteger**: não é logado fora da máquina; sidecar `.json` é
   local e desligável. O transcript persistido é a versão sanitizada.
7. **APIs**: Anthropic e OpenAI, por padrão contratual das APIs, não treinam modelos com dados enviados via
   API — mas "não treina" não equivale a "não retém" (logs de abuso podem reter por até 30 dias). Formalizar
   DPA/ZDR na Fase 2 (produto comercial).
8. **O produto gera rascunho.** Laudo é ato médico: o radiologista sempre revisa e assina. Isso é parte do
   posicionamento jurídico do produto.

## Fluxo dos 280 PDFs reais (acervo do Paulinho)
PDF (local) → `pdftotext` (local) → `sanitize()` (local) → `tmp-sanitized/` (gitignorado, nomes sem paciente) → só então qualquer uso com IA.
O mapa arquivo-original ↔ sanitizado (`_mapa-local.tsv`) fica apenas na máquina.
