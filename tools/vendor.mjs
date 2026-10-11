// Copies the third-party files the site needs from node_modules into site/assets,
// so the website runs as plain static files with nothing loaded from other servers.
// Run after `npm install`:  npm run vendor
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const nm = 'node_modules';
const out = 'site/assets';

const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log('  ' + to);
};

// three.js core + the add-ons the viewer imports
rmSync(join(out, 'vendor/three'), { recursive: true, force: true });
const three = join(nm, 'three');
copy(join(three, 'build/three.module.min.js'), join(out, 'vendor/three/three.module.min.js'));
copy(join(three, 'LICENSE'), join(out, 'vendor/three/LICENSE'));
for (const f of [
  'loaders/GLTFLoader.js',
  'controls/OrbitControls.js',
  'utils/BufferGeometryUtils.js',
  'libs/meshopt_decoder.module.js',
]) copy(join(three, 'examples/jsm', f), join(out, 'vendor/three/addons', f));

// Self-hosted fonts (no request to Google's servers)
rmSync(join(out, 'fonts'), { recursive: true, force: true });
const fonts = {
  'saira-semi-condensed': [500, 600, 700],
  'ibm-plex-sans': [400, 500, 600],
  'ibm-plex-mono': [400, 500],
};
for (const [family, weights] of Object.entries(fonts)) {
  for (const w of weights) {
    const file = `${family}-latin-${w}-normal.woff2`;
    copy(join(nm, '@fontsource', family, 'files', file), join(out, 'fonts', file));
  }
  copy(join(nm, '@fontsource', family, 'LICENSE'), join(out, 'fonts', `${family}-LICENSE.txt`));
}
console.log('done');
