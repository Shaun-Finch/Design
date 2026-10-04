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
    white: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, roughness: .2, metalness: 0, clearcoat: 1, clearcoatRoughness: .07 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x15181d, roughness: .32, metalness: .3, clearcoat: .8, clearcoatRoughness: .14 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x3b434d, roughness: .3, metalness: .85 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8d96a1, roughness: .24, metalness: 1 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0xbfcad4, roughness: .12, metalness: .1, clearcoat: 1, clearcoatRoughness: .05 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x7ff2ff, emissive: 0x18d2ff, emissiveIntensity: 1.3, roughness: .3 }),   // ear rings, joints (pulse when listening)
    led: new THREE.MeshStandardMaterial({ color: 0x8ff5ff, emissive: 0x18d2ff, emissiveIntensity: 1.1, roughness: .3 }),    // chest lights (flicker when speaking)
    arc: new THREE.MeshBasicMaterial({ color: 0x74f4ff, toneMapped: false }),
    thinkW: new THREE.MeshPhysicalMaterial({ color: 0xf2f4f7, roughness: .2, clearcoat: 1 }),
  };
  const mesh = (g, m, p = [0, 0, 0], s) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(...p);
    if (s) o.scale.set(...s);
    o.castShadow = true; o.receiveShadow = true;
    return o;
  };
  const f5 = v => v.toFixed(5);
  // A smooth body shell (superellipsoid) with details sculpted into the one mesh and coloured in the shader,
  // so recesses, seams and panels have no separate parts or outlines.
  function sculpt(a, bt, bb, c, n, ws, hs, disp, glslColor, glslEmit) {
    const src = superBlob(a, bt, bb, c, n, ws, hs);
    const P = src.attributes.position, N = src.attributes.normal, I = src.index.array;
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
    for (let k = 0; k < I.length; k += 3) { const p = remap[I[k]], q = remap[I[k + 1]], r = remap[I[k + 2]]; if (p !== q && q !== r && p !== r) idx.push(p, q, r); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('basePos', new THREE.Float32BufferAttribute(base, 3));
    g.setIndex(idx); g.computeVertexNormals(); src.dispose();
    const m = M.white.clone(), key = 'sculpt:' + glslColor + '|' + (glslEmit || '');
    m.customProgramCacheKey = () => key;
    m.onBeforeCompile = sh => {
      sh.uniforms.uDark = { value: new THREE.Color(0x07090c) };
      sh.uniforms.uCyan = { value: new THREE.Color(0x29dcff) };
      sh.vertexShader = 'attribute vec3 basePos;\nvarying vec3 vBase;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vBase = basePos;');
      sh.fragmentShader = 'uniform vec3 uDark;\nuniform vec3 uCyan;\nvarying vec3 vBase;\nfloat se(float x, float y, float n) { return pow(pow(abs(x), n) + pow(abs(y), n), 1.0 / n); }\n' +
        sh.fragmentShader
          .replace('#include <color_fragment>', '#include <color_fragment>\n  { vec3 b = vBase; ' + glslColor + ' }')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  { vec3 b = vBase; ' + (glslEmit || '') + ' }');
    };
    return mesh(g, m);
  }
  const sstep = (a, b, v) => { v = Math.min(1, Math.max(0, (v - a) / (b - a))); return v * v * (3 - 2 * v); };
  const se = (x, y, n) => Math.pow(Math.pow(Math.abs(x), n) + Math.pow(Math.abs(y), n), 1 / n);

  // ---------- rig ----------
  // Built from Shaun's reference: a big round white head with a black visor and two glowing cyan eyes,
  // black ear discs with cyan rings, an egg-shaped white body with a chest panel and a dark pelvis light,
  // mechanical shoulder sockets and hands, ribbed hip joints, and tall white boots on cyan-lit soles.
  const root = new THREE.Group(); S.add(root);           // travel (x/z) + jump (y)
  const pivot = new THREE.Group(); pivot.position.y = 1.75; root.add(pivot); // spins / flips around body centre
  const bodyG = new THREE.Group(); bodyG.position.y = -1.75; pivot.add(bodyG); // squash from feet
  const hips = new THREE.Group(); hips.position.y = .78; bodyG.add(hips);

  // ----- legs: ribbed hip wheel, knee, tall boot, rounded shoe on a dark sole with a cyan strip -----
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(sx * .37, .17, 0); hips.add(leg);
    const wheel = mesh(new THREE.CylinderGeometry(.19, .19, .3, 40), M.dark); wheel.rotation.z = PI / 2; leg.add(wheel);
    for (const ox of [-.1, -.035, .035, .1]) { const r = mesh(new THREE.TorusGeometry(.19, .022, 10, 40), M.gun, [ox, 0, 0]); r.rotation.y = PI / 2; leg.add(r); }
    const cap = mesh(new THREE.CylinderGeometry(.14, .14, .02, 32), M.gun, [sx * .152, 0, 0]); cap.rotation.z = PI / 2; leg.add(cap);
    const ring = mesh(new THREE.TorusGeometry(.12, .014, 8, 40), M.glow, [sx * .163, 0, 0]); ring.rotation.y = PI / 2; leg.add(ring);
    const knee = new THREE.Group(); knee.position.y = -.12; leg.add(knee);
    knee.add(mesh(new THREE.CylinderGeometry(.13, .15, .14, 32), M.dark, [0, -.04, 0]));                 // knee joint, tucked inside the boot top
    const boot = mesh(new THREE.LatheGeometry([[0, -.52], [.19, -.52], [.212, -.42], [.216, -.28], [.21, -.14], [.2, -.08], [.19, -.06], [.165, -.05], [.15, -.06]].map(([r, y]) => new THREE.Vector2(r, y)), 48), M.white);
    knee.add(boot);
    knee.add(mesh(new THREE.TorusGeometry(.178, .022, 10, 40), M.dark, [0, -.06, 0]).rotateX(PI / 2));  // dark collar at the top of the boot
    knee.add(mesh(new THREE.TorusGeometry(.217, .005, 6, 48), M.dark, [0, -.3, 0]).rotateX(PI / 2));    // seam line
    knee.add(mesh(superBlob(.235, .18, .17, .34, 2.6, 48, 32), M.white, [0, -.6, .09]));                // shoe
    knee.add(mesh(roundCyl(.245, .075, .03), M.dark, [0, -.79, .09], [1, 1, 1.42]));                     // sole
    const strip = mesh(new THREE.TorusGeometry(.248, .011, 8, 40, PI * .62).rotateZ(-PI / 2 - PI * .31), M.glow, [0, -.775, .09], [1, 1.42, 1]);
    strip.rotation.x = -PI / 2; knee.add(strip);                    // cyan strip round the toe
    const foot = new THREE.Group(); leg.add(foot);                                                        // kept for older moves (heel lift drives the knee now)
    leg.userData = { foot, footY: 0, knee };
    legs.push(leg);
  }
  // pelvis block between the hip wheels
  hips.add(mesh(superBlob(.36, .17, .17, .3, 3, 48, 32), M.dark, [0, .3, 0]));

  // ----- body: egg-shaped shell with a chest panel, four cyan lights and a dark pelvis plate with a cyan ring -----
  const torso = new THREE.Group(); hips.add(torso);
  const TA = .57, TBT = .5, TBB = .53, TC = .47, TN = 2.4, TY = .84;
  const torsoZ = (x, y) => TC * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / TA), TN) - Math.pow(Math.abs(y / (y > 0 ? TBT : TBB)), TN)), 1 / TN);
  const body = sculpt(TA, TBT, TBB, TC, TN, 160, 112,
    (x, y, z) => { if (z < 0) return 0; const u = se(x / .3, (y - .19) / .155, 6); return -.007 * (1 - sstep(.96, 1.0, u)) - .006 * Math.exp(-Math.pow((u - 1) / .012, 2)); },
    `float fw = smoothstep(.0, .15, b.z);
     float u = se(b.x / .3, (b.y - .19) / .155, 6.0), ua = fwidth(u) + 1e-4;
     float line = fw * (1.0 - smoothstep(.006, .006 + ua * 1.5, abs(u - 1.0)));
     diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .55, line);
     float p = se(b.x / .34, (b.y + .41) / .25, 4.0), pa = fwidth(p) + 1e-4;
     float dark = smoothstep(-.12, .06, b.z) * (1.0 - smoothstep(1.0 - pa, 1.0 + pa, p));
     diffuseColor.rgb = mix(diffuseColor.rgb, uDark * 1.6, dark);`);
  body.position.y = TY; torso.add(body);
  for (const [x, y] of [[-.265, .31], [.265, .31], [-.265, .07], [.265, .07]]) torso.add(mesh(new THREE.SphereGeometry(.017, 12, 10), M.led, [x, TY + y, torsoZ(x, y) - .002]));
  const leds = [];
  {
    // sits flush on the curved pelvis plate: oriented to the surface normal
    const y = -.36, z = torsoZ(0, y), nrm = new THREE.Vector3(0, -Math.pow(Math.abs(y / TBB), TN - 1) / TBB, Math.pow(z / TC, TN - 1) / TC).normalize();
    const plate = new THREE.Group(); plate.position.set(0, TY + y, z); plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm); torso.add(plate);
    const r = mesh(new THREE.TorusGeometry(.07, .016, 10, 40), M.led, [0, 0, .012]); plate.add(r); leds.push(r);
    plate.add(mesh(new THREE.CylinderGeometry(.06, .06, .02, 32), M.gun, [0, 0, .004]).rotateX(PI / 2));
    plate.add(mesh(new THREE.CylinderGeometry(.032, .032, .02, 24), M.lens, [0, 0, .012]).rotateX(PI / 2));
  }
  // neck collar
  torso.add(mesh(new THREE.CylinderGeometry(.17, .2, .2, 40), M.dark, [0, TY + TBT + .02, 0]));
  torso.add(mesh(new THREE.TorusGeometry(.19, .022, 10, 40), M.metal, [0, TY + TBT + .07, 0]).rotateX(PI / 2));
  // shoulder sockets
  for (const sx of [-1, 1]) {
    const sock = mesh(new THREE.CylinderGeometry(.25, .25, .16, 40), M.dark, [sx * .49, TY + .08, 0]); sock.rotation.z = PI / 2; torso.add(sock);
    const lip = mesh(new THREE.TorusGeometry(.25, .045, 12, 40), M.dark, [sx * .555, TY + .08, 0]); lip.rotation.y = PI / 2; torso.add(lip);
  }

  // ----- arms: ball joint, white upper arm with a dark cuff, elbow, white bracer, mechanical hand -----
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(sx * .62, TY + .08, 0); torso.add(arm);
    const shoulder = new THREE.Group(); arm.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(.16, 32, 24), M.gun));
    const upper = new THREE.Group(); arm.add(upper);
    upper.add(mesh(roundCyl(.125, .32, .06), M.white, [0, -.2, 0]));
    upper.add(mesh(roundCyl(.13, .06, .02), M.dark, [0, -.35, 0]));
    const fore = new THREE.Group(); fore.position.y = -.43; arm.add(fore);
    fore.add(mesh(new THREE.SphereGeometry(.11, 28, 20), M.gun));
    fore.add(mesh(new THREE.LatheGeometry([[0, -.4], [.13, -.4], [.158, -.37], [.168, -.28], [.165, -.14], [.15, -.07], [.115, -.05], [0, -.05]].map(([r, y]) => new THREE.Vector2(r, y)), 40), M.white));
    fore.add(mesh(roundCyl(.169, .05, .02), M.dark, [0, -.11, 0]));
    fore.add(mesh(new THREE.TorusGeometry(.132, .009, 8, 36), M.glow, [0, -.395, 0]).rotateX(PI / 2));
    // hand: palm faces the body; four two-part fingers and a thumb
    const hand = new THREE.Group(); hand.position.y = -.42; hand.scale.setScalar(1.3); fore.add(hand);
    hand.add(mesh(new THREE.CylinderGeometry(.06, .07, .06, 20), M.dark, [0, .01, 0]));
    hand.add(mesh(new RoundedBoxGeometry(.09, .15, .17, 4, .035), M.gun, [0, -.08, 0]));
    hand.add(mesh(new RoundedBoxGeometry(.03, .09, .11, 2, .012), M.dark, [-sx * .046, -.08, 0]));       // palm pad
    const fingers = [];
    [-.06, -.02, .02, .06].forEach((z, k) => {
      const len = k === 0 ? .85 : k === 3 ? .9 : 1;
      const f = new THREE.Group(); f.position.set(0, -.155, z); hand.add(f);
      f.add(mesh(new THREE.SphereGeometry(.022, 12, 10), M.dark));
      f.add(mesh(new THREE.CapsuleGeometry(.019, .045 * len, 4, 10), M.gun, [0, -.04 * len, 0]));
      const tip = new THREE.Group(); tip.position.y = -.08 * len; f.add(tip);
      tip.add(mesh(new THREE.SphereGeometry(.018, 10, 8), M.glow));                                       // cyan knuckle
      tip.add(mesh(new THREE.CapsuleGeometry(.017, .035 * len, 4, 10), M.gun, [0, -.035 * len, 0]));
      f.userData.tip = tip; fingers.push(f);
    });
    const thumb = new THREE.Group(); thumb.position.set(-sx * .03, -.05, .1); thumb.rotation.x = .9; hand.add(thumb);
    thumb.add(mesh(new THREE.SphereGeometry(.024, 12, 10), M.dark));
    thumb.add(mesh(new THREE.CapsuleGeometry(.021, .06, 4, 10), M.gun, [0, -.045, 0]));
    arm.userData = { fore, hand, fingers, thumb, sx };
    arms.push(arm);
  }

  // ----- head: big round white shell, black glass visor with a cyan rim light, seam over the top -----
  const head = new THREE.Group(); head.position.y = TY + TBT + .05; torso.add(head);
  const skull = new THREE.Group(); skull.position.y = .8; head.add(skull);
  const HA = .91, HBT = .8, HBB = .74, HC = .86, HN = 2.15;
  const HW = HA * 2, HD = HC * 2;
  const headZ = (x, y) => HC * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(x / HA), HN) - Math.pow(Math.abs(y / (y > 0 ? HBT : HBB)), HN)), 1 / HN);
  const VX = .64, VH = .4, VY = -.07, VN = 3.0, VW = .1, VDEP = .06;
  const seamY = z => .56 - .12 * z / HC;
  skull.add(sculpt(HA, HBT, HBB, HC, HN, 384, 256,
    (x, y, z) => {
      let d = 0;
      const fw = sstep(.3 * HC, .55 * HC, z);
      if (fw > 0) d -= fw * VDEP * (1 - sstep(1 - VW, 1, se(x / VX, (y - VY) / VH, VN)));
      d -= .012 * Math.exp(-Math.pow((y - seamY(z)) / .012, 2));
      return d;
    },
    `float fw = smoothstep(${f5(.3 * HC)}, ${f5(.55 * HC)}, b.z);
     float u = se(b.x / ${f5(VX)}, (b.y - (${f5(VY)})) / ${f5(VH)}, ${f5(VN)}), ua = fwidth(u) + 1e-4;
     float vis = fw * (1.0 - smoothstep(${f5(1 - VW * .55)} - ua, ${f5(1 - VW * .55)} + ua, u));
     diffuseColor.rgb = mix(diffuseColor.rgb, uDark, vis);
     float s = b.y - (${f5(.56)} - ${f5(.12 / HC)} * b.z), sa = fwidth(s) + 1e-4;
     diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * .42, 1.0 - smoothstep(.0035, .0035 + sa * 1.5, abs(s)));`,
    `float fw = smoothstep(${f5(.3 * HC)}, ${f5(.55 * HC)}, b.z);
     float u = se(b.x / ${f5(VX)}, (b.y - (${f5(VY)})) / ${f5(VH)}, ${f5(VN)}), ua = fwidth(u) + 1e-4;
     float e = ${f5(1 - VW * .55)};
     float band = smoothstep(e - .05 - ua, e - .03, u) * (1.0 - smoothstep(e - ua, e + ua, u));
     float topw = .3 + .7 * smoothstep(-.3, .7, (b.y - (${f5(VY)})) / ${f5(VH)});
     totalEmissiveRadiance += uCyan * band * topw * fw * 1.6;`));
  const vz = (x, y) => headZ(x, y) - VDEP; // the sunken visor surface
  const vNormal = (x, y) => { const z = headZ(x, y); return new THREE.Vector3(Math.sign(x) * Math.pow(Math.abs(x / HA), HN - 1) / HA, Math.sign(y) * Math.pow(Math.abs(y / (y > 0 ? HBT : HBB)), HN - 1) / (y > 0 ? HBT : HBB), Math.pow(z / HC, HN - 1) / HC).normalize(); };

  // eyes: a soft scan-lined halo, a bright cyan core that follows the look direction, and a glow
  function eyeTexture(core) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    if (core) { r.addColorStop(0, 'rgba(225,255,255,1)'); r.addColorStop(.4, 'rgba(110,248,255,1)'); r.addColorStop(.8, 'rgba(45,220,255,1)'); r.addColorStop(.9, 'rgba(35,200,255,.5)'); r.addColorStop(1, 'rgba(30,190,255,0)'); }
    else { r.addColorStop(0, 'rgba(120,190,215,.95)'); r.addColorStop(.55, 'rgba(96,150,178,.9)'); r.addColorStop(.9, 'rgba(78,128,160,.88)'); r.addColorStop(.96, 'rgba(110,200,235,.9)'); r.addColorStop(1, 'rgba(90,170,210,0)'); }
    g.fillStyle = r; g.fillRect(0, 0, 256, 256);
    if (!core) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 0; y < 256; y += 7) g.fillRect(0, y, 256, 2.5); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const haloTex = eyeTexture(false), coreTex = eyeTexture(true);
  const eyeMat = new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, toneMapped: false });
  const coreMat = new THREE.MeshBasicMaterial({ map: coreTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const glowMat = new THREE.MeshBasicMaterial({ map: coreTex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending, opacity: .1 });
  const disc = new THREE.CircleGeometry(1, 64);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const ex = sx * .33, ey = -.05;
    const eye = new THREE.Group(); eye.position.set(ex, ey, vz(ex, ey) + .012);
    eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vNormal(ex, ey)); skull.add(eye);
    const lid = new THREE.Group(); eye.add(lid);                                       // blink squashes this group
    const halo = new THREE.Mesh(disc, eyeMat); halo.scale.set(.21, .26, 1); halo.renderOrder = 1; lid.add(halo);
    const pupil = new THREE.Group(); pupil.position.z = .004; lid.add(pupil);
    const core = new THREE.Mesh(disc, coreMat); core.scale.setScalar(.105); core.renderOrder = 2; pupil.add(core);
    const glow = new THREE.Mesh(disc, glowMat); glow.scale.setScalar(.2); glow.position.z = .002; glow.renderOrder = 3; pupil.add(glow);
    const happy = mesh(new THREE.TorusGeometry(.12, .026, 10, 36, PI), M.arc, [0, -.05, .01]); happy.castShadow = false; happy.visible = false; eye.add(happy);
    const wink = mesh(new THREE.TorusGeometry(.12, .026, 10, 36, PI), M.arc, [0, -.05, .01]); wink.castShadow = false; wink.visible = false; eye.add(wink);
    eyes.push({ eye, lid, pupil, core, happy, wink, halo });
  }
  // no mouth (like the reference); when Gizmo talks, a small cyan level meter lights up in the visor
  const smile = new THREE.Group(); skull.add(smile);
  const talk = new THREE.Group(); talk.position.set(0, -.31, vz(0, -.31) + .012); talk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vNormal(0.001, -.31)); skull.add(talk);
  const bars = [];
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.PlaneGeometry(.036, .1), M.arc); b.position.x = (i - 2) * .058; talk.add(b); bars.push(b); }
  talk.visible = false;
  // ears: black housing with a bevelled rim, grey lens and a cyan ring. Local -Y points away from the head.
  const phones = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(sx * (HA - .05), -.07, .03); p.rotation.z = sx * PI / 2; skull.add(p);
    p.add(mesh(new THREE.CylinderGeometry(.3, .31, .2, 48), M.dark, [0, -.02, 0]));
    p.add(mesh(new THREE.TorusGeometry(.29, .045, 14, 48), M.dark, [0, -.12, 0]).rotateX(PI / 2));
    p.add(mesh(new THREE.CylinderGeometry(.22, .22, .03, 48), M.lens, [0, -.13, 0]));
    p.add(mesh(new THREE.TorusGeometry(.228, .012, 8, 48), M.glow, [0, -.143, 0]).rotateX(PI / 2));
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
  let blinkT = 0, nextBlink = 2 + Math.random() * 3, wink = -1, dbl = false;
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
    arms[1].children[2].rotation.z = .12 + P.foreR;
    legs[0].rotation.x = P.legL.x; legs[1].rotation.x = P.legR.x;
    // knees: bend when a leg swings forward, when Gizmo crouches or lands, and to lift the heel
    const crouch = Math.max(0, 1 - P.sy) * 4;
    [[legs[0], P.legL.x, P.footL], [legs[1], P.legR.x, P.footR]].forEach(([lg, lx, lift]) => {
      const k = .04 + Math.max(0, -lx) * 1.1 + crouch + lift * 3.2;
      lg.userData.knee.rotation.x = lerp(lg.userData.knee.rotation.x, Math.min(k, 1.9), 1 - Math.pow(.0005, dt));
    });
    // elbows, wrists and fingers: arms bend more as they rise, hands open when happy, fingers flex gently at rest
    arms.forEach((a, i) => {
      const u = a.userData, raise = Math.abs(i ? P.armR.z : P.armL.z), swing = i ? P.armR.x : P.armL.x;
      const bend = .22 + Math.min(1.4, raise) * .32 + Math.max(0, -swing) * .3 + (reduce ? 0 : Math.sin(t * 1.7 + i) * .03);
      u.fore.rotation.x = lerp(u.fore.rotation.x, -bend, 1 - Math.pow(.002, dt));
      if (i === 0) u.fore.rotation.z = lerp(u.fore.rotation.z, u.sx * .12, .2);
      const open = P.joy || (i === 1 && P.foreR !== 0);
      const curl = open ? .12 : .5 + (reduce ? 0 : Math.sin(t * 1.3 + i * 2) * .1);
      u.fingers.forEach((f, k) => {
        const c = lerp(f.rotation.z / -u.sx || 0, curl * (1 + k * .06), 1 - Math.pow(.003, dt));
        f.rotation.z = -u.sx * c; f.userData.tip.rotation.z = -u.sx * c * 1.1;
      });
      u.thumb.rotation.z = lerp(u.thumb.rotation.z, -u.sx * (open ? .1 : .35), .15);
      u.hand.rotation.y = lerp(u.hand.rotation.y, (open ? -u.sx * .5 : 0), .12);
    });
    ground.material.opacity = .16 * clamp(1 - P.y / 2.6, .25, 1);
    blob.material.opacity = .12 * clamp(1 - P.y / 2.6, .25, 1); blob.position.x = P.x;

    // eyes: a quick squash blink (sometimes a double blink) with a bright flash as they reopen
    blinkT += dt;
    if (blinkT > nextBlink) { blinkT = 0; dbl = Math.random() < .25; nextBlink = 2.4 + Math.random() * 3.2; }
    const bl = x => x < .12 ? Math.sin(x / .12 * PI) : 0;
    const shut = reduce ? 0 : Math.max(bl(blinkT), dbl ? bl(blinkT - .2) : 0);
    const flash = reduce ? 0 : Math.max(0, 1 - Math.abs(blinkT - .16 - (dbl ? .2 : 0)) / .14);
    eyes.forEach((e, i) => {
      const winking = P.wink === i, joy = P.joy && !winking;
      e.pupil.position.x = lerp(e.pupil.position.x, lookS.x * .055, .25); e.pupil.position.y = lerp(e.pupil.position.y, lookS.y * .05, .25);
      e.lid.visible = !winking && !joy;
      e.lid.scale.y = Math.max(.06, 1 - shut * .94);
      e.lid.scale.x = 1 + shut * .08;
      const big = state === 'listening' ? 1.15 + Math.sin(t * 7) * .05 : state === 'thinking' ? .9 : 1;
      e.pupil.scale.setScalar(lerp(e.pupil.scale.x, big * (1 + flash * .15), .25));
      e.core.material.opacity = 1;
      e.happy.visible = joy; e.wink.visible = winking;
    });
    // talking: the cyan level meter in the visor
    talkLevel = lerp(talkLevel, talkTarget, .35);
    const speaking = state === 'speaking';
    talk.visible = speaking;
    if (speaking) bars.forEach((b, i) => { b.scale.y = .25 + talkLevel * (.55 + .45 * Math.abs(Math.sin(t * 14 + i * 1.7))) * (1 - Math.abs(i - 2) * .18); });
    // glows
    const lg = state === 'listening' ? 2.2 + Math.sin(t * 7) * .9 : 1.3;
    M.glow.emissiveIntensity = lerp(M.glow.emissiveIntensity, lg, .2);
    M.led.emissiveIntensity = speaking ? (Math.sin(t * 16) > 0 ? 2.6 : .7) : lerp(M.led.emissiveIntensity, 1.1, .1);
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
