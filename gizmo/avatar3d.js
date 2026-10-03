// Gizmo — real-time 3D avatar (three.js). Built from primitives, lit with a studio environment.
// API: createAvatar(el, {onClick}) -> { setState, move, look, setTalk, isBusy, dispose }
import * as THREE from 'three';
import { RoundedBoxGeometry } from './lib/addons/RoundedBoxGeometry.js';
import { RoomEnvironment } from './lib/addons/RoomEnvironment.js';

const PI = Math.PI;
const ease = {
  io: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// smooth bump: 0 -> 1 -> 0 over [a,b]
const bump = (p, a, b) => (p <= a || p >= b) ? 0 : Math.sin(PI * (p - a) / (b - a));
const jump = (p, a, b) => bump(p, a, b) ** .85;

function helix(radius, height, turns, tube, mat) {
  const pts = [];
  const n = Math.round(turns * 40);
  for (let i = 0; i <= n; i++) {
    const a = i / n * turns * PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, -i / n * height, Math.sin(a) * radius));
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, tube, 10, false), mat);
  m.castShadow = true;
  return m;
}

// Rounded-square solid: |x/a|^n + |y/b|^n + |z/c|^n = 1, with separate top/bottom half-heights
// (the top a touch taller so the head reads as slightly domed). Normals come from the exact gradient.
function superBlob(a, bt, bb, c, n, ws, hs) {
  const g = new THREE.SphereGeometry(1, ws, hs), P = g.attributes.position, N = g.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    const dx = P.getX(i), dy = P.getY(i), dz = P.getZ(i), b = dy > 0 ? bt : bb;
    const f = Math.pow(Math.abs(dx / a), n) + Math.pow(Math.abs(dy / b), n) + Math.pow(Math.abs(dz / c), n);
    const t = Math.pow(f, -1 / n), x = dx * t, y = dy * t, z = dz * t;
    P.setXYZ(i, x, y, z);
    const gr = new THREE.Vector3(Math.sign(x) * Math.pow(Math.abs(x / a), n - 1) / a, Math.sign(y) * Math.pow(Math.abs(y / b), n - 1) / b, Math.sign(z) * Math.pow(Math.abs(z / c), n - 1) / c);
    if (gr.lengthSq() < 1e-12) gr.set(dx, dy, dz);
    gr.normalize(); N.setXYZ(i, gr.x, gr.y, gr.z);
  }
  P.needsUpdate = true; N.needsUpdate = true;
  return g;
}

