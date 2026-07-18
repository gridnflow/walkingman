import * as THREE from 'three';

const D = THREE.MathUtils.degToRad;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Joints the editor exposes for posing (without the "mixamorig" prefix).
export const KEY_JOINTS = [
  'Hips', 'Spine1', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot',
];

const short = (bone) => bone.name.replace(/^mixamorig:?/, '');

export function isKeyJoint(bone) {
  return KEY_JOINTS.includes(short(bone));
}

// Apply Euler-degree offsets (bind-local frame) on top of the bind pose. Debug helper.
export function applyOffsets(bones, bindPose, offsets, hipsDy = 0) {
  for (const b of bones) {
    const bind = bindPose.get(b.name);
    b.quaternion.copy(bind.q);
    b.position.copy(bind.p);
    const off = offsets[short(b)];
    if (off) {
      _e.set(D(off[0]), D(off[1]), D(off[2]), 'XYZ');
      b.quaternion.multiply(_q.setFromEuler(_e));
    }
    if (short(b) === 'Hips') b.position.y += hipsDy;
  }
}

// Rotate a bone by a world-frame delta (axis in world space), keeping it rig-agnostic.
function rotateWorld(bone, axis, deg) {
  bone.updateWorldMatrix(true, false);
  const bw = bone.getWorldQuaternion(new THREE.Quaternion());
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, D(deg));
  bone.quaternion.multiply(bw.clone().invert().multiply(delta).multiply(bw));
}

// Rotate a bone so the bone→child direction matches targetDir (world space).
function aimWorld(bone, child, targetDir) {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const from = child.getWorldPosition(_v1).sub(bone.getWorldPosition(_v2)).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, targetDir.clone().normalize());
  const bw = bone.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.multiply(bw.clone().invert().multiply(delta).multiply(bw));
}

// ---- walk cycle ----
// The character faces +Z in editor space; sagittal swing rotations happen about world X,
// with "forward" positive. All angles in degrees from vertical.
//
// Contact pose: LEFT foot planted forward, right leg trailing, right arm swung forward.
const CONTACT_L = {
  Lthigh: 28, Lshin: 22, Lfoot: 12,
  Rthigh: -20, Rshin: -38, Rfoot: -28,
  Larm: -24, Rarm: 26, elbow: 18,
  pelvisYaw: 7, dy: -1,
};
// Passing pose: weight over the LEFT leg, right knee lifting through.
const PASS_L = {
  Lthigh: -2, Lshin: -2, Lfoot: 0,
  Rthigh: 14, Rshin: -30, Rfoot: -12,
  Larm: -6, Rarm: 8, elbow: 18,
  pelvisYaw: 0, dy: 1,
};

function mirrorPhase(p) {
  return {
    Lthigh: p.Rthigh, Lshin: p.Rshin, Lfoot: p.Rfoot,
    Rthigh: p.Lthigh, Rshin: p.Lshin, Rfoot: p.Lfoot,
    Larm: p.Rarm, Rarm: p.Larm,
    elbow: p.elbow,
    pelvisYaw: -p.pelvisYaw, dy: p.dy,
  };
}

export function makeWalkAnimation(bones, bindPose, rootBone, opts = {}) {
  // armTwist -60° keeps the palms toward the body; tuned visually against this rig
  const { armTwist = -60, wristRelax = 8 } = opts;
  const get = (name) => bones.find((b) => short(b) === name);
  const j = {
    hips: get('Hips'), spine: get('Spine1'),
    lUp: get('LeftUpLeg'), lSh: get('LeftLeg'), lFt: get('LeftFoot'), lToe: get('LeftToeBase'),
    rUp: get('RightUpLeg'), rSh: get('RightLeg'), rFt: get('RightFoot'), rToe: get('RightToeBase'),
    lArm: get('LeftArm'), lFore: get('LeftForeArm'), lHand: get('LeftHand'),
    rArm: get('RightArm'), rFore: get('RightForeArm'), rHand: get('RightHand'),
    lIdx: get('LeftHandIndex1'), rIdx: get('RightHandIndex1'),
  };
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const hipsBind = bindPose.get(rootBone.name);
  const bounce = hipsBind.p.length() * 0.02;

  const armDir = (swingDeg) =>
    new THREE.Vector3(0, -Math.cos(D(swingDeg)), Math.sin(D(swingDeg)));

  function applyPhase(p) {
    // reset to bind
    for (const b of bones) {
      const bind = bindPose.get(b.name);
      b.quaternion.copy(bind.q);
      b.position.copy(bind.p);
    }
    rootBone.updateWorldMatrix(true, true);

    // pelvis yaw with upper-body counter-rotation
    rotateWorld(j.hips, Y, p.pelvisYaw);
    rotateWorld(j.spine, Y, -p.pelvisYaw * 1.6);

    // legs: forward swing is a negative rotation about world X (empirically probed)
    rotateWorld(j.lUp, X, -p.Lthigh);
    rotateWorld(j.lSh, X, -(p.Lshin - p.Lthigh));
    rotateWorld(j.lFt, X, -(p.Lfoot - p.Lshin));
    rotateWorld(j.rUp, X, -p.Rthigh);
    rotateWorld(j.rSh, X, -(p.Rshin - p.Rthigh));
    rotateWorld(j.rFt, X, -(p.Rfoot - p.Rshin));

    // arms: aim straight down, then swing in the sagittal plane (bind pose is hands-on-hips).
    // After aiming, twist each bone about its own axis so the palms face the body,
    // and let the hand continue the forearm line with a slight relax bend.
    for (const [arm, fore, hand, idx, swing, twist] of [
      [j.lArm, j.lFore, j.lHand, j.lIdx, p.Larm, armTwist],
      [j.rArm, j.rFore, j.rHand, j.rIdx, p.Rarm, -armTwist],
    ]) {
      const upper = armDir(swing);
      const lower = armDir(swing + p.elbow);
      aimWorld(arm, fore, upper);
      if (twist) rotateWorld(arm, upper, twist);
      aimWorld(fore, hand, lower);
      if (twist) rotateWorld(fore, lower, twist * 0.5);
      if (idx) aimWorld(hand, idx, armDir(swing + p.elbow + wristRelax));
    }

    // vertical bounce
    j.hips.position.y += p.dy * bounce;
  }

  const phases = [CONTACT_L, PASS_L, mirrorPhase(CONTACT_L), mirrorPhase(PASS_L)];
  const keyframes = phases.map((p) => {
    applyPhase(p);
    const pose = {};
    for (const b of bones) {
      pose[b.name] = { q: b.quaternion.toArray(), p: b.position.toArray() };
    }
    return { bones: pose };
  });

  // leave the model back in bind pose; the timeline applies keyframe 0
  for (const b of bones) {
    const bind = bindPose.get(b.name);
    b.quaternion.copy(bind.q);
    b.position.copy(bind.p);
  }

  return { version: 1, segDur: 0.3, loop: true, keyframes };
}
