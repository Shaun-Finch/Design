// Health club 3D tour: a realistic, walkable club. PBR textures and models from Poly Haven / ambientCG (CC0),
// equipment modelled in code, lit by daylight through the windows plus LED ceiling light, with ambient occlusion.
// Walk with WASD / arrows, drag to look, click the floor to walk there, click a + for specs.
import * as THREE from 'three';
import { RoundedBoxGeometry } from './lib/jsm/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from './lib/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from './lib/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from './lib/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from './lib/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from './lib/jsm/postprocessing/SMAAPass.js';
import { Reflector } from './lib/jsm/objects/Reflector.js';
import { RectAreaLightUniformsLib } from './lib/jsm/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from './lib/jsm/utils/BufferGeometryUtils.js';
import { SimplexNoise } from './lib/jsm/math/SimplexNoise.js';
import { ZONES, STOPS, ITEMS } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LOW = !window.__TOUR_HIGH && (!!window.__TOUR_LOW || matchMedia('(pointer: coarse)').matches || innerWidth < 900 || (navigator.hardwareConcurrency || 8) <= 4);
const stage = $('#stage');
const W = 20, D = 12, H = 4.6, EYE = 1.62; // half-width (x), half-depth (z), ceiling, eye height
const A = 'health/assets/';

// ================= renderer =================
const R = new THREE.WebGLRenderer({ antialias: LOW, powerPreference: 'high-performance', preserveDrawingBuffer: !!window.__TOUR_SHOT });
if (!R.getContext()) throw new Error('WebGL unavailable');
R.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1.5 : 1.5));
R.setSize(innerWidth, innerHeight);
R.outputColorSpace = THREE.SRGBColorSpace;
R.toneMapping = THREE.AgXToneMapping;
R.toneMappingExposure = 1.3;
R.shadowMap.enabled = true;
R.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(R.domElement);
R.domElement.tabIndex = 0;
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe9ee');
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 200);
const pmrem = new THREE.PMREMGenerator(R);

const manager = new THREE.LoadingManager();
const loadEl = $('#load div');
manager.onProgress = (u, n, t) => { if (loadEl) loadEl.lastChild.textContent = ` Building the club… ${Math.round(100 * n / t)}%`; };
const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
const maxAniso = Math.min(8, R.capabilities.getMaxAnisotropy());

// sky through the windows (panorama made from a CC0 Poly Haven HDRI)
texLoader.load(A + 'sky/ballawley_park_4k.jpg', t => { t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; scene.background = t; scene.backgroundIntensity = 1.05; scene.backgroundRotation.set(0, Math.PI * 0.5, 0); });

// ================= lighting =================
scene.add(new THREE.HemisphereLight('#f4f8ff', '#e6dccd', 0.7));
const sun = new THREE.DirectionalLight('#fff1dc', 3.2);
sun.position.set(-6, 15, -26); sun.target.position.set(2, 0, 2); scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 4096, LOW ? 1024 : 4096);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 18, bottom: -18, near: 5, far: 70 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
scene.add(sun);
// LED linear fixtures: soft rectangular area lights pointing down
const fixtures = [];
for (let x = -15; x <= 15; x += 7.5) for (const z of [-7, 1.5, 8.5]) fixtures.push([x, z]);
fixtures.forEach(([x, z], i) => {
  if (LOW && i % 2) return;
  const l = new THREE.RectAreaLight('#fff6ea', LOW ? 16 : 11, 5.2, 0.3); l.position.set(x, H - 0.75, z); l.lookAt(x, 0, z); scene.add(l);
});

