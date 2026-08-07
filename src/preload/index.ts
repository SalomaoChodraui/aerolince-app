import { contextBridge, ipcRenderer } from 'electron';

type Resp = { ok: boolean; erro?: string };
type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };

// Acervo / aprendizado (Bloco 3)
type ClusterImportacao = {
  chave: string;
  exame: string | null;
  modalidade: string;
  contraste: 'com' | 'sem';
  quantidade: number;
  maskIdExistente: string | null;
};
type ResumoImportacao = {
  clusters: ClusterImportacao[];
  semTexto: string[];
  naoReconhecidos: number;
  amostras: { arquivo: string; texto: string }[];
  suspeitos: number;
};
type AlvoAprendizado = { tipo: 'destilar' | 'aprender'; chave: string; maskId: string; arquivos: string[] };
type ProgressoAcervo = { fase: 'extraindo' | 'classificando' | 'sanitizando'; atual: number; total: number; arquivo?: string };
type ProgressoAprendizado = { chave: string; etapa: string; atual: number; total: number };
type Rascunho = { arquivo: string; tipo: 'mascara' | 'regras'; alvo: string };
type ItemEstiloMascara = { id: string; nome: string; origemEfetiva: 'base' | 'minha' };
type ResumoEstilo = { mascaras: ItemEstiloMascara[]; regras: string[]; frasario: string[] };

