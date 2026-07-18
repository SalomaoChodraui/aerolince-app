import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import { SimboloA } from '../shared/SimboloA.js';

type Fase = 'idle' | 'gravando' | 'processando' | 'ok' | 'erro';

function Icone({ fase }: { fase: Fase }) {
  if (fase === 'gravando') return <span className="parar" />;
  if (fase === 'ok') return <>✓</>;
  if (fase === 'erro') return <>!</>;
  return <SimboloA size={30} />;
}

function App() {
  const [fase, setFase] = useState<Fase>('idle');
  const [segundos, setSegundos] = useState(0);
  const [aviso, setAviso] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelado = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const faseRef = useRef<Fase>('idle');
  const drag = useRef<{ offX: number; offY: number; moved: boolean } | null>(null);
  faseRef.current = fase;

  async function iniciar() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    chunks.current = [];
    cancelado.current = false;
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      window.aerolince.gravando(false);
      if (cancelado.current) return setFase('idle');
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      void window.aerolince.processarAudio(await blob.arrayBuffer());
    };
    rec.start();
    recorder.current = rec;
    window.aerolince.gravando(true);
    setFase('gravando');
    setSegundos(0);
    timer.current = setInterval(() => setSegundos((s) => s + 1), 1000);
  }

  function parar(cancelar = false) {
    cancelado.current = cancelar;
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stop();
    recorder.current = null;
  }

  function toggle() {
    const f = faseRef.current;
    if (f === 'gravando') parar(false);
    else if (f === 'idle' || f === 'ok' || f === 'erro') void iniciar();
  }

  // Clique = ditar; arrastar = mover a janela (distinção por movimento do mouse)
  function onMouseDown(e: React.MouseEvent) {
    drag.current = { offX: e.screenX - window.screenX, offY: e.screenY - window.screenY, moved: false };
  }
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = drag.current;
      if (!d) return;
      const nx = e.screenX - d.offX;
      const ny = e.screenY - d.offY;
      if (Math.abs(e.screenX - window.screenX - d.offX) > 3 || Math.abs(e.screenY - window.screenY - d.offY) > 3) {
        d.moved = true;
      }
      if (d.moved) window.aerolince.balaoMover(nx, ny);
    }
    function onUp() {
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) toggle();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    window.aerolince.onAtalhoToggle(toggle);
    window.aerolince.onAtalhoCancelar(() => {
      if (faseRef.current === 'gravando') parar(true);
    });
    window.aerolince.onEstado(({ fase: nova, msg }) => {
      setFase(nova as Fase);
      if (nova === 'ok') {
        setAviso('');
        setTimeout(() => setFase('idle'), 1800);
      } else if (nova === 'erro') {
        // Nunca ficar travado: mostra o motivo e volta ao normal
        setAviso(msg?.includes('áudio') || msg?.includes('entendi') ? 'sem áudio' : 'erro');
        setTimeout(() => {
          setFase('idle');
          setAviso('');
        }, 3500);
      } else {
        setAviso('');
      }
    });
  }, []);

  const titulo =
    fase === 'gravando'
      ? 'Gravando — clique para parar (Esc cancela). Arraste para mover.'
      : fase === 'erro'
        ? 'Não consegui gerar o laudo — clique para tentar de novo'
        : 'Clique ou Cmd/Ctrl+Shift+D para ditar. Arraste para mover.';

  return (
    <>
      <button className={`botao ${fase}`} onMouseDown={onMouseDown} title={titulo}>
        <Icone fase={fase} />
      </button>
      {fase === 'gravando' && <div className="tempo">{segundos}s</div>}
      {fase === 'erro' && aviso && <div className="tempo aviso">{aviso}</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
