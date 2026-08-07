/**
 * Wizard de importação de acervo (Bloco 3) — 6 passos (spec §3):
 *   selecionar → processando(local) → revisar-amostras(consentimento) → custo
 *   → rodando(progresso+cancelar) → rascunhos(aplicar/descartar)
 *
 * Sem estado persistido próprio: o acervo em disco (`config.acervoDir` e
 * `_rascunhos/`) é a fonte da verdade — fechar e reabrir a janela (tray) sempre
 * parte de novo do passo 1, e o passo 6 pode ser aberto direto quando já
 * existem rascunhos pendentes de uma sessão anterior.
 *
 * Tipos vêm por INFERÊNCIA do próprio `window.aerolince` (preload) em vez de
 * duplicados aqui — evita drift entre este arquivo e `src/preload/index.ts`.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import './importar.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { iniciarTema } from '../shared/glass.js';

const api = window.aerolince;

type ResumoImportacao = Awaited<ReturnType<typeof api.acervoImportar>>;
type ClusterImportacao = ResumoImportacao['clusters'][number];
type AlvoAprendizado = Parameters<typeof api.aprendizadoEstimar>[0][number];
type EstimativaAprendizado = Awaited<ReturnType<typeof api.aprendizadoEstimar>>;
type ResultadoAprendizadoLote = Awaited<ReturnType<typeof api.aprendizadoRodar>>;
type Rascunho = Awaited<ReturnType<typeof api.rascunhosListar>>[number];
type ProgressoAcervo = Parameters<Parameters<typeof api.onAcervoProgresso>[0]>[0];
type ProgressoAprendizado = Parameters<Parameters<typeof api.onAprendizadoProgresso>[0]>[0];
type MascaraConhecida = Awaited<ReturnType<typeof api.estiloListar>>['mascaras'][number];
type AmostraSanitizada = ResumoImportacao['amostras'][number];

type Fase = 'selecionar' | 'processando' | 'revisar' | 'custo' | 'rodando' | 'rascunhos';

const ORDEM: Fase[] = ['selecionar', 'processando', 'revisar', 'custo', 'rodando', 'rascunhos'];
const TITULOS: Record<Fase, string> = {
  selecionar: 'Escolher laudos',
  processando: 'Processando localmente',
  revisar: 'Revisar amostras',
  custo: 'Custo do aprendizado',
  rodando: 'Aprendendo seu estilo',
  rascunhos: 'Revisar rascunhos',
};

/** Abaixo disso, um cluster reconhecido sem máscara ainda não vale a pena destilar. */
const MIN_LAUDOS_DESTILAR = 20;
/** Extensões aceitas no arraste — mesmo filtro do diálogo nativo (`acervo.ts`). */
const EXTENSAO_ACEITA = /\.(pdf|docx|txt)$/i;

interface AlvoPlanejado extends AlvoAprendizado {
  /** Rótulo legível (exame/cluster de origem) para as telas de custo/execução. */
  rotulo: string;
}

interface Plano {
  alvos: AlvoPlanejado[];
  fora: { rotulo: string; motivo: string }[];
  /** Laudos efetivamente cobertos por algum alvo 'aprender' (destilar+aprender do mesmo cluster contam 1x). */
  totalLaudos: number;
}

function rotuloModalidade(m: string): string {
  const nomes: Record<string, string> = { tc: 'TC', rm: 'RM', us: 'US', rx: 'RX', mg: 'MG', desconhecida: '—' };
  return nomes[m] ?? m.toUpperCase();
}

function rotuloExame(exame: string | null): string {
  return exame ? exame.replace(/-/g, ' ') : 'não reconhecido';
}

function rotuloCluster(c: ClusterImportacao): string {
  const contraste = c.contraste === 'com' ? ' (com contraste)' : '';
  return `${rotuloModalidade(c.modalidade)} ${rotuloExame(c.exame)}${contraste}`;
}

