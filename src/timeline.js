import * as THREE from 'three';

const STORAGE_KEY = 'walkingman.animation.v1';

// Keyframe timeline: capture poses, interpolate between them, play back.
export class Timeline {
  constructor(bones, rootBone, { onPlayStateChange, onPoseApplied }) {
    this.bones = bones;
    this.rootBone = rootBone;
    this.onPlayStateChange = onPlayStateChange;
    this.onPoseApplied = onPoseApplied;

    this.keyframes = []; // [{ bones: { name: { q:[4], p:[3] } } }]
    this.segDur = 0.5;
    this.speed = 1;
    this.loop = true;
    this.playing = false;
    this.t = 0;
    this.selectedIndex = -1;

    this._qa = new THREE.Quaternion();
    this._qb = new THREE.Quaternion();
    this._pa = new THREE.Vector3();
    this._pb = new THREE.Vector3();

    this.el = {
      play: document.getElementById('play-btn'),
      loop: document.getElementById('loop-chk'),
      speed: document.getElementById('speed-sel'),
      segDur: document.getElementById('seg-dur'),
      scrubber: document.getElementById('scrubber'),
      chips: document.getElementById('kf-chips'),
      add: document.getElementById('kf-add'),
      overwrite: document.getElementById('kf-overwrite'),
      del: document.getElementById('kf-delete'),
    };

    this.el.play.addEventListener('click', () => this.togglePlay());
    this.el.loop.addEventListener('change', () => {
      this.loop = this.el.loop.checked;
      this._syncScrubberRange();
      this._save();
    });
    this.el.speed.addEventListener('change', () => {
      this.speed = parseFloat(this.el.speed.value);
    });
    this.el.segDur.addEventListener('change', () => {
      this.segDur = Math.max(0.1, parseFloat(this.el.segDur.value) || 0.5);
      this._syncScrubberRange();
      this._save();
    });
    this.el.scrubber.addEventListener('input', () => {
      this.pause();
      this.t = (parseInt(this.el.scrubber.value, 10) / 1000) * this.duration();
      this._applyAt(this.t);
    });
    this.el.add.addEventListener('click', () => this.addKeyframe());
    this.el.overwrite.addEventListener('click', () => this.overwriteSelected());
    this.el.del.addEventListener('click', () => this.deleteSelected());

    this._load();
  }

  // ---- pose capture / apply ----

  _capturePose() {
    const pose = {};
    for (const b of this.bones) {
      pose[b.name] = { q: b.quaternion.toArray(), p: b.position.toArray() };
    }
    return pose;
  }

  _applyPose(pose) {
    for (const b of this.bones) {
      const s = pose[b.name];
      if (!s) continue;
      b.quaternion.fromArray(s.q);
      if (b === this.rootBone) b.position.fromArray(s.p);
    }
    if (this.onPoseApplied) this.onPoseApplied();
  }

  _applyBlend(poseA, poseB, alpha) {
    for (const b of this.bones) {
      const sa = poseA[b.name];
      const sb = poseB[b.name];
      if (!sa || !sb) continue;
      this._qa.fromArray(sa.q);
      this._qb.fromArray(sb.q);
      b.quaternion.slerpQuaternions(this._qa, this._qb, alpha);
      if (b === this.rootBone) {
        this._pa.fromArray(sa.p);
        this._pb.fromArray(sb.p);
        b.position.lerpVectors(this._pa, this._pb, alpha);
      }
    }
    if (this.onPoseApplied) this.onPoseApplied();
  }

  // total playback duration; with loop on, an extra segment blends last→first
  duration() {
    const n = this.keyframes.length;
    if (n < 2) return 0;
    return this.segDur * (this.loop ? n : n - 1);
  }

  _applyAt(t) {
    const n = this.keyframes.length;
    if (n === 0) return;
    if (n === 1) return this._applyPose(this.keyframes[0].bones);
    const i = Math.min(Math.floor(t / this.segDur), (this.loop ? n : n - 1) - 1);
    const alpha = THREE.MathUtils.clamp((t - i * this.segDur) / this.segDur, 0, 1);
    const a = this.keyframes[i].bones;
    const b = this.keyframes[(i + 1) % n].bones;
    this._applyBlend(a, b, alpha);
  }

  // ---- transport ----

  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  play() {
    if (this.keyframes.length < 2) return;
    this.playing = true;
    if (this.t >= this.duration()) this.t = 0;
    this.el.play.textContent = '⏸';
    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.el.play.textContent = '▶';
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  update(dt) {
    if (!this.playing) return;
    this.t += dt * this.speed;
    const total = this.duration();
    if (this.t >= total) {
      if (this.loop) this.t %= total;
      else {
        this.t = total;
        this.pause();
      }
    }
    this._applyAt(this.t);
    this.el.scrubber.value = Math.round((this.t / total) * 1000);
  }

  // ---- keyframe CRUD ----

  addKeyframe() {
    this.keyframes.push({ bones: this._capturePose() });
    this.selectedIndex = this.keyframes.length - 1;
    this._renderChips();
    this._syncScrubberRange();
    this._save();
  }

  overwriteSelected() {
    if (this.selectedIndex < 0) return;
    this.keyframes[this.selectedIndex] = { bones: this._capturePose() };
    this._save();
  }

  deleteSelected() {
    if (this.selectedIndex < 0) return;
    this.keyframes.splice(this.selectedIndex, 1);
    this.selectedIndex = Math.min(this.selectedIndex, this.keyframes.length - 1);
    this._renderChips();
    this._syncScrubberRange();
    this._save();
  }

  _selectKeyframe(i) {
    this.pause();
    this.selectedIndex = i;
    this.t = i * this.segDur;
    this._applyPose(this.keyframes[i].bones);
    this._renderChips();
    const total = this.duration();
    if (total > 0) this.el.scrubber.value = Math.round((this.t / total) * 1000);
  }

  _renderChips() {
    this.el.chips.innerHTML = '';
    this.keyframes.forEach((_, i) => {
      const btn = document.createElement('button');
      btn.className = 'kf-chip' + (i === this.selectedIndex ? ' selected' : '');
      btn.textContent = i + 1;
      btn.addEventListener('click', () => this._selectKeyframe(i));
      this.el.chips.appendChild(btn);
    });
    const has = this.selectedIndex >= 0 && this.keyframes.length > 0;
    this.el.overwrite.disabled = !has;
    this.el.del.disabled = !has;
  }

  _syncScrubberRange() {
    this.el.scrubber.disabled = this.keyframes.length < 2;
  }

  // ---- persistence ----

  toJSON() {
    return {
      version: 1,
      segDur: this.segDur,
      loop: this.loop,
      keyframes: this.keyframes,
    };
  }

  fromJSON(data) {
    if (!data || !Array.isArray(data.keyframes)) throw new Error('invalid animation file');
    this.pause();
    this.keyframes = data.keyframes;
    this.segDur = data.segDur || 0.5;
    this.loop = data.loop !== false;
    this.selectedIndex = this.keyframes.length ? 0 : -1;
    this.t = 0;
    this.el.segDur.value = this.segDur;
    this.el.loop.checked = this.loop;
    this._renderChips();
    this._syncScrubberRange();
    if (this.keyframes.length) this._applyPose(this.keyframes[0].bones);
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
    } catch { /* storage full or unavailable — skip autosave */ }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.fromJSON(JSON.parse(raw));
    } catch { /* corrupted autosave — start fresh */ }
    this._renderChips();
    this._syncScrubberRange();
  }
}
