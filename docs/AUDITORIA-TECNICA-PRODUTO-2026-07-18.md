# Auditoria crítica do Aerolince

**Data:** 18/07/2026  
**Versão auditada:** `0.1.0`  
**Commit:** `38f2cc0`  
**Escopo:** produto, fluxo clínico, usabilidade, interface, acessibilidade, arquitetura, lógica, IA, privacidade/LGPD, segurança, qualidade, desempenho, custo, distribuição e operação.

**Adendo de arquitetura:** a proposta específica para gravações reais de 10–15 minutos, resiliência e custo está em [`PROPOSTA-ARQUITETURA-AUDIO-RESILIENTE-2026-07-19.md`](./PROPOSTA-ARQUITETURA-AUDIO-RESILIENTE-2026-07-19.md).

## 1. Parecer executivo

O Aerolince tem uma proposta de valor forte e um MVP visualmente convincente. A combinação de botão flutuante, comando semântico curto, máscara do próprio médico, refino e clipboard reduz atrito em um ponto real do trabalho do radiologista. A separação entre `core/` e Electron, o uso de patches e a biblioteca médica externa são boas decisões para um MVP.

O produto, porém, ainda não está pronto para distribuição clínica ampla ou comercialização. Hoje ele deve ser tratado como **piloto interno controlado**, com revisão humana obrigatória e um grupo pequeno de usuários informados. Os riscos mais importantes não estão no acabamento visual; estão na segurança clínica, na promessa de privacidade, na consistência do estado do laudo e na falta de uma validação clínica reprodutível.

Recomendação de liberação:

- **Piloto interno:** somente depois dos itens P0 deste relatório.
- **Piloto com médicos externos:** depois de P0 + assinatura dos builds + onboarding e suporte mínimos.
- **Produto comercial:** depois de P0 + P1, contratos de dados com fornecedores, telemetria confiável, CI/E2E e processo de atualização/rollback.

### Avaliação de maturidade

Escala heurística de 1 a 5; não é certificação clínica ou jurídica.

| Área | Nota | Leitura |
|---|---:|---|
| Proposta de valor | 4,5 | Resolve uma dor clara com fluxo simples |
| Base arquitetural | 3,5 | Boa separação de camadas; estado e fronteiras ainda frágeis |
| Praticidade no plantão | 3,0 | Rápido no melhor caminho, mas falhas e ambiguidades têm pouco suporte |
| Interface visual | 4,0 | Coerente, limpa e profissional |
| Acessibilidade | 2,0 | Contraste e semântica de controles precisam de trabalho |
| Segurança clínica | 2,0 | Revisão humana existe, mas faltam gates e validadores determinísticos |
| Privacidade/LGPD | 1,5 | A documentação promete mais do que o pipeline entrega |
| Desempenho/custo | 3,5 | Haiku é promissor; telemetria e custo total ainda são incompletos |
| Qualidade e testes | 2,0 | Núcleo básico coberto; app e fluxo clínico praticamente sem cobertura |
| Distribuição/operação | 1,5 | Builds sem assinatura, sem update, sem CI e sem rastreabilidade de release |
| Prontidão comercial | 1,5 | BYOK, contratos, suporte, billing e multiusuário ainda não resolvidos |

## 2. Metodologia e evidências

Foram realizadas:

- leitura integral da estrutura relevante em `src/core`, `src/main`, `src/preload`, `src/renderer`, `scripts`, `docs`, `eval`, configuração e empacotamento;
- inspeção da biblioteca real de 18 máscaras e do volume de regras/frasários;
- execução de `npm test`, `npm run typecheck`, `npm run build:app` e `npm audit`;
- análise agregada de 49 sidecars locais, sem expor o conteúdo clínico;
- inspeção visual do app instalado e renderização controlada das telas com dados fictícios;
- teste dos layouts de resultado, configurações, histórico e onboarding;
- comparação entre documentação, comportamento implementado e artefatos de release.

Resultados básicos:

| Verificação | Resultado |
|---|---|
| Testes | 27/27 passaram |
| Typecheck atual | Passou, mas exclui os 6 arquivos `.tsx` |
| Build Electron | Passou |
| `npm audit` | 0 vulnerabilidades conhecidas no snapshot instalado |
| Máscaras reais | 18/18 com seções e marcadores básicos consistentes |
| Laudos/sidecars locais | 49 `.txt` e 49 `.json` |
| CI | Não existe |
| Testes E2E | Não existem |

O `npm run eval` ao vivo não foi executado para evitar chamadas pagas e uso desnecessário dos áudios locais. A implementação e os 13 casos foram auditados estaticamente.

## 3. Pontos fortes que devem ser preservados

### 3.1 Proposta e fluxo

