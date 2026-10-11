// Sky Mirror home page: navigation, star field, the 3D story and the small interactive pieces.

const $ = id => document.getElementById(id);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const small = () => window.matchMedia('(max-width: 860px)').matches;

// ---------- navigation ----------
const nav = $('nav');
const onScrollNav = () => nav.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScrollNav, { passive: true }); onScrollNav();
$('nav-toggle').addEventListener('click', () => {
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  $('nav-toggle').setAttribute('aria-expanded', String(open));
});
$('nav-links').addEventListener('click', e => { if (e.target.closest('a')) { nav.classList.remove('open'); $('nav-toggle').setAttribute('aria-expanded', 'false'); } });

// ---------- star field ----------
// Seeded so the sky looks the same on every visit. Brightness follows a magnitude-like power law,
// colours run from blue-white to orange like real stellar temperatures, and a faint band suggests the Milky Way.
function drawSky() {
  const cv = $('sky'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  let seed = 150750;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tints = ['#b9d2ff', '#d8e4ff', '#f3f1ea', '#fff3dc', '#ffe0b8', '#ffc994'];
  // Milky Way band
  g.save(); g.translate(w * 0.62, h * 0.5); g.rotate(-0.52);
  const band = g.createLinearGradient(0, -h * 0.28, 0, h * 0.28);
  band.addColorStop(0, 'rgba(120,140,170,0)'); band.addColorStop(0.5, 'rgba(120,140,170,0.07)'); band.addColorStop(1, 'rgba(120,140,170,0)');
  g.fillStyle = band; g.fillRect(-w, -h * 0.28, w * 2, h * 0.56); g.restore();
  const n = Math.round((w * h) / 2300);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h, m = Math.pow(rnd(), 3.2);
    // denser along the band
    const bx = x - w * 0.62, by = y - h * 0.5, d = Math.abs(bx * Math.sin(0.52) + by * Math.cos(0.52)) / (h * 0.28);
    if (d > 1 && rnd() < 0.45) continue;
    const r = 0.35 + m * 1.35, a = 0.25 + m * 0.75;
    g.globalAlpha = a; g.fillStyle = tints[Math.floor(rnd() * tints.length)];
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (m > 0.75) { g.globalAlpha = 0.12; g.beginPath(); g.arc(x, y, r * 3.2, 0, Math.PI * 2); g.fill(); }
  }
  g.globalAlpha = 1;
}
drawSky();
let skyT; window.addEventListener('resize', () => { clearTimeout(skyT); skyT = setTimeout(drawSky, 150); });

