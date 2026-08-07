import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  systemPreferences,
} from 'electron';
import { z } from 'zod';
import {
  aplicarRascunho,
  descartarRascunho,
  lerRascunho,
  listarRascunhos,
} from '../core/aprendizado/aplicar.js';
import { consolidarSegmentos, particionarPorBytes } from '../core/audio/consolidar.js';
import { encodeWavPcm16 } from '../core/audio/wav.js';
import { Config, loadConfig, saveConfig } from '../core/config/schema.js';
import { saveReport, saveSidecar } from '../core/output/output.js';
import { MAX_AUDIO_BYTES } from '../core/stt/audio-guard.js';
import { escolherArquivosAcervo, importarAcervo } from './acervo.js';
import {
  AlvoAprendizado,
  aprendizadoEmExecucao,
  arquivoPermitidoParaAprendizado,
  cancelarAprendizado,
  estimarAprendizado,
  lerEstilo,
  limparCorpusHistoricoOrfao,
  listarEstilo,
  montarAlvosReaprender,
  rodarAprendizado,
  salvarEstilo,
} from './aprendizado.js';
import { validarDiagnostico, type DiagnosticoAudio } from './audio/diagnostico.js';
import { recuperarSpoolOrfao } from './audio/recovery.js';
import { SessaoAudio } from './audio/sessao.js';
import {
  apagarLaudo,
  apagarTodosLaudos,
  contarLaudos,
  limparVencidos,
  listarHistorico,
  lerLaudo,
  salvarFinalEditado,
} from './historico.js';
import {
  ResultadoLaudo,
  ResultadoPipeline,
  desfazer,
  gerarComMascara,
  getOutputDir,
  initPipeline,
  processarAudio,
  processarAudioSegmentado,
  processarTexto,
  refinarAudio,
  refinarTexto,
} from './pipeline.js';
import { NomeChave, carregarChaves, salvarChave, statusChaves, testarChave } from './secrets.js';

let floatWin: BrowserWindow | null = null;
let resultWin: BrowserWindow | null = null;
let settingsWin: BrowserWindow | null = null;
let historicoWin: BrowserWindow | null = null;
let onboardingWin: BrowserWindow | null = null;
let importarWin: BrowserWindow | null = null;
let estiloWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let appRoot = '';

const preload = join(import.meta.dirname, '../preload/index.mjs');
const devUrl = process.env['ELECTRON_RENDERER_URL'];

// `query` vira `?a=b` na URL da página — hoje só o wizard de importação usa
// (`?modo=reaprender`), para o renderer saber que deve abrir direto na etapa
// de custo com os alvos do Reaprender, sem precisar de um canal IPC à parte.
function loadPage(win: BrowserWindow, page: string, query?: Record<string, string>): void {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html${qs}`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}/index.html`), query ? { query } : undefined);
}

function cfg(): Config {
  return loadConfig(appRoot);
}

// ── Tema e vidro ────────────────────────────────────────────────────────────
function aplicarTema(c: Config): void {
  nativeTheme.themeSource = c.ui.tema === 'auto' ? 'system' : c.ui.tema === 'escuro' ? 'dark' : 'light';
}

function vibrancyDe(c: Config): 'under-window' | undefined {
  return c.ui.liquidGlass ? 'under-window' : undefined;
}

// ── Janela flutuante ─────────────────────────────────────────────────────────
function createFloat(c: Config): void {
  const { workArea } = screen.getPrimaryDisplay();
  const pos = c.ui.balaoPos ?? {
    x: workArea.x + workArea.width - 130,
    y: workArea.y + workArea.height - 150,
  };
  floatWin = new BrowserWindow({
    width: 96,
    height: 96,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: { preload, sandbox: false },
  });
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatWin.setOpacity(c.ui.opacidadeBalao);
  floatWin.on('moved', () => {
    if (!floatWin) return;
    const [x, y] = floatWin.getPosition();
    saveConfig(appRoot, { ui: { balaoPos: { x, y } } });
  });
  loadPage(floatWin, 'float');
}

