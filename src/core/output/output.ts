import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Copia texto para a área de transferência (pbcopy no mac, clip no Windows). */
export function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const cmd =
      process.platform === 'darwin'
        ? ['pbcopy']
        : process.platform === 'win32'
          ? ['clip']
          : ['xclip', '-selection', 'clipboard'];
    const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`clipboard falhou (${code})`)),
    );
    proc.stdin.write(text, 'utf8');
    proc.stdin.end();
  });
}

/** Salva o laudo em <outputDir>/AAAA-MM-DD_HHMM_<maskId>.txt e retorna o caminho. */
export function saveReport(outputDir: string, maskId: string, text: string): string {
  mkdirSync(outputDir, { recursive: true });
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const path = join(outputDir, `${stamp}_${maskId}.txt`);
  writeFileSync(path, text, 'utf8');
  return path;
}

/** Sidecar opcional com metadados do processamento (matéria-prima da Fase 2). */
export function saveSidecar(reportPath: string, meta: object): void {
  writeFileSync(reportPath.replace(/\.txt$/, '.json'), JSON.stringify(meta, null, 2), 'utf8');
}
