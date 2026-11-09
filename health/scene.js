// Health club 3D tour. Built from simple shapes with three.js, lit with a studio environment.
// Walk with WASD / arrows, drag to look, click the floor to walk there, click a + for specs.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../gizmo/lib/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../gizmo/lib/addons/RoomEnvironment.js';
import { ZONES, STOPS, ITEMS } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = $('#stage');
const W = 20, D = 12, H = 4.2, EYE = 1.62; // half-width (x), half-depth (z), ceiling, eye height

// ================= renderer =================
let R;
try { R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__TOUR_SHOT }); } catch (e) { R = null; }
if (!R || !R.getContext()) throw new Error('WebGL unavailable');
R.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
R.setSize(innerWidth, innerHeight);
R.outputColorSpace = THREE.SRGBColorSpace;
R.toneMapping = THREE.ACESFilmicToneMapping;
R.toneMappingExposure = 1.18;
R.shadowMap.enabled = true;
R.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(R.domElement);
R.domElement.tabIndex = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#EAF2EE');
const pm = new THREE.PMREMGenerator(R);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.05, 120);

scene.add(new THREE.HemisphereLight('#ffffff', '#d6e9e0', 0.75));
const sun = new THREE.DirectionalLight('#fff6ea', 1.5);
sun.position.set(-8, 14, -16); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun);

// ================= helpers =================
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.6, metalness: o.m ?? 0, transparent: o.t != null, opacity: o.t ?? 1, emissive: o.e || '#000', emissiveIntensity: o.ei ?? 1, side: o.side || THREE.FrontSide });
function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
const box = (w, h, d, mat, x, y, z, p, round = 0) => mesh(round ? new RoundedBoxGeometry(w, h, d, 3, round) : new THREE.BoxGeometry(w, h, d), mat, x, y, z, p);
const cyl = (rt, rb, h, mat, x, y, z, p, seg = 24) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, p);
function group(x = 0, z = 0, ry = 0, parent = scene) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; parent.add(g); return g; }
function label(text, { w = 3, h = 0.6, bg = 'rgba(0,0,0,0)', fg = '#11201b', size = 120, weight = 800, font = 'Figtree, system-ui, sans-serif', align = 'center' } = {}) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * h / w);
  const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.textAlign = align; g.textBaseline = 'middle';
  let fs = size; g.font = `${weight} ${fs}px ${font}`;
  while (g.measureText(text).width > c.width - 60 && fs > 12) { fs *= 0.92; g.font = `${weight} ${fs}px ${font}`; }
  fs = Math.min(fs, c.height * 0.8); g.font = `${weight} ${fs}px ${font}`;
  g.fillText(text, align === 'center' ? c.width / 2 : 40, c.height / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
}
const obstacles = []; // [x1, z1, x2, z2]
const block = (x, z, w, d) => obstacles.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);

// ================= building =================
const C = { wall: '#F7FAF8', sage: '#DCEBE4', oak: '#D9BF98', rubber: '#3E4C48', tile: '#E9F1F1', mint: '#12B886', coral: '#FF7A6B', lav: '#8E7CFF', ink: '#1B2A25', steel: '#C9D1CF', chrome: '#E8ECEB', black: '#222a28' };
// floors: oak everywhere, rubber in weights + cardio, tiles in spa
box(2 * W, 0.1, 2 * D, M(C.oak, { r: 0.55 }), 0, -0.05, 0);
box(14, 0.02, 11, M(C.rubber, { r: 0.95 }), -12.5, 0.011, -6.5);
box(14, 0.02, 11, M('#47524f', { r: 0.95 }), 12.5, 0.011, -6.5);
box(15.5, 0.02, 10.5, M(C.tile, { r: 0.3 }), -12.25, 0.011, 6.75);
// zone floor stripes
[[-12.5, -1.05, C.coral], [12.5, -1.05, C.lav]].forEach(([x, z, c]) => box(14, 0.025, 0.12, M(c, { r: 0.5 }), x, 0.013, z));
// ceiling + light strips
box(2 * W, 0.1, 2 * D, M('#FBFCFB', { r: 0.9 }), 0, H + 0.05, 0).castShadow = false;
for (let x = -16; x <= 16; x += 8) for (let z = -8; z <= 8; z += 8) {
  const s = box(5.5, 0.05, 0.22, M('#fff', { e: '#fffdf6', ei: 1.6 }), x, H - 0.03, z); s.castShadow = false;
}
// walls
const wallM = M(C.wall, { r: 0.85 });
box(2 * W, H, 0.2, wallM, 0, H / 2, D + 0.1);           // south
box(0.2, H, 2 * D, wallM, -W - 0.1, H / 2, 0);           // west
box(0.2, H, 2 * D, M(C.sage, { r: 0.85 }), W + 0.1, H / 2, 0); // east (sage)
// north wall with tall windows looking onto a garden
box(2 * W, 0.6, 0.2, wallM, 0, 0.3, -D - 0.1);
box(2 * W, 0.5, 0.2, wallM, 0, H - 0.25, -D - 0.1);
for (let x = -W; x <= W; x += 4) box(0.18, H, 0.24, M('#E6ECEA', { r: 0.4, m: 0.3 }), x, H / 2, -D - 0.1);
const sky = box(2 * W, H - 1.1, 0.05, M('#BFE6D4', { e: '#CDEFE0', ei: 0.9, r: 1 }), 0, 0.6 + (H - 1.1) / 2, -D - 0.3); sky.castShadow = false;
// garden beyond the glass
for (let i = 0; i < 22; i++) { const x = -W + 1 + i * 1.85; const t = mesh(new THREE.SphereGeometry(0.9 + (i % 3) * 0.25, 16, 12), M(i % 2 ? '#7cc59a' : '#5fb184', { r: 0.9 }), x, 1.3 + (i % 4) * 0.25, -D - 1.6); t.castShadow = false; }
// entrance on the south wall
box(3.2, 3, 0.05, M('#cfe9f2', { t: 0.35, r: 0.05, m: 0.1 }), 0, 1.5, D - 0.02);
// glass partitions around the studio and spa
const glassM = M('#d7f0f4', { t: 0.22, r: 0.05, m: 0.1 });
[[-5, -7.5, 0.05, 7], [5, -7.5, 0.05, 7]].forEach(([x, z, w, d]) => { box(w, 2.6, d, glassM, x, 1.3, z); block(x, z, 0.3, d); });
box(15.3, 2.4, 0.05, glassM, -12.35, 1.2, 1.5); block(-12.35, 1.5, 15.3, 0.3);
box(0.05, 2.4, 4.5, glassM, -4.7, 1.2, 3.75); block(-4.7, 3.75, 0.3, 4.5);

