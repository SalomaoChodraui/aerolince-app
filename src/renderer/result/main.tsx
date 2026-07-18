import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface Resultado {
  report: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
  savedPath: string;
}

function App() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    window.aerolince.onResultado((p) => {
      const r = p as unknown as Resultado;
      setResultado(r);
      setTexto(r.report);
      setErro(null);
      setCopiado(false);
    });
    window.aerolince.onResultadoErro((msg) => setErro(msg));
  }, []);

  async function copiar() {
    await window.aerolince.copiar(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const totalS = resultado
    ? ((resultado.tempos.sttMs + resultado.tempos.selecaoMs + resultado.tempos.geracaoMs) / 1000).toFixed(1)
    : null;

  return (
    <div className="app">
      <div className="cabecalho">
        <span className="exame">{resultado ? resultado.maskNome : 'Aerolince'}</span>
        {resultado && <span className="chip conf">confiança {resultado.confianca}</span>}
        {resultado?.blocosAlterados.map((b) => (
          <span key={b} className="chip" title="bloco alterado em relação à máscara normal">
            {b}
          </span>
        ))}
      </div>

      {erro && <div className="erro-box">{erro}</div>}

      {resultado ? (
        <>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} spellCheck={false} />
          <div className="acoes">
            <button className="primario" onClick={copiar}>
              {copiado ? '✓ Copiado' : 'Copiar de novo'}
            </button>
            <span className="status">
              já copiado automaticamente · {totalS}s · US$ {resultado.custoUSD.toFixed(4)}
            </span>
          </div>
        </>
      ) : (
        !erro && (
          <div className="vazio">
            Clique no botão flutuante (ou Cmd/Ctrl+Shift+D), dite o comando e o laudo aparece aqui —
            já copiado para colar no seu RIS.
          </div>
        )
      )}

      <div className="rodape">
        <span className="aviso">RASCUNHO</span> — revise sempre antes de assinar. O laudo é ato médico.
        {resultado && <> · Salvo em {resultado.savedPath}</>}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
