// Sky Mirror 3D viewer.
// Loads the SM-150/750 model exported from Fusion (V5 Kit, version 15) and renders it with
// physically based materials. Ported from the Sky Mirror V5 design viewer: same materials,
// same exploded-view rules, retuned for a night-sky page background.
//
// The model is Z-up in millimetres. Every part node carries its part name; part data
// (material, group, mass) comes from assets/data/sm150-v5.json.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const D2R = Math.PI / 180;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const sgn = v => (v < 0 ? -1 : 1);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeCam = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const has = (n, list) => list.some(k => n.startsWith(k));
export const isPhone = n => /^(SM-80|SM-81|SM-82|REF Phone)/.test(n);

// Parts that stay with the trunnion plates when the tube slides to balance a phone
const FIXRE = /^SM-(205|207|209|211|212|218|219|220|221|222|223|224|225|226|227)\b/;
export const PHONE_SLIDE_MM = 37; // 220 g reference phone

// ---------- materials ----------
export const SWATCH = {
  graphite: '#3a3e44', black: '#1f2124', titan: '#5a5e64', lightgrey: '#c9cac5', tpugrey: '#bdbfba',
  alu: '#c4c8cd', carbon: '#1d1f23', brass: '#c8a24a', phone: '#3b4048', bronze: '#b08a5a',
  mirror: '#e9ecef', glass: '#9fc6c0', steel: '#b8bcc2', ptfe: '#eeebe3', rubber: '#2a2c2f',
  silicone: '#d9e1e4', eyepiece: '#1e2024', red: '#b22a24', zinc: '#b9bec4',
};
const MATDEF = {
  graphite: { c: 0x3a3e44, r: 0.72, m: 0.0, mode: 1, e: 0.85 },
  black: { c: 0x1f2124, r: 0.70, m: 0.0, mode: 1, e: 0.85 },
  titan: { c: 0x5a5e64, r: 0.70, m: 0.0, mode: 1, e: 0.85 },
  lightgrey: { c: 0xc9cac5, r: 0.80, m: 0.0, mode: 1, e: 0.65 },
  tpugrey: { c: 0xbdbfba, r: 0.93, m: 0.0, mode: 1, e: 0.5 },
  carbon: { c: 0x1c1e22, r: 0.48, m: 0.0, cc: 0.12, ccr: 0.45, mode: 2, e: 0.8 },
  alu: { c: 0xc6cace, r: 0.30, m: 1.0, mode: 3, e: 1.0 },
  bronze: { c: 0xb07f4a, r: 0.32, m: 1.0, mode: 3, e: 1.0 },
  steel: { c: 0xc8ccd2, r: 0.26, m: 1.0, mode: 4, e: 1.0 },
  zinc: { c: 0xb9bec4, r: 0.42, m: 0.8, mode: 4, e: 1.15 },
  mirror: { c: 0xf0f3f6, r: 0.03, m: 1.0, mode: 0, e: 1.2 },
  ptfe: { c: 0xece9e2, r: 0.55, m: 0.0, sh: 0.5, mode: 0, e: 0.8 },
  silicone: { c: 0xdfe6e9, r: 0.42, m: 0.0, sh: 0.3, mode: 0, e: 0.8 },
  rubber: { c: 0x2a2c2f, r: 0.92, m: 0.0, mode: 1, e: 0.6 },
  brass: { c: 0xcaa156, r: 0.30, m: 1.0, mode: 3, e: 1.0 },
  eyepiece: { c: 0x1e2024, r: 0.40, m: 0.55, mode: 3, e: 1.0 },
  glass: { c: 0x9fc6c0, r: 0.05, m: 0.0, mode: 0, e: 1.0 },
  phone: { c: 0x3a3f47, r: 0.22, m: 0.35, cc: 0.6, ccr: 0.15, mode: 0, e: 1.1 },
  red: { c: 0xb22a24, r: 0.42, m: 0.35, mode: 4, e: 0.9 },
};
// Procedural surface detail: print layer lines (1), carbon fibre streaks (2), brushed metal (3, 4)
const NOISE = `
uniform int uMode; uniform vec3 uAxis; uniform vec3 uOrigin; uniform vec3 uE1; uniform vec3 uE2;
varying vec3 vObjPos;
float h13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y)*p.z); }
float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), f.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), f.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), f.x), f.y), f.z); }
`;
const SURF = `
float smMod = 0.0;
if(uMode == 1){
  float z = vObjPos.z; float w = fwidth(z);
  float l = 0.5 + 0.5*cos(6.2831853*z/0.2);
  float fade = 1.0 - smoothstep(0.02, 0.10, w);
  float n = vn(vObjPos*1.7)*0.7 + vn(vObjPos*6.0)*0.3;
  diffuseColor.rgb *= (0.95 + 0.10*n)*(1.0 - 0.10*fade*l);
  smMod = (n - 0.5)*0.14 + 0.06*fade*l;
} else if(uMode == 2){
  vec3 d = vObjPos - uOrigin; float t = dot(d, uAxis); vec3 r = d - t*uAxis;
  float u = atan(dot(r, uE1), dot(r, uE2))*6.0;
  float s = vn(vec3(u*2.2, t*0.035, 0.5))*0.65 + vn(vec3(u*7.0, t*0.09, 3.7))*0.35;
  diffuseColor.rgb *= 0.74 + 0.52*s; smMod = (s - 0.5)*0.26;
} else if(uMode == 3){
  float n = vn(vObjPos*3.0)*0.6 + vn(vObjPos*11.0)*0.4;
  diffuseColor.rgb *= 0.97 + 0.06*n; smMod = (n - 0.5)*0.10;
} else if(uMode == 4){
  smMod = (vn(vObjPos*4.0) - 0.5)*0.08;
}
`;

