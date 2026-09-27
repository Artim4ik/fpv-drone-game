import * as THREE from "three";

/**
 * Rigid-body quadrotor model for an FPV kamikaze drone.
 *
 * - Body: mass ~1.2 kg, thrust-to-weight ≈ 2.65 (boost 3.5).
 * - Motors have spool-up lag, thrust follows a non-linear throttle curve,
 *   and the pack sags as the battery drains.
 * - Control authority comes from the props: no thrust → no attitude control,
 *   yaw authority scales with motor RPM like torque differential.
 * - Quadratic aerodynamic drag, ground effect, wind gusts and prop-wash
 *   oscillation in a low descending flight.
 * - ACRO rates with RC-style expo shaping; optional stabilization assist
 *   (hold) levels the airframe while keeping momentum and gravity intact.
 */

export type FlightMode = "ANGLE" | "ACRO";

export type FpvControls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  boost: boolean;
  /** Hold to run the stabilization assist (levels towards the horizon). */
  assist: boolean;
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
const YAW_RATE = 2.7;
const ANGLE_TRACK = 9.0;
const MAX_ATTITUDE_RATE = 6.0;
/** Acro rates: fast enough to flick, tame enough to stay controllable. */
const ACRO_PITCH_RATE = 4.3;
const ACRO_ROLL_RATE = 4.7;
const ASSIST_RATE = 5.2;
const CEILING = 70;
const CLEARANCE = 0.24;
/** Below this throttle the props cannot hold attitude any more. */
const CONTROL_AUTH_FLOOR = 0.16;

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
    mode: "ACRO",
    pitchCmd: 0,
    rollCmd: 0,
    yawCmd: 0,
  };
}

/** RC-style expo: soft around the centre, full rate at the end of the stick. */
export function shapeAxis(value: number, expo = 0.3) {
  const v = THREE.MathUtils.clamp(value, -1, 1);
  return expo * v + (1 - expo) * v * v * v;
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
  thrustScale = 1,
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

  const spool = THREE.MathUtils.clamp(state.motorSpool, 0, 1);
  // Without thrust the props cannot torque the body; yaw needs more RPM
  // because it relies on torque differential between the motors.
  const controlAuth = Math.min(1, spool / CONTROL_AUTH_FLOOR);
  const yawAuth = 0.45 + 0.55 * Math.min(1, spool / 0.6);

  let bodyRate = 0;
  const pitchRate = shapeAxis(state.pitchCmd) * ACRO_PITCH_RATE * controlAuth;
  const rollRate = shapeAxis(state.rollCmd) * ACRO_ROLL_RATE * controlAuth;
  const yawRate = shapeAxis(state.yawCmd) * YAW_RATE * yawAuth;

  const assistActive = controls.assist && spool > 0.12;
  if (state.mode === "ANGLE" && !assistActive) {
    const targetPitch = -state.pitchCmd * MAX_TILT;
    const targetRoll = -state.rollCmd * MAX_TILT;
    state.pitchAngle = smooth(state.pitchAngle, targetPitch, dt, 1 / ANGLE_TRACK);
    state.rollAngle = smooth(state.rollAngle, targetRoll, dt, 1 / ANGLE_TRACK);
    state.yawAngle -= yawRate * dt;
    _euler.set(state.pitchAngle, state.yawAngle, state.rollAngle, "YXZ");
    _target.setFromEuler(_euler);
    const angle = state.orientation.angleTo(_target);
    if (angle > 1e-5) {
      const step = Math.min(angle, MAX_ATTITUDE_RATE * dt);
      state.orientation.slerp(_target, step / angle);
      bodyRate = step / dt;
    }
  } else if (assistActive) {
    // Stabilization assist: hold the heading, ease the airframe level.
    state.yawAngle -= yawRate * dt;
    _euler.set(0, state.yawAngle, 0, "YXZ");
    _target.setFromEuler(_euler);
    const angle = state.orientation.angleTo(_target);
    if (angle > 1e-5) {
      const step = Math.min(angle, ASSIST_RATE * dt);
      state.orientation.slerp(_target, step / angle);
      bodyRate = step / dt;
    }
  } else {
    _axis.set(-pitchRate, -yawRate, -rollRate);
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

  const height = Math.max(0, state.position.y - groundY);
  const groundEffect = height < 1.3 ? 1 + 0.12 * (1 - height / 1.3) : 1;
  const thrustAccel =
    MAX_THRUST *
    Math.pow(spool, 1.4) *
    groundEffect *
    (controls.boost ? BOOST_MULT : 1) *
    thrustScale;

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

  // Prop-wash: descending through your own wash shakes the frame.
  if (state.velocity.y < -3.5 && height < 7) {
    const wash = Math.min(1, (-state.velocity.y - 3.5) / 6) * (1 - height / 7);
    if (wash > 0) {
      _delta.setFromEuler(
        new THREE.Euler(
          (Math.random() - 0.5) * wash * 0.09,
          (Math.random() - 0.5) * wash * 0.05,
          (Math.random() - 0.5) * wash * 0.09,
        ),
      );
      state.orientation.multiply(_delta);
      state.orientation.normalize();
      bodyRate = Math.max(bodyRate, wash * 2.2);
    }
  }

  let groundImpact = 0;
  const floor = groundY + CLEARANCE;
  if (state.position.y < floor) {
    if (state.velocity.y < 0) {
      groundImpact = -state.velocity.y;
      state.velocity.y *= -0.16;
    }
    state.position.y = floor;
    // Time-based grip so the drone settles instead of skating.
    const grip = Math.exp(-7 * dt);
    state.velocity.x *= grip;
    state.velocity.z *= grip;
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