// ================= materials =================
const texCache = {};
function baseTex(key, srgb) {
  if (!texCache[key]) {
    const clones = [];
    const t = texLoader.load(key, () => clones.forEach(c => { c.needsUpdate = true; }));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texCache[key] = { t, clones };
  }
  return texCache[key];
}
function texSet(id, rx = 1, ry = 1, { hasArm = true, tint = null, rough = null, normal = 1 } = {}) {
  const base = A + 'tex/' + id + '/';
  const ld = (f, srgb) => {
    const b = baseTex(base + f, srgb), t = new THREE.Texture();
    t.source = b.t.source; t.colorSpace = b.t.colorSpace; t.anisotropy = maxAniso;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
    if (b.t.image && b.t.image.complete) t.needsUpdate = true; else b.clones.push(t);
    return t;
  };
  const p = { map: ld('diff.jpg', true), normalMap: ld('nor.jpg', false), normalScale: new THREE.Vector2(normal, -normal) };
  if (hasArm) { const arm = ld('arm.jpg', false); p.aoMap = arm; p.roughnessMap = arm; p.aoMapIntensity = 0.8; }
  else p.roughnessMap = ld('rough.jpg', false);
  if (tint) p.color = new THREE.Color(tint);
  if (rough != null) p.roughness = rough;
  return p;
}
// textures loaded asynchronously keep sharing images: refresh clones when the source image arrives
manager.onLoad = () => { bakeEnv(); afterLoad(); };
const std = (o = {}) => new THREE.MeshStandardMaterial(o);
const phys = (o = {}) => new THREE.MeshPhysicalMaterial(o);
const MAT = {
  steelBlack: phys({ color: '#1d2023', roughness: 0.42, metalness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
  steelGraphite: phys({ color: '#3a3f44', roughness: 0.4, metalness: 0.6, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
  steelWhite: phys({ color: '#e9ecee', roughness: 0.35, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  coral: phys({ color: '#e8604f', roughness: 0.38, metalness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  mint: phys({ color: '#14a77c', roughness: 0.38, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  chrome: std({ color: '#f2f4f5', roughness: 0.08, metalness: 1 }),
  satin: std({ color: '#c9ced2', roughness: 0.28, metalness: 1 }),
  alu: std({ color: '#b8bec3', roughness: 0.32, metalness: 0.9 }),
  rubber: std({ color: '#151617', roughness: 0.92, metalness: 0 }),
  rubberGrey: std({ color: '#2b2e30', roughness: 0.85 }),
  plasticBlack: phys({ color: '#141516', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  plasticMatte: std({ color: '#26292b', roughness: 0.6 }),
  plasticWhite: phys({ color: '#f1f2f0', roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
  glass: phys({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
  glassFrost: phys({ color: '#eef7f8', roughness: 0.35, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  leather: std(texSet('fabric_leather_02', 2, 2, { tint: '#2a2c2e' })),
  linen: std({ ...texSet('rough_linen', 2, 2, { tint: '#efe9df' }), map: null }),
  towel: std({ ...texSet('terry_cloth', 3, 3, { tint: '#fbfbf8' }), map: null }),
  walnut: std(texSet('smoked_walnut_veneer', 1, 1)),
  terrazzo: std(texSet('terrazzo_tiles', 2, 1, { rough: 0.25 })),
  cedar: std(texSet('japanese_cedar_planks', 4, 3)),
};
const floorM = (id, rx, ry, o) => std(texSet(id, rx, ry, o));

// ================= geometry helpers =================
function add(geo, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = shadow; parent.add(m); return m;
}
const rbox = (w, h, d, r, mat, x, y, z, p, seg = 3) => add(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), mat, x, y, z, p);
const box = (w, h, d, mat, x, y, z, p) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, p);
const cyl = (rt, rb, h, mat, x, y, z, p, seg = 32) => add(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, p);
function tube(pts, r, mat, p, seg = 48, closed = false) {
  const c = new THREE.CatmullRomCurve3(pts.map(a => new THREE.Vector3(...a)), closed, 'catmullrom', 0.2);
  return add(new THREE.TubeGeometry(c, seg, r, 14, closed), mat, 0, 0, 0, p);
}
function lathe(profile, mat, x, y, z, p, seg = 40) { return add(new THREE.LatheGeometry(profile.map(([a, b]) => new THREE.Vector2(a, b)), seg), mat, x, y, z, p); }
function group(x = 0, z = 0, ry = 0, parent = scene, y = 0) { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g; }
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t;
}
function textPlane(text, w, h, { fg = '#ffffff', bg = null, weight = 800, font = 'Figtree, system-ui, sans-serif', emissive = 0, align = 'center', pad = 0.06 } = {}) {
  const t = canvasTex(1024, Math.max(64, Math.round(1024 * h / w)), (g, cw, ch) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, cw, ch); }
    let fs = ch * 0.7; g.font = `${weight} ${fs}px ${font}`;
    while (g.measureText(text).width > cw * (1 - pad * 2) && fs > 8) { fs *= 0.93; g.font = `${weight} ${fs}px ${font}`; }
    g.fillStyle = fg; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(text, align === 'center' ? cw / 2 : cw * pad, ch / 2 + fs * 0.04);
  });
  const m = emissive ? std({ map: t, transparent: !bg, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: emissive, roughness: 0.5 }) : std({ map: t, transparent: !bg, roughness: 0.6 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); mesh.receiveShadow = true; return mesh;
}
// merge static meshes in a group by material (fewer draw calls), keeping click tags
function bake(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const by = new Map(), keep = [];
  g.traverse(o => { if (o.isMesh && !o.userData.keep && !o.material.transparent && o.geometry.attributes.uv) { const k = o.material.uuid + (o.castShadow ? 's' : ''); if (!by.has(k)) by.set(k, []); by.get(k).push(o); } });
  for (const [, list] of by) {
    if (list.length < 2) continue;
    const geos = list.map(o => { let ge = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const n of Object.keys(ge.attributes)) if (!['position', 'normal', 'uv'].includes(n)) ge.deleteAttribute(n); return ge.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); });
    let merged; try { merged = mergeGeometries(geos, false); } catch (e) { merged = null; }
    if (!merged) continue;
    list.forEach(o => o.parent.remove(o));
    const m = new THREE.Mesh(merged, list[0].material); m.castShadow = list[0].castShadow; m.receiveShadow = true; g.add(m);
  }
  return g;
}
const obstacles = [];
const block = (x, z, w, d) => obstacles.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);

// ================= building shell =================
// floors: oak laminate everywhere except the spa (separate deck with a pool cut-out)
{
  const s = new THREE.Shape(); s.moveTo(-W, D); s.lineTo(W, D); s.lineTo(W, -D); s.lineTo(-4.7, -D); s.lineTo(-4.7, -1.5); s.lineTo(-W, -1.5); s.closePath();
  const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, g.attributes.position.getX(i) / 2.2, g.attributes.position.getZ(i) / 2.2);
  add(g, floorM('laminate_floor_02', 1, 1, { tint: '#f3e8d8' }), 0, 0, 0, scene, false).receiveShadow = true;
  const sp = new THREE.Shape(); sp.moveTo(-W, -1.5); sp.lineTo(-4.7, -1.5); sp.lineTo(-4.7, -D); sp.lineTo(-W, -D); sp.closePath();
  const hole = new THREE.Path(); hole.moveTo(-17.6, -5.1); hole.lineTo(-17.6, -9.7); hole.lineTo(-7.4, -9.7); hole.lineTo(-7.4, -5.1); hole.closePath(); sp.holes.push(hole);
  const sg = new THREE.ShapeGeometry(sp); sg.rotateX(-Math.PI / 2);
  const su = sg.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, sg.attributes.position.getX(i) / 1.2, sg.attributes.position.getZ(i) / 1.2);
  add(sg, floorM('anti_skid_tiles', 1, 1, { tint: '#f4f4f1' }), 0, 0.002, 0, scene, false).receiveShadow = true;
}
const rubberM = floorM('rubber_tiles', 15 / 2, 11 / 2, { tint: '#e3e8e6' });
box(15, 0.02, 11, rubberM, -12.5, 0.01, -6.5).castShadow = false;
box(15, 0.02, 11, rubberM, 12.5, 0.01, -6.5).castShadow = false;
box(10, 0.02, 8, floorM('herringbone_parquet', 4, 3.2, { tint: '#f1e2c8' }), 0, 0.01, -8).castShadow = false;
// thin accent strips at the zone edges
box(15, 0.022, 0.06, MAT.coral, -12.5, 0.011, -0.98).castShadow = false;
box(15, 0.022, 0.06, std({ color: '#8E7CFF', roughness: 0.5 }), 12.5, 0.011, -0.98).castShadow = false;

// walls
const plaster = std(texSet('beige_wall_001', 10, 2.3, { tint: '#f7f5f0' }));
box(2 * W, H, 0.25, plaster, 0, H / 2, D + 0.125);
box(0.25, H, 2 * D, std(texSet('concrete_slab_wall', 6, 1.4, { tint: '#d9d7d2' })), -W - 0.125, H / 2, 0);
box(0.25, H, 2 * D, std(texSet('beige_wall_001', 6, 2.3, { tint: '#dfeae4' })), W + 0.125, H / 2, 0);
// north facade: full-height glazing with slim black mullions, sill and head
box(2 * W, 0.35, 0.3, MAT.steelBlack, 0, 0.175, -D - 0.15);
box(2 * W, 0.45, 0.3, MAT.steelBlack, 0, H - 0.225, -D - 0.15);
for (let x = -W; x <= W + 0.01; x += 2.5) box(0.07, H, 0.22, MAT.steelBlack, x, H / 2, -D - 0.12);
box(2 * W, 0.05, 0.12, MAT.steelBlack, 0, 2.9, -D - 0.12);
const glassN = box(2 * W, H - 0.8, 0.02, MAT.glass, 0, 0.35 + (H - 0.8) / 2, -D - 0.18); glassN.castShadow = false; glassN.receiveShadow = false;
// entrance: glass doors in the south wall
{
  const g = group(0, D - 0.01, 0);
  for (const x of [-0.85, 0.85]) { const d = box(1.6, 2.8, 0.03, MAT.glass, x, 1.45, -0.02, g); d.castShadow = false; box(0.04, 1.2, 0.04, MAT.satin, x - Math.sign(x) * 0.65, 1.2, -0.08, g); }
  box(3.5, 0.12, 0.14, MAT.steelBlack, 0, 2.9, -0.04, g);
}
// ceiling: dark exposed soffit, suspended black LED fixtures, round ducts, felt acoustic baffles
const ceilM = std({ color: '#eef0ef', roughness: 0.95 });
box(2 * W, 0.2, 2 * D, ceilM, 0, H + 0.1, 0).castShadow = true;
const ledHousing = std({ color: '#111213', roughness: 0.5, metalness: 0.4 });
const ledDiffuser = std({ color: '#ffffff', emissive: '#fff4e2', emissiveIntensity: 3.2, roughness: 0.3 });
fixtures.forEach(([x, z]) => {
  box(5.3, 0.08, 0.16, ledHousing, x, H - 0.72, z).castShadow = false;
  box(5.2, 0.012, 0.11, ledDiffuser, x, H - 0.765, z).castShadow = false;
  for (const dx of [-2.3, 2.3]) cyl(0.004, 0.004, 0.68, MAT.satin, x + dx, H - 0.34, z, scene, 6).castShadow = false;
});
const feltM = std({ color: '#cfe0d8', roughness: 1 });
for (let z = -10; z <= 10; z += 1.2) { const b = box(6, 0.5, 0.04, feltM, 0, H - 0.45, z); b.castShadow = false; }

// signage: illuminated wall signs
function sign(text, color, x, y, z, ry, w = 3.2) {
  const g = group(x, z, ry, scene, y);
  rbox(w, 0.56, 0.06, 0.03, MAT.steelBlack, 0, 0, 0, g);
  const dot = cyl(0.09, 0.09, 0.02, std({ color, emissive: color, emissiveIntensity: 1.6 }), -w / 2 + 0.32, 0, 0.035, g); dot.rotation.x = Math.PI / 2;
  const t = textPlane(text, w - 0.75, 0.4, { fg: '#f4f6f5', emissive: 1.4, pad: 0.02 }); t.position.set(0.2, 0, 0.033); g.add(t);
  return g;
}
sign('FREE WEIGHTS', ZONES.weights.color, -12.5, 3.55, -11.7, 0, 3.8);
sign('CARDIO', ZONES.cardio.color, 12.5, 3.55, -11.7, 0, 2.8);
sign('STUDIO', ZONES.studio.color, 0, 3.4, -4.02, 0, 2.6);
sign('SPA & POOL', ZONES.spa.color, -10, 3.3, 1.47, Math.PI, 3.4);
sign('FUEL BAR', ZONES.fuel.color, 19.86, 3.3, 8.4, -Math.PI / 2, 3);

// glass partitions (studio, spa) with black frames
function glassWall(x, z, w, h, ry) {
  const g = group(x, z, ry);
  const gl = box(w, h, 0.02, MAT.glass, 0, h / 2, 0, g); gl.castShadow = false;
  box(w, 0.05, 0.06, MAT.steelBlack, 0, h, 0, g); box(w, 0.05, 0.06, MAT.steelBlack, 0, 0.025, 0, g);
  for (let i = 0; i <= Math.round(w / 1.5); i++) box(0.05, h, 0.06, MAT.steelBlack, -w / 2 + i * (w / Math.round(w / 1.5)), h / 2, 0, g);
  return g;
}
glassWall(-5, -7.6, 6.8, 2.7, Math.PI / 2); block(-5, -7.6, 0.3, 6.8);
glassWall(5, -7.6, 6.8, 2.7, Math.PI / 2); block(5, -7.6, 0.3, 6.8);
glassWall(-12.35, 1.5, 15.3, 2.5, 0); block(-12.35, 1.5, 15.3, 0.3);
glassWall(-4.7, 3.75, 4.5, 2.5, Math.PI / 2); block(-4.7, 3.75, 0.3, 4.5);

// ================= interactive items =================
const hot = [];
function tag(obj, id) { obj.traverse(o => { if (o.isMesh) { o.userData.item = id; hot.push(o); } }); }
const markers = [];
const overlay = new THREE.Scene();
const markerTex = canvasTex(128, 128, g => {
  g.fillStyle = 'rgba(18,184,134,.28)'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.fill();
  g.strokeStyle = '#12B886'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 42, 0, 7); g.stroke();
  g.strokeStyle = '#11201b'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(64, 46); g.lineTo(64, 82); g.moveTo(46, 64); g.lineTo(82, 64); g.stroke();
});
function marker(id, x, y, z) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTex, depthTest: false, transparent: true, toneMapped: false }));
  s.position.set(x, y, z); s.scale.setScalar(0.4); s.renderOrder = 10; s.userData.item = id; overlay.add(s);
  markers.push(s); hot.push(s);
}

// screen UI for cardio consoles
function screenTex(kind, accent) {
  return canvasTex(512, 300, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0b1416'); gr.addColorStop(1, '#0f1d22'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = accent; g.font = '700 22px Figtree, sans-serif'; g.fillText(kind, 22, 38);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '600 16px Figtree, sans-serif'; g.fillText('TIME 18:42', w - 130, 38);
    const vals = kind === 'TREADMILL' ? [['SPEED', '9.5', 'km/h'], ['INCLINE', '2.0', '%'], ['HEART', '142', 'bpm']] : kind === 'ROWER' ? [['SPLIT', '2:04', '/500m'], ['RATE', '24', 'spm'], ['WATTS', '186', 'W']] : [['POWER', '212', 'W'], ['CADENCE', '88', 'rpm'], ['HEART', '138', 'bpm']];
    vals.forEach(([l, v, u], i) => { const x = 22 + i * 165; g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '600 15px Figtree, sans-serif'; g.fillText(l, x, 82); g.fillStyle = '#fff'; g.font = '800 54px Figtree, sans-serif'; g.fillText(v, x, 138); g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '600 15px Figtree, sans-serif'; g.fillText(u, x, 160); });
    g.strokeStyle = accent; g.lineWidth = 3; g.beginPath();
    for (let i = 0; i <= 60; i++) { const x = 22 + i * (w - 44) / 60, y = 250 - (Math.sin(i * 0.35) * 18 + Math.sin(i * 0.11) * 22 + 30); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    g.lineTo(w - 22, 272); g.lineTo(22, 272); g.closePath(); g.fillStyle = accent + '33'; g.fill();
  });
}
const screenMat = (kind, accent) => { const t = screenTex(kind, accent); return std({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.1, roughness: 0.15 }); };

// ---------- reception ----------
{
  const g = group(6.2, 9.6, 0);
  // curved-front desk: walnut slatted front, terrazzo top
  rbox(3.8, 1.02, 0.85, 0.06, MAT.walnut, 0, 0.51, 0, g);
  for (let i = 0; i < 26; i++) box(0.05, 0.98, 0.03, MAT.walnut, -1.85 + i * 0.148, 0.5, -0.44, g);
  rbox(4.0, 0.05, 1.0, 0.02, MAT.terrazzo, 0, 1.045, 0, g);
  box(3.6, 0.02, 0.02, std({ color: '#fff', emissive: '#bff3dd', emissiveIntensity: 2 }), 0, 0.03, -0.46, g).castShadow = false;
  const mon = group(-0.8, 0.1, Math.PI, g, 1.07); rbox(0.56, 0.34, 0.025, 0.01, MAT.plasticBlack, 0, 0.32, 0, mon); cyl(0.015, 0.015, 0.16, MAT.satin, 0, 0.1, -0.03, mon, 12); rbox(0.2, 0.012, 0.14, 0.004, MAT.satin, 0, 0.006, -0.02, mon);
  bake(g); tag(g, 'desk'); block(6.2, 9.6, 4.1, 1.2);
  // backlit wall behind the desk
  const wall = group(6.2, D - 0.02, Math.PI);
  box(5.6, 2.6, 0.06, MAT.walnut, 0, 1.95, 0, wall);
  for (let i = 0; i < 28; i++) box(0.06, 2.6, 0.04, MAT.walnut, -2.7 + i * 0.2, 1.95, 0.05, wall);
  const w1 = textPlane('Welcome', 2.6, 0.6, { fg: '#ffffff', emissive: 1.6 }); w1.position.set(0, 2.45, 0.08); wall.add(w1);
  const w2 = textPlane('TRAIN · RECOVER · REFUEL', 2.6, 0.22, { fg: '#bff3dd', emissive: 1.4, weight: 700 }); w2.position.set(0, 2.0, 0.08); wall.add(w2);
  bake(wall);
  marker('desk', 6.2, 1.95, 9.6);
}

// ---------- free weights ----------
function hexHead(r, len, mat) {
  const s = new THREE.Shape(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len - r * 0.24, bevelEnabled: true, bevelThickness: r * 0.12, bevelSize: r * 0.1, bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, -(len - r * 0.24) / 2); g.rotateY(Math.PI / 2); return new THREE.Mesh(g, mat);
}
const numTexCache = {};
function numberDecal(n, size) {
  const t = numTexCache[n] || (numTexCache[n] = canvasTex(128, 128, (g) => { g.fillStyle = '#e8e8e8'; g.font = '800 64px Figtree, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 66); }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), std({ map: t, transparent: true, roughness: 0.7 })); m.userData.keep = true; return m;
}
{ // dumbbell rack against the concrete west wall
  const g = group(-19.1, -6.2, Math.PI / 2);
  for (const x of [-2.25, 0, 2.25]) {
    rbox(0.07, 1.0, 0.07, 0.01, MAT.steelBlack, x, 0.5, 0.32, g); rbox(0.07, 1.0, 0.07, 0.01, MAT.steelBlack, x, 0.5, -0.32, g);
    rbox(0.07, 0.07, 0.75, 0.01, MAT.steelBlack, x, 0.035, 0, g);
  }
  for (const [y, z, tilt] of [[0.52, 0.16, 0.18], [0.92, -0.16, 0.18]]) {
    const tr = rbox(4.6, 0.04, 0.42, 0.01, MAT.steelBlack, 0, y, z, g); tr.rotation.x = tilt;
    rbox(4.6, 0.012, 0.36, 0.004, MAT.rubberGrey, 0, y + 0.026, z, g).rotation.x = tilt;
  }
  const headM = std({ color: '#1a1b1c', roughness: 0.78 });
  for (let i = 0; i < 16; i++) {
    const wkg = 2.5 + i * 2.5, r = 0.05 + i * 0.0052, L = 0.045 + i * 0.0055, tier = i < 8 ? 0 : 1;
    const x = -2.05 + (i % 8) * 0.585, y = (tier ? 0.95 : 0.55) + r * 0.95, z = tier ? -0.16 : 0.16;
    for (const dz of [-0.095, 0.095]) {
      const db = group(x, z + dz, 0, g, y);
      const hnd = cyl(0.016, 0.016, 0.15, MAT.satin, 0, 0, 0, db, 16); hnd.rotation.z = Math.PI / 2;
      for (const s of [-1, 1]) {
        const hd = hexHead(r, L, headM); hd.position.set(s * (0.075 + L / 2), 0, 0); hd.castShadow = hd.receiveShadow = true; db.add(hd);
        const dec = numberDecal(wkg, r * 1.05); dec.position.set(s * (0.075 + L + 0.002), 0, 0); dec.rotation.y = s * Math.PI / 2; db.add(dec);
      }
    }
  }
  bake(g); tag(g, 'dumbbells'); block(-19.1, -6.2, 0.9, 4.9); marker('dumbbells', -18.7, 1.6, -6.2);
}
{ // kettlebells on a low shelf by the windows
  const g = group(-15, -11.15, 0);
  rbox(3.7, 0.06, 0.55, 0.01, MAT.steelBlack, 0, 0.34, 0, g); rbox(3.7, 0.06, 0.55, 0.01, MAT.steelBlack, 0, 0.04, 0, g);
  for (const x of [-1.8, 1.8]) for (const z of [-0.24, 0.24]) rbox(0.05, 0.36, 0.05, 0.008, MAT.steelBlack, x, 0.19, z, g);
  const kcol = ['#F5A524', '#FF7A6B', '#E2639B', '#8E7CFF', '#22A6D9', '#12B886', '#3b3f44'];
  const ironM = std({ color: '#202224', roughness: 0.55, metalness: 0.45 });
  kcol.forEach((c, i) => {
    const s = 0.1 + i * 0.011, x = -1.5 + i * 0.5, y0 = 0.37;
    lathe([[0, 0], [s * 0.62, 0], [s * 0.9, s * 0.25], [s, s * 0.75], [s * 0.86, s * 1.35], [s * 0.45, s * 1.62], [0, s * 1.66]], ironM, x, y0, 0, g, 36);
    tube([[x - s * 0.55, y0 + s * 1.45, 0], [x - s * 0.62, y0 + s * 2.05, 0], [x - s * 0.3, y0 + s * 2.4, 0], [x + s * 0.3, y0 + s * 2.4, 0], [x + s * 0.62, y0 + s * 2.05, 0], [x + s * 0.55, y0 + s * 1.45, 0]], s * 0.16, ironM, g, 32);
    const band = cyl(s * 1.002, s * 1.002, s * 0.18, phys({ color: c, roughness: 0.35, clearcoat: 0.6 }), x, y0 + s * 0.75, 0, g, 36); band.userData.keep = false;
  });
  bake(g); tag(g, 'kettlebells'); block(-15, -11.15, 3.9, 0.8); marker('kettlebells', -15, 1.15, -11.15);
}
function holesTex() { return canvasTex(32, 256, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; for (let y = 8; y < h; y += 16) { g.beginPath(); g.arc(w / 2, y, 5, 0, 7); g.fill(); } }, false); }
{ // power rack, barbell with bumper plates, on a lifting platform
  const g = group(-11, -8.6, 0);
  rbox(2.4, 0.05, 2.4, 0.01, MAT.rubber, 0, 0.025, 0, g);
  box(1.0, 0.052, 2.38, MAT.walnut, 0, 0.026, 0, g);
  const ht = holesTex(); ht.wrapT = THREE.RepeatWrapping; ht.repeat.set(1, 2.4 / 0.8);
  const upM = phys({ color: '#e8604f', roughness: 0.38, metalness: 0.3, clearcoat: 0.5, alphaMap: ht, alphaTest: 0.5, side: THREE.DoubleSide });
  for (const x of [-0.62, 0.62]) for (const z of [-0.62, 0.62]) { const u = box(0.075, 2.4, 0.075, upM, x, 1.25, z, g); u.userData.keep = true; }
  for (const z of [-0.62, 0.62]) rbox(1.32, 0.075, 0.075, 0.01, MAT.coral, 0, 2.45, z, g);
  for (const x of [-0.62, 0.62]) rbox(0.075, 0.075, 1.32, 0.01, MAT.coral, x, 2.45, 0, g);
  const pull = cyl(0.016, 0.016, 1.3, MAT.satin, 0, 2.52, -0.68, g, 16); pull.rotation.z = Math.PI / 2;
  for (const x of [-0.62, 0.62]) { rbox(0.09, 0.12, 0.1, 0.01, MAT.steelBlack, x, 1.32, -0.72, g); rbox(0.05, 0.05, 0.75, 0.01, MAT.steelBlack, x, 0.75, -0.05, g); }
  // barbell
  const bar = group(0, -0.72, 0, g, 1.42);
  const sh = cyl(0.014, 0.014, 1.31, MAT.satin, 0, 0, 0, bar, 16); sh.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    const col = cyl(0.03, 0.03, 0.04, MAT.chrome, s * 0.675, 0, 0, bar, 24); col.rotation.z = Math.PI / 2;
    const sl = cyl(0.025, 0.025, 0.42, MAT.chrome, s * 0.905, 0, 0, bar, 24); sl.rotation.z = Math.PI / 2;
    [['#1a1b1c', 0.225, 0.06, 0.73], ['#2563c9', 0.225, 0.05, 0.79]].forEach(([c, r, t, px]) => {
      const pl = lathe([[0.026, -t / 2], [r * 0.92, -t / 2], [r, -t * 0.32], [r, t * 0.32], [r * 0.92, t / 2], [0.026, t / 2]], std({ color: c, roughness: 0.8 }), s * px, 0, 0, bar, 48); pl.rotation.z = Math.PI / 2;
      const hub = cyl(0.06, 0.06, t + 0.004, MAT.satin, s * px, 0, 0, bar, 24); hub.rotation.z = Math.PI / 2;
    });
  }
  bake(g); tag(g, 'rack'); block(-11, -8.6, 2.4, 2.4); marker('rack', -11, 2.85, -8.6);
  // plate storage tree
  const t = group(-8.0, -10.5, 0);
  rbox(0.7, 0.05, 0.7, 0.01, MAT.steelBlack, 0, 0.025, 0, t); rbox(0.06, 1.25, 0.06, 0.01, MAT.steelBlack, 0, 0.65, 0, t);
  [[0.38, '#1a1b1c', 0.225], [0.78, '#e8b021', 0.2], [1.1, '#2a9d5c', 0.17]].forEach(([y, c, r]) => { for (const s of [-1, 1]) { const h = cyl(0.025, 0.025, 0.24, MAT.satin, 0, y, s * 0.12, t, 12); h.rotation.x = Math.PI / 2; const p = lathe([[0.026, -0.03], [r * 0.93, -0.03], [r, -0.01], [r, 0.01], [r * 0.93, 0.03], [0.026, 0.03]], std({ color: c, roughness: 0.8 }), 0, y, s * 0.17, t, 40); p.rotation.x = Math.PI / 2; } });
  bake(t); tag(t, 'rack'); block(-8.0, -10.5, 0.8, 0.8);
}
function bench(x, z, ry, incline = 0) {
  const g = group(x, z, ry);
  rbox(0.08, 0.08, 1.2, 0.012, MAT.steelBlack, 0, 0.3, 0, g);
  for (const zz of [-0.5, 0.5]) { rbox(0.55, 0.06, 0.08, 0.012, MAT.steelBlack, 0, 0.03, zz, g); rbox(0.07, 0.3, 0.07, 0.01, MAT.steelBlack, 0, 0.18, zz * 0.85, g); cyl(0.03, 0.03, 0.04, MAT.rubber, 0.24, 0.02, zz, g, 12).rotation.z = Math.PI / 2; }
  const back = group(0, -0.17, 0, g, 0.42); back.rotation.x = -incline;
  rbox(0.3, 0.08, 0.82, 0.03, MAT.leather, 0, 0.04, -0.4, back, 4);
  rbox(0.3, 0.08, 0.4, 0.03, MAT.leather, 0, 0.42, 0.33, g, 4);
  bake(g); tag(g, 'bench'); block(x, z, 0.7, 1.4); return g;
}
bench(-11, -4.4, 0, 0); bench(-14.5, -4.4, 0, 0.55);
marker('bench', -11, 1.05, -4.4);

// ---------- turf track ----------
{
  const g = group(0, 2.2, 0);
  const turfM = std(texSet('Grass004', 1.3, 4.8, { hasArm: false, tint: '#7fc890', normal: 0.6 }));
  box(2.6, 0.025, 9.5, turfM, 0, 0.0125, 0, g).castShadow = false;
  for (const z of [-4.75, 4.75]) box(2.6, 0.027, 0.07, std({ color: '#fff', roughness: 0.7 }), 0, 0.0135, z, g).castShadow = false;
  for (let i = -3; i <= 3; i++) box(2.6, 0.027, 0.035, std({ color: '#eef8f0', roughness: 0.7 }), 0, 0.0136, i * 1.3, g).castShadow = false;
  // sled
  const sl = group(0.2, 1.4, 0, g);
  rbox(0.75, 0.06, 1.05, 0.015, MAT.steelBlack, 0, 0.05, 0, sl);
  for (const x of [-0.3, 0.3]) { rbox(0.06, 0.04, 1.05, 0.015, MAT.satin, x, 0.02, 0, sl); tube([[x, 0.08, -0.25], [x, 0.6, -0.4], [x, 0.98, -0.52]], 0.024, MAT.mint, sl, 12); }
  cyl(0.025, 0.025, 0.25, MAT.satin, 0, 0.2, 0.18, sl, 12);
  lathe([[0.026, -0.03], [0.21, -0.03], [0.225, 0], [0.21, 0.03], [0.026, 0.03]], std({ color: '#1a1b1c', roughness: 0.8 }), 0, 0.11, 0.18, sl, 40);
  // soft plyo boxes
  [[0.4, '#e8604f'], [0.5, '#7e6ff0'], [0.6, '#e8a21d']].forEach(([h, c], i) => rbox(0.62, h, 0.5, 0.05, std({ color: c, roughness: 0.75 }), -0.72 + i * 0.75, h / 2, -3.65, g, 4));
  // battle ropes coiled
  const ropeM = std({ color: '#1f2a26', roughness: 0.95 });
  for (const x of [-0.6, 0.6]) for (let k = 0; k < 3; k++) { const t = add(new THREE.TorusGeometry(0.2 + k * 0.05, 0.022, 10, 40), ropeM, x, 0.03 + k * 0.035, 4.1, g); t.rotation.x = Math.PI / 2; }
  bake(g); tag(g, 'turf'); block(0.2, 3.6, 0.95, 1.2); block(0, -1.45, 2.4, 0.7);
  marker('turf', 0.2, 1.3, 3.6);
}

// ---------- cardio ----------
const tmScreen = screenMat('TREADMILL', '#2ad1a3'), bkScreen = screenMat('BIKE', '#9b8cff'), rwScreen = screenMat('ROWER', '#2ad1a3');
function treadmill(x, z) {
  const g = group(x, z, 0);
  rbox(0.86, 0.17, 1.95, 0.05, MAT.plasticMatte, 0, 0.11, 0.05, g, 4);
  for (const s of [-1, 1]) rbox(0.08, 0.05, 1.9, 0.02, MAT.alu, s * 0.4, 0.21, 0.07, g);
  box(0.62, 0.012, 1.62, std({ color: '#1b1c1d', roughness: 0.95 }), 0, 0.2, 0.1, g);
  rbox(0.86, 0.3, 0.42, 0.08, MAT.plasticBlack, 0, 0.2, -0.85, g, 4);
  for (const s of [-1, 1]) { tube([[s * 0.36, 0.3, -0.85], [s * 0.37, 0.8, -0.95], [s * 0.36, 1.25, -0.92]], 0.032, MAT.steelWhite, g, 20); tube([[s * 0.36, 1.06, -0.9], [s * 0.4, 1.1, -0.55], [s * 0.4, 1.06, -0.25]], 0.022, MAT.steelWhite, g, 20); cyl(0.026, 0.026, 0.22, MAT.rubber, s * 0.4, 1.08, -0.5, g, 14).rotation.x = Math.PI / 2; }
  const con = group(0, -0.9, 0, g, 1.36); con.rotation.x = -0.42;
  rbox(0.86, 0.48, 0.07, 0.05, MAT.plasticBlack, 0, 0, 0, con, 4);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), tmScreen); sc.position.set(0, 0.03, 0.037); con.add(sc); sc.userData.keep = true;
  bake(g); tag(g, 'treadmill'); block(x, z, 1.0, 2.1); return g;
}
function bike(x, z) {
  const g = group(x, z, 0);
  for (const zz of [-0.5, 0.48]) { tube([[-0.27, 0.035, zz], [0, 0.07, zz], [0.27, 0.035, zz]], 0.03, MAT.steelGraphite, g, 12); for (const s of [-1, 1]) cyl(0.03, 0.035, 0.03, MAT.rubber, s * 0.27, 0.02, zz, g, 14); }
  tube([[0, 0.07, 0.48], [0, 0.35, 0.3], [0, 0.42, -0.1], [0, 0.6, -0.42], [0, 0.98, -0.5]], 0.04, MAT.steelGraphite, g, 40);
  tube([[0, 0.07, -0.5], [0, 0.3, -0.42], [0, 0.42, -0.1]], 0.035, MAT.steelGraphite, g, 20);
  const shroud = cyl(0.29, 0.29, 0.1, MAT.plasticWhite, 0, 0.44, -0.24, g, 48); shroud.rotation.z = Math.PI / 2;
  const fw = cyl(0.2, 0.2, 0.104, std({ color: '#9b8cff', roughness: 0.3, metalness: 0.7 }), 0, 0.44, -0.24, g, 48); fw.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) { const arm = rbox(0.02, 0.17, 0.035, 0.008, MAT.satin, s * 0.085, 0.36, 0.02, g); arm.rotation.x = s * 0.9; rbox(0.1, 0.022, 0.05, 0.008, MAT.rubber, s * 0.13, 0.36 + s * 0.05, 0.02 + s * 0.06, g); }
  rbox(0.05, 0.42, 0.05, 0.01, MAT.satin, 0, 0.66, 0.33, g).rotation.x = -0.2;
  const saddle = add(new THREE.SphereGeometry(0.13, 24, 12), MAT.leather, 0, 0.9, 0.38, g); saddle.scale.set(0.95, 0.38, 1.35);
  tube([[-0.22, 1.08, -0.62], [-0.18, 1.0, -0.5], [0, 0.99, -0.5], [0.18, 1.0, -0.5], [0.22, 1.08, -0.62]], 0.017, MAT.steelGraphite, g, 24);
  for (const s of [-1, 1]) cyl(0.022, 0.022, 0.12, MAT.rubber, s * 0.22, 1.1, -0.66, g, 12).rotation.x = Math.PI / 2 - 0.4;
  const con = group(0, -0.6, 0, g, 1.13); con.rotation.x = -0.5; rbox(0.24, 0.16, 0.035, 0.02, MAT.plasticBlack, 0, 0, 0, con);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.12), bkScreen); sc.position.z = 0.019; con.add(sc); sc.userData.keep = true;
  bake(g); tag(g, 'bike'); block(x, z, 0.65, 1.2); return g;
}
[8.2, 10.7, 13.2, 15.7].forEach(x => treadmill(x, -9.6));
[8.2, 10.2, 12.2, 14.2].forEach(x => bike(x, -5.6));
marker('treadmill', 11.95, 2.05, -9.8); marker('bike', 11.2, 1.7, -5.6);
{ // rowing machine
  const g = group(17.6, -5.6, 0);
  rbox(0.12, 0.08, 2.3, 0.02, MAT.alu, 0, 0.33, 0.15, g);
  rbox(0.5, 0.06, 0.12, 0.02, MAT.steelBlack, 0, 0.03, 1.25, g); rbox(0.1, 0.33, 0.1, 0.02, MAT.steelBlack, 0, 0.18, 1.25, g);
  const fan = cyl(0.33, 0.33, 0.3, MAT.plasticBlack, 0, 0.46, -1.05, g, 48); fan.rotation.z = Math.PI / 2;
  const grille = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#000'; for (let i = 0; i < 18; i++) { c.save(); c.translate(64, 64); c.rotate(i / 18 * Math.PI * 2); c.fillRect(14, -2.4, 46, 4.8); c.restore(); } }, false);
  for (const s of [-1, 1]) { const f = add(new THREE.CircleGeometry(0.31, 48), std({ color: '#2a2d30', roughness: 0.4, metalness: 0.5, alphaMap: grille, alphaTest: 0.5, side: THREE.DoubleSide }), s * 0.152, 0.46, -1.05, g); f.rotation.y = s * Math.PI / 2; f.userData.keep = true; }
  rbox(0.5, 0.05, 0.3, 0.02, MAT.steelBlack, 0, 0.04, -1.05, g);
  rbox(0.34, 0.07, 0.32, 0.03, MAT.plasticBlack, 0, 0.41, 0.25, g, 4);
  for (const s of [-1, 1]) { const fp = rbox(0.13, 0.03, 0.28, 0.012, MAT.plasticMatte, s * 0.11, 0.42, -0.62, g); fp.rotation.x = -0.9; }
  tube([[0, 0.48, -0.85], [0, 0.85, -0.82], [0, 1.0, -0.72]], 0.016, MAT.satin, g, 12);
  const con = group(0, -0.7, 0, g, 1.04); con.rotation.x = -0.5; rbox(0.22, 0.17, 0.035, 0.02, MAT.plasticBlack, 0, 0, 0, con);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.12), rwScreen); sc.position.z = 0.019; con.add(sc); sc.userData.keep = true;
  bake(g); tag(g, 'rower'); block(17.6, -5.6, 0.7, 2.7); marker('rower', 17.6, 1.25, -5.6);
}
{ // cross-trainer
  const g = group(17.9, -9.6, 0);
  rbox(0.62, 0.1, 1.75, 0.03, MAT.plasticMatte, 0, 0.06, 0, g, 4);
  const sh = cyl(0.27, 0.27, 0.22, MAT.plasticWhite, 0, 0.36, 0.72, g, 48); sh.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) {
    tube([[s * 0.16, 0.36, 0.72], [s * 0.17, 0.3, 0.2], [s * 0.17, 0.32, -0.3]], 0.025, MAT.steelWhite, g, 16);
    rbox(0.12, 0.03, 0.36, 0.01, MAT.rubber, s * 0.17, 0.35, 0.05, g);
    tube([[s * 0.17, 0.32, -0.3], [s * 0.22, 1.0, -0.42], [s * 0.26, 1.55, -0.28]], 0.022, MAT.steelWhite, g, 20);
  }
  rbox(0.12, 1.3, 0.12, 0.03, MAT.plasticMatte, 0, 0.7, -0.68, g);
  const con = group(0, -0.66, 0, g, 1.42); con.rotation.x = -0.35; rbox(0.32, 0.22, 0.04, 0.02, MAT.plasticBlack, 0, 0, 0, con);
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.16), bkScreen); sc.position.z = 0.021; con.add(sc); sc.userData.keep = true;
  bake(g); tag(g, 'xtrainer'); block(17.9, -9.6, 0.8, 1.9); marker('xtrainer', 17.9, 2.05, -9.6);
}