function tubeFrame(geo, deq, U) {
  const p = geo.attributes.position, v = new THREE.Vector3(), mean = new THREE.Vector3();
  const step = Math.max(1, Math.floor(p.count / 2500)); let n = 0; const pts = [];
  for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(deq); pts.push(v.clone()); mean.add(v); n++; }
  mean.multiplyScalar(1 / n);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  pts.forEach(q => { const x = q.x - mean.x, y = q.y - mean.y, z = q.z - mean.z; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[4] += y * y; C[5] += y * z; C[8] += z * z; });
  C[3] = C[1]; C[6] = C[2]; C[7] = C[5];
  let a = V3(0.3, 0.2, 0.93).normalize();
  for (let k = 0; k < 40; k++) a = V3(C[0] * a.x + C[1] * a.y + C[2] * a.z, C[3] * a.x + C[4] * a.y + C[5] * a.z, C[6] * a.x + C[7] * a.y + C[8] * a.z).normalize();
  const e1 = new THREE.Vector3().crossVectors(a, Math.abs(a.x) < 0.9 ? V3(1, 0, 0) : V3(0, 1, 0)).normalize();
  U.uAxis.value.copy(a); U.uOrigin.value.copy(mean); U.uE1.value.copy(e1); U.uE2.value.crossVectors(a, e1);
}

function makeMat(key, mesh, deq) {
  const d = MATDEF[key] || MATDEF.graphite;
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(d.c), roughness: d.r, metalness: d.m, clearcoat: d.cc || 0, clearcoatRoughness: d.ccr || 0,
    sheen: d.sh || 0, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), vertexColors: true, envMapIntensity: d.e || 1,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const U = { uMode: { value: d.mode || 0 }, uAxis: { value: V3(0, 0, 1) }, uOrigin: { value: new THREE.Vector3() }, uE1: { value: V3(1, 0, 0) }, uE2: { value: V3(0, 1, 0) }, uDeq: { value: deq } };
  if (d.mode === 2) tubeFrame(mesh.geometry, deq, U);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uDeq;\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = (uDeq*vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + NOISE)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + SURF)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + smMod, 0.03, 1.0);');
  };
  m.customProgramCacheKey = () => 'sky-mirror-v5';
  return m;
}
const EDGE_C = new THREE.Color(0x0b0d10);
const makeEdgeMat = () => new THREE.LineBasicMaterial({ color: EDGE_C.clone(), transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false });