- O uso sem integração com RIS reduz tempo de implantação.
- O botão flutuante e o atalho global combinam com o contexto de uso sobre um visualizador DICOM.
- `showInactive()` evita roubar o foco do radiologista quando o resultado fica pronto.
- Máscaras e regras em Markdown dão transparência e permitem curadoria clínica direta.
- O produto se posiciona como rascunho e mantém a assinatura sob responsabilidade médica.

### 3.2 Arquitetura

- `src/core/` não depende de Electron e é testável isoladamente.
- A edição por patches reduz tokens de saída e preserva literalmente blocos não alterados.
- O resolvedor determinístico de contraste reduz uma classe importante de erro do LLM.
- O carregamento de máscaras a cada laudo permite correção rápida do conteúdo clínico.
- Zod já está presente e pode ser expandido para todas as fronteiras.

### 3.3 Interface

- A identidade visual é consistente entre janelas.
- A hierarquia da janela de resultado é clara.
- O histórico em duas colunas é fácil de compreender.
- O modo escuro é visualmente bem resolvido.
- O layout de resultado se reorganiza sem overflow horizontal em largura reduzida.
- Há suporte a `prefers-reduced-motion`.

### 3.4 Desempenho

Nos registros locais, o caminho Haiku foi claramente o mais adequado ao uso interativo:

| Grupo | n | p50 de latência | p90 de latência | custo LLM médio registrado |
|---|---:|---:|---:|---:|
| Haiku 4.5 | 19 | 3,4 s | 5,4 s | US$ 0,0112 |
| Sonnet 5 | 12 | 6,8 s | 9,1 s | US$ 0,0247 |
| Kimi K3 | 4 | 19,7 s | 21,1 s | US$ 0,0104 |
| Kimi high-speed | 2 | 13,1 s | 13,1 s | US$ 0,0109 |

Esses dados são de desenvolvimento, misturam versões do app e não incluem todo o custo de STT. Ainda assim, sustentam manter Haiku como caminho padrão e Sonnet como fallback de qualidade.

## 4. Achados críticos — P0

### P0-01 — A promessa de anonimização local não corresponde ao pipeline de voz

**Evidência**

- `src/main/pipeline.ts:58-67` grava o áudio em `/tmp` e o envia ao OpenAI STT.
- O arquivo temporário não é removido em sucesso nem em erro.
- `src/main/pipeline.ts:69-93` envia o transcript diretamente ao Claude.
- O pipeline do app não importa nem chama `sanitize()`.
- A documentação afirma que todo conteúdo passa pelo anonimizador antes de qualquer API.
- O onboarding não informa claramente que a voz e o texto serão processados em nuvem.

**Impacto**

- O áudio sai da máquina antes que qualquer anonimização textual seja possível.
- Se o médico disser nome, prontuário ou outro identificador, ele será enviado ao STT e depois ao LLM.
- A frase “anonimização local antes de qualquer envio” é materialmente incorreta para o fluxo principal.
- Arquivos de voz podem se acumular no diretório temporário.

**Correção recomendada**

1. Escolher e documentar uma das arquiteturas:
   - STT local; ou
   - STT em nuvem com aviso explícito, base legal, contrato e controles de retenção adequados.
2. Sanitizar o transcript antes da chamada ao LLM.
3. Adicionar detector de identificadores com bloqueio ou confirmação quando houver suspeita.
4. Apagar o áudio temporário em `finally`.
5. Usar nome aleatório criptograficamente forte, permissões restritas e limite de duração/tamanho.
6. Definir retenção e exclusão para transcript, laudo e sidecar.
7. Atualizar onboarding, política e textos da interface para descrever o fluxo real.

**Critério de aceite**

- Nenhum arquivo temporário permanece após sucesso, erro ou cancelamento.
- Teste automatizado comprova sanitização antes do LLM.
- Um comando contendo nome/CPF/prontuário é bloqueado ou sanitizado.
- O usuário vê e aceita o fluxo de nuvem antes de conceder microfone.
- Os contratos/configurações dos fornecedores usados em produção estão documentados.

### P0-02 — Baixa confiança ainda gera laudo silenciosamente

**Evidência**

- `src/core/engine/engine.ts:76-80` devolve máscara e confiança.
- `src/main/pipeline.ts:79-93` só interrompe quando `mask` é nula.
- Uma máscara com confiança `baixa` ou `media` segue para geração.
- `docs/decisoes.md` promete pedir confirmação em confiança baixa, mas esse gate não existe.

**Impacto**

Uma máscara errada pode produzir um laudo plausível e estruturalmente correto para o exame errado. Esse é um risco clínico maior do que uma falha explícita.

**Correção recomendada**

- Definir política determinística:
  - `alta`: gerar;
  - `media`: mostrar 2–3 candidatos e pedir confirmação;
  - `baixa`: não gerar.
- Exibir modalidade, exame, contraste e lateralidade antes da geração quando houver ambiguidade.
- Registrar escolha automática e correção manual para medir erro silencioso.

**Critério de aceite**

