// Sky Mirror 3D explorer: the full design model with orbit controls, a part list and part details.
import { createViewer, SWATCH, isPhone } from './viewer.js';

const $ = id => document.getElementById(id);

// Customer-facing descriptions, keyed by part-number prefix (longest match wins)
const NOTES = {
  'OPT-101': 'The primary mirror: a 150 mm parabola with a 750 mm focal length, aluminium coated. It gathers the light.',
  'OPT-102': 'The secondary mirror: an elliptical flat, 35 × 49.5 mm, that turns the light 90° out to the eyepiece.',
  'SM-201': 'The mirror box. It holds the mirror cell, carries the three numbered truss nodes and runs the trunnion plates in two slide rails.',
  'SM-205': 'Trunnion plate. Its groove drops onto the axle in the fork. It slides in the box rail by up to 40 mm to balance a phone.',
  'SM-206': 'Truss clamp knob. Twelve of them hold the carbon tubes, each pressing on an aluminium end plug, not on the carbon.',
  'SM-207': 'Steel altitude axle, 12 mm. It stays in the fork when you lift the tube out.',
  'SM-209': 'Brake rotor on the left axle, part of the altitude brake.',
  'SM-210': 'Steel trim discs that fine-tune the balance of the tube, held in their pockets by magnets.',
  'SM-211': 'Trunnion knob: clamps the axle in the trunnion groove without play.',
  'SM-220': 'The red die spring that loads the altitude brake.',
  'SM-222': 'Stop sleeve: the brake knob stops at about 2 N·m.',
  'SM-223': 'Needle thrust bearing: lets the brake knob turn smoothly under spring load.',
  'SM-228': 'Magnet that holds the steel trim stack in its pocket.',
  'SM-230': 'Slide clamp knob. Loosen it to slide the tube for phone balance, tighten it to lock.',
  'SM-301': 'The floating mirror cell. The mirror rests on three pads and is held clear of its edge.',
  'SM-302': 'Ball-end push screw for collimation, 3 of them under the cell.',
  'SM-303': 'Collimation knob: turn it to align the primary mirror, 2.52 arc minutes per click.',
  'SM-304': 'Kinematic seats: one cone, one vee and one flat locate the cell exactly, without strain.',
  'SM-305': 'Silicone pad, 1.5 mm thick, that the mirror floats on.',
  'SM-306': 'Spring-loaded hold-down bolt for the cell.',
  'SM-401': 'The secondary cage with three curved vanes. Its labels 1-2, 2-3 and 3-1 match the box, so it only fits one way.',
  'SM-402': 'The 45° holder that carries the secondary mirror.',
  'SM-403': 'Tilt screw for the secondary mirror, 7.96 arc minutes per click.',
  'SM-404': 'Thumbwheel for setting the secondary tilt by hand.',
  'SM-406': 'Central bolt of the secondary holder.',
  'SM-501': 'Pultruded carbon truss tube, 12 × 1 mm, 616 mm long. Six of them hold the cage over the mirror.',
  'SM-502': 'Aluminium end plug bonded into each carbon tube, so the clamp presses on metal.',
  'SM-611': 'The base hub: bearing seat, brake housing and three dovetails for the legs.',
  'SM-612': 'Leg. It slides onto a dovetail on the hub and locks with one knob.',
  'SM-614': 'Soft TPU foot pad, pressed into the leg.',
  'SM-615': 'Azimuth bearing: a 61820 thin-section ball bearing with a 100 mm bore.',
  'SM-617': 'Leg knob. Its tip seats in a dimple and pulls the leg tight.',
  'SM-620': 'One-piece fork arm, printed. It sits on three 45° seats and locks with two knobs.',
  'SM-621': 'Bearing cartridge in the fork arm: two ball bearings carry the altitude axle.',
  'SM-622': 'Ball bearing for the altitude axle, 2 per arm.',
  'SM-624': 'PTFE brake face: the only sliding surface of the altitude brake.',
  'SM-627': 'Cover ring that keeps grit out of the brake.',
  'SM-628': 'End cap on the right fork arm.',
  'SM-631': 'Turntable centre that the fork turns on.',
  'SM-632': 'Outrigger: the arm of the turntable that carries a fork arm on three seats.',
  'SM-637': 'Azimuth knob that sets how freely the telescope turns.',
  'SM-639': 'Fork arm knob, two per arm.',
  'SM-650': 'Aluminium spine under the turntable that ties both outriggers into one beam.',
  'SM-711': 'Focuser saddle that joins the focuser to the cage.',
  'SM-712': 'Aluminium focuser body.',
  'SM-713': 'The 1.25″ drawtube. It moves on a fine thread without turning.',
  'SM-714': 'Knurled focus ring: one degree of turn moves the eyepiece 2.78 µm.',
  'SM-715': 'Twist-lock cap: a quarter turn clamps the eyepiece.',
  'SM-720': 'Brass compression ring that grips the eyepiece barrel evenly.',
  'SM-812': 'Magnet ring in the back of the pivot plate that holds a MagSafe phone.',
  'SM-821': 'Eyepiece magnet ring. One stays on each eyepiece, with six magnets in its face.',
  'SM-822': 'Pivot plate: the phone sits on it and turns until the lens you want lines up with the eyepiece.',
  'SM-824': 'Lens carriage: slides under the phone lens and snaps onto the eyepiece ring.',
  'SM-825': 'Small disc magnet, 6 × 2 mm. Six pairs centre the phone over the eyepiece.',
  'REF Eyepiece': 'An eyepiece, shown as a 118 g reference body.',
  'REF Phone': 'A 220 g reference phone, used to check balance. Not part of the kit.',
};
const noteFor = n => { const ks = Object.keys(NOTES).filter(k => n.startsWith(k)).sort((a, b) => b.length - a.length); return ks.length ? NOTES[ks[0]] : ''; };
const splitName = n => {
  const m = n.match(/^((?:SM|OPT)-\d{3}[A-Z]?(?:-[LR])?)\s+(.*)$/);
  return m ? { pn: m[1], title: m[2].replace(/\s*\(bought\)$/, '') } : { pn: n.startsWith('REF') ? 'Reference' : '', title: n.replace(/^REF\s+/, '') };
};