// signage
function sign(text, color, x, y, z, ry = 0, w = 3.2) {
  const g = group(x, z, ry);
  box(w, 0.62, 0.06, M('#ffffff', { r: 0.5 }), 0, y, 0, g, 0.03);
  const dot = cyl(0.11, 0.11, 0.02, M(color, { e: color, ei: 0.4 }), -w / 2 + 0.36, y, 0.04, g); dot.rotation.x = Math.PI / 2;
  const l = label(text, { w: w - 0.8, h: 0.5, size: 150 }); l.position.set(0.25, y, 0.035); g.add(l);
  return g;
}
sign('FREE WEIGHTS', ZONES.weights.color, -12.5, 3.5, -11.85, 0, 3.6);
sign('CARDIO', ZONES.cardio.color, 12.5, 3.5, -11.85, 0, 2.6);
sign('STUDIO', ZONES.studio.color, 0, 3.5, -4.05, 0, 2.6);
sign('SPA & POOL', ZONES.spa.color, -10, 3.3, 1.53, Math.PI, 3.4);
sign('FUEL BAR', ZONES.fuel.color, 19.88, 3.3, 8.4, -Math.PI / 2, 3);

// plants for a softer, calmer feel
function plant(x, z, s = 1) {
  const g = group(x, z);
  cyl(0.28 * s, 0.22 * s, 0.5 * s, M('#F1EEE8', { r: 0.7 }), 0, 0.25 * s, 0, g);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(new THREE.SphereGeometry(0.28 * s, 14, 10), M(i % 2 ? '#4fa676' : '#68bd8a', { r: 0.85 }), Math.cos(a) * 0.18 * s, 0.75 * s + (i % 2) * 0.18 * s, Math.sin(a) * 0.18 * s, g); }
  block(x, z, 0.6 * s, 0.6 * s);
}
[[-19, 11], [-4.4, 11.2], [6.2, 11.2], [19, 11.2], [-5.6, -0.4], [5.6, -0.4], [19, 4.5], [-19.2, -0.6]].forEach(([x, z]) => plant(x, z, 1.1));

// ================= interactive items =================
const hot = []; // meshes that open an item
function tag(obj, id) { obj.traverse(o => { if (o.isMesh) { o.userData.item = id; hot.push(o); } }); }
const markers = [];
const markerTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(18,184,134,.25)'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.fill();
  g.strokeStyle = '#12B886'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
  g.strokeStyle = '#11201b'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(64, 46); g.lineTo(64, 82); g.moveTo(46, 64); g.lineTo(82, 64); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
function marker(id, x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, depthTest: false, transparent: true }));
  s.position.set(x, y, z); s.scale.setScalar(0.42); s.renderOrder = 10; s.userData.item = id; scene.add(s);
  markers.push(s); hot.push(s);
}

// --- reception desk
{
  const g = group(6.2, 9.6, 0);
  box(3.6, 1.1, 0.9, M('#ffffff', { r: 0.35 }), 0, 0.55, 0, g, 0.08);
  box(3.62, 0.08, 0.06, M(C.mint, { e: C.mint, ei: 0.6 }), 0, 0.85, -0.46, g);
  box(3.8, 0.06, 1.05, M('#E9E3D9', { r: 0.4 }), 0, 1.13, 0, g, 0.02);
  const sc = box(0.5, 0.34, 0.03, M('#11201b', { e: '#1d6f58', ei: 0.5, r: 0.2 }), -0.9, 1.35, 0.15, g); sc.rotation.x = -0.25;
  tag(g, 'desk'); block(6.2, 9.6, 3.9, 1.2);
  const wall = group(6.2, 11.85, Math.PI);
  box(5, 2.2, 0.08, M(C.sage, { r: 0.8 }), 0, 2.1, 0, wall);
  const l1 = label('Welcome', { w: 3.4, h: 0.8, size: 230, fg: '#11201b' }); l1.position.set(0, 2.45, 0.05); wall.add(l1);
  const l2 = label('Train · Recover · Refuel', { w: 3.4, h: 0.4, size: 90, weight: 600, fg: '#0b8f68' }); l2.position.set(0, 1.75, 0.05); wall.add(l2);
  marker('desk', 6.2, 1.95, 9.6);
}