- Taxa de “máscara errada sem confirmação” igual a zero no golden set.
- Todos os casos de confiança média/baixa passam por escolha explícita.
- O médico consegue corrigir a máscara sem redizer o achado.

### P0-03 — Edição manual, refino, desfazer e arquivo salvo não compartilham um estado canônico

**Evidência**

- `src/renderer/result/main.tsx:34-37` salva a edição manual apenas no arquivo/sidecar.
- `src/main/pipeline.ts:34-42` mantém outra cópia em memória, com versões `reportRaw`.
- O refino usa `sessao.versions`, não o texto atualmente editado na tela.
- `src/main/index.ts:278-283` desfaz na memória e no clipboard, mas não atualiza o arquivo.
- Todo refino passa novamente por `entregar()` e cria outro `.txt`.

**Impacto**

- O médico pode corrigir manualmente uma informação e perdê-la ao usar refino por voz.
- “Desfazer” pode mostrar/copiar uma versão diferente da persistida.
- O histórico pode conter várias cópias do mesmo laudo, sem relação clara entre elas.
- O loop de feedback pode aprender sobre a versão errada.

**Correção recomendada**

Criar uma entidade única `ReportSession`:

```ts
interface ReportSession {
  id: string;
  status: 'draft' | 'reviewed' | 'copied' | 'archived';
  maskId: string;
  maskVersion: number;
  transcriptSanitized: string;
  versions: ReportVersion[];
  currentVersionId: string;
  reportPath: string;
}
```

- Toda edição manual cria/atualiza a versão corrente.
- Refino recebe explicitamente o texto corrente da UI.
- Desfazer altera UI, clipboard opcional e arquivo de forma atômica.
- Refinos não criam novos laudos; criam versões da mesma sessão.
- O histórico mostra uma sessão e, opcionalmente, suas versões.

**Critério de aceite**

- Cenário E2E: gerar → editar manualmente → refinar → desfazer → reabrir histórico mantém exatamente o texto esperado em cada etapa.
- Existe um único arquivo canônico por sessão.
- Nenhuma edição manual é perdida.

### P0-04 — A validação clínica do patch é insuficiente

**Evidência**

- O modelo emite um formato textual livre de patches.
- `parsePatches()` aceita ID novo fora de kebab-case, substituição vazia e mistura de operações potencialmente conflitantes.
- Não há validação de `stop_reason`, recusa ou truncamento da API.
- Não há validador de medidas, lateralidade, contradições ou placeholders.
- `patchedIds()` confia nas operações, não em uma comparação semântica do resultado.
- Foi encontrado 1 laudo entre 49 com marcador vazado:  
  `2026-07-18_181223_tc-abdome-total-com-contraste.txt`, linha 13, contém `<!-- orgao: vesícula-biliar -->`.
- O vazamento ocorreu porque `stripMarkers()` só aceita IDs ASCII, enquanto o parser permitiu ID acentuado.

**Impacto**

- Texto técnico interno pode chegar ao RIS.
- Uma medida inventada ou alterada pode passar.
- Um patch truncado pode ser aceito parcialmente.
- O app mostra “blocos alterados”, mas isso não prova consistência clínica.

**Correção recomendada**

- Trocar o protocolo textual por saída estruturada JSON com schema estrito.
- Validar:
  - IDs existentes/novos e unicidade;
  - operações incompatíveis;
  - texto não vazio;
  - ausência de marcadores/placeholders no laudo final;
  - medidas e lateralidades do output contra transcript + máscara;
  - conclusão presente quando há achado;
  - ausência de frases normais contraditórias.
- Verificar `stop_reason` e recusar respostas truncadas.
- Rodar `diffAgainstMask()` real no resultado, não apenas confiar na lista de operações.
- Em falha, bloquear clipboard automático e mostrar motivo legível.

**Critério de aceite**

- Zero marcadores, placeholders ou cabeçalhos `@@` em 100% dos testes.
- Medidas e lateralidades passam por invariantes determinísticos.
- Resposta truncada/recusada nunca vira laudo.
- O validador tem testes de mutação com erros intencionais.

### P0-05 — O golden set não valida a qualidade clínica do laudo

**Evidência**

- Existem 13 casos.
- O eval mede apenas `mask_esperada`.
- Nove casos dependem de áudios locais ignorados pelo git; o conjunto não é reproduzível em outra máquina.
- Não há laudo esperado, invariantes, avaliação cega, taxa de edição nem classificação de severidade.
- Não há casos para refino, desfazer, edição manual, erro de API, silêncio, concorrência ou clipboard.

**Impacto**

Uma melhoria de seleção pode degradar medidas, conclusão, ordem, lateralidade ou privacidade sem ser detectada.

**Correção recomendada**

Criar três suites:

1. **Determinística:** parser, patches, medidas, lateralidade, placeholders, anonimização.
2. **Integração com LLM gravada:** fixtures de resposta e clientes falsos, sem custo.
3. **Clínica:** 100–200 casos desidentificados/sintéticos, com máscara, invariantes e nota de radiologista.

