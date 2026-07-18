/** Aplica/atualiza o modo liquid glass (data-glass no root) a partir da config. */
export function aplicarGlass(config: unknown): void {
  const glass = Boolean((config as { ui?: { liquidGlass?: boolean } })?.ui?.liquidGlass);
  document.documentElement.dataset.glass = glass ? '1' : '0';
}

/** Carrega a config, aplica o glass e reaplica quando o main avisar que mudou. */
export async function iniciarTema(): Promise<void> {
  aplicarGlass(await window.aerolince.configGet());
  window.aerolince.onConfigMudou(aplicarGlass);
}