const api = {
  // Pipeline
  processarAudio: (buf: ArrayBuffer): Promise<Resp> => ipcRenderer.invoke('processar-audio', buf),
  processarTexto: (texto: string): Promise<Resp> => ipcRenderer.invoke('processar-texto', texto),
  refinarAudio: (buf: ArrayBuffer): Promise<Resp> => ipcRenderer.invoke('refinar-audio', buf),
  refinarTexto: (texto: string): Promise<Resp> => ipcRenderer.invoke('refinar-texto', texto),
  gerarComMascara: (maskId: string, transcript: string, avisos: string[]): Promise<Resp> =>
    ipcRenderer.invoke('gerar-com-mascara', maskId, transcript, avisos),

  // Ditado segmentado (pedal/VAD → segmentos → pipeline)
  sessaoIniciar: (): Promise<{ ok: boolean; semCofre?: boolean; erro?: string }> =>
    ipcRenderer.invoke('sessao-iniciar'),
  sessaoSegmento: (pcm: ArrayBuffer, durationMs: number): Promise<Resp> =>
    ipcRenderer.invoke('sessao-segmento', pcm, durationMs),
  sessaoEncerrar: (): Promise<Resp> => ipcRenderer.invoke('sessao-encerrar'),
  sessaoCancelar: (): Promise<Resp> => ipcRenderer.invoke('sessao-cancelar'),

  desfazer: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('desfazer'),
  copiar: (texto: string): Promise<void> => ipcRenderer.invoke('copiar', texto),
  gravando: (on: boolean): void => ipcRenderer.send('gravando', on),
  balaoMover: (x: number, y: number): void => ipcRenderer.send('balao-mover', x, y),
  // Scroll no balão: efeito imediato da opacidade (sem tocar disco a cada tick;
  // a persistência vai por configSet, debounced, no próprio renderer).
  balaoOpacidade: (v: number): void => ipcRenderer.send('balao-opacidade', v),

  // Configuração / aparência
  configGet: (): Promise<unknown> => ipcRenderer.invoke('config-get'),
  configSet: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('config-set', patch),

  // Chaves de API
  secretsStatus: (): Promise<StatusCofre> => ipcRenderer.invoke('secrets-status'),
  secretsSet: (nome: string, valor: string): Promise<StatusCofre> =>
    ipcRenderer.invoke('secrets-set', nome, valor),
  secretsTestar: (nome: string): Promise<{ ok: boolean; erro?: string }> =>
    ipcRenderer.invoke('secrets-testar', nome),

  // Histórico + feedback
  historicoListar: (): Promise<unknown[]> => ipcRenderer.invoke('historico-listar'),
  historicoLer: (arquivo: string): Promise<string> => ipcRenderer.invoke('historico-ler', arquivo),
  historicoCopiar: (arquivo: string): Promise<void> => ipcRenderer.invoke('historico-copiar', arquivo),
  historicoApagar: (id: string): Promise<Resp> => ipcRenderer.invoke('historico-apagar', id),
  historicoApagarTodos: (): Promise<Resp> => ipcRenderer.invoke('historico-apagar-todos'),
  salvarFinal: (arquivo: string, texto: string): Promise<void> =>
    ipcRenderer.invoke('salvar-final', arquivo, texto),

  // Macros
  macroRodar: (comando: string): Promise<Resp> => ipcRenderer.invoke('macro-rodar', comando),

  // Acervo (Bloco 3): escolha de arquivos + importação 100% local (sem LLM)
  acervoEscolherArquivos: (): Promise<string[] | null> => ipcRenderer.invoke('acervo-escolher-arquivos'),
  acervoImportar: (paths: string[]): Promise<ResumoImportacao> => ipcRenderer.invoke('acervo-importar', paths),

  // Aprendizado (Bloco 3): estimativa (sem LLM) e execução (com gate BYOK, sequencial, cancelável)
  aprendizadoEstimar: (
    alvos: AlvoAprendizado[],
  ): Promise<{ porAlvo: { chave: string; custoAproxUSD: number | null }[]; totalUSD: number | null }> =>
    ipcRenderer.invoke('aprendizado-estimar', alvos),
  aprendizadoRodar: (
    alvos: AlvoAprendizado[],
  ): Promise<{ ok: { chave: string; arquivo: string; custoUSD: number }[]; falhas: { chave: string; erro: string }[] }> =>
    ipcRenderer.invoke('aprendizado-rodar', alvos),
  aprendizadoCancelar: (): Promise<void> => ipcRenderer.invoke('aprendizado-cancelar'),

  // Rascunhos (destilar/aprender pendentes de revisão)
  rascunhosListar: (): Promise<Rascunho[]> => ipcRenderer.invoke('rascunhos-listar'),
  rascunhoLer: (arquivo: string): Promise<string> => ipcRenderer.invoke('rascunho-ler', arquivo),
  rascunhoAplicar: (arquivo: string): Promise<{ destino: string }> => ipcRenderer.invoke('rascunho-aplicar', arquivo),
  rascunhoDescartar: (arquivo: string): Promise<void> => ipcRenderer.invoke('rascunho-descartar', arquivo),

  // Meu estilo (biblioteca do médico: máscaras/regras/frasário)
  estiloListar: (): Promise<ResumoEstilo> => ipcRenderer.invoke('estilo-listar'),
  estiloLer: (tipo: 'mascara' | 'regras' | 'frasario', nome: string): Promise<string> =>
    ipcRenderer.invoke('estilo-ler', tipo, nome),
  estiloSalvar: (tipo: 'mascara' | 'regras' | 'frasario', nome: string, texto: string): Promise<void> =>
    ipcRenderer.invoke('estilo-salvar', tipo, nome, texto),

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
  onConfirmarMascara: (cb: (p: Record<string, unknown>) => void): void =>
    void ipcRenderer.on('confirmar-mascara', (_e, p) => cb(p)),
  onConfigMudou: (cb: (c: unknown) => void): void =>
    void ipcRenderer.on('config-mudou', (_e, c) => cb(c)),
  onAcervoProgresso: (cb: (p: ProgressoAcervo) => void): void =>
    void ipcRenderer.on('acervo-progresso', (_e, p) => cb(p)),
  onAprendizadoProgresso: (cb: (p: ProgressoAprendizado) => void): void =>
    void ipcRenderer.on('aprendizado-progresso', (_e, p) => cb(p)),
};

contextBridge.exposeInMainWorld('aerolince', api);

export type AerolinceApi = typeof api;
