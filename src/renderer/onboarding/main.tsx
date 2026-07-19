import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/brand.css';
import '../shared/window.css';
import './onboarding.css';
import { SimboloA } from '../shared/SimboloA.js';
import { iniciarTema } from '../shared/glass.js';

const api = window.aerolince;

interface Passo {
  icone: React.ReactNode;
  titulo: string;
  corpo: React.ReactNode;
}

const PASSOS: Passo[] = [
  {
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

function App() {
  const [i, setI] = useState(0);
  const [temChaves, setTemChaves] = useState(true);

  useEffect(() => {
    void iniciarTema();
    void (async () => {
      const s = await api.secretsStatus();
      setTemChaves(s.chaves.ANTHROPIC_API_KEY === 'ok' && s.chaves.OPENAI_API_KEY === 'ok');
    })();
  }, []);

  const ultimo = i === PASSOS.length - 1;
  const passo = PASSOS[i]!;

  return (
    <div className="janela onb">
      <div className="onb-arte">
        <div className="onb-icone">{passo.icone}</div>
      </div>
      <div className="onb-conteudo">
        <h1>{passo.titulo}</h1>
        <p>{passo.corpo}</p>

        {ultimo && !temChaves && (
          <div className="onb-aviso">
            Falta configurar suas <b>chaves de API</b> (Claude e transcrição) para começar a laudar.
            <button className="primario" onClick={() => api.abrir('settings')}>
              Abrir configurações
            </button>
          </div>
        )}

        <div className="onb-nav">
          <div className="onb-dots">
            {PASSOS.map((_, k) => (
              <span key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} />
            ))}
          </div>
          <div className="onb-botoes">
            {i > 0 && (
              <button className="fantasma" onClick={() => setI(i - 1)}>
                Voltar
              </button>
            )}
            {!ultimo ? (
              <button className="primario" onClick={() => setI(i + 1)}>
                Continuar
              </button>
            ) : (
              <button className="primario" onClick={() => api.concluirOnboarding()}>
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
