import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';
import { z } from 'zod';
import { writeFileAtomicSync } from '../../core/atomic-write.js';
import { cifrarSegmento, decifrarSegmento, gerarChaveSessao } from '../../core/audio/cripto.js';

export const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sessionId: z.string().min(1),
  criadoEm: z.string(),
  chaveCifradaB64: z.string().min(1),
  segmentos: z.array(z.object({ arquivo: z.string().min(1), durationMs: z.number().int().nonnegative() })),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export class SpoolSessao {
  private constructor(
    readonly dir: string,
    private readonly chave: Buffer,
    private readonly manifest: Manifest,
  ) {}

  /** null se o cofre do SO não estiver disponível — o chamador segue só em memória. */
  static criar(spoolRoot: string): SpoolSessao | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
    const dir = join(spoolRoot, sessionId);
    mkdirSync(dir, { recursive: true });
    const chave = gerarChaveSessao();
    const manifest: Manifest = {
      schemaVersion: 1,
      sessionId,
      criadoEm: new Date().toISOString(),
      chaveCifradaB64: safeStorage.encryptString(chave.toString('base64')).toString('base64'),
      segmentos: [],
    };
    const spool = new SpoolSessao(dir, chave, manifest);
    spool.salvarManifest();
    return spool;
  }

  /** null se manifest inválido/ausente ou cofre indisponível (recovery degrada para "descartar"). */
  static abrir(dir: string): SpoolSessao | null {
    try {
      const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
      if (!safeStorage.isEncryptionAvailable()) return null;
      const chave = Buffer.from(safeStorage.decryptString(Buffer.from(manifest.chaveCifradaB64, 'base64')), 'base64');
      return new SpoolSessao(dir, chave, manifest);
    } catch {
      return null;
    }
  }

  appendSegmento(pcm: Buffer, durationMs: number): void {
    const arquivo = `seg-${String(this.manifest.segmentos.length).padStart(3, '0')}.bin`;
    const tmp = join(this.dir, `${arquivo}.tmp`);
    writeFileSync(tmp, cifrarSegmento(this.chave, pcm));
    renameSync(tmp, join(this.dir, arquivo));
    this.manifest.segmentos.push({ arquivo, durationMs });
    this.salvarManifest();
  }

  listarSegmentos(): Buffer[] {
    return this.manifest.segmentos.map((s) => decifrarSegmento(this.chave, readFileSync(join(this.dir, s.arquivo))));
  }

  get meta(): Manifest {
    return this.manifest;
  }

  descartar(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private salvarManifest(): void {
    writeFileAtomicSync(join(this.dir, 'manifest.json'), JSON.stringify(this.manifest, null, 2));
  }
}

export function listarSessoesOrfas(spoolRoot: string): string[] {
  try {
    return readdirSync(spoolRoot)
      .map((nome) => join(spoolRoot, nome))
      .filter((dir) => {
        try { statSync(join(dir, 'manifest.json')); return true; } catch { return false; }
      })
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

export function apagarSessoesAntigas(spoolRoot: string, maxIdadeMs: number): void {
  const agora = Date.now();
  for (const dir of listarSessoesOrfas(spoolRoot)) {
    try {
      if (agora - statSync(dir).mtimeMs > maxIdadeMs) rmSync(dir, { recursive: true, force: true });
    } catch {
      /* melhor esforço — nunca impedir o boot */
    }
  }
}
