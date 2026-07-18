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
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const cancelado = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const faseRef = useRef<Fase>('idle');
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
      if (cancelado.current) {
        setFase('idle');
        return;
      }
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      const buf = await blob.arrayBuffer();
      void window.aerolince.processarAudio(buf);
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

  useEffect(() => {
    window.aerolince.onAtalhoToggle(toggle);
    window.aerolince.onAtalhoCancelar(() => {
      if (faseRef.current === 'gravando') parar(true);
    });
    window.aerolince.onEstado(({ fase: nova }) => {
      setFase(nova as Fase);
      if (nova === 'ok') setTimeout(() => setFase('idle'), 1800);
    });
  }, []);

  const titulo =
    fase === 'gravando'
      ? 'Gravando — clique ou Cmd/Ctrl+Shift+D para parar (Esc cancela)'
      : 'Clique ou Cmd/Ctrl+Shift+D para ditar o laudo';

  return (
    <>
      <button className={`botao ${fase}`} onClick={toggle} title={titulo}>
        <Icone fase={fase} />
      </button>
      {fase === 'gravando' && <div className="tempo">{segundos}s</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
