import { SpoolSessao } from './spool.js';

export interface SessaoFinalizada {
  segmentos: Int16Array[];
  capturedMs: number;
  speechMs: number;
  spool: SpoolSessao | null;
}

const MAX_SEGMENTO_BYTES = 4 * 1024 * 1024; // ~2 min de fala Int16@16 kHz — bem acima do esperado

/**
 * Controller de um ditado segmentado no processo main.
 * A memória é a fonte primária para consolidar; o spool cifrado é só o seguro
 * contra crash (falha de disco NÃO derruba o ditado — segue só-memória).
 */
export class SessaoAudio {
  private spool: SpoolSessao | null = null;
  private segmentos: Int16Array[] = [];
  private iniciadaEm = 0;
  private speechMs = 0;
  private ativa = false;

  iniciar(spoolRoot: string): { ok: true; semCofre: boolean } | { ok: false; erro: string } {
    if (this.ativa) return { ok: false, erro: 'Já existe um ditado em andamento.' };
    this.spool = SpoolSessao.criar(spoolRoot);
    this.segmentos = [];
    this.speechMs = 0;
    this.iniciadaEm = Date.now();
    this.ativa = true;
    return { ok: true, semCofre: this.spool === null };
  }

  receberSegmento(pcm: Buffer, durationMs: number): { ok: boolean; erro?: string } {
    if (!this.ativa) return { ok: false, erro: 'Nenhum ditado em andamento.' };
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_SEGMENTO_BYTES) {
      return { ok: false, erro: 'Segmento de áudio com tamanho inválido.' };
    }
    // Cópia própria do PCM: o Buffer da IPC pode ser um view compartilhado/reciclado.
    this.segmentos.push(new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)));
    this.speechMs += durationMs;
    // Falha de disco não derruba o ditado: loga e segue só-memória (o spool é só o seguro contra crash).
    try {
      this.spool?.appendSegmento(pcm, durationMs);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`spool: falha ao gravar segmento em disco, seguindo só em memória — ${msg}`);
    }
    return { ok: true };
  }

  finalizar(): SessaoFinalizada | null {
    if (!this.ativa) return null;
    this.ativa = false;
    const fin: SessaoFinalizada = {
      segmentos: this.segmentos,
      capturedMs: Date.now() - this.iniciadaEm,
      speechMs: this.speechMs,
      spool: this.spool,
    };
    this.segmentos = [];
    this.spool = null;
    return fin;
  }

  cancelar(): void {
    this.ativa = false;
    this.segmentos = [];
    this.spool?.descartar();
    this.spool = null;
  }
}