// --- free weights
{ // dumbbell rack along the west wall
  const g = group(-19.0, -6.2, Math.PI / 2);
  const frameM = M(C.black, { r: 0.45, m: 0.6 });
  box(4.6, 0.06, 0.5, frameM, 0, 0.55, 0.15, g); box(4.6, 0.06, 0.5, frameM, 0, 0.95, -0.15, g);
  for (const x of [-2.2, 0, 2.2]) { box(0.08, 1.0, 0.08, frameM, x, 0.5, 0.35, g); box(0.08, 1.0, 0.08, frameM, x, 0.5, -0.35, g); }
  const headM = M('#2b2f2e', { r: 0.7 }), handM = M(C.chrome, { r: 0.2, m: 1 });
  for (let i = 0; i < 16; i++) {
    const w = 2.5 + i * 2.5, r = 0.055 + i * 0.0055, L = 0.05 + i * 0.006, tier = i < 8 ? 0 : 1;
    const x = -2.05 + (i % 8) * 0.58, y = tier ? 1.03 + r : 0.63 + r, z = tier ? -0.15 : 0.15;
    for (const dz of [-0.11, 0.11]) {
      const db = new THREE.Group(); db.position.set(x, y, z + dz); g.add(db);
      const hnd = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), handM, 0, 0, 0, db); hnd.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) { const hd = mesh(new THREE.CylinderGeometry(r, r, L, 6), headM, s * (0.08 + L / 2), 0, 0, db); hd.rotation.z = Math.PI / 2; }
    }
  }
  tag(g, 'dumbbells'); block(-19.0, -6.2, 0.9, 4.8); marker('dumbbells', -18.7, 1.65, -6.2);
}
{ // kettlebells on a low shelf by the north windows
  const g = group(-15, -11.1, 0);
  box(3.6, 0.32, 0.6, M('#2f3735', { r: 0.6 }), 0, 0.16, 0, g, 0.04);
  const kcol = ['#F5A524', '#FF7A6B', '#E2639B', '#8E7CFF', '#22A6D9', '#12B886', '#1B2A25'];
  kcol.forEach((c, i) => {
    const s = 0.11 + i * 0.012, x = -1.5 + i * 0.5;
    mesh(new THREE.SphereGeometry(s, 20, 14), M('#232a28', { r: 0.5, m: 0.3 }), x, 0.32 + s * 0.9, 0, g);
    const h = mesh(new THREE.TorusGeometry(s * 0.62, 0.018, 8, 20, Math.PI), M('#232a28', { r: 0.5, m: 0.3 }), x, 0.32 + s * 1.6, 0, g);
    const ring = mesh(new THREE.TorusGeometry(s * 0.92, 0.012, 6, 24), M(c, { e: c, ei: 0.2 }), x, 0.32 + s * 0.95, 0, g); ring.rotation.x = Math.PI / 2;
    h.rotation.z = 0;
  });
  tag(g, 'kettlebells'); block(-15, -11.1, 3.8, 0.8); marker('kettlebells', -15, 1.2, -11.1);
}
{ // power rack with barbell
  const g = group(-11, -8.6, 0);
  const fM = M(C.coral, { r: 0.45, m: 0.3 });
  for (const x of [-0.65, 0.65]) for (const z of [-0.65, 0.65]) box(0.08, 2.4, 0.08, fM, x, 1.2, z, g);
  for (const z of [-0.65, 0.65]) box(1.38, 0.08, 0.08, fM, 0, 2.4, z, g);
  for (const x of [-0.65, 0.65]) box(0.08, 0.08, 1.38, fM, x, 2.4, 0, g);
  box(1.5, 0.04, 1.6, M('#2a3331', { r: 0.9 }), 0, 0.02, 0, g);
  const bar = cyl(0.016, 0.016, 2.2, M(C.chrome, { r: 0.2, m: 1 }), 0, 1.35, -0.6, g, 12); bar.rotation.z = Math.PI / 2;
  [[-0.92, 0.22], [-0.86, 0.22], [0.86, 0.22], [0.92, 0.22]].forEach(([x, r]) => { const p = cyl(r, r, 0.05, M('#1f2624', { r: 0.8 }), x, 1.35, -0.6, g, 32); p.rotation.z = Math.PI / 2; });
  tag(g, 'rack'); block(-11, -8.6, 1.7, 1.7); marker('rack', -11, 2.75, -8.6);
  // plate tree
  const t = group(-8.2, -10.4, 0); cyl(0.04, 0.04, 1.3, M(C.black, { m: 0.6, r: 0.4 }), 0, 0.65, 0, t, 10); box(0.6, 0.05, 0.6, M(C.black, { m: 0.5 }), 0, 0.03, 0, t);
  [0.42, 0.85, 1.2].forEach((y, i) => { const p = cyl(0.22 - i * 0.04, 0.22 - i * 0.04, 0.05, M(['#FF7A6B', '#22A6D9', '#F5A524'][i], { r: 0.6 }), 0, y, 0.12, t, 32); p.rotation.x = Math.PI / 2; });
  tag(t, 'rack'); block(-8.2, -10.4, 0.7, 0.7);
}
{ // adjustable benches
  for (const [x, z, ry] of [[-11, -4.4, 0], [-14.5, -4.4, 0]]) {
    const g = group(x, z, ry);
    box(0.32, 0.08, 1.2, M('#1f2624', { r: 0.6 }), 0, 0.48, 0, g, 0.03);
    box(0.08, 0.42, 0.08, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.22, -0.4, g); box(0.08, 0.42, 0.08, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.22, 0.4, g);
    box(0.5, 0.05, 0.08, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.03, -0.45, g); box(0.5, 0.05, 0.08, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.03, 0.45, g);
    tag(g, 'bench'); block(x, z, 0.6, 1.3);
  }
  marker('bench', -11, 1.05, -4.4);
}


