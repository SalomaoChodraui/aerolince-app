import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import logoUrl from '../assets/aerolince-logo-primary.svg';
import { iniciarTema } from '../shared/glass.js';

interface Resultado {
  report: string;
  maskNome: string;
  confianca: string;
  blocosAlterados: string[];
  avisos?: string[];
  tempos: { sttMs: number; selecaoMs: number; geracaoMs: number };
  custoUSD: number;
  savedPath: string;
  arquivo: string;
}

interface Confirmacao {
  transcript: string;
  candidatos: { id: string; nome: string }[];
  avisos?: string[];
}

type RefinoFase = 'idle' | 'gravando' | 'processando';

function App() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [refinoFase, setRefinoFase] = useState<RefinoFase>('idle');
  const [refinoTexto, setRefinoTexto] = useState('');
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [gerando, setGerando] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const arquivo = useRef<string>('');
  const geradoRef = useRef<string>('');

  // Loop de feedback: grava a versão final editada pelo médico (o diff
  // gerado→final alimenta o aprendizado; nenhum dado de paciente envolvido).
  function persistirEdicao(novo: string) {
    if (arquivo.current && novo !== geradoRef.current) {
      void window.aerolince.salvarFinal(arquivo.current, novo);
    }
  }

  useEffect(() => {
    void iniciarTema();
    window.aerolince.onResultado((p) => {
      const r = p as unknown as Resultado;
      setResultado(r);
      setTexto(r.report);
      arquivo.current = r.arquivo ?? '';
      geradoRef.current = r.report;
      setErro(null);
      setCopiado(false);
      setRefinoFase('idle');
      setConfirmacao(null);
      setGerando(false);
    });
    window.aerolince.onResultadoErro((msg) => {
      setErro(msg);
      setRefinoFase('idle');
      setGerando(false);
    });
    window.aerolince.onConfirmarMascara((p) => {
      setConfirmacao(p as unknown as Confirmacao);
      setResultado(null);
      setErro(null);
      setGerando(false);
      setRefinoFase('idle');
    });
  }, []);

  async function copiar() {
    await window.aerolince.copiar(texto);
    persistirEdicao(texto);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  function confirmarMascara(id: string): void {
    if (!confirmacao || gerando) return;
    setGerando(true);
    setErro(null);
    void window.aerolince.gerarComMascara(id, confirmacao.transcript);
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
        <img src={logoUrl} alt="Aerolince" className="logo" />
        {resultado && <span className="separador" />}
        <span className="exame">{resultado ? resultado.maskNome : ''}</span>
        {resultado && <span className="chip conf">confiança {resultado.confianca}</span>}
        {resultado?.blocosAlterados.map((b) => (
          <span key={b} className="chip" title="bloco alterado em relação à máscara normal">
            {b}
          </span>
        ))}
        <button
          className="menu-btn"
          title="Configurações, histórico e ajuda"
          onClick={() => window.aerolince.abrir('settings')}
        >
          ☰
        </button>
      </div>

      {erro && <div className="erro-box">{erro}</div>}

      {confirmacao && !resultado && (
        <div className="confirmar">
          <div className="titulo">Não tive certeza do exame. Gerar como:</div>
          {confirmacao.candidatos.map((c, k) => (
            <button key={c.id} className={k === 0 ? 'primario' : ''} disabled={gerando} onClick={() => confirmarMascara(c.id)}>
              {c.nome}
            </button>
          ))}
          <button className="cancelar" disabled={gerando} onClick={() => setConfirmacao(null)}>
            Nenhum destes — vou ditar de novo citando o exame
          </button>
          {gerando && <div className="status">… gerando o laudo</div>}
        </div>
      )}

      {resultado ? (
        <>
          {(resultado.avisos?.length ?? 0) > 0 && (
            <div className="aviso-box">🛡️ {resultado.avisos!.join(' · ')}</div>
          )}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={(e) => persistirEdicao(e.target.value)}
            spellCheck={false}
          />
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
        !erro && !confirmacao && (
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