Métricas mínimas:

- máscara errada silenciosa: 0;
- preservação exata de medidas/lateralidade: 100% no conjunto sintético;
- contradição crítica: 0;
- marcador/placeholder vazado: 0;
- aceito sem edição + edição pequena: ≥ 80% no piloto;
- p90 do caminho rápido: ≤ 10 s;
- sucesso de colagem no RIS alvo: ≥ 99%.

### P0-06 — Configuração e chaves podem deixar o app em estado inválido

**Evidência**

- `saveConfig()` grava o JSON antes de validá-lo (`src/core/config/schema.ts:114-123`).
- JSON inválido não tem fallback/backup e pode impedir o boot.
- Não há `schemaVersion` nem migração transacional.
- `safeStorage` indisponível remove a chave silenciosamente.
- `statusChaves()` considera o blob existente mesmo se a descriptografia falhou.
- A UI não permite remover uma chave.
- O app diz que as chaves “nunca” ficam em texto puro, mas ainda importa e mantém `.env`.
- O erro de chave orienta editar `.env`, apesar de existir tela de configurações.
- O documento de retomada registra perda prévia de chaves durante migração.

**Correção recomendada**

- Validar primeiro; gravar arquivo temporário; `fsync`; renomear atomicamente.
- Manter backup da última configuração válida.
- Adicionar `schemaVersion` e migrações idempotentes.
- Falhar de forma explícita quando o cofre não estiver disponível.
- Validar a descriptografia ao calcular status.
- Permitir remover e testar cada chave.
- Para produto comercial, retirar BYOK da experiência principal.

**Critério de aceite**

- Testes de corrupção e migração preservam a última configuração válida.
- Chave corrompida aparece como inválida, não “configurada”.
- O onboarding testa as conexões sem enviar dado clínico.

## 5. Achados de alta prioridade — P1

### 5.1 Usabilidade e fluxo clínico

| Achado | Evidência/impacto | Recomendação |
|---|---|---|
| Clipboard é sobrescrito antes da revisão | `entregar()` chama `clipboard.writeText()` imediatamente | Tornar “copiar automaticamente” configurável; padrão seguro é revisar/aceitar |
| Clipboard rico não existe | Documentação promete texto + HTML + RTF; o app usa apenas `writeText` | Implementar e testar `clipboard.write({text, html, rtf})` no RIS, Word e campo simples |
| Erro detalhado pode ficar invisível | O resultado recebe o evento de erro, mas a janela não é exibida | Mostrar painel de erro acionável com “tentar novamente”, “abrir configurações” e diagnóstico |
| Microfone sem tratamento de erro | `getUserMedia()` não tem `try/catch` | Estados específicos: permissão, dispositivo ausente, silêncio, formato não suportado |
| Sem cancelamento durante processamento | Esc só vale durante gravação | `AbortController`, timeout, cancelar/repetir e proteção contra resposta atrasada |
| Sem limite de gravação | Buffer e IPC podem crescer indefinidamente | VAD local, medidor de nível, limite de duração e tamanho |
| Sem seleção de dispositivo | Plantões usam múltiplos microfones/headsets | Seletor e teste de microfone |
| Perfil de estilo não aparece no app | Perfis existem, mas só a CLI seleciona | Seletor por laudo e default nas configurações |
| “Menu” da janela abre apenas configurações | Botão `☰` promete configurações, histórico e ajuda | Popover real ou botões claros |
| Fechamento e estado de background pouco visíveis | App sem dock/taskbar e fechamento esconde janela | Indicador de que o app continua ativo e opção “iniciar com o sistema” |

### 5.2 Interface e revisão

| Achado | Avaliação | Recomendação |
|---|---|---|
| Diff não é realmente exibido | Chips `vesicula`, `colon`, `impressao` são IDs internos | Destacar linhas/blocos alterados no texto e traduzir nomes |
| Confiança é um chip passivo | Não permite corrigir exame | Tornar o exame clicável e oferecer troca/confirmar |
| Texto denso e pequeno | Monospace 13 px é cansativo em laudo longo | 14–15 px, zoom, largura de linha e densidade configuráveis |
| Caminho completo no rodapé | Gera ruído visual e quebra linha | Mostrar “salvo” + botão “revelar no Finder/Explorer” |
| “Copiar de novo” como ação principal | A tela diz que já copiou; ação parece redundante | Usar “Aprovar e copiar” ou “Copiar versão revisada” |
| Histórico usa IDs técnicos | `tc-abdome-total` em vez de nome clínico | Persistir/exibir `maskNome` |
| Data sem `:` | Exibe `1916`, não `19:16` | Formatar com `Intl.DateTimeFormat` |
| Histórico fecha automaticamente após copiar | Pode surpreender e impedir comparação | Preferência ou toast; não fechar por padrão |
| Seleção filtrada pode continuar no detalhe | Busca altera lista, não limpa `sel` | Sincronizar seleção com filtro |
| Onboarding não conclui setup real | Explica uso, mas não valida chave, microfone e biblioteca | Wizard com checklist e teste sem dado clínico |

