# Biblioteca base do Aerolince

Esta pasta é a biblioteca de máscaras EMBARCADA no aplicativo: 18 máscaras de TC com
fraseado neutro de laudário clássico brasileiro, regras gerais universais e um frasário
de achados patológicos. Ela existe para que o aplicativo funcione desde o primeiro uso,
antes de o radiologista ter a própria biblioteca.

## Como as camadas funcionam

O aplicativo carrega as máscaras em DUAS camadas, nesta ordem de precedência:

1. `biblioteca-base/` (esta pasta) — a base embarcada.
2. A biblioteca do radiologista (configurável) — sempre vence.

- Máscara com o MESMO `id` na biblioteca do radiologista substitui a da base por inteiro.
- `regras/gerais.md` do radiologista substitui o desta pasta por inteiro.
- Frasário: os arquivos das duas camadas são somados; arquivo com o mesmo NOME na
  biblioteca do radiologista substitui o homônimo da base. Além disso, arquivo de
  frasário da base com conteúdo IDÊNTICO ao de um arquivo da biblioteca do
  radiologista é pulado automaticamente (deduplicação por conteúdo), mesmo que os
  nomes sejam diferentes.
  **Cuidado:** essa dedup é por conteúdo exato, não por "parentesco". Se você EDITAR um
  arquivo de frasário seu que antes era idêntico a um da base, a cópia da base volta a
  entrar (o conteúdo mudou, deixou de ser idêntico). Para suprimir a cópia da base de
  vez, crie na SUA pasta `frasario/` um arquivo com o MESMO NOME do arquivo da base
  correspondente — nomes iguais vencem por nome, independente do conteúdo.

## Onde editar

NÃO edite os arquivos desta pasta: atualizações do aplicativo podem sobrescrevê-los.
Toda personalização (fraseado próprio, novas máscaras, regras de estilo) deve ser feita
na biblioteca do radiologista, que cobre a base pelos mecanismos acima.

## Conteúdo

- `tc-*.md` — 18 máscaras de TC (crânio, tórax, abdome, colunas, musculoesquelético,
  face, mastoides e pescoço), com marcadores `<!-- orgao: -->` por bloco anatômico e
  `<!-- impressao -->` na conclusão.
- `regras/gerais.md` — guardas clínicas universais (classificações órgão-específicas,
  limites de protocolo sem contraste, proibição de inventar medida ou lateralidade).
- `frasario/*.md` — frases prontas de achados patológicos por região, com o campo
  `aplica_a` indicando a quais máscaras cada arquivo se aplica.

Nenhum arquivo desta pasta contém dado de paciente, de radiologista ou de clínica;
há teste automático de privacidade em `src/core/masks/biblioteca-base.test.ts`.
