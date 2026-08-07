import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import './float.css';
import { SimboloA } from '../shared/SimboloA.js';
import type { RendererConfig, SensibilidadeVad } from '../shared/types.js';
import { iniciarCapturaVad, type CapturaVad } from './captura-vad.js';
import { montarDiagnostico, type CapacidadesAudio } from './diagnostico-vad.js';

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

/** Rótulo curto do aviso sob o balão; o title do botão carrega a mensagem completa. */
function rotuloDeErro(msg?: string): string {
  const m = (msg ?? '').toLowerCase();
  if (m.includes('áudio') || m.includes('audio') || m.includes('entendi')) return 'sem áudio';
  if (m.includes('microfone')) return 'sem microfone';
  if (m.includes('chave') || m.includes('api key') || m.includes('_key')) return 'sem chave';
  return 'erro';
}

// Timeout de segurança para `aguardarEnviosPendentes`: nunca trava o encerramento
// para sempre por causa de um envio de segmento que não resolve.
const TIMEOUT_ENVIOS_MS = 3000;

/**
 * Espera todas as promessas de envio de segmento ainda em voo (com timeout de
 * segurança) — fecha a corrida entre o último segmento e `sessaoEncerrar` (canais
 * IPC distintos, sem garantia de ordem). Se o timeout estourar, segue mesmo
 * assim (com aviso no console): nunca trava o ditado por causa de telemetria de
 * transporte.
 */
async function aguardarEnviosPendentes(envios: Promise<unknown>[]): Promise<void> {
  if (envios.length === 0) return;
  let estourou = true;
  await Promise.race([
    Promise.allSettled(envios).then(() => {
      estourou = false;
    }),
    new Promise<void>((resolve) => setTimeout(resolve, TIMEOUT_ENVIOS_MS)),
  ]);
  if (estourou) {
    console.warn(
      `[aerolince] timeout de ${TIMEOUT_ENVIOS_MS}ms esperando ${envios.length} envio(s) de segmento — encerrando mesmo assim`,
    );
  }
}

/**
 * Capacidades do ambiente de áudio, colhidas no renderer para o diagnóstico do
 * sidecar (objetivo de campo: descobrir ONDE a fala se perde). Este `AudioContext`
 * é só para ler `sampleRate`/suporte a `audioWorklet` do ambiente — não é o mesmo
 * contexto que o `MicVAD` cria internamente, então `audioWorkletDisponivel` é uma
 * capacidade do ambiente (candidato a explicar um fallback pro ScriptProcessor
 * com quadro de 480 em vez dos 512 do modelo v5), não necessariamente o que o VAD
 * escolheu de fato. `enumerateDevices` só devolve `label` depois que alguma
 * permissão de microfone já foi concedida (o VAD já pediu a dele antes desta
 * função ser chamada).
 */
