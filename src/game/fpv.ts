import * as THREE from "three";

/**
 * Rigid-body quadrotor model.
 *
 * - Body: mass ~1.2 kg, thrust-to-weight ≈ 2.65 (boost 3.5).
 * - Motors have spool-up lag, thrust follows a non-linear throttle curve.
 * - Quadratic aerodynamic drag, ground effect near the surface and wind gusts.
 * - ANGLE mode: attitude is stabilised towards a commanded tilt (real
 *   "stabilize" flight mode), ACRO mode: pure body rates like Betaflight.
 * In both modes the drone keeps full momentum — releasing the sticks never
 * teleports velocity, gravity and drag keep acting at all times.
 */

export type FlightMode = "ANGLE" | "ACRO";

export type FpvControls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  boost: boolean;
};

export type FpvState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  orientation: THREE.Quaternion;
  yawAngle: number;
  pitchAngle: number;
  rollAngle: number;
  throttleLever: number;
  motorSpool: number;
  mode: FlightMode;
  pitchCmd: number;
  rollCmd: number;
  yawCmd: number;
};

export type FpvStepResult = {
  groundImpact: number;
  groundEffect: number;
  bodyRate: number;
};

const MAX_THRUST = 26.5;
const BOOST_MULT = 1.32;
const DRAG_K = 0.042;
const MAX_TILT = 0.7;
const YAW_RATE = 3.0;
const ANGLE_TRACK = 9.0;
const MAX_ATTITUDE_RATE = 6.0;
const ACRO_PITCH_RATE = 5.4;
const ACRO_ROLL_RATE = 5.8;
const CEILING = 70;
const CLEARANCE = 0.24;

export const HOVER_LEVER = 0.4915;

const _target = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _delta = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _accel = new THREE.Vector3();

export function createFpvState(spawn: THREE.Vector3): FpvState {
  return {
    position: spawn.clone(),
    velocity: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    yawAngle: 0,
    pitchAngle: 0,
    rollAngle: 0,
    throttleLever: HOVER_LEVER,
    motorSpool: HOVER_LEVER,
    mode: "ANGLE",
    pitchCmd: 0,
    rollCmd: 0,
    yawCmd: 0,
  };
}

function smooth(current: number, target: number, dt: number, tau: number) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

export function stepFpv(
  state: FpvState,
  controls: FpvControls,
  dt: number,
  groundY: number,
  time: number,
): FpvStepResult {
  const tau = 0.045;
  state.pitchCmd = smooth(state.pitchCmd, THREE.MathUtils.clamp(controls.pitch, -1, 1), dt, tau);
  state.rollCmd = smooth(state.rollCmd, THREE.MathUtils.clamp(controls.roll, -1, 1), dt, tau);
  state.yawCmd = smooth(state.yawCmd, THREE.MathUtils.clamp(controls.yaw, -1, 1), dt, tau * 1.3);
  state.throttleLever = smooth(
    state.throttleLever,
    THREE.MathUtils.clamp(controls.throttle, 0, 1),
    dt,
    0.07,
  );
  state.motorSpool = smooth(state.motorSpool, state.throttleLever, dt, 0.05);

  let bodyRate = 0;
  if (state.mode === "ANGLE") {
    const targetPitch = -state.pitchCmd * MAX_TILT;
    const targetRoll = -state.rollCmd * MAX_TILT;
    state.pitchAngle = smooth(state.pitchAngle, targetPitch, dt, 1 / ANGLE_TRACK);
    state.rollAngle = smooth(state.rollAngle, targetRoll, dt, 1 / ANGLE_TRACK);
    state.yawAngle -= state.yawCmd * YAW_RATE * dt;
    _euler.set(state.pitchAngle, state.yawAngle, state.rollAngle, "YXZ");
    _target.setFromEuler(_euler);
    const angle = state.orientation.angleTo(_target);
    if (angle > 1e-5) {
      const step = Math.min(angle, MAX_ATTITUDE_RATE * dt);
      state.orientation.slerp(_target, step / angle);
      bodyRate = step / dt;
    }
  } else {
    _axis.set(
      -state.pitchCmd * ACRO_PITCH_RATE,
      -state.yawCmd * YAW_RATE,
      -state.rollCmd * ACRO_ROLL_RATE,
    );
    const rate = _axis.length();
    if (rate > 1e-5) {
      _delta.setFromAxisAngle(_axis.normalize(), rate * dt);
      state.orientation.multiply(_delta);
      bodyRate = rate;
    }
    _euler.setFromQuaternion(state.orientation, "YXZ");
    state.yawAngle = _euler.y;
    state.pitchAngle = _euler.x;
    state.rollAngle = _euler.z;
  }
  state.orientation.normalize();

  const height = state.position.y - groundY;
  const groundEffect = height < 1.3 ? 1 + 0.12 * (1 - height / 1.3) : 1;
  const spool = THREE.MathUtils.clamp(state.motorSpool, 0, 1);
  const thrustAccel =
    MAX_THRUST * Math.pow(spool, 1.4) * groundEffect * (controls.boost ? BOOST_MULT : 1);

  _up.set(0, 1, 0).applyQuaternion(state.orientation);
  _accel.copy(_up).multiplyScalar(thrustAccel);
  _accel.y -= 9.81;

  const speed = state.velocity.length();
  _accel.addScaledVector(state.velocity, -DRAG_K * speed);

  // Atmospheric turbulence: two interfering sine bands plus a light gust field.
  const turbulence = 0.24 + Math.min(speed, 30) * 0.012;
  _accel.x += Math.sin(time * 1.7 + state.position.x * 0.16) * Math.sin(time * 0.9) * turbulence;
  _accel.y += Math.sin(time * 2.4 + state.position.z * 0.11) * turbulence * 0.55;
  _accel.z += Math.cos(time * 1.3 + state.position.y * 0.2) * turbulence * 0.8;

  state.velocity.addScaledVector(_accel, dt);
  state.position.addScaledVector(state.velocity, dt);

  let groundImpact = 0;
  const floor = groundY + CLEARANCE;
  if (state.position.y < floor) {
    if (state.velocity.y < 0) {
      groundImpact = -state.velocity.y;
      state.velocity.y *= -0.16;
    }
    state.position.y = floor;
    state.velocity.x *= 0.7;
    state.velocity.z *= 0.7;
  }
  if (state.position.y > CEILING) {
    state.position.y = CEILING;
    if (state.velocity.y > 0) state.velocity.y = 0;
  }

  return { groundImpact, groundEffect, bodyRate };
}

export function flightHeading(state: FpvState) {
  return (THREE.MathUtils.radToDeg(-state.yawAngle) + 360) % 360;
}