// ---------- the 3D story ----------
const BUILD_STEPS = [
  ['Legs onto the hub', 'Slide each leg onto its dovetail on the hub and turn its knob down. The knob tip drops into a dimple and pulls the leg tight.'],
  ['Fork arms onto the base', 'Set each arm on the three 45° seats of its outrigger and tighten its two knobs. The seats take out all play.'],
  ['Truss tubes into the mirror box', 'Push the six carbon tubes into the box sockets, two per numbered node: 1, 2 and 3.'],
  ['Cage onto the tubes', 'Lower the cage with its labels 1-2, 2-3 and 3-1 over the matching nodes. It only fits one way.'],
  ['Tighten twelve knobs', 'Turn the truss knobs finger-tight, six at the box and six at the cage. Each one presses on an aluminium end plug.'],
  ['Tube into the fork', 'Turn both axle flats upright, lower the tube until its grooves sit on the axles, then tighten the two knobs on the trunnion plates.'],
  ['Eyepiece in', 'Drop the eyepiece into the focuser and give the cap a quarter turn to clamp it. Focus with the knurled ring.'],
  ['Balance for a phone', 'Loosen the two slide knobs and slide the tube toward the mirror: 37 mm for a 220 g phone. Tighten them again.', true],
  ['Phone on', 'Put the phone on the pivot plate, turn it to the lens you want and let the carriage snap onto the eyepiece ring.', true],
];
const NB = BUILD_STEPS.length;
const ticks = $('b-ticks');
BUILD_STEPS.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.setAttribute('aria-label', `Step ${i + 1}: ${s[0]}`);
  b.innerHTML = '<i></i>';
  b.addEventListener('click', () => scrollToBuildStep(i));
  ticks.appendChild(b);
});
function showBuildStep(i, done) {
  const s = BUILD_STEPS[Math.min(i, NB - 1)];
  $('b-num').innerHTML = `${Math.min(i, NB - 1) + 1}<small>/ ${NB}</small>`;
  $('b-title').innerHTML = done ? 'Ready for the sky' : s[0] + (s[2] ? '<span class="optional">for photos</span>' : '');
  $('b-text').textContent = done ? 'That is the whole build: nine steps, no tools. Point it at the Moon.' : s[1];
  $('b-label').textContent = done ? 'Done' : 'Scroll to assemble';
  [...ticks.children].forEach((b, k) => { b.classList.toggle('done', done || k < i); b.classList.toggle('on', !done && k === i); });
}
showBuildStep(0, false);
const buildEl = $('build');
function buildProgress() {
  const r = buildEl.getBoundingClientRect();
  const span = buildEl.offsetHeight - window.innerHeight;
  return Math.min(1, Math.max(0, -r.top / Math.max(1, span)));
}
function scrollToBuildStep(i) {
  const span = buildEl.offsetHeight - window.innerHeight;
  const y = buildEl.getBoundingClientRect().top + window.scrollY + span * ((i + 0.55) / (NB + 0.6));
  window.scrollTo({ top: y, behavior: reduce.matches ? 'auto' : 'smooth' });
}

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