async function coletarCapacidadesAudio(): Promise<CapacidadesAudio> {
  let sampleRateNativo: number | null = null;
  let audioWorkletDisponivel = false;
  try {
    const ctx = new AudioContext();
    sampleRateNativo = ctx.sampleRate;
    audioWorkletDisponivel = typeof ctx.audioWorklet !== 'undefined';
    void ctx.close();
  } catch {
    // Sem AudioContext (não deveria acontecer no Electron) — segue com null.
  }
  let microfone: string | null = null;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    microfone = devices.find((d) => d.kind === 'audioinput')?.label || null;
  } catch {
    // Sem permissão/API de enumeração — nome do dispositivo é só diagnóstico, segue com null.
  }
  return { sampleRateNativo, audioWorkletDisponivel, microfone };
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
  const msgErro = useRef(''); // mensagem completa do erro, para o title do botão
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
  // Recusas de segmento nesta sessão: some em silêncio hoje se não for contado e
  // repassado ao encerrar — o médico precisa saber que um trecho dito sumiu.
  const segmentosRecusados = useRef(0);
  // Envios de segmento em voo (IPC 'sessao-segmento' ainda não resolvido). `sessao-segmento`
  // e `sessao-encerrar` são canais IPC distintos, sem garantia de ordem — sem esperar por
  // isto, o ÚLTIMO trecho dito (bem na hora de clicar para parar) pode chegar depois do
  // encerramento e ser descartado. Ver `encerrarSessao`.
  const enviosEmVoo = useRef<Promise<unknown>[]>([]);
  // Diagnóstico de captura (VAD) desta sessão — vira `audio.diagnostico` no sidecar.
  // Objetivo: responder, no próximo ditado real, ONDE a fala se perde.
  const segmentosVadEmitidos = useRef(0);
  const segmentosAceitos = useRef(0);
  const misfires = useRef(0);
  const sensibilidadeAtual = useRef<SensibilidadeVad>('media');
  const capacidadesAudio = useRef<CapacidadesAudio | null>(null);
  const semCofre = useRef(false);
  // Geração da sessão: cresce a cada início/encerramento/cancelamento. Evita microfone
  // aberto se o usuário encerrar/cancelar enquanto o VAD ainda carrega o modelo.
  const geracao = useRef(0);
  // Scroll no logo ajusta a opacidade do balão. Valor local espelha a config para
  // permitir o ajuste relativo (±0.05) sem round-trip a cada tick de scroll.
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  const opacidadeAtual = useRef(1); // default do schema; sobrescrito pelo configGet no mount
  const opacidadeCarregada = useRef(false); // trava o configGet tardio de sobrescrever um scroll já feito
  const opacidadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      segmentosRecusados.current = 0;
      enviosEmVoo.current = [];
      segmentosVadEmitidos.current = 0;
      segmentosAceitos.current = 0;
      misfires.current = 0;
      sensibilidadeAtual.current = config.stt.sensibilidadeVad;
      capacidadesAudio.current = null;
      setFase('ouvindo');
      setSegundos(0);
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(() => setSegundos((s) => s + 1), 1000);
      const cap = await iniciarCapturaVad({
        pausaMs: config.stt.pausaMs,
        sensibilidade: config.stt.sensibilidadeVad,
        aoFalar: () => {
          inicioFala.current = Date.now();
          setFase('falando');
        },
        aoSilenciar: () => {
          inicioFala.current = null;
          setFase((f) => (f === 'falando' ? 'ouvindo' : f));
        },
        aoMisfire: () => {
          misfires.current++;
        },
        aoSegmento: (pcm, ms) => {
          falaMs.current += ms;
          segmentosVadEmitidos.current++;
          // Não ignora a recusa: um segmento recusado (ex.: acima do cap) é contado e
          // repassado a `sessaoEncerrar` — vira aviso visível no resultado, em vez de
          // sumir em silêncio. A promessa fica em `enviosEmVoo` até resolver — ver
          // `encerrarSessao`, que espera por todas antes de encerrar a sessão no main.
          const envio = window.aerolince.sessaoSegmento(pcm.buffer as ArrayBuffer, ms).then((r) => {
            if (r.ok) {
              segmentosAceitos.current++;
            } else {
              segmentosRecusados.current++;
              console.warn('[aerolince] segmento recusado:', r.erro);
            }
          });
          enviosEmVoo.current.push(envio);
        },
      });
      if (geracao.current !== gen) {
        // Encerrado/cancelado enquanto o VAD carregava: descarta a captura para não
        // deixar o microfone aberto sem sessão.
        void cap.cancelar();
        return;
      }
      captura.current = cap;
      // Fire-and-forget: o VAD já pediu (e recebeu) a permissão de microfone, então
      // `enumerateDevices` já devolve o label aqui. Não bloqueia a UI — se o médico
      // encerrar antes disto resolver, `encerrarSessao` só envia capacidades nulas.
      void coletarCapacidadesAudio().then((c) => {
        capacidadesAudio.current = c;
      });
    } catch (e) {
      // Defesa: se por algum caminho já havia uma captura viva (ex.: sessão anterior ainda ativa
      // quando `sessaoIniciar` recusa), fecha o microfone antes de descartar a referência.
      void captura.current?.cancelar();
      captura.current = null;
      if (timer.current) clearInterval(timer.current);
      void window.aerolince.sessaoCancelar(); // limpa a sessão do main se ela chegou a abrir
      // getUserMedia negado/sem device → orienta; demais erros caem no aviso genérico.
      const nome = e instanceof DOMException ? e.name : '';
      msgErro.current = e instanceof Error ? e.message : '';
      setAviso(nome === 'NotAllowedError' || nome === 'NotFoundError' ? 'sem microfone' : 'erro');
      setFase('erro');
      setTimeout(() => {
        if (faseRef.current === 'erro') {
          setFase('idle');
          setAviso('');
          msgErro.current = '';
        }
      }, 5000);
    }
  }

  // Encerrar a sessão segmentada: flush do trecho em andamento → consolida no main → pipeline.
  // Os eventos 'estado' (processando/ok/erro) seguem pelo listener existente, igual ao clássico.
  async function encerrarSessao() {
    geracao.current++; // invalida um VAD que ainda esteja carregando
    if (timer.current) clearInterval(timer.current);
    await captura.current?.parar(); // dispara o onSpeechEnd do trecho em andamento (síncrono)
    captura.current = null;
    // Sem isto, o ÚLTIMO segmento (disparado por `parar()` acima) pode ainda estar em voo
    // quando `sessaoEncerrar` chega ao main — dois canais IPC distintos, sem ordem garantida.
    const envios = enviosEmVoo.current;
    enviosEmVoo.current = [];
    await aguardarEnviosPendentes(envios);
    setFase('processando');
    const diagnostico = montarDiagnostico(
      {
        segmentosVadEmitidos: segmentosVadEmitidos.current,
        segmentosAceitos: segmentosAceitos.current,
        segmentosRecusados: segmentosRecusados.current,
        misfires: misfires.current,
      },
      sensibilidadeAtual.current,
      capacidadesAudio.current ?? { sampleRateNativo: null, audioWorkletDisponivel: false, microfone: null },
    );
    const r = await window.aerolince.sessaoEncerrar(diagnostico);
    // {ok:false,'Nenhum ditado em andamento.'} NÃO emite evento 'estado' e deixaria 'processando'
    // travado para sempre. Só destrava se nenhum 'estado' tirou a fase de 'processando' — o erro
    // real do pipeline já emitiu 'estado'('erro') (também retorna ok:false) e não deve ser sobrescrito.
    if (!r.ok && faseRef.current === 'processando') setFase('idle');
  }

  // Esc numa sessão segmentada: descarta tudo (sem consolidar) e volta ao repouso.
  async function cancelarSessao() {
    geracao.current++;
    if (timer.current) clearInterval(timer.current);
    await captura.current?.cancelar();
    captura.current = null;
    enviosEmVoo.current = []; // sessão descartada — não há mais o que esperar
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

  // Opacidade atual para o ajuste relativo do scroll (o balão não lê a config no
  // boot hoje — só ao ditar). Guardado por opacidadeCarregada: se o usuário já
  // scrollou antes desta promise resolver, não pisa no valor mais novo.
  useEffect(() => {
    void (async () => {
      const config = (await window.aerolince.configGet()) as RendererConfig;
      if (!opacidadeCarregada.current) opacidadeAtual.current = config.ui.opacidadeBalao;
    })();
  }, []);

  // Scroll no logo ajusta a transparência (ideia do usuário). Listener nativo com
  // passive:false (preventDefault exige) — evento distinto de mousedown/move/up,
  // não interfere no clique/arraste. Efeito imediato via IPC dedicado (sem tocar
  // disco a cada tick); persistência por configSet, com debounce de ~400ms.
  useEffect(() => {
    const el = botaoRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      opacidadeCarregada.current = true;
      const delta = e.deltaY < 0 ? 0.05 : -0.05; // scroll para cima = mais opaco
      // Arredonda para 2 casas a cada tick — sem isso, ±0.05 repetido em float acumula drift.
      const v = Math.min(1, Math.max(0.05, Math.round((opacidadeAtual.current + delta) * 100) / 100));
      opacidadeAtual.current = v;
      window.aerolince.balaoOpacidade(v);
      if (opacidadeTimer.current) clearTimeout(opacidadeTimer.current);
      opacidadeTimer.current = setTimeout(() => {
        void window.aerolince.configSet({ ui: { opacidadeBalao: v } });
      }, 400);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    window.aerolince.onAtalhoToggle(toggle);
    window.aerolince.onAtalhoCancelar(() => {
      const f = faseRef.current;
      if (f === 'gravando') parar(true);
      else if (emSessao(f)) void cancelarSessao();
    });
    window.aerolince.onEstado(({ fase: nova, msg }) => {
      // Durante a sessão VAD o balão é dono do próprio estado: um 'estado' de fluxo alheio
      // (recovery no boot, refino na janela de resultado) não pode derrubá-lo a 'idle' com o
      // microfone vivo — o encerramento da sessão chega em 'processando', fora de SESSAO_ATIVA.
      if (emSessao(faseRef.current)) return;
      setFase(nova as Fase);
      if (nova === 'ok') {
        setAviso('');
        msgErro.current = '';
        // Guardado por fase: uma sessão nova iniciada dentro de 1,8 s NÃO pode ser revertida a
        // 'idle' por este timeout velho — senão o botão mentiria 'idle' com o microfone vivo.
        setTimeout(() => {
          if (faseRef.current === 'ok') setFase('idle');
        }, 1800);
      } else if (nova === 'erro') {
        // Nunca ficar travado: mostra o motivo e volta ao normal (guardado pela fase que reverte).
        msgErro.current = msg ?? '';
        setAviso(rotuloDeErro(msg));
        setTimeout(() => {
          if (faseRef.current === 'erro') {
            setFase('idle');
            setAviso('');
            msgErro.current = '';
          }
        }, 5000);
      } else {
        setAviso('');
        msgErro.current = '';
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
            ? aviso === 'sem microfone'
              ? 'Permita o acesso ao microfone para ditar.'
              : msgErro.current
                ? `${msgErro.current} — clique para tentar de novo`
                : 'Não consegui gerar o laudo — clique para tentar de novo'
            : 'Clique ou Cmd/Ctrl+Shift+D para ditar. Arraste para mover. Scroll ajusta a transparência.';

  return (
    <>
      <button ref={botaoRef} className={`botao ${fase}`} onMouseDown={onMouseDown} title={titulo}>
        <Icone fase={fase} />
      </button>
      {fase === 'gravando' && <div className="tempo">{segundos}s</div>}
      {emSessao(fase) && <div className="tempo">{textoSessao()}</div>}
      {fase === 'erro' && aviso && <div className="tempo aviso">{aviso}</div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
