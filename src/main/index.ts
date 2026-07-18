import 'dotenv/config';
import { join } from 'node:path';
import { BrowserWindow, app, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import { saveReport, saveSidecar } from '../core/output/output.js';
import { ResultadoLaudo, getOutputDir, initPipeline, processarAudio, processarTexto } from './pipeline.js';

let floatWin: BrowserWindow | null = null;
let resultWin: BrowserWindow | null = null;
let quitting = false;

const preload = join(import.meta.dirname, '../preload/index.mjs');
const devUrl = process.env['ELECTRON_RENDERER_URL'];

function loadPage(win: BrowserWindow, page: 'float' | 'result'): void {
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html`);
  else void win.loadFile(join(import.meta.dirname, `../renderer/${page}/index.html`));
}

function createFloat(): void {
  const { workArea } = screen.getPrimaryDisplay();
  floatWin = new BrowserWindow({
    width: 96,
    height: 96,
    x: workArea.x + workArea.width - 130,
    y: workArea.y + workArea.height - 150,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: { preload, sandbox: false },
  });
  floatWin.setAlwaysOnTop(true, 'screen-saver');
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadPage(floatWin, 'float');
}

function createResult(): void {
  resultWin = new BrowserWindow({
    width: 580,
    height: 720,
    show: false,
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

function estado(fase: string, msg?: string): void {
  floatWin?.webContents.send('estado', { fase, msg });
}

async function entregar(r: ResultadoLaudo): Promise<void> {
  clipboard.writeText(r.report);
  const saved = saveReport(getOutputDir(), r.maskId, r.report);
  saveSidecar(saved, {
    transcript: r.transcript,
    maskId: r.maskId,
    confianca: r.confianca,
    latenciasMs: r.tempos,
    custoUSD: r.custoUSD,
    blocosAlterados: r.blocosAlterados,
    origem: 'app',
  });
  resultWin?.webContents.send('resultado', { ...r, savedPath: saved });
  resultWin?.showInactive(); // mostra sem roubar o foco do RIS
  estado('ok');
}

async function processar(fn: () => Promise<ResultadoLaudo>): Promise<{ ok: boolean; erro?: string }> {
  estado('processando');
  try {
    await entregar(await fn());
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    estado('erro', msg);
    resultWin?.webContents.send('resultado-erro', msg);
    return { ok: false, erro: msg };
  }
}

app.whenReady().then(() => {
  initPipeline(app.getAppPath());
  if (process.platform === 'darwin') void systemPreferences.askForMediaAccess('microphone');
  createFloat();
  createResult();
  globalShortcut.register('CommandOrControl+Shift+D', () => floatWin?.webContents.send('atalho-toggle'));

  ipcMain.handle('processar-audio', (_e, ab: ArrayBuffer) => processar(() => processarAudio(Buffer.from(ab))));
  ipcMain.handle('processar-texto', (_e, texto: string) => processar(() => processarTexto(texto)));
  ipcMain.handle('copiar', (_e, texto: string) => {
    clipboard.writeText(texto);
  });
  ipcMain.on('gravando', (_e, on: boolean) => {
    if (on) globalShortcut.register('Escape', () => floatWin?.webContents.send('atalho-cancelar'));
    else globalShortcut.unregister('Escape');
  });
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