function rotuloFaseAcervo(f: ProgressoAcervo['fase']): string {
  const nomes: Record<ProgressoAcervo['fase'], string> = {
    extraindo: 'Extraindo texto…',
    classificando: 'Classificando…',
    sanitizando: 'Sanitizando (removendo dados do paciente)…',
  };
  return nomes[f];
}

/**
 * Monta os alvos de aprendizado a partir do resumo da importação + decisões do
 * médico sobre clusters não reconhecidos (passo 3 → passo 4 do spec):
 * - cluster com `maskIdExistente` → 'aprender' nessa máscara;
 * - cluster não-reconhecido roteado (dropdown) para uma máscara conhecida → idem;
 * - cluster reconhecido SEM máscara e com `quantidade >= MIN_LAUDOS_DESTILAR` →
 *   'destilar' (cria a máscara) + 'aprender' (extrai o fraseado), mesmo maskId
 *   (a própria chave do cluster, já kebab-case);
 * - o resto (não-reconhecido sem destino escolhido, ou reconhecido com poucos
 *   laudos) fica de fora, listado com o motivo.
 * Alvos 'aprender' que mirem a MESMA máscara são fundidos num só — nunca dois
 * 'aprender' escrevendo por cima do mesmo rascunho.
 */
function montarPlano(resumo: ResumoImportacao, decisoes: Record<string, string>): Plano {
  const destilar: AlvoPlanejado[] = [];
  const aprenderPorMaskId = new Map<string, { chaves: string[]; rotulos: string[]; arquivos: string[] }>();
  const fora: Plano['fora'] = [];

  function somarAprender(maskId: string, c: ClusterImportacao): void {
    const atual = aprenderPorMaskId.get(maskId) ?? { chaves: [], rotulos: [], arquivos: [] };
    atual.chaves.push(c.chave);
    atual.rotulos.push(rotuloCluster(c));
    atual.arquivos.push(...c.arquivos);
    aprenderPorMaskId.set(maskId, atual);
  }

  for (const c of resumo.clusters) {
    if (c.exame === null) {
      const escolha = decisoes[c.chave];
      if (!escolha) {
        fora.push({ rotulo: rotuloCluster(c), motivo: 'não reconhecido — deixado de fora' });
        continue;
      }
      somarAprender(escolha, c);
      continue;
    }
    if (c.maskIdExistente) {
      somarAprender(c.maskIdExistente, c);
    } else if (c.quantidade >= MIN_LAUDOS_DESTILAR) {
      destilar.push({ tipo: 'destilar', chave: c.chave, maskId: c.chave, arquivos: c.arquivos, rotulo: rotuloCluster(c) });
      somarAprender(c.chave, c);
    } else {
      fora.push({ rotulo: rotuloCluster(c), motivo: `poucos laudos (${c.quantidade}) — importe mais depois` });
    }
  }

  const aprender: AlvoPlanejado[] = [...aprenderPorMaskId].map(([maskId, v]) => ({
    tipo: 'aprender' as const,
    chave: v.chaves.join('+'),
    maskId,
    arquivos: v.arquivos,
    rotulo: v.rotulos.join(', '),
  }));

  const totalLaudos = aprender.reduce((soma, a) => soma + a.arquivos.length, 0);
  return { alvos: [...destilar, ...aprender], fora, totalLaudos };
}

/**
 * Amostras sanitizadas + checkbox de consentimento — usado na fase "revisar" da importação
 * normal E na fase "custo" do Reaprender quando o corpus inclui histórico editado (I3): o
 * médico nunca viu nem autorizou explicitamente o envio desse corpus específico antes (ao
 * contrário do acervo, já consentido na importação original). Texto e comportamento IDÊNTICOS
 * nos dois lugares — um único componente evita que os dois textos divirjam com o tempo.
 */
