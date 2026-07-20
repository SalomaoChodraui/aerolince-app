import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import { SimboloA } from '../shared/SimboloA.js';

// ── SPIKE VAD (temporário — substituído pela captura real na Task 10) ──────────
// Prova de que o Silero VAD (@ricky0123/vad-web) carrega com assets 100% locais
// tanto em dev (servidor vite, `/vad/*`) quanto no empacotado (`file://` + app.asar).
// Acionamento FORA do fluxo normal: só por clique com Alt pressionado, e por
// window.__spikeVad (usado pela validação automatizada). Um clique normal grava
// como sempre. `base` é a expressão que as Tasks 10/11 reutilizam literalmente.
import { MicVAD, NonRealTimeVAD } from '@ricky0123/vad-web';

async function spikeVad(): Promise<void> {
  const base = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();
  console.log('[spike-vad] iniciando MicVAD.new — base =', base);
  try {
    let frames = 0;
    const vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: base,
      onnxWASMBasePath: base,
      onSpeechStart: () => console.log('[spike-vad] fala começou'),
      onSpeechEnd: (audio) =>
        console.log('[spike-vad] fala terminou', audio.length, 'amostras @16kHz'),
      onFrameProcessed: (p) => {
        if (++frames % 50 === 0)
          console.log('[spike-vad] frames processados =', frames, 'p(fala)=', p.isSpeech.toFixed(3));
      },
    });
    console.log('[spike-vad] MicVAD pronto — worklet + wasm + onnx carregados localmente (sem CDN)');
    vad.start();
    console.log('[spike-vad] VAD iniciado — fale e cale para ver os eventos');
  } catch (err) {
    console.error('[spike-vad] ERRO ao carregar/iniciar o VAD:', err);
  }
}

// Prova DETERMINÍSTICA (sem microfone): roda o modelo Silero, carregado dos mesmos
// assets locais, sobre um PCM de fala conhecido (Int16 mono @16 kHz em base64) e
// registra os segmentos de fala. Usada só pela validação automatizada.
async function spikeVadDetect(pcmB64: string): Promise<void> {
  const base = import.meta.env.DEV ? '/vad/' : new URL('../vad/', location.href).toString();
  console.log('[spike-vad] detect — base =', base);
  try {
    const bin = atob(pcmB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const i16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i]! / 0x8000;
    const vad = await NonRealTimeVAD.new({
      modelURL: `${base}silero_vad_legacy.onnx`,
      modelFetcher: (path) => fetch(path).then((r) => r.arrayBuffer()),
      ortConfig: (ort) => {
        ort.env.wasm.wasmPaths = base;
      },
    });
    let n = 0;
    for await (const seg of vad.run(f32, 16_000)) {
      n++;
      console.log('[spike-vad] fala começou', (seg.start / 1000).toFixed(2), 's');
      console.log('[spike-vad] fala terminou', seg.audio.length, 'amostras @16kHz');
    }
    console.log('[spike-vad] segmentos de fala detectados =', n);
  } catch (err) {
    console.error('[spike-vad] ERRO no detect offline:', err);
  }
}

if (typeof window !== 'undefined') {
  const w = window as unknown as { __spikeVad?: () => void; __spikeVadDetect?: (b64: string) => void };
  w.__spikeVad = spikeVad;
  w.__spikeVadDetect = spikeVadDetect;
}
// ──────────────────────────────────────────────────────────────────────────────

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
  const drag = useRef<{ offX: number; offY: number; moved: boolean; alt: boolean } | null>(null);
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
    drag.current = {
      offX: e.screenX - window.screenX,
      offY: e.screenY - window.screenY,
      moved: false,
      alt: e.altKey,
    };
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
      if (!d || d.moved) return;
      // SPIKE VAD (temporário): Alt+clique aciona a prova de carga; clique normal grava.
      if (d.alt) void spikeVad();
      else toggle();
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
