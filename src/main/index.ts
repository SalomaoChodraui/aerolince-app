import { config as dotenvConfig } from 'dotenv';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, app, clipboard, globalShortcut, ipcMain, screen, systemPreferences } from 'electron';
import { saveReport, saveSidecar } from '../core/output/output.js';
import {
  ResultadoLaudo,
  desfazer,
  getOutputDir,
  initPipeline,
  processarAudio,
  processarTexto,
  refinarAudio,
  refinarTexto,
} from './pipeline.js';

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
    backgroundColor: '#F2ECE3',
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

/**
 * Empacotado: dados do usuário (config, chaves, biblioteca, laudos) vivem em
 * userData (mac: ~/Library/Application Support/Aerolince; win: %APPDATA%/Aerolince).
 * Primeira execução cria a estrutura com perfis padrão e máscaras de exemplo.
 * Dev: continua tudo na pasta do repositório.
 */
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
    if (!existsSync(join(root, '.env'))) {
      writeFileSync(
        join(root, '.env'),
        '# Chaves de API do Aerolince — preencha e reabra o app\nANTHROPIC_API_KEY=\nOPENAI_API_KEY=\n',
        'utf8',
      );
    }
  }
  dotenvConfig({ path: join(root, '.env') });
  return root;
}

app.whenReady().then(() => {
  initPipeline(bootstrap());
  if (process.platform === 'darwin') void systemPreferences.askForMediaAccess('microphone');
  createFloat();
  createResult();
  globalShortcut.register('CommandOrControl+Shift+D', () => floatWin?.webContents.send('atalho-toggle'));

  ipcMain.handle('processar-audio', (_e, ab: ArrayBuffer) => processar(() => processarAudio(Buffer.from(ab))));
  ipcMain.handle('processar-texto', (_e, texto: string) => processar(() => processarTexto(texto)));
  ipcMain.handle('refinar-audio', (_e, ab: ArrayBuffer) => processar(() => refinarAudio(Buffer.from(ab))));
  ipcMain.handle('refinar-texto', (_e, texto: string) => processar(() => refinarTexto(texto)));
  ipcMain.handle('desfazer', () => {
    const r = desfazer();
    if (!r) return { ok: false };
    clipboard.writeText(r.report);
    resultWin?.webContents.send('resultado', { ...r, savedPath: '(versão anterior — clipboard atualizado)' });
    return { ok: true };
  });
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