// --- turf track down the middle: sled, plyo boxes, battle ropes
{
  const g = group(0, 2.2, 0);
  box(2.6, 0.03, 9.5, M('#5DBB7E', { r: 0.95 }), 0, 0.015, 0, g);
  for (const z of [-4.75, 4.75]) box(2.6, 0.031, 0.08, M('#ffffff', { r: 0.6 }), 0, 0.016, z, g);
  for (let i = -3; i <= 3; i++) box(2.6, 0.031, 0.04, M('#e8f7ee', { r: 0.6 }), 0, 0.016, i * 1.3, g);
  // sled
  const sl = group(0.2, 1.4, 0, g);
  box(0.7, 0.08, 1.0, M('#2a3331', { m: 0.4, r: 0.5 }), 0, 0.06, 0, sl);
  for (const x of [-0.28, 0.28]) { const post = box(0.06, 0.9, 0.06, M(C.mint, { r: 0.4 }), x, 0.5, -0.35, sl); post.rotation.x = -0.25; }
  const pl = cyl(0.22, 0.22, 0.06, M('#1f2624', { r: 0.8 }), 0, 0.15, 0.15, sl, 28);
  // plyo boxes
  [[0.5, '#FF7A6B'], [0.65, '#8E7CFF'], [0.8, '#F5A524']].forEach(([h, c], i) => box(0.6, h * 0.75, 0.5, M(c, { r: 0.6 }), -0.7 + i * 0.75, h * 0.375, -3.6, g, 0.04));
  // battle ropes coiled at the far end
  for (const x of [-0.6, 0.6]) { const t = mesh(new THREE.TorusGeometry(0.22, 0.05, 10, 24), M('#1B2A25', { r: 0.9 }), x, 0.06, 4.1, g); t.rotation.x = Math.PI / 2; }
  tag(g, 'turf'); block(0.2, 3.6, 0.9, 1.2); block(0, -1.4, 2.4, 0.7);
  marker('turf', 0.2, 1.3, 3.6);
}

// --- cardio
function treadmill(x, z) {
  const g = group(x, z, 0);
  box(0.9, 0.22, 2.0, M('#2a3331', { r: 0.5 }), 0, 0.11, 0, g, 0.06);
  box(0.62, 0.02, 1.7, M('#151a19', { r: 0.95 }), 0, 0.23, 0.05, g);
  for (const s of [-0.4, 0.4]) { const u = box(0.07, 1.25, 0.1, M(C.steel, { m: 0.7, r: 0.3 }), s, 0.75, -0.85, g); u.rotation.x = 0.12; }
  box(0.95, 0.06, 0.12, M(C.steel, { m: 0.7, r: 0.3 }), 0, 1.15, -0.72, g);
  const con = box(0.8, 0.42, 0.08, M('#1b2220', { r: 0.4 }), 0, 1.42, -0.86, g, 0.03); con.rotation.x = -0.35;
  const scr = box(0.6, 0.3, 0.01, M('#0f1716', { e: '#2ad1a3', ei: 0.55, r: 0.2 }), 0, 1.44, -0.81, g); scr.rotation.x = -0.35;
  tag(g, 'treadmill'); block(x, z, 1.0, 2.1); return g;
}
function bike(x, z) {
  const g = group(x, z, 0);
  box(0.5, 0.06, 1.05, M('#2a3331', { m: 0.3, r: 0.5 }), 0, 0.03, 0, g);
  const fw = cyl(0.26, 0.26, 0.08, M(C.lav, { m: 0.4, r: 0.35 }), 0, 0.42, -0.28, g, 28); fw.rotation.z = Math.PI / 2;
  const post = box(0.08, 0.8, 0.08, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.5, 0.12, g); post.rotation.x = -0.25;
  box(0.24, 0.07, 0.34, M('#1b2220', { r: 0.6 }), 0, 0.93, 0.22, g, 0.03);
  const st = box(0.07, 0.9, 0.07, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.6, -0.42, g); st.rotation.x = 0.2;
  box(0.5, 0.05, 0.06, M('#1b2220', { r: 0.5 }), 0, 1.06, -0.52, g);
  const sc = box(0.22, 0.15, 0.03, M('#0f1716', { e: '#8E7CFF', ei: 0.5 }), 0, 1.16, -0.5, g); sc.rotation.x = -0.4;
  tag(g, 'bike'); block(x, z, 0.6, 1.2); return g;
}
[8.2, 10.7, 13.2, 15.7].forEach(x => treadmill(x, -9.6));
[8.2, 10.2, 12.2, 14.2].forEach(x => bike(x, -5.6));
marker('treadmill', 11.95, 2.05, -9.8); marker('bike', 11.2, 1.65, -5.6);
{ // rower
  const g = group(17.6, -5.6, 0);
  box(0.16, 0.1, 2.3, M(C.steel, { m: 0.7, r: 0.3 }), 0, 0.3, 0.1, g);
  box(0.12, 0.3, 0.12, M('#2a3331'), 0, 0.15, 1.15, g); box(0.5, 0.06, 0.12, M('#2a3331'), 0, 0.03, 1.15, g);
  const hs = cyl(0.3, 0.3, 0.26, M('#1f2624', { r: 0.4, m: 0.3 }), 0, 0.42, -1.05, g, 28); hs.rotation.z = Math.PI / 2;
  box(0.32, 0.07, 0.3, M('#1b2220', { r: 0.6 }), 0, 0.4, 0.2, g, 0.03);
  const sc = box(0.2, 0.15, 0.03, M('#0f1716', { e: '#2ad1a3', ei: 0.5 }), 0, 0.95, -0.85, g); sc.rotation.x = -0.4;
  box(0.04, 0.5, 0.04, M(C.steel, { m: 0.7 }), 0, 0.68, -0.85, g);
  tag(g, 'rower'); block(17.6, -5.6, 0.7, 2.6); marker('rower', 17.6, 1.2, -5.6);
}
{ // cross-trainer
  const g = group(17.9, -9.6, 0);
  box(0.6, 0.12, 1.7, M('#2a3331', { r: 0.5 }), 0, 0.06, 0, g, 0.04);
  for (const s of [-0.18, 0.18]) { box(0.12, 0.04, 0.4, M('#1b2220'), s, 0.32, 0.1, g); const a = box(0.04, 1.4, 0.04, M(C.steel, { m: 0.7 }), s * 1.4, 0.95, -0.4, g); a.rotation.x = s > 0 ? 0.2 : -0.1; }
  box(0.14, 1.3, 0.14, M('#2a3331'), 0, 0.7, -0.7, g);
  const sc = box(0.3, 0.2, 0.03, M('#0f1716', { e: '#8E7CFF', ei: 0.5 }), 0, 1.45, -0.68, g); sc.rotation.x = -0.3;
  tag(g, 'xtrainer'); block(17.9, -9.6, 0.8, 1.9); marker('xtrainer', 17.9, 2.0, -9.6);
}

