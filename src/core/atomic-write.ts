import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Escrita atômica: tmp no mesmo diretório → fsync → rename. */
export function writeFileAtomicSync(path: string, data: string): void {
  const tmp = join(dirname(path), `.${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, data, 'utf8');
  const fd = openSync(tmp, 'r+');
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, path);
}
