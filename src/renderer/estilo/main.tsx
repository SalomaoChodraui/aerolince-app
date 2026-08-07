/**
 * "Meu estilo" (Bloco 3, T7): editor da biblioteca do médico — máscaras, regras
 * e frasário, em camadas (base do app × biblioteca do médico). Cada item mostra
 * a origem EFETIVA (`origemEfetiva`, de `estiloListar`): 'base' enquanto o
 * médico não tiver a própria versão, 'minha' assim que salvar — `estiloSalvar`
 * grava SEMPRE na biblioteca do médico (override atômico da base).
 *
 * "Reaprender com meus laudos" não roda nada aqui: só abre o wizard de
 * importação (`abrirReaprender`) já na etapa de custo, com os alvos montados
 * no processo main a partir do acervo + histórico editado (`aprendizado.ts`).
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import './estilo.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { iniciarTema } from '../shared/glass.js';

const api = window.aerolince;

type ResumoEstilo = Awaited<ReturnType<typeof api.estiloListar>>;
type TipoEstilo = Parameters<typeof api.estiloLer>[0];

interface Selecionado {
  tipo: TipoEstilo;
  /** Id (máscara) ou nome do arquivo sem `.md` (regras/frasário) — é o que `estiloLer`/`estiloSalvar` esperam. */
  nome: string;
  /** Rótulo legível para exibir (nome da máscara, ou o próprio nome do arquivo p/ regras/frasário). */
  rotulo: string;
  origemEfetiva: 'base' | 'minha';
}

const TITULO_TIPO: Record<TipoEstilo, string> = {
  mascara: 'Máscara',
  regras: 'Regras',
  sintese: 'Síntese da conclusão',
  frasario: 'Frasário',
};