const data = await (await fetch('assets/data/sm150-v5.json')).json();

// part list
const agg = {};
data.parts.forEach(p => { const a = agg[p.name] || (agg[p.name] = { name: p.name, mat: p.mat, group: p.group, qty: 0, mass: 0 }); a.qty++; a.mass += p.mass; });
const rows = Object.values(agg);
const GROUPS = [
  ['Optics', p => p.name.startsWith('OPT')],
  ['Tube', p => p.group === 'OTA' && !p.name.startsWith('OPT') && !p.name.startsWith('REF') && !isPhone(p.name)],
  ['Mount', p => p.group === 'MOUNT'],
  ['Phone adapter', p => isPhone(p.name) && !p.name.startsWith('REF')],
];
$('xp-parts').innerHTML = GROUPS.map(([g, f]) => {
  const list = rows.filter(f).sort((a, b) => a.name.localeCompare(b.name));
  const tot = list.reduce((s, p) => s + p.mass, 0);
  return `<div class="xp-group"><div class="xp-group-h"><span>${g}</span><span>${tot >= 1000 ? (tot / 1000).toFixed(2) + ' kg' : tot.toFixed(0) + ' g'}</span></div>` +
    list.map(p => {
      const { pn, title } = splitName(p.name);
      return `<button class="xp-part" type="button" data-n="${p.name.replace(/"/g, '&quot;')}"><span class="sw" style="background:${SWATCH[p.mat] || '#888'}"></span><span class="nm" title="${title}"><em>${pn}</em>${p.qty > 1 ? p.qty + '× ' : ''}${title}</span><span class="ms">${p.mass.toFixed(p.mass < 10 ? 1 : 0)} g</span></button>`;
    }).join('') + '</div>';
}).join('');
$('xp-count').textContent = `${rows.filter(p => !p.name.startsWith('REF')).length} types`;

