import { contextBridge, ipcRenderer } from 'electron';

type Resp = { ok: boolean; erro?: string };

const api = {
  // Pipeline
  processarAudio: (buf: ArrayBuffer): Promise<Resp> => ipcRenderer.invoke('processar-audio', buf),
  processarTexto: (texto: string): Promise<Resp> => ipcRenderer.invoke('processar-texto', texto),
  refinarAudio: (buf: ArrayBuffer): Promise<Resp> => ipcRenderer.invoke('refinar-audio', buf),
  refinarTexto: (texto: string): Promise<Resp> => ipcRenderer.invoke('refinar-texto', texto),
  desfazer: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('desfazer'),
  copiar: (texto: string): Promise<void> => ipcRenderer.invoke('copiar', texto),
  gravando: (on: boolean): void => ipcRenderer.send('gravando', on),
  balaoMover: (x: number, y: number): void => ipcRenderer.send('balao-mover', x, y),

  // Configuração / aparência
  configGet: (): Promise<unknown> => ipcRenderer.invoke('config-get'),
  configSet: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('config-set', patch),

  // Chaves de API
  secretsStatus: (): Promise<Record<string, boolean>> => ipcRenderer.invoke('secrets-status'),
  secretsSet: (nome: string, valor: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke('secrets-set', nome, valor),

  // Histórico + feedback
  historicoListar: (): Promise<unknown[]> => ipcRenderer.invoke('historico-listar'),
  historicoLer: (arquivo: string): Promise<string> => ipcRenderer.invoke('historico-ler', arquivo),
  historicoCopiar: (arquivo: string): Promise<void> => ipcRenderer.invoke('historico-copiar', arquivo),
  salvarFinal: (arquivo: string, texto: string): Promise<void> =>
    ipcRenderer.invoke('salvar-final', arquivo, texto),

  // Macros
  macroRodar: (comando: string): Promise<Resp> => ipcRenderer.invoke('macro-rodar', comando),

  // Janelas e utilidades
  abrir: (qual: 'settings' | 'historico' | 'onboarding'): Promise<void> => ipcRenderer.invoke('abrir', qual),
  escolherPasta: (): Promise<string | null> => ipcRenderer.invoke('escolher-pasta'),
  abrirPasta: (caminho: string): Promise<string> => ipcRenderer.invoke('abrir-pasta', caminho),
  concluirOnboarding: (): Promise<void> => ipcRenderer.invoke('concluir-onboarding'),

  // Eventos
  onAtalhoToggle: (cb: () => void): void => void ipcRenderer.on('atalho-toggle', cb),
  onAtalhoCancelar: (cb: () => void): void => void ipcRenderer.on('atalho-cancelar', cb),
  onEstado: (cb: (p: { fase: string; msg?: string }) => void): void =>
    void ipcRenderer.on('estado', (_e, p) => cb(p)),
  onResultado: (cb: (p: Record<string, unknown>) => void): void =>
    void ipcRenderer.on('resultado', (_e, p) => cb(p)),
  onResultadoErro: (cb: (msg: string) => void): void =>
    void ipcRenderer.on('resultado-erro', (_e, p) => cb(p)),
  onConfigMudou: (cb: (c: unknown) => void): void =>
    void ipcRenderer.on('config-mudou', (_e, c) => cb(c)),
};

contextBridge.exposeInMainWorld('aerolince', api);

export type AerolinceApi = typeof api;
