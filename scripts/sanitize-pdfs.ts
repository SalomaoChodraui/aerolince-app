/**
 * Extrai texto de PDFs de laudos LOCALMENTE (pdftotext) e sanitiza com o anonimizador.
 * Nada sai da máquina. Saída: app/tmp-sanitized/ (gitignorada), com nomes de arquivo
 * SEM identificação de paciente (data + exame + índice).
 *
 * Uso: npm run sanitize -- "<pasta-ou-pdfs...>"
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  examTypeFromFilename,
  patientNameFromFilename,
  sanitize,
} from '../src/core/anonymizer/anonymizer.js';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length === 0) {
  console.error('Uso: npm run sanitize -- "<pasta-ou-pdfs...>"');
  process.exit(1);
}

const OUT_DIR = resolve(import.meta.dirname, '..', 'tmp-sanitized');
mkdirSync(OUT_DIR, { recursive: true });
const mapaPath = join(OUT_DIR, '_mapa-local.tsv'); // auditoria local; pasta é gitignorada
writeFileSync(mapaPath, 'sanitizado\toriginal\tmascarados\n');

const pdfs: string[] = [];
for (const arg of args) {
  const p = resolve(arg);
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) {
      if (f.toLowerCase().endsWith('.pdf')) pdfs.push(join(p, f));
    }
  } else {
    pdfs.push(p);
  }
}
pdfs.sort();

let ok = 0;
let semTexto = 0;
let suspeitos = 0;
const porTipo = new Map<string, number>();
const idx = new Map<string, number>();

for (const pdf of pdfs) {
  const file = basename(pdf);
  let raw = '';
  try {
    raw = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdf, '-'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    console.error(`ERRO ao extrair: ${file}`);
    continue;
  }
  if (raw.trim().length < 40) {
    semTexto++;
    console.warn(`SEM CAMADA DE TEXTO (OCR necessário): ${file}`);
    continue;
  }

  const patient = patientNameFromFilename(file);
  const exam = examTypeFromFilename(file) ?? 'DESCONHECIDO';
  const date = file.slice(0, 10);
  const { clean, findings } = sanitize(raw, {
    extraNames: patient ? [patient] : [],
  });

  // Nome do paciente do arquivo DEVE ter sido encontrado no corpo — senão, revisar
  const nomesMascarados = findings.filter((f) => f.tipo === 'nome').length;
  if (patient && nomesMascarados === 0) {
    suspeitos++;
    console.warn(`REVISAR (nome do arquivo não encontrado no corpo): ${file}`);
  }

  const n = (idx.get(exam) ?? 0) + 1;
  idx.set(exam, n);
  const outName = `${exam}_${date}_${String(n).padStart(3, '0')}.txt`;
  writeFileSync(join(OUT_DIR, outName), clean, 'utf8');
  appendFileSync(mapaPath, `${outName}\t${file}\t${findings.length}\n`);
  porTipo.set(exam, (porTipo.get(exam) ?? 0) + 1);
  ok++;
}

console.log(`\n=== Sanitização concluída (100% local) ===`);
console.log(`OK: ${ok} | sem camada de texto: ${semTexto} | para revisar: ${suspeitos}`);
console.log(`Saída: ${OUT_DIR}`);
console.log(`Por tipo de exame:`);
for (const [tipo, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${tipo}: ${n}`);
}