export function createAvatar(el, opts = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let R;
  try {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch (e) { return null; }
  if (!R.getContext()) return null;
  R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  R.outputColorSpace = THREE.SRGBColorSpace;
  R.toneMapping = THREE.ACESFilmicToneMapping;
  R.toneMappingExposure = 1.05;
  R.shadowMap.enabled = true;
  R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.setClearColor(0x000000, 0);
  el.appendChild(R.domElement);
  R.domElement.setAttribute('aria-hidden', 'true');

  const S = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(R);
  S.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  S.environmentIntensity = 0.85;

  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const CAM = opts.framing === 'close' ? { y: 2.05, d: 9.3, look: 1.95 } : { y: 2.4, d: 10.6, look: 2.25 };
  cam.position.set(0, CAM.y, CAM.d);
  cam.lookAt(0, CAM.look, 0);
  let camFollow = 0;

  // lights
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(-1.6, 9, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 8;
  key.shadow.bias = -0.0005;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 6, bottom: -2, near: .5, far: 30 });
  S.add(key);
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.4);
  rim.position.set(4, 5, -6);
  S.add(rim);
  S.add(new THREE.HemisphereLight(0xffffff, 0xdfe8f2, .55));

  // ground shadow catcher
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ color: 0x0b2a5e, opacity: .16 }));
  ground.rotation.x = -PI / 2;
  ground.receiveShadow = true;
  S.add(ground);

  const blob = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshBasicMaterial({ color: 0x0b2a5e, transparent: true, opacity: .12, depthWrite: false }));
  blob.rotation.x = -PI / 2; blob.position.y = .01; blob.scale.set(1, .55, 1); blob.visible = false; S.add(blob);

  // materials (palette from Shaun's reference robot: white shell, sky-blue panels, silver springs)
  const M = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf0f2f5, roughness: .26, metalness: 0, clearcoat: 1, clearcoatRoughness: .12 }),
    grey: new THREE.MeshPhysicalMaterial({ color: 0xc9cfd6, roughness: .32, clearcoat: .8, clearcoatRoughness: .2 }),
    blue: new THREE.MeshPhysicalMaterial({ color: 0x74abe4, roughness: .34, clearcoat: .7, clearcoatRoughness: .2 }),   // lighter details
    pants: new THREE.MeshPhysicalMaterial({ color: 0x3f78c4, roughness: .4, clearcoat: .6, clearcoatRoughness: .25 }), // dungarees
    brow: new THREE.MeshPhysicalMaterial({ color: 0x2a62b4, roughness: .32, clearcoat: .8, clearcoatRoughness: .2 }),
    face: new THREE.MeshPhysicalMaterial({ color: 0x8dbbe6, roughness: .45, clearcoat: .35, clearcoatRoughness: .25 }),
    faceIn: new THREE.MeshPhysicalMaterial({ color: 0x8dbbe6, roughness: .45, clearcoat: .35, clearcoatRoughness: .25, vertexColors: true }),
    silver: new THREE.MeshStandardMaterial({ color: 0x8a929b, roughness: .28, metalness: 1 }),   // darker metal
    dark: new THREE.MeshPhysicalMaterial({ color: 0x0f1218, roughness: .12, clearcoat: 1, clearcoatRoughness: .05 }),
    panel: new THREE.MeshPhysicalMaterial({ color: 0x3a4049, roughness: .35, clearcoat: .6 }),
    sclera: new THREE.MeshPhysicalMaterial({ color: 0xfbfdff, roughness: .2, clearcoat: 1 }),
    led: new THREE.MeshStandardMaterial({ color: 0x8fd0ff, emissive: 0x2f8cff, emissiveIntensity: .0, roughness: .3 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x74abe4, emissive: 0x2f8cff, emissiveIntensity: 0, roughness: .3 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: .5 }),
  };
  const mesh = (g, m, p = [0, 0, 0], s) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(...p);
    if (s) o.scale.set(...s);
    o.castShadow = true; o.receiveShadow = true;
    return o;
  };

  // ---------- rig ----------
  // Proportions follow Shaun's reference robot: short and stocky, a big rounded-square head with an
  // inset pale-blue face, metal headphones with bolts, spring neck, arms and legs, dungarees, chunky shoes.
  const root = new THREE.Group(); S.add(root);           // travel (x/z) + jump (y)
  const pivot = new THREE.Group(); pivot.position.y = 1.75; root.add(pivot); // spins / flips around body centre
  const bodyG = new THREE.Group(); bodyG.position.y = -1.75; pivot.add(bodyG); // squash from feet
  const hips = new THREE.Group(); hips.position.y = .78; bodyG.add(hips);

  // legs (short springs + chunky shoes)
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * .3, 0, 0); hips.add(leg);
    leg.add(mesh(new THREE.CylinderGeometry(.2, .2, .14, 32), M.grey, [0, -.02, 0]));
    const sp = helix(.13, .42, 4.5, .034, M.silver); sp.position.y = -.08; leg.add(sp);
    const foot = new THREE.Group(); foot.position.y = -.6; leg.add(foot);
    foot.add(mesh(new RoundedBoxGeometry(.54, .3, .72, 5, .14), M.white, [0, .03, .09]));
    foot.add(mesh(new RoundedBoxGeometry(.58, .1, .78, 4, .05), M.blue, [0, -.12, .1]));
    leg.userData.foot = foot; leg.userData.footY = -.6;
    legs.push(leg);
  }

  // torso: white upper body wearing blue dungarees (trousers, bib, shoulder straps, buttons)
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(mesh(new RoundedBoxGeometry(1.16, .56, .88, 6, .22), M.white, [0, .8, 0]));          // upper body
  torso.add(mesh(new RoundedBoxGeometry(1.28, .68, .96, 6, .3), M.pants, [0, .3, 0]));           // trousers
  torso.add(mesh(new RoundedBoxGeometry(.86, .5, .12, 4, .05), M.pants, [0, .73, .43]));         // bib
  torso.add(mesh(new RoundedBoxGeometry(.24, .2, .06, 3, .03), M.pants, [.0, .25, .49]));         // front pocket
  for (const sx of [-1, 1]) {
    // strap: from the top corner of the bib, over the shoulder, down the back
    const pts = [[.33, .93, .47], [.35, 1.04, .34], [.36, 1.09, 0], [.35, 1.03, -.34], [.33, .86, -.46], [.31, .62, -.48]]
      .map(([x, y, z]) => new THREE.Vector3(sx * x, y, z));
    const strap = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, .055, 10, false), M.pants);
    strap.scale.x = 1.5; strap.position.x = -sx * .17; // flatten into a band
    torso.add(strap);
    const btn = mesh(new THREE.CylinderGeometry(.055, .055, .04, 20), M.blue, [sx * .31, .9, .5]); btn.rotation.x = PI / 2; torso.add(btn);
  }
  const chest = new THREE.Group(); chest.position.set(0, .7, .5); torso.add(chest);
  chest.add(mesh(new RoundedBoxGeometry(.52, .18, .05, 3, .025), M.panel));
  const leds = [];
  for (const x of [-.13, .13]) {
    const l = mesh(new THREE.CylinderGeometry(.048, .048, .04, 24), M.led, [x, 0, .03]);
    l.rotation.x = PI / 2; chest.add(l); leds.push(l);
  }
  chest.add(mesh(new RoundedBoxGeometry(.07, .11, .04, 2, .015), M.grey, [0, 0, .03]));

  // neck spring
  const neck = helix(.15, .2, 2.5, .038, M.silver); neck.position.y = 1.2; torso.add(neck);

  // arms (light-blue shoulder caps, metal springs, white cuffs, light-blue mitts)
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * .64, .86, 0); torso.add(arm);
    arm.add(mesh(new THREE.SphereGeometry(.2, 32, 24), M.blue, [sx * .05, 0, 0]));
    const sp = helix(.1, .34, 4, .03, M.silver); sp.position.set(sx * .1, -.1, 0); arm.add(sp);
    const fore = new THREE.Group(); fore.position.set(sx * .1, -.52, 0); arm.add(fore);
    fore.add(mesh(new THREE.CylinderGeometry(.15, .13, .24, 32), M.white, [0, 0, 0]));
    fore.add(mesh(new THREE.CylinderGeometry(.155, .155, .06, 32), M.blue, [0, -.11, 0]));
    const hand = new THREE.Group(); hand.position.y = -.28; fore.add(hand);
    hand.add(mesh(new THREE.SphereGeometry(.15, 28, 20), M.blue, [0, 0, 0], [1, 1.12, .82]));
    const thumb = mesh(new THREE.CapsuleGeometry(.05, .1, 6, 12), M.blue, [sx * -.1, .06, .07]);
    thumb.rotation.z = sx * .5; hand.add(thumb);
    arm.rotation.z = sx * .18;
    arms.push(arm);
  }

  // head: a rounded square (superellipsoid), slightly domed on top
  const head = new THREE.Group(); head.position.y = 1.12; torso.add(head);
  const skull = new THREE.Group(); skull.position.y = .86; head.add(skull);
  const HA = 1.17, HBT = 1.0, HBB = .78, HC = .94, HN = 2.45; // half width, half height top/bottom, half depth, squareness
  const HW = HA * 2, HD = HC * 2;
  skull.add(mesh(superBlob(HA, HBT, HBB, HC, HN, 96, 64), M.white));
  const headZ = (x, y) => HC * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / HA), HN) - Math.pow(Math.abs(y / (y > 0 ? HBT : HBB)), HN)), 1 / HN);
  // light-blue panel along the top of the head
  const cap = mesh(superBlob(.66, HBT + .014, .3, .86, 4, 64, 40), M.blue, [0, 0, .05]); skull.add(cap);
  // inset face: a pale-blue panel following the head's curve, sunk inside a raised white bezel
  const FX = .88, FY = .6, FCY = -.06, FN = 3.0;
  const facePt = (u, th) => {
    const c = Math.cos(th), s = Math.sin(th);
    const x = FX * u * Math.sign(c) * Math.pow(Math.abs(c), 2 / FN), y = FCY + FY * u * Math.sign(s) * Math.pow(Math.abs(s), 2 / FN);
    return [x, y];
  };
  {
    const RINGS = 24, SEG = 120, pos = [0, FCY, headZ(0, FCY) + .012], idx = [], col = [1, 1, 1];
    for (let r = 1; r <= RINGS; r++) for (let k = 0; k < SEG; k++) {
      const [x, y] = facePt(r / RINGS, k / SEG * PI * 2);
      pos.push(x, y, headZ(x, y) + .012 - .025 * Math.pow(r / RINGS, 6)); // dips slightly at the edge so the bezel overhangs it
      // soft shading inside the bezel (stronger under the top edge) so the face reads as sunk in
      const u = r / RINGS, e = Math.max(0, (u - .72) / .28), top = y > FCY ? 1 : .55, v = 1 - .4 * e * e * top;
      col.push(v, v, Math.min(1, v + .04));
    }
    for (let k = 0; k < SEG; k++) idx.push(0, 1 + k, 1 + (k + 1) % SEG);
    for (let r = 1; r < RINGS; r++) for (let k = 0; k < SEG; k++) {
      const a = 1 + (r - 1) * SEG + k, b = 1 + (r - 1) * SEG + (k + 1) % SEG, c = a + SEG, d = b + SEG;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    skull.add(mesh(g, M.faceIn));
    const rim = [];
    for (let k = 0; k < 160; k++) { const [x, y] = facePt(1.0, k / 160 * PI * 2); rim.push(new THREE.Vector3(x, y, headZ(x, y) + .015)); }
    skull.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 240, .09, 14, true), M.white));
  }
  const fz = (x, y) => headZ(x, y) + .012;
  // eyebrows: chunky arched brows in a deeper blue
  for (const sx of [-1, 1]) {
    const bx = sx * .42, by = .39, R = .3, ARC = 1.7, tube = .1;
    const g = new THREE.Group(); g.position.set(bx, by - R, fz(bx, by) + .07); g.rotation.z = -sx * .1; skull.add(g);
    const arc = mesh(new THREE.TorusGeometry(R, tube, 16, 48, ARC), M.brow); arc.rotation.z = PI / 2 - ARC / 2; g.add(arc);
    for (const e of [-1, 1]) { const a = PI / 2 + e * ARC / 2; g.add(mesh(new THREE.SphereGeometry(tube, 20, 14), M.brow, [Math.cos(a) * R, Math.sin(a) * R, 0])); }
    g.scale.set(1, 1, .7);
  }
  // eyes
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * .42, .04, fz(sx * .42, .04) + .07); skull.add(eye);
    const ring = mesh(new THREE.TorusGeometry(.235, .055, 20, 48), M.blue); ring.position.z = .02; eye.add(ring);
    eye.add(mesh(new THREE.SphereGeometry(.225, 40, 28), M.sclera, [0, 0, 0], [1, 1, .42]));
    const pupil = mesh(new THREE.SphereGeometry(.135, 32, 24), M.dark, [0, 0, .05], [1, 1, .55]); eye.add(pupil);
    const happy = mesh(new THREE.TorusGeometry(.1, .03, 12, 32, PI), M.dark, [0, -.03, .1]); happy.visible = false; eye.add(happy);
    const lid = new THREE.Group(); lid.position.y = .235; eye.add(lid);
    const lidM = mesh(new THREE.SphereGeometry(.245, 32, 20), M.face, [0, -.235, .02], [1, 1, .7]); lid.add(lidM);
    lid.scale.y = .001; lid.visible = false;
    eyes.push({ eye, pupil, happy, lid });
  }
  // mouth
  const smile = mesh(new THREE.TorusGeometry(.15, .028, 12, 40, PI * .7), M.mouth, [0, -.33, fz(0, -.33) + .02]);
  smile.rotation.z = PI + PI * .15; skull.add(smile);
  const talk = mesh(new THREE.SphereGeometry(.1, 24, 16), M.mouth, [0, -.37, fz(0, -.37) + .01], [1.1, .7, .3]); talk.visible = false; skull.add(talk);
  // headphones: metal housing with four bolts and a light-blue cap. Both sides are built the same way and
  // pointed outwards (local -Y faces away from the head on each side).
  const phones = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(sx * (HA - .03), -.04, 0); p.rotation.z = sx * PI / 2; skull.add(p);
    p.add(mesh(new THREE.CylinderGeometry(.36, .38, .2, 48), M.silver, [0, .04, 0]));            // socket into the head
    p.add(mesh(new THREE.CylinderGeometry(.42, .44, .16, 48), M.silver, [0, -.08, 0]));          // metal housing
    p.add(mesh(new THREE.TorusGeometry(.42, .035, 12, 48), M.silver, [0, -.17, 0]).rotateX(PI / 2)); // metal rim
    p.add(mesh(new THREE.CylinderGeometry(.35, .35, .14, 48), M.glow, [0, -.22, 0]));             // blue cap
    for (let k = 0; k < 4; k++) {                                                                  // bolts
      const a = PI / 4 + k * PI / 2;
      p.add(mesh(new THREE.CylinderGeometry(.06, .06, .07, 6), M.silver, [Math.cos(a) * .385, -.19, Math.sin(a) * .385]));
    }
    phones.push(p);
  }
  // thought bubbles
  const think = new THREE.Group(); think.position.set(1.3, 1.75, .3); head.add(think);
  [[0, 0, .09], [.28, .32, .14], [.62, .7, .21]].forEach(([x, y, r]) => think.add(mesh(new THREE.SphereGeometry(r, 24, 16), M.white, [x, y, 0])));
  think.visible = false;

  // collect clickable meshes
  const hitList = [];
  root.traverse(o => { if (o.isMesh) hitList.push(o); });

  // ---------- state ----------
  let state = 'idle', talkLevel = 0, talkTarget = 0;
  let look = { x: 0, y: 0 }, lookS = { x: 0, y: 0 };
  let blinkT = 0, nextBlink = 2 + Math.random() * 3, wink = -1;
  let current = null; // {name, t0, dur, fn, resolve}
  const clock = new THREE.Clock();
  let T = 0; // animation time: advances at most 50ms per frame, so moves always play in full

  // ---------- moves: fn(p, P) writes into pose P ----------
  const MOVES = {
    hop: { dur: .95, fn: (p, P) => { const j = jump(p, .16, .86); P.y += j * .85; const sq = bump(p, 0, .18) + bump(p, .84, 1); P.sy -= sq * .14; P.sx += sq * .1;
      P.armL.z += j * 1.6; P.armR.z -= j * 1.6; P.legL.x -= j * .35; P.legR.x -= j * .35; P.joy = true; } },
    skip: { dur: 2.0, fn: (p, P) => { const out = p < .5, q = out ? p / .5 : (p - .5) / .5; P.x += (out ? q : 1 - q) * .9;
      P.ry += (out ? 1 : -1) * .55 * bump(q, 0, 1) ** .3; const hops = Math.abs(Math.sin(q * PI * 4)); P.y += hops * .42;
      const k = Math.sin(q * PI * 4); P.legL.x += k * .55; P.legR.x -= k * .55; P.armL.x -= k * .7; P.armR.x += k * .7; P.joy = true; } },
    dance: { dur: 3.2, fn: (p, P) => { const t = p * 3.2, b = Math.sin(t * PI * 2 * 1.25); const fin = bump(p, .86, 1);
      P.ry += b * .38 * (1 - fin); P.x += Math.sin(t * PI * 1.25) * .25 * (1 - fin); P.y += Math.abs(b) * .12 + jump(p, .86, 1) * .5;
      P.rz += b * .06; P.head.z -= b * .18; P.head.x += Math.abs(Math.cos(t * PI * 2.5)) * .12;
      P.armL.z += (1.1 + Math.sin(t * PI * 2.5) * .8) * (1 - fin) + fin * 2.2; P.armR.z -= (1.1 + Math.cos(t * PI * 2.5) * .8) * (1 - fin) + fin * 2.2;
      P.legL.x += Math.max(0, b) * .5; P.legR.x += Math.max(0, -b) * .5; P.joy = true; } },
    spin: { dur: 1.3, fn: (p, P) => { P.ry += ease.io(p) * PI * 2; P.y += jump(p, .05, .95) * .55; const a = bump(p, 0, 1); P.armL.z += a * 1.3; P.armR.z -= a * 1.3; P.joy = true; } },
    flip: { dur: 1.5, fn: (p, P) => { const crouch = bump(p, 0, .2), land = bump(p, .82, 1); P.sy -= (crouch + land) * .16; P.sx += (crouch + land) * .1;
      const air = clamp((p - .18) / .64, 0, 1); P.y += Math.sin(air * PI) * 1.25; P.rx -= ease.io(air) * PI * 2;
      const tuck = bump(air, 0, 1); P.legL.x -= tuck * 1.0; P.legR.x -= tuck * 1.0; P.armL.z += tuck * 2.3; P.armR.z -= tuck * 2.3; P.joy = true; } },
    wave: { dur: 1.8, fn: (p, P) => { const up = bump(p, 0, 1) ** .4; P.armR.z -= up * 2.5; P.armR.x -= up * .2; P.foreR = Math.sin(p * PI * 6) * .5 * up;
      P.head.z += up * .14; P.wink = 0; } },
    shimmy: { dur: 1.4, fn: (p, P) => { const s = Math.sin(p * PI * 14) * bump(p, 0, 1) ** .3; P.ry += s * .28; P.x += s * .08; P.head.z -= s * .1; P.armL.x += s * .6; P.armR.x -= s * .6; P.joy = true; } },
    moonwalk: { dur: 2.4, fn: (p, P) => { const q = p < .5 ? ease.io(p / .5) : 1 - ease.io((p - .5) / .5); P.x -= q * .9; P.ry += .5 * bump(p, 0, 1) ** .3;
      const s = Math.sin(p * PI * 10); P.legL.x += Math.max(0, s) * .3; P.legR.x += Math.max(0, -s) * .3; P.footL = Math.max(0, s) * .14; P.footR = Math.max(0, -s) * .14;
      P.rz += .04 * bump(p, 0, 1); P.armL.x += s * .3; P.armR.x -= s * .3; P.joy = true; } },
    nod: { dur: 1.2, fn: (p, P) => { P.head.x += Math.sin(p * PI * 2) * .18 * bump(p, 0, 1); } },
    tilt: { dur: 1.5, fn: (p, P) => { P.head.z += bump(p, 0, 1) * .28; } },
    glance: { dur: 1.6, fn: (p, P) => { P.lookX = Math.sin(p * PI * 2) * .9; P.head.y += Math.sin(p * PI * 2) * .25; } },
  };

  function basePose(t) {
    return { x: 0, y: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1,
      head: { x: 0, y: 0, z: 0 }, armL: { x: 0, z: 0 }, armR: { x: 0, z: 0 }, legL: { x: 0 }, legR: { x: 0 },
      foreR: 0, footL: 0, footR: 0, joy: false, wink: -1, lookX: null, lookY: null };
  }

  function move(name) {
    if (!MOVES[name]) return Promise.resolve();
    if (current) return current.promise;
    if (reduce) return Promise.resolve();
    let resolve; const promise = new Promise(r => resolve = r);
    current = { name, t0: T, dur: MOVES[name].dur, fn: MOVES[name].fn, resolve, promise };
    return promise;
  }

  // ---------- frame ----------
  function frame(dtIn) {
    const dt = dtIn != null ? dtIn : Math.min(clock.getDelta(), .05); T += dt; const t = T;
    const P = basePose(t);
    // idle breathing + sway
    if (!reduce) {
      P.y += Math.sin(t * 1.7) * .03;
      P.sy += Math.sin(t * 1.7) * .008;
      P.armL.z += Math.sin(t * 1.7) * .04; P.armR.z -= Math.sin(t * 1.7 + .4) * .04;
    }
    // states
    if (state === 'listening') { P.head.z += .14; P.head.x -= .05; }
    if (state === 'thinking') { P.head.z -= .1; P.head.x -= .12; P.lookX = .55; P.lookY = .6; }
    if (state === 'speaking' && !reduce) { P.head.x += Math.sin(t * 9) * .035; P.head.z += Math.sin(t * 4.5) * .03; }
    // current move
    if (current) {
      const p = clamp((t - current.t0) / current.dur, 0, 1);
      current.fn(p, P);
      if (p >= 1) { const c = current; current = null; c.resolve(); }
    }
    // look smoothing
    const tx = P.lookX != null ? P.lookX : look.x, ty = P.lookY != null ? P.lookY : look.y;
    lookS.x = lerp(lookS.x, tx, 1 - Math.pow(.001, dt)); lookS.y = lerp(lookS.y, ty, 1 - Math.pow(.001, dt));

    // apply
    root.position.set(P.x, P.y, 0);
    if (opts.framing === 'close') { camFollow = lerp(camFollow, P.y * .65, .15); cam.position.y = CAM.y + camFollow; cam.lookAt(0, CAM.look + camFollow, 0); }
    pivot.rotation.set(P.rx, P.ry + lookS.x * .22, P.rz);
    bodyG.scale.set(P.sx, P.sy, P.sx);
    head.rotation.set(P.head.x - lookS.y * .18, P.head.y + lookS.x * .32, P.head.z);
    arms[0].rotation.set(P.armL.x, 0, -.18 - P.armL.z);
    arms[1].rotation.set(P.armR.x, 0, .18 - P.armR.z);
    arms[1].children[2].rotation.z = P.foreR;
    legs[0].rotation.x = P.legL.x; legs[1].rotation.x = P.legR.x;
    legs[0].userData.foot.position.y = legs[0].userData.footY + P.footL; legs[1].userData.foot.position.y = legs[1].userData.footY + P.footR;
    ground.material.opacity = .16 * clamp(1 - P.y / 2.6, .25, 1);
    blob.material.opacity = .12 * clamp(1 - P.y / 2.6, .25, 1); blob.position.x = P.x;

    // eyes
    blinkT += dt;
    if (blinkT > nextBlink) { blinkT = 0; nextBlink = 2.2 + Math.random() * 3.4; }
    const blink = blinkT < .14 ? Math.sin(blinkT / .14 * PI) : 0;
    eyes.forEach((e, i) => {
      e.pupil.position.x = lookS.x * .06; e.pupil.position.y = lookS.y * .05;
      const shut = (P.wink === i) ? 1 : blink;
      e.pupil.visible = !P.joy && shut < .85; e.happy.visible = P.joy && P.wink !== i;
      e.lid.visible = shut > .02; e.lid.scale.y = Math.max(.001, shut);
      e.pupil.scale.set(state === 'listening' ? 1.12 : 1, state === 'listening' ? 1.12 : 1, .55);
    });
    // mouth
    talkLevel = lerp(talkLevel, talkTarget, .35);
    const speaking = state === 'speaking';
    talk.visible = speaking; smile.visible = !speaking;
    if (speaking) { talk.scale.set(.9 + talkLevel * .4, .35 + talkLevel * 1.0, .3); }
    smile.scale.setScalar(P.joy ? 1.25 : 1);
    // glows
    const lg = state === 'listening' ? .9 + Math.sin(t * 7) * .5 : 0;
    M.glow.emissiveIntensity = lerp(M.glow.emissiveIntensity, lg, .2);
    M.led.emissiveIntensity = speaking ? (Math.sin(t * 16) > 0 ? 2.2 : .6) : lerp(M.led.emissiveIntensity, .15, .1);
    think.visible = state === 'thinking';
    if (think.visible) think.children.forEach((c, i) => c.scale.setScalar(.8 + .25 * Math.max(0, Math.sin(t * 5 - i * .8))));

    R.render(S, cam);
  }

  // ---------- sizing + loop ----------
  function resize() {
    const w = el.clientWidth || 200, h = el.clientHeight || 260;
    R.setSize(w, h, false);
    R.domElement.style.width = w + 'px'; R.domElement.style.height = h + 'px';
    cam.aspect = w / h; cam.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(el); resize();
  let visible = true, raf = 0;
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
  io.observe(el);
  // adaptive quality: weak GPUs drop shadows and render at 1x
  let fN = 0, fT = 0, lowered = false;
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) { clock.getDelta(); return; }
    const t0 = performance.now(); frame();
    if (!lowered && !opts.noAdapt) { fN++; fT += performance.now() - t0; if (fN === 24 && fT / fN > 28) { lowered = true; R.shadowMap.enabled = false; key.castShadow = false; R.setPixelRatio(1); resize(); blob.visible = true; ground.visible = false; } }
  }
  if (!opts.manual) loop();

  // ---------- input ----------
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  function hitTest(e) {
    const r = R.domElement.getBoundingClientRect();
    v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(v2, cam);
    return ray.intersectObjects(hitList, false).length > 0;
  }
  R.domElement.addEventListener('click', e => { if (hitTest(e) && opts.onClick) opts.onClick(); });
  R.domElement.addEventListener('pointermove', e => { R.domElement.style.cursor = hitTest(e) ? 'pointer' : 'default'; });

  return {
    setState(s) { state = s; if (s !== 'speaking') talkTarget = 0; },
    setTalk(v) { talkTarget = clamp(v, 0, 1); },
    look(nx, ny) { look.x = clamp(nx, -1, 1); look.y = clamp(ny, -1, 1); },
    move, isBusy: () => !!current, _dbg: () => ({ y: root.position.y, t: T, cur: current && current.name }),
    snapshot() { frame(); return R.domElement.toDataURL('image/png'); },
    step(dt) { frame(dt); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); R.dispose(); R.domElement.remove(); },
  };
}