// ── Janela de resultado ──────────────────────────────────────────────────────
function createResult(c: Config): void {
  resultWin = new BrowserWindow({
    width: 600,
    height: 760,
    show: false,
    backgroundColor: c.ui.liquidGlass ? '#00000000' : '#F2ECE3',
    vibrancy: vibrancyDe(c),
    title: 'Aerolince — Laudo (rascunho)',
    webPreferences: { preload, sandbox: false },
  });
  resultWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      resultWin?.hide();
    }
  });
  loadPage(resultWin, 'result');
}

// ── Janelas auxiliares (settings / histórico / onboarding) ───────────────────
function abrirAux(
  ref: BrowserWindow | null,
  set: (w: BrowserWindow | null) => void,
  page: string,
  opts: { width: number; height: number; title: string },
  query?: Record<string, string>,
  aoFechar?: () => void,
): void {
  if (ref && !ref.isDestroyed()) {
    ref.show();
    ref.focus();
    return;
  }
  const c = cfg();
  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    title: opts.title,
    backgroundColor: c.ui.liquidGlass ? '#00000000' : '#F2ECE3',
    vibrancy: vibrancyDe(c),
    webPreferences: { preload, sandbox: false },
  });
  win.on('closed', () => {
    set(null);
    aoFechar?.();
  });
  loadPage(win, page, query);
  set(win);
}