function AmostrasConsentimento({
  amostras,
  consentimento,
  onConsentimentoChange,
}: {
  amostras: AmostraSanitizada[];
  consentimento: boolean;
  onConsentimentoChange: (v: boolean) => void;
}) {
  return (
    <>
      <div className="secao">
        <h2>Amostras sanitizadas (revise antes de autorizar)</h2>
        <div className="imp-amostras">
          {amostras.map((a) => (
            <div className="imp-amostra" key={a.arquivo}>
              <div className="imp-amostra-nome">{a.arquivo}</div>
              <pre>{a.texto}</pre>
            </div>
          ))}
          {amostras.length === 0 && (
            <div className="desc">Nenhuma amostra disponível (nenhum arquivo foi gravado no acervo).</div>
          )}
        </div>
      </div>
      <div className="imp-consent">
        <input
          id="consentimento"
          type="checkbox"
          checked={consentimento}
          onChange={(e) => onConsentimentoChange(e.target.checked)}
        />
        <label htmlFor="consentimento">
          Revisei as amostras acima; autorizo o envio do texto anonimizado para a minha chave de API para
          aprendizado do meu estilo.
        </label>
      </div>
    </>
  );
}

function App() {
  const [fase, setFase] = useState<Fase>('selecionar');

  // Reaprender (T7): `?modo=reaprender` na URL (ver `abrirImportar` em main/index.ts) pula
  // direto para a etapa de custo com alvos montados no main (acervo + histórico editado) —
  // nenhum passo de seleção/consentimento aqui, o médico já autorizou isso ao importar.
  const [modoReaprender, setModoReaprender] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get('modo') === 'reaprender',
  );
  const [carregandoReaprender, setCarregandoReaprender] = useState(false);
  const [erroReaprender, setErroReaprender] = useState<string | null>(null);
  // I3: o corpus do Reaprender inclui histórico editado → exige o MESMO consentimento da
  // importação normal (amostras + checkbox) antes de liberar "Aprender meu estilo", porque
  // esse corpus específico nunca passou pela revisão do médico nesta janela.
  const [precisaConsentimentoReaprender, setPrecisaConsentimentoReaprender] = useState(false);
  const [amostrasReaprender, setAmostrasReaprender] = useState<AmostraSanitizada[]>([]);

  // Passo 1 — seleção
  const [arquivos, setArquivos] = useState<string[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [rascunhosPendentes, setRascunhosPendentes] = useState(0);

  // Passo 2 — processando
  const [progressoAcervo, setProgressoAcervo] = useState<ProgressoAcervo | null>(null);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);

  // Passo 3 — revisar amostras + consentimento
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, string>>({});
  const [consentimento, setConsentimento] = useState(false);
  const [mascarasConhecidas, setMascarasConhecidas] = useState<MascaraConhecida[]>([]);

  // Passo 4 — custo
  const [plano, setPlano] = useState<Plano | null>(null);
  const [estimativa, setEstimativa] = useState<EstimativaAprendizado | null>(null);
  const [estimando, setEstimando] = useState(false);
  const [erroEstimativa, setErroEstimativa] = useState<string | null>(null);

  // Passo 5 — rodando
  const [progressoAprendizado, setProgressoAprendizado] = useState<Record<string, ProgressoAprendizado>>({});
  const [resultadoLote, setResultadoLote] = useState<ResultadoAprendizadoLote | null>(null);
  const [erroRodar, setErroRodar] = useState<string | null>(null);

  // Passo 6 — rascunhos
  const [rascunhos, setRascunhos] = useState<Rascunho[] | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    void iniciarTema();
    void (async () => {
      try {
        setMascarasConhecidas((await api.estiloListar()).mascaras);
      } catch {
        /* segue sem a lista — dropdown de não-reconhecidos fica só com "deixar de fora" */
      }
    })();
    void atualizarContadorRascunhos();
    api.onAcervoProgresso((p) => setProgressoAcervo(p));
    api.onAprendizadoProgresso((p) => setProgressoAprendizado((s) => ({ ...s, [p.chave]: p })));
    if (modoReaprender) void iniciarReaprender();
  }, []);

  // ── Reaprender (T7) ──────────────────────────────────────────────────────
  async function iniciarReaprender(): Promise<void> {
    setCarregandoReaprender(true);
    setErroReaprender(null);
    try {
      const [resumoAlvos, estilo] = await Promise.all([api.reaprenderMontarAlvos(), api.estiloListar()]);
      const nomePorId = new Map(estilo.mascaras.map((m) => [m.id, m.nome]));
      const alvos: AlvoPlanejado[] = resumoAlvos.alvos.map((a) => ({ ...a, rotulo: nomePorId.get(a.maskId) ?? a.maskId }));
      const fora = resumoAlvos.semArquivos.map((s) => ({
        rotulo: nomePorId.get(s.maskId) ?? s.nome,
        motivo: 'sem laudos no acervo nem no histórico editado ainda',
      }));
      const totalLaudos = alvos.reduce((soma, a) => soma + a.arquivos.length, 0);
      const p: Plano = { alvos, fora, totalLaudos };
      setPlano(p);
      // I3: só exige o passo de consentimento quando o corpus de fato inclui histórico editado
      // — se for só acervo, o médico já autorizou esse mesmo texto na importação original.
      setPrecisaConsentimentoReaprender(resumoAlvos.temHistorico);
      setAmostrasReaprender(resumoAlvos.amostras);
      setConsentimento(false);
      setFase('custo');
      await buscarEstimativa(p.alvos);
    } catch (e) {
      setErroReaprender(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregandoReaprender(false);
    }
  }

  async function atualizarContadorRascunhos(): Promise<void> {
    try {
      setRascunhosPendentes((await api.rascunhosListar()).length);
    } catch {
      /* banner é só um atalho — falha aqui não trava a tela */
    }
  }

  // ── Passo 1 ──────────────────────────────────────────────────────────────
  function adicionarArquivos(novos: string[]): void {
    setArquivos((atual) => [...new Set([...atual, ...novos])]);
  }
  function removerArquivo(caminho: string): void {
    setArquivos((atual) => atual.filter((a) => a !== caminho));
  }
  async function escolherArquivos(): Promise<void> {
    const r = await api.acervoEscolherArquivos();
    if (r) adicionarArquivos(r);
  }
  function onDragOver(e: React.DragEvent): void {
    e.preventDefault();
    setArrastando(true);
  }
  function onDragLeave(): void {
    setArrastando(false);
  }
  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setArrastando(false);
    const novos: string[] = [];
    for (const file of Array.from(e.dataTransfer.files)) {
      const caminho = api.caminhoDeArquivo(file);
      if (caminho && EXTENSAO_ACEITA.test(caminho)) novos.push(caminho);
    }
    if (novos.length > 0) adicionarArquivos(novos);
  }
  async function iniciarProcessamento(): Promise<void> {
    setFase('processando');
    setErroImportacao(null);
    setProgressoAcervo(null);
    try {
      const r = await api.acervoImportar(arquivos);
      setResumo(r);
      setFase('revisar');
    } catch (e) {
      setErroImportacao(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Passo 3 → 4 ──────────────────────────────────────────────────────────
  async function buscarEstimativa(alvos: AlvoPlanejado[]): Promise<void> {
    setEstimativa(null);
    setErroEstimativa(null);
    if (alvos.length === 0) return;
    setEstimando(true);
    try {
      setEstimativa(await api.aprendizadoEstimar(alvos));
    } catch (e) {
      setErroEstimativa(e instanceof Error ? e.message : String(e));
    } finally {
      setEstimando(false);
    }
  }
  async function continuarParaCusto(): Promise<void> {
    if (!resumo) return;
    const p = montarPlano(resumo, decisoes);
    setPlano(p);
    setFase('custo');
    await buscarEstimativa(p.alvos);
  }

  // ── Passo 4 → 5 ──────────────────────────────────────────────────────────
  async function iniciarAprendizado(): Promise<void> {
    if (!plano) return;
    setFase('rodando');
    setErroRodar(null);
    setResultadoLote(null);
    setProgressoAprendizado({});
    try {
      setResultadoLote(await api.aprendizadoRodar(plano.alvos));
    } catch (e) {
      // aprendizadoRodar rejeita a promise em falha de chave/zod (gate BYOK) — a
      // mensagem de exigirChaves já é acionável ("abra Configurações → Chaves de API").
      setErroRodar(e instanceof Error ? e.message : String(e));
    }
  }
  async function cancelar(): Promise<void> {
    try {
      await api.aprendizadoCancelar();
    } catch {
      /* cancelamento é best-effort — o lote em andamento resolve normalmente (parcial) */
    }
  }

  // ── Passo 5 → 6 ──────────────────────────────────────────────────────────
  async function abrirRascunhos(): Promise<void> {
    setFase('rascunhos');
    try {
      setRascunhos(await api.rascunhosListar());
    } catch {
      setRascunhos([]);
    }
  }
  async function alternarPreview(arquivo: string): Promise<void> {
    const estaAberto = abertos.has(arquivo);
    const novo = new Set(abertos);
    if (estaAberto) novo.delete(arquivo);
    else novo.add(arquivo);
    setAbertos(novo);
    if (!estaAberto && previews[arquivo] === undefined) {
      try {
        const texto = await api.rascunhoLer(arquivo);
        setPreviews((s) => ({ ...s, [arquivo]: texto }));
      } catch (e) {
        setPreviews((s) => ({ ...s, [arquivo]: `(erro ao ler: ${e instanceof Error ? e.message : String(e)})` }));
      }
    }
  }
  async function aplicarRascunho(arquivo: string): Promise<void> {
    try {
      await api.rascunhoAplicar(arquivo);
      setRascunhos((s) => s?.filter((r) => r.arquivo !== arquivo) ?? s);
    } catch (e) {
      window.alert(`Não foi possível aplicar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  async function descartarRascunho(arquivo: string): Promise<void> {
    if (!window.confirm('Descartar este rascunho? Não dá para desfazer — você pode gerar de novo depois.')) return;
    try {
      await api.rascunhoDescartar(arquivo);
      setRascunhos((s) => s?.filter((r) => r.arquivo !== arquivo) ?? s);
    } catch (e) {
      window.alert(`Não foi possível descartar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function recomecar(): void {
    // Sai do Reaprender (se veio de lá) — "recomeçar" sempre volta ao passo 1 normal
    // (seleção de arquivos), nunca reabre o carregamento automático do Reaprender.
    setModoReaprender(false);
    setErroReaprender(null);
    setCarregandoReaprender(false);
    setPrecisaConsentimentoReaprender(false);
    setAmostrasReaprender([]);
    setFase('selecionar');
    setArquivos([]);
    setErroImportacao(null);
    setProgressoAcervo(null);
    setResumo(null);
    setDecisoes({});
    setConsentimento(false);
    setPlano(null);
    setEstimativa(null);
    setErroEstimativa(null);
    setProgressoAprendizado({});
    setResultadoLote(null);
    setErroRodar(null);
    setRascunhos(null);
    setAbertos(new Set());
    setPreviews({});
    void atualizarContadorRascunhos();
  }

  const emAndamento = fase === 'rodando' && !resultadoLote && !erroRodar;
  const passoAtual = ORDEM.indexOf(fase) + 1;

  return (
    <div className="janela">
      <div className="topo">
        <img src={logoUrl} alt="Aerolince" className="logo" />
        <h1>{modoReaprender ? 'Reaprender com meus laudos' : 'Importar meus laudos'}</h1>
        {!modoReaprender && (
          <span className="imp-passo" style={{ marginLeft: 'auto' }}>
            Passo {passoAtual} de {ORDEM.length} · {TITULOS[fase]}
          </span>
        )}
      </div>

      <div className="corpo">
        {fase === 'selecionar' && modoReaprender && (
          <div className="imp-progresso-wrap">
            {erroReaprender ? (
              <div className="imp-erro">Não foi possível montar os alvos do Reaprender: {erroReaprender}</div>
            ) : (
              <div className="imp-vazio">Reunindo seus laudos (acervo importado + histórico editado)…</div>
            )}
          </div>
        )}
        {fase === 'selecionar' && !modoReaprender && (
          <>
            {rascunhosPendentes > 0 && (
              <div className="imp-banner">
                <span>Você tem {rascunhosPendentes} rascunho(s) de aprendizado pendente(s) de revisão.</span>
                <button onClick={abrirRascunhos}>Ver rascunhos</button>
              </div>
            )}
            <div
              className={`imp-drop${arrastando ? ' arrastando' : ''}`}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <div>Arraste seus laudos (PDF, Word ou texto) aqui</div>
              <button onClick={escolherArquivos}>Escolher arquivos ou pasta…</button>
            </div>
            {arquivos.length > 0 && (
              <>
                <div className="desc" style={{ marginBottom: 6 }}>
                  {arquivos.length} arquivo(s) selecionado(s)
                </div>
                <ul className="imp-lista">
                  {arquivos.map((a) => (
                    <li key={a}>
                      <span className="imp-nome" title={a}>
                        {a.split('/').pop()}
                      </span>
                      <button className="fantasma" onClick={() => removerArquivo(a)} title="Remover">
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {fase === 'processando' && (
          <div className="imp-progresso-wrap">
            {erroImportacao ? (
              <div className="imp-erro">{erroImportacao}</div>
            ) : (
              <>
                <div className="imp-progresso-fase">
                  {progressoAcervo ? rotuloFaseAcervo(progressoAcervo.fase) : 'Preparando…'}
                </div>
                {progressoAcervo && (
                  <>
                    <div className="imp-barra">
                      <div
                        style={{
                          width: `${Math.round((progressoAcervo.atual / Math.max(1, progressoAcervo.total)) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="desc">
                      {progressoAcervo.atual} / {progressoAcervo.total}
                    </div>
                    {progressoAcervo.arquivo && <div className="imp-progresso-arquivo">{progressoAcervo.arquivo}</div>}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {fase === 'revisar' && resumo && (
          <>
            <table className="imp-tabela">
              <thead>
                <tr>
                  <th>Exame</th>
                  <th>Qtd.</th>
                  <th>Máscara</th>
                </tr>
              </thead>
              <tbody>
                {resumo.clusters.map((c) => (
                  <tr key={c.chave}>
                    <td>{rotuloCluster(c)}</td>
                    <td>{c.quantidade}</td>
                    <td>
                      {c.exame === null ? (
                        <select
                          value={decisoes[c.chave] ?? ''}
                          onChange={(e) => setDecisoes((s) => ({ ...s, [c.chave]: e.target.value }))}
                        >
                          <option value="">Deixar de fora</option>
                          {mascarasConhecidas.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.nome}
                            </option>
                          ))}
                        </select>
                      ) : c.maskIdExistente ? (
                        <span className="imp-badge ok">já tenho: {c.maskIdExistente}</span>
                      ) : c.quantidade >= MIN_LAUDOS_DESTILAR ? (
                        <span className="imp-badge">nova máscara</span>
                      ) : (
                        <span className="desc">poucos laudos</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {resumo.semTexto.length > 0 && (
              <div className="desc" style={{ padding: '4px 14px' }}>
                {resumo.semTexto.length} arquivo(s) sem texto útil (imagem ou formato não suportado):{' '}
                {resumo.semTexto.slice(0, 5).join(', ')}
                {resumo.semTexto.length > 5 ? `, +${resumo.semTexto.length - 5}` : ''}
              </div>
            )}
            {resumo.suspeitos > 0 && (
              <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>
                ⚠ {resumo.suspeitos} arquivo(s) tinham nome de paciente no NOME do arquivo, mas nenhum dado foi
                encontrado no texto — confira as amostras abaixo com atenção.
              </div>
            )}

            <AmostrasConsentimento
              amostras={resumo.amostras}
              consentimento={consentimento}
              onConsentimentoChange={setConsentimento}
            />
          </>
        )}

        {fase === 'custo' && plano && (
          <>
            {/* I3: corpus do Reaprender inclui histórico editado, nunca revisado nesta janela
                (ao contrário do acervo, já consentido na importação original) — mesmas amostras
                e checkbox da fase "revisar", bloqueando "Aprender meu estilo" até marcar. */}
            {modoReaprender && precisaConsentimentoReaprender && plano.alvos.length > 0 && (
              <AmostrasConsentimento
                amostras={amostrasReaprender}
                consentimento={consentimento}
                onConsentimentoChange={setConsentimento}
              />
            )}
            {plano.alvos.length === 0 ? (
              <div className="imp-vazio">
                {modoReaprender
                  ? 'Nenhuma das suas máscaras tem laudos no acervo ou no histórico editado ainda — importe laudos primeiro.'
                  : 'Nada para aprender nesta leva — importe mais laudos ou reconheça mais clusters na etapa anterior.'}
              </div>
            ) : erroEstimativa ? (
              <div className="imp-erro">
                Não foi possível estimar o custo: {erroEstimativa}
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => buscarEstimativa(plano.alvos)}>Tentar de novo</button>
                </div>
              </div>
            ) : estimando ? (
              <div className="imp-vazio">Calculando o custo…</div>
            ) : (
              <>
                {plano.alvos.map((a, i) => {
                  const custo = estimativa?.porAlvo[i]?.custoAproxUSD;
                  return (
                    <div className="linha imp-alvo" key={`${a.tipo}-${a.maskId}-${i}`}>
                      <div>
                        <div className="imp-alvo-rot">
                          {a.tipo === 'destilar' ? 'Criar máscara' : 'Aprender fraseado'}: {a.maskId}
                        </div>
                        <div className="imp-alvo-sub">
                          {a.rotulo} · {a.arquivos.length} laudo(s)
                        </div>
                      </div>
                      <div className="imp-alvo-custo">{custo != null ? `~US$ ${custo.toFixed(2)}` : '—'}</div>
                    </div>
                  );
                })}
                <div className="imp-total">
                  {estimativa?.totalUSD != null
                    ? `Aprender com seus ${plano.totalLaudos} laudos custará ~US$ ${estimativa.totalUSD.toFixed(2)}`
                    : `Aprender com seus ${plano.totalLaudos} laudos — custo total indisponível para 1 ou mais alvos`}
                </div>
              </>
            )}
            {plano.fora.length > 0 && (
              <div className="secao">
                <h2>Ficam de fora desta importação</h2>
                <ul className="imp-fora">
                  {plano.fora.map((f, i) => (
                    <li key={i}>
                      {f.rotulo} — {f.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {fase === 'rodando' && plano && (
          <>
            {erroRodar && <div className="imp-erro">{erroRodar}</div>}
            {plano.alvos.map((a, i) => {
              const p = progressoAprendizado[a.chave];
              const ok = resultadoLote?.ok.find((r) => r.chave === a.chave);
              const falha = resultadoLote?.falhas.find((r) => r.chave === a.chave);
              // O resultado final (ok/falha) é a fonte de verdade sobre o desfecho — o
              // último evento de progresso recebido ("gravando rascunho") não distingue
              // sucesso de cancelamento a meio do caminho.
              const status = falha
                ? `falhou: ${falha.erro}`
                : ok
                  ? 'concluído'
                  : p
                    ? `${p.etapa} (${p.atual}/${p.total})`
                    : resultadoLote
                      ? 'cancelado antes de começar'
                      : 'aguardando…';
              return (
                <div className="linha imp-alvo" key={`${a.tipo}-${a.maskId}-${i}`}>
                  <div>
                    <div className="imp-alvo-rot">
                      {a.tipo === 'destilar' ? 'Criar máscara' : 'Aprender fraseado'}: {a.maskId}
                    </div>
                    <div className="imp-alvo-sub">{status}</div>
                  </div>
                </div>
              );
            })}
            {resultadoLote && (
              <div className="imp-resumo-final">
                <div>
                  <span className="ok">{resultadoLote.ok.length} aprendido(s)</span>
                  {resultadoLote.falhas.length > 0 && (
                    <>
                      {' '}
                      · <span className="falha">{resultadoLote.falhas.length} falha(s)</span>
                    </>
                  )}
                </div>
                {resultadoLote.falhas.map((f, i) => (
                  <div key={i} className="desc">
                    {f.chave}: {f.erro}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {fase === 'rascunhos' && (
          <>
            <div className="desc" style={{ marginBottom: 12 }}>
              Aplicar coloca na SUA biblioteca — a partir do próximo laudo o app usa o seu fraseado.
            </div>
            {rascunhos === null ? (
              <div className="imp-vazio">Carregando…</div>
            ) : rascunhos.length === 0 ? (
              <div className="imp-vazio">Nenhum rascunho pendente.</div>
            ) : (
              rascunhos.map((r) => (
                <div className="imp-rascunho" key={r.arquivo}>
                  <div className="imp-rascunho-cab">
                    <div className="imp-rascunho-rot">
                      {r.tipo === 'mascara' ? 'Máscara' : 'Regras'}: {r.alvo}
                    </div>
                    <div className="imp-rascunho-botoes">
                      <button onClick={() => alternarPreview(r.arquivo)}>
                        {abertos.has(r.arquivo) ? 'Ocultar' : 'Ver'}
                      </button>
                      <button className="primario" onClick={() => aplicarRascunho(r.arquivo)}>
                        Aplicar
                      </button>
                      <button className="fantasma" onClick={() => descartarRascunho(r.arquivo)}>
                        Descartar
                      </button>
                    </div>
                  </div>
                  {abertos.has(r.arquivo) && <pre>{previews[r.arquivo] ?? 'Carregando…'}</pre>}
                </div>
              ))
            )}
          </>
        )}
      </div>

      <div className="rodape-janela">
        {fase === 'selecionar' && modoReaprender && erroReaprender && (
          <button className="primario" onClick={() => void iniciarReaprender()} disabled={carregandoReaprender}>
            Tentar de novo
          </button>
        )}
        {fase === 'selecionar' && !modoReaprender && (
          <>
            <span className="dica">Extração e classificação são 100% locais — nada sai do seu computador aqui.</span>
            <button className="primario" onClick={iniciarProcessamento} disabled={arquivos.length === 0}>
              Continuar
            </button>
          </>
        )}
        {fase === 'processando' && (
          <span className="dica">
            {erroImportacao ? '' : 'Fechar esta janela cancela a importação (nada é perdido — tente de novo depois).'}
          </span>
        )}
        {fase === 'processando' && erroImportacao && (
          <button onClick={() => setFase('selecionar')}>Voltar</button>
        )}
        {fase === 'revisar' && (
          <>
            <button className="fantasma" onClick={recomecar}>
              Começar de novo
            </button>
            <button className="primario" onClick={continuarParaCusto} disabled={!consentimento}>
              Continuar
            </button>
          </>
        )}
        {fase === 'custo' && plano && (
          <>
            <button className="fantasma" onClick={() => (modoReaprender ? recomecar() : setFase('revisar'))}>
              {modoReaprender ? 'Importar laudos novos em vez disso' : 'Voltar'}
            </button>
            <button
              className="primario"
              onClick={iniciarAprendizado}
              disabled={
                plano.alvos.length === 0 ||
                estimando ||
                !!erroEstimativa ||
                (modoReaprender && precisaConsentimentoReaprender && !consentimento)
              }
            >
              Aprender meu estilo
            </button>
          </>
        )}
        {fase === 'rodando' && (
          <>
            {emAndamento && <button onClick={cancelar}>Cancelar</button>}
            {erroRodar && (
              <>
                <button onClick={() => setFase('custo')}>Voltar</button>
                <button onClick={() => api.abrir('settings')}>Abrir Configurações</button>
              </>
            )}
            {resultadoLote && (
              <button className="primario" onClick={abrirRascunhos}>
                Ver rascunhos
              </button>
            )}
          </>
        )}
        {fase === 'rascunhos' && (
          <>
            <button className="fantasma" onClick={recomecar}>
              Importar mais laudos
            </button>
            <button className="primario" onClick={() => window.close()}>
              Concluir
            </button>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
