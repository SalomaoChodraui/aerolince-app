import { useEffect, useRef, useState } from 'react';
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
    id: 'inteligencia',
    icone: <span className="passo-emoji">🧠</span>,
    titulo: 'Fica com a sua cara',
    corpo: (
      <>
        O Aerolince já sabe laudar TC com um <b>laudário clássico embutido</b> — e aprende o <b>SEU jeito</b>:
        quanto mais laudos seus você importar (das modalidades que você mais usa), mais o laudo sai com a sua
        cara. Sequência, jargões e detalhes técnicos: <b>seus</b>.
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
    id: 'importar',
    icone: <span className="passo-emoji">📥</span>,
    titulo: 'Importe seus laudos',
    corpo: null, // renderizado como componente vivo (abaixo), como o passo de chaves
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
        O ícone do Aerolince fica na <b>barra do sistema</b> (perto do relógio). Por ali você abre as{' '}
        <b>configurações</b>, o <b>histórico de laudos</b>, importa mais laudos quando quiser em{' '}
        <b>Importar meus laudos</b> e ajusta seu fraseado em <b>Meu estilo</b>.
      </>
    ),
  },
];

const CHAVES_IDX = PASSOS.findIndex((p) => p.id === 'chaves');

// Bump ao reordenar/adicionar/remover passos: invalida um `passo` salvo sob uma
// versão antiga (o índice passaria a apontar para um passo DIFERENTE do que o
// médico realmente viu por último) em vez de arriscar reabrir no lugar errado.
const VERSAO_PASSOS = 1;

function App() {
  const [i, setI] = useState(0);
  const [carregado, setCarregado] = useState(false);
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [chavesOk, setChavesOk] = useState(false);
  const [acervoImportado, setAcervoImportado] = useState(false);
  // Marca que o wizard de importação foi aberto por cima desta janela — o próximo
  // foco de volta (fechou/minimizou o filho) é o sinal de "voltou de lá" que usamos
  // para reavaliar o acervo (não há evento de "fechou" cruzando janelas hoje).
  const abriuImportarRef = useRef(false);

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
      const ok = avaliar(s, c.llm.provider);
      setChavesOk(ok);
      setAcervoImportado(c.onboarding.acervoImportado);
      // Retoma do passo salvo — só se for da MESMA versão de passos (senão o
      // índice pode apontar para um passo diferente do que era antes) — e NUNCA
      // além do gate de chaves se ele ainda não foi satisfeito (config pode ter
      // sido editada fora do wizard, ex.: chave removida nas Configurações desde
      // a última sessão de onboarding).
      const salvo = c.onboarding.versao === VERSAO_PASSOS ? c.onboarding.passo : 0;
      const alvo = salvo > 0 && salvo < PASSOS.length ? salvo : 0;
      setI(!ok && alvo > CHAVES_IDX ? CHAVES_IDX : alvo);
      if (c.onboarding.versao !== VERSAO_PASSOS) void api.configSet({ onboarding: { versao: VERSAO_PASSOS } });
      setCarregado(true);
    })();
    api.onConfigMudou((cfg) => {
      const c = cfg as RendererConfig;
      if (c.onboarding.acervoImportado) setAcervoImportado(true);
    });
  }, []);

  // Persiste o progresso a cada navegação — só depois que o passo salvo já foi
  // carregado (senão o valor inicial i=0 sobrescreveria um progresso existente
  // antes de sabermos onde o médico realmente parou).
  useEffect(() => {
    if (!carregado) return;
    void api.configSet({ onboarding: { passo: i } });
  }, [i, carregado]);

  useEffect(() => {
    function aoFocar() {
      if (!abriuImportarRef.current) return;
      abriuImportarRef.current = false;
      setAcervoImportado(true);
      void api.configSet({ onboarding: { acervoImportado: true } });
    }
    window.addEventListener('focus', aoFocar);
    return () => window.removeEventListener('focus', aoFocar);
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

  function abrirWizardImportar(): void {
    abriuImportarRef.current = true;
    void api.abrir('importar');
  }

  function irPara(k: number) {
    // Dots não pulam o gate: à frente do passo de chaves sem chavesOk, cai no passo de chaves.
    setI(!chavesOk && k > CHAVES_IDX ? CHAVES_IDX : k);
  }

  const ultimo = i === PASSOS.length - 1;
  const passo = PASSOS[i]!;
  const noPassoChaves = passo.id === 'chaves';
  const noPassoImportar = passo.id === 'importar';

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
        ) : noPassoImportar ? (
          <div className="onb-importar">
            <p>
              Em poucos minutos, o Aerolince lê seus laudos antigos (PDF, Word ou texto), separa por exame e
              mostra amostras anonimizadas para você revisar — só depois do seu OK explícito e de uma
              estimativa de custo é que ele usa a sua chave de API para aprender o seu fraseado.
            </p>
            {acervoImportado && <p className="onb-importar-ok">✓ Você já trouxe laudos seus para o Aerolince.</p>}
            <div className="onb-importar-acoes">
              <button className="primario" onClick={abrirWizardImportar}>
                {acervoImportado ? 'Importar mais laudos' : 'Importar meus laudos agora'}
              </button>
              <button className="fantasma" onClick={() => setI(i + 1)}>
                Fazer depois (Configurações → Meu estilo)
              </button>
            </div>
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
