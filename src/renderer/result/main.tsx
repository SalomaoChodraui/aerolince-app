import { useEffect, useRef, useState } from 'react';
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

type RefinoFase = 'idle' | 'gravando' | 'processando';

function App() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [refinoFase, setRefinoFase] = useState<RefinoFase>('idle');
  const [refinoTexto, setRefinoTexto] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    window.aerolince.onResultado((p) => {
      const r = p as unknown as Resultado;
      setResultado(r);
      setTexto(r.report);
      setErro(null);
      setCopiado(false);
      setRefinoFase('idle');
    });
    window.aerolince.onResultadoErro((msg) => {
      setErro(msg);
      setRefinoFase('idle');
    });
  }, []);

  async function copiar() {
    await window.aerolince.copiar(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  async function toggleRefinoVoz() {
    if (refinoFase === 'gravando') {
      recorder.current?.stop();
      recorder.current = null;
      return;
    }
    if (refinoFase !== 'idle') return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRefinoFase('processando');
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      void window.aerolince.refinarAudio(await blob.arrayBuffer());
    };
    rec.start();
    recorder.current = rec;
    setRefinoFase('gravando');
  }

  async function aplicarRefinoTexto() {
    if (!refinoTexto.trim() || refinoFase !== 'idle') return;
    setRefinoFase('processando');
    setRefinoTexto('');
    void window.aerolince.refinarTexto(refinoTexto.trim());
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
          <div className="acoes refino">
            <button
              className={refinoFase === 'gravando' ? 'gravando' : ''}
              onClick={toggleRefinoVoz}
              disabled={refinoFase === 'processando'}
              title="Dite um ajuste, ex.: 'acrescenta cisto renal esquerdo de 2 cm'"
            >
              {refinoFase === 'gravando' ? '⏹ Parar e aplicar' : refinoFase === 'processando' ? '… aplicando' : '🎙️ Refinar por voz'}
            </button>
            <input
              value={refinoTexto}
              onChange={(e) => setRefinoTexto(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && aplicarRefinoTexto()}
              placeholder="ou digite o ajuste e ENTER"
              disabled={refinoFase !== 'idle'}
            />
            <button onClick={() => void window.aerolince.desfazer()} disabled={refinoFase !== 'idle'} title="Volta uma versão do refino">
              ↩ Desfazer
            </button>
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
