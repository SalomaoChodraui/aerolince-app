import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import { SimboloA } from '../shared/SimboloA.js';
import type { RendererConfig } from '../shared/types.js';
import { iniciarCapturaVad, type CapturaVad } from './captura-vad.js';

type Fase = 'idle' | 'ouvindo' | 'falando' | 'gravando' | 'processando' | 'ok' | 'erro';

// Sessão de escuta segmentada (VAD): 'ouvindo' = sessão aberta aguardando fala,
// 'falando' = registrando um trecho. O clássico usa 'gravando' (MediaRecorder), intacto.
const SESSAO_ATIVA: Fase[] = ['ouvindo', 'falando'];
const emSessao = (f: Fase): boolean => SESSAO_ATIVA.includes(f);

/** m:ss — usado no contador `fala · total` da sessão segmentada. */
function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Icone({ fase }: { fase: Fase }) {
  // Sessão ativa e gravando clássico mostram o mesmo "parar" (clique encerra); o CSS diferencia.
  if (fase === 'gravando' || fase === 'ouvindo' || fase === 'falando') return <span className="parar" />;
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
  // Sessão segmentada (VAD): controlador da captura + medições do contador `fala · total`.
  const captura = useRef<CapturaVad | null>(null);
  const inicioSessao = useRef(0);
  const falaMs = useRef(0);
  const inicioFala = useRef<number | null>(null);
  const semCofre = useRef(false);
  // Geração da sessão: cresce a cada início/encerramento/cancelamento. Evita microfone
  // aberto se o usuário encerrar/cancelar enquanto o VAD ainda carrega o modelo.
  const geracao = useRef(0);
  faseRef.current = fase;

  // Fluxo clássico (config.stt.captura === 'classica'): MediaRecorder → webm → processarAudio.
  // Movido SEM alteração de lógica (getUserMedia segue sem tratamento próprio, como hoje).
  async function iniciarClassico() {
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

  // Início do ditado: lê a config (primeira vez que o float consulta config) e bifurca.
  async function iniciar() {
    try {
      const config = (await window.aerolince.configGet()) as RendererConfig;
      if (config.stt.captura === 'classica') return iniciarClassico();
      const gen = ++geracao.current;
      const r = await window.aerolince.sessaoIniciar();
      if (!r.ok) throw new Error(r.erro ?? 'Não consegui iniciar o ditado.');
      semCofre.current = r.semCofre === true; // sem cofre do SO → segue, mas avisa no tooltip
      inicioSessao.current = Date.now();
      falaMs.current = 0;
      inicioFala.current = null;
      setFase('ouvindo');
      setSegundos(0);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      const cap = await iniciarCapturaVad({
        pausaMs: config.stt.pausaMs,
        aoFalar: () => {
          inicioFala.current = Date.now();
          setFase('falando');
        },
        aoSilenciar: () => {
          inicioFala.current = null;
          setFase((f) => (f === 'falando' ? 'ouvindo' : f));
        },
        aoSegmento: (pcm, ms) => {
          falaMs.current += ms;
          void window.aerolince.sessaoSegmento(pcm.buffer as ArrayBuffer, ms);
        },
      });
      if (geracao.current !== gen) {
        // Encerrado/cancelado enquanto o VAD carregava: descarta a captura para não
        // deixar o microfone aberto sem sessão.
        void cap.cancelar();
        return;
      }
      captura.current = cap;
    } catch (e) {
      captura.current = null;
      if (timer.current) clearInterval(timer.current);
      void window.aerolince.sessaoCancelar(); // limpa a sessão do main se ela chegou a abrir
      // getUserMedia negado/sem device → orienta; demais erros caem no aviso genérico.
      const nome = e instanceof DOMException ? e.name : '';
      setAviso(nome === 'NotAllowedError' || nome === 'NotFoundError' ? 'microfone' : 'erro');
      setFase('erro');
      setTimeout(() => {
        if (faseRef.current === 'erro') {
          setFase('idle');
          setAviso('');
        }
      }, 3500);
    }
  }

  // Encerrar a sessão segmentada: flush do trecho em andamento → consolida no main → pipeline.
  // Os eventos 'estado' (processando/ok/erro) seguem pelo listener existente, igual ao clássico.
  async function encerrarSessao() {
    geracao.current++; // invalida um VAD que ainda esteja carregando
    if (timer.current) clearInterval(timer.current);
    await captura.current?.parar();
    captura.current = null;
    setFase('processando');
    await window.aerolince.sessaoEncerrar();
  }

  // Esc numa sessão segmentada: descarta tudo (sem consolidar) e volta ao repouso.
  async function cancelarSessao() {
    geracao.current++;
    if (timer.current) clearInterval(timer.current);
    await captura.current?.cancelar();
    captura.current = null;
    void window.aerolince.sessaoCancelar();
    setFase('idle');
  }

  // Parar clássico (MediaRecorder). `cancelar` descarta o áudio; senão dispara o pipeline no onstop.
  function parar(cancelar = false) {
    cancelado.current = cancelar;
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stop();
    recorder.current = null;
  }

  function toggle() {
    const f = faseRef.current;
    if (f === 'gravando') parar(false);
    else if (emSessao(f)) void encerrarSessao();
    else if (f === 'idle' || f === 'ok' || f === 'erro') void iniciar();
    // 'processando': ignora (clássico e segmentado)
  }

  // Contador da sessão: `fala · total` (m:ss). A fala só avança enquanto há trecho em curso
  // (inicioFala != null); o total avança sempre desde o início da sessão.
  function textoSessao(): string {
    const fala = falaMs.current + (inicioFala.current ? Date.now() - inicioFala.current : 0);
    const total = Date.now() - inicioSessao.current;
    return `${fmt(fala)} · ${fmt(total)}`;
  }

  // Clique = ditar; arrastar = mover a janela (distinção por movimento do mouse)
  function onMouseDown(e: React.MouseEvent) {
    drag.current = {
      offX: e.screenX - window.screenX,
      offY: e.screenY - window.screenY,
      moved: false,
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
      if (!d || d.moved) return; // arraste move a janela; clique dispara o ditado
      toggle();
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
      const f = faseRef.current;
      if (f === 'gravando') parar(true);
      else if (emSessao(f)) void cancelarSessao();
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
    fase === 'ouvindo'
      ? semCofre.current
        ? 'Ouvindo — clique para gerar o laudo (Esc cancela). Sem cofre do sistema: o ditado não será recuperável se o app fechar.'
        : 'Ouvindo — clique para gerar o laudo (Esc cancela)'
      : fase === 'falando'
        ? 'Registrando sua fala…'
        : fase === 'gravando'
          ? 'Gravando — clique para parar (Esc cancela). Arraste para mover.'
          : fase === 'erro'
            ? aviso === 'microfone'
              ? 'Permita o acesso ao microfone para ditar.'
              : 'Não consegui gerar o laudo — clique para tentar de novo'
            : 'Clique ou Cmd/Ctrl+Shift+D para ditar. Arraste para mover.';

  return (
    <>
      <button className={`botao ${fase}`} onMouseDown={onMouseDown} title={titulo}>
        <Icone fase={fase} />
      </button>
      {fase === 'gravando' && <div className="tempo">{segundos}s</div>}
      {emSessao(fase) && <div className="tempo">{textoSessao()}</div>}
      {fase === 'erro' && aviso && <div className="tempo aviso">{aviso}</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
