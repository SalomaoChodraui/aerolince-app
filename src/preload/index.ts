import { contextBridge, ipcRenderer } from 'electron';

const api = {
  processarAudio: (buf: ArrayBuffer): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('processar-audio', buf),
  processarTexto: (texto: string): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('processar-texto', texto),
  copiar: (texto: string): Promise<void> => ipcRenderer.invoke('copiar', texto),
  refinarAudio: (buf: ArrayBuffer): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('refinar-audio', buf),
  refinarTexto: (texto: string): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('refinar-texto', texto),
  desfazer: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('desfazer'),
  gravando: (on: boolean): void => ipcRenderer.send('gravando', on),
  onAtalhoToggle: (cb: () => void): void => {
    ipcRenderer.on('atalho-toggle', cb);
  },
  onAtalhoCancelar: (cb: () => void): void => {
    ipcRenderer.on('atalho-cancelar', cb);
  },
  onEstado: (cb: (p: { fase: string; msg?: string }) => void): void => {
    ipcRenderer.on('estado', (_e, p) => cb(p));
  },
  onResultado: (cb: (p: Record<string, unknown>) => void): void => {
    ipcRenderer.on('resultado', (_e, p) => cb(p));
  },
  onResultadoErro: (cb: (msg: string) => void): void => {
    ipcRenderer.on('resultado-erro', (_e, p) => cb(p));
  },
};

contextBridge.exposeInMainWorld('aerolince', api);

export type AerolinceApi = typeof api;