// ---------- fuel bar: vending machines ----------
function bottleProfile(h) { return [[0, 0], [0.034, 0], [0.036, 0.01], [0.036, h * 0.7], [0.028, h * 0.82], [0.014, h * 0.88], [0.014, h * 0.94], [0, h * 0.94]]; }
const labelTex = {};
function productLabel(p) {
  return labelTex[p.name] || (labelTex[p.name] = canvasTex(256, 128, (g, w, h) => { g.fillStyle = p.color; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.92)'; g.font = '800 30px Figtree, sans-serif'; g.fillText(p.name.split(' ')[0].toUpperCase(), 14, 48); g.font = '600 20px Figtree, sans-serif'; g.fillText(p.protein ? p.protein + 'g PROTEIN' : p.kcal + ' KCAL', 14, 84); }));
}
function vending(z, id, accent, products) {
  const g = group(19.4, z, -Math.PI / 2);
  const bodyM = phys({ color: '#f4f5f3', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  rbox(1.3, 1.95, 0.12, 0.03, bodyM, 0, 0.98, -0.37, g); // back
  for (const s of [-1, 1]) rbox(0.1, 1.95, 0.86, 0.03, bodyM, s * 0.6, 0.98, 0, g);
  rbox(1.3, 0.12, 0.86, 0.03, bodyM, 0, 1.92, 0, g); rbox(1.3, 0.3, 0.86, 0.03, bodyM, 0, 0.15, 0, g);
  rbox(1.32, 0.22, 0.88, 0.04, phys({ color: accent, roughness: 0.3, clearcoat: 0.6, emissive: accent, emissiveIntensity: 0.25 }), 0, 2.06, 0, g);
  const lab = textPlane(id === 'vend1' ? 'PROTEIN + RECOVERY' : 'FRESH FUEL', 1.15, 0.15, { fg: '#ffffff', emissive: 1.2 }); lab.position.set(0, 2.06, 0.445); g.add(lab);
  box(0.82, 1.6, 0.02, std({ color: '#ffffff', emissive: '#f4fffb', emissiveIntensity: 0.9, roughness: 0.4 }), -0.12, 1.08, -0.3, g).castShadow = false;
  const coilM = MAT.satin;
  for (let r = 0; r < 5; r++) {
    const y = 0.42 + r * 0.31;
    box(0.86, 0.015, 0.62, std({ color: '#d6dcdb', roughness: 0.3, metalness: 0.7 }), -0.12, y, 0, g);
    for (let c = 0; c < 5; c++) {
      const p = products[(r * 5 + c) % products.length], x = -0.47 + c * 0.175;
      const pts = []; for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2 * 4; pts.push([x + Math.cos(a) * 0.055, y + 0.06 + Math.sin(a) * 0.055, -0.27 + k / 48 * 0.55]); }
      tube(pts, 0.0035, coilM, g, 120);
      if (r % 2 === 0) { const b = lathe(bottleProfile(0.2), phys({ color: '#ffffff', roughness: 0.25, clearcoat: 1 }), x, y + 0.01, 0.22, g, 24); const lbl = cyl(0.0365, 0.0365, 0.09, std({ map: productLabel(p), roughness: 0.4 }), x, y + 0.08, 0.22, g, 24); lbl.rotation.y = -Math.PI / 2; cyl(0.016, 0.016, 0.02, phys({ color: p.color, roughness: 0.3, clearcoat: 1 }), x, y + 0.2, 0.22, g, 16); }
      else { const bx = rbox(0.13, 0.17, 0.035, 0.008, std({ map: productLabel(p), roughness: 0.45 }), x, y + 0.1, 0.22, g); bx.userData.keep = true; }
    }
  }
  const gl = box(1.0, 1.66, 0.012, MAT.glass, -0.12, 1.06, 0.43, g); gl.castShadow = false;
  rbox(0.2, 1.66, 0.05, 0.015, bodyM, 0.47, 1.06, 0.41, g);
  rbox(0.14, 0.24, 0.02, 0.01, MAT.plasticBlack, 0.47, 1.25, 0.445, g);
  const pscr = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), std({ color: '#000', emissive: accent, emissiveIntensity: 0.7 })); pscr.position.set(0.47, 1.33, 0.456); g.add(pscr); pscr.userData.keep = true;
  rbox(0.9, 0.16, 0.04, 0.02, MAT.plasticBlack, -0.12, 0.34, 0.43, g);
  tag(g, id); bake(g); block(19.3, z, 1.3, 1.4);
  marker(id, 18.95, 2.45, z);
}
vending(7.3, 'vend1', '#F5A524', ITEMS.vend1.products);
vending(9.5, 'vend2', '#12B886', ITEMS.vend2.products);
{ // high table
  const g = group(16.4, 8.4, 0);
  cyl(0.45, 0.45, 0.035, MAT.terrazzo, 0, 1.06, 0, g, 48); cyl(0.035, 0.035, 1.04, MAT.steelBlack, 0, 0.52, 0, g, 16); cyl(0.26, 0.28, 0.025, MAT.steelBlack, 0, 0.012, 0, g, 40);
  bake(g); block(16.4, 8.4, 1.0, 1.0);
}

// ---------- spa ----------
const waterNormal = (() => {
  const n = new SimplexNoise(), S = 256, hgt = new Float32Array(S * S), TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S * TAU, v = y / S * TAU; let val = 0, amp = 1, r = 0.9;
    for (let o = 0; o < 3; o++) { val += amp * n.noise4d(Math.cos(u) * r, Math.sin(u) * r, Math.cos(v) * r, Math.sin(v) * r); amp *= 0.5; r *= 2; }
    hgt[y * S + x] = val;
  }
  const data = new Uint8Array(S * S * 4), at = (x, y) => hgt[((y + S) % S) * S + ((x + S) % S)];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = new THREE.Vector3(-(at(x + 1, y) - at(x - 1, y)) * 3, -(at(x, y + 1) - at(x, y - 1)) * 3, 1).normalize(), i = (y * S + x) * 4;
    data[i] = (v.x * 0.5 + 0.5) * 255; data[i + 1] = (v.y * 0.5 + 0.5) * 255; data[i + 2] = (v.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; t.repeat.set(4, 1.8); return t;
})();
let waterMat;
{ // sunken pool
  const g = group(-12.5, 7.4, 0);
  const tileM = std(texSet('blue_floor_tiles_01', 10, 1.6, { tint: '#bfe7f5' }));
  const floorTile = std(texSet('blue_floor_tiles_01', 10, 4.6, { tint: '#bfe7f5' }));
  box(10.2, 0.05, 4.6, floorTile, 0, -1.45, 0, g).castShadow = false;
  box(10.2, 1.5, 0.05, tileM, 0, -0.72, -2.3, g); box(10.2, 1.5, 0.05, tileM, 0, -0.72, 2.3, g);
  box(0.05, 1.5, 4.6, tileM, -5.1, -0.72, 0, g); box(0.05, 1.5, 4.6, tileM, 5.1, -0.72, 0, g);
  for (const [w, d, x, z] of [[10.6, 0.25, 0, -2.42], [10.6, 0.25, 0, 2.42], [0.25, 4.6, -5.22, 0], [0.25, 4.6, 5.22, 0]]) rbox(w, 0.06, d, 0.02, MAT.terrazzo, x, 0.03, z, g).castShadow = false;
  for (const z of [-1.15, 0, 1.15]) box(10.2, 0.012, 0.12, std({ color: '#1d3f8a', roughness: 0.5 }), 0, -1.42, z, g).castShadow = false;
  waterMat = phys({ color: '#5cc6dd', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.62, normalMap: waterNormal, normalScale: new THREE.Vector2(0.25, 0.25), clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  const water = add(new THREE.PlaneGeometry(10.2, 4.6), waterMat, 0, -0.08, 0, g, false); water.rotation.x = -Math.PI / 2; water.receiveShadow = true;
  // lane ropes: floats as instanced discs
  const floatGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.085, 16); floatGeo.rotateZ(Math.PI / 2);
  for (const z of [-1.15, 0, 1.15]) {
    const im = new THREE.InstancedMesh(floatGeo, phys({ roughness: 0.3, clearcoat: 0.8 }), 112);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    for (let i = 0; i < 112; i++) { m4.makeTranslation(-5.05 + i * 0.09, -0.07, z); im.setMatrixAt(i, m4); im.setColorAt(i, col.set(i % 10 < 5 ? (i < 16 || i > 95 ? '#d93a2b' : '#1f6fd1') : '#f5f5f5')); }
    im.castShadow = true; g.add(im);
  }
  // ladder
  for (const s of [-1, 1]) tube([[3.6 + s * 0.25, -1.0, 2.18], [3.6 + s * 0.25, 0.3, 2.22], [3.6 + s * 0.25, 0.75, 2.35], [3.6 + s * 0.25, 0.6, 2.55], [3.6 + s * 0.25, 0.02, 2.6]], 0.02, MAT.chrome, g, 40);
  for (let k = 0; k < 3; k++) box(0.42, 0.02, 0.08, MAT.satin, 3.6, -0.85 + k * 0.28, 2.22, g);
  tag(g, 'pool'); block(-12.5, 7.4, 10.7, 5.1); marker('pool', -12.5, 0.9, 7.4);
}
{ // Finnish sauna cabin
  const g = group(-17.9, 3.25, 0);
  const cedar = MAT.cedar;
  rbox(3.2, 2.5, 2.2, 0.03, cedar, 0, 1.25, 0, g);
  box(0.9, 2.0, 0.08, std({ color: '#6b4527', roughness: 0.6 }), 0.75, 1.0, 1.08, g);
  const door = box(0.8, 1.9, 0.02, phys({ color: '#ffcf9a', roughness: 0.05, transparent: true, opacity: 0.35, emissive: '#ff9a4d', emissiveIntensity: 0.6 }), 0.75, 1.0, 1.13, g); door.castShadow = false;
  box(0.03, 0.4, 0.05, std({ color: '#3b2614', roughness: 0.6 }), 0.42, 1.05, 1.17, g);
  const l = textPlane('SAUNA', 1.0, 0.24, { fg: '#3b2614', weight: 800 }); l.position.set(-0.75, 2.05, 1.112); g.add(l);
  const glow = new THREE.PointLight('#ff9a4d', 2.5, 4, 2); glow.position.set(0.75, 1.3, 0.5); g.add(glow);
  tag(g, 'sauna'); block(-17.9, 3.25, 3.4, 2.4); marker('sauna', -17.9, 2.85, 3.25);
}
{ // steam room
  const g = group(-14.2, 3.25, 0);
  rbox(2.6, 2.5, 2.2, 0.03, std(texSet('long_white_tiles', 3, 3, { tint: '#f4f7f7' })), 0, 1.25, 0, g);
  const fr = box(2.2, 2.0, 0.02, MAT.glassFrost, 0, 1.1, 1.115, g); fr.castShadow = false;
  box(2.24, 0.04, 0.04, MAT.satin, 0, 2.11, 1.12, g); box(0.03, 0.45, 0.04, MAT.chrome, 0.85, 1.05, 1.15, g);
  const l = textPlane('STEAM', 1.0, 0.24, { fg: '#2a6f8f', weight: 800 }); l.position.set(0, 2.3, 1.112); g.add(l);
  tag(g, 'steam'); block(-14.2, 3.25, 2.8, 2.4); marker('steam', -14.2, 2.85, 3.25);
}
{ // teak loungers with linen cushions and rolled towels
  const g = group(-12.5, 10.9, 0);
  const teak = std(texSet('smoked_walnut_veneer', 1, 1, { tint: '#d9b48a' }));
  for (let i = 0; i < 5; i++) {
    const x = -4 + i * 2, lg = group(x, 0, 0, g);
    for (const s of [-1, 1]) { rbox(0.05, 0.05, 1.9, 0.01, teak, s * 0.33, 0.28, 0, lg); for (const zz of [-0.85, 0.85]) rbox(0.05, 0.28, 0.05, 0.01, teak, s * 0.33, 0.14, zz, lg); }
    for (let k = 0; k < 12; k++) rbox(0.68, 0.02, 0.07, 0.005, teak, 0, 0.31, -0.2 + k * 0.095, lg);
    const back = group(0, -0.35, 0, lg, 0.3); back.rotation.x = 0.85; for (let k = 0; k < 7; k++) rbox(0.68, 0.02, 0.07, 0.005, teak, 0, 0, -0.08 - k * 0.095, back);
    rbox(0.64, 0.08, 1.2, 0.035, MAT.linen, 0, 0.36, 0.33, lg, 4);
    const bc = rbox(0.64, 0.07, 0.66, 0.03, MAT.linen, 0, 0.05, -0.36, back, 4);
    const tw = cyl(0.07, 0.07, 0.5, MAT.towel, 0, 0.47, 0.7, lg, 20); tw.rotation.z = Math.PI / 2;
  }
  bake(g); tag(g, 'loungers'); block(-12.5, 10.9, 9.8, 1.95); marker('loungers', -12.5, 1.05, 10.9);
}

// ---------- studio ----------
let mirror = null;
{
  const g = group(0, -8, 0);
  if (!LOW) {
    mirror = new Reflector(new THREE.PlaneGeometry(9.2, 2.5), { clipBias: 0.003, textureWidth: Math.round(innerWidth * 0.75), textureHeight: Math.round(innerHeight * 0.75), color: '#c9cfd1' });
    mirror.position.set(0, 1.5, -3.83); g.add(mirror);
  } else box(9.2, 2.5, 0.02, std({ color: '#e9eff1', metalness: 0.9, roughness: 0.08 }), 0, 1.5, -3.84, g);
  box(9.4, 0.04, 0.05, MAT.steelBlack, 0, 0.24, -3.82, g); box(9.4, 0.04, 0.05, MAT.steelBlack, 0, 2.76, -3.82, g);
  const barre = cyl(0.022, 0.022, 9.0, std(texSet('smoked_walnut_veneer', 3, 1, { tint: '#e3c69d' })), 0, 1.05, -3.6, g, 16); barre.rotation.z = Math.PI / 2;
  const matsC = ['#d95f8f', '#7e6ff0', '#14a77c', '#2b9bd1', '#e8a21d', '#e8604f'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) rbox(0.6, 0.008, 1.75, 0.003, std({ color: matsC[(c + r) % 6], roughness: 0.85 }), -3.75 + c * 1.5, 0.015, -1.6 + r * 2.4, g);
  for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.32, 32, 20), phys({ color: ['#f6c8d6', '#d7d0ff', '#c8f1e2', '#cdebfa'][i], roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }), 4.0, 0.32, -2.8 + i * 0.72, g);
  for (let i = 0; i < 6; i++) { const r = cyl(0.075, 0.075, 0.45, std({ color: '#2b2f31', roughness: 0.9 }), -4.2, 0.075, -2.6 + i * 0.2, g, 20); r.rotation.z = Math.PI / 2; }
  tag(g, 'studio'); marker('studio', 0, 2.6, -8.4);
}

