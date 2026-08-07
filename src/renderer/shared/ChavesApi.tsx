import { useEffect, useRef, useState } from 'react';

const api = window.aerolince;

export type StatusCofre = { cofreDisponivel: boolean; chaves: Record<string, 'ok' | 'invalida' | 'ausente'> };

/** Descrições por chave conforme o motor de geração escolhido. */
function chaveInfo(provider: 'anthropic' | 'openai'): [string, string, boolean][] {
  // [nome, descrição, obrigatória]
  return [
    [
      'OPENAI_API_KEY',
      provider === 'openai'
        ? 'OpenAI — transcrição da voz E geração dos laudos (obrigatória)'
        : 'OpenAI — transcrição da voz (obrigatória)',
      true,
    ],
    [
      'ANTHROPIC_API_KEY',
      provider === 'anthropic'
        ? 'Claude — geração dos laudos (obrigatória)'
        : 'Claude — não usada no motor atual (guarde se quiser voltar ao modo recomendado)',
      provider === 'anthropic',
    ],
    ['MOONSHOT_API_KEY', 'Kimi — opcional, para testes', false],
  ];
}

/** Seção de chaves de API: status, salvar/testar/remover, autocontida (carrega o cofre no mount). */
export function ChavesApi({
  provider,
  compacto,
  onStatus,
}: {
  provider: 'anthropic' | 'openai';
  /** true no onboarding: esconde a linha do Moonshot. */
  compacto?: boolean;
  onStatus?: (s: StatusCofre) => void;
}) {
  const [cofre, setCofre] = useState<StatusCofre | null>(null);
  const [teste, setTeste] = useState<Record<string, string>>({});
  const [erroChave, setErroChave] = useState<string | null>(null);
  const [novaChave, setNovaChave] = useState<Record<string, string>>({});
  // Contador de geração por chave: descarta resultado de teste que chega depois de a
  // chave já ter sido trocada/removida ou de um novo teste ter sido disparado.
  const testeGen = useRef<Record<string, number>>({});

  useEffect(() => {
    void (async () => {
      setCofre(await api.secretsStatus());
    })();
  }, []);

  // Notifica o chamador a cada mudança de status (mount, salvar, remover).
  useEffect(() => {
    if (cofre) onStatus?.(cofre);
  }, [cofre]);

  async function rodarTeste(nome: string) {
    const geracao = (testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1);
    setTeste((s) => ({ ...s, [nome]: '…' }));
    const r = await api.secretsTestar(nome);
    if (testeGen.current[nome] !== geracao) return; // chave foi trocada/removida ou novo teste disparado
    setTeste((s) => ({ ...s, [nome]: r.ok ? '✓ chave válida' : `✗ ${r.erro ?? 'falhou'}` }));
  }

  async function gravarChave(nome: string) {
    const valor = novaChave[nome] ?? '';
    setErroChave(null);
    testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1;
    try {
      const novoCofre = await api.secretsSet(nome, valor);
      setCofre(novoCofre);
      setNovaChave((s) => ({ ...s, [nome]: '' }));
      setTeste((s) => ({ ...s, [nome]: '' }));
      if (novoCofre.chaves[nome] === 'ok') void rodarTeste(nome); // feedback imediato
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroChave(msg.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setTeste((s) => ({ ...s, [nome]: '' })); // não deixa o botão Testar travado em '…'
    }
  }
  async function removerChave(nome: string) {
    setErroChave(null);
    testeGen.current[nome] = (testeGen.current[nome] ?? 0) + 1;
    try {
      setCofre(await api.secretsSet(nome, ''));
      setTeste((s) => ({ ...s, [nome]: '' }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErroChave(msg.replace(/^Error invoking remote method '[^']+': Error: /, ''));
      setTeste((s) => ({ ...s, [nome]: '' })); // não deixa o botão Testar travado em '…'
    }
  }

  const chaves = chaveInfo(provider).filter(([nome]) => !(compacto && nome === 'MOONSHOT_API_KEY'));

  return (
    <>
      {cofre && !cofre.cofreDisponivel && (
        <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>
          O cofre do sistema não está disponível — não é possível salvar chaves com segurança nesta sessão.
        </div>
      )}
      {erroChave && (
        <div className="desc" style={{ padding: '4px 14px', color: '#c0392b' }}>{erroChave}</div>
      )}
      {chaves.map(([nome, desc, obrigatoria]) => {
        const st = cofre?.chaves[nome] ?? 'ausente';
        return (
          <div className="linha" key={nome}>
            <div style={{ flex: 1 }}>
              <div className="rot">
                {nome}{' '}
                {obrigatoria && st !== 'ok' && (
                  <span className="desc" style={{ color: '#c0392b' }}>● obrigatória</span>
                )}{' '}
                {st === 'ok' ? (
                  <span style={{ color: 'var(--oxido)' }}>● configurada</span>
                ) : st === 'invalida' ? (
                  <span style={{ color: '#c0392b' }}>● inválida — recoloque</span>
                ) : (
                  <span className="desc">não configurada</span>
                )}
                {teste[nome] && <span className="desc"> · {teste[nome]}</span>}
              </div>
              <div className="desc">{desc}</div>
            </div>
            <input
              type="password"
              placeholder={st === 'ok' ? '••••••••  (trocar)' : 'colar chave'}
              value={novaChave[nome] ?? ''}
              onChange={(e) => setNovaChave((s) => ({ ...s, [nome]: e.target.value }))}
              style={{ width: 180 }}
            />
            <button onClick={() => gravarChave(nome)} disabled={!(novaChave[nome] ?? '').trim()}>
              Salvar
            </button>
            {st === 'ok' && (
              <button onClick={() => rodarTeste(nome)} disabled={teste[nome] === '…'}>
                Testar
              </button>
            )}
            {st !== 'ausente' && (
              <button className="fantasma" onClick={() => removerChave(nome)} title="Remover a chave">
                ✕
              </button>
            )}
          </div>
        );
      })}
      <div className="desc" style={{ padding: '4px 14px' }}>
        As chaves ficam no cofre criptografado do sistema (Keychain / DPAPI). Ao ditar, o áudio é
        transcrito pela OpenAI e o texto sanitizado vai à{' '}
        {provider === 'openai' ? 'OpenAI' : 'Anthropic'} — não dite dados do paciente.
      </div>
    </>
  );
}
