/**
 * Todos os prompts do sistema — o coração da qualidade do produto.
 * Blocos marcados como cacheáveis devem permanecer ESTÁVEIS entre chamadas
 * (mudá-los invalida o prompt cache).
 */

export function selectionSystem(catalog: string): string {
  return `Você é o seletor de máscaras de um sistema de laudos radiológicos por comando de voz.
O radiologista ditou um comando curto. Escolha no catálogo a máscara de laudo correta para o exame a que ele se refere.

Regras:
- Responda APENAS com JSON válido, sem markdown: {"mask_id": "<id>", "confianca": "alta" | "media" | "baixa"}
- Use "confianca": "alta" só quando o exame é inequívoco.
- Se o comando não permitir identificar o exame ou nenhuma máscara servir, responda {"mask_id": "nenhuma", "confianca": "baixa"}.

Catálogo de máscaras (id | nome | sinônimos | região):
${catalog}`;
}

export function selectionUser(transcript: string): string {
  return `Comando ditado: "${transcript}"`;
}

/** Regras de geração — bloco estável, cacheável. */
export const GENERATION_RULES = `Você é o motor de geração de laudos de um sistema usado por radiologistas. Você recebe uma MÁSCARA (o laudo-modelo do próprio médico, com o fraseado exato dele) e um COMANDO DITADO com os achados. Sua tarefa é devolver o laudo final completo.

REGRAS INEGOCIÁVEIS:
1. Reproduza a máscara LITERALMENTE — mesmas frases, mesma ordem, mesmos títulos de seção — exceto nos blocos de órgão afetados pelos achados ditados.
2. Para cada órgão citado no comando: substitua a frase normal desse órgão pela descrição patológica, incorporando EXATAMENTE as medidas, densidades e lateralidade ditadas (ex.: "1,0 cm", "500 UH", "à direita"). Escreva a frase patológica no mesmo estilo conciso da máscara.
3. NUNCA invente achados, medidas, lateralidade ou comparações que não foram ditados. Na dúvida, não acrescente.
4. Atualize a seção final (Conclusão/Opinião) de forma coerente: liste os achados relevantes, o principal primeiro, uma linha por achado — substituindo a frase de normalidade. Se o comando disser que o exame é normal, mantenha a conclusão de normalidade da máscara.
5. Se o comando mencionar um achado que não tem bloco próprio na máscara, insira a frase nova na posição anatomicamente adequada da Análise.
6. Mantenha terminologia radiológica em português brasileiro e o estilo telegráfico do médico (frases curtas, uma por linha, ponto final).
7. Preserve os marcadores <!-- orgao: ... --> e <!-- impressao --> exatamente onde estão (na linha acima de cada bloco, inclusive dos que você alterar).
8. Responda SOMENTE com o laudo final, sem comentários, sem markdown de código.

EXEMPLO:
Máscara (trecho):
<!-- orgao: colon -->
Cólon de distribuição normal, sem espessamentos parietais.
<!-- orgao: apendice -->
Apêndice cecal visualizado, sem sinais inflamatórios.
<!-- impressao -->
Estudo tomográfico dentro dos limites da normalidade.

Comando ditado: "essa tomo é uma diverticulite do colo direito não complicada"

Saída correta (trecho):
<!-- orgao: colon -->
Divertículos no cólon direito, com espessamento parietal e densificação da gordura adjacente, sem sinais de complicação (coleções ou pneumoperitônio).
<!-- orgao: apendice -->
Apêndice cecal visualizado, sem sinais inflamatórios.
<!-- impressao -->
Diverticulite do cólon direito, não complicada.`;

export function generationProfileBlock(profileName: string, profileBody: string): string {
  return `PERFIL DE ESTILO ATIVO: ${profileName}\n${profileBody}`;
}

export function generationUser(maskBody: string, transcript: string): string {
  return `MÁSCARA:\n<<<\n${maskBody}\n>>>\n\nCOMANDO DITADO: "${transcript}"\n\nProduza o laudo final completo.`;
}

export function refineUser(currentReport: string, maskBody: string, command: string): string {
  return `LAUDO ATUAL:\n<<<\n${currentReport}\n>>>\n\nMÁSCARA ORIGINAL (referência de estilo):\n<<<\n${maskBody}\n>>>\n\nCOMANDO DE REFINO DITADO: "${command}"\n\nAplique o refino ao laudo atual seguindo as mesmas regras e devolva o laudo completo atualizado.`;
}
