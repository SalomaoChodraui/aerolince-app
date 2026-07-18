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

  async function copiar() {
    await api.copiar(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  const filtrados = busca
    ? itens.filter((i) => (i.transcript + i.preview + i.maskId).toLowerCase().includes(busca.toLowerCase()))
    : itens;

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