async function startStory() {
  const stage = $('stage'), status = $('stage-status'), bar = $('stage-bar');
  if (!webglOK()) { stage.classList.add('fallback'); status.hidden = true; return; }
  let viewer;
  try {
    const [{ createViewer }, data] = await Promise.all([
      import('./viewer.js'),
      fetch('assets/data/sm150-v5.json').then(r => r.json()),
    ]);
    viewer = createViewer($('scope'), {
      data, modelUrl: 'assets/models/sm150-v5.glb',
      onProgress: k => (bar.style.width = Math.round(k * 100) + '%'),
    });
    await viewer.ready;
  } catch (err) {
    console.error(err);
    stage.classList.add('fallback'); status.hidden = true; return;
  }
  status.hidden = true;

  const ALL = Array(viewer.STEPS.length).fill(1);
  const frame = name => (small() ? { x: 0.5, y: name === 'hero' ? 0.27 : 0.34 } : { x: 0.67, y: 0.5 });
  const apartCam = () => {
    const A = viewer.asmForBuild(0);
    return { view: 'all', asm: A, dir: { x: 1500, y: 600, z: 1750 }, margin: small() ? 1.25 : 1.06 };
  };
  const chapters = {
    hero: () => ({ alt: 40, asm: ALL, rays: 0.45, phone: 0, section: false, hl: [], view: 'hero', sway: true }),
    optics: () => ({ alt: 40, asm: ALL, rays: 1, phone: 0, section: true, hl: [], view: 'side', sway: false }),
    truss: () => ({ alt: 40, asm: ALL, rays: 0, phone: 0, section: false, hl: ['SM-501', 'SM-502', 'SM-206'], view: 'truss', sway: false }),
    mount: () => ({ alt: 40, asm: ALL, rays: 0, phone: 0, section: false, hl: ['SM-6'], view: 'mount', sway: false }),
    box: () => { const c = apartCam(); return { alt: 90, asm: c.asm, frameAsm: c.asm, rays: 0, phone: 0, section: false, hl: [], view: 'all', dir: c.dir, margin: c.margin, sway: false }; },
    build: () => { const c = apartCam(); return { alt: 90, frameAsm: c.asm, rays: 0, section: false, view: 'all', dir: c.dir, margin: c.margin, sway: false, keepAsm: true }; },
    phone: () => ({ alt: 32, asm: ALL, rays: 0, phone: 1, section: false, hl: [], view: 'phone', sway: false }),
  };
  let current = null, lastStep = -1;
  function enter(name, instant) {
    if (name === current) return;
    current = name;
    const s = chapters[name]();
    s.framing = frame(name);
    if (s.dir) s.dir = new viewer.camera.position.constructor(s.dir.x, s.dir.y, s.dir.z);
    if (s.keepAsm) {
      // the build chapter: assembly follows the scroll position, camera frames the whole kit
      delete s.keepAsm;
      s.frame = viewer.PART;
      const v = buildProgress() * (NB + 0.6) - 0.3;
      viewer.go({ ...s, asm: viewer.asmForBuild(v), phone: v >= 7 ? 1 : 0 }, { instant, ms: 900 });
      lastStep = -1;
      requestAnimationFrame(() => onBuildScroll());
      return;
    }
    if (s.view === 'all') s.frame = viewer.PART;
    viewer.go(s, { instant, ms: 1100 });
  }

  // which chapter crosses the middle of the screen
  const els = [...document.querySelectorAll('[data-chapter]')];
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) enter(en.target.dataset.chapter); });
  }, { rootMargin: '-50% 0px -50% 0px' });
  els.forEach(el => io.observe(el));
  // first state without animation
  const mid = window.innerHeight / 2;
  const first = els.find(el => { const r = el.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid; }) || els[0];
  enter(first.dataset.chapter, true);

  // build scrubbing
  let raf = 0;
  function onBuildScroll() {
    raf = 0;
    if (current !== 'build') return;
    const v = buildProgress() * (NB + 0.6) - 0.3;          // a little hold at both ends
    const A = viewer.asmForBuild(v);
    viewer.setAssembly(A);
    const done = v >= NB;
    const i = Math.max(0, Math.min(NB - 1, Math.floor(v)));
    const key = done ? NB : i;
    if (key !== lastStep) {
      lastStep = key; showBuildStep(i, done);
      const ids = viewer.ownerSteps();
      viewer.go({ hl: done ? [] : (viewer.STEPS.find(s => s.id === ids[i]).hl || []), phone: done || i >= 7 ? 1 : 0 }, { ms: 500 });
    }
  }
  window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(onBuildScroll); }, { passive: true });

  // stop rendering once the story has scrolled away
  const story = $('story');
  new IntersectionObserver(([en]) => {
    viewer.setActive(en.isIntersecting);
    stage.classList.toggle('off', !en.isIntersecting);
  }, { rootMargin: '0px 0px -15% 0px' }).observe(story);

  let rT;
  window.addEventListener('resize', () => {
    clearTimeout(rT);
    rT = setTimeout(() => { const c = current; current = null; enter(c, true); }, 200);
  });
}
// load the model after the page has painted
if ('requestIdleCallback' in window) requestIdleCallback(() => startStory(), { timeout: 600 });
else setTimeout(startStory, 200);