// viewer
const viewer = createViewer($('xp-canvas'), {
  data, modelUrl: 'assets/models/sm150-v5.glb', interactive: true,
  onProgress: k => ($('xp-bar').style.width = Math.round(k * 100) + '%'),
});
try { await viewer.ready; } catch (err) {
  console.error(err);
  $('xp-loading').firstElementChild.textContent = 'The 3D model could not load. Please try another browser.';
  throw err;
}
$('xp-loading').hidden = true;
const ALL = Array(viewer.STEPS.length).fill(1);
viewer.go({ alt: 40, asm: ALL, rays: 1, view: 'iso' }, { instant: true });

// pose and display
$('alt').addEventListener('input', e => { $('alt-out').textContent = e.target.value + '°'; viewer.go({ alt: +e.target.value }, { instant: true }); });
$('apart').addEventListener('input', e => {
  const k = +e.target.value / 100;
  $('apart-out').textContent = e.target.value + ' %';
  if (k > 0 && +$('alt').value !== 90) { $('alt').value = 90; $('alt-out').textContent = '90°'; viewer.go({ alt: 90, view: 'all', frameAsm: viewer.asmApart(1), frame: viewer.PART }, { ms: 700 }); }
  viewer.setAssembly(viewer.asmApart(k));
});
$('t-rays').addEventListener('change', e => viewer.setRays(e.target.checked ? 1 : 0));
$('t-section').addEventListener('change', e => viewer.setSection(e.target.checked));
$('t-mount').addEventListener('change', e => viewer.setMount(e.target.checked));
$('t-phone').addEventListener('change', e => viewer.go({ phone: e.target.checked ? 1 : 0 }, { ms: 600 }));
document.querySelector('.xp-views').addEventListener('click', e => {
  const b = e.target.closest('button[data-view]'); if (!b) return;
  if (b.dataset.view === 'phone' && !$('t-phone').checked) { $('t-phone').checked = true; viewer.go({ phone: 1 }, { ms: 600 }); }
  viewer.go({ view: b.dataset.view }, { ms: 800 });
});

// part selection
function select(name) {
  viewer.select(name);
  document.querySelectorAll('.xp-part').forEach(b => b.classList.toggle('on', b.dataset.n === name));
  if (!name || !agg[name]) { $('xp-pick').hidden = true; return; }
  const a = agg[name], { pn, title } = splitName(name);
  $('xp-pick-pn').textContent = pn;
  $('xp-pick-name').textContent = (a.qty > 1 ? a.qty + '× ' : '') + title;
  $('xp-pick-note').textContent = noteFor(name);
  $('xp-pick-kv').textContent = `${(a.mass / a.qty).toFixed(1)} g each · ${a.group === 'OTA' ? (isPhone(name) ? 'phone adapter' : 'tube') : 'mount'}`;
  $('xp-pick').hidden = false;
}
$('xp-parts').addEventListener('click', e => {
  const b = e.target.closest('.xp-part'); if (!b) return;
  const n = b.dataset.n;
  if (isPhone(n) && !$('t-phone').checked) { $('t-phone').checked = true; viewer.go({ phone: 1 }, { ms: 600 }); }
  if (agg[n] && agg[n].group === 'MOUNT' && !$('t-mount').checked) { $('t-mount').checked = true; viewer.setMount(true); }
  select(n);
});
$('xp-pick-x').addEventListener('click', () => select(null));
let down = null;
const cv = $('xp-canvas');
cv.addEventListener('pointerdown', e => (down = [e.clientX, e.clientY]));
cv.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
  select(viewer.pick(e.clientX, e.clientY));
});
