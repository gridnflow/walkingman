import * as THREE from 'three';

const RAD = THREE.MathUtils.degToRad;
const DEG = THREE.MathUtils.radToDeg;

// Right-side joint panel: name, XYZ rotation sliders, reset buttons.
export class PosePanel {
  constructor(bindPose, { onChange, onModeChange, onResetPose }) {
    this.bindPose = bindPose;
    this.bone = null;
    this.onChange = onChange;

    this.nameEl = document.getElementById('joint-name');
    this.sliders = {
      x: document.getElementById('rot-x'),
      y: document.getElementById('rot-y'),
      z: document.getElementById('rot-z'),
    };
    this.values = {
      x: document.getElementById('rot-x-val'),
      y: document.getElementById('rot-y-val'),
      z: document.getElementById('rot-z-val'),
    };
    this.resetJointBtn = document.getElementById('reset-joint');
    this.modeButtons = {
      rotate: document.getElementById('mode-rotate'),
      translate: document.getElementById('mode-translate'),
    };

    for (const axis of ['x', 'y', 'z']) {
      this.sliders[axis].addEventListener('input', () => {
        if (!this.bone) return;
        this.bone.rotation[axis] = RAD(parseFloat(this.sliders[axis].value));
        this.values[axis].textContent = `${this.sliders[axis].value}°`;
        this.onChange();
      });
    }

    this.resetJointBtn.addEventListener('click', () => {
      if (!this.bone) return;
      const bind = this.bindPose.get(this.bone.name);
      this.bone.quaternion.copy(bind.q);
      this.bone.position.copy(bind.p);
      this.refresh();
      this.onChange();
    });

    document.getElementById('reset-pose').addEventListener('click', () => {
      onResetPose();
      this.refresh();
    });

    for (const [mode, btn] of Object.entries(this.modeButtons)) {
      btn.addEventListener('click', () => {
        this.modeButtons.rotate.classList.toggle('active', mode === 'rotate');
        this.modeButtons.translate.classList.toggle('active', mode === 'translate');
        onModeChange(mode);
      });
    }
  }

  setBone(bone) {
    this.bone = bone;
    const enabled = !!bone;
    for (const axis of ['x', 'y', 'z']) this.sliders[axis].disabled = !enabled;
    this.resetJointBtn.disabled = !enabled;
    this.nameEl.textContent = bone
      ? bone.name.replace(/^mixamorig:?/, '')
      : '조인트를 클릭하세요';
    this.refresh();
  }

  // Sync sliders from the bone's current rotation (e.g. after gizmo drag).
  refresh() {
    for (const axis of ['x', 'y', 'z']) {
      const deg = this.bone ? Math.round(DEG(this.bone.rotation[axis])) : 0;
      this.sliders[axis].value = deg;
      this.values[axis].textContent = `${deg}°`;
    }
  }
}
