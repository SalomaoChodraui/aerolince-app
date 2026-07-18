import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const brand = join(process.cwd(), '..', 'branding draft', 'finalistas-D1.3', 'svg');

function render(svgPath, outPath, width, color) {
  let svg = readFileSync(svgPath, 'utf8');
  if (color) svg = svg.replace(/fill="#[0-9a-fA-F]{6}"/g, `fill="${color}"`);
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: 'rgba(0,0,0,0)' });
  writeFileSync(outPath, r.render().asPng());
  console.log(`${outPath} (${width}px)`);
}

// Tray: símbolo preto em fundo transparente (template image no mac adapta a dark/light)
render(join(brand, 'aerolince-symbol.svg'), 'build/trayTemplate.png', 16, '#000000');
render(join(brand, 'aerolince-symbol.svg'), 'build/trayTemplate@2x.png', 32, '#000000');
// Ícone do app (mac/win) a partir do app-icon quadrado da marca
render(join(brand, 'aerolince-app-icon.svg'), 'build/icon.png', 1024, null);