### 5.3 Acessibilidade

- Os botões principais têm contraste aproximado de **3,81:1** no tema claro e **3,23:1** no escuro, abaixo de 4,5:1 para texto normal.
- O switch de glass e o slider de opacidade não têm nome acessível.
- Os indicadores do onboarding são `span` clicáveis, sem papel, nome ou teclado.
- Os itens do histórico são `li` clicáveis, sem `tabIndex`, botão ou estado `aria-selected`.
- O botão de menu tem nome acessível `☰`, não “Menu”.
- Campos de API e macros dependem de texto visual adjacente, sem `<label for>`.
- Estados de sucesso/erro dependem parcialmente de cor.
- O modo glass pode reduzir contraste em fundos imprevisíveis.

Recomendação: adotar WCAG 2.2 AA como gate, executar axe em CI e fazer teste completo por teclado/leitor de tela.

### 5.4 Configurações

- Os nomes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` e `MOONSHOT_API_KEY` são linguagem de desenvolvedor, não de radiologista.
- A experiência BYOK exige cadastro, billing e suporte em dois fornecedores.
- Não há “testar conexão”, orçamento, limite de gasto ou explicação de custo.
- Alteração de macro grava arquivo a cada tecla e pode sofrer respostas assíncronas fora de ordem.
- Slider também persiste repetidamente durante arraste.
- Troca de pasta não valida conteúdo, leitura/escrita ou permissões.
- Um único Markdown inválido pode impedir o carregamento de toda a biblioteca.
- Não há editor de máscara/frase nem preview/validação antes de ativar.

Recomendação: formulário local com “Salvar”, debounce apenas onde apropriado, validação de pasta e editor com preview e rollback.

## 6. Arquitetura, segurança e confiabilidade

### 6.1 Estado e concorrência

- `sessao` é global e aceita apenas um laudo.
- Tray/macro/refino podem disparar operações concorrentes.
- Não há mutex, idempotência ou ID de requisição.
- Uma resposta antiga pode chegar depois de uma nova e substituir estado/clipboard.
- O histórico e a configuração fazem IO síncrono no processo principal.

Recomendação:

- máquina de estados explícita por sessão;
- uma operação ativa por sessão;
- IDs e cancelamento;
- IO assíncrono/worker para tarefas maiores;
- fila apenas quando o comportamento estiver visível ao usuário.

### 6.2 Segurança Electron

- `sandbox: false` em todas as janelas.
- Não há Content Security Policy.
- IPC recebe objetos e strings sem validação runtime.
- `config-set`, `secrets-set`, `abrir-pasta` e buffers de áudio não têm limites/schema de fronteira.
- Não há bloqueio de navegação ou abertura de nova janela.
- Não há `requestSingleInstanceLock()`.

O risco de exploração hoje é reduzido por conteúdo local e React escapando texto, mas a postura é inadequada para um app que processa informação de saúde.

Recomendação:

- `sandbox: true` se compatível;
- `contextIsolation: true` e `nodeIntegration: false` explícitos;
- CSP restritiva;
- Zod em cada canal IPC;
- limites de tamanho;
- bloquear navegação externa;
- single-instance lock;
- checklist Electron Security como gate de release.

### 6.3 Robustez de modelo

- Seleção usa prompt JSON + parser tolerante, não structured output real.
- Patches são texto livre.
- Não há retries classificados, timeout de negócio ou circuit breaker.
- Não há fallback controlado entre modelos.
- Alias do modelo e prompt não são registrados com versão completa no sidecar.
- O mesmo relatório pode variar sem uma mudança visível de release.

Recomendação:

- structured output para seleção e patch;
- `promptVersion`, `modelSnapshot`, `maskVersion`, `rulesHash` e `appCommit`;
- fallback apenas após erro técnico, nunca para “corrigir” silenciosamente um resultado inválido;
- suíte clínica obrigatória para mudar modelo, prompt ou biblioteca.

### 6.4 Máscaras e contexto

As 18 máscaras auditadas estão estruturalmente consistentes, mas o schema só valida frontmatter. Ele não exige Técnica, Análise, Conclusão, um único marcador de impressão ou IDs únicos.

O contexto injetado por exame varia aproximadamente de:

- 1,3 mil tokens em sacroilíacas;
- 8,5 mil em abdome;
- 9 mil em tórax;
- 10,8 mil em crânio.

Enviar todo o frasário melhora cobertura, mas aumenta latência, custo e superfície de comportamento inesperado.

Recomendação:

- validar estrutura completa ao carregar;
- manter última versão válida quando um arquivo falhar;
- indexar frases por órgão/patologia e recuperar somente contexto relevante;
- medir qualidade antes/depois da redução;
- versionar e aprovar alterações de conteúdo clínico.

## 7. Qualidade de código e testes

### 7.1 Lacunas

- `tsconfig.json` inclui `src/**/*.ts`, mas não `src/**/*.tsx`; os seis renderers não entram no typecheck.
- Não há lint, formatter ou checagem de dependências em CI.
- Não há GitHub Actions ou pipeline equivalente.
- Não há cobertura de:
  - `matcher.ts`;
  - `pipeline.ts`;
  - `config/schema.ts`;
  - `secrets.ts`;
  - `historico.ts`;
  - IPC;
  - Electron;
  - renderers;
  - empacotamento;
  - colagem real.
- Nove áudios do golden set estão apenas no ambiente local e fora do git.
- O eval chama APIs pagas e não é determinístico.

### 7.2 Plano de testes recomendado

**Unitários**

- matcher e contraste;
- schema completo de máscara;
- protocolo JSON de patch;
- validador de medidas/lateralidade/placeholder;
- config atômica e migrações;
- sanitização com e-mail, endereço, IDs variados e nomes não rotulados.

**Integração**

- pipeline com `FakeSTT` e `FakeLLM`;
- timeout, retry, cancelamento, recusa e truncamento;
- edição manual + refino + desfazer;
- histórico e sidecar versionado;
- falha de cofre/config/pasta.

**E2E Electron**

- macOS arm64, macOS x64 se suportado e Windows x64;
- primeiro uso;
- permissão de microfone;
- silêncio;
- gerar/confirmar/copiar/refinar/desfazer;
- tema;
- atalho ocupado;
- múltiplos monitores;
- segunda instância;
- RIS/Word/campo simples.

**Clínicos**

- casos sintéticos e desidentificados;
- avaliação cega por pelo menos dois radiologistas;
- severidade de erro: cosmético, edição menor, relevante, crítico;
- regressão por máscara, modelo e prompt.

## 8. Custo e desempenho

### 8.1 O que a telemetria atual permite concluir

Nos 49 registros:

- p50 total: 5,4 s;
- p90 total: 14,3 s;
- máximo: 32,3 s;
- p50 de custo LLM registrado: US$ 0,0140;
- p90: US$ 0,0239;
- média: US$ 0,0509, distorcida por um outlier de US$ 1,0629;
- 12 registros não têm modelo identificado;
- há mais de uma versão de schema de sidecar.

O p90 agregado não atende a meta de 10 s, mas o subconjunto Haiku atende. A amostra não é produção e mistura experimentos.

### 8.2 Problemas do cálculo atual

- O UI mostra somente custo LLM; não inclui STT.
- O app não captura uso/custo da transcrição.
- Não inclui retry, falha, suporte, backend, observabilidade, distribuição ou impostos.
- A documentação usa reais; a UI usa dólares; não há taxa/câmbio registrado.
- O preço de Sonnet está hardcoded no valor padrão de US$ 3/US$ 15 por MTok. Em 18/07/2026, Sonnet 5 está em preço introdutório de US$ 2/US$ 10 até 31/08/2026. O estimador superestima esse modelo no período.
- Uma tabela hardcoded pode ficar silenciosamente desatualizada.

### 8.3 Modelo financeiro recomendado

Registrar por requisição:

```text
custo_total =
  STT
  + seleção
  + geração
  + retries
  + infraestrutura
  + observabilidade
  + suporte
  + distribuição/assinatura
