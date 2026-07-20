import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import './historico.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { iniciarTema } from '../shared/glass.js';

const api = window.aerolince;

interface Item {
  arquivo: string;
  data: string;
  maskId: string;
  transcript: string;
  preview: string;
  busca: string;
  editado: boolean;
}

function App() {
  const [itens, setItens] = useState<Item[]>([]);
  const [sel, setSel] = useState<Item | null>(null);
  const [texto, setTexto] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [busca, setBusca] = useState('');

  useEffect(() => {
    void iniciarTema();
    void (async () => {
      const lista = (await api.historicoListar()) as Item[];
      setItens(lista);
      if (lista[0]) abrir(lista[0]);
    })();
  }, []);

  async function abrir(item: Item) {
    setSel(item);
    setTexto(await api.historicoLer(item.arquivo));
    setCopiado(false);
  }

  // Recarrega a lista após uma deleção. Mantém a seleção se ela sobreviveu;
  // senão abre o primeiro item (ou esvazia o detalhe se não restou nenhum).
  async function recarregar(anterior: Item | null) {
    const lista = (await api.historicoListar()) as Item[];
    setItens(lista);
    if (anterior && lista.some((i) => i.arquivo === anterior.arquivo)) return;
    if (lista[0]) void abrir(lista[0]);
    else {
      setSel(null);
      setTexto('');
    }
  }

  // A confirmação (irreversível) acontece no processo main; aqui só reagimos ao ok.
  async function apagar(item: Item, e: React.MouseEvent) {
    e.stopPropagation(); // não abrir o laudo ao clicar na lixeira
    const r = await api.historicoApagar(item.arquivo);
    if (r.ok) await recarregar(sel);
  }

  async function apagarTodos() {
    const r = await api.historicoApagarTodos();
    if (r.ok) await recarregar(null);
  }

  async function copiar() {
    await api.copiar(texto);
    setCopiado(true);
    // Objetivo cumprido: fecha o histórico após copiar
    setTimeout(() => window.close(), 500);
  }

  const termo = busca.trim().toLowerCase();
  const filtrados = termo ? itens.filter((i) => i.busca.includes(termo)) : itens;

  return (
    <div className="janela">
      <div className="topo">
        <img src={logoUrl} alt="Aerolince" className="logo" />
        <h1>Histórico de laudos</h1>
        <input
          type="text"
          placeholder="buscar…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ marginLeft: 'auto', width: 200, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        />
        {itens.length > 0 && (
          <button className="fantasma hist-apagar-todos" onClick={apagarTodos} title="Apagar todos os laudos">
            Apagar todos
          </button>
        )}
      </div>
      <div className="hist-split">
        <ul className="hist-lista">
          {filtrados.map((i) => (
            <li
              key={i.arquivo}
              className={sel?.arquivo === i.arquivo ? 'sel' : ''}
              onClick={() => abrir(i)}
            >
              <div className="hist-cab">
                <span className="hist-exame">{i.maskId}</span>
                <span className="hist-data">{i.data}</span>
              </div>
              <div className="hist-prev">{i.transcript || i.preview}</div>
              {i.editado && <span className="hist-tag">editado</span>}
              <button
                className="hist-apagar"
                title="Apagar este laudo"
                aria-label="Apagar este laudo"
                onClick={(e) => apagar(i, e)}
              >
                🗑
              </button>
            </li>
          ))}
          {filtrados.length === 0 && <li className="vazio">Nenhum laudo ainda.</li>}
        </ul>
        <div className="hist-detalhe">
          {sel ? (
            <>
              <textarea value={texto} readOnly spellCheck={false} />
              <div className="rodape-janela">
                <span className="dica">{sel.arquivo}</span>
                <button className="primario" onClick={copiar}>
                  {copiado ? '✓ Copiado' : 'Copiar laudo'}
                </button>
              </div>
            </>
          ) : (
            <div className="vazio-detalhe">Selecione um laudo à esquerda.</div>
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