// ---------- exploded-view rules (from the V5 viewer) ----------
// Assembly order: F = done at the bench before shipping, S = the steps the owner does.
const LIFT = 500;
const LEVELS = {
  tube: { p: null, v: e => V3(0, 0, LIFT), st: 'S6', sub: 0.05 },
  truss: { p: 'tube', v: e => V3(0, 0, 110), st: 'S3', sub: 0 },
  cage: { p: 'tube', v: e => V3(0, 0, 220), st: 'S4', sub: 0 },
  sec: { p: 'cage', v: e => V3(0, 0, 80), st: 'F2', sub: 0.2 },
  cell: { p: 'tube', v: e => V3(0, 0, -150), st: 'F1', sub: 0.3 },
  tpl: { p: 'tube', v: e => V3(sgn(e.c.x) * 60, 0, 0), st: 'F1', sub: 0.55 },
  ep: { p: 'cage', v: e => V3(175, 0, 0), st: 'S7', sub: 0 },
  pp: { p: 'ep', v: e => V3(92, 0, 0), st: 'S9', sub: 0.45 },
  tt: { p: null, v: e => V3(0, 0, 80), st: 'F5', sub: 0.4 },
  out: { p: 'tt', v: e => V3(sgn(e.c.x) * 45, 0, 0), st: 'F5', sub: 0.62 },
  arm: { p: 'out', v: e => V3(sgn(e.c.x) * 30, 0, 70), st: 'S2', sub: 0 },
};
const MODES = {
  z: (e, d) => V3(0, 0, d),
  x: (e, d) => V3(d, 0, 0),
  sx: (e, d) => V3(sgn(e.c.x) * d, 0, 0),
  sy: (e, d) => V3(0, sgn(e.c.y) * d, 0),
  rad: (e, d) => { const r = Math.hypot(e.c.x, e.c.y) || 1; return V3(e.c.x / r * d, e.c.y / r * d, 0); },
  radYZ: (e, d) => { const y = e.c.y, z = e.c.z - 610, r = Math.hypot(y, z) || 1; return V3(0, y / r * d, z / r * d); },
  spread: (e, d) => { const r = Math.hypot(e.c.x, e.c.y) || 1, k = d + (r - 85.6) * 4; return V3(e.c.x / r * k, e.c.y / r * k, 0); },
  fan: (e, d) => V3(e.fanX, 0, 0),
};
const CART = ['SM-207', 'SM-208', 'SM-209', 'SM-218', 'SM-219', 'SM-220', 'SM-221', 'SM-222', 'SM-223', 'SM-224', 'SM-225', 'SM-226', 'SM-227', 'SM-621', 'SM-622', 'SM-623', 'SM-624', 'SM-625', 'SM-626', 'SM-627', 'SM-628', 'SM-629'];
const RULES = [
  { m: 'OPT-101', L: 'cell', own: [['z', 45, 'F1', 0]] },
  { m: 'SM-305', L: 'cell', own: [['z', 30, 'F1', 0]] },
  { m: 'SM-304', L: 'cell', own: [['z', -12, 'F1', 0.1]] },
  { m: 'SM-301', L: 'cell' },
  { m: 'SM-302', L: 'cell', own: [['z', -30, 'F1', 0.62]] },
  { m: 'SM-303', L: 'cell', own: [['z', -52, 'F1', 0.78]] },
  { m: 'SM-307', L: 'cell', own: [['z', -26, 'F1', 0.66]] },
  { m: 'SM-309', L: 'cell', own: [['z', -40, 'F1', 0.74]] },
  { m: 'SM-306', L: 'cell', own: [['z', -78, 'F1', 0.86]] },
  { m: 'SM-210', L: 'tube', own: [['z', -36, 'F1', 0.2]] },
  { m: ['SM-205', 'SM-212'], L: 'tpl' },
  { m: 'SM-211', L: 'tpl', own: [['sy', 30, 'S6', 0.62]] },
  { m: 'SM-228', L: 'tube' },
  { m: 'SM-230', L: 'tube', own: [['sy', 28, 'S8', 0]] },
  { m: 'SM-231', L: 'tube' },
  { m: 'SM-201', L: 'tube' },
  { m: 'SM-215', when: e => e.c.z < -20, L: 'cell' },
  { m: 'SM-215', when: e => e.c.z > 620, L: 'sec' },
  { m: 'SM-215', when: e => e.c.z > 500, L: 'cage' },
  { m: 'SM-216', L: 'cage' },
  { m: ['SM-501', 'SM-502'], L: 'truss' },
  { m: 'SM-206', when: e => e.c.z > 300, L: 'cage', own: [['rad', 30, 'S5', 0]] },
  { m: 'SM-206', L: 'tube', own: [['rad', 30, 'S5', 0]] },
  { m: 'SM-401', L: 'cage' },
  { m: ['SM-402', 'OPT-102', 'SM-405'], L: 'sec' },
  { m: 'SM-403', L: 'sec', own: [['z', 28, 'F2', 0.5]] },
  { m: 'SM-404', L: 'sec', own: [['z', 44, 'F2', 0.6]] },
  { m: 'SM-407', L: 'sec', own: [['z', 56, 'F2', 0.7]] },
  { m: 'SM-408', L: 'sec', own: [['z', 68, 'F2', 0.76]] },
  { m: 'SM-406', L: 'sec', own: [['z', 115, 'F2', 0.86]] },
  { m: 'SM-711', L: 'cage', own: [['x', 12, 'F3', 0]] },
  { m: 'SM-719', L: 'cage', own: [['x', 32, 'F3', 0.25], ['x', 46, 'F3', 0.9]] },
  { m: 'SM-717', L: 'cage', own: [['x', 22, 'F3', 0.15]] },
  { m: 'SM-712', L: 'cage', own: [['x', 32, 'F3', 0.25]] },
  { m: ['SM-718', 'SM-716'], L: 'cage', own: [['x', 32, 'F3', 0.25], ['radYZ', 14, 'F3', 0.85]] },
  { m: 'SM-714', L: 'cage', own: [['x', 56, 'F3', 0.4]] },
  { m: 'SM-713', L: 'cage', own: [['x', 86, 'F3', 0.5]] },
  { m: 'SM-720', L: 'cage', own: [['x', 112, 'F3', 0.62]] },
  { m: 'SM-715', L: 'cage', own: [['x', 128, 'F3', 0.72]] },
  { m: 'REF Eyepiece', L: 'ep' },
  { m: 'SM-821', L: 'ep', own: [['x', 14, 'S9', 0]] },
  { m: 'SM-825', when: e => e.c.x < 209.6, L: 'ep', own: [['x', 14, 'S9', 0]] },
  { m: ['SM-824', 'SM-825'], L: 'pp', own: [['x', 10, 'S9', 0.1]] },
  { m: 'SM-822', L: 'pp', own: [['x', 26, 'S9', 0.2]] },
  { m: 'SM-812', L: 'pp', own: [['x', 44, 'S9', 0.3]] },
  { m: 'REF Phone', L: 'pp', own: [['x', 76, 'S9', 0.8]] },
  { m: 'SM-611' },
  { m: 'SM-615', own: [['z', 30, 'F5', 0.1]] },
  { m: 'SM-638', own: [['z', 58, 'F5', 0.25]] },
  { m: 'SM-631', L: 'tt' },
  { m: 'SM-650', L: 'tt', own: [['z', -45, 'F5', 0.5]] },
  { m: 'SM-652', L: 'tt', own: [['z', -75, 'F5', 0.7]] },
  { m: 'SM-651', when: e => Math.abs(e.c.x) > 60, L: 'out' },
  { m: 'SM-651', L: 'tt' },
  { m: ['SM-632', 'SM-633'], L: 'out' },
  { m: 'SM-634', own: [['rad', 18, 'F5', 0.85]] },
  { m: 'SM-635', own: [['rad', 34, 'F5', 0.8]] },
  { m: 'SM-636', own: [['spread', 46, 'F5', 0.75]] },
  { m: 'SM-637', own: [['rad', 82, 'F5', 0.65]] },
  { m: ['SM-612', 'SM-614', 'SM-616'], own: [['rad', 120, 'S1', 0]] },
  { m: 'SM-617', own: [['rad', 120, 'S1', 0], ['z', 40, 'S1', 0.55]] },
  { m: 'SM-620', L: 'arm' },
  { m: 'SM-639', L: 'arm', own: [['z', 55, 'S2', 0.6]] },
  { m: CART, L: 'arm', own: [['fan', 0, 'F4', -1]] },
];
function ruleFor(e) {
  for (const r of RULES) {
    const ms = Array.isArray(r.m) ? r.m : [r.m];
    if (ms.some(k => e.name.startsWith(k)) && (!r.when || r.when(e))) return r;
  }
  return e.group === 'OTA' ? { L: 'tube' } : {};
}

