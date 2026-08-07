import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { loadConfig } from './schema.js';

describe('bibliotecaBaseDir', () => {
  it('default deriva do appRoot', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'aero-cfg-'));
    const c = loadConfig(root);
    expect(c.bibliotecaBaseDir).toBe(resolve(root, 'biblioteca-base'));
  });
});
