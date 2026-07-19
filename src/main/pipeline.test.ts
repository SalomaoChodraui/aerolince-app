import { describe, expect, it } from 'vitest';
import { dedupAvisos } from './pipeline.js';

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