// --- fuel bar: two vending machines on the east wall
function vending(z, id, accent, products) {
  const g = group(19.45, z, -Math.PI / 2);
  box(1.3, 2.1, 0.85, M('#ffffff', { r: 0.35 }), 0, 1.05, 0, g, 0.06);
  box(1.32, 0.3, 0.87, M(accent, { r: 0.4, e: accent, ei: 0.15 }), 0, 1.95, 0, g, 0.06);
  const lab = label(id === 'vend1' ? 'PROTEIN + RECOVERY' : 'FRESH FUEL', { w: 1.2, h: 0.24, size: 105, fg: '#ffffff' }); lab.position.set(0, 1.95, 0.44); g.add(lab);
  // recessed window: frame sides + lit back panel, products sit in front of it behind the glass
  box(0.96, 1.6, 0.16, M('#e9efee', { r: 0.4 }), -0.15, 1.0, 0.43, g, 0.02);
  box(0.88, 1.5, 0.02, M('#f4fffb', { e: '#f3fffb', ei: 0.55, r: 0.2 }), -0.15, 1.0, 0.52, g);
  for (let r = 0; r < 4; r++) {
    box(0.88, 0.02, 0.18, M('#cfd8d6', { m: 0.5 }), -0.15, 0.36 + r * 0.36, 0.61, g);
    for (let c = 0; c < 5; c++) {
      const p = products[(r * 5 + c) % products.length], x = -0.5 + c * 0.175, y = 0.37 + r * 0.36;
      if (r % 2 === 0) cyl(0.042, 0.042, 0.2, M(p.color, { r: 0.4 }), x, y + 0.1, 0.61, g, 14);
      else box(0.13, 0.16, 0.06, M(p.color, { r: 0.5 }), x, y + 0.08, 0.61, g);
    }
  }
  for (const sx of [-0.62, 0.32]) box(0.04, 1.6, 0.22, M('#ffffff', { r: 0.35 }), sx, 1.0, 0.6, g);
  box(0.98, 0.04, 0.22, M('#ffffff', { r: 0.35 }), -0.15, 1.8, 0.6, g); box(0.98, 0.04, 0.22, M('#ffffff', { r: 0.35 }), -0.15, 0.2, 0.6, g);
  box(0.9, 1.56, 0.015, M('#e8fbff', { t: 0.14, r: 0.05 }), -0.15, 1.0, 0.71, g);
  box(0.22, 0.42, 0.03, M('#11201b', { e: accent, ei: 0.35 }), 0.5, 1.3, 0.44, g, 0.02);
  box(0.22, 0.12, 0.03, M('#222'), 0.5, 0.35, 0.44, g);
  tag(g, id); block(19.3, z, 1.3, 1.4);
  marker(id, 18.95, 2.4, z);
}
vending(7.3, 'vend1', ZONES.fuel.color, ITEMS.vend1.products);
vending(9.5, 'vend2', '#12B886', ITEMS.vend2.products);
{ // high table + stools
  const g = group(16.4, 8.4, 0);
  cyl(0.45, 0.45, 0.05, M('#E9E3D9', { r: 0.4 }), 0, 1.05, 0, g, 32); cyl(0.04, 0.04, 1.05, M(C.steel, { m: 0.7 }), 0, 0.52, 0, g, 10); cyl(0.3, 0.3, 0.03, M(C.steel, { m: 0.7 }), 0, 0.015, 0, g, 24);
  for (const a of [0.4, 2.3, 4.2]) { const sx = Math.cos(a) * 0.7, sz = Math.sin(a) * 0.7; cyl(0.18, 0.18, 0.06, M(C.mint, { r: 0.5 }), sx, 0.75, sz, g, 20); cyl(0.025, 0.025, 0.75, M(C.steel, { m: 0.7 }), sx, 0.37, sz, g, 8); }
  block(16.4, 8.4, 1.6, 1.6);
}

