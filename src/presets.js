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

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

// hand-tuned fixed extremity poses (editor-slider local Euler, degrees)
const WRIST_L = [-20, 20, 11];
const WRIST_R = [0, -15, 12];
const ANKLE_L = [80, -41, 71];
const ANKLE_R = [80, -45, 84];
const TOE_IN = 16; // the fixed ankle pose reads duck-footed — pull toes inward about world Y

const armDir = (swingDeg) =>
  new THREE.Vector3(0, -Math.cos(D(swingDeg)), Math.sin(D(swingDeg)));

function getJoints(bones) {
  const get = (name) => bones.find((b) => short(b) === name);
  return {
    hips: get('Hips'), spine: get('Spine1'),
    lUp: get('LeftUpLeg'), lSh: get('LeftLeg'), lFt: get('LeftFoot'), lToe: get('LeftToeBase'),
    rUp: get('RightUpLeg'), rSh: get('RightLeg'), rFt: get('RightFoot'), rToe: get('RightToeBase'),
    lArm: get('LeftArm'), lFore: get('LeftForeArm'), lHand: get('LeftHand'),
    rArm: get('RightArm'), rFore: get('RightForeArm'), rHand: get('RightHand'),
  };
}

function resetToBind(bones, bindPose) {
  for (const b of bones) {
    const bind = bindPose.get(b.name);
    b.quaternion.copy(bind.q);
    b.position.copy(bind.p);
  }
}

function poseAnkles(j) {
  j.lFt.rotation.set(D(ANKLE_L[0]), D(ANKLE_L[1]), D(ANKLE_L[2]));
  j.rFt.rotation.set(D(ANKLE_R[0]), D(ANKLE_R[1]), D(ANKLE_R[2]));
  rotateWorld(j.lFt, Y, -TOE_IN);
  rotateWorld(j.rFt, Y, TOE_IN);
}

// aim arms down and swing them in the sagittal plane, then apply the fixed wrists
function poseArms(j, lSwing, rSwing, elbow) {
  aimWorld(j.lArm, j.lFore, armDir(lSwing));
  aimWorld(j.lFore, j.lHand, armDir(lSwing + elbow));
  aimWorld(j.rArm, j.rFore, armDir(rSwing));
  aimWorld(j.rFore, j.rHand, armDir(rSwing + elbow));
  j.lHand.rotation.set(D(WRIST_L[0]), D(WRIST_L[1]), D(WRIST_L[2]));
  j.rHand.rotation.set(D(WRIST_R[0]), D(WRIST_R[1]), D(WRIST_R[2]));
}

function captureKeyframes(bones, phases, apply) {
  return phases.map((p) => {
    apply(p);
    const pose = {};
    for (const b of bones) {
      pose[b.name] = { q: b.quaternion.toArray(), p: b.position.toArray() };
    }
    return { bones: pose };
  });
}

export function makeWalkAnimation(bones, bindPose, rootBone) {
  const j = getJoints(bones);
  const hipsBind = bindPose.get(rootBone.name);
  const bounce = hipsBind.p.length() * 0.02;

  function applyPhase(p) {
    resetToBind(bones, bindPose);
    rootBone.updateWorldMatrix(true, true);

    // pelvis yaw with upper-body counter-rotation
    rotateWorld(j.hips, Y, p.pelvisYaw);
    rotateWorld(j.spine, Y, -p.pelvisYaw * 1.6);

    // legs: forward swing is a negative rotation about world X (empirically probed)
    rotateWorld(j.lUp, X, -p.Lthigh);
    rotateWorld(j.lSh, X, -(p.Lshin - p.Lthigh));
    rotateWorld(j.rUp, X, -p.Rthigh);
    rotateWorld(j.rSh, X, -(p.Rshin - p.Rthigh));
    poseAnkles(j);

    poseArms(j, p.Larm, p.Rarm, p.elbow);

    // vertical bounce
    j.hips.position.y += p.dy * bounce;
  }

  const phases = [CONTACT_L, PASS_L, mirrorPhase(CONTACT_L), mirrorPhase(PASS_L)];
  const keyframes = captureKeyframes(bones, phases, applyPhase);
  resetToBind(bones, bindPose); // the timeline applies keyframe 0

  return { version: 1, segDur: 0.3, loop: true, keyframes };
}

// ---- sit / stand cycle ----
// stand → crouch → seated (held) → crouch → back to stand on loop.
// Angles in degrees from vertical (forward positive); dy/dz scale the bind hip height.
const SIT_STAND = { thigh: 0, shin: 0, lean: 0, arm: 5, elbow: 15, dy: 0, dz: 0 };
const SIT_CROUCH = { thigh: 60, shin: -5, lean: 30, arm: 35, elbow: 20, dy: -0.25, dz: -0.18 };
const SIT_SEATED = { thigh: 85, shin: 2, lean: 8, arm: 22, elbow: 28, dy: -0.42, dz: -0.38 };

export function makeSitStandAnimation(bones, bindPose, rootBone) {
  const j = getJoints(bones);
  const H = bindPose.get(rootBone.name).p.length(); // ≈ hip height in bind units

  function applyPhase(p) {
    resetToBind(bones, bindPose);
    rootBone.updateWorldMatrix(true, true);

    // spine points up, so leaning forward is the opposite world rotation from the legs
    rotateWorld(j.spine, X, p.lean);
    rotateWorld(j.lUp, X, -p.thigh);
    rotateWorld(j.lSh, X, -(p.shin - p.thigh));
    rotateWorld(j.rUp, X, -p.thigh);
    rotateWorld(j.rSh, X, -(p.shin - p.thigh));
    poseAnkles(j);

    poseArms(j, p.arm, p.arm, p.elbow);

    // sit back and down while the feet stay planted
    j.hips.position.y += p.dy * H;
    j.hips.position.z += p.dz * H;
  }

  const phases = [SIT_STAND, SIT_CROUCH, SIT_SEATED, SIT_SEATED, SIT_CROUCH];
  const keyframes = captureKeyframes(bones, phases, applyPhase);
  resetToBind(bones, bindPose);

  return { version: 1, segDur: 0.5, loop: true, keyframes };
}