// ---------- real models (Poly Haven, CC0) ----------
const modelCache = {};
function model(id) { return modelCache[id] || (modelCache[id] = gltfLoader.loadAsync(A + `models/${id}/${id}_1k.gltf`).then(g => { g.scene.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } }); return g.scene; })); }
async function place(id, { x, y = 0, z, ry = 0, s = 1, pick = null, item = null, solid = 0 }) {
  try {
    const src = await model(id); let obj;
    if (pick) { obj = new THREE.Group(); src.children.filter(c => pick.some(p => c.name.endsWith(p) || c.name.includes(p))).forEach(c => obj.add(c.clone())); }
    else obj = src.clone();
    const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group(); obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b.min.y; wrap.add(obj);
    wrap.position.set(x, y, z); wrap.rotation.y = ry; wrap.scale.setScalar(s); scene.add(wrap);
    if (item) tag(wrap, item);
    return wrap;
  } catch (e) { console.warn('model', id, e); }
}
[[-19, 11, 1.6], [-4.3, 11.3, 1.5], [19, 11.2, 1.5], [-5.6, -0.4, 1.4], [5.6, -0.4, 1.4], [19, 4.6, 1.6], [-19.2, -0.5, 1.5]].forEach(([x, z, s], i) => { place('potted_plant_02', { x, z, s, ry: i * 1.3 }); block(x, z, 0.9, 0.9); });
[['_a', -18.6, -11.2], ['_c', 18.8, -0.6], ['_d', 2.4, 11.2]].forEach(([v, x, z]) => { place('pachira_aquatica_01', { x, z, pick: [v], s: 1.15 }); block(x, z, 0.9, 0.9); });
place('potted_plant_04', { x: 7.5, y: 1.07, z: 9.55 }); place('potted_plant_04', { x: 5.0, y: 1.07, z: 9.7, ry: 1.2 });
// reception lounge
place('sofa_02', { x: 1.6, z: 7.0, ry: Math.PI }).then(w => w && w.traverse(o => { if (o.isMesh) o.material = std({ ...texSet('rough_linen', 3, 3, { tint: '#cddbd2' }), map: null }); })); block(1.6, 7.0, 1.9, 0.9);
place('modern_arm_chair_01', { x: 0.0, z: 5.4, ry: -Math.PI / 2 + 0.3 }); block(0, 5.4, 0.9, 0.9);
place('modern_arm_chair_01', { x: 3.2, z: 5.4, ry: Math.PI / 2 - 0.3 }); block(3.2, 5.4, 0.9, 0.9);
place('modern_coffee_table_01', { x: 1.6, z: 5.6, ry: Math.PI / 2 }); block(1.6, 5.6, 1.2, 0.6);
for (const x of [5.0, 6.2, 7.4]) place('modern_ceiling_lamp_01', { x, y: H - 1.25, z: 9.6, s: 1.3 });
// fuel bar
for (const a of [0.5, 2.6, 4.7]) {
  const st = group(16.4 + Math.cos(a) * 0.74, 8.4 + Math.sin(a) * 0.74, 0);
  rbox(0.38, 0.07, 0.38, 0.03, MAT.leather, 0, 0.77, 0, st, 4); lathe([[0, 0], [0.2, 0], [0.2, 0.015], [0.04, 0.03], [0, 0.03]], MAT.steelBlack, 0, 0, 0, st, 32);
  cyl(0.022, 0.022, 0.74, MAT.steelBlack, 0, 0.4, 0, st, 16); add(new THREE.TorusGeometry(0.16, 0.01, 8, 32), MAT.satin, 0, 0.3, 0, st).rotation.x = Math.PI / 2;
  bake(st); block(st.position.x, st.position.z, 0.42, 0.42);
}
place('bananas', { x: 16.35, y: 1.08, z: 8.35, s: 0.8, ry: 0.4 });
// pool side + safety
place('WetFloorSign_01', { x: -6.6, z: 5.6, ry: 0.6 }); block(-6.6, 5.6, 0.45, 0.45);
place('lifebuoy', { x: -19.85, y: 1.05, z: 7.4, ry: Math.PI / 2 });
place('korean_fire_extinguisher_01', { x: 1.9, z: 11.7, ry: Math.PI });
place('wall_clock', { x: -19.86, y: 2.75, z: -6.2, ry: Math.PI / 2, s: 1.4 });
// ducts along the ceiling
model('modular_airduct_circular_01').then(src => {
  const piece = src.children.find(c => c.name === 'modular_airduct_circular_triple'); if (!piece) return;
  const probe = piece.clone(); probe.position.set(0, 0, 0); probe.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(probe), size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
  const alongX = size.x >= size.z, len = Math.max(size.x, size.z);
  for (const zLine of [-4, 6]) for (let x = -W + len / 2; x < W - len / 2; x += len) {
    const k = piece.clone(); k.position.set(-c.x, -c.y, -c.z);
    const wrap = new THREE.Group(); wrap.add(k); if (!alongX) wrap.rotation.y = Math.PI / 2;
    wrap.position.set(x, H - 0.3, zLine); wrap.traverse(o => { if (o.isMesh) o.castShadow = false; }); scene.add(wrap);
  }
});

