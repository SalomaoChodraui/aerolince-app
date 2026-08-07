import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import './onboarding.css';
import { SimboloA } from '../shared/SimboloA.js';
import { iniciarTema } from '../shared/glass.js';
import { ChavesApi } from '../shared/ChavesApi.js';
import type { RendererConfig } from '../shared/types.js';

const api = window.aerolince;

interface Passo {
  id: string;
  icone: React.ReactNode;
  titulo: string;
  corpo: React.ReactNode;
}

const PASSOS: Passo[] = [
  {
    id: 'bem-vindo',
    icone: <SimboloA size={52} />,
    titulo: 'Bem-vindo ao Aerolince',
    corpo: (
      <>
        Você dita um comando curto — <em>“essa tomo é uma diverticulite do cólon direito não complicada”</em> —
        e o Aerolince devolve o laudo completo, no seu jeito de escrever, já copiado para colar no seu sistema.
      </>
    ),
  },
  {
    id: 'ditar',
    icone: <span className="passo-emoji">🎙️</span>,
    titulo: 'Dite de qualquer lugar',
    corpo: (
      <>
        Clique no <b>botão flutuante</b> (o “A”, que fica por cima do seu visualizador) ou use o atalho{' '}
        <kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd>. Fale, clique de novo para parar — <kbd>Esc</kbd>{' '}
        cancela. Arraste o botão para onde preferir na tela.
      </>
    ),
  },
  {
    id: 'privacidade',
    icone: <span className="passo-emoji">🔒</span>,
    titulo: 'Voz na nuvem, laudo no seu computador',
    corpo: (
      <>
        Ao ditar, o <b>áudio</b> vai para a OpenAI virar texto, e o texto — após uma limpeza local de nomes e
        documentos — vai para a Anthropic (Claude) montar o laudo. Por isso, <b>dite achados, não dados do
        paciente</b>: nada de nome, prontuário ou data de nascimento. Máscaras e laudos ficam guardados apenas
        no seu computador.{' '}O app só registra os trechos em que você fala — pausas não são enviadas nem
        cobradas — e esses trechos ficam cifrados no seu computador só até a transcrição terminar.
      </>
    ),
  },
  {
    id: 'chaves',
    icone: <span className="passo-emoji">🔑</span>,
    titulo: 'Suas chaves de API',
    corpo: null, // renderizado como componente vivo (abaixo)
  },
  {
    id: 'revisar',
    icone: <span className="passo-emoji">📋</span>,
    titulo: 'Revise e cole',
    corpo: (
      <>
        O laudo aparece numa janela para você <b>revisar e ajustar</b>, já na área de transferência. Precisa
        mudar algo? Use <b>Refinar por voz</b> ali mesmo. O texto é sempre um rascunho — a assinatura é sua.
      </>
    ),
  },
  {
    id: 'bandeja',
    icone: <span className="passo-emoji">⚙️</span>,
    titulo: 'Tudo no menu da bandeja',
    corpo: (
      <>
        O ícone do Aerolince fica na <b>barra do sistema</b> (perto do relógio). Por ali você abre as
        <b> configurações</b>, o <b>histórico de laudos</b>, edita suas <b>frases padrão</b> e <b>fecha o app</b>.
      </>
    ),
  },
];

const CHAVES_IDX = PASSOS.findIndex((p) => p.id === 'chaves');

function App() {
  const [i, setI] = useState(0);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [chavesOk, setChavesOk] = useState(false);

  function avaliar(s: { chaves: Record<string, string> }, p: 'anthropic' | 'openai') {
    const okOpenai = s.chaves['OPENAI_API_KEY'] === 'ok';
    return p === 'anthropic' ? okOpenai && s.chaves['ANTHROPIC_API_KEY'] === 'ok' : okOpenai;
  }

  useEffect(() => {
    void iniciarTema();
    void (async () => {
      const c = (await api.configGet()) as RendererConfig;
      setProvider(c.llm.provider);
      const s = await api.secretsStatus();
      setChavesOk(avaliar(s, c.llm.provider));
    })();
  }, []);

  async function trocarMotor(p: 'anthropic' | 'openai') {
    setProvider(p);
    const c = (await api.configSet({
      llm:
        p === 'openai'
          ? { provider: p, selectionModel: 'gpt-5-mini', generationModel: 'gpt-5-mini', fastModel: 'gpt-5-mini' }
          : { provider: p, selectionModel: 'claude-haiku-4-5', generationModel: 'claude-haiku-4-5', fastModel: 'claude-haiku-4-5' },
    })) as RendererConfig;
    const s = await api.secretsStatus();
    setChavesOk(avaliar(s, c.llm.provider));
  }

  function irPara(k: number) {
    // Dots não pulam o gate: à frente do passo de chaves sem chavesOk, cai no passo de chaves.
    setI(!chavesOk && k > CHAVES_IDX ? CHAVES_IDX : k);
  }

  const ultimo = i === PASSOS.length - 1;
  const passo = PASSOS[i]!;
  const noPassoChaves = passo.id === 'chaves';

  return (
    <div className="janela onb">
      <div className="onb-arte">
        <div className="onb-icone">{passo.icone}</div>
      </div>
      <div className="onb-conteudo">
        <h1>{passo.titulo}</h1>
        {noPassoChaves ? (
          <div className="onb-chaves">
            <p>
              O Aerolince funciona com <b>as suas chaves de API</b> — você paga centavos por laudo direto ao
              provedor (~R$ 0,02–0,09 por laudo), sem mensalidade de inteligência embutida.
            </p>
            <p className="desc">
              Crie sua chave OpenAI em <b>platform.openai.com/api-keys</b>
              {provider === 'anthropic' && <> e sua chave Claude em <b>console.anthropic.com</b></>}
              . Cole abaixo — elas ficam só no cofre criptografado do seu computador.
            </p>
            <div className="onb-motor">
              <label>
                <input
                  type="radio"
                  name="motor"
                  checked={provider === 'anthropic'}
                  onChange={() => trocarMotor('anthropic')}
                />
                OpenAI + Anthropic (recomendado)
              </label>
              <label>
                <input
                  type="radio"
                  name="motor"
                  checked={provider === 'openai'}
                  onChange={() => trocarMotor('openai')}
                />
                Só OpenAI (uma chave para tudo)
              </label>
            </div>
            <ChavesApi provider={provider} compacto onStatus={(s) => setChavesOk(avaliar(s, provider))} />
          </div>
        ) : (
          <p>{passo.corpo}</p>
        )}

        <div className="onb-nav">
          <div className="onb-dots">
            {PASSOS.map((_, k) => (
              <span key={k} className={k === i ? 'on' : ''} onClick={() => irPara(k)} />
            ))}
          </div>
          <div className="onb-botoes">
            {i > 0 && (
              <button className="fantasma" onClick={() => setI(i - 1)}>
                Voltar
              </button>
            )}
            {!ultimo ? (
              <button
                className="primario"
                onClick={() => setI(i + 1)}
                disabled={noPassoChaves && !chavesOk}
                title={noPassoChaves && !chavesOk ? 'Salve e valide as chaves para continuar' : undefined}
              >
                Continuar
              </button>
            ) : (
              <button className="primario" onClick={() => api.concluirOnboarding()} disabled={!chavesOk}>
                Começar a laudar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
