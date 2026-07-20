import { rmSync } from 'node:fs';
import { dialog } from 'electron';
import { apagarSessoesAntigas, listarSessoesOrfas, SpoolSessao } from './spool.js';

const MAX_IDADE_MS = 48 * 60 * 60 * 1000;

export async function recuperarSpoolOrfao(
  spoolRoot: string,
  transcrever: (segmentos: Int16Array[], speechMs: number) => Promise<void>,
): Promise<void> {
  apagarSessoesAntigas(spoolRoot, MAX_IDADE_MS);
  const dirs = listarSessoesOrfas(spoolRoot);
  if (dirs.length === 0) return;

  const [maisRecente, ...demais] = dirs;
  for (const dir of demais) rmSync(dir, { recursive: true, force: true });

  const spool = SpoolSessao.abrir(maisRecente!);
  if (!spool) {
    // manifest inválido ou cofre indisponível — não dá para decifrar; nunca travar o boot
    rmSync(maisRecente!, { recursive: true, force: true });
    return;
  }

  // Spool órfão vazio (sessão que falhou no guard "sem áudio"): descartar em
  // silêncio. Oferecer diálogo mentiria "~1 min de fala" e Transcrever cairia no
  // guard de novo (decisão do ledger, review T8).
  if (spool.meta.segmentos.length === 0) {
    spool.descartar();
    return;
  }

  const speechMs = spool.meta.segmentos.reduce((soma, s) => soma + s.durationMs, 0);
  const minutos = Math.max(1, Math.round(speechMs / 60_000));
  const quando = new Date(spool.meta.criadoEm).toLocaleString('pt-BR');
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: 'Encontrei um ditado interrompido',
    detail: `De ${quando}, com ~${minutos} min de fala. Transcrever agora?`,
    buttons: ['Transcrever agora', 'Descartar'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response !== 0) {
    spool.descartar();
    return;
  }

  const segmentos = spool
    .listarSegmentos()
    .map((b) => new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  await transcrever(segmentos, speechMs); // se lançar, o spool FICA (próximo boot, ≤48 h)
  spool.descartar();
}
