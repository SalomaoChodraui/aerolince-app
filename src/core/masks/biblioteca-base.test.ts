import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';
import { describe, expect, it } from 'vitest';
import { sanitize } from '../anonymizer/anonymizer.js';
import { loadLibrary } from './library.js';

const BASE = resolve(import.meta.dirname, '..', '..', '..', 'biblioteca-base');

describe('biblioteca-base', () => {
  it('tem 18 máscaras TC válidas com origem base e prefixos vazios', () => {
    const masks = loadLibrary(BASE);
    expect(masks).toHaveLength(18);
    for (const m of masks) {
      expect(m.origem).toBe('base');
      expect(m.prefixos).toEqual([]);
      expect(m.modalidade).toBe('TC');
      expect(m.body).toMatch(/<!-- orgao: /);
      expect(m.body).toMatch(/<!-- impressao -->/);
    }
  });

  it('nenhum arquivo contém dado pessoal detectável (anonymizer zero findings)', () => {
    const arquivos: string[] = [];
    const varrer = (dir: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) varrer(join(dir, f.name));
        else if (f.name.endsWith('.md')) arquivos.push(join(dir, f.name));
      }
    };
    varrer(BASE);
    expect(arquivos.length).toBeGreaterThan(19); // 18 máscaras + gerais + frasário
    for (const a of arquivos) {
      const { data, content } = matter(readFileSync(a, 'utf8'));
      // Campos de atribuição pessoal são proibidos no frontmatter da base
      for (const chave of ['medico', 'paciente', 'clinica']) {
        expect(Object.keys(data), `${a}: frontmatter contém campo proibido "${chave}"`).not.toContain(chave);
      }
      // `nome:` no frontmatter é o nome do EXAME (campo legítimo do schema de máscara);
      // sem esta exceção o padrão de linha rotulada do anonymizer o marcaria como nome de pessoa.
      const { nome: _nomeDoExame, ...resto } = data as Record<string, unknown>;
      const frontmatterComoLinhas = Object.entries(resto)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join('\n');
      const { findings } = sanitize(`${frontmatterComoLinhas}\n${content}`);
      const graves = findings.filter((f) => ['nome', 'cpf', 'telefone', 'id', 'crm', 'data'].includes(f.tipo));
      expect(graves, `${a}: ${JSON.stringify(graves)}`).toHaveLength(0);
    }
  });
});
