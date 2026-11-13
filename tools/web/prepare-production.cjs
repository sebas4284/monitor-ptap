const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function prepare(directory) {
  const root = path.resolve(directory);
  const htmlPath = path.join(root, 'index.html');
  const found = new Map();
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else if (
        /^(Poppins_(400Regular|500Medium|600SemiBold)|Ionicons)\.[a-f0-9]+\.(ttf|woff2)$/.test(
          item.name,
        )
      ) {
        const name = item.name.split('.')[0];
        if (!found.has(name) || item.name.endsWith('.woff2'))
          found.set(name, '/' + path.relative(root, file).split(path.sep).join('/'));
      }
    }
  }
  visit(path.join(root, 'assets'));
  const fonts = [...found.values()];
  if (fonts.length !== 4) throw new Error(`Expected four used fonts, found ${fonts.length}`);
  const links = fonts
    .sort()
    .map(
      (url) =>
        `<link rel="preload" href="${url}" as="font" type="font/${url.endsWith('.woff2') ? 'woff2' : 'ttf'}" crossorigin>`,
    )
    .join('\n');
  const faces = fonts
    .map((url) => {
      const base = path.basename(url).split('.')[0];
      const family = base === 'Ionicons' ? 'ionicons-aquora-web' : base;
      return `@font-face{font-family:'${family}';src:url('${url}');font-display:swap;font-style:normal;font-weight:400;}`;
    })
    .join('\n');
  let html = fs.readFileSync(htmlPath, 'utf8').replace('lang="en"', 'lang="es"');
  html = html.replace(/<!-- aquora-fonts -->[\s\S]*?<!-- \/aquora-fonts -->\n?/g, '');
  html = html.replace(
    '</head>',
    `<!-- aquora-fonts -->\n${links}\n<style id="aquora-fonts">${faces}</style>\n<!-- /aquora-fonts -->\n</head>`,
  );
  fs.writeFileSync(htmlPath, html);
  function compress(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) compress(file);
      else if (/\.(js|css)$/.test(file)) {
        const bytes = fs.readFileSync(file);
        fs.writeFileSync(
          file + '.br',
          zlib.brotliCompressSync(bytes, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
        );
        fs.writeFileSync(file + '.gz', zlib.gzipSync(bytes, { level: 9 }));
      }
    }
  }
  compress(root);
  return fonts;
}
module.exports = { prepare };
if (require.main === module)
  console.log(`Preloaded ${prepare(process.argv[2] || 'apps/mobile/dist-audit').length} fonts`);
