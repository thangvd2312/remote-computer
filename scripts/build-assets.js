// Sinh tài nguyên dùng chung cho host + viewer vào thư mục shared/ (chạy: npm run build:assets)
//  - shared/fonts/*.woff2 + shared/fonts.css : Be Vietnam Pro (chữ, đủ dấu tiếng Việt) + Poppins (chữ số)
//  - shared/icons.js                         : icon Lucide dạng chuỗi SVG, dùng qua window.ICONS[name]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'shared');
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });

const FONTS = [
  { pkg: 'be-vietnam-pro', weights: [400, 500, 600], subsets: ['vietnamese', 'latin-ext', 'latin'] },
  { pkg: 'poppins', weights: [500, 600], subsets: ['latin'] },
];

let css = '/* Sinh tự động bởi scripts/build-assets.js — không sửa tay */\n';
for (const { pkg, weights, subsets } of FONTS) {
  for (const w of weights) {
    const src = fs.readFileSync(path.join(nm, '@fontsource', pkg, `${w}.css`), 'utf8');
    for (const block of src.split('@font-face').slice(1)) {
      const file = /files\/([^)]+?\.woff2)/.exec(block)?.[1];
      const subset = subsets.find((s) => file && file.startsWith(`${pkg}-${s}-${w}-normal`));
      if (!subset) continue;
      fs.copyFileSync(path.join(nm, '@fontsource', pkg, 'files', file), path.join(out, 'fonts', file));
      const family = /font-family:\s*([^;]+);/.exec(block)[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      css += `@font-face{font-family:${family};font-style:normal;font-display:swap;font-weight:${w};`
        + `src:url(fonts/${file}) format('woff2');${range ? `unicode-range:${range};` : ''}}\n`;
    }
  }
}
fs.writeFileSync(path.join(out, 'fonts.css'), css);

const ICONS = [
  'monitor', 'mouse-pointer-2', 'keyboard', 'clipboard', 'coffee', 'shield-check', 'network', 'wifi',
  'copy', 'refresh-cw', 'x', 'power', 'sliders-horizontal', 'house', 'chart-column', 'activity',
  'laptop', 'layout-grid', 'check', 'triangle-alert', 'external-link', 'terminal', 'maximize',
  'minimize', 'gauge', 'command', 'log-in', 'log-out', 'lock', 'ban', 'link', 'history',
  'chevron-down', 'info', 'circle-check', 'circle-x', 'monitor-cog', 'plug-zap',
  'download', 'sparkles', 'rotate-cw', 'package-check',
];
const icons = {};
for (const name of ICONS) {
  const svg = fs.readFileSync(path.join(nm, 'lucide-static', 'icons', `${name}.svg`), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/ class="[^"]*"/, ' class="icon" aria-hidden="true"')
    .replace(/ width="24" height="24"/, '')
    .trim();
  icons[name] = svg;
}
fs.writeFileSync(
  path.join(out, 'icons.js'),
  `// Sinh tự động bởi scripts/build-assets.js — icon từ Lucide (ISC license)\nwindow.ICONS = ${JSON.stringify(icons, null, 0)};\n`,
);

console.log(`fonts: ${fs.readdirSync(path.join(out, 'fonts')).length} files, icons: ${ICONS.length}`);
