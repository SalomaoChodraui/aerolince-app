import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { aplicarGlass } from '../shared/glass.js';
import type { Macro, RendererConfig } from '../shared/types.js';

const api = window.aerolince;

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
  const [chaves, setChaves] = useState<Record<string, boolean>>({});
  const [novaChave, setNovaChave] = useState<Record<string, string>>({});
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    void (async () => {
      const c = (await api.configGet()) as RendererConfig;
      setCfg(c);
      aplicarGlass(c);
      setChaves(await api.secretsStatus());
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
    setChaves(await api.secretsSet(nome, valor));
    setNovaChave((s) => ({ ...s, [nome]: '' }));
    flashSalvo();
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
          {CHAVE_INFO.map(([nome, desc]) => (
            <div className="linha" key={nome}>
              <div style={{ flex: 1 }}>
                <div className="rot">
                  {nome} {chaves[nome] ? <span style={{ color: 'var(--oxido)' }}>● configurada</span> : <span className="desc">não configurada</span>}
                </div>
                <div className="desc">{desc}</div>
              </div>
              <input
                type="password"
                placeholder={chaves[nome] ? '••••••••  (trocar)' : 'colar chave'}
                value={novaChave[nome] ?? ''}
                onChange={(e) => setNovaChave((s) => ({ ...s, [nome]: e.target.value }))}
                style={{ width: 180 }}
              />
              <button onClick={() => gravarChave(nome)} disabled={!(novaChave[nome] ?? '').trim()}>
                Salvar
              </button>
            </div>
          ))}
          <div className="desc" style={{ padding: '4px 14px' }}>
            As chaves ficam no cofre criptografado do sistema (Keychain / DPAPI), nunca em texto puro.
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