// --- spa
{ // pool
  const g = group(-12.5, 7.4, 0);
  box(10.4, 0.12, 4.8, M('#ffffff', { r: 0.3 }), 0, 0.06, 0, g);
  const water = box(9.8, 0.05, 4.2, M('#38b6d8', { r: 0.08, m: 0.1, e: '#1d8fb3', ei: 0.25 }), 0, 0.1, 0, g); water.receiveShadow = true; water.castShadow = false;
  box(9.8, 0.02, 4.2, M('#bfeefa', { t: 0.25, r: 0.05 }), 0, 0.13, 0, g).castShadow = false;
  for (const z of [-1.05, 0, 1.05]) for (let i = 0; i < 24; i++) { const f = mesh(new THREE.SphereGeometry(0.045, 8, 6), M(i % 4 < 2 ? '#ffffff' : '#FF7A6B', { r: 0.5 }), -4.8 + i * 0.42, 0.15, z, g); f.castShadow = false; }
  tag(g, 'pool'); block(-12.5, 7.4, 10.6, 5); marker('pool', -12.5, 0.95, 7.4);
}
{ // sauna cabin
  const g = group(-17.9, 3.3, 0);
  const woodM = M('#C9945C', { r: 0.75 });
  box(3.2, 2.5, 2.2, woodM, 0, 1.25, 0, g, 0.04);
  box(0.9, 1.9, 0.04, M('#ffd9a8', { t: 0.55, r: 0.1, e: '#ffb46b', ei: 0.35 }), 0.7, 1.05, 1.11, g);
  for (let i = 0; i < 7; i++) box(3.22, 0.02, 0.02, M('#a87545'), 0, 0.3 + i * 0.32, 1.111, g);
  const l = label('SAUNA', { w: 1.2, h: 0.3, size: 140, fg: '#5a3418' }); l.position.set(-0.7, 2.1, 1.125); g.add(l);
  tag(g, 'sauna'); block(-17.9, 3.3, 3.4, 2.4); marker('sauna', -17.9, 2.85, 3.3);
}
{ // steam room
  const g = group(-14.2, 3.3, 0);
  box(2.6, 2.5, 2.2, M('#eef6f7', { r: 0.4 }), 0, 1.25, 0, g, 0.04);
  box(2.2, 2.0, 0.04, M('#e9f8fb', { t: 0.55, r: 0.15 }), 0, 1.1, 1.11, g);
  const l = label('STEAM', { w: 1.2, h: 0.3, size: 140, fg: '#1d6f8f' }); l.position.set(0, 2.25, 1.135); g.add(l);
  tag(g, 'steam'); block(-14.2, 3.3, 2.8, 2.4); marker('steam', -14.2, 2.85, 3.3);
}
{ // loungers
  const g = group(-12.5, 10.9, 0);
  for (let i = 0; i < 5; i++) {
    const x = -4 + i * 2;
    box(0.7, 0.3, 1.8, M('#ffffff', { r: 0.4 }), x, 0.15, 0, g, 0.05);
    box(0.66, 0.1, 1.2, M('#9fd8e8', { r: 0.8 }), x, 0.34, 0.25, g, 0.04);
    const back = box(0.66, 0.1, 0.7, M('#9fd8e8', { r: 0.8 }), x, 0.55, -0.62, g, 0.04); back.rotation.x = 0.7;
  }
  tag(g, 'loungers'); block(-12.5, 10.9, 9.8, 1.9); marker('loungers', -12.5, 1.05, 10.9);
}

// --- studio
{
  const g = group(0, -8, 0);
  box(9.8, 0.02, 7.6, M('#E5CFA9', { r: 0.5 }), 0, 0.012, 0.2, g);
  const mirror = box(9.4, 2.6, 0.04, new THREE.MeshStandardMaterial({ color: '#f3f8f8', metalness: 0.15, roughness: 0.18 }), 0, 1.6, -3.85, g); mirror.castShadow = false;
  box(9.5, 0.06, 0.08, M('#D9BF98', { r: 0.5 }), 0, 0.28, -3.8, g); box(9.5, 0.06, 0.08, M('#D9BF98', { r: 0.5 }), 0, 2.93, -3.8, g);
  const barre = cyl(0.025, 0.025, 9.2, M('#D9BF98', { r: 0.4 }), 0, 1.05, -3.6, g, 12); barre.rotation.z = Math.PI / 2;
  const mats = ['#E2639B', '#8E7CFF', '#12B886', '#22A6D9', '#F5A524', '#FF7A6B'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) box(0.62, 0.012, 1.75, M(mats[(c + r) % 6], { r: 0.8 }), -3.75 + c * 1.5, 0.03, -1.6 + r * 2.4, g);
  for (let i = 0; i < 4; i++) { const b = mesh(new THREE.SphereGeometry(0.32, 20, 14), M(['#FFD1DC', '#D7D0FF', '#C8F1E2', '#CDEBFA'][i], { r: 0.5 }), 3.9, 0.32, -2.8 + i * 0.75, g); b.castShadow = true; }
  tag(g, 'studio'); marker('studio', 0, 2.5, -8.4);
}