function App() {
  const [resumo, setResumo] = useState<ResumoEstilo | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [sel, setSel] = useState<Selecionado | null>(null);
  const [texto, setTexto] = useState('');
  const [textoOriginal, setTextoOriginal] = useState('');
  const [carregandoItem, setCarregandoItem] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erroItem, setErroItem] = useState<string | null>(null);

  useEffect(() => {
    void iniciarTema();
    void carregarResumo();
  }, []);

  async function carregarResumo(): Promise<void> {
    setErroLista(null);
    try {
      const r = await api.estiloListar();
      setResumo(r);
      if (r.mascaras[0]) void selecionar('mascara', r.mascaras[0].id, r.mascaras[0].nome, r.mascaras[0].origemEfetiva);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : String(e));
    }
  }

  async function selecionar(tipo: TipoEstilo, nome: string, rotulo: string, origemEfetiva: 'base' | 'minha'): Promise<void> {
    if (texto !== textoOriginal && !window.confirm('Descartar as alterações não salvas deste item?')) return;
    setSel({ tipo, nome, rotulo, origemEfetiva });
    setSalvo(false);
    setErroItem(null);
    setCarregandoItem(true);
    try {
      const t = await api.estiloLer(tipo, nome);
      setTexto(t);
      setTextoOriginal(t);
    } catch (e) {
      setTexto('');
      setTextoOriginal('');
      setErroItem(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregandoItem(false);
    }
  }

  async function salvar(): Promise<void> {
    if (!sel) return;
    setSalvando(true);
    setErroItem(null);
    try {
      await api.estiloSalvar(sel.tipo, sel.nome, texto);
      setTextoOriginal(texto);
      setSalvo(true);
      marcarComoMinha(sel.tipo, sel.nome);
    } catch (e) {
      setErroItem(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  /** Otimista: depois de salvar, o item passa a ser "minha" (override na biblioteca do médico) — sem recarregar tudo. */
  function marcarComoMinha(tipo: TipoEstilo, nome: string): void {
    setResumo((r) => {
      if (!r) return r;
      if (tipo === 'mascara') {
        return { ...r, mascaras: r.mascaras.map((m) => (m.id === nome ? { ...m, origemEfetiva: 'minha' as const } : m)) };
      }
      if (tipo === 'regras') {
        return { ...r, regras: r.regras.map((it) => (it.nome === nome ? { ...it, origemEfetiva: 'minha' as const } : it)) };
      }
      if (tipo === 'sintese') {
        return { ...r, sintese: r.sintese.map((it) => (it.nome === nome ? { ...it, origemEfetiva: 'minha' as const } : it)) };
      }
      return { ...r, frasario: r.frasario.map((it) => (it.nome === nome ? { ...it, origemEfetiva: 'minha' as const } : it)) };
    });
    setSel((s) => (s ? { ...s, origemEfetiva: 'minha' } : s));
  }

  const suja = texto !== textoOriginal;

  return (
    <div className="janela">
      <div className="topo">
        <img src={logoUrl} alt="Aerolince" className="logo" />
        <h1>Meu estilo</h1>
        <button
          className="fantasma"
          style={{ marginLeft: 'auto' }}
          onClick={() => void api.abrirReaprender()}
          title="Reaprende o fraseado das suas máscaras a partir do acervo importado e dos laudos que você já editou no histórico"
        >
          Reaprender com meus laudos
        </button>
      </div>

      <div className="estilo-split">
        <div className="estilo-lista">
          {erroLista && <div className="imp-erro">{erroLista}</div>}
          {!resumo && !erroLista && <div className="vazio">Carregando…</div>}

          {resumo && (
            <>
              <div className="estilo-grupo">
                <h2>Máscaras</h2>
                <ul>
                  {resumo.mascaras.map((m) => (
                    <li
                      key={m.id}
                      className={sel?.tipo === 'mascara' && sel.nome === m.id ? 'sel' : ''}
                      onClick={() => void selecionar('mascara', m.id, m.nome, m.origemEfetiva)}
                    >
                      <span className="estilo-nome">{m.nome}</span>
                      <span className={`estilo-badge ${m.origemEfetiva}`}>{m.origemEfetiva === 'minha' ? 'minha' : 'base'}</span>
                    </li>
                  ))}
                  {resumo.mascaras.length === 0 && <li className="vazio">Nenhuma máscara.</li>}
                </ul>
              </div>

              <div className="estilo-grupo">
                <h2>Regras</h2>
                <ul>
                  {resumo.regras.map((r) => (
                    <li
                      key={r.nome}
                      className={sel?.tipo === 'regras' && sel.nome === r.nome ? 'sel' : ''}
                      onClick={() => void selecionar('regras', r.nome, r.nome, r.origemEfetiva)}
                    >
                      <span className="estilo-nome">{r.nome}</span>
                    </li>
                  ))}
                  {resumo.regras.length === 0 && <li className="vazio">Nenhuma regra.</li>}
                </ul>
              </div>

              {/* Grupo PRÓPRIO (não misturado com Regras): a "tabela manual" dos pares
                  corpo → conclusão de cada exame (`regras/sintese-<id>.md`) — formato de
                  duas linhas por par, propositalmente fácil de editar à mão. */}
              <div className="estilo-grupo">
                <h2>Síntese da conclusão</h2>
                <ul>
                  {resumo.sintese.map((s) => (
                    <li
                      key={s.nome}
                      className={sel?.tipo === 'sintese' && sel.nome === s.nome ? 'sel' : ''}
                      onClick={() => void selecionar('sintese', s.nome, s.nome, s.origemEfetiva)}
                    >
                      <span className="estilo-nome">{s.nome}</span>
                    </li>
                  ))}
                  {resumo.sintese.length === 0 && (
                    <li className="vazio">Nenhuma ainda — aparece após "Reaprender com meus laudos".</li>
                  )}
                </ul>
              </div>

              <div className="estilo-grupo">
                <h2>Frasário</h2>
                <ul>
                  {resumo.frasario.map((f) => (
                    <li
                      key={f.nome}
                      className={sel?.tipo === 'frasario' && sel.nome === f.nome ? 'sel' : ''}
                      onClick={() => void selecionar('frasario', f.nome, f.nome, f.origemEfetiva)}
                    >
                      <span className="estilo-nome">{f.nome}</span>
                    </li>
                  ))}
                  {resumo.frasario.length === 0 && <li className="vazio">Nenhum frasário.</li>}
                </ul>
              </div>
            </>
          )}
        </div>

        <div className="estilo-editor">
          {!sel ? (
            <div className="vazio-detalhe">Selecione um item à esquerda.</div>
          ) : carregandoItem ? (
            <div className="vazio-detalhe">Carregando…</div>
          ) : (
            <>
              {sel.origemEfetiva === 'base' && (
                <div className="estilo-aviso">
                  Você está criando a SUA versão — ela passa a valer no lugar da base.
                </div>
              )}
              <textarea
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setSalvo(false);
                }}
                spellCheck={false}
              />
              <div className="rodape-janela">
                {erroItem ? (
                  <span className="dica" style={{ color: '#c0392b' }}>
                    {erroItem}
                  </span>
                ) : (
                  <span className="dica">
                    {TITULO_TIPO[sel.tipo]}: {sel.rotulo}
                  </span>
                )}
                <button className="primario" onClick={() => void salvar()} disabled={salvando || !suja}>
                  {salvando ? 'Salvando…' : salvo ? '✓ Salvo' : 'Salvar'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