function abrirSettings(): void {
  abrirAux(settingsWin, (w) => (settingsWin = w), 'settings', {
    width: 640,
    height: 720,
    title: 'Aerolince — Configurações',
  });
}
function abrirHistorico(): void {
  abrirAux(historicoWin, (w) => (historicoWin = w), 'historico', {
    width: 720,
    height: 760,
    title: 'Aerolince — Histórico de laudos',
  });
}
function abrirOnboarding(): void {
  abrirAux(onboardingWin, (w) => (onboardingWin = w), 'onboarding', {
    width: 720,
    height: 680,
    title: 'Bem-vindo ao Aerolince',
  });
}
function abrirImportar(opts?: { modo?: 'reaprender' }): void {
  const modo = opts?.modo;
  abrirAux(
    importarWin,
    (w) => (importarWin = w),
    'importar',
    {
      width: 760,
      height: 760,
      title: modo === 'reaprender' ? 'Aerolince — Reaprender com meus laudos' : 'Aerolince — Importar meus laudos',
    },
    modo ? { modo } : undefined,
    () => {
      // I6(b): fechar a janela durante a fase "rodando" sinaliza cancelamento ao aprendizado
      // em andamento — mesmo botão "Cancelar" da própria tela, best-effort (o alvo em voo
      // termina; nenhum alvo NOVO começa depois). Ao contrário da importação de acervo (I6a,
      // sem cancelamento — texto corrigido em vez de fingir um cancelamento que não existe),
      // aprendizado JÁ tem um mecanismo de cancelamento pronto (`cancelarAprendizado`); só
      // faltava disparar no fechar da janela.
      cancelarAprendizado();
      // I2(b): também varre tempdirs órfãos do corpus do histórico (Reaprender) que não
      // chegaram a ser lidos por `rodarAprendizado` — ex.: o gate de chaves falhou e o médico
      // fechou a janela em vez de configurar a chave e tentar de novo (esses tempdirs agora
      // SOBREVIVEM a essa falha, ver `rodarAprendizado`/I2). Só varre se não houver um lote em
      // andamento AGORA (`aprendizadoEmExecucao`) — fechar a janela não cancela de fato a
      // promise do IPC 'aprendizado-rodar' já em voo no processo main (só sinaliza, acima), e
      // varrer no meio de uma execução real apagaria um tempdir que ainda está sendo lido.
      if (!aprendizadoEmExecucao()) limparCorpusHistoricoOrfao();
    },
  );
}
function abrirEstilo(): void {
  abrirAux(estiloWin, (w) => (estiloWin = w), 'estilo', {
    width: 860,
    height: 720,
    title: 'Aerolince — Meu estilo',
  });
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function trayIcon(): Electron.NativeImage {
  const p = join(import.meta.dirname, '../../build/trayTemplate.png');
  const img = existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createFromPath(join(import.meta.dirname, '../../build/icon.png')).resize({ width: 18, height: 18 });
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function montarTray(): void {
  tray = new Tray(trayIcon());
  tray.setToolTip('Aerolince — laudos por voz');
  atualizarMenuTray();
  tray.on('click', () => tray?.popUpContextMenu());
}

function atualizarMenuTray(): void {
  if (!tray) return;
  const macros = cfg().macros.filter((m) => m.comando.trim());
  const itens: Electron.MenuItemConstructorOptions[] = [
    { label: 'Ditar laudo (atalho global)', click: () => floatWin?.webContents.send('atalho-toggle') },
    { label: 'Mostrar/ocultar botão flutuante', click: () => (floatWin?.isVisible() ? floatWin.hide() : floatWin?.show()) },
  ];
  if (macros.length) {
    itens.push({ type: 'separator' });
    itens.push({
      label: 'Meus atalhos de laudo',
      submenu: macros.map((m) => ({
        label: m.nome,
        click: () => processar(() => processarTexto(m.comando)),
      })),
    });
  }
  itens.push(
    { type: 'separator' },
    { label: 'Histórico de laudos…', click: abrirHistorico },
    { label: 'Meu estilo…', click: abrirEstilo },
    { label: 'Importar meus laudos…', click: () => abrirImportar() },
    { label: 'Configurações…', click: abrirSettings },
    { label: 'Guia rápido…', click: abrirOnboarding },
    { type: 'separator' },
    { label: 'Sair do Aerolince', click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(itens));
}

// ── Atalho global ────────────────────────────────────────────────────────────
function registrarAtalho(c: Config): void {
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(c.ui.atalho, () => floatWin?.webContents.send('atalho-toggle'));
  } catch {
    globalShortcut.register('CommandOrControl+Shift+D', () => floatWin?.webContents.send('atalho-toggle'));
  }
}

// ── Entrega do laudo ─────────────────────────────────────────────────────────
function estado(fase: string, msg?: string): void {
  floatWin?.webContents.send('estado', { fase, msg });
}

// Progresso de acervo/aprendizado (Bloco 3): manda a TODAS as janelas vivas,
// mesmo padrão do canal 'estado' acima (o wizard de importação é quem realmente
// escuta hoje; as demais só ignoram o evento). EXCEÇÃO: 'acervo-progresso' (M5,
// ver `enviarImportarWin` abaixo) — o payload carrega o basename ORIGINAL do
// arquivo (nome de paciente, ex.: "2026-07-15_..._ISRAEL-ANDRETTA.pdf"), então
// vai só para a janela de importação, nunca em broadcast geral.
function broadcast(canal: string, payload: unknown): void {
  for (const w of [floatWin, resultWin, settingsWin, historicoWin, onboardingWin, importarWin, estiloWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(canal, payload);
  }
}

/** M5: envia só para a janela de importação (nunca broadcast geral) — usado por
 *  'acervo-progresso', cujo payload inclui o nome de arquivo ORIGINAL (pré-sanitização). */
function enviarImportarWin(canal: string, payload: unknown): void {
  if (importarWin && !importarWin.isDestroyed()) importarWin.webContents.send(canal, payload);
}

let ultimoArquivo = '';

// Ditado segmentado: um controller único no main + raiz do spool cifrado (userData/spool).
const sessaoAudio = new SessaoAudio();
const spoolRoot = (): string => join(app.getPath('userData'), 'spool');

async function entregar(r: ResultadoLaudo): Promise<void> {
  clipboard.writeText(r.report);
  const saved = saveReport(getOutputDir(), r.maskId, r.report);
  ultimoArquivo = saved.split('/').pop() ?? '';
  saveSidecar(saved, {
    transcript: r.transcript,
    maskId: r.maskId,
    confianca: r.confianca,
    latenciasMs: r.tempos,
    custoUSD: r.custoUSD,
    blocosAlterados: r.blocosAlterados,
    // Conteúdo ÍNTEGRO (sem a formatação de saída): seções desligadas na
    // formatação não somem do histórico/aprendizado.
    laudoGerado: r.reportIntegro,
    // Só no ditado segmentado; ausente (undefined) nos demais fluxos — JSON omite.
    audio: r.audio,
    origem: 'app',
  });
  resultWin?.webContents.send('resultado', { ...r, savedPath: saved, arquivo: ultimoArquivo });
  resultWin?.showInactive();
  estado('ok');
}

async function processar(fn: () => Promise<ResultadoPipeline>): Promise<{ ok: boolean; erro?: string }> {
  estado('processando');
  try {
    const r = await fn();
    if (r.tipo === 'confirmar-mascara') {
      resultWin?.webContents.send('confirmar-mascara', r);
      resultWin?.showInactive();
      estado('ok');
      return { ok: true };
    }
    await entregar(r);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    estado('erro', msg);
    resultWin?.webContents.send('resultado-erro', msg);
    resultWin?.showInactive();
    return { ok: false, erro: msg };
  }
}

// ── Bootstrap de dados (empacotado) ──────────────────────────────────────────
function bootstrap(): string {
  const root = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  if (app.isPackaged) {
    const baseDir = join(process.resourcesPath, 'biblioteca-base');
    const cfgPath = join(root, 'laudo.config.json');
    if (!existsSync(cfgPath)) {
      const masksDir = join(root, 'biblioteca-medico');
      const profilesDir = join(root, 'perfis');
      const outputDir = join(root, 'Laudos Gerados');
      mkdirSync(outputDir, { recursive: true });
      for (const sub of ['regras', 'frasario', '_rascunhos']) mkdirSync(join(masksDir, sub), { recursive: true });
      cpSync(join(process.resourcesPath, 'perfis'), profilesDir, { recursive: true });
      writeFileSync(
        cfgPath,
        JSON.stringify({ masksDir, profilesDir, outputDir, bibliotecaBaseDir: baseDir }, null, 2),
        'utf8',
      );
    } else {
      // Self-heal: o caminho de resources muda a cada versão instalada — realinha
      // a base sem tocar na biblioteca do médico.
      try {
        const c = loadConfig(root);
        if (c.bibliotecaBaseDir !== baseDir) saveConfig(root, { bibliotecaBaseDir: baseDir });
      } catch { /* config irrecuperável já é tratada pelo loadConfig */ }
    }
  }
  carregarChaves(root);
  // Limpeza da retenção do histórico (melhor-esforço): apaga laudos além do prazo
  // configurado. NUNCA trava o boot; retencaoDias 0 = manter sempre (não apaga).
  try {
    const c = loadConfig(root);
    const n = limparVencidos(c.outputDir, c.historico.retencaoDias, Date.now());
    if (n > 0) console.log(`[historico] retenção: ${n} laudo(s) além de ${c.historico.retencaoDias} dias apagados`);
  } catch (e) {
    console.log('[historico] limpeza de retenção falhou (ignorada):', e instanceof Error ? e.message : e);
  }
  // Corpus temporário do Reaprender (Bloco 3, T7): apaga órfãos de sessões que nunca
  // chegaram a rodar o aprendizado (fechou a janela, crash) — melhor-esforço, síncrono
  // e rápido (só um readdir de tmpdir()), nunca trava o boot.
  try {
    const n = limparCorpusHistoricoOrfao();
    if (n > 0) console.log(`[aprendizado] corpus do histórico: ${n} diretório(s) temporário(s) órfão(s) apagados`);
  } catch (e) {
    console.log('[aprendizado] limpeza do corpus do histórico falhou (ignorada):', e instanceof Error ? e.message : e);
  }
  // Recovery de ditado interrompido: oferecer/expirar o spool órfão SEM travar o
  // boot (fire-and-forget). O diálogo só resolve após interação do usuário, quando
  // as janelas e o pipeline já existem; erro na transcrição preserva o spool (≤48 h).
  void recuperarSpoolOrfao(spoolRoot(), (segmentos, speechMs) =>
    gerarDeSegmentos(segmentos, speechMs, speechMs), // capturedMs desconhecido → usar speechMs (ratio 1)
  ).catch((e) => {
    dialog.showErrorBox(
      'Recuperação do ditado falhou',
      `${e instanceof Error ? e.message : e}\n\nO ditado continua guardado (cifrado) e será oferecido de novo na próxima abertura, por até 48 h.`,
    );
  });
  return root;
}

// Confirmação nativa de ação destrutiva (deleção de laudo é irreversível). O
// botão destrutivo é sempre o primeiro (response 0); Cancelar é o default e o
// cancelId, então Esc/Enter sem intenção cancela. Parenteia na janela do
// histórico quando viva (folha modal no mac).
async function confirmarDestrutivo(message: string, acao: string): Promise<boolean> {
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    message,
    detail: 'Não dá para desfazer.',
    buttons: [acao, 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  };
  const janela = historicoWin && !historicoWin.isDestroyed() ? historicoWin : null;
  const { response } = janela
    ? await dialog.showMessageBox(janela, opts)
    : await dialog.showMessageBox(opts);
  return response === 0;
}

// ── Validação zod das fronteiras IPC de acervo/aprendizado/estilo (Bloco 3) ──
const CaminhosSchema = z.array(z.string().min(1)).min(1);
const AlvoAprendizadoSchema = z.object({
  tipo: z.enum(['destilar', 'aprender', 'sintetizar']),
  chave: z.string().min(1),
  // mesma regra do id de máscara (MaskFrontmatterSchema) — vira nome de arquivo no core, sem barra/ponto.
  maskId: z.string().regex(/^[a-z0-9-]+$/, 'maskId deve ser kebab-case'),
  arquivos: z.array(z.string().min(1)).min(1),
});
const AlvosAprendizadoSchema = z.array(AlvoAprendizadoSchema).min(1);
const TipoEstiloSchema = z.enum(['mascara', 'regras', 'frasario', 'sintese']);

/**
 * I5: rejeita alvos com algum `arquivo` fora de `config.acervoDir` ou de um tempdir do corpus
 * do histórico — a validação de FORMATO do zod acima (`AlvosAprendizadoSchema`) não impede um
 * caminho absoluto arbitrário do disco do médico (`/Users/.../Desktop/qualquer-coisa.txt`); só
 * `arquivoPermitidoParaAprendizado` (main/aprendizado.ts) sabe onde os arquivos de aprendizado
 * deveriam morar. Lança no primeiro caminho fora do permitido — mensagem clara, sem vazar mais
 * do caminho do que o próprio renderer já mandou.
 */
function validarCaminhosDosAlvos(alvos: AlvoAprendizado[], config: Config): void {
  for (const alvo of alvos) {
    for (const arquivo of alvo.arquivos) {
      if (!arquivoPermitidoParaAprendizado(arquivo, config.acervoDir)) {
        throw new Error(`arquivo fora dos diretórios permitidos para aprendizado: ${arquivo}`);
      }
    }
  }
}

// ── IPC ──────────────────────────────────────────────────────────────────────
function registrarIpc(): void {
  ipcMain.handle('processar-audio', (_e, ab: ArrayBuffer) => processar(() => processarAudio(Buffer.from(ab))));
  ipcMain.handle('processar-texto', (_e, texto: string) => processar(() => processarTexto(texto)));
  ipcMain.handle('refinar-audio', (_e, ab: ArrayBuffer) => processar(() => refinarAudio(Buffer.from(ab))));
  ipcMain.handle('refinar-texto', (_e, texto: string) => processar(() => refinarTexto(texto)));
  ipcMain.handle('gerar-com-mascara', (_e, maskId: string, transcript: string, avisos: string[]) =>
    processar(() => gerarComMascara(maskId, transcript, avisos)),
  );

  // ── Ditado segmentado (pedal/VAD) ──────────────────────────────────────────
  ipcMain.handle('sessao-iniciar', () => sessaoAudio.iniciar(spoolRoot()));

  ipcMain.handle('sessao-segmento', (_e, pcm: unknown, durationMs: unknown) => {
    // Fronteira IPC: protege ditado médico — nunca confiar no renderer.
    if (
      !(pcm instanceof ArrayBuffer) ||
      typeof durationMs !== 'number' ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      durationMs > 120_000
    ) {
      return { ok: false, erro: 'Segmento inválido.' };
    }
    return sessaoAudio.receberSegmento(Buffer.from(pcm), Math.round(durationMs));
  });

  ipcMain.handle('sessao-cancelar', () => {
    sessaoAudio.cancelar();
    return { ok: true };
  });

  // Encerrar: finaliza a sessão → pipeline segmentado → descarta o spool só no
  // sucesso. Em erro, replica o tratamento do handler 'processar-audio' vizinho
  // (estado 'erro' + evento 'resultado-erro') e PRESERVA o spool p/ recovery (Task 11).
  ipcMain.handle('sessao-encerrar', async (_e, diagnosticoBruto: unknown) => {
    const fin = sessaoAudio.finalizar();
    if (!fin) return { ok: false, erro: 'Nenhum ditado em andamento.' };
    // Fronteira IPC: telemetria nunca deve travar a entrega do laudo — um payload
    // fora do esperado apenas vira null (sem diagnóstico anexado), nunca um erro.
    const diagnostico = validarDiagnostico(diagnosticoBruto);
    estado('processando');
    try {
      await gerarDeSegmentos(fin.segmentos, fin.capturedMs, fin.speechMs, diagnostico);
      fin.spool?.descartar(); // só após sucesso; em erro fica p/ recovery no boot (≤48 h)
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      estado('erro', msg);
      resultWin?.webContents.send('resultado-erro', msg);
      resultWin?.showInactive();
      return { ok: false, erro: msg };
    }
  });

  ipcMain.handle('desfazer', () => {
    const r = desfazer();
    if (!r) return { ok: false };
    clipboard.writeText(r.report);
    resultWin?.webContents.send('resultado', { ...r, savedPath: '(versão anterior)', arquivo: ultimoArquivo });
    return { ok: true };
  });
  ipcMain.handle('copiar', (_e, texto: string) => clipboard.writeText(texto));
  ipcMain.on('gravando', (_e, on: boolean) => {
    if (on) globalShortcut.register('Escape', () => floatWin?.webContents.send('atalho-cancelar'));
    else globalShortcut.unregister('Escape');
  });

  // Configuração e aparência
  ipcMain.handle('config-get', () => cfg());
  ipcMain.handle('config-set', (_e, patch: Record<string, unknown>) => {
    const c = saveConfig(appRoot, patch);
    aplicarTema(c);
    floatWin?.setOpacity(c.ui.opacidadeBalao);
    registrarAtalho(c);
    atualizarMenuTray();
    for (const w of [resultWin, settingsWin, historicoWin, onboardingWin, importarWin, estiloWin]) w?.webContents.send('config-mudou', c);
    return c;
  });
  // Arraste manual do botão flutuante (clique = ditar, arraste = mover)
  ipcMain.on('balao-mover', (_e, x: number, y: number) => floatWin?.setPosition(Math.round(x), Math.round(y)));
  // Scroll no balão (clique/arraste continuam por outro canal): aplica a opacidade
  // JÁ calculada e clampeada pelo renderer — efeito imediato, sem tocar disco.
  // Fronteira IPC: nunca confiar no renderer, mesmo para um ajuste cosmético.
  ipcMain.on('balao-opacidade', (_e, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    floatWin?.setOpacity(Math.min(1, Math.max(0.05, v)));
  });

  // Chaves de API (cofre seguro)
  ipcMain.handle('secrets-status', () => statusChaves(appRoot));
  ipcMain.handle('secrets-set', (_e, nome: NomeChave, valor: string) => {
    salvarChave(appRoot, nome, valor);
    return statusChaves(appRoot);
  });
  ipcMain.handle('secrets-testar', (_e, nome: NomeChave) => testarChave(nome));

  // Histórico e loop de feedback
  ipcMain.handle('historico-listar', () => listarHistorico(getOutputDir()));
  ipcMain.handle('historico-ler', (_e, arquivo: string) => lerLaudo(getOutputDir(), arquivo));
  ipcMain.handle('historico-copiar', (_e, arquivo: string) => {
    clipboard.writeText(lerLaudo(getOutputDir(), arquivo));
  });
  ipcMain.handle('salvar-final', (_e, arquivo: string, texto: string) =>
    salvarFinalEditado(getOutputDir(), arquivo, texto),
  );
  // Apagar 1 laudo: o renderer manda só o identificador; apagarLaudo resolve o
  // caminho dentro de outputDir (basename → sem path traversal). Confirmação
  // nativa antes de tocar o disco.
  ipcMain.handle('historico-apagar', async (_e, id: unknown): Promise<{ ok: boolean; erro?: string }> => {
    if (typeof id !== 'string' || !id) return { ok: false, erro: 'Identificador inválido.' };
    if (!(await confirmarDestrutivo('Apagar este laudo?', 'Apagar'))) return { ok: false };
    return apagarLaudo(getOutputDir(), id)
      ? { ok: true }
      : { ok: false, erro: 'Laudo não encontrado.' };
  });
  // Apagar todos: contagem real no texto da confirmação.
  ipcMain.handle('historico-apagar-todos', async (): Promise<{ ok: boolean; erro?: string }> => {
    const n = contarLaudos(getOutputDir());
    if (n === 0) return { ok: false, erro: 'Nenhum laudo para apagar.' };
    if (!(await confirmarDestrutivo(`Apagar TODOS os laudos do histórico (${n} laudos)?`, 'Apagar todos')))
      return { ok: false };
    apagarTodosLaudos(getOutputDir());
    return { ok: true };
  });

  // Macros (atalhos de comando)
  ipcMain.handle('macro-rodar', (_e, comando: string) => processar(() => processarTexto(comando)));

  // Janelas e utilidades
  ipcMain.handle('abrir', (_e, qual: 'settings' | 'historico' | 'onboarding' | 'importar' | 'estilo') => {
    if (qual === 'settings') abrirSettings();
    else if (qual === 'historico') abrirHistorico();
    else if (qual === 'importar') abrirImportar();
    else if (qual === 'estilo') abrirEstilo();
    else abrirOnboarding();
  });
  // Reaprender (Meu estilo → wizard de importação já na etapa de custo, com os
  // alvos montados do acervo + histórico editado): IPC dedicado em vez de mais
  // um valor em `abrir` — evita amarrar a query string (`?modo=reaprender`) na
  // fronteira genérica de janelas, que hoje não carrega parâmetro nenhum.
  ipcMain.handle('abrir-reaprender', () => abrirImportar({ modo: 'reaprender' }));
  ipcMain.handle('reaprender-montar-alvos', () => montarAlvosReaprender(cfg()));
  ipcMain.handle('escolher-pasta', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('abrir-pasta', (_e, caminho: string) => shell.openPath(caminho));
  ipcMain.handle('concluir-onboarding', () => {
    saveConfig(appRoot, { onboardingConcluido: true });
    onboardingWin?.close();
  });

  // ── Acervo (Bloco 3): importação 100% local, sem LLM ───────────────────────
  ipcMain.handle('acervo-escolher-arquivos', () => escolherArquivosAcervo());
  ipcMain.handle('acervo-importar', (_e, paths: unknown) => {
    const parsed = CaminhosSchema.safeParse(paths);
    if (!parsed.success) throw new Error('lista de arquivos inválida para importação do acervo');
    return importarAcervo(parsed.data, cfg(), (p) => enviarImportarWin('acervo-progresso', p));
  });

  // ── Aprendizado (Bloco 3): estimativa sem LLM; execução com gate BYOK ──────
  ipcMain.handle('aprendizado-estimar', (_e, alvos: unknown) => {
    const parsed = AlvosAprendizadoSchema.safeParse(alvos);
    if (!parsed.success) throw new Error('alvos de aprendizado inválidos');
    const c = cfg();
    validarCaminhosDosAlvos(parsed.data as AlvoAprendizado[], c);
    return estimarAprendizado(parsed.data as AlvoAprendizado[], c);
  });
  ipcMain.handle('aprendizado-rodar', (_e, alvos: unknown) => {
    const parsed = AlvosAprendizadoSchema.safeParse(alvos);
    if (!parsed.success) throw new Error('alvos de aprendizado inválidos');
    const c = cfg();
    validarCaminhosDosAlvos(parsed.data as AlvoAprendizado[], c);
    return rodarAprendizado(parsed.data as AlvoAprendizado[], c, (p) => broadcast('aprendizado-progresso', p));
  });
  ipcMain.handle('aprendizado-cancelar', () => {
    cancelarAprendizado();
  });

  // ── Rascunhos (destilar/aprender pendentes de revisão) ─────────────────────
  ipcMain.handle('rascunhos-listar', () => listarRascunhos(cfg().masksDir));
  ipcMain.handle('rascunho-ler', (_e, arquivo: unknown) => {
    if (typeof arquivo !== 'string') throw new Error('nome de rascunho inválido');
    return lerRascunho(cfg().masksDir, arquivo);
  });
  ipcMain.handle('rascunho-aplicar', (_e, arquivo: unknown) => {
    if (typeof arquivo !== 'string') throw new Error('nome de rascunho inválido');
    const r = aplicarRascunho(cfg().masksDir, arquivo);
    // Sinal real de "o médico importou e usou o próprio jeito de laudar" (mais
    // confiável que qualquer heurística de UI): só aqui, quando um rascunho é
    // efetivamente aplicado na biblioteca dele, marcamos o onboarding.
    const c = saveConfig(appRoot, { onboarding: { acervoImportado: true } });
    broadcast('config-mudou', c);
    return r;
  });
  ipcMain.handle('rascunho-descartar', (_e, arquivo: unknown) => {
    if (typeof arquivo !== 'string') throw new Error('nome de rascunho inválido');
    descartarRascunho(cfg().masksDir, arquivo);
  });

  // ── Meu estilo (biblioteca do médico: máscaras/regras/frasário) ────────────
  ipcMain.handle('estilo-listar', () => listarEstilo(cfg()));
  ipcMain.handle('estilo-ler', (_e, tipo: unknown, nome: unknown) => {
    const t = TipoEstiloSchema.safeParse(tipo);
    if (!t.success || typeof nome !== 'string') throw new Error('parâmetros de estilo inválidos');
    return lerEstilo(cfg(), t.data, nome);
  });
  ipcMain.handle('estilo-salvar', (_e, tipo: unknown, nome: unknown, texto: unknown) => {
    const t = TipoEstiloSchema.safeParse(tipo);
    if (!t.success || typeof nome !== 'string' || typeof texto !== 'string') {
      throw new Error('parâmetros de estilo inválidos');
    }
    salvarEstilo(cfg(), t.data, nome, texto);
  });
}

// ── Pipeline segmentado (ditado por voz) ─────────────────────────────────────
// Consolida → particiona em ≤24 MB → WAVs → pipeline segmentado → entrega.
// Sessão sem fala vira WAV de 44 bytes e cai no validarAudio (<1024) → mesmo
// aviso "sem áudio" de hoje (NUNCA um atalho separado). LANÇA em erro para o
// handler 'sessao-encerrar' preservar o spool; reusado pelo recovery (Task 11).
async function gerarDeSegmentos(
  segmentos: Int16Array[],
  capturedMs: number,
  speechMs: number,
  diagnostico: DiagnosticoAudio | null = null,
): Promise<void> {
  const grupos = particionarPorBytes(segmentos, MAX_AUDIO_BYTES);
  const wavs = grupos.map((g) => encodeWavPcm16(consolidarSegmentos(g).pcm));
  if (wavs.length === 0) wavs.push(encodeWavPcm16(new Int16Array(0)));
  const res = await processarAudioSegmentado(wavs, { capturedMs, speechMs, diagnostico: diagnostico ?? undefined });
  // Mesma bifurcação de entregar()/confirmar-mascara do wrapper processar().
  if (res.tipo === 'confirmar-mascara') {
    resultWin?.webContents.send('confirmar-mascara', res);
    resultWin?.showInactive();
    estado('ok');
    return;
  }
  await entregar(res); // janela de resultado + sidecar (com telemetria de áudio)
}

app.whenReady().then(() => {
  appRoot = bootstrap();
  initPipeline(appRoot);
  const c = cfg();
  aplicarTema(c);
  if (process.platform === 'darwin') {
    void systemPreferences.askForMediaAccess('microphone');
    app.dock?.hide(); // app de bandeja: sem ícone no dock
  }
  createFloat(c);
  createResult(c);
  montarTray();
  registrarAtalho(c);
  registrarIpc();
  if (!c.onboardingConcluido) abrirOnboarding();
});

app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => globalShortcut.unregisterAll());
// App de bandeja: fechar janelas NÃO encerra o app (só o menu "Sair" encerra)
app.on('window-all-closed', () => {});