// ================= camera + movement =================
const pos = new THREE.Vector3(0.5, EYE, 11.2);
let yaw = THREE.MathUtils.degToRad(-14), pitch = THREE.MathUtils.degToRad(-7);
let tween = null;
const keys = new Set();
function clampPos(p) {
  p.x = THREE.MathUtils.clamp(p.x, -W + 0.4, W - 0.4); p.z = THREE.MathUtils.clamp(p.z, -D + 0.4, D - 0.4);
  const rr = 0.32;
  for (const [x1, z1, x2, z2] of obstacles) {
    if (p.x > x1 - rr && p.x < x2 + rr && p.z > z1 - rr && p.z < z2 + rr) {
      const dx1 = p.x - (x1 - rr), dx2 = (x2 + rr) - p.x, dz1 = p.z - (z1 - rr), dz2 = (z2 + rr) - p.z, m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) p.x = x1 - rr; else if (m === dx2) p.x = x2 + rr; else if (m === dz1) p.z = z1 - rr; else p.z = z2 + rr;
    }
  }
}
function applyCam() { camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); }
function walkTo(x, z, toYaw = null, toPitch = null, dur = null) {
  const target = new THREE.Vector3(x, EYE, z); clampPos(target);
  const dist = target.distanceTo(pos);
  let dy = toYaw == null ? 0 : ((toYaw - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  tween = { from: pos.clone(), to: target, y0: yaw, dy, p0: pitch, p1: toPitch == null ? pitch : toPitch, t: 0, dur: reduce ? 0.001 : (dur || Math.min(2.2, 0.5 + dist / 6)) };
}
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  const k = e.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) { keys.add(k); tween = null; if (k.startsWith('arrow')) e.preventDefault(); hideHint(); }
  if (k === 'escape') closePanel();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
// touch d-pad
document.querySelectorAll('#dpad button').forEach(b => {
  const k = { f: 'w', b: 's', l: 'q', r: 'e' }[b.dataset.k];
  b.addEventListener('pointerdown', e => { e.preventDefault(); keys.add(k); tween = null; b.setPointerCapture(e.pointerId); hideHint(); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => keys.delete(k)));
});
// drag to look, click to walk / open
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
R.domElement.addEventListener('pointerdown', e => { if (matchMedia('(max-width: 900px)').matches) $('#intro').hidden = true; drag = { x: e.clientX, y: e.clientY, yaw, pitch, moved: false, id: e.pointerId }; R.domElement.setPointerCapture(e.pointerId); });
R.domElement.addEventListener('pointermove', e => {
  if (drag && drag.id === e.pointerId) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) { drag.moved = true; tween = null; hideHint(); }
    if (drag.moved) { const s = e.pointerType === 'touch' ? 0.006 : 0.004; yaw = drag.yaw + dx * s; pitch = THREE.MathUtils.clamp(drag.pitch + dy * s, -1.2, 0.9); }
  } else hover(e);
});
R.domElement.addEventListener('pointerup', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const moved = drag.moved; drag = null; if (moved) return;
  const hit = pick(e);
  if (hit && hit.object.userData.item) { openItem(hit.object.userData.item); return; }
  if (hit && hit.point.y < 0.2) { walkTo(hit.point.x, hit.point.z); hideHint(); }
});
function pick(e) {
  const r = R.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const ms = ray.intersectObjects(markers, false); if (ms.length) return ms[0];
  const hits = ray.intersectObjects(scene.children, true).filter(h => h.object.visible && !h.object.isSprite && h.object.material && !(h.object.material.transparent && h.object.material.opacity < 0.4));
  return hits[0] || null;
}
let hovered = null;
function setGlow(id, on) {
  if (!id) return;
  for (const o of hot) if (o.userData.item === id && o.isMesh && o.material.emissive) {
    if (on) { o.userData.e0 = o.userData.e0 || { c: o.material.emissive.clone(), i: o.material.emissiveIntensity }; o.material.emissive.set('#12B886'); o.material.emissiveIntensity = 0.22; }
    else if (o.userData.e0) { o.material.emissive.copy(o.userData.e0.c); o.material.emissiveIntensity = o.userData.e0.i; }
  }
}
function hover(e) {
  if (e.pointerType === 'touch') return;
  const h = pick(e), id = h && h.object.userData.item || null;
  if (id !== hovered) { setGlow(hovered, false); setGlow(id, true); hovered = id; stage.classList.toggle('hover', !!id); }
}

