# Aerolince

Laudos de tomografia por comando de voz, para macOS. O radiologista dita um comando curto ("essa tomo é uma diverticulite do colo direito não complicada"), o Aerolince escolhe a máscara de laudo, aplica os achados ditados e devolve o rascunho completo na área de transferência.

O resultado é sempre um **rascunho**. Laudo é ato médico: o radiologista revisa e assina.

## Instalação

Baixe o DMG em [Releases](../../releases/latest), abra e arraste o Aerolince para Aplicativos. Assinado com Developer ID e notarizado pela Apple. Requer Mac com Apple Silicon.

Na primeira abertura, informe suas chaves de API nos Ajustes:

- **Anthropic**, para escolher a máscara e gerar o laudo
- **OpenAI**, só para a transcrição da voz

As chaves ficam no cofre do macOS, nesta máquina.

## Privacidade

- Todo texto passa por uma sanitização local (nomes, CPF, datas, IDs, telefones, CRM) antes de ir para a API.
- O áudio do ditado vai à OpenAI para transcrição. Os trechos ficam cifrados em disco só até a transcrição terminar.
- Dados de pacientes nunca entram neste repositório.

Detalhes e limitações em [`docs/privacidade.md`](docs/privacidade.md).

## Biblioteca de máscaras

O app traz uma biblioteca base com 18 máscaras de TC, regras gerais e um frasário de achados (`biblioteca-base/`). A biblioteca do próprio radiologista, configurável nos Ajustes, sempre vence a base.

## Desenvolvimento

```bash
npm ci
npm run dev          # app em modo dev
npm test             # vitest
npm run typecheck
npm run laudo -- texto "tomografia de crânio normal" --dry-run   # CLI
```

Build assinado e notarizado (precisa do Developer ID e de um perfil do `notarytool` no Keychain):

```bash
APPLE_KEYCHAIN_PROFILE=notary npm run dist:mac   # ~/Library/Developer/Aerolince/release/
```

Arquitetura e estado do projeto: [`docs/ESTADO.md`](docs/ESTADO.md).

## Licença

MIT. Veja [LICENSE](LICENSE).