// ---------- the viewer ----------
export function createViewer(canvas, opts = {}) {
  const small = opts.small ?? window.matchMedia('(max-width: 860px)').matches;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const data = opts.data;
  const STEPS = data.steps, NST = STEPS.length, SIX = {};
  STEPS.forEach((s, i) => (SIX[s.id] = i));

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.6 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.0;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = opts.shadows ?? window.__smTest?.shadows ?? !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = (() => {
    // A dim studio: one overhead softbox, a warm key strip and a cool strip like moonlight
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: 0x3c4450, side: THREE.BackSide })));
    const panel = (w, h, hex, k, pos) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
    };
    panel(6.0, 3.2, 0xffffff, 2.6, [0, 4.7, 0.6]);
    panel(1.3, 5.0, 0xfff0dc, 2.2, [-4.7, 1.4, 1.8]);
    panel(1.1, 5.0, 0xcfe0ff, 2.4, [4.7, 1.0, -1.2]);
    panel(5.0, 1.0, 0xdbe6ff, 1.6, [0, 0.9, -4.8]);
    panel(8.0, 2.0, 0x6d7682, 0.8, [0, -4.8, 0]);
    return pmrem.fromScene(s, 0.03).texture;
  })();
  scene.environmentIntensity = opts.envIntensity ?? 0.75;

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 30, 1, 5, 40000);
  const target = new THREE.Vector3(0, 420, 0);
  let controls = null;
  if (opts.interactive) {
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 120; controls.maxDistance = 9000;
    controls.addEventListener('change', () => invalidate());
    target.copy(controls.target);
  }

  // lights: warm key, cool rim to separate the silhouette from a dark page, soft fill
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2724, 0.45));
  const key = new THREE.DirectionalLight(0xfff1e2, 5.2);
  key.position.set(1050, 1900, 1150); key.target.position.set(0, 380, 0);
  scene.add(key, key.target);
  key.castShadow = true;
  key.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -1100, right: 1100, top: 1100, bottom: -1100, near: 600, far: 5200 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.00012; key.shadow.normalBias = 0.9;
  const rim = new THREE.DirectionalLight(0xbcd2ff, 4.2); rim.position.set(-1300, 900, -1200); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2); fill.position.set(-700, 380, 1500); scene.add(fill);

  // ground: a faint pool of light and a soft contact shadow
  const ground = new THREE.Group(); scene.add(ground);
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(256, 256, 8, 256, 256, 256);
    gr.addColorStop(0, 'rgba(170,196,222,0.20)'); gr.addColorStop(0.45, 'rgba(120,150,180,0.08)'); gr.addColorStop(1, 'rgba(80,100,130,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1100, 96), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = -0.5; ground.add(pool);
    const ring = new THREE.Mesh(new THREE.RingGeometry(430, 431.2, 180), new THREE.MeshBasicMaterial({ color: 0x8fb6cc, transparent: true, opacity: 0.22, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.2; ground.add(ring);
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.ShadowMaterial({ opacity: 0.55 }));
    catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.05; catcher.receiveShadow = true; ground.add(catcher);
  }

  const turn = new THREE.Group(); scene.add(turn); // azimuth turntable for the idle sway
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; turn.add(world);

  let ota = null, mount = null, rays = null;
  const meshes = [], lines = [], PART = [], byName = {};
  const clipOTA = new THREE.Plane(), clipMount = new THREE.Plane();
  const tmpV = new THREE.Vector3();
  const st = {
    alt: 40, asm: new Float32Array(NST).fill(1), rays: 0, phone: 0, mountShown: true,
    section: false, hl: [], hlK: 0, sway: false, swayAmp: 22, framing: { x: 0.5, y: 0.5 },
  };

  // ---------- render loop (renders only when something changed) ----------
  let dirty = true, active = true, tweens = [], last = performance.now(), swayT = 0;
  const invalidate = () => (dirty = true);
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!active) return;
    if (tweens.length) {
      tweens = tweens.filter(tw => { const k = clamp01((now - tw.t0) / tw.ms); tw.step(tw.ease(k)); return k < 1; });
      dirty = true;
    }
    if (st.sway && !reduce.matches && ota) {
      swayT += dt;
      turn.rotation.y = Math.sin(swayT * 2 * Math.PI / 26) * st.swayAmp * D2R;
      if (st.section) updateClip();
      dirty = true;
    }
    if (controls) controls.update();
    if (dirty) { dirty = false; renderer.render(scene, camera); }
  }
  requestAnimationFrame(tick);

  function applyFraming() {
    // shifts the projection so the target sits at st.framing (fractions of the canvas)
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const fx = st.framing.x, fy = st.framing.y;
    if (Math.abs(fx - 0.5) > 1e-4 || Math.abs(fy - 0.5) > 1e-4) camera.setViewOffset(w, h, (0.5 - fx) * w, (0.5 - fy) * h, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    invalidate();
  }
  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    applyFraming();
  }
  new ResizeObserver(resize).observe(canvas);

  // ---------- pose ----------
  function otaMatrix(alt) {
    const th = -(90 - alt) * D2R;
    return new THREE.Matrix4().makeTranslation(0, 0, data.H)
      .multiply(new THREE.Matrix4().makeRotationX(th))
      .multiply(new THREE.Matrix4().makeTranslation(0, -data.yp, -data.zp));
  }
  function setAlt(a) {
    st.alt = a;
    if (!ota) return;
    ota.matrixAutoUpdate = false; ota.matrix.copy(otaMatrix(a)); ota.matrixWorldNeedsUpdate = true;
    updateClip(); invalidate();
  }
  function updateClip() {
    if (!ota) return;
    turn.updateMatrixWorld(true);
    clipOTA.set(V3(0, 1, 0), 0).applyMatrix4(ota.matrixWorld);
    clipMount.set(V3(0, 1, 0), 0).applyMatrix4(mount.matrixWorld);
  }
  function setSection(on) {
    st.section = on;
    meshes.forEach(m => {
      const isOTA = m.userData.group === 'OTA';
      m.material.clippingPlanes = on ? [isOTA ? clipOTA : clipMount] : null;
      m.material.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.material.clipShadows = on;
      m.material.needsUpdate = true;
    });
    lines.forEach(l => { l.material.clippingPlanes = on ? [l.userData.group === 'OTA' ? clipOTA : clipMount] : null; l.material.needsUpdate = true; });
    if (rays) rays.children.forEach(r => { r.material.clippingPlanes = on ? [clipOTA] : null; r.material.needsUpdate = true; });
    updateClip(); invalidate();
  }

  // light path: converging cone M1 -> M2, then the reflected cone to focus
  function buildRays() {
    const g = new THREE.Group();
    const mat = () => new THREE.MeshBasicMaterial({ color: 0x5aa8e8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending });
    const conv = new THREE.Mesh(new THREE.CylinderGeometry(14, 75, 608, 96, 1, true), mat()); conv.rotation.x = Math.PI / 2; conv.position.set(0, 0, 2 + 304); conv.userData.k = 0.22; g.add(conv);
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 14, 140, 64, 1, true), mat()); refl.rotation.z = -Math.PI / 2; refl.position.set(70, 0, 610); refl.userData.k = 0.30; g.add(refl);
    const fp = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 16), new THREE.MeshBasicMaterial({ color: 0x9fd2ff, transparent: true, opacity: 0, toneMapped: false })); fp.position.set(140, 0, 610); fp.userData.k = 1; g.add(fp);
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), V3(0, 0, 610), V3(140, 0, 610)]), new THREE.LineBasicMaterial({ color: 0x7cc0f5, transparent: true, opacity: 0, toneMapped: false }));
    axis.userData.k = 0.9; g.add(axis);
    g.renderOrder = 2;
    return g;
  }
  function setRays(k) {
    st.rays = k;
    if (!rays) return;
    rays.visible = k > 0.001;
    rays.children.forEach(c => (c.material.opacity = c.userData.k * k));
    invalidate();
  }

  // ---------- parts and the exploded view ----------
  const groupOf = e => (e.group === 'OTA' ? ota : mount);
  function expl(A, stp, sub) {
    const q = A[SIX[stp]], w = 0.55, s0 = Math.max(0, sub) * (1 - w);
    const u = clamp01((q - s0) / w);
    return 1 - easeIO(u);
  }
  function offsetFor(e, A, out) {
    out = out || new THREE.Vector3(); out.set(0, 0, 0);
    for (const c of e.comps) { const k = expl(A, c.st, c.sub); if (k) out.addScaledVector(c.v, k); }
    return out;
  }
  function applyOffsets() {
    PART.forEach(e => {
      offsetFor(e, st.asm, e.off);
      if (e.slides && st.phone > 0) e.off.z -= PHONE_SLIDE_MM * st.phone;
      tmpV.copy(e.off).applyMatrix3(e.toParent);
      e.node.position.copy(e.p0).add(tmpV);
    });
    invalidate();
  }
  function applyVisibility() {
    PART.forEach(e => { e.node.visible = isPhone(e.name) ? st.phone > 0 : true; });
    if (mount) mount.visible = st.mountShown;
    invalidate();
  }
  function initParts(metaBy) {
    turn.updateMatrixWorld(true);
    const gInv = { OTA: ota.matrixWorld.clone().invert(), MOUNT: mount.matrixWorld.clone().invert() };
    const seen = new Map();
    const nodeOf = o => { let nd = o; while (nd && !metaBy[nd.name]) nd = nd.parent; return nd; };
    meshes.concat(lines).forEach(o => {
      const nd = nodeOf(o); if (!nd) return;
      if (!seen.has(nd)) {
        const p = metaBy[nd.name];
        const rel = gInv[p.group].clone().multiply(nd.parent.matrixWorld);
        const e = { node: nd, name: p.name, group: p.group, mass: p.mass, mat: p.mat, toParent: new THREE.Matrix3().setFromMatrix4(rel).invert(), p0: nd.position.clone(), meshes: [], lines: [], box: new THREE.Box3(), off: new THREE.Vector3() };
        seen.set(nd, e); PART.push(e);
      }
      const e = seen.get(nd);
      if (o.isLineSegments) { e.lines.push(o); return; }
      e.meshes.push(o);
      o.geometry.computeBoundingBox();
      e.box.union(o.geometry.boundingBox.clone().applyMatrix4(gInv[e.group].clone().multiply(o.matrixWorld)));
    });
    PART.forEach(e => { e.c = e.box.getCenter(new THREE.Vector3()); e.slides = e.group === 'OTA' && !FIXRE.test(e.name); });
    // fork-cartridge parts fan out in a row along the axle
    [-1, 1].forEach(s => {
      const list = PART.filter(e => has(e.name, CART) && sgn(e.c.x) === s);
      const keyOf = e => (e.name.startsWith('SM-207') ? 0 : e.name.startsWith('SM-627') ? 999 : Math.abs(e.c.x));
      list.sort((a, b) => keyOf(a) - keyOf(b));
      let x = 226;
      list.forEach((e, i) => {
        const w = e.box.max.x - e.box.min.x;
        if (i === 0) { e.fanX = 0; e.fanSub = 0; return; }
        const gap = w < 3 ? 5 : 8;
        e.fanX = s * (x + w / 2 - Math.abs(e.c.x)); x += w + gap; e.fanSub = (i - 1) / Math.max(1, list.length - 2) * 0.9;
      });
    });
    PART.forEach(e => {
      const r = ruleFor(e); e.comps = []; e.steps = new Set();
      (r.own || []).forEach(([mode, d, stp, sub]) => e.comps.push({ v: MODES[mode](e, d), st: stp, sub: sub < 0 ? (e.fanSub || 0) : sub }));
      let L = r.L;
      while (L) { const lv = LEVELS[L]; e.comps.push({ v: lv.v(e), st: lv.st, sub: lv.sub }); L = lv.p; }
      e.comps = e.comps.filter(c => c.v.lengthSq() > 1e-6);
      e.comps.forEach(c => e.steps.add(c.st));
    });
  }

  // ---------- highlight ----------
  const HI = new THREE.Color(0x4f9fe0), BLACK = new THREE.Color(0x000000);
  let selName = null;
  function refreshLook() {
    PART.forEach(e => {
      const inHl = st.hl.length && has(e.name, st.hl);
      const k = (inHl ? st.hlK * 0.16 : 0) + (selName && e.name === selName ? 0.45 : 0);
      e.meshes.forEach(m => { m.material.emissive.copy(k > 0 ? HI : BLACK); m.material.emissiveIntensity = k; });
      e.lines.forEach(l => { l.material.color.copy(k > 0 ? HI : EDGE_C); l.material.opacity = k > 0 ? 0.85 : 0.32; });
    });
    invalidate();
  }

  // ---------- camera ----------
  function withoutSway(fn) {
    const r = turn.rotation.y; turn.rotation.y = 0; turn.updateMatrixWorld(true);
    const out = fn(); turn.rotation.y = r; turn.updateMatrixWorld(true);
    return out;
  }
  function presetAt(name, aspect) {
    // camera position + target for a named view, computed for the current pose
    return withoutSway(() => {
      const c = V3(0, 0, 330).applyMatrix4(ota.matrixWorld);
      const asp = Math.max(0.35, aspect || camera.aspect || 1.6);
      const kz = asp < 1.25 ? Math.pow(1.25 / asp, 0.85) : 1;
      let pos, tgt = c.clone();
      switch (name) {
        case 'hero': pos = V3(c.x + 1080 * kz, c.y + 300 * kz, c.z + 1480 * kz); tgt = c.clone().add(V3(0, -60, 0)); break;
        case 'iso': pos = V3(c.x + 1350 * kz, c.y + 560 * kz, c.z + 1600 * kz); break;
        case 'side': pos = V3(c.x + 1950 * kz, c.y - 10, c.z + 140); tgt = c.clone().add(V3(0, -70, 0)); break;
        case 'front': pos = V3(c.x, c.y + 80, c.z + 2300 * kz); break;
        case 'back': pos = V3(c.x - 1500 * kz, c.y + 450 * kz, c.z - 1500 * kz); break;
        case 'top': tgt = V3(0, 0, 615).applyMatrix4(ota.matrixWorld); pos = V3(0, 0, 1150).applyMatrix4(ota.matrixWorld).add(V3(330 * kz, 170, 280 * kz)); break;
        case 'cell': tgt = V3(0, 0, -25).applyMatrix4(ota.matrixWorld); pos = V3(0, 0, -380).applyMatrix4(ota.matrixWorld).add(V3(520 * kz, 40, 460 * kz)); break;
        case 'phone': {
          // looking at the phone on the eyepiece from the focuser side, a little above the tube
          tgt = V3(150, 10, 470).applyMatrix4(ota.matrixWorld);
          const dir = V3(0.9, 0.5, 0.6).normalize().transformDirection(ota.matrixWorld);
          pos = tgt.clone().addScaledVector(dir, 1300 * kz); break;
        }
        case 'truss': tgt = V3(0, 0, 360).applyMatrix4(ota.matrixWorld); pos = tgt.clone().add(V3(-950 * kz, 420 * kz, 1250 * kz)); break;
        case 'mount': tgt = V3(0, 260, 0); pos = V3(-1050 * kz, 640 * kz, 1800 * kz); break;
        default: pos = V3(c.x + 1350 * kz, c.y + 560 * kz, c.z + 1600 * kz);
      }
      return { pos, tgt };
    });
  }
  const KIT_DIR = V3(1500, 700, 1750).normalize();
  function frameParts(list, A, dir, margin) {
    return withoutSway(() => {
      const box = new THREE.Box3(), v = new THREE.Vector3(), bb = new THREE.Box3();
      list.forEach(e => {
        if (!e.node.visible && !(isPhone(e.name) && st.phone > 0)) return;
        if (e.group === 'MOUNT' && !st.mountShown) return;
        offsetFor(e, A, v); bb.copy(e.box).translate(v).applyMatrix4(groupOf(e).matrixWorld); box.union(bb);
      });
      dir = (dir || KIT_DIR).clone().normalize();
      const ctr = box.getCenter(new THREE.Vector3());
      const up = V3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, dir).normalize(), up2 = new THREE.Vector3().crossVectors(dir, right).normalize();
      let hw = 0, hh = 0, hd = 0; const p = new THREE.Vector3();
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(ctr);
        hw = Math.max(hw, Math.abs(p.dot(right))); hh = Math.max(hh, Math.abs(p.dot(up2))); hd = Math.max(hd, Math.abs(p.dot(dir)));
      }
      const vf = camera.fov * D2R / 2, hf = Math.atan(Math.tan(vf) * (camera.aspect || 1.4));
      const m = margin || 1.1;
      const dist = Math.max(hh * m / Math.tan(vf), hw * m / Math.tan(hf)) + hd;
      return { pos: ctr.clone().addScaledVector(dir, Math.max(dist, 260)), tgt: ctr };
    });
  }
  function setCamera(view, instant) {
    if (instant || reduce.matches) {
      camera.position.copy(view.pos); target.copy(view.tgt);
      if (controls) controls.target.copy(view.tgt);
      camera.lookAt(target); invalidate(); return;
    }
    const p0 = camera.position.clone(), t0 = target.clone();
    addTween(900, k => {
      camera.position.lerpVectors(p0, view.pos, k); target.lerpVectors(t0, view.tgt, k);
      if (controls) controls.target.copy(target);
      camera.lookAt(target);
    }, easeCam, 'cam');
  }
  function addTween(ms, step, ease = easeCam, tag) {
    if (tag) tweens = tweens.filter(t => t.tag !== tag);
    tweens.push({ t0: performance.now(), ms, step, ease, tag });
    invalidate();
  }

  // ---------- state transitions ----------
  // Moves the model to a new state: altitude, assembly, light path, phone, highlight, camera.
  function go(next, { instant = false, ms = 1000 } = {}) {
    if (!ota) return;
    if (next.mount !== undefined && next.mount !== st.mountShown) { st.mountShown = next.mount; applyVisibility(); }
    if (next.section !== undefined && next.section !== st.section) setSection(next.section);
    if (next.sway !== undefined) { st.sway = next.sway; if (!next.sway && !instant) { const r0 = turn.rotation.y; addTween(ms, k => { turn.rotation.y = r0 * (1 - k); if (st.section) updateClip(); }, easeCam, 'sway'); } }
    if (next.hl !== undefined) {
      const same = next.hl.join('|') === st.hl.join('|');
      if (!same) { st.hl = next.hl; st.hlK = 0; }
    }
    const f0 = { ...st.framing }, f1 = next.framing || f0;
    const from = { alt: st.alt, asm: st.asm.slice(), rays: st.rays, phone: st.phone, hlK: st.hlK };
    const to = {
      alt: next.alt ?? st.alt,
      asm: next.asm ? Float32Array.from(next.asm) : st.asm.slice(),
      rays: next.rays ?? st.rays,
      phone: next.phone ?? st.phone,
      hlK: st.hl.length ? 1 : 0,
    };
    if (to.phone > 0 && st.phone === 0) { st.phone = 0.0001; applyVisibility(); }
    // camera for the end state
    const prevAlt = st.alt, prevAsm = st.asm, prevPhone = st.phone;
    setAlt(to.alt); st.asm = to.asm; st.phone = to.phone;
    let cam = null;
    if (next.view === 'all' || next.frame) cam = frameParts(next.frame || PART, next.frameAsm || to.asm, next.dir, next.margin);
    else if (typeof next.view === 'string') cam = presetAt(next.view);
    else if (next.view) cam = next.view;
    setAlt(prevAlt); st.asm = prevAsm; st.phone = prevPhone;
    const apply = k => {
      if (f1 !== f0) { st.framing = { x: f0.x + (f1.x - f0.x) * k, y: f0.y + (f1.y - f0.y) * k }; applyFraming(); }
      if (next.alt !== undefined) setAlt(from.alt + (to.alt - from.alt) * k);
      if (next.asm) for (let i = 0; i < NST; i++) st.asm[i] = from.asm[i] + (to.asm[i] - from.asm[i]) * k;
      st.phone = from.phone + (to.phone - from.phone) * k;
      st.hlK = from.hlK + (to.hlK - from.hlK) * k;
      setRays(from.rays + (to.rays - from.rays) * k);
      applyOffsets(); refreshLook();
      if (k >= 1 && to.phone === 0 && from.phone > 0) applyVisibility();
    };
    if (instant || reduce.matches) apply(1);
    else addTween(ms, apply, easeCam, 'state');
    if (cam) setCamera(cam, instant);
  }

  // Assembly progress for the build story: v runs 0 (kit in pieces) to n (all n owner steps done)
  const ownerSteps = () => STEPS.filter(s => !s.pre).map(s => s.id);
  function asmForBuild(v) {
    const A = new Float32Array(NST).fill(1);
    ownerSteps().forEach((id, i) => (A[SIX[id]] = clamp01(v - i)));
    return A;
  }
  function setAssembly(A) { st.asm = Float32Array.from(A); applyOffsets(); }
  function asmApart(K) {
    // K: 0 assembled .. 1 every part apart; staggered windows in assembly order
    const T = 1 - K, A = new Float32Array(NST), ov = 0.35 / NST;
    for (let i = 0; i < NST; i++) { const a = i / NST - ov, b = (i + 1) / NST + ov; A[i] = clamp01((T - a) / (b - a)); }
    if (K <= 0) A.fill(1); if (K >= 1) A.fill(0);
    return A;
  }

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  function shown(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    raycaster.setFromCamera({ x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 }, camera);
    const vis = meshes.filter(m => m.userData.name && shown(m));
    const hits = raycaster.intersectObjects(vis, false).filter(h => !(h.object.material.clippingPlanes && h.object.material.clippingPlanes[0].distanceToPoint(h.point) < 0));
    return hits.length ? hits[0].object.userData.name : null;
  }
  function select(name) { selName = name; refreshLook(); }

  // ---------- load ----------
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const ready = loader.loadAsync(opts.modelUrl, ev => {
    if (opts.onProgress && ev.total) opts.onProgress(ev.loaded / ev.total);
  }).then(gltf => {
    world.add(gltf.scene);
    ota = gltf.scene.getObjectByName('OTA');
    mount = gltf.scene.getObjectByName('MOUNT');
    const sanit = n => THREE.PropertyBinding.sanitizeNodeName(n);
    const metaBy = {}; data.parts.forEach(p => (metaBy[sanit(p.node)] = p));
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!(o.isMesh || o.isLineSegments)) return;
      let nd = o; while (nd && !metaBy[nd.name]) nd = nd.parent;
      const p = nd ? metaBy[nd.name] : null;
      if (o.isLineSegments) {
        o.material = makeEdgeMat(); o.renderOrder = 1; o.userData = { group: p ? p.group : 'OTA', edge: true };
        lines.push(o); return;
      }
      const deq = new THREE.Matrix4(); let q = o;
      while (q && q.name !== 'OTA' && q.name !== 'MOUNT' && q !== gltf.scene) { q.updateMatrix(); deq.premultiply(q.matrix); q = q.parent; }
      o.material = makeMat(p ? p.mat : 'graphite', o, deq);
      o.userData = p ? { ...p } : { group: 'OTA' };
      o.castShadow = true; o.receiveShadow = true;
      if (p) (byName[p.name] = byName[p.name] || []).push(o);
      meshes.push(o);
    });
    rays = buildRays(); rays.visible = false; ota.add(rays);
    setAlt(st.alt);
    initParts(metaBy);
    applyVisibility(); applyOffsets();
    resize();
    setCamera(presetAt('iso'), true);
    // compile shaders before the first visible frame
    renderer.compile(scene, camera);
    return api;
  });

  const api = {
    ready, scene, camera, renderer, PART, STEPS,
    go, setAlt, setRays, setSection, setAssembly, asmForBuild, asmApart, ownerSteps,
    presetAt, frameParts, setCamera, pick, select, invalidate, resize,
    setActive(on) { active = on; if (on) { last = performance.now(); dirty = true; } },
    setFraming(x, y) { st.framing = { x, y }; resize(); },
    setMount(on) { st.mountShown = on; applyVisibility(); },
    setPhone(k) { st.phone = k; applyVisibility(); applyOffsets(); },
    setShadows(on) { renderer.shadowMap.enabled = on; key.castShadow = on; meshes.forEach(m => (m.material.needsUpdate = true)); invalidate(); },
    get state() { return st; },
    get controls() { return controls; },
    get target() { return target; },
  };
  return api;
}
