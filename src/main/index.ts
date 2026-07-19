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
import { Config, loadConfig, saveConfig } from '../core/config/schema.js';
import { saveReport, saveSidecar } from '../core/output/output.js';
import { listarHistorico, lerLaudo, salvarFinalEditado } from './historico.js';
import {
  ResultadoLaudo,
  ResultadoPipeline,
  desfazer,
  gerarComMascara,
  getOutputDir,
  initPipeline,
  processarAudio,
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
let tray: Tray | null = null;
let quitting = false;
let appRoot = '';

const preload = join(import.meta.dirname, '../preload/index.mjs');
const devUrl = process.env['ELECTRON_RENDERER_URL'];

function loadPage(win: BrowserWindow, page: string): void {
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}/index.html`));
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
  win.on('closed', () => set(null));
  loadPage(win, page);
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

let ultimoArquivo = '';

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
    laudoGerado: r.report,
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
    const cfgPath = join(root, 'laudo.config.json');
    if (!existsSync(cfgPath)) {
      const masksDir = join(root, 'biblioteca-mascaras');
      const profilesDir = join(root, 'perfis');
      const outputDir = join(root, 'Laudos Gerados');
      mkdirSync(outputDir, { recursive: true });
      cpSync(join(process.resourcesPath, 'perfis'), profilesDir, { recursive: true });
      cpSync(join(process.resourcesPath, 'masks-exemplo'), masksDir, { recursive: true });
      writeFileSync(cfgPath, JSON.stringify({ masksDir, profilesDir, outputDir }, null, 2), 'utf8');
    }
  }
  carregarChaves(root);
  return root;
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
    for (const w of [resultWin, settingsWin, historicoWin, onboardingWin]) w?.webContents.send('config-mudou', c);
    return c;
  });
  // Arraste manual do botão flutuante (clique = ditar, arraste = mover)
  ipcMain.on('balao-mover', (_e, x: number, y: number) => floatWin?.setPosition(Math.round(x), Math.round(y)));

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

  // Macros (atalhos de comando)
  ipcMain.handle('macro-rodar', (_e, comando: string) => processar(() => processarTexto(comando)));

  // Janelas e utilidades
  ipcMain.handle('abrir', (_e, qual: 'settings' | 'historico' | 'onboarding') => {
    if (qual === 'settings') abrirSettings();
    else if (qual === 'historico') abrirHistorico();
    else abrirOnboarding();
  });
  ipcMain.handle('escolher-pasta', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('abrir-pasta', (_e, caminho: string) => shell.openPath(caminho));
  ipcMain.handle('concluir-onboarding', () => {
    saveConfig(appRoot, { onboardingConcluido: true });
    onboardingWin?.close();
  });
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
