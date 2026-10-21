// Nova in 3D: the Rocketbox Business_Female_01 avatar (MIT licence, see avatar/nova/LICENSE.md) rendered with three.js
// into a transparent canvas over the studio backdrop. setFrame(t) poses the face from the timeline's viseme track.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const VIS = ['AA_VI_00_Sil', 'AA_VI_01_PP', 'AA_VI_02_FF', 'AA_VI_03_TH', 'AA_VI_04_DD', 'AA_VI_05_KK', 'AA_VI_06_CH', 'AA_VI_07_SS',
  'AA_VI_08_nn', 'AA_VI_09_RR', 'AA_VI_10_aa', 'AA_VI_11_E', 'AA_VI_12_I', 'AA_VI_13_O', 'AA_VI_14_U'];
const noise = (t, a, b, c) => Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.1;

export async function initNova(canvas, base) {
  const W = 1280, H = 720;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(W, H, false); r.setClearColor(0x000000, 0);
  r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
  const sc = new THREE.Scene();
  sc.environment = new THREE.PMREMGenerator(r).fromScene(new RoomEnvironment(), 0.04).texture;
  sc.environmentIntensity = 0.45;
  const key = new THREE.DirectionalLight(0xfff0e4, 3.1); key.position.set(70, 240, 170); sc.add(key);
  const front = new THREE.DirectionalLight(0xffffff, 0.9); front.position.set(0, 170, 300); sc.add(front);
  const fill = new THREE.DirectionalLight(0xbfe9ff, 0.55); fill.position.set(-140, 160, 120); sc.add(fill);
  const rimL = new THREE.DirectionalLight(0xff2e88, 3.2); rimL.position.set(-120, 210, -140); sc.add(rimL);
  const rimR = new THREE.DirectionalLight(0x19e3ff, 2.6); rimR.position.set(140, 200, -120); sc.add(rimR);
  sc.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a1a28, 0.6));

  const mgr = new THREE.LoadingManager();
  mgr.addHandler(/\.tga$/i, new THREE.TextureLoader(mgr));  // .tga names are rewritten to our .jpg/.png below
  // the FBX names .tga textures; we ship them converted to .jpg/.png next to the model
  mgr.setURLModifier(u => {
    const f = decodeURIComponent(u.split(/[\\/]/).pop());
    if (/\.tga$/i.test(f)) return base + '/' + f.replace(/\.tga$/i, /opacity/i.test(f) ? '.png' : '.jpg');
    return u;
  });
  const model = await new Promise((res, rej) => new FBXLoader(mgr).load(base + '/nova.fbx', res, undefined, rej));
  await new Promise(res => { if (mgr.itemsLoaded >= mgr.itemsTotal) res(); else mgr.onLoad = res; setTimeout(res, 15000); });
  sc.add(model);

  const bones = {}, faces = [];
  model.traverse(n => {
    if (n.isBone) bones[n.name] = n;
    if (n.isMesh) {
      n.frustumCulled = false;
      for (const m of [].concat(n.material)) {
        if (/opacity/i.test(m.name)) { m.transparent = false; m.alphaTest = 0.45; m.side = THREE.DoubleSide; }
        if (m.shininess !== undefined) m.shininess = /head/i.test(m.name) ? 18 : 10;
        if (m.specular) m.specular.multiplyScalar(0.5);
      }
      if (n.morphTargetDictionary) faces.push(n);
    }
  });

  // T-pose -> arms down by the sides, aimed in world space so it works whatever the bone axes are
  const aim = (name, childName, dir) => {
    const b = bones[name], c = bones[childName]; if (!b || !c) return;
    model.updateMatrixWorld(true);
    const p = b.getWorldPosition(new THREE.Vector3()), q = c.getWorldPosition(new THREE.Vector3());
    const cur = q.sub(p).normalize(), want = dir.clone().normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(cur, want);
    const bw = b.getWorldQuaternion(new THREE.Quaternion()), pw = b.parent.getWorldQuaternion(new THREE.Quaternion());
    b.quaternion.copy(pw.invert().multiply(delta.multiply(bw)));
  };
  aim('Bip01_L_UpperArm', 'Bip01_L_Forearm', new THREE.Vector3(0.18, -1, 0.12));
  aim('Bip01_R_UpperArm', 'Bip01_R_Forearm', new THREE.Vector3(-0.18, -1, 0.12));
  aim('Bip01_L_Forearm', 'Bip01_L_Hand', new THREE.Vector3(0.05, -0.55, 1));
  aim('Bip01_R_Forearm', 'Bip01_R_Hand', new THREE.Vector3(-0.05, -0.55, 1));
  model.updateMatrixWorld(true);

  const head = bones.Bip01_Head, neck = bones.Bip01_Neck, spine = bones.Bip01_Spine2 || bones.Bip01_Spine1;
  const rest = { head: head.quaternion.clone(), neck: neck && neck.quaternion.clone(), spine: spine && spine.quaternion.clone() };
  const hp = head.getWorldPosition(new THREE.Vector3());
  // camera: head-and-shoulders, subject on the left third so the news panel fits on the right
  const cam = new THREE.PerspectiveCamera(18, W / H, 1, 3000);
  const D = 255;                                      // ~80 cm of frame height: head, shoulders and upper chest
  cam.position.set(hp.x + 26, hp.y - 6, hp.z + D);
  cam.lookAt(hp.x + 27, hp.y - 13, hp.z);             // head lands near x=380, y=250 of the 1280x720 frame

  const idx = name => { const out = []; for (const f of faces) { const k = Object.keys(f.morphTargetDictionary).find(x => x.endsWith(name)); if (k !== undefined) out.push([f, f.morphTargetDictionary[k]]); } return out; };
  const VI = VIS.map(idx), SH = {};
  for (const n of ['AK_09_EyeBlinkLeft', 'AK_10_EyeBlinkRight', 'AK_44_MouthSmileLeft', 'AK_45_MouthSmileRight', 'AK_25_JawOpen',
    'AU_01_InnerBrowRaiser', 'AU_02_OuterBrowRaiser', 'AK_15_EyeLookOutLeft', 'AK_14_EyeLookInRight', 'AK_13_EyeLookInLeft',
    'AK_16_EyeLookOutRight', 'AK_11_EyeLookDownLeft', 'AK_12_EyeLookDownRight', 'AU_06_CheekRaiser']) SH[n] = idx(n);
  const set = (list, v) => { for (const [m, i] of list) m.morphTargetInfluences[i] = v; };
  const vis = new Float32Array(VIS.length);

  function setFrame(t, fr) {
    for (const f of faces) f.morphTargetInfluences.fill(0);
    // visemes, eased toward the target so mouth shapes blend rather than snap
    const target = new Float32Array(VIS.length);
    for (const [v, w] of (fr.visemes || [])) target[v] = Math.max(target[v], w);
    if (!(fr.visemes || []).length && fr.mouth > 0.08) { target[10] = fr.mouth * 0.7; target[11] = fr.mouth * 0.25; }
    for (let i = 0; i < vis.length; i++) { vis[i] = fr.first ? target[i] : vis[i] * 0.35 + target[i] * 0.65; set(VI[i], vis[i] * 0.9); }
    set(SH.AK_25_JawOpen, Math.min(0.35, fr.mouth * 0.3));
    // blinks every ~3-5 s, a light resting smile, brows lift a little on loud words
    const bt = (t + 0.7) % 3.9, blink = bt < 0.16 ? Math.sin(bt / 0.16 * Math.PI) : 0;
    set(SH.AK_09_EyeBlinkLeft, blink); set(SH.AK_10_EyeBlinkRight, blink);
    const smile = 0.16 + (fr.smile || 0) * 0.35;
    set(SH.AK_44_MouthSmileLeft, smile); set(SH.AK_45_MouthSmileRight, smile); set(SH.AU_06_CheekRaiser, smile * 0.4);
    set(SH.AU_01_InnerBrowRaiser, Math.max(0, fr.mouth - 0.65) * 0.9); set(SH.AU_02_OuterBrowRaiser, Math.max(0, fr.mouth - 0.7) * 0.6);
    // eyes mostly to camera with small drifts
    const ex = noise(t, 0.37, 0.91, 2.3) * 0.18;
    set(SH.AK_15_EyeLookOutLeft, Math.max(0, ex)); set(SH.AK_14_EyeLookInRight, Math.max(0, ex));
    set(SH.AK_13_EyeLookInLeft, Math.max(0, -ex)); set(SH.AK_16_EyeLookOutRight, Math.max(0, -ex));
    // head: gentle sway plus small nods while talking; breathing in the chest
    const e = new THREE.Euler(noise(t, 0.6, 1.7, 3.1) * 0.035 + fr.mouth * 0.03, noise(t, 0.45, 1.2, 2.7) * 0.05, noise(t, 0.3, 0.9, 2.2) * 0.025);
    head.quaternion.copy(rest.head).multiply(new THREE.Quaternion().setFromEuler(e));
    if (neck) neck.quaternion.copy(rest.neck).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(e.x * 0.5, e.y * 0.4, e.z * 0.4)));
    if (spine) spine.quaternion.copy(rest.spine).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(t * 1.6) * 0.008, 0, 0)));
    r.render(sc, cam);
  }
  return { setFrame };
}
