import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { aplicarGlass } from '../shared/glass.js';
import type { Macro, RendererConfig } from '../shared/types.js';

const api = window.aerolince;

type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="trilho" />
    </label>
  );
}

function App() {
  const [cfg, setCfg] = useState<RendererConfig | null>(null);
  const [cofre, setCofre] = useState<StatusCofre | null>(null);
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [erroChave, setErroChave] = useState<string | null>(null);
  const [novaChave, setNovaChave] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);
  // Contador de geração por chave: descarta resultado de teste que chega depois de a
  // chave já ter sido trocada/removida ou de um novo teste ter sido disparado.
  const testeGen = useRef<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      const c = (await api.configGet()) as RendererConfig;
      setCfg(c);
      aplicarGlass(c);
      setCofre(await api.secretsStatus());
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
  function flashSalvo() {
    setSalvo(true);
    setTimeout(() => setSalvo(false), 1200);
  }

  async function gravarChave(nome: string) {
    const valor = novaChave[nome] ?? '';
    setErroChave(null);
    testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1;
    try {
      setCofre(await api.secretsSet(nome, valor));
      setNovaChave((s) => ({ ...s, [nome]: '' }));
      setTeste((s) => ({ ...s, [nome]: '' }));
      flashSalvo();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroChave(msg.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setTeste((s) => ({ ...s, [nome]: '' })); // não deixa o botão Testar travado em '…'
    }
  }
  async function removerChave(nome: string) {
    setErroChave(null);
    testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1;
    try {
      setCofre(await api.secretsSet(nome, ''));
      setTeste((s) => ({ ...s, [nome]: '' }));
      flashSalvo();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroChave(msg.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setTeste((s) => ({ ...s, [nome]: '' })); // não deixa o botão Testar travado em '…'
    }
  }
  async function rodarTeste(nome: string) {
    const geracao = (testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1);
    setTeste((s) => ({ ...s, [nome]: '…' }));
    const r = await api.secretsTestar(nome);
    if (testeGen.current[nome] !== geracao) return; // chave foi trocada/removida ou novo teste disparado
    setTeste((s) => ({ ...s, [nome]: r.ok ? '✓ chave válida' : `✗ ${r.erro ?? 'falhou'}` }));
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

  const CHAVE_INFO: [string, string][] = [
    ['ANTHROPIC_API_KEY', 'Claude — geração dos laudos (obrigatória)'],
    ['OPENAI_API_KEY', 'Transcrição da voz (obrigatória)'],
    ['MOONSHOT_API_KEY', 'Kimi — opcional, para testes'],
  ];

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
              min={0.35}
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
          <h2>Chaves de API</h2>
          {cofre && !cofre.cofreDisponivel && (
            <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>
              O cofre do sistema não está disponível — não é possível salvar chaves com segurança nesta sessão.
            </div>
          )}
          {erroChave && (
            <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>{erroChave}</div>
          )}
          {CHAVE_INFO.map(([nome, desc]) => {
            const st = cofre?.chaves[nome] ?? 'ausente';
            return (
              <div className="linha" key={nome}>
                <div style={{ flex: 1 }}>
                  <div className="rot">
                    {nome}{' '}
                    {st === 'ok' ? (
                      <span style={{ color: 'var(--oxido)' }}>● configurada</span>
                    ) : st === 'invalida' ? (
                      <span style={{ color: '#c0392b' }}>● inválida — recoloque</span>
                    ) : (
                      <span className="desc">não configurada</span>
                    )}
                    {teste[nome] && <span className="desc"> · {teste[nome]}</span>}
                  </div>
                  <div className="desc">{desc}</div>
                </div>
                <input
                  type="password"
                  placeholder={st === 'ok' ? '••••••••  (trocar)' : 'colar chave'}
                  value={novaChave[nome] ?? ''}
                  onChange={(e) => setNovaChave((s) => ({ ...s, [nome]: e.target.value }))}
                  style={{ width: 180 }}
                />
                <button onClick={() => gravarChave(nome)} disabled={!(novaChave[nome] ?? '').trim()}>
                  Salvar
                </button>
                {st === 'ok' && (
                  <button onClick={() => rodarTeste(nome)} disabled={teste[nome] === '…'}>
                    Testar
                  </button>
                )}
                {st !== 'ausente' && (
                  <button className="fantasma" onClick={() => removerChave(nome)} title="Remover a chave">
                    ✕
                  </button>
                )}
              </div>
            );
          })}
          <div className="desc" style={{ padding: '4px 14px' }}>
            As chaves ficam no cofre criptografado do sistema (Keychain / DPAPI). Ao ditar, o áudio é
            transcrito pela OpenAI e o texto sanitizado vai à Anthropic — não dite dados do paciente.
          </div>
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
          <h2>Pastas e modelos</h2>
          <div className="linha">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="rot">Biblioteca de máscaras</div>
              <div className="desc" style={{ wordBreak: 'break-all' }}>{cfg.masksDir}</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.masksDir)}>Abrir</button>
            <button onClick={() => escolher('masksDir')}>Trocar…</button>
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
              <div className="desc">Abre a pasta das máscaras e regras — edite os arquivos .md em qualquer editor</div>
            </div>
            <button onClick={() => api.abrirPasta(cfg.masksDir)}>Abrir pasta</button>
          </div>
        </div>
      </div>

      <div className="rodape-janela">
        <span className="dica">As mudanças são salvas automaticamente.</span>
        <button onClick={() => api.abrir('onboarding')}>Ver guia rápido</button>
        <button onClick={() => api.abrir('historico')}>Histórico de laudos</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
