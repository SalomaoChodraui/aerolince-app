import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { aplicarGlass } from '../shared/glass.js';
import { ChavesApi } from '../shared/ChavesApi.js';
import type { Macro, RendererConfig, SecaoLaudo } from '../shared/types.js';

const api = window.aerolince;

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="trilho" />
    </label>
  );
}

/** Nome amigável de cada seção do laudo na tela (o rótulo em si é editável). */
const NOME_SECAO: Record<string, string> = {
  titulo: 'Título',
  tecnica: 'Técnica',
  indicacao: 'Indicação',
  achados: 'Achados / descrição',
  'achados-adicionais': 'Achados adicionais',
  conclusao: 'Conclusão',
  observacao: 'Observação',
};

function App() {
  const [cfg, setCfg] = useState<RendererConfig | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = (await api.configGet()) as RendererConfig;
      setCfg(c);
      aplicarGlass(c);
    })();
  }, []);

  if (!cfg) return null;

  async function patchUI(patch: Partial<RendererConfig['ui']>) {
    const c = (await api.configSet({ ui: patch })) as RendererConfig;
    setCfg(c);
    aplicarGlass(c);
    flashSalvo();
  }
  async function patchRoot(patch: Partial<RendererConfig>) {
    const c = (await api.configSet(patch)) as RendererConfig;
    setCfg(c);
    flashSalvo();
  }
  async function patchStt(patch: Partial<RendererConfig['stt']>) {
    const c = (await api.configSet({ stt: patch })) as RendererConfig;
    setCfg(c);
    flashSalvo();
  }
  async function patchHistorico(patch: Partial<RendererConfig['historico']>) {
    const c = (await api.configSet({ historico: patch })) as RendererConfig;
    setCfg(c);
    flashSalvo();
  }
  async function patchLlm(patch: Partial<RendererConfig['llm']>) {
    const c = (await api.configSet({ llm: patch })) as RendererConfig;
    setCfg(c);
    flashSalvo();
  }
  async function patchLaudo(patch: Partial<RendererConfig['laudo']>) {
    const c = (await api.configSet({ laudo: patch })) as RendererConfig;
    setCfg(c);
    flashSalvo();
  }
  /** Persiste as seções com UMA alterada (switch/rótulo). */
  function salvarSecao(id: string, campo: Partial<SecaoLaudo>) {
    return patchLaudo({ secoes: cfg!.laudo.secoes.map((s) => (s.id === id ? { ...s, ...campo } : s)) });
  }
  /** Edição local do rótulo (sem persistir a cada tecla — persiste no onBlur). */
  function editarRotuloLocal(id: string, rotulo: string) {
    setCfg({
      ...cfg!,
      laudo: { ...cfg!.laudo, secoes: cfg!.laudo.secoes.map((s) => (s.id === id ? { ...s, rotulo } : s)) },
    });
  }
  function flashSalvo() {
    setSalvo(true);
    setTimeout(() => setSalvo(false), 1200);
  }

  async function addMacro() {
    const id = `m${cfg!.macros.length + 1}-${Date.now().toString(36)}`;
    await patchRoot({ macros: [...cfg!.macros, { id, nome: 'Novo atalho', comando: '' }] });
  }
  async function editMacro(id: string, campo: keyof Macro, valor: string) {
    await patchRoot({ macros: cfg!.macros.map((m) => (m.id === id ? { ...m, [campo]: valor } : m)) });
  }
  async function delMacro(id: string) {
    await patchRoot({ macros: cfg!.macros.filter((m) => m.id !== id) });
  }

  async function escolher(campo: 'masksDir' | 'outputDir') {
    const p = await api.escolherPasta();
    if (p) await patchRoot({ [campo]: p } as Partial<RendererConfig>);
  }

  return (
    <div className="janela">
      <div className="topo">
        <img src={logoUrl} alt="Aerolince" className="logo" />
        <h1>Configurações</h1>
        <span className="sub" style={{ marginLeft: 'auto', opacity: salvo ? 1 : 0, transition: 'opacity .2s' }}>
          ✓ salvo
        </span>
      </div>

      <div className="corpo">
        <div className="secao">
          <h2>Aparência</h2>
          <div className="linha">
            <div>
              <div className="rot">Tema</div>
              <div className="desc">Segue o sistema, ou fixe claro/escuro</div>
            </div>
            <select
              className="ctrl"
              value={cfg.ui.tema}
              onChange={(e) => patchUI({ tema: e.target.value as RendererConfig['ui']['tema'] })}
            >
              <option value="auto">Automático (sistema)</option>
              <option value="claro">Claro</option>
              <option value="escuro">Escuro</option>
            </select>
          </div>
          <div className="linha">
            <div>
              <div className="rot">Efeito liquid glass</div>
              <div className="desc">Janelas translúcidas com desfoque (requer reabrir as janelas)</div>
            </div>
            <Switch on={cfg.ui.liquidGlass} onChange={(v) => patchUI({ liquidGlass: v })} />
          </div>
          <div className="linha">
            <div>
              <div className="rot">Transparência do botão flutuante</div>
              <div className="desc">{Math.round(cfg.ui.opacidadeBalao * 100)}% de opacidade</div>
            </div>
            <input
              className="ctrl"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={cfg.ui.opacidadeBalao}
              onChange={(e) => patchUI({ opacidadeBalao: Number(e.target.value) })}
            />
          </div>
          <div className="linha">
            <div>
              <div className="rot">Atalho global de ditado</div>
              <div className="desc">Ex.: CommandOrControl+Shift+D</div>
            </div>
            <input
              className="ctrl"
              type="text"
              value={cfg.ui.atalho}
              onChange={(e) => setCfg({ ...cfg, ui: { ...cfg.ui, atalho: e.target.value } })}
              onBlur={(e) => patchUI({ atalho: e.target.value })}
              style={{ width: 200 }}
            />
          </div>
        </div>

        <div className="secao">
          <h2>Motor de geração</h2>
          <div className="linha">
            <div>
              <div className="rot">Quem escreve os laudos</div>
              <div className="desc">
                {cfg.llm.provider === 'anthropic'
                  ? 'Claude gera os laudos; OpenAI transcreve a voz. Precisa das duas chaves.'
                  : 'A OpenAI transcreve a voz E gera os laudos. Precisa só da chave OpenAI.'}
              </div>
            </div>
            <select
              className="ctrl"
              value={cfg.llm.provider}
              onChange={(e) => {
                const p = e.target.value as RendererConfig['llm']['provider'];
                void patchLlm(
                  p === 'openai'
                    ? { provider: p, selectionModel: 'gpt-5-mini', generationModel: 'gpt-5-mini', fastModel: 'gpt-5-mini' }
                    : { provider: p, selectionModel: 'claude-haiku-4-5', generationModel: 'claude-haiku-4-5', fastModel: 'claude-haiku-4-5' },
                );
              }}
            >
              <option value="anthropic">OpenAI + Anthropic (recomendado)</option>
              <option value="openai">Só OpenAI</option>
            </select>
          </div>
        </div>

        <div className="secao">
          <h2>Chaves de API</h2>
          <ChavesApi provider={cfg.llm.provider} onAcao={flashSalvo} />
        </div>

        <div className="secao">
          <h2>Meus atalhos de laudo</h2>
          <div className="desc" style={{ marginBottom: 8 }}>
            Comandos prontos que você aciona sem ditar — ex.: “abdome feminino padrão, com colecistectomia”.
          </div>
          {cfg.macros.map((m) => (
            <div className="linha" key={m.id}>
              <input
                type="text"
                value={m.nome}
                onChange={(e) => editMacro(m.id, 'nome', e.target.value)}
                style={{ width: 150 }}
              />
              <input
                type="text"
                value={m.comando}
                placeholder="comando ditado equivalente"
                onChange={(e) => editMacro(m.id, 'comando', e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="fantasma" onClick={() => delMacro(m.id)} title="Remover">
                ✕
              </button>
            </div>
          ))}
          <button onClick={addMacro}>+ Novo atalho</button>
        </div>

        <div className="secao">
          <h2>Formato do laudo</h2>
          <div className="linha">
            <div>
              <div className="rot">Parágrafos da descrição</div>
              <div className="desc">Como as frases do laudo são separadas no texto final</div>
            </div>
            <select
              className="ctrl"
              value={cfg.laudo.paragrafo}
              onChange={(e) => patchLaudo({ paragrafo: e.target.value as RendererConfig['laudo']['paragrafo'] })}
            >
              <option value="por-bloco">Um parágrafo por achado (atual)</option>
              <option value="corrido">Texto corrido, uma frase por linha</option>
            </select>
          </div>
          <div className="desc" style={{ marginBottom: 8 }}>
            Seções do laudo, na ordem do texto. O interruptor controla o que o app cria/oferece: seção desligada só
            fica de fora quando está vazia — o que você ditou nunca some do laudo. Indicação e Observação são
            preenchidas por voz (“indicação: …”, “observação: …”/“nota: …”).
          </div>
          {cfg.laudo.secoes.map((s) => (
            <div className="linha" key={s.id}>
              <div className="rot" style={{ width: 160 }}>{NOME_SECAO[s.id] ?? s.id}</div>
              {s.id === 'titulo' ? (
                <span className="desc" style={{ flex: 1 }}>primeira linha do laudo (sem rótulo)</span>
              ) : (
                <input
                  type="text"
                  value={s.rotulo}
                  onChange={(e) => editarRotuloLocal(s.id, e.target.value)}
                  onBlur={(e) => salvarSecao(s.id, { rotulo: e.target.value })}
                  style={{ flex: 1 }}
                />
              )}
              <Switch on={s.ativa} onChange={(v) => salvarSecao(s.id, { ativa: v })} />
            </div>
          ))}
          <div className="desc" style={{ padding: '4px 14px' }}>
            Rótulos que o laudo já traz (ex.: “Opinião:” no crânio) são respeitados enquanto você não editar o rótulo
            acima. Exceções por exame (ex.: crânio com “Opinião:”/“Nota:”) podem ser definidas em laudo.porExame no
            laudo.config.json.
          </div>
        </div>

        <div className="secao">
          <h2>Pastas e modelos</h2>
          <div className="linha">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rot">Minha biblioteca (aprendida)</div>
              <div className="desc" style={{ wordBreak: 'break-all' }}>{cfg.masksDir}</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.masksDir)}>Abrir</button>
            <button onClick={() => escolher('masksDir')}>Trocar…</button>
          </div>
          <div className="linha">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rot">Biblioteca base (do app)</div>
              <div className="desc" style={{ wordBreak: 'break-all' }}>{cfg.bibliotecaBaseDir}</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.bibliotecaBaseDir)}>Abrir</button>
          </div>
          <div className="linha">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rot">Laudos gerados</div>
              <div className="desc" style={{ wordBreak: 'break-all' }}>{cfg.outputDir}</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.outputDir)}>Abrir</button>
            <button onClick={() => escolher('outputDir')}>Trocar…</button>
          </div>
          <div className="linha">
            <div>
              <div className="rot">Editar minhas frases padrão</div>
              <div className="desc">Abre a sua biblioteca — edite os arquivos .md em qualquer editor. Alterações aqui valem para você: quando o id coincide com o da biblioteca base, a sua versão substitui a base.</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.masksDir)}>Abrir pasta</button>
          </div>
        </div>

        <div className="secao">
          <h2>Ditado</h2>
          <div className="linha">
            <div>
              <div className="rot">Captura de voz</div>
            </div>
            <select
              className="ctrl"
              value={cfg.stt.captura}
              onChange={(e) => patchStt({ captura: e.target.value as RendererConfig['stt']['captura'] })}
            >
              <option value="segmentada">Segmentada (recomendado)</option>
              <option value="classica">Clássica</option>
            </select>
          </div>
          <div className="linha">
            <div>
              <div className="rot">Pausa que fecha o trecho (s)</div>
            </div>
            <input
              className="ctrl"
              type="number"
              min={0.4}
              max={5}
              step={0.1}
              value={cfg.stt.pausaMs / 1000}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value === '' || !Number.isFinite(v)) return; // digitação em andamento: mantém o valor salvo, não tenta gravar
                void patchStt({ pausaMs: Math.min(5000, Math.max(400, Math.round(v * 1000))) }); // clamp: digitação fora do range nunca falha no zod
              }}
            />
          </div>
          <div className="linha">
            <div>
              <div className="rot">Sensibilidade do microfone</div>
              <div className="desc">
                Alta: capta voz baixa ou microfone distante (pode pegar ruído). Média: padrão. Baixa: ambiente ruidoso.
              </div>
            </div>
            <select
              className="ctrl"
              value={cfg.stt.sensibilidadeVad}
              onChange={(e) => patchStt({ sensibilidadeVad: e.target.value as RendererConfig['stt']['sensibilidadeVad'] })}
            >
              <option value="alta">Alta (voz baixa / mic distante)</option>
              <option value="media">Média (padrão)</option>
              <option value="baixa">Baixa (ambiente ruidoso)</option>
            </select>
          </div>
          <div className="desc" style={{ padding: '4px 14px' }}>
            Na captura segmentada, só os trechos com fala são enviados para transcrição.
          </div>
        </div>

        <div className="secao">
          <h2>Histórico</h2>
          <div className="linha">
            <div>
              <div className="rot">Manter laudos por (dias — 0 = sempre)</div>
              <div className="desc">Ao abrir o app, laudos mais antigos que isso são apagados. 0 mantém tudo.</div>
            </div>
            <input
              className="ctrl"
              type="number"
              min={0}
              max={3650}
              step={1}
              value={cfg.historico.retencaoDias}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (e.target.value === '' || !Number.isFinite(v)) return; // digitação em andamento: mantém o valor salvo, não tenta gravar
                void patchHistorico({ retencaoDias: Math.min(3650, Math.max(0, Math.round(v))) }); // clamp: digitação fora do range nunca falha no zod
              }}
            />
          </div>
        </div>
      </div>

      <div className="rodape-janela">
        <span className="dica">As mudanças são salvas automaticamente.</span>
        <button onClick={() => api.abrir('onboarding')}>Ver guia rápido</button>
        <button onClick={() => api.abrir('historico')}>Histórico de laudos</button>
        <button onClick={() => api.abrir('estilo')}>Meu estilo</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
