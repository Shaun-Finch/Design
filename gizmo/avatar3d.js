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

// Rounded cylinder (lathe profile with bevelled top and bottom edges), standing on the Y axis.
function roundCyl(r, h, b, seg = 48) {
  const pts = [new THREE.Vector2(0, -h / 2)];
  for (let i = 0; i <= 8; i++) { const a = -PI / 2 + i / 8 * PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, -h / 2 + b + Math.sin(a) * b)); }
  for (let i = 0; i <= 8; i++) { const a = i / 8 * PI / 2; pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h / 2 - b + Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(0, h / 2));
  return new THREE.LatheGeometry(pts, seg);
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
    // rounded shoe: grey ankle, white dome, wider light-blue sole with a soft rim
    foot.add(mesh(new THREE.CylinderGeometry(.12, .13, .16, 32), M.grey, [0, .12, 0]));
    foot.add(mesh(new THREE.SphereGeometry(1, 48, 24, 0, PI * 2, 0, PI / 2), M.white, [0, -.08, .07], [.27, .25, .37]));
    foot.add(mesh(roundCyl(.3, .1, .045), M.blue, [0, -.12, .08], [1, 1, 1.32]));
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

  // arms: grey joint into the body, light-blue sleeve, metal spring, white forearm with a light-blue cuff, small hands
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * .64, .86, 0); torso.add(arm);
    const shoulder = new THREE.Group(); arm.add(shoulder);
    const joint = mesh(roundCyl(.1, .18, .03), M.grey, [sx * -.05, .02, 0]); joint.rotation.z = PI / 2; shoulder.add(joint);
    shoulder.add(mesh(roundCyl(.165, .27, .075), M.blue, [sx * .07, -.03, 0]));
    const sp = helix(.1, .3, 3.5, .03, M.silver); sp.position.set(sx * .07, -.15, 0); arm.add(sp);
    const fore = new THREE.Group(); fore.position.set(sx * .07, -.52, 0); arm.add(fore);
    fore.add(mesh(roundCyl(.15, .26, .05), M.white, [0, .01, 0]));
    fore.add(mesh(roundCyl(.158, .09, .03), M.blue, [0, -.12, 0]));
    // hand: palm, three fingers and a thumb (palm faces the body)
    const hand = new THREE.Group(); hand.position.y = -.21; hand.rotation.y = sx * -.75; hand.scale.setScalar(1.1); fore.add(hand);
    hand.add(mesh(new RoundedBoxGeometry(.14, .17, .25, 4, .062), M.blue, [0, -.03, 0]));
    [-.076, 0, .076].forEach((z, k) => {
      const f = mesh(new THREE.CapsuleGeometry(.042, .085 - Math.abs(k - 1) * .015, 6, 12), M.blue, [sx * -.014, -.16 + Math.abs(k - 1) * .01, z]);
      f.rotation.z = sx * .22; hand.add(f);
    });
    const thumb = mesh(new THREE.CapsuleGeometry(.046, .08, 6, 12), M.blue, [sx * -.035, -.02, .14]);
    thumb.rotation.x = .75; thumb.rotation.z = sx * .15; hand.add(thumb);
    arm.rotation.z = sx * .18;
    arms.push(arm);
  }

  // head: one smooth rounded-square shell (superellipsoid, slightly domed). The inset face and the raised
  // top panel are sculpted into the same mesh and coloured in the shader, so there are no seams or outlines.
  const head = new THREE.Group(); head.position.y = 1.12; torso.add(head);
  const skull = new THREE.Group(); skull.position.y = .86; head.add(skull);
  const HA = 1.17, HBT = 1.0, HBB = .78, HC = .94, HN = 2.45; // half width, half height top/bottom, half depth, squareness
  const HW = HA * 2, HD = HC * 2;
  const headZ = (x, y) => HC * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / HA), HN) - Math.pow(Math.abs(y / (y > 0 ? HBT : HBB)), HN)), 1 / HN);
  const FX = .9, FY = .62, FCY = -.06, FN = 3.0, FW = .1, FDEP = .045;      // face panel
  const CX = .7, CZ = .72, CZ0 = .08, CN = 4, CW = .12, CUP = .03;          // top panel
  const sstep = (a, b, v) => { v = Math.min(1, Math.max(0, (v - a) / (b - a))); return v * v * (3 - 2 * v); };
  const faceU = (x, y) => Math.pow(Math.pow(Math.abs(x / FX), FN) + Math.pow(Math.abs((y - FCY) / FY), FN), 1 / FN);
  const capU = (x, z) => Math.pow(Math.pow(Math.abs(x / CX), CN) + Math.pow(Math.abs((z - CZ0) / CZ), CN), 1 / CN);
  const disp = (x, y, z) => {
    let d = 0;
    const fw = sstep(.3 * HC, .55 * HC, z);
    if (fw > 0) d -= fw * FDEP * (1 - sstep(1 - FW, 1, faceU(x, y)));
    const tw = sstep(.45 * HBT, .7 * HBT, y);
    if (tw > 0) d += tw * CUP * (1 - sstep(1 - CW, 1, capU(x, z)));
    return d;
  };
  {
    const src = superBlob(HA, HBT, HBB, HC, HN, 384, 256);
    const P = src.attributes.position, N = src.attributes.normal, I = src.index.array;
    // weld the sphere's seam so the normals are smooth all the way round
    const map = new Map(), remap = new Uint32Array(P.count), pos = [], base = [];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), key = x.toFixed(5) + ',' + y.toFixed(5) + ',' + z.toFixed(5);
      let j = map.get(key);
      if (j === undefined) {
        j = pos.length / 3; map.set(key, j);
        const d = disp(x, y, z);
        pos.push(x + N.getX(i) * d, y + N.getY(i) * d, z + N.getZ(i) * d); base.push(x, y, z);
      }
      remap[i] = j;
    }
    const idx = [];
    for (let k = 0; k < I.length; k += 3) {
      const a = remap[I[k]], b = remap[I[k + 1]], c = remap[I[k + 2]];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('basePos', new THREE.Float32BufferAttribute(base, 3));
    g.setIndex(idx); g.computeVertexNormals(); src.dispose();
    const f = v => v.toFixed(5);
    const hm = M.white.clone();
    hm.onBeforeCompile = sh => {
      sh.uniforms.uFace = { value: M.face.color };
      sh.uniforms.uCap = { value: new THREE.Color(0x5f9ade) };
      sh.vertexShader = 'attribute vec3 basePos;\nvarying vec3 vBase;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBase = basePos;');
      sh.fragmentShader = 'uniform vec3 uFace;\nuniform vec3 uCap;\nvarying vec3 vBase;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 b = vBase;
    float fw = smoothstep(${f(.3 * HC)}, ${f(.55 * HC)}, b.z);
    float u = pow(pow(abs(b.x / ${f(FX)}), ${f(FN)}) + pow(abs((b.y - (${f(FCY)})) / ${f(FY)}), ${f(FN)}), ${f(1 / FN)});
    float aa = fwidth(u) * .8 + 1e-4;
    float fm = fw * (1.0 - smoothstep(${f(1 - FW * .45)} - aa, ${f(1 - FW * .45)} + aa, u));
    float tw = smoothstep(${f(.45 * HBT)}, ${f(.7 * HBT)}, b.y);
    float c = pow(pow(abs(b.x / ${f(CX)}), ${f(CN)}) + pow(abs((b.z - (${f(CZ0)})) / ${f(CZ)}), ${f(CN)}), ${f(1 / CN)});
    float ca = fwidth(c) * .8 + 1e-4;
    float cm = step(.5, tw) * (1.0 - smoothstep(${f(1 - CW * .45)} - ca, ${f(1 - CW * .45)} + ca, c));
    diffuseColor.rgb = mix(diffuseColor.rgb, uFace, fm);
    diffuseColor.rgb = mix(diffuseColor.rgb, uCap, cm);
  }`);
    };
    skull.add(mesh(g, hm));
  }
  const fz = (x, y) => headZ(x, y) - FDEP; // the sunken face surface
  // eyebrows: chunky arched brows in a deeper blue, sitting clear of the eyes
  for (const sx of [-1, 1]) {
    const bx = sx * .42, by = .42, R = .3, ARC = 1.6, tube = .095;
    const g = new THREE.Group(); g.position.set(bx, by - R, fz(bx, by) + .06); g.rotation.z = -sx * .1; skull.add(g);
    const arc = mesh(new THREE.TorusGeometry(R, tube, 16, 48, ARC), M.brow); arc.rotation.z = PI / 2 - ARC / 2; g.add(arc);
    for (const e of [-1, 1]) { const a = PI / 2 + e * ARC / 2; g.add(mesh(new THREE.SphereGeometry(tube, 20, 14), M.brow, [Math.cos(a) * R, Math.sin(a) * R, 0])); }
    g.scale.set(1, 1, .7);
  }
  // eyes (a touch smaller, so there is a clear gap below the brows)
  const eyes = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(sx * .42, -.02, fz(sx * .42, -.02) + .06); eye.scale.setScalar(.82); skull.add(eye);
    const ring = mesh(new THREE.TorusGeometry(.235, .055, 20, 48), M.blue); ring.position.z = .02; eye.add(ring);
    eye.add(mesh(new THREE.SphereGeometry(.225, 40, 28), M.sclera, [0, 0, 0], [1, 1, .42]));
    const pupil = mesh(new THREE.SphereGeometry(.135, 32, 24), M.dark, [0, 0, .05], [1, 1, .55]); eye.add(pupil);
    const happy = mesh(new THREE.TorusGeometry(.1, .03, 12, 32, PI), M.dark, [0, -.03, .1]); happy.visible = false; eye.add(happy);
    // wink: a little chevron, like the reference
    const wink = new THREE.Group(); wink.position.z = .09; wink.visible = false; eye.add(wink);
    for (const e of [-1, 1]) {
      const s = mesh(new THREE.CapsuleGeometry(.036, .13, 6, 12), M.dark, [sx * -.03, e * .05, 0]);
      s.rotation.z = sx * e * -1.0; wink.add(s);
    }
    const lid = new THREE.Group(); lid.position.y = .235; eye.add(lid);
    const lidM = mesh(new THREE.SphereGeometry(.245, 32, 20), M.face, [0, -.235, .02], [1, 1, .7]); lid.add(lidM);
    lid.scale.y = .001; lid.visible = false;
    eyes.push({ eye, pupil, happy, lid, wink });
  }
  // mouth
  const smile = mesh(new THREE.TorusGeometry(.14, .026, 12, 40, PI * .62), M.mouth, [0, -.36, fz(0, -.36) + .015]);
  smile.rotation.z = PI + PI * .19; skull.add(smile);
  const talk = mesh(new THREE.SphereGeometry(.1, 24, 16), M.mouth, [0, -.39, fz(0, -.39) + .005], [1.1, .7, .3]); talk.visible = false; skull.add(talk);
  // headphones (a little smaller): metal housing with four bolts and a light-blue cap. Both sides are built the
  // same way and pointed outwards (local -Y faces away from the head on each side).
  const phones = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(sx * (HA - .04), -.04, 0); p.rotation.z = sx * PI / 2; p.scale.setScalar(.84); skull.add(p);
    p.add(mesh(new THREE.CylinderGeometry(.36, .38, .24, 48), M.silver, [0, .06, 0]));            // socket into the head
    p.add(mesh(new THREE.CylinderGeometry(.42, .44, .16, 48), M.silver, [0, -.08, 0]));          // metal housing
    p.add(mesh(new THREE.TorusGeometry(.42, .035, 12, 48), M.silver, [0, -.17, 0]).rotateX(PI / 2)); // metal rim
    p.add(mesh(new THREE.CylinderGeometry(.35, .35, .14, 48), M.glow, [0, -.22, 0]));             // blue cap
    for (let k = 0; k < 4; k++) {                                                                  // bolts
      const a = PI / 4 + k * PI / 2;
      p.add(mesh(new THREE.CylinderGeometry(.05, .05, .06, 6), M.silver, [Math.cos(a) * .385, -.19, Math.sin(a) * .385]));
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
      const winking = P.wink === i, shut = winking ? 0 : blink;
      e.pupil.visible = !P.joy && !winking && shut < .85; e.happy.visible = P.joy && !winking;
      e.wink.visible = winking;
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