// ---------- eyepiece field of view ----------
const FOV = { 25: { mag: 30, tf: 1.67 }, 10: { mag: 75, tf: 0.67 }, 4: { mag: 188, tf: 0.27 } };
const MOON = 0.52; // degrees
function drawFov(f) {
  const cv = $('fov'), g = cv.getContext('2d'), S = cv.width, R = S / 2 - 6;
  const { tf } = FOV[f];
  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#020305'; g.fillRect(0, 0, S, S);
  // a few faint field stars
  let seed = f * 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) { g.globalAlpha = 0.2 + rnd() * 0.6; g.fillStyle = '#dfe6f0'; g.beginPath(); g.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 1.1, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  // the Moon, to scale: R px = tf/2 degrees
  const mr = (MOON / 2) / (tf / 2) * R;
  const cx = S / 2 + (f === '4' || f === 4 ? mr * 0.55 : 0), cy = S / 2 + (f === '4' || f === 4 ? -mr * 0.2 : 0);
  const lit = g.createRadialGradient(cx - mr * 0.3, cy - mr * 0.3, mr * 0.1, cx, cy, mr);
  lit.addColorStop(0, '#e9e6dc'); lit.addColorStop(0.75, '#c9c5b9'); lit.addColorStop(1, '#a29e93');
  g.fillStyle = lit; g.beginPath(); g.arc(cx, cy, mr, 0, Math.PI * 2); g.fill();
  // maria, roughly where they sit on the near side
  const maria = [[-0.32, -0.38, 0.30, 0.22], [0.05, -0.36, 0.17, 0.14], [0.22, -0.05, 0.2, 0.17], [0.58, -0.22, 0.12, 0.1], [-0.5, 0.0, 0.28, 0.42], [0.18, 0.28, 0.17, 0.14], [-0.15, 0.32, 0.15, 0.1], [0.42, 0.25, 0.1, 0.12]];
  g.save(); g.beginPath(); g.arc(cx, cy, mr, 0, Math.PI * 2); g.clip();
  maria.forEach(([x, y, rx, ry]) => { g.fillStyle = 'rgba(84,86,88,0.55)'; g.beginPath(); g.ellipse(cx + x * mr, cy + y * mr, rx * mr, ry * mr, 0.3, 0, Math.PI * 2); g.fill(); });
  // a few craters
  seed = 4242;
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.92, cr = (0.015 + rnd() * 0.045) * mr;
    const x = cx + Math.cos(a) * d * mr, y = cy + Math.sin(a) * d * mr;
    g.strokeStyle = 'rgba(70,70,68,0.45)'; g.lineWidth = Math.max(1, cr * 0.25); g.beginPath(); g.arc(x, y, cr, 0, Math.PI * 2); g.stroke();
  }
  // Tycho with its bright rays
  g.fillStyle = 'rgba(250,248,240,0.9)'; g.beginPath(); g.arc(cx - 0.12 * mr, cy + 0.7 * mr, 0.035 * mr, 0, Math.PI * 2); g.fill();
  g.restore();
  g.restore();
  // field stop
  g.strokeStyle = '#1e2834'; g.lineWidth = 10; g.beginPath(); g.arc(S / 2, S / 2, R + 2, 0, Math.PI * 2); g.stroke();
  const across = tf / MOON;
  $('fov-cap').textContent = across >= 1
    ? `${f} mm eyepiece: a ${tf.toFixed(2)}° circle of sky at ${FOV[f].mag}×. The full Moon, ${MOON}° across, fits about ${across.toFixed(1).replace('.0', '')} times.`
    : `${f} mm eyepiece: a ${tf.toFixed(2)}° circle at ${FOV[f].mag}×, about half the Moon. You scan along the terminator crater by crater.`;
}
$('fov-seg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('fov-seg').children].forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  drawFov(b.dataset.f);
});
drawFov('25');

// ---------- sign-up ----------
const form = $('notify-form'), msg = $('form-msg');
form.addEventListener('submit', async e => {
  e.preventDefault();
  msg.classList.remove('err');
  const email = $('email').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'Please enter a valid email address.'; msg.classList.add('err'); $('email').focus(); return; }
  if (!$('consent').checked) { msg.textContent = 'Please tick the box so we may email you.'; msg.classList.add('err'); return; }
  const endpoint = form.dataset.endpoint;
  if (!endpoint) { msg.textContent = 'Sign-up is not connected yet. This is a preview of the site.'; msg.classList.add('err'); return; }
  try {
    const res = await fetch(endpoint, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    form.reset();
    msg.textContent = 'Thanks. Please confirm with the link in the email we just sent you.';
  } catch (err) {
    msg.textContent = 'That did not go through. Please try again in a moment.'; msg.classList.add('err');
  }
});
