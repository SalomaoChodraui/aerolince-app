import { describe, expect, it } from 'vitest';
import { encodeWavPcm16 } from '../core/audio/wav.js';
import type { STTProvider, STTResult } from '../core/stt/openai.js';
import { dedupAvisos, transcreverConsolidado } from './pipeline.js';

// `dedupAvisos` é o mecanismo que evita perder os avisos da sanitização
// original (feita antes do pedido de confirmação de máscara) quando
// `gerarComMascara` roda uma segunda `sanitizeComando` sobre um transcript já
// redigido — a segunda passagem não reencontra nome/CPF/ID/CRM/telefone
// (já viraram `[NOME]` etc.), então sem esse merge o médico nunca saberia que
// um identificador foi removido do comando original.
describe('dedupAvisos', () => {
  it('preserva os avisos originais quando a segunda passagem não repete nada (caso do transcript já redigido)', () => {
    const originais = ['removi um nome do comando por privacidade'];
    const segundaPassagem: string[] = [];
    expect(dedupAvisos(originais, segundaPassagem)).toEqual(originais);
  });

  it('remove duplicata exata quando o mesmo aviso aparece nas duas passagens (ex.: aviso de data, que não é redigida)', () => {
    const aviso = 'o comando cita uma data — confira se ela não identifica o paciente';
    expect(dedupAvisos([aviso], [aviso])).toEqual([aviso]);
  });

  it('preserva ordem: avisos da primeira lista primeiro, depois os novos da segunda', () => {
    expect(dedupAvisos(['aviso A'], ['aviso B'])).toEqual(['aviso A', 'aviso B']);
  });

  it('sem avisos em nenhuma lista, devolve array vazio', () => {
    expect(dedupAvisos([], [])).toEqual([]);
  });
});

function sttFake(respostas: string[]): STTProvider & { chamadas: { promptExtra?: string }[] } {
  const chamadas: { promptExtra?: string }[] = [];
  return {
    chamadas,
    async transcribe(): Promise<STTResult> {
      throw new Error('não usado');
    },
    async transcribeBuffer(_d, _f, promptExtra) {
      chamadas.push({ promptExtra });
      return {
        text: respostas[chamadas.length - 1]!,
        durationMs: 5,
        usage: { inputAudioTokens: 1000, inputTextTokens: 0, outputTokens: 100 },
      };
    },
  };
}

const wavValido = (): Buffer => encodeWavPcm16(new Int16Array(600)); // 1244 bytes > mínimo de 1024

describe('transcreverConsolidado', () => {
  it('encadeia a cauda do transcript anterior como promptExtra', async () => {
    const stt = sttFake(['primeira parte do laudo', 'segunda parte']);
    const r = await transcreverConsolidado(stt, [wavValido(), wavValido()], 'gpt-4o-transcribe');
    expect(r.transcript).toBe('primeira parte do laudo segunda parte');
    expect(stt.chamadas[0]!.promptExtra).toBeUndefined();
    expect(stt.chamadas[1]!.promptExtra).toContain('primeira parte do laudo');
  });

  it('soma custo por usage e uploadedBytes', async () => {
    const stt = sttFake(['a', 'b']);
    const r = await transcreverConsolidado(stt, [wavValido(), wavValido()], 'gpt-4o-transcribe');
    // 2 × (1000×$6/1M + 100×$10/1M)
    expect(r.custoSttUSD).toBeCloseTo(2 * (0.006 + 0.001), 6);
    expect(r.uploadedBytes).toBe(2 * 1244);
  });

  it('WAV vazio (44 bytes) dispara o guard "sem áudio" antes de qualquer chamada', async () => {
    const stt = sttFake(['x']);
    await expect(
      transcreverConsolidado(stt, [encodeWavPcm16(new Int16Array(0))], 'gpt-4o-transcribe'),
    ).rejects.toThrow(); // mensagem do validarAudio existente
    expect(stt.chamadas).toHaveLength(0);
  });
});
