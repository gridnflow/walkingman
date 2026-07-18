import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeWalkAnimation } from './presets.js';

const STORAGE_KEY = 'walkingman.animation.v1';

// Transparent full-width strip at the bottom of the screen.
// The character loops the authored animation while walking left → right.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.4));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(2, 4, 3);
scene.add(dir);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);

let bones = null;
let rootBone = null;
let holder = null; // moves along X while walking
let modelHeight = 1;
let anim = null; // { segDur, keyframes }

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

let fallbackWalk = null; // generated from the rig if nothing has been authored yet

function loadAnimation() {
  anim = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.keyframes && data.keyframes.length >= 2) anim = data;
    }
  } catch { /* corrupted storage — fall through to the generated walk */ }
  if (!anim) anim = fallbackWalk;
}
window.addEventListener('storage', loadAnimation); // live-updates while editing

function applyAt(t) {
  if (!anim || !bones) return;
  const kf = anim.keyframes;
  const segDur = anim.segDur || 0.5;
  const total = segDur * kf.length; // always loop last → first
  t %= total;
  const i = Math.floor(t / segDur);
  const alpha = (t - i * segDur) / segDur;
  const a = kf[i].bones;
  const b = kf[(i + 1) % kf.length].bones;
  for (const bone of bones) {
    const sa = a[bone.name];
    const sb = b[bone.name];
    if (!sa || !sb) continue;
    _qa.fromArray(sa.q);
    _qb.fromArray(sb.q);
    bone.quaternion.slerpQuaternions(_qa, _qb, alpha);
    if (bone === rootBone) {
      _pa.fromArray(sa.p);
      _pb.fromArray(sb.p);
      bone.position.lerpVectors(_pa, _pb, alpha);
    }
  }
}

function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const h = modelHeight * 1.2;
  camera.top = h;
  camera.bottom = 0;
  camera.left = (-h * aspect) / 2;
  camera.right = (h * aspect) / 2;
  camera.near = -50;
  camera.far = 50;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fitCamera);

new GLTFLoader().load(
  new URL('/models/character.glb', import.meta.url).href,
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    modelHeight = size.y;

    holder = new THREE.Group();
    model.position.set(-center.x, -box.min.y, -center.z);
    model.rotation.y = Math.PI / 2; // rig rests facing +Z; turn it toward +X, the walking direction
    holder.add(model);
    scene.add(holder);

    model.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
      if (o.isSkinnedMesh && !bones) {
        bones = o.skeleton.bones;
        rootBone = bones.find((b) => /hips/i.test(b.name)) || bones[0];
      }
    });

    // never stand idle: if nothing has been authored yet, walk with the generated cycle
    const bindPose = new Map();
    for (const b of bones) {
      bindPose.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
    }
    fallbackWalk = makeWalkAnimation(bones, bindPose, rootBone);
    loadAnimation();

    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    fitCamera();

    window.__ov = { bones, holder, model, camera };

    let last = performance.now();
    let walkX = camera.left - modelHeight; // start just off the left edge
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
      last = now;

      applyAt(now / 1000);

      // walk speed: one body-height per 1.6s
      walkX += (modelHeight / 1.6) * dt;
      const margin = modelHeight;
      if (walkX > camera.right + margin) walkX = camera.left - margin;
      holder.position.x = walkX;

      renderer.render(scene, camera);
    });
  },
  undefined,
  (err) => console.error('GLB load failed:', err),
);
