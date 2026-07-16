import * as THREE from 'three';

const COLOR_IDLE = 0x4f8ef7;
const COLOR_HOVER = 0x9fc3ff;
const COLOR_SELECTED = 0xf7a34f;

// Renders clickable joint spheres and stickman-style bone lines over the model.
// Lines cover the whole skeleton; spheres only the pickable joints.
export class SkeletonView {
  constructor(scene, camera, dom, bones, pickableBones, jointRadius) {
    this.camera = camera;
    this.dom = dom;
    this.bones = bones;
    this.jointBones = pickableBones;
    this.onSelect = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.selected = null;

    this.group = new THREE.Group();
    scene.add(this.group);

    const geo = new THREE.SphereGeometry(jointRadius, 12, 10);
    this.spheres = this.jointBones.map((bone) => {
      const mat = new THREE.MeshBasicMaterial({
        color: COLOR_IDLE,
        depthTest: false,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 999;
      mesh.userData.bone = bone;
      this.group.add(mesh);
      return mesh;
    });

    // one line segment per bone that has a bone parent
    this.segments = bones.filter((b) => b.parent && b.parent.isBone);
    const positions = new Float32Array(this.segments.length * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x6a7180,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    });
    this.lines = new THREE.LineSegments(lineGeo, lineMat);
    this.lines.renderOrder = 998;
    this.lines.frustumCulled = false;
    this.group.add(this.lines);

    this._tmp = new THREE.Vector3();
    this._down = null;
    this.pickEnabled = true;

    dom.addEventListener('pointerdown', (e) => {
      this._down = { x: e.clientX, y: e.clientY };
    });
    dom.addEventListener('pointerup', (e) => this._onPointerUp(e));
    dom.addEventListener('pointermove', (e) => this._onPointerMove(e));
  }

  _raycast(e) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.spheres, false);
    return hits.length ? hits[0].object : null;
  }

  _onPointerMove(e) {
    if (!this.pickEnabled) return;
    const hit = this._raycast(e);
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.dom.style.cursor = hit ? 'pointer' : '';
      this._applyColors();
    }
  }

  _onPointerUp(e) {
    if (!this.pickEnabled || !this._down) return;
    const dx = e.clientX - this._down.x;
    const dy = e.clientY - this._down.y;
    this._down = null;
    if (Math.hypot(dx, dy) > 5) return; // it was a drag (orbit), not a click

    const hit = this._raycast(e);
    const bone = hit ? hit.userData.bone : null;
    this.setSelected(bone);
    if (this.onSelect) this.onSelect(bone);
  }

  setSelected(bone) {
    this.selected = bone;
    this._applyColors();
  }

  _applyColors() {
    for (const s of this.spheres) {
      let c = COLOR_IDLE;
      if (s.userData.bone === this.selected) c = COLOR_SELECTED;
      else if (s === this.hovered) c = COLOR_HOVER;
      s.material.color.setHex(c);
    }
  }

  setVisible(v) {
    this.group.visible = v;
  }

  // Call once per frame after bone transforms change.
  update() {
    for (let i = 0; i < this.jointBones.length; i++) {
      this.jointBones[i].getWorldPosition(this._tmp);
      this.spheres[i].position.copy(this._tmp);
    }
    const pos = this.lines.geometry.attributes.position;
    for (let i = 0; i < this.segments.length; i++) {
      const b = this.segments[i];
      b.parent.getWorldPosition(this._tmp);
      pos.setXYZ(i * 2, this._tmp.x, this._tmp.y, this._tmp.z);
      b.getWorldPosition(this._tmp);
      pos.setXYZ(i * 2 + 1, this._tmp.x, this._tmp.y, this._tmp.z);
    }
    pos.needsUpdate = true;
  }
}