```

Separar:

- custo marginal por laudo;
- custo por médico/mês;
- custo de primeiro uso de uma máscara versus cache hit;
- custo de erro/repetição;
- margem de produto.

### 8.4 BYOK versus serviço gerenciado

| Modelo | Vantagem | Desvantagem |
|---|---|---|
| Chaves do próprio médico | Backend barato e rápido para piloto | Onboarding técnico, billing fragmentado, suporte difícil, sem controle de limites |
| Chave da empresa via backend | UX e billing melhores, quotas e observabilidade | A empresa passa a processar dados e amplia responsabilidade operacional/LGPD |
| Híbrido | Piloto BYOK e produto gerenciado | Duas arquiteturas temporárias |

Recomendação: manter BYOK apenas no piloto interno; para comercialização, usar serviço gerenciado com quotas, contrato, segregação por tenant, logs sem conteúdo clínico e opção de retenção adequada.

## 9. Privacidade, LGPD e governança

Dados de saúde são dados pessoais sensíveis. A base local contém PDFs reais com nomes nos arquivos, e o app mantém transcript/laudo em sidecars sem criptografia ou expiração. Mesmo sem nome explícito, timestamp, achados raros e contexto podem permitir reidentificação.

Itens necessários:

1. mapa de dados ponta a ponta;
2. definição de controlador, operador e suboperadores;
3. base legal e finalidade por operação;
4. RIPD antes de escala;
5. contratos/DPA e configuração de retenção dos fornecedores;
6. política de retenção/exclusão local;
7. criptografia em repouso ou armazenamento em diretório protegido;
8. controle de acesso, auditoria e resposta a incidente;
9. transparência no onboarding;
10. processo para direitos do titular;
11. separação entre corpus de desenvolvimento e dados operacionais;
12. revisão jurídica especializada antes de comercialização.

Observações sobre fornecedores:

- A OpenAI informa que dados de API não são usados para treinamento por padrão, mas logs de abuso podem conter conteúdo e ser retidos por até 30 dias; ZDR depende de aprovação/configuração.
- A Anthropic informa que não usa conteúdo retido para treinamento sem permissão; ZDR é uma configuração contratual por organização e deve ser solicitada.
- “Não treina” não equivale a “não retém”.

O script de sanitização também precisa de gate:

- arquivos marcados “REVISAR” ainda são escritos e podem ser consumidos depois;
- e-mail, endereço e nomes não rotulados podem escapar;
- `_mapa-local.tsv` contém nomes de arquivo originais em texto puro;
- não há tela de revisão obrigatória nem registro de aprovação.

## 10. Distribuição e operação

### Estado atual

- app instalado: aproximadamente 301 MB no macOS;
- unpacked Windows: aproximadamente 370 MB;
- DMG: 118 MB;
- instalador Windows: 90 MB;
- workspace local: 1,4 GB;
- releases locais: 879 MB, incluindo artefatos duplicados/stale;
- macOS apenas arm64;
- Windows configurado para x64;
- sem assinatura, notarização, auto-update ou rollback;
- versão continua `0.1.0` após várias mudanças;
- o app instalado em `/Applications` é anterior ao release e ao commit atual, mas tem a mesma versão.

### Recomendação

- Manter Electron agora; uma reescrita não se justifica antes de validar o produto.
- Adicionar pipeline limpo de release e apagar artefatos obsoletos fora do workspace de produto.
- Gerar versão semântica + commit SHA + prompt/mask schema.
- Assinar e notarizar macOS.
- Assinar Windows.
- Implementar auto-update com canal piloto/estável e rollback.
- Produzir SBOM e avisos de licenças.
- Testar instalação em máquina limpa.
- Definir suporte a Mac Intel ou declarar explicitamente arm64.
- Adicionar diagnóstico local exportável sem transcript/laudo.

## 11. Backlog priorizado para o time

Estimativa relativa: **S** até 1 dia, **M** 2–4 dias, **L** 1–2 semanas, **XL** maior ou multidisciplinar.

| ID | Pri. | Entrega | Esforço | Critério principal |
|---|---|---|---:|---|
| SAFE-01 | P0 | Gate de confiança e troca de máscara | M | Nenhuma máscara baixa/média gera silenciosamente |
| PRIV-01 | P0 | Apagar áudio em `finally`, limites e nomes seguros | S | Zero resíduos em `/tmp` |
| PRIV-02 | P0 | Sanitizar transcript antes do LLM | M | Teste comprova bloqueio/mascaramento |
| PRIV-03 | P0 | Corrigir textos de privacidade e onboarding | M | Fluxo real de nuvem descrito |
| STATE-01 | P0 | `ReportSession` canônica e versionada | L | Edição/refino/desfazer persistem corretamente |
| SAFE-02 | P0 | Patch JSON estruturado | L | Schema estrito e zero patch textual livre |
| SAFE-03 | P0 | Validador de output clínico | L | Medidas, lateralidade e placeholders validados |
| QA-01 | P0 | Golden set clínico reprodutível | XL | Métricas clínicas e gate de release |
| CONFIG-01 | P0 | Config atômica, backup e migrações | M | Corrupção não impede boot |
| SECRET-01 | P0 | Cofre com status real, teste e remoção | M | Chave inválida é detectada |
| UX-01 | P1 | Diff inline e nomes clínicos | L | Médico identifica alterações sem ler tudo |
| CLIP-01 | P1 | Clipboard text/HTML/RTF testado | M | RIS, Word e campo simples aprovados |
| UX-02 | P1 | Copiar automático configurável | S | Clipboard não é sobrescrito sem política explícita |
| AUDIO-01 | P1 | Permissão, VAD, medidor e dispositivo | L | Silêncio não sobe; erro é acionável |
| NET-01 | P1 | Timeout, cancelamento, retry e idempotência | L | Resposta antiga não substitui sessão |
| APP-01 | P1 | Single-instance e atalho com conflito visível | S | Segunda instância não abre; conflito aparece |
| IPC-01 | P1 | Zod + limites em todos os IPCs | M | Payload inválido é rejeitado |
| SEC-01 | P1 | Hardening Electron e CSP | M | Checklist Electron aprovado |
| UI-01 | P1 | WCAG AA e teclado | L | axe sem violações críticas |
| SETTINGS-01 | P1 | Setup amigável, perfis e macros sem gravação por tecla | L | Médico configura sem termos técnicos |
| HIST-01 | P1 | Histórico por sessão, nome clínico e data correta | M | Sem duplicação por refino |
| TEST-01 | P1 | Typecheck TSX + integração + E2E | L | CI Mac/Windows obrigatório |
| RELEASE-01 | P1 | Assinatura, versão, CI e update | XL | Build rastreável e instalável sem bypass |
| COST-01 | P1 | Telemetria versionada e custo total | M | STT + LLM + retry registrados |
| CONTEXT-01 | P2 | Recuperação seletiva de frasário | L | Reduz tokens sem perder qualidade |
| EDITOR-01 | P2 | Editor/validador de máscaras | XL | Curadoria sem editar Markdown bruto |
| IMPORT-01 | P2 | Importador com revisão obrigatória | XL | Nenhum “suspeito” segue sem aprovação |
| FEEDBACK-01 | P2 | Aprendizado de feedback com aprovação humana | XL | Nunca altera regra automaticamente |
| PLATFORM-01 | P2 | Backend multiusuário/billing/quotas | XL | Tenant isolado e contratos concluídos |

## 12. Sequência recomendada

### Fase A — Contenção para piloto

1. Corrigir privacidade do fluxo e resíduos de áudio.
2. Implementar gate de confiança.
3. Bloquear output com marcador/placeholder/medida inválida.
4. Unificar estado de edição/refino/desfazer.
5. Corrigir config/cofre.
6. Criar golden set clínico mínimo e teste no RIS.

### Fase B — Experiência de plantão

1. Diff inline.
2. Permissão/microfone/VAD.
3. Clipboard robusto.
4. Erros, retry e cancelamento.
5. Perfis, macros e onboarding.
6. Acessibilidade.

### Fase C — Distribuição externa

1. CI/E2E Mac e Windows.
2. Assinatura/notarização.
3. Versionamento e update/rollback.
4. Telemetria sem conteúdo clínico.
5. Contratos, RIPD e suporte.

### Fase D — Produto comercial

1. Backend gerenciado e billing.
2. Multiusuário/multimédico.
3. Editor/importador.
4. Aprendizado assistido por feedback.
5. Expansão para novas modalidades somente depois dos gates de TC.

## 13. Critérios de “pronto para piloto”

O piloto só deve começar quando:

- [ ] baixa/média confiança nunca gera sem confirmação;
- [ ] áudio temporário é apagado;
- [ ] transcript é sanitizado antes do LLM;
- [ ] fluxo de nuvem está explicado ao usuário;
- [ ] edição manual sobrevive ao refino;
- [ ] desfazer atualiza UI e armazenamento;
- [ ] zero marcadores/placeholders em golden set;
- [ ] medidas e lateralidades têm validador determinístico;
- [ ] output truncado/recusado é bloqueado;
- [ ] RIS alvo, Word e campo simples aceitam o clipboard;
- [ ] p90 do caminho Haiku fica abaixo de 10 s;
- [ ] golden set clínico foi aprovado pelo radiologista;
- [ ] configuração e chaves têm backup/recuperação;
- [ ] existe procedimento de suporte e rollback.

## 14. Fontes externas consultadas

- [Claude Sonnet 5 — comportamento e preço](https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5)
- [Claude Haiku 4.5 — preço](https://www.anthropic.com/claude/haiku)
- [GPT-4o Transcribe — preço e especificação](https://developers.openai.com/api/docs/models/gpt-4o-transcribe)
- [OpenAI — controles e retenção de dados da API](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [Anthropic — API e retenção de dados](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- [LGPD — Lei nº 13.709/2018](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)
- [ANPD — Relatório de Impacto à Proteção de Dados](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/relatorio-de-impacto-a-protecao-de-dados-pessoais-ripd)
- [ANPD — Guia de Segurança da Informação](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte)
- [Apple Developer Program](https://developer.apple.com/help/account/membership/program-enrollment)
- [Microsoft Artifact Signing — tiers](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-change-sku)

## 15. Conclusão

O melhor próximo investimento não é adicionar modalidades, mais modelos ou mais efeitos visuais. É transformar o caminho já convincente em um fluxo **clinicamente verificável, privacidade-honesto e transacional**.

A base atual merece continuidade. Não há sinal de que seja necessário reescrever o app ou abandonar Electron. O ganho mais rápido vem de:

1. gates clínicos determinísticos;
2. estado único do laudo;
3. privacidade coerente com o fluxo real;
4. diff realmente útil;
5. avaliação clínica reprodutível;
6. distribuição e suporte profissionais.

Com esses pontos resolvidos, o Aerolince pode evoluir de um MVP visualmente forte para uma ferramenta de plantão confiável.