// ================= UI =================
const panel = $('#panel');
let openId = null;
function openItem(id) {
  const it = ITEMS[id]; if (!it) return; openId = id;
  const z = ZONES[it.zone];
  panel.style.setProperty('--zc', z.color);
  $('#pZone').textContent = z.name; $('#pTitle').textContent = it.title; $('#pDesc').textContent = it.desc;
  let html = '';
  if (it.specs) html += `<dl class="specs">${it.specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  if (it.products) html += `<div class="prods">${it.products.map((p, i) => `<div class="prod"><button type="button" aria-expanded="${i === 0}" data-p="${i}"><span class="sw" style="background:${p.color}"></span><span class="nm"><b>${esc(p.name)}</b><small>${esc(p.size)} &middot; ${p.kcal} kcal &middot; ${p.protein} g protein</small></span><span class="pr">${esc(p.price)}</span></button><div class="nut"${i === 0 ? '' : ' hidden'}><div class="nutgrid"><div><b>${p.kcal}</b><small>kcal</small></div><div><b>${p.protein}g</b><small>protein</small></div><div><b>${p.carbs}g</b><small>carbs</small></div><div><b>${p.fat}g</b><small>fat</small></div></div><p>${esc(p.note)} Per ${esc(p.size)}.</p></div></div>`).join('')}</div>`;
  if (it.chips) html += `<div class="chips">${it.chips.map(c => `<span>${esc(c)}</span>`).join('')}</div>`;
  html += `<p class="fine">A fictional club. Specs${it.products ? ', nutrition and prices' : ''} are illustrative.</p>`;
  $('#pBody').innerHTML = html; $('#pBody').scrollTop = 0;
  $('#pBody').querySelectorAll('[data-p]').forEach(b => b.addEventListener('click', () => { const n = b.nextElementSibling, open = n.hidden; n.hidden = !open; b.setAttribute('aria-expanded', open); }));
  panel.classList.add('on'); document.body.classList.add('panel-open');
  setStop(it.zone);
  $('#listv').hidden = true;
}
function closePanel() { panel.classList.remove('on'); document.body.classList.remove('panel-open'); openId = null; }
$('#pClose').addEventListener('click', closePanel);
// tour stops
const stopsEl = $('#stops');
stopsEl.innerHTML = STOPS.map(s => `<button type="button" data-stop="${s.id}" style="--c:${ZONES[s.id].color}"><i></i>${ZONES[s.id].name}</button>`).join('');
function setStop(id) { stopsEl.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', b.dataset.stop === id)); }
stopsEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const s = STOPS.find(x => x.id === b.dataset.stop);
  walkTo(s.x, s.z, THREE.MathUtils.degToRad(s.yaw), THREE.MathUtils.degToRad(s.pitch)); setStop(s.id); closePanel(); hideHint();
}));
// list view
const lv = $('#listv');
$('#lvBody').innerHTML = Object.keys(ZONES).map(z => `<h3 style="color:${ZONES[z].color}">${ZONES[z].name}</h3><div class="grid">${Object.entries(ITEMS).filter(([, it]) => it.zone === z).map(([id, it]) => `<button type="button" data-item="${id}"><b>${esc(it.title)}</b><small>${esc(it.desc)}</small></button>`).join('')}</div>`).join('');
$('#lvBody').querySelectorAll('[data-item]').forEach(b => b.addEventListener('click', () => { lv.hidden = true; openItem(b.dataset.item); $('#pClose').focus(); }));
$('#listBtn').addEventListener('click', () => { lv.hidden = false; $('#lvClose').focus(); });
$('#lvClose').addEventListener('click', () => { lv.hidden = true; $('#listBtn').focus(); });
$('#introX').addEventListener('click', () => { $('#intro').hidden = true; });
let hintOff = false; function hideHint() { if (hintOff) return; hintOff = true; $('#hint').classList.add('off'); if (matchMedia('(max-width: 900px)').matches) $('#intro').hidden = true; }

// minimap
const map = $('#map'), mg = map.getContext('2d');
const mx = x => (x + W) / (2 * W) * map.width, mz = z => (z + D) / (2 * D) * map.height;
const zonesRect = [['weights', -19.5, -11.5, -5.5, -1.2], ['studio', -5, -11.5, 5, -4.2], ['cardio', 5.5, -11.5, 19.5, -1.2], ['spa', -19.5, 1.6, -4.8, 11.7], ['reception', -2, 8, 7, 11.7], ['fuel', 14.5, 6, 19.8, 10.8]];
function drawMap() {
  mg.clearRect(0, 0, map.width, map.height);
  mg.fillStyle = '#ffffff'; mg.fillRect(0, 0, map.width, map.height);
  for (const [id, x1, z1, x2, z2] of zonesRect) { mg.fillStyle = ZONES[id].color + '33'; mg.fillRect(mx(x1), mz(z1), mx(x2) - mx(x1), mz(z2) - mz(z1)); mg.fillStyle = ZONES[id].color; mg.font = '700 19px Figtree, system-ui, sans-serif'; mg.fillText(ZONES[id].name, mx(x1) + 6, mz(z1) + 22); }
  mg.strokeStyle = '#11201b22'; mg.lineWidth = 2; mg.strokeRect(1, 1, map.width - 2, map.height - 2);
  // you
  const px = mx(pos.x), pz = mz(pos.z);
  mg.save(); mg.translate(px, pz); mg.rotate(-yaw);
  mg.fillStyle = 'rgba(17,32,27,.16)'; mg.beginPath(); mg.moveTo(0, 0); mg.arc(0, 0, 44, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55); mg.closePath(); mg.fill();
  mg.restore();
  mg.fillStyle = '#11201b'; mg.beginPath(); mg.arc(px, pz, 8, 0, 7); mg.fill(); mg.strokeStyle = '#fff'; mg.lineWidth = 3; mg.stroke();
}
map.addEventListener('click', e => { const r = map.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * 2 * W - W, z = (e.clientY - r.top) / r.height * 2 * D - D; const dir = Math.atan2(-(x - pos.x), -(z - pos.z)); walkTo(x, z, dir); hideHint(); });

// ================= loop =================
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (tween) {
    tween.t += dt / tween.dur; const k = ease(Math.min(1, tween.t));
    pos.lerpVectors(tween.from, tween.to, k); yaw = tween.y0 + tween.dy * k; pitch = tween.p0 + (tween.p1 - tween.p0) * k;
    if (tween.t >= 1) tween = null;
  }
  if (keys.size) {
    const sp = 3.2 * dt, turn = 1.8 * dt;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw)); right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    if (keys.has('w') || keys.has('arrowup')) pos.addScaledVector(fwd, sp);
    if (keys.has('s') || keys.has('arrowdown')) pos.addScaledVector(fwd, -sp);
    if (keys.has('a')) pos.addScaledVector(right, -sp);
    if (keys.has('d')) pos.addScaledVector(right, sp);
    if (keys.has('arrowleft') || keys.has('q')) yaw += turn;
    if (keys.has('arrowright') || keys.has('e')) yaw -= turn;
  }
  clampPos(pos); applyCam();
  if (!reduce) { const t = clock.elapsedTime; markers.forEach((m, i) => m.scale.setScalar(0.42 + Math.sin(t * 2.4 + i) * 0.035)); }
  R.render(scene, camera); drawMap();
}
function loop() { frame(); requestAnimationFrame(loop); }
addEventListener('resize', () => { R.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
applyCam(); frame();
setStop('reception');
requestAnimationFrame(() => { $('#load').classList.add('off'); });
if (!window.__TOUR_SHOT) loop();
// for screenshots and tests
window.__tour = { walkTo: (x, z, yawDeg, pitchDeg, y = EYE) => { pos.set(x, y, z); yaw = THREE.MathUtils.degToRad(yawDeg); pitch = THREE.MathUtils.degToRad(pitchDeg); tween = null; camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); R.render(scene, camera); drawMap(); }, frame, openItem, setStop, state: () => ({ x: pos.x, z: pos.z, yaw: THREE.MathUtils.radToDeg(yaw), open: openId }),
  screenOf: id => { const m = markers.find(k => k.userData.item === id); const v = m.position.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, vis: v.z < 1 }; }, ids: Object.keys(ITEMS) };

