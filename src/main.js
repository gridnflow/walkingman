import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonView } from './skeleton.js';
import { PosePanel } from './panel.js';
import { Timeline } from './timeline.js';
import { isKeyJoint, applyOffsets, makeWalkAnimation } from './presets.js';

const viewport = document.getElementById('viewport');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15171c);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.2));
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(2, 4, 3);
scene.add(dir);

const grid = new THREE.GridHelper(4, 20, 0x3a3f4a, 0x262a33);
scene.add(grid);

function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

new GLTFLoader().load(
  new URL('/models/character.glb', import.meta.url).href,
  (gltf) => init(gltf),
  undefined,
  (err) => console.error('GLB load failed:', err),
);

function init(gltf) {
  const model = gltf.scene;
  scene.add(model);
  model.updateMatrixWorld(true);

  // center the model and put its feet on the grid
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;

  camera.position.set(size.y * 1.4, size.y * 0.9, size.y * 2.2);
  orbit.target.set(0, size.y * 0.55, 0);

  let skinned = null;
  model.traverse((o) => {
    if (o.isSkinnedMesh && !skinned) skinned = o;
    if (o.isMesh) o.frustumCulled = false; // bones move outside the static bbox
  });
  if (!skinned) {
    console.error('No skinned mesh found in GLB');
    return;
  }

  const bones = skinned.skeleton.bones;
  const rootBone =
    bones.find((b) => /hips/i.test(b.name)) || bones[0];

  // bind pose snapshot for reset
  const bindPose = new Map();
  for (const b of bones) {
    bindPose.set(b.name, { q: b.quaternion.clone(), p: b.position.clone() });
  }
  function resetPose() {
    for (const b of bones) {
      const bind = bindPose.get(b.name);
      b.quaternion.copy(bind.q);
      b.position.copy(bind.p);
    }
  }

  // --- joint spheres + picking (major joints only; fingers/end bones stay hidden) ---
  const jointRadius = size.y * 0.022;
  const pickableBones = bones.filter(isKeyJoint);
  const skeletonView = new SkeletonView(scene, camera, renderer.domElement, bones, pickableBones, jointRadius);

  // --- rotation gizmo ---
  const gizmo = new TransformControls(camera, renderer.domElement);
  gizmo.setMode('rotate');
  gizmo.setSpace('local');
  gizmo.setSize(0.6);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
    skeletonView.pickEnabled = !e.value;
    if (!e.value) {
      // re-enable picking on the next tick so the release click isn't a pick
      skeletonView.pickEnabled = false;
      setTimeout(() => (skeletonView.pickEnabled = true), 0);
    }
  });

  // --- UI panel ---
  const panel = new PosePanel(bindPose, {
    onChange: () => timeline.pause(),
    onModeChange: (mode) => gizmo.setMode(mode),
    onResetPose: () => {
      timeline.pause();
      resetPose();
    },
  });

  gizmo.addEventListener('objectChange', () => {
    panel.refresh();
    timeline.pause();
  });

  skeletonView.onSelect = (bone) => {
    if (bone) gizmo.attach(bone);
    else gizmo.detach();
    panel.setBone(bone);
  };

  // --- timeline ---
  const timeline = new Timeline(bones, rootBone, {
    onPlayStateChange: (playing) => {
      gizmo.enabled = !playing;
      if (playing) gizmo.detach();
      else if (skeletonView.selected) gizmo.attach(skeletonView.selected);
    },
    onPoseApplied: () => panel.refresh(),
  });

  // --- export / import ---
  document.getElementById('export-json').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(timeline.toJSON(), null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'walkingman-animation.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const fileInput = document.getElementById('import-file');
  document.getElementById('import-json').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      timeline.fromJSON(JSON.parse(await file.text()));
    } catch (e) {
      alert('애니메이션 파일을 읽을 수 없습니다: ' + e.message);
    }
    fileInput.value = '';
  });

  // --- walk preset ---
  function loadWalkPreset() {
    skeletonView.setSelected(null);
    gizmo.detach();
    panel.setBone(null);
    timeline.fromJSON(makeWalkAnimation(bones, bindPose, rootBone));
    timeline.play();
  }
  document.getElementById('preset-walk').addEventListener('click', loadWalkPreset);

  // first run: start out walking instead of standing still
  if (timeline.keyframes.length === 0) loadWalkPreset();

  // debug/scripting handle
  window.__wm = {
    bones, bindPose, rootBone, camera, orbit, timeline, size,
    applyOffsets: (off, dy) => applyOffsets(bones, bindPose, off || {}, dy || 0),
    testWalk(opts) {
      timeline.fromJSON(makeWalkAnimation(bones, bindPose, rootBone, opts));
      timeline.pause();
      timeline._applyAt(0);
    },
    setView(name) {
      const d = size.y * 2.2;
      const y = size.y * 0.55;
      if (name === 'side') camera.position.set(d, y, 0);
      else if (name === 'front') camera.position.set(0, y, d);
      else camera.position.set(d * 0.64, size.y * 0.9, d);
      orbit.target.set(0, y, 0);
    },
  };

  // --- desktop character overlay (Tauri only) ---
  const overlayBtn = document.getElementById('overlay-toggle');
  if (window.__TAURI__) {
    overlayBtn.addEventListener('click', () => {
      window.__TAURI__.core.invoke('toggle_overlay').catch(console.error);
    });
  } else {
    overlayBtn.disabled = true;
    overlayBtn.title = '데스크탑 앱에서만 사용할 수 있습니다';
  }

  // spacebar toggles playback
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
      e.preventDefault();
      timeline.togglePlay();
    }
  });

  // --- render loop ---
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    // rAF timestamps can lag the performance.now() taken at registration — clamp at 0
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.1);
    last = now;
    timeline.update(dt);
    orbit.update();
    skeletonView.update();
    renderer.render(scene, camera);
  });
}