// ================= environment reflections baked from the room =================
let envRT = null;
function bakeEnv() {
  if (mirror) mirror.visible = false;
  const cam = new THREE.CubeCamera(0.1, 100, new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }));
  cam.position.set(0, 1.8, 2); scene.add(cam); scene.environment = null; cam.update(R, scene); scene.remove(cam);
  if (envRT) envRT.dispose(); envRT = pmrem.fromCubemap(cam.renderTarget.texture); scene.environment = envRT.texture; scene.environmentIntensity = 1.1;
  if (mirror) mirror.visible = true;
}
bakeEnv();

// ================= post-processing =================
let composer = null, gtao = null;
function setupComposer() {
  const w = innerWidth, h = innerHeight;
  composer = new EffectComposer(R);
  composer.addPass(new RenderPass(scene, camera));
  if (!LOW) {
    gtao = new GTAOPass(scene, camera, w, h);
    gtao.output = GTAOPass.OUTPUT.Default; gtao.blendIntensity = 0.9;
    gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 1 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
  }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), LOW ? 0.18 : 0.25, 0.5, 0.92));
  composer.addPass(new OutputPass());
  if (!LOW) composer.addPass(new SMAAPass(w * R.getPixelRatio(), h * R.getPixelRatio()));
}
setupComposer();
function render() { composer.render(); R.autoClear = false; R.clearDepth(); R.render(overlay, camera); R.autoClear = true; }
function afterLoad() {}

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
  if (waterMat && !reduce) { waterNormal.offset.x += dt * 0.012; waterNormal.offset.y += dt * 0.007; }
  render(); drawMap();
}
// render every frame while moving; at a gentle rate when idle; step quality down on slow machines
let lastActive = performance.now(), idleSkip = 0, slow = 0, frames = 0, tAcc = 0, tPrev = performance.now();
['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastActive = performance.now(); }, { passive: true }));
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now(), busy = tween || keys.size || now - lastActive < 1500;
  if (!busy && (idleSkip = (idleSkip + 1) % 4)) return;
  frame();
  const ft = now - tPrev; tPrev = now; if (busy && ft < 500) { tAcc += ft; frames++; }
  if (frames === 90) { if (tAcc / frames > 45) slow++; else slow = 0; frames = 0; tAcc = 0;
    if (slow === 1 && gtao && gtao.enabled) gtao.enabled = false;
    else if (slow === 2) R.setPixelRatio(1);
    else if (slow === 3 && mirror) { mirror.visible = false; } }
}
addEventListener('resize', () => { R.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); if (gtao) gtao.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
applyCam(); frame();
setStop('reception');
const hideLoad = () => { $('#load').classList.add('off'); window.__tourReady = true; };
manager.onLoad = ((prev) => () => { prev(); hideLoad(); })(manager.onLoad);
setTimeout(hideLoad, 12000);
if (!window.__TOUR_SHOT) loop();
// for screenshots and tests
window.__tour = { walkTo: (x, z, yawDeg, pitchDeg, y = EYE) => { pos.set(x, y, z); yaw = THREE.MathUtils.degToRad(yawDeg); pitch = THREE.MathUtils.degToRad(pitchDeg); tween = null; camera.position.copy(pos); camera.rotation.set(pitch, yaw, 0, 'YXZ'); render(); drawMap(); }, frame, openItem, setStop, state: () => ({ x: pos.x, z: pos.z, yaw: THREE.MathUtils.radToDeg(yaw), open: openId }),
  screenOf: id => { const m = markers.find(k => k.userData.item === id); const v = m.position.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, vis: v.z < 1 }; }, ids: Object.keys(ITEMS) };

