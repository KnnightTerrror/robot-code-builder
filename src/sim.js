/*
 * Robot Code Builder: the in-app simulator.
 *
 * Runs a JavaScript copy of the generated robot program right in the page: the same
 * subsystems, commands, buttons, combos, autos, LED rules and AprilTag features, with
 * simple physics for every mechanism and a top-down swerve drive on the 2026 field.
 *
 * It is for checking that buttons, combos and autos do what you expect before the robot
 * exists. For tuning, use the WPILib simulator with the generated code, which models the
 * motor controllers exactly.
 */
(function (root) {
  'use strict';

  const G = root.RobotGen || (typeof require === 'function' ? require('./gen.js') : null);

  /* ================================================================ constants */

  const LOOP = 0.02;            // robot loop, seconds
  const SUBSTEPS = 20;          // motor controller and physics steps per loop (1 ms each)
  const GRAVITY = 9.81;
  const IN = 0.0254;
  const LB = 0.45359237;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const FIELD_L = 16.541;
  const FIELD_W = 8.069;
  const ROBOT = 0.84;           // bumper to bumper, m
  const TOP_SPEED = 4.5;        // m/s at full stick; Tuner X knows the real number
  const MAX_TURN = 10;          // rad/s the wheels can turn the robot
  const DRIVE_ACCEL = 9;        // m/s^2
  const TURN_ACCEL = 30;        // rad/s^2
  const CAMERA_HALF_FOV = 31;   // degrees each side (Limelight 3)
  const CAMERA_RANGE = 6;       // m
  const SLOW_RAMP = 0.5;        // m, same as kSlowRampMeters in the code
  const AIM_MAX_RATE = 3;       // rad/s, kAimMaxRate
  const ALLIANCE = { blue: [47, 111, 222], red: [216, 67, 47] };

  /** 2026 field AprilTags: [id, x, y, facing degrees], WPILib blue-origin coordinates in meters. */
  const TAGS = [[1, 11.878, 7.425, 180], [2, 11.915, 4.638, 90], [3, 11.312, 4.39, 180], [4, 11.312, 4.035, 180],
    [5, 11.915, 3.431, -90], [6, 11.878, 0.644, 180], [7, 11.953, 0.644, 0], [8, 12.271, 3.431, -90],
    [9, 12.519, 3.679, 0], [10, 12.519, 4.035, 0], [11, 12.271, 4.638, 90], [12, 11.953, 7.425, 0],
    [13, 16.533, 7.403, 180], [14, 16.533, 6.972, 180], [15, 16.533, 4.324, 180], [16, 16.533, 3.892, 180],
    [17, 4.663, 0.644, 0], [18, 4.626, 3.431, -90], [19, 5.229, 3.679, 0], [20, 5.229, 4.035, 0],
    [21, 4.626, 4.638, 90], [22, 4.663, 7.425, 0], [23, 4.588, 7.425, 180], [24, 4.27, 4.638, 90],
    [25, 4.022, 4.39, 180], [26, 4.022, 4.035, 180], [27, 4.27, 3.431, -90], [28, 4.588, 0.644, 180],
    [29, 0.008, 0.666, 0], [30, 0.008, 1.098, 0], [31, 0.008, 3.746, 0], [32, 0.008, 4.178, 0]]
    .map(([id, x, y, yaw]) => ({ id, x, y, yaw: yaw * DEG }));
  const TAG_BY_ID = new Map(TAGS.map((t) => [t.id, t]));

  /* ================================================================ helpers */

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  const pos = (v, def) => { const n = num(v, def); return n > 0 ? n : def; };
  const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const arr = (v) => (Array.isArray(v) ? v : []);
  function wrap(a) { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; }
  function rot(x, y, a) { const c = Math.cos(a); const s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }

  /** One step of a trapezoid motion profile toward `goal` (what Motion Magic and MAXMotion do). */
  function profileStep(st, goal, maxV, maxA, dt) {
    const err = goal - st.p;
    if (Math.abs(err) < 1e-9 && Math.abs(st.v) < 1e-6) return { p: goal, v: 0, a: 0 };
    const dir = sign(err) || -sign(st.v);
    const want = dir * Math.min(maxV, Math.sqrt(2 * maxA * Math.abs(err)));
    const dv = clamp(want - st.v, -maxA * dt, maxA * dt);
    const v = st.v + dv;
    const p = st.p + (st.v + v) * 0.5 * dt;
    if ((goal - p) * err <= 0 || (Math.abs(goal - p) < maxA * dt * dt && Math.abs(v) < maxA * dt * 2)) return { p: goal, v: 0, a: 0 };
    return { p, v, a: dv / dt };
  }

  /* ================================================================ motors */

  /** Electrical model of the motors on one subsystem (leader plus followers). */
  function makeMotor(sub) {
    const spec = G.MOTORS[sub.src.motor] || G.MOTORS.krakenX60;
    const stallTorque = pos(spec.stallTorque, 7.09);
    const stallCurrent = pos(spec.stallCurrent, 366);
    const R = 12 / stallCurrent;
    const free = (spec.freeRpm / 60) * TAU;
    const talon = sub.ctrl === 'talonfx';
    return {
      count: 1 + arr(sub.followers).length,
      kt: stallTorque / stallCurrent,
      R,
      kv: free / (12 - R * pos(spec.freeCurrent, 2)),
      free,
      limit: talon ? pos(sub.src.statorLimit, spec.stator || 80) : pos(sub.src.currentLimit, spec.current || 40),
      brake: !!sub.src.brake,
    };
  }

  /**
   * Moves one motor-driven axis forward by dt. M is the mass or moment of inertia and k turns
   * the axis speed into motor speed. volts = null means the motor is off (brake or coast).
   * The back-EMF part is solved implicitly so stiff gearboxes stay stable.
   */
  function stepAxis(mot, M, k, u, volts, extForce, dt) {
    if (volts == null && !mot.brake) return { u: u + (dt * extForce) / M, amps: 0 };
    const n = mot.count;
    const V = volts == null ? 0 : clamp(volts, -12, 12);
    const damp = (n * mot.kt * k * k) / (mot.kv * mot.R);
    let uNew = ((M * u) / dt + (n * mot.kt * k * V) / mot.R + extForce) / (M / dt + damp);
    let amps = (V - (k * uNew) / mot.kv) / mot.R;
    if (Math.abs(amps) > mot.limit) {
      amps = sign(amps) * mot.limit;
      uNew = u + (dt * (n * mot.kt * k * amps + extForce)) / M;
    }
    return { u: uNew, amps: Math.abs(amps) * n };
  }

  /* ================================================================ mechanisms */

  function gainsOf(sub) {
    const g = sub.gains || {};
    return { kP: num(g.kP, 0), kI: num(g.kI, 0), kD: num(g.kD, 0), kS: num(g.kS, 0), kV: num(g.kV, 0), kA: num(g.kA, 0), kG: num(g.kG, 0) };
  }

  /** Elevator or arm: Motion Magic (Talon FX) or MAXMotion (SPARK) to a target, with gravity. */
  function positionMech(sim, sub) {
    const s = sub.src;
    const arm = sub.preset === 'arm';
    const talon = sub.ctrl === 'talonfx';
    const mot = makeMotor(sub);
    const g = gainsOf(sub);
    const gear = pos(s.gearRatio, arm ? 50 : 9);
    const profile = s.profile !== false;
    const cruise = pos(s.cruise, arm ? 180 : 40);
    const accel = pos(s.accel, arm ? 360 : 80);
    const tol = pos(s.tolerance, arm ? 2 : 0.5);
    const lead = pos(s.jogLead, arm ? 10 : 2);
    const min = arm ? num(s.minPos, -30) : 0;
    const max = arm ? Math.max(min + 1, num(s.maxPos, 120)) : Math.max(1, num(s.maxPos, 50));
    const start = arm ? clamp(num(s.startAngle, 90), min, max) : 0;
    const mass = pos(s.simMassLbs, arm ? 8 : 15) * LB;
    const length = pos(s.simLength, 20) * IN;
    const radius = (pos(s.drumDiameter, 1.757) * pos(s.travelMultiplier, 1) * IN) / 2;
    const M = arm ? (mass * length * length) / 3 : mass;
    const k = arm ? gear : gear / radius;
    const toUnits = arm ? (q) => q / DEG : (q) => q / IN;
    const lo = arm ? min * DEG : 0;
    const hi = arm ? max * DEG : max * IN;
    const limit = !arm && s.limitSwitch && s.limitSwitch.enabled;
    const me = {
      kind: sub.preset, sub, min, max, tol, unit: arm ? '°' : ' in',
      q: arm ? start * DEG : 0, u: 0, offset: 0, target: start,
      req: { type: 'neutral' }, prof: null, integ: 0, lastErr: null, amps: 0, volts: 0, wasAtBottom: true, stuckT: 0,
      get position() { return toUnits(me.q) + me.offset; },
      get velocity() { return toUnits(me.u); },
      atTarget() { return Math.abs(me.position - me.target) <= tol; },
      setTarget(v) { me.target = clamp(num(v, me.target), min, max); me.req = { type: 'position', goal: me.target }; },
      hold() { me.setTarget(me.target); },
      jog(dir) { me.setTarget(me.position + dir * lead); },
      setVoltage(v) { me.req = { type: 'voltage', volts: v }; },
      zero() {
        if (!arm) { me.offset = -toUnits(me.q); me.target = 0; } else if (!s.encoder || s.encoder === 'builtin') {
          me.offset = start - toUnits(me.q); me.target = start;
        } else { me.offset = 0; me.target = me.position; }
        me.req = { type: 'position', goal: me.target };
      },
      afterSysId() { me.setTarget(me.position); },
      controlVolts(dt) {
        const p = me.position;
        const v = me.velocity;
        let sp = me.req.goal;
        let spV = 0;
        let spA = 0;
        if (profile) {
          if (!me.prof) me.prof = { p, v, a: 0 };
          me.prof = profileStep(me.prof, me.req.goal, cruise, accel, dt);
          sp = me.prof.p; spV = me.prof.v; spA = me.prof.a;
        }
        const gravity = arm ? g.kG * Math.cos(p * DEG) : g.kG;
        if (talon) {
          // Talon FX works in arm rotations or inches.
          const unit = arm ? 1 / 360 : 1;
          const err = (sp - p) * unit;
          me.integ += err * dt;
          return g.kP * err + g.kI * me.integ + g.kD * (spV - v) * unit
            + g.kS * sign(spV) + g.kV * spV * unit + g.kA * spA * unit + gravity;
        }
        // SPARK: PID output is a fraction of the battery, feedforward is in volts.
        const err = sp - p;
        if (me.lastErr == null) me.lastErr = err;
        me.integ += err;
        const duty = clamp(g.kP * err + g.kI * me.integ + g.kD * (err - me.lastErr), -1, 1);
        me.lastErr = err;
        return duty * 12 + g.kS * sign(spV) + g.kV * spV + g.kA * spA + gravity;
      },
      step(dt) {
        let volts = null;
        if (sim.enabled && me.req.type === 'position') volts = me.controlVolts(dt);
        else if (sim.enabled && me.req.type === 'voltage') volts = me.req.volts;
        if (!sim.enabled || me.req.type !== 'position') { me.prof = null; me.integ = 0; me.lastErr = null; }
        if (volts != null) {
          const p = me.position;
          if (p >= max && volts > 0) volts = 0;
          if (p <= min && volts < 0) volts = 0;
        }
        const ext = arm ? -mass * GRAVITY * (length / 2) * Math.cos(me.q) : -mass * GRAVITY;
        const r = stepAxis(mot, M, k, me.u, volts, ext, dt);
        me.u = r.u;
        me.amps = r.amps;
        me.volts = volts == null ? 0 : clamp(volts, -12, 12);
        me.q += me.u * dt;
        if (me.q <= lo) { me.q = lo; if (me.u < 0) me.u = 0; }
        if (me.q >= hi) { me.q = hi; if (me.u > 0) me.u = 0; }
      },
      periodic() {
        // Settled short of the target: the gains can't hold it there (usually kG is too small).
        const settled = !me.prof || (me.prof.v === 0 && me.prof.p === me.req.goal);
        const still = Math.abs(me.velocity) < (arm ? 2 : 0.3);
        me.stuckT = sim.enabled && me.req.type === 'position' && settled && still && !me.atTarget() ? me.stuckT + LOOP : 0;
        if (!limit) return;
        const bottom = me.q <= lo + 0.0005;
        if (bottom && !me.wasAtBottom) { me.offset = -toUnits(me.q); me.target = 0; }
        me.wasAtBottom = bottom;
      },
    };
    return me;
  }

  /** Flywheel that holds an RPM. */
  function flywheelMech(sim, sub) {
    const s = sub.src;
    const talon = sub.ctrl === 'talonfx';
    const mot = makeMotor(sub);
    const g = gainsOf(sub);
    const gear = pos(s.gearRatio, 1);
    const radius = (pos(s.simWheelDiameter, 4) * IN) / 2;
    const J = 0.5 * pos(s.simWheelMassLbs, 1.5) * LB * radius * radius;
    const drag = J / 6;
    const tol = pos(s.toleranceRpm, 100);
    const me = {
      kind: 'flywheel', sub, u: 0, angle: 0, targetRpm: 0, req: { type: 'neutral' }, integ: 0, lastErr: null, amps: 0, volts: 0,
      tol,
      get rpm() { return (me.u * 60) / TAU; },
      atSpeed() { return me.targetRpm !== 0 && Math.abs(me.rpm - me.targetRpm) <= tol; },
      setTargetRpm(r) { me.targetRpm = num(r, 0); me.req = me.targetRpm === 0 ? { type: 'neutral' } : { type: 'velocity', rpm: me.targetRpm }; },
      setVoltage(v) { me.req = { type: 'voltage', volts: v }; },
      afterSysId() { me.setTargetRpm(0); },
      step(dt) {
        let volts = null;
        if (sim.enabled && me.req.type === 'velocity') {
          if (talon) {
            const t = me.req.rpm / 60;
            const err = t - me.u / TAU;
            if (me.lastErr == null) me.lastErr = err;
            me.integ += err * dt;
            volts = g.kS * sign(t) + g.kV * t + g.kP * err + g.kI * me.integ + (g.kD * (err - me.lastErr)) / dt;
            me.lastErr = err;
          } else {
            const t = me.req.rpm;
            const err = t - me.rpm;
            if (me.lastErr == null) me.lastErr = err;
            me.integ += err;
            volts = clamp(g.kP * err + g.kI * me.integ + g.kD * (err - me.lastErr), -1, 1) * 12 + g.kS * sign(t) + g.kV * t;
            me.lastErr = err;
          }
        } else if (sim.enabled && me.req.type === 'voltage') volts = me.req.volts;
        else { me.integ = 0; me.lastErr = null; }
        const r = stepAxis(mot, J, gear, me.u, volts, -drag * me.u, dt);
        me.u = r.u;
        me.amps = r.amps;
        me.volts = volts == null ? 0 : clamp(volts, -12, 12);
        me.angle += me.u * dt;
      },
      periodic() {},
    };
    return me;
  }

  /** Rollers and climbers: open-loop speeds. Rollers can have a game piece sensor. */
  function openLoopMech(sim, sub) {
    const s = sub.src;
    const climber = sub.preset === 'climber';
    const spec = G.MOTORS[s.motor] || G.MOTORS.krakenX60;
    const gear = pos(s.gearRatio, climber ? 25 : 1);
    const free = ((spec.freeRpm / 60) * TAU) / gear;
    const sensor = !climber && s.sensor && s.sensor.type && s.sensor.type !== 'none';
    const soft = climber && s.softLimits && s.softLimits.enabled ? { min: num(s.softLimits.min, 0), max: num(s.softLimits.max, 100) } : null;
    const me = {
      kind: sub.preset, sub, duty: 0, u: 0, angle: 0, rotations: 0, offset: 0, hasSensor: !!sensor, hasPiece: false,
      autoFeed: true, feedT: 0, ejectT: 0, soft, out: 0,
      get position() { return me.rotations + me.offset; },
      get rps() { return me.u / TAU; },
      setSpeed(v) { me.duty = clamp(num(v, 0), -1, 1); },
      zero() { me.offset = -me.rotations; },
      step(dt) {
        let duty = sim.enabled ? me.duty : 0;
        if (soft) {
          if (me.position >= soft.max && duty > 0) duty = 0;
          if (me.position <= soft.min && duty < 0) duty = 0;
        }
        me.out = duty;
        const tau = duty !== 0 ? 0.08 : s.brake ? 0.04 : 0.6;
        me.u += (duty * free - me.u) * (1 - Math.exp(-dt / tau));
        me.angle += me.u * dt;
        me.rotations += (me.u / TAU) * dt;
        if (sensor) {
          me.feedT = duty > 0.05 ? me.feedT + dt : 0;
          me.ejectT = duty < -0.05 ? me.ejectT + dt : 0;
          if (!me.hasPiece && me.autoFeed && me.feedT >= 0.5) { me.hasPiece = true; sim.note(`${sub.label} picked up a game piece.`); }
          if (me.hasPiece && me.ejectT >= 0.25) { me.hasPiece = false; sim.note(`${sub.label} let go of its game piece.`); }
        }
      },
      periodic() {},
    };
    return me;
  }

  function pistonMech(sim, sub) {
    const ext = sub.src.startState === 'extended';
    const me = {
      kind: 'piston', sub, extended: ext, travel: ext ? 1 : 0,
      setExtended(v) { me.extended = !!v; },
      step(dt) { me.travel = clamp(me.travel + (me.extended ? 1 : -1) * dt * 5, 0, 1); },
      periodic() {},
    };
    return me;
  }

  function lightState(sim, lt) {
    const me = {
      kind: 'light', lt, pattern: 'off', color: 'OFF',
      show(pattern, color) { me.pattern = pattern; me.color = color; },
      /** [r, g, b] of LED i of n at time t. */
      rgb(i, n, t) {
        const col = (G.LED_COLORS.find((c) => c[0] === me.color) || G.LED_COLORS[0])[2];
        switch (me.pattern) {
          case 'solid': return col;
          case 'strobe': return Math.floor(t / 0.1) % 2 ? [0, 0, 0] : col;
          case 'rainbow': {
            const hue = ((i / n) * 360 + t * 180) % 360;
            return hsl(hue);
          }
          case 'alliance': return ALLIANCE[sim.alliance];
          default: return [0, 0, 0];
        }
      },
    };
    return me;
  }
  function hsl(hue) {
    const f = (n) => { const k = (n + hue / 60) % 6; return 255 * (1 - Math.max(0, Math.min(k, 4 - k, 1))); };
    return [f(5), f(3), f(1)].map(Math.round);
  }

  /* ================================================================ swerve drive */

  function makeDrive(sim) {
    const me = {
      x: 0, y: 0, th: 0, offset: 0, vx: 0, vy: 0, w: 0, req: { type: 'idle' }, alignTarget: null, path: null, pathPos: null, showPath: null,
      get estHeading() { return wrap(me.th + me.offset); },
      place(x, y, th) {
        me.x = clamp(x, ROBOT / 2, FIELD_L - ROBOT / 2);
        me.y = clamp(y, ROBOT / 2, FIELD_W - ROBOT / 2);
        if (th != null) me.th = wrap(th);
        me.vx = 0; me.vy = 0; me.w = 0;
      },
      /** A start spot in the alliance zone, away from the tags, facing the other alliance. */
      home() {
        if (sim.alliance === 'red') me.place(FIELD_L - 2.8, FIELD_W - 6, Math.PI);
        else me.place(2.8, 6, 0);
        me.offset = 0;
      },
      /** seedFieldCentric(): the robot now believes it faces away from its driver station. */
      seed() { me.offset = wrap((sim.alliance === 'red' ? Math.PI : 0) - me.th); },
      step(dt) {
        const R = me.req;
        if (R.type === 'follow') return;
        let tvx = 0;
        let tvy = 0;
        let tw = 0;
        let accel = DRIVE_ACCEL;
        let turnAccel = TURN_ACCEL;
        if (R.type === 'field') {
          let vx = R.vx;
          let vy = R.vy;
          let w = R.w;
          if (Math.hypot(vx, vy) < R.deadband) { vx = 0; vy = 0; }
          if (Math.abs(w) < R.rotDeadband) w = 0;
          // Operator perspective: "forward" is away from your own driver station.
          [tvx, tvy] = rot(vx, vy, (sim.alliance === 'red' ? Math.PI : 0) - me.offset);
          tw = w;
        } else if (R.type === 'robot') {
          [tvx, tvy] = rot(R.vx, R.vy, me.th);
          tw = R.w || 0;
        } else if (R.type === 'align') {
          [tvx, tvy] = rot(R.vx, R.vy, -me.offset);
          tw = R.headingP * wrap(R.dir - me.estHeading);
        } else if (R.type === 'brake') {
          accel *= 2;
        } else {
          accel = 2.5;
          turnAccel = 8;
        }
        const sp = Math.hypot(tvx, tvy);
        if (sp > TOP_SPEED) { tvx *= TOP_SPEED / sp; tvy *= TOP_SPEED / sp; }
        tw = clamp(tw, -MAX_TURN, MAX_TURN);
        let dvx = tvx - me.vx;
        let dvy = tvy - me.vy;
        const dv = Math.hypot(dvx, dvy);
        if (dv > accel * dt) { dvx *= (accel * dt) / dv; dvy *= (accel * dt) / dv; }
        me.vx += dvx;
        me.vy += dvy;
        me.w += clamp(tw - me.w, -turnAccel * dt, turnAccel * dt);
        me.x += me.vx * dt;
        me.y += me.vy * dt;
        me.th = wrap(me.th + me.w * dt);
        const half = ROBOT / 2;
        if (me.x < half) { me.x = half; me.vx = Math.max(0, me.vx); }
        if (me.x > FIELD_L - half) { me.x = FIELD_L - half; me.vx = Math.min(0, me.vx); }
        if (me.y < half) { me.y = half; me.vy = Math.max(0, me.vy); }
        if (me.y > FIELD_W - half) { me.y = FIELD_W - half; me.vy = Math.min(0, me.vy); }
      },
    };
    return me;
  }

  /* ================================================================ vision */

  function makeVision(sim) {
    const V = sim.model.vision;
    const D = sim.drive;
    const aimCam = V ? V.cameras[V.aimIdx] || V.cameras[0] : null;
    const camYaw = (cam) => (/back|rear/i.test(cam.name) ? Math.PI : 0);
    function seenBy(cam) {
      const out = [];
      TAGS.forEach((t) => {
        const dx = t.x - D.x;
        const dy = t.y - D.y;
        const dist = Math.hypot(dx, dy);
        if (dist > CAMERA_RANGE || dist < 0.05) return;
        const rel = wrap(Math.atan2(dy, dx) - (D.th + camYaw(cam)));
        if (Math.abs(rel) > CAMERA_HALF_FOV * DEG) return;
        if (Math.abs(wrap(Math.atan2(-dy, -dx) - t.yaw)) > 80 * DEG) return;
        out.push({ tag: t, dist, tx: -rel / DEG });
      });
      return out.sort((a, b) => a.dist - b.dist);
    }
    const me = {
      on: !!V,
      seen: [],
      primary: null,
      update() {
        if (!V) return;
        me.seen = aimCam ? seenBy(aimCam) : [];
        me.primary = me.seen[0] || null;
        // While disabled, MegaTag1 with two or more tags fixes the heading.
        if (!sim.enabled) {
          const all = new Set();
          V.cameras.forEach((cam) => seenBy(cam).forEach((x) => { if (x.dist <= cam.maxDistance) all.add(x.tag.id); }));
          if (all.size >= 2) D.offset = 0;
        }
      },
      hasTarget() { return !!me.primary; },
      tx() { return me.primary ? me.primary.tx : 0; },
      isAimed() { return me.hasTarget() && Math.abs(me.tx()) <= V.aimTolerance; },
      aimRate(maxRate) { return me.hasTarget() ? clamp(-me.tx() * DEG * V.aimP, -maxRate, maxRate) : 0; },
      distanceTo(ids) {
        let best = Infinity;
        ids.forEach((id) => { const t = TAG_BY_ID.get(id); if (t) best = Math.min(best, Math.hypot(t.x - D.x, t.y - D.y)); });
        return best;
      },
      inZone(z) { return me.distanceTo(z.ids) <= z.distance; },
      driveSpeedScale() {
        let scale = 1;
        V.zones.forEach((z) => {
          if (z.slow == null) return;
          const out = clamp((me.distanceTo(z.ids) - z.distance) / SLOW_RAMP, 0, 1);
          scale = Math.min(scale, z.slow + (1 - z.slow) * out);
        });
        return scale;
      },
      tableValue(tb) {
        const d = me.distanceTo(tb.ids);
        const p = tb.points;
        if (!p.length) return 0;
        if (d <= p[0].d) return p[0].v;
        if (d >= p[p.length - 1].d) return p[p.length - 1].v;
        for (let n = 1; n < p.length; n++) {
          if (d <= p[n].d) {
            const span = p[n].d - p[n - 1].d;
            return span <= 0 ? p[n].v : p[n - 1].v + ((p[n].v - p[n - 1].v) * (d - p[n - 1].d)) / span;
          }
        }
        return p[p.length - 1].v;
      },
      nearestSpot(ids, distance, sideways) {
        let best = null;
        ids.forEach((id) => {
          const t = TAG_BY_ID.get(id);
          if (!t) return;
          const x = t.x + Math.cos(t.yaw) * distance + Math.sin(t.yaw) * sideways;
          const y = t.y + Math.sin(t.yaw) * distance - Math.cos(t.yaw) * sideways;
          const d = Math.hypot(x - D.x, y - D.y);
          if (!best || d < best.d) best = { x, y, heading: wrap(t.yaw + Math.PI), d, tag: id };
        });
        return best;
      },
      isAt(target) {
        return Math.hypot(target.x - D.x, target.y - D.y) <= V.alignTolerance
          && Math.abs(wrap(D.estHeading - target.heading)) <= V.alignAngleTolerance * DEG;
      },
    };
    return me;
  }

  /* ================================================================ commands and scheduler */

  function Cmd(name, reqs, parts) {
    return Object.assign({
      name, reqs: reqs || [], disabledOk: false,
      init() {}, exec() {}, done() { return false; }, end() {},
    }, parts || {});
  }
  const union = (list) => Array.from(new Set(list.flatMap((c) => c.reqs)));

  function makeScheduler(sim) {
    const running = [];
    const owners = new Map();
    const defaults = new Map();
    const triggers = [];
    const S = {
      running, defaults,
      isScheduled: (c) => running.includes(c),
      isDefault: (c) => Array.from(defaults.values()).includes(c),
      schedule(c) {
        if (!c || running.includes(c)) return;
        if (!sim.enabled && !c.disabledOk) return;
        c.reqs.forEach((r) => { const o = owners.get(r); if (o && o !== c) S.cancel(o); });
        running.push(c);
        c.reqs.forEach((r) => owners.set(r, c));
        c.init();
      },
      cancel(c) {
        const i = running.indexOf(c);
        if (i < 0) return;
        running.splice(i, 1);
        c.reqs.forEach((r) => { if (owners.get(r) === c) owners.delete(r); });
        c.end(true);
      },
      cancelAll() { running.slice().forEach((c) => S.cancel(c)); },
      setDefault(req, c) { defaults.set(req, c); },
      trigger(cond) {
        const t = { cond, last: !!cond(), binds: [] };
        triggers.push(t);
        const api = {};
        ['onTrue', 'onFalse', 'whileTrue', 'toggleOnTrue'].forEach((kind) => {
          api[kind] = (c) => { t.binds.push([kind, c]); return api; };
        });
        return api;
      },
      run() {
        triggers.forEach((t) => {
          const now = !!t.cond();
          if (now !== t.last) {
            t.binds.forEach(([kind, c]) => {
              if (now) {
                if (kind === 'onTrue' || kind === 'whileTrue') S.schedule(c);
                else if (kind === 'toggleOnTrue') { if (running.includes(c)) S.cancel(c); else S.schedule(c); }
              } else if (kind === 'whileTrue') S.cancel(c);
              else if (kind === 'onFalse') S.schedule(c);
            });
          }
          t.last = now;
        });
        running.slice().forEach((c) => {
          if (!running.includes(c)) return;
          if (!sim.enabled && !c.disabledOk) { S.cancel(c); return; }
          c.exec();
          if (c.done() && running.includes(c)) {
            running.splice(running.indexOf(c), 1);
            c.reqs.forEach((r) => { if (owners.get(r) === c) owners.delete(r); });
            c.end(false);
          }
        });
        defaults.forEach((c, r) => { if (!owners.has(r)) S.schedule(c); });
      },
    };
    return S;
  }

  // Command building blocks, the same as WPILib's.
  function runOnce(name, reqs, fn) { return Cmd(name, reqs, { init: fn, done: () => true }); }
  function seq(sim, name, list) {
    let i = 0;
    return Cmd(name, union(list), {
      init() { i = 0; if (list.length) list[0].init(); },
      exec() {
        if (i >= list.length) return;
        const c = list[i];
        c.exec();
        if (c.done()) { c.end(false); i++; if (i < list.length) list[i].init(); }
      },
      done: () => i >= list.length,
      end(interrupted) { if (interrupted && i < list.length) list[i].end(true); },
      get step() { return i; },
    });
  }
  function withTimeout(sim, c, seconds) {
    let t0 = 0;
    return Cmd(c.name, c.reqs, {
      disabledOk: c.disabledOk,
      init() { t0 = sim.t; c.init(); },
      exec() { c.exec(); },
      done: () => c.done() || sim.t - t0 >= seconds - 1e-9,
      end(x) { c.end(x || !c.done()); },
    });
  }
  function waitSeconds(sim, seconds) {
    let t0 = 0;
    return Cmd(`Wait ${seconds} s`, [], { init() { t0 = sim.t; }, done: () => sim.t - t0 >= seconds - 1e-9 });
  }
  function proxy(sim, c) {
    return Cmd(c.name, [], {
      init() { sim.sched.schedule(c); },
      done: () => !sim.sched.isScheduled(c),
      end(x) { if (x) sim.sched.cancel(c); },
      inner: c,
    });
  }

  /* ================================================================ the robot program */

  function condition(sim, key) {
    if (key === 'disabled') return () => !sim.enabled;
    if (key === 'auto') return () => sim.enabled && sim.mode === 'auto';
    if (key === 'teleop') return () => sim.enabled && sim.mode === 'teleop';
    if (key === 'vision:target') return () => sim.vision.hasTarget();
    if (key === 'vision:aimed') return () => sim.vision.isAimed();
    const at = key.indexOf(':');
    const kind = key.slice(0, at);
    const id = key.slice(at + 1);
    if (kind === 'zone') {
      const z = sim.model.vision && sim.model.vision.zones.find((x) => x.id === id);
      return z ? () => sim.vision.inZone(z) : () => false;
    }
    const me = sim.mechs.get(id);
    if (!me) return () => false;
    switch (kind) {
      case 'piece': return () => me.hasPiece;
      case 'atspeed': return () => me.atSpeed();
      case 'attarget': return () => me.atTarget();
      case 'moving': return () => !me.atTarget();
      case 'extended': return () => me.extended;
      default: return () => false;
    }
  }

  /** A command that feeds a changing number to a subsystem (distance tables and zone values). */
  function supplierCommand(sim, sub, name, fn) {
    const me = sim.mechs.get(sub.id);
    if (sub.preset === 'flywheel') return Cmd(name, [sub.id], { exec: () => me.setTargetRpm(fn()), end: () => me.setTargetRpm(0) });
    if (sub.preset === 'roller') return Cmd(name, [sub.id], { exec: () => me.setSpeed(clamp(fn() / 100, -1, 1)), end: () => me.setSpeed(0) });
    return Cmd(name, [sub.id], { exec: () => me.setTarget(fn()) });
  }

  function subsystemCommand(sim, sub, a, name) {
    const me = sim.mechs.get(sub.id);
    const id = sub.id;
    const k = a.key;
    if (k.startsWith('sysid:')) {
      const quasi = k.includes('Quasistatic');
      const dir = k.endsWith('Reverse') ? -1 : 1;
      const step = sub.preset === 'flywheel' ? 7 : 4;
      let t0 = 0;
      return Cmd(name, [id], {
        init() { t0 = sim.t; },
        exec() { me.setVoltage(dir * (quasi ? sim.t - t0 : step)); },
        done: () => sim.t - t0 >= 10,
        end() { me.afterSysId(); },
      });
    }
    switch (sub.preset) {
      case 'roller':
      case 'climber': {
        if (k === 'stop') return runOnce(name, [id], () => me.setSpeed(0));
        if (k === 'zero') return Object.assign(runOnce(name, [id], () => me.zero()), { disabledOk: true });
        if (!a.item) break;
        const speed = clamp(num(a.item.speed, 0) / 100, -1, 1);
        const stops = sub.preset === 'roller' && me.hasSensor && !!a.item.stopOnPiece;
        return Cmd(name, [id], { init: () => me.setSpeed(speed), end: () => me.setSpeed(0), done: () => stops && me.hasPiece });
      }
      case 'flywheel':
        if (k === 'stop') return runOnce(name, [id], () => me.setTargetRpm(0));
        if (!a.item) break;
        return Cmd(name, [id], { init: () => me.setTargetRpm(num(a.item.rpm, 0)), end: () => me.setTargetRpm(0) });
      case 'elevator':
      case 'arm':
        if (a.item) return Cmd(name, [id], { init: () => me.setTarget(num(a.item.value, 0)), done: () => me.atTarget() });
        if (k === 'jogUp' || k === 'jogDown') {
          const dir = k === 'jogUp' ? 1 : -1;
          return Cmd(name, [id], { exec: () => me.jog(dir), end: () => me.setTarget(me.position) });
        }
        if (k === 'zero') return Object.assign(runOnce(name, [id], () => me.zero()), { disabledOk: true });
        break;
      case 'piston':
        if (k === 'extend') return runOnce(name, [id], () => me.setExtended(true));
        if (k === 'retract') return runOnce(name, [id], () => me.setExtended(false));
        if (k === 'toggle') return runOnce(name, [id], () => me.setExtended(!me.extended));
        break;
      default:
        break;
    }
    return runOnce(name, [], () => {});
  }

  function actionCommand(sim, t, a) {
    const name = `${t.label}: ${a.label}`;
    if (a.table) return supplierCommand(sim, t, name, () => sim.vision.tableValue(a.table));
    if (a.zoneValue != null) return supplierCommand(sim, t, name, () => a.zoneValue);
    if (t.kind === 'subsystem') return subsystemCommand(sim, t, a, name);
    if (t.kind === 'light') {
      const L = sim.lights.get(t.id);
      const sg = a.signal;
      return Cmd(name, [t.id], { disabledOk: true, exec: () => L.show(sg.pattern, sg.color) });
    }
    if (t.kind === 'vision') return a.key === 'aim' ? aimCommand(sim) : alignCommand(sim, a.spot);
    if (t.kind === 'combos') return seq(sim, a.combo.label, a.combo.steps.map((st) => stepCommand(sim, st)));
    return runOnce(name, [], () => {});
  }

  function aimCommand(sim) {
    let t0 = 0;
    return Cmd('Vision: Aim at Tag', ['drivetrain'], {
      init() { t0 = sim.t; },
      exec() { sim.drive.req = { type: 'robot', vx: 0, vy: 0, w: sim.vision.aimRate(AIM_MAX_RATE) }; },
      done: () => sim.vision.isAimed() || sim.t - t0 >= 2,
    });
  }

  function alignCommand(sim, spot) {
    const V = sim.model.vision;
    let target = null;
    let t0 = 0;
    return Cmd('Vision: ' + spot.label, ['drivetrain'], {
      init() {
        t0 = sim.t;
        target = sim.vision.nearestSpot(spot.ids, spot.distance, spot.sideways);
        sim.drive.alignTarget = target;
        if (!target) sim.note('None of those AprilTags are on the field.');
      },
      exec() {
        if (!target) return;
        const D = sim.drive;
        const vx = clamp(V.alignP * (target.x - D.x), -V.alignMaxSpeed, V.alignMaxSpeed);
        const vy = clamp(V.alignP * (target.y - D.y), -V.alignMaxSpeed, V.alignMaxSpeed);
        D.req = { type: 'align', vx, vy, dir: target.heading, headingP: V.headingP };
      },
      done: () => !target || sim.vision.isAt(target) || sim.t - t0 >= 4,
      end() { sim.drive.alignTarget = null; },
    });
  }

  function stepCommand(sim, st) {
    switch (st.type) {
      case 'action': {
        const c = actionCommand(sim, st.target, st.action);
        if (st.mode === 'finish') return proxy(sim, c);
        if (st.mode === 'background') return Cmd('Start ' + c.name, [], { init: () => sim.sched.schedule(c), done: () => true });
        return proxy(sim, withTimeout(sim, c, st.seconds));
      }
      case 'wait': return waitSeconds(sim, st.seconds);
      case 'until': {
        const cond = condition(sim, st.cond.key);
        return withTimeout(sim, Cmd('Wait until ' + st.cond.label, [], { done: cond }), st.seconds);
      }
      case 'drive': {
        const go = Cmd(`Drive ${st.dir}`, ['drivetrain'], { exec: () => { sim.drive.req = { type: 'robot', vx: st.x, vy: st.y, w: 0 }; } });
        // Proxied, like drive() in the generated Autos.java, so the auto itself never holds the drivetrain.
        return proxy(sim, seq(sim, `Drive ${st.dir}`, [withTimeout(sim, go, st.seconds),
          runOnce('Stop', ['drivetrain'], () => { sim.drive.req = { type: 'robot', vx: 0, vy: 0, w: 0 }; })]));
      }
      case 'path':
        return pathCommand(sim, st);
      default:
        return runOnce('Nothing', [], () => {});
    }
  }


  /* ================================================================ PathPlanner paths */

  // PathPlanner flips paths for the red alliance by turning them around the field's center.
  const PP_FIELD = { l: 16.54, w: 8.07 };
  const flipPose = (p) => ({ x: PP_FIELD.l - p.x, y: PP_FIELD.w - p.y, deg: p.deg + 180 });

  /** A spot on a drive plan at time t (seconds), blended between its points. */
  function sampleTraj(traj, t) {
    const pts = traj.points;
    if (!pts.length) return { x: 0, y: 0, rot: 0, pos: 0, v: 0 };
    if (t <= 0) return pts[0];
    if (t >= traj.time) return pts[pts.length - 1];
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
    const a = pts[lo];
    const b = pts[hi];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const dr = ((((b.rot - a.rot) % 360) + 540) % 360) - 180;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, rot: a.rot + dr * f, pos: a.pos + (b.pos - a.pos) * f, v: a.v + (b.v - a.v) * f };
  }

  /** Runs several commands together: all of them, the first to finish (race), or the first one (deadline). */
  function group(sim, name, list, kind) {
    let live = [];
    return Cmd(name, union(list), {
      init() { live = list.map(() => true); list.forEach((c) => c.init()); },
      exec() {
        list.forEach((c, i) => {
          if (!live[i]) return;
          c.exec();
          if (c.done()) { c.end(false); live[i] = false; }
        });
      },
      done: () => (kind === 'all' ? live.every((x) => !x) : kind === 'race' ? live.some((x) => !x) : !live[0]),
      end() { list.forEach((c, i) => { if (live[i]) { c.end(true); live[i] = false; } }); },
    });
  }

  /** A command from a PathPlanner event marker (named commands, waits and groups). */
  function ppCommand(sim, json) {
    if (!json || typeof json !== 'object') return null;
    const d = json.data || {};
    const kids = () => arr(d.commands).map((x) => ppCommand(sim, x)).filter(Boolean);
    switch (json.type) {
      case 'named': {
        const nc = sim.model.autos.named.find((x) => x.name === d.name);
        if (nc) return actionCommand(sim, nc.target, nc.action);
        return runOnce('Missing ' + d.name, [], () => sim.note(`PathPlanner asked for "${d.name}", which the code doesn't register, so it does nothing.`));
      }
      case 'wait': return waitSeconds(sim, num(d.waitTime, 0));
      case 'path': {
        // In a PathPlanner auto, a path runs as part of the auto (not as a proxy).
        const info = sim.model.paths.find((p) => p.name === d.pathName);
        if (!info) return runOnce(`Path ${d.pathName}`, [], () => sim.note(`Skipped the path "${d.pathName}". Import its .path file under Autonomous > Paths to drive it here.`));
        return pathBody(sim, info, [], false);
      }
      case 'sequential': return seq(sim, 'Sequence', kids());
      case 'parallel': return group(sim, 'Parallel', kids(), 'all');
      case 'race': return group(sim, 'Race', kids(), 'race');
      case 'deadline': return group(sim, 'Deadline', kids(), 'deadline');
      default: return null;
    }
  }

  /** What a stop spot does while the robot waits there (like the Steps helpers in the code). */
  function stopCommand(sim, sp) {
    if (sp.do === 'wait') return waitSeconds(sim, sp.seconds);
    if (sp.do === 'until') return withTimeout(sim, Cmd('Wait until ' + sp.cond.label, [], { done: condition(sim, sp.cond.key) }), sp.seconds);
    const c = actionCommand(sim, sp.target, sp.action);
    return proxy(sim, sp.mode === 'finish' ? c : withTimeout(sim, c, sp.seconds));
  }

  /** One drive between stops, with the actions that start on the way (like PathSteps.piece). */
  function pieceCommand(sim, info, from, to, stopAtEnd, starts) {
    const data = info.data;
    const D = sim.drive;
    const toEnd = to >= info.last - 1e-9;
    const endV = toEnd && !stopAtEnd ? Math.max(0, num((data.goalEndState || {}).velocity, 0)) : 0;
    const inPiece = (p) => p >= from - 1e-9 && (p < to - 1e-9 || toEnd);
    const events = starts.filter((e) => inPiece(e.pos)).map((e) => Object.assign({}, e, { end: e.end == null ? null : Math.min(e.end, to) }));
    let traj = null;
    let t0 = 0;
    let flip = false;
    let prev = null;
    return Cmd(`Path: ${info.name}`, ['drivetrain'], {
      init() {
        flip = sim.alliance === 'red';
        traj = G.PathGeom.trajectory(data, from, to, from > 1e-9 ? 0 : Math.hypot(D.vx, D.vy), endV);
        t0 = sim.t;
        prev = null;
        events.forEach((e) => { e.started = false; e.ended = false; });
        const s0 = traj.points[0] || { x: D.x, y: D.y, rot: D.th / DEG };
        const p0 = flip ? flipPose({ x: s0.x, y: s0.y, deg: s0.rot }) : { x: s0.x, y: s0.y, deg: s0.rot };
        if (from <= 1e-9 && Math.hypot(p0.x - D.x, p0.y - D.y) > 0.6) {
          sim.note(`The robot wasn't at the start of "${info.name}", so the simulator put it there. On the robot, check "Start here" on the first path.`);
        }
        D.path = { data, flip, from, to, name: info.name };
        D.req = { type: 'follow' };
      },
      exec() {
        const s = sampleTraj(traj, sim.t - t0);
        const p = flip ? flipPose({ x: s.x, y: s.y, deg: s.rot }) : { x: s.x, y: s.y, deg: s.rot };
        if (prev) { D.vx = (p.x - prev.x) / LOOP; D.vy = (p.y - prev.y) / LOOP; D.w = wrap(p.deg * DEG - prev.th) / LOOP; }
        prev = { x: p.x, y: p.y, th: p.deg * DEG };
        D.x = p.x;
        D.y = p.y;
        D.th = wrap(p.deg * DEG);
        D.req = { type: 'follow' };
        D.pathPos = s.pos;
        events.forEach((e) => {
          if (!e.started && s.pos >= e.pos - 1e-9) {
            e.started = true;
            sim.sched.schedule(e.cmd);
            if (e.detach) e.ended = true;
          }
          if (e.started && !e.ended && e.end != null && s.pos >= e.end - 1e-9) { e.ended = true; sim.sched.cancel(e.cmd); }
        });
      },
      done: () => !!traj && sim.t - t0 >= traj.time - 1e-9,
      end() {
        // Actions that run "until the robot stops" end with the drive, like PathPlanner's event markers.
        events.forEach((e) => { if (e.started && !e.ended) { e.ended = true; sim.sched.cancel(e.cmd); } });
        if (endV < 0.1) { D.req = { type: 'robot', vx: 0, vy: 0, w: 0 }; D.vx = 0; D.vy = 0; D.w = 0; }
        D.path = null;
      },
    });
  }

  /** Follows a PathPlanner path the way the generated followPath() does, if its .path file was imported. */
  function pathCommand(sim, st) {
    const info = st.path;
    if (!info) {
      return runOnce(`Path ${st.pathName}`, [], () => sim.note(`Skipped the path "${st.pathName}". Import its .path file under Autonomous > Paths to drive it here.`));
    }
    return proxy(sim, pathBody(sim, info, arr(st.spots), !!st.resetPose));
  }

  /** Puts the robot at a path's first point, facing its starting rotation (flipped for red). */
  function placeAtPathStart(sim, data) {
    const p0 = G.PathGeom.pointAt(data, 0);
    let p = { x: p0.x, y: p0.y, deg: data.idealStartingState ? num(data.idealStartingState.rotation, 0) : G.PathGeom.rotationAt(data, 0) };
    if (sim.alliance === 'red') p = flipPose(p);
    sim.drive.place(p.x, p.y, p.deg * DEG);
    sim.drive.offset = 0;
  }

  /** The drive along one path: pieces between stop spots, with the actions on the way. */
  function pathBody(sim, info, spots, resetPose) {
    const data = info.data;
    const st = { spots };
    const list = [];
    if (resetPose) {
      list.push(runOnce('Start here', [], () => placeAtPathStart(sim, data)));
    }
    // Commands are made once, like the code does when the robot turns on.
    const starts = [];
    arr(st.spots).filter((sp) => sp.kind === 'drive').forEach((sp) => {
      const c = actionCommand(sim, sp.target, sp.action);
      const pos = clamp(sp.pos, 0, info.last);
      if (sp.until === 'time') starts.push({ pos, cmd: withTimeout(sim, c, sp.seconds), detach: true });
      else if (sp.until === 'keep') starts.push({ pos, cmd: c, detach: true });
      else starts.push({ pos, cmd: c, detach: false, end: sp.until === 'spot' ? sp.endPos : null });
    });
    arr(data.eventMarkers).forEach((m) => {
      const cmd = ppCommand(sim, m && m.command);
      if (!cmd) return;
      const end = m.endWaypointRelativePos == null ? null : num(m.endWaypointRelativePos, null);
      starts.push({ pos: clamp(num(m.waypointRelativePos, 0), 0, info.last), cmd, detach: false, end: end != null && end >= 0 ? end : null });
    });
    let from = 0;
    arr(st.spots).filter((sp) => sp.kind === 'stop').sort((a, b) => a.pos - b.pos).forEach((sp) => {
      const at = clamp(sp.pos, 0, info.last);
      if (at - from > 0.001) { list.push(pieceCommand(sim, info, from, at, true, starts)); from = at; }
      list.push(stopCommand(sim, sp));
    });
    if (info.last - from > 0.001) list.push(pieceCommand(sim, info, from, info.last, false, starts));
    // Show the whole path on the field while this step runs, stops included.
    const body = seq(sim, 'Path: ' + info.name, list);
    return (Cmd(body.name, body.reqs, {
      init() { sim.drive.showPath = { data, spots: arr(st.spots), name: info.name, flip: sim.alliance === 'red' }; sim.drive.pathPos = 0; body.init(); },
      exec() { body.exec(); },
      done: () => body.done(),
      end(x) { body.end(x); sim.drive.showPath = null; },
    }));
  }

  /** Builds the commands and button bindings, the same way the generated RobotContainer does. */
  function buildProgram(sim) {
    const M = sim.model;
    const S = sim.sched;
    const input = sim.input;
    M.subsystems.forEach((sub) => {
      if (sub.preset === 'elevator' || sub.preset === 'arm') {
        const me = sim.mechs.get(sub.id);
        S.setDefault(sub.id, Cmd(sub.label + ': Hold', [sub.id], { exec: () => me.hold() }));
      }
    });
    M.lights.forEach((lt) => {
      const L = sim.lights.get(lt.id);
      const rules = lt.rules.map((r) => ({ test: condition(sim, r.cond.key), pattern: r.pattern, color: r.color }));
      S.setDefault(lt.id, Cmd(lt.label + ': Status', [lt.id], {
        disabledOk: true,
        exec() {
          const hit = rules.find((r) => r.test());
          if (hit) L.show(hit.pattern, hit.color); else L.show(lt.otherwise.pattern, lt.otherwise.color);
        },
      }));
    });

    const dc = M.driveCtl;
    if (dc) {
      const dr = M.drive;
      const maxSpeed = clamp(num(dr.maxSpeedPct, 100) / 100, 0.05, 1) * TOP_SPEED;
      const maxRate = pos(dr.maxTurnRps, 0.75) * TAU;
      const deadband = clamp(num(dr.deadbandPct, 10) / 100, 0, 0.5);
      const slowFraction = clamp(num(dr.slowPct, 40) / 100, 0.05, 1);
      const slowZones = !!M.vision && M.vision.zones.some((z) => z.slow != null);
      const hasSlow = dr.slowButton !== 'none';
      sim.speedScale = () => {
        let scale = hasSlow && input.pressed(dc, dr.slowButton) ? slowFraction : 1;
        if (slowZones) scale = Math.min(scale, sim.vision.driveSpeedScale());
        return scale;
      };
      const stick = () => input.sticks(dc);
      S.setDefault('drivetrain', Cmd('Drive with the sticks', ['drivetrain'], {
        exec() {
          const st = stick();
          const sc = sim.speedScale();
          sim.drive.req = { type: 'field', vx: -st.ly * maxSpeed * sc, vy: -st.lx * maxSpeed * sc, w: -st.rx * maxRate * sc,
            deadband: maxSpeed * deadband, rotDeadband: maxRate * deadband };
        },
      }));
      S.trigger(() => !sim.enabled).whileTrue(Cmd('Idle', ['drivetrain'], { disabledOk: true, exec: () => { sim.drive.req = { type: 'idle' }; } }));
      if (dr.resetButton !== 'none') {
        S.trigger(() => input.pressed(dc, dr.resetButton)).onTrue(runOnce('Reset heading', ['drivetrain'], () => { sim.drive.seed(); sim.note('Field heading reset: the robot now thinks it faces away from you.'); }));
      }
      if (dr.brakeButton !== 'none') {
        S.trigger(() => input.pressed(dc, dr.brakeButton)).whileTrue(Cmd('Lock wheels', ['drivetrain'], { exec: () => { sim.drive.req = { type: 'brake' }; } }));
      }
      if (M.vision && dr.aimButton !== 'none') {
        S.trigger(() => input.pressed(dc, dr.aimButton)).whileTrue(Cmd('Drive and aim', ['drivetrain'], {
          exec() {
            const st = stick();
            const sc = sim.speedScale();
            sim.drive.req = { type: 'field', vx: -st.ly * maxSpeed * sc, vy: -st.lx * maxSpeed * sc, w: sim.vision.aimRate(maxRate),
              deadband: maxSpeed * deadband, rotDeadband: 0 };
          },
        }));
      }
    }

    M.bindings.forEach((bd) => {
      const c = actionCommand(sim, bd.target, bd.action);
      const t = S.trigger(() => input.pressed(bd.ctl, bd.button));
      ({ held: t.whileTrue, pressed: t.onTrue, toggle: t.toggleOnTrue, released: t.onFalse })[bd.when](c);
    });
    if (M.vision) {
      M.vision.zones.filter((z) => z.run).forEach((z) => {
        const a = z.value != null ? Object.assign({}, z.run.a, { zoneValue: z.value }) : z.run.a;
        const c = actionCommand(sim, z.run.t, a);
        S.trigger(() => sim.vision.inZone(z) && sim.enabled && sim.mode === 'teleop').whileTrue(c);
      });
    }
    M.rumbles.forEach((rb) => {
      let t0 = 0;
      const c = Cmd(`Rumble ${rb.ctl.label}`, [], {
        init() { t0 = sim.t; input.rumble(rb.ctl, rb.strength, rb.seconds); },
        done: () => sim.t - t0 >= rb.seconds - 1e-9,
        end() { input.rumble(rb.ctl, 0, 0); },
      });
      S.trigger(condition(sim, rb.cond.key)).onTrue(c);
    });

    sim.autos = M.autos.routines.map((rt) => {
      const list = [];
      if (rt.resetHeading) list.push(runOnce('Reset heading', [], () => sim.drive.seed()));
      rt.steps.forEach((st) => list.push(stepCommand(sim, st)));
      return { id: rt.id, label: rt.chooserName, steps: rt.steps, command: seq(sim, 'Auto: ' + rt.chooserName, list) };
    });
    // Autos made in the PathPlanner app, run like PathPlannerAuto does.
    if (M.autos.usePP) {
      M.ppAutos.forEach((a) => {
        const list = [];
        const first = a.paths.map((n) => M.paths.find((p) => p.name === n)).find(Boolean);
        if (a.resetOdom && a.paths.length) {
          list.push(runOnce('Reset odometry', [], () => {
            if (first && first.name === a.paths[0]) placeAtPathStart(sim, first.data);
            else sim.note(`"${a.name}" starts on "${a.paths[0]}", which wasn't imported, so the robot stays put.`);
          }));
        }
        const body = ppCommand(sim, a.data.command);
        if (body) list.push(body);
        sim.autos.push({ id: 'pp:' + a.id, label: a.name, pp: true, steps: [], ppPaths: a.paths, command: seq(sim, 'PathPlanner: ' + a.name, list) });
      });
    }
  }

  /* ================================================================ controller inputs */

  /** Buttons and sticks from the keyboard, the on-screen buttons and real gamepads. */
  function makeInput() {
    const held = new Map();     // "ctlId|button" -> Set of sources
    const axes = new Map();     // ctlId -> {source: {lx, ly, rx, ry}}
    const rumbles = new Map();  // ctlId -> {strength, until}
    const key = (ctl, b) => (ctl.id || ctl) + '|' + b;
    const me = {
      onRumble: null,
      set(ctl, button, source, on) {
        const k = key(ctl, button);
        if (!held.has(k)) held.set(k, new Set());
        if (on) held.get(k).add(source); else held.get(k).delete(source);
      },
      clearSource(source) { held.forEach((set) => set.delete(source)); axes.forEach((m) => delete m[source]); },
      pressed(ctl, button) { const s = held.get(key(ctl, button)); return !!s && s.size > 0; },
      setAxes(ctl, source, values) {
        const id = ctl.id || ctl;
        if (!axes.has(id)) axes.set(id, {});
        axes.get(id)[source] = values;
      },
      sticks(ctl) {
        const out = { lx: 0, ly: 0, rx: 0, ry: 0 };
        const all = axes.get(ctl.id) || {};
        Object.values(all).forEach((v) => {
          ['lx', 'ly', 'rx', 'ry'].forEach((k) => { if (Math.abs(v[k] || 0) > Math.abs(out[k])) out[k] = v[k]; });
        });
        return out;
      },
      rumble(ctl, strength, seconds) {
        rumbles.set(ctl.id, { strength });
        if (me.onRumble) me.onRumble(ctl, strength, seconds);
      },
      rumbleOf(ctl) { const r = rumbles.get(ctl.id); return r ? r.strength : 0; },
    };
    return me;
  }

  /* ================================================================ the simulator */

  function create(robot) {
    const model = G.buildModel(robot);
    const sim = {
      model, t: 0, modeStart: 0, enabled: false, mode: 'disabled', alliance: 'blue',
      log: [], mechs: new Map(), lights: new Map(), autos: [], autoId: null, autoCmd: null, speedScale: () => 1, error: null,
    };
    sim.note = (text) => {
      const last = sim.log[sim.log.length - 1];
      if (last && last.text === text && sim.t - last.t < 1) return;
      sim.log.push({ t: sim.t, text });
      if (sim.log.length > 40) sim.log.shift();
    };
    model.subsystems.forEach((sub) => {
      let me = null;
      if (sub.preset === 'elevator' || sub.preset === 'arm') me = positionMech(sim, sub);
      else if (sub.preset === 'flywheel') me = flywheelMech(sim, sub);
      else if (sub.preset === 'roller' || sub.preset === 'climber') me = openLoopMech(sim, sub);
      else if (sub.preset === 'piston') me = pistonMech(sim, sub);
      if (me) sim.mechs.set(sub.id, me);
    });
    model.lights.forEach((lt) => sim.lights.set(lt.id, lightState(sim, lt)));
    sim.hasDrive = !!model.driveCtl;
    sim.drive = makeDrive(sim);
    sim.drive.home();
    sim.vision = makeVision(sim);
    sim.input = makeInput();
    sim.sched = makeScheduler(sim);
    buildProgram(sim);
    const def = model.autos.defaultRoutine;
    sim.autoId = def ? def.id : null;

    sim.setMode = (mode) => {
      if (mode === sim.mode) {
        if (mode !== 'auto') return;
      }
      if (sim.autoCmd) { sim.sched.cancel(sim.autoCmd); sim.autoCmd = null; }
      sim.mode = mode;
      sim.enabled = mode !== 'disabled';
      sim.modeStart = sim.t;
      if (mode === 'auto') {
        const a = sim.autos.find((x) => x.id === sim.autoId);
        if (a) { sim.autoCmd = a.command; sim.sched.schedule(a.command); sim.note(`Auto started: ${a.label}.`); } else sim.note('No auto picked, so the robot sits still.');
      }
      if (mode === 'teleop') sim.note('Teleop enabled.');
      if (mode === 'disabled') sim.note('Disabled.');
    };
    sim.setAlliance = (a) => { sim.alliance = a === 'red' ? 'red' : 'blue'; };
    sim.selectAuto = (id) => { sim.autoId = id || null; };
    /** The imported paths in the picked auto, for drawing before it runs. */
    sim.autoPaths = () => {
      const a = sim.autos.find((x) => x.id === sim.autoId);
      if (!a) return [];
      if (a.pp) return a.ppPaths.map((n) => model.paths.find((p) => p.name === n)).filter(Boolean).map((p) => ({ data: p.data, spots: [] }));
      return a.steps.filter((s) => s.type === 'path' && s.path).map((s) => ({ data: s.path.data, spots: s.spots }));
    };
    sim.autoStep = () => {
      if (!sim.autoCmd || !sim.sched.isScheduled(sim.autoCmd)) return null;
      return sim.autoCmd.step;
    };
    sim.step = () => {
      if (sim.error) return;
      try {
        sim.vision.update();
        sim.sched.run();
        sim.mechs.forEach((me) => me.periodic());
        const dt = LOOP / SUBSTEPS;
        for (let n = 0; n < SUBSTEPS; n++) sim.mechs.forEach((me) => me.step(dt));
        if (sim.hasDrive) sim.drive.step(LOOP);
        sim.t = Math.round((sim.t + LOOP) * 1000) / 1000;
        if (sim.autoCmd && !sim.sched.isScheduled(sim.autoCmd)) { sim.note('Auto finished.'); sim.autoCmd = null; }
      } catch (err) {
        sim.error = err;
        sim.note('The simulator stopped: ' + (err && err.message ? err.message : err));
      }
    };
    sim.run = (seconds) => { const n = Math.round(seconds / LOOP); for (let i = 0; i < n; i++) sim.step(); };
    sim.reset = () => {
      sim.setMode('disabled');
      sim.drive.home();
    };
    return sim;
  }

  /* ================================================================ the page */

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    kids.flat(Infinity).forEach((k) => { if (k != null && k !== false) e.append(k.nodeType ? k : String(k)); });
    return e;
  }

  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'R', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'I', 'K', 'O', 'L', 'P'];
  const PAD = {
    xbox: { a: 0, b: 1, x: 2, y: 3, leftBumper: 4, rightBumper: 5, leftTrigger: 6, rightTrigger: 7, back: 8, start: 9, leftStick: 10, rightStick: 11 },
    ps: { cross: 0, circle: 1, square: 2, triangle: 3, L1: 4, R1: 5, L2: 6, R2: 7, share: 8, create: 8, options: 9, L3: 10, R3: 11, PS: 16, touchpad: 17 },
    dpad: { povUp: 12, povDown: 13, povLeft: 14, povRight: 15 },
  };
  function padIndex(type, button) {
    if (PAD.dpad[button] != null) return PAD.dpad[button];
    if (type === 'joystick') { const m = /^button(\d+)$/.exec(button); return m ? +m[1] - 1 : -1; }
    const map = type === 'xbox' ? PAD.xbox : PAD.ps;
    return map[button] != null ? map[button] : -1;
  }
  const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d == null ? 1 : d) : '–');

  /**
   * Shows the simulator inside `host`. Returns { destroy() }.
   * opts.onNavigate(sel) lets the empty-state links jump to other pages.
   */
  function mount(host, robot, opts) {
    const o = opts || {};
    let sim = create(robot);
    const M = () => sim.model;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let destroyed = false;
    const keyMap = new Map();      // keyboard key -> [ctl, button]
    const driveKeys = new Set();

    // ---------- layout
    const modeBtns = {};
    const modeSeg = el('div', { class: 'seg sim-modes', role: 'group', 'aria-label': 'Robot mode' },
      [['disabled', 'Disabled'], ['auto', 'Auto'], ['teleop', 'Teleop']].map(([k, label]) => {
        modeBtns[k] = el('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', onclick: () => { sim.setMode(k); syncBar(); } }, label);
        return modeBtns[k];
      }));
    const autoSelect = el('select', { 'aria-label': 'Auto to run', onchange: (e) => sim.selectAuto(e.target.value) });
    const allianceBtns = {};
    const allianceSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Alliance' },
      [['blue', 'Blue'], ['red', 'Red']].map(([k, label]) => {
        allianceBtns[k] = el('button', { type: 'button', class: 'seg-btn alliance-' + k, 'aria-pressed': 'false', onclick: () => { sim.setAlliance(k); if (!sim.enabled) sim.drive.home(); syncBar(); } }, label);
        return allianceBtns[k];
      }));
    const clock = el('span', { class: 'sim-clock', 'aria-live': 'off' }, '0.0 s');
    const bar = el('div', { class: 'sim-bar' },
      modeSeg,
      el('label', { class: 'sim-auto' }, el('span', null, 'Auto'), autoSelect),
      allianceSeg,
      clock,
      el('button', { type: 'button', class: 'btn small', onclick: () => { restart(); } }, 'Restart'));

    const fieldCanvas = el('canvas', { class: 'sim-field', role: 'img', 'aria-label': 'Field view: the robot on the 2026 field with its AprilTags' });
    const fieldWrap = el('div', { class: 'sim-field-wrap' }, fieldCanvas);
    const fieldNote = el('p', { class: 'sim-hint' }, 'Click the field to move the robot. Shift+click to turn it toward that spot.');
    const driveReadout = el('div', { class: 'sim-readout' });
    const ctlPanel = el('div', { class: 'sim-panel-body' });
    const cmdList = el('ul', { class: 'sim-cmds' });
    const visionBody = el('div', { class: 'sim-panel-body' });
    const logList = el('ol', { class: 'sim-log' });
    const mechGrid = el('div', { class: 'sim-mechs' });

    const fieldCol = el('div', { class: 'sim-field-col' }, fieldWrap, fieldNote, driveReadout);
    const visionPanel = el('section', { class: 'sim-panel' }, el('h4', null, 'AprilTags'), visionBody);
    const side = el('div', { class: 'sim-side' },
      el('section', { class: 'sim-panel' }, el('h4', null, 'Controls'), ctlPanel),
      visionPanel,
      el('section', { class: 'sim-panel' }, el('h4', null, 'Running commands'), cmdList),
      el('section', { class: 'sim-panel' }, el('h4', null, 'What happened'), logList));
    const main = el('div', { class: 'sim-main' }, fieldCol, side);
    const root = el('div', { class: 'sim' },
      el('div', { class: 'ed-head' },
        el('div', { class: 'ed-kicker' }, 'Test drive'),
        el('h1', { class: 'ed-title' }, 'Simulator'),
        el('p', { class: 'ed-blurb' }, 'Runs your robot\'s code right here: buttons, combos, autos, lights and AprilTag zones. Pick Teleop and drive with the keyboard, the buttons below or a gamepad. The physics are simple, so use it to check what happens, not to tune gains.')),
      bar, main,
      el('h3', { class: 'sim-sub' }, 'Mechanisms'),
      mechGrid);
    host.replaceChildren(root);

    // ---------- pieces that depend on the robot
    let mechViews = [];
    function buildForRobot() {
      const mine = sim.autos.filter((a) => !a.pp);
      const pp = sim.autos.filter((a) => a.pp);
      const option = (a) => el('option', { value: a.id }, a.label);
      // replaceChildren() takes nodes, not arrays, so build the flat list first.
      const choices = [el('option', { value: '' }, 'None')];
      if (pp.length) choices.push(el('optgroup', { label: 'Robot Code Builder' }, mine.map(option)), el('optgroup', { label: 'PathPlanner autos' }, pp.map(option)));
      else choices.push(...mine.map(option));
      autoSelect.replaceChildren(...choices);
      autoSelect.value = sim.autoId || '';
      autoSelect.disabled = !sim.autos.length;
      fieldCol.hidden = !sim.hasDrive;
      visionPanel.hidden = !sim.model.vision;
      main.classList.toggle('no-field', !sim.hasDrive);
      buildControls();
      buildMechs();
      syncBar();
    }

    function buildControls() {
      keyMap.clear();
      const rows = [];
      let keyIdx = 0;
      const dc = M().driveCtl;
      const dr = M().drive;
      M().controllers.forEach((ctl) => {
        const uses = new Map();
        const addUse = (button, text) => { if (!uses.has(button)) uses.set(button, []); uses.get(button).push(text); };
        if (dc && dc.id === ctl.id) {
          if (dr.resetButton !== 'none') addUse(dr.resetButton, 'Reset field heading');
          if (dr.brakeButton !== 'none') addUse(dr.brakeButton, 'Lock the wheels (while held)');
          if (dr.slowButton !== 'none') addUse(dr.slowButton, `Slow mode, ${Math.round(num(dr.slowPct, 40))}% (while held)`);
          if (M().vision && dr.aimButton !== 'none') addUse(dr.aimButton, 'Turn to face the tag (while held)');
        }
        M().bindings.filter((bd) => bd.ctl.id === ctl.id).forEach((bd) => {
          addUse(bd.button, `${bd.target.label}: ${bd.action.label}${bd.when === 'held' ? '' : ' (' + G.WHEN[bd.when].label + ')'}`);
        });
        const label = (b) => ((G.BUTTONS[ctl.type] || []).find((x) => x[0] === b) || [b, b])[1];
        const btns = Array.from(uses.entries()).map(([button, texts]) => {
          const k = KEYS[keyIdx++];
          if (k) keyMap.set(k, [ctl, button]);
          const b = el('button', { type: 'button', class: 'sim-btn', 'aria-pressed': 'false', 'data-ctl': ctl.id, 'data-button': button },
            k ? el('kbd', null, k) : el('span'),
            el('span', { class: 'sim-btn-name' }, label(button)),
            el('span', { class: 'sim-btn-does' }, texts.join(' · ')));
          const press = (on) => (e) => {
            if (on) { try { b.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
            sim.input.set(ctl, button, 'pointer', on);
          };
          b.addEventListener('pointerdown', press(true));
          b.addEventListener('pointerup', press(false));
          b.addEventListener('pointercancel', press(false));
          b.addEventListener('lostpointercapture', press(false));
          b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sim.input.set(ctl, button, 'focus', true); } });
          b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sim.input.set(ctl, button, 'focus', false); } });
          b.addEventListener('blur', () => sim.input.set(ctl, button, 'focus', false));
          return b;
        });
        const typeLabel = (G.CONTROLLER_TYPES[ctl.type] || { label: ctl.type }).label;
        const isDrive = dc && dc.id === ctl.id;
        rows.push(el('div', { class: 'sim-ctl', 'data-ctl': ctl.id },
          el('div', { class: 'sim-ctl-head' },
            el('strong', null, ctl.label), el('span', { class: 'muted' }, `${typeLabel}, port ${ctl.port}`),
            el('span', { class: 'sim-rumble', hidden: true }, 'Rumbling'),
            el('span', { class: 'sim-pad', hidden: true }, 'Gamepad')),
          isDrive ? el('div', { class: 'sim-sticks' },
            el('canvas', { class: 'sim-stick', width: 44, height: 44, 'data-stick': 'left', 'aria-hidden': 'true' }),
            el('canvas', { class: 'sim-stick', width: 44, height: 44, 'data-stick': 'right', 'aria-hidden': 'true' }),
            el('span', { class: 'muted' }, el('kbd', null, 'W'), el('kbd', null, 'A'), el('kbd', null, 'S'), el('kbd', null, 'D'), ' drive  ',
              el('kbd', null, 'Q'), el('kbd', null, 'E'), ' turn')) : null,
          btns.length ? el('div', { class: 'sim-btns' }, btns) : el('p', { class: 'muted small' }, 'No buttons on this controller yet.')));
      });
      if (!rows.length) rows.push(el('p', { class: 'muted small' }, 'No controllers. Add one under Controls.'));
      rows.push(el('p', { class: 'muted small' }, el('kbd', null, 'Space'), ' or ', el('kbd', null, 'Enter'), ' disables the robot, like the Driver Station. A plugged-in gamepad drives the first controller.'));
      ctlPanel.replaceChildren(...rows);
    }

    function buildMechs() {
      mechViews = [];
      const cards = [];
      sim.model.subsystems.forEach((sub) => {
        const me = sim.mechs.get(sub.id);
        if (!me) return;
        const cv = el('canvas', { class: 'sim-mech-canvas', width: 150, height: 120, role: 'img', 'aria-label': sub.label });
        const read = el('div', { class: 'sim-mech-read' });
        const extra = [];
        if (me.hasSensor) {
          const toggle = el('button', { type: 'button', class: 'btn small', onclick: () => { me.hasPiece = !me.hasPiece; } }, 'Give it a game piece');
          const auto = el('label', { class: 'check small' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => { me.autoFeed = e.target.checked; } }),
            el('span', null, 'Picks one up after intaking for ½ s'));
          extra.push(el('div', { class: 'sim-mech-extra' }, toggle, auto));
          mechViews.push({ me, cv, read, sub, toggle });
        } else mechViews.push({ me, cv, read, sub });
        cards.push(el('article', { class: 'sim-mech' },
          el('header', null, el('strong', null, sub.label), el('span', { class: 'muted' }, (G.PRESETS[sub.preset] || {}).label || sub.preset)),
          cv, read, extra));
      });
      sim.model.lights.forEach((lt) => {
        const L = sim.lights.get(lt.id);
        const cv = el('canvas', { class: 'sim-led-canvas', width: 300, height: 26, role: 'img', 'aria-label': lt.label + ' LEDs' });
        const read = el('div', { class: 'sim-mech-read' });
        mechViews.push({ light: L, cv, read, lt });
        cards.push(el('article', { class: 'sim-mech sim-led' },
          el('header', null, el('strong', null, lt.label), el('span', { class: 'muted' }, (G.LIGHT_TYPES[lt.type] || {}).label || 'LEDs')),
          cv, read));
      });
      if (!cards.length) cards.push(el('p', { class: 'muted' }, 'No subsystems or lights yet. Add some on the left and they show up here.'));
      mechGrid.replaceChildren(...cards);
    }

    function syncBar() {
      Object.entries(modeBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(sim.mode === k)));
      Object.entries(allianceBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(sim.alliance === k)));
      root.dataset.mode = sim.mode;
    }

    function restart() {
      const alliance = sim.alliance;
      const autoId = sim.autoId;
      sim = create(robot);
      sim.setAlliance(alliance);
      if (sim.autos.some((a) => a.id === autoId)) sim.autoId = autoId;
      sim.drive.home();
      wireRumble();
      buildForRobot();
    }

    // ---------- keyboard
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const driveAxes = () => {
      const k = (c) => (driveKeys.has(c) ? 1 : 0);
      const dc = M().driveCtl;
      if (!dc) return;
      sim.input.setAxes(dc, 'keys', {
        ly: k('KeyS') + k('ArrowDown') - k('KeyW') - k('ArrowUp'),
        lx: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft'),
        rx: k('KeyE') - k('KeyQ'),
        ry: 0,
      });
    };
    const DRIVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    function onKeyDown(e) {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') {
        if (e.target && e.target.tagName === 'BUTTON' && host.contains(e.target)) return;
        e.preventDefault();
        sim.setMode('disabled');
        syncBar();
        return;
      }
      if (DRIVE_CODES.has(e.code)) { e.preventDefault(); driveKeys.add(e.code); driveAxes(); return; }
      const k = e.key.length === 1 ? e.key.toUpperCase() : null;
      const hit = k && keyMap.get(k);
      if (hit) { e.preventDefault(); if (!e.repeat) sim.input.set(hit[0], hit[1], 'key', true); }
    }
    function onKeyUp(e) {
      if (DRIVE_CODES.has(e.code)) { driveKeys.delete(e.code); driveAxes(); return; }
      const k = e.key.length === 1 ? e.key.toUpperCase() : null;
      const hit = k && keyMap.get(k);
      if (hit) sim.input.set(hit[0], hit[1], 'key', false);
    }
    function onBlur() { driveKeys.clear(); driveAxes(); sim.input.clearSource('key'); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // ---------- field clicks
    fieldCanvas.addEventListener('pointerdown', (e) => {
      if (!sim.hasDrive) return;
      const r = fieldCanvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * FIELD_L;
      const y = (1 - (e.clientY - r.top) / r.height) * FIELD_W;
      const D = sim.drive;
      if (e.shiftKey) D.th = Math.atan2(y - D.y, x - D.x);
      else D.place(x, y);
    });

    // ---------- gamepads and rumble
    const pads = { connected: [] };
    function pollPads() {
      let list = [];
      try { list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; } catch (err) { list = []; }
      pads.connected = list;
      const ctls = M().controllers;
      sim.input.clearSource('pad');
      list.forEach((pad, i) => {
        const ctl = ctls[i];
        if (!ctl) return;
        const b = (n) => !!(pad.buttons[n] && (pad.buttons[n].pressed || pad.buttons[n].value > 0.5));
        const names = (G.BUTTONS[ctl.type] || []).map((x) => x[0]);
        names.forEach((name) => { const idx = padIndex(ctl.type, name); if (idx >= 0 && b(idx)) sim.input.set(ctl, name, 'pad', true); });
        const ax = (n) => { const v = pad.axes[n] || 0; return Math.abs(v) < 0.08 ? 0 : v; };
        sim.input.setAxes(ctl, 'pad', ctl.type === 'joystick'
          ? { lx: ax(0), ly: ax(1), rx: ax(2), ry: 0 }
          : { lx: ax(0), ly: ax(1), rx: ax(2), ry: ax(3) });
      });
    }
    function wireRumble() {
      sim.input.onRumble = (ctl, strength, seconds) => {
        const i = M().controllers.indexOf(ctl);
        const pad = pads.connected[i];
        if (!pad || !pad.vibrationActuator || !strength) return;
        try {
          pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: Math.round(seconds * 1000), weakMagnitude: strength, strongMagnitude: strength });
        } catch (err) { /* not supported */ }
      };
    }
    wireRumble();

    // ---------- drawing
    const css = (name) => getComputedStyle(root).getPropertyValue(name).trim() || '#888';
    function colors() {
      return {
        ink: css('--ink'), muted: css('--muted'), line: css('--line'), lineStrong: css('--line-strong'), panel: css('--panel'),
        sunken: css('--sunken'), accent: css('--accent'), ok: css('--ok'), warn: css('--warn'), err: css('--err'), info: css('--info'),
      };
    }
    function fit(cv, w, h) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function drawField(col) {
      const w = fieldWrap.clientWidth;
      if (!w) return;
      const h = (w * FIELD_W) / FIELD_L;
      fieldCanvas.style.height = h + 'px';
      const ctx = fit(fieldCanvas, w, h);
      const s = w / FIELD_L;
      const X = (x) => x * s;
      const Y = (y) => h - y * s;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = col.sunken;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = rgba(ALLIANCE.blue, 0.1);
      ctx.fillRect(0, 0, X(4.03), h);
      ctx.fillStyle = rgba(ALLIANCE.red, 0.1);
      ctx.fillRect(X(FIELD_L - 4.03), 0, X(4.03), h);
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(FIELD_L / 2), 0); ctx.lineTo(X(FIELD_L / 2), h); ctx.stroke();
      ctx.strokeStyle = col.lineStrong;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

      const V = M().vision;
      const D = sim.drive;
      if (V) {
        // Each zone is one shape: the circles around its tags, filled together so overlaps stay even.
        V.zones.forEach((z) => {
          const inside = sim.vision.inZone(z);
          ctx.fillStyle = inside ? 'rgba(240,170,40,0.30)' : 'rgba(240,170,40,0.14)';
          ctx.beginPath();
          z.ids.forEach((id) => {
            const t = TAG_BY_ID.get(id);
            if (!t) return;
            ctx.moveTo(X(t.x) + z.distance * s, Y(t.y));
            ctx.arc(X(t.x), Y(t.y), z.distance * s, 0, TAU);
          });
          ctx.fill('nonzero');
        });
      }
      // AprilTags: a bar with a tick out of the face
      const seen = new Set(sim.vision.seen.map((x) => x.tag.id));
      TAGS.forEach((t) => {
        const cx = X(t.x);
        const cy = Y(t.y);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-t.yaw);
        ctx.fillStyle = seen.has(t.id) ? col.accent : col.ink;
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(2, -1, 4, 2);
        ctx.restore();
        if (s > 34) {
          ctx.fillStyle = col.muted;
          ctx.font = '600 9px ' + getComputedStyle(root).fontFamily;
          ctx.textAlign = 'center';
          const [ox, oy] = rot(0.32, 0, t.yaw);
          ctx.fillText(String(t.id), cx + ox * s, cy - oy * s + 3);
        }
      });
      if (!sim.hasDrive) return;
      // PathPlanner paths: the one being driven, or the picked auto's paths before it runs
      const drawPathLine = (data, flip, width, color, dash) => {
        const pts = G.PathGeom.sample(data, 0.01);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.setLineDash(dash || []);
        ctx.beginPath();
        pts.forEach((p, i) => {
          const q = flip ? flipPose({ x: p.x, y: p.y, deg: 0 }) : p;
          if (i) ctx.lineTo(X(q.x), Y(q.y)); else ctx.moveTo(X(q.x), Y(q.y));
        });
        ctx.stroke();
        ctx.setLineDash([]);
      };
      const drawSpotDots = (data, spots, flip) => arr(spots).forEach((sp) => {
        const p = G.PathGeom.pointAt(data, Number(sp.pos) || 0);
        const q = flip ? flipPose({ x: p.x, y: p.y, deg: 0 }) : p;
        ctx.fillStyle = sp.kind === 'stop' ? col.err : col.info;
        ctx.beginPath(); ctx.arc(X(q.x), Y(q.y), 4.5, 0, TAU); ctx.fill();
      });
      if (D.showPath) {
        drawPathLine(D.showPath.data, D.showPath.flip, 3, 'rgba(201,74,12,0.55)');
        drawSpotDots(D.showPath.data, D.showPath.spots, D.showPath.flip);
      } else if (!sim.enabled) {
        sim.autoPaths().forEach((p) => {
          drawPathLine(p.data, sim.alliance === 'red', 2, 'rgba(128,128,128,0.75)', [6, 5]);
          drawSpotDots(p.data, p.spots, sim.alliance === 'red');
        });
      }
      // camera view and target line
      if (V && sim.vision.primary) {
        const t = sim.vision.primary.tag;
        ctx.strokeStyle = col.accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X(D.x), Y(D.y)); ctx.lineTo(X(t.x), Y(t.y)); ctx.stroke();
      }
      if (V) {
        const aim = V.cameras[V.aimIdx] || V.cameras[0];
        const yaw = D.th + (aim && /back|rear/i.test(aim.name) ? Math.PI : 0);
        ctx.fillStyle = 'rgba(128,128,128,0.08)';
        ctx.beginPath();
        ctx.moveTo(X(D.x), Y(D.y));
        ctx.arc(X(D.x), Y(D.y), CAMERA_RANGE * s, -(yaw + CAMERA_HALF_FOV * DEG), -(yaw - CAMERA_HALF_FOV * DEG));
        ctx.closePath();
        ctx.fill();
      }
      if (D.alignTarget) {
        const T = D.alignTarget;
        ctx.save();
        ctx.translate(X(T.x), Y(T.y));
        ctx.rotate(-T.heading);
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = col.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect((-ROBOT / 2) * s, (-ROBOT / 2) * s, ROBOT * s, ROBOT * s);
        ctx.restore();
      }
      // robot
      const team = ALLIANCE[sim.alliance];
      ctx.save();
      ctx.translate(X(D.x), Y(D.y));
      ctx.rotate(-D.th);
      const r = (ROBOT / 2) * s;
      ctx.fillStyle = col.panel;
      ctx.strokeStyle = rgba(team, 1);
      ctx.lineWidth = Math.max(3, 0.08 * s);
      ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.strokeRect(-r, -r, 2 * r, 2 * r);
      ctx.fillStyle = col.ink;
      ctx.beginPath();
      ctx.moveTo(r * 0.75, 0); ctx.lineTo(-r * 0.25, -r * 0.45); ctx.lineTo(-r * 0.25, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // where the robot thinks "forward" is, if the heading was reset at an angle
      if (Math.abs(D.offset) > 0.05) {
        const [hx, hy] = rot(ROBOT * 0.9, 0, D.estHeading);
        ctx.strokeStyle = col.warn;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(X(D.x), Y(D.y)); ctx.lineTo(X(D.x + hx), Y(D.y + hy)); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    function drawStick(cv, x, y, col) {
      const ctx = fit(cv, 44, 44);
      ctx.clearRect(0, 0, 44, 44);
      ctx.strokeStyle = col.lineStrong;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(22, 22, 19, 0, TAU); ctx.stroke();
      ctx.fillStyle = Math.hypot(x, y) > 0.05 ? col.accent : col.muted;
      ctx.beginPath(); ctx.arc(22 + x * 13, 22 + y * 13, 6, 0, TAU); ctx.fill();
    }

    function drawMech(v, col) {
      const { me, cv } = v;
      const ctx = fit(cv, 150, 120);
      ctx.clearRect(0, 0, 150, 120);
      ctx.lineCap = 'round';
      const sub = v.sub;
      if (me.kind === 'elevator') {
        const frac = clamp(me.position / me.max, 0, 1);
        const tfrac = clamp(me.target / me.max, 0, 1);
        const top = 10; const bottom = 108; const span = bottom - top - 16;
        ctx.strokeStyle = col.lineStrong; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(55, top); ctx.lineTo(55, bottom); ctx.moveTo(95, top); ctx.lineTo(95, bottom); ctx.stroke();
        ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
        const ty = bottom - 8 - tfrac * span;
        ctx.beginPath(); ctx.moveTo(40, ty); ctx.lineTo(110, ty); ctx.stroke(); ctx.setLineDash([]);
        const cy = bottom - 16 - frac * span;
        ctx.fillStyle = me.atTarget() ? col.ok : col.ink;
        ctx.fillRect(48, cy, 54, 16);
      } else if (me.kind === 'arm') {
        const px = 52; const py = 66; const len = 46;
        ctx.strokeStyle = col.line; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, len + 6, -me.max * DEG, -me.min * DEG); ctx.stroke();
        const ta = me.target * DEG;
        ctx.strokeStyle = col.accent; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(ta) * len, py - Math.sin(ta) * len); ctx.stroke(); ctx.setLineDash([]);
        const a = me.position * DEG;
        ctx.strokeStyle = me.atTarget() ? col.ok : col.ink; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * len, py - Math.sin(a) * len); ctx.stroke();
        ctx.fillStyle = col.lineStrong; ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.fill();
      } else if (me.kind === 'flywheel') {
        const cx = 75; const cy = 60; const r = 40;
        ctx.strokeStyle = me.atSpeed() ? col.ok : col.lineStrong; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.strokeStyle = col.ink; ctx.lineWidth = 3;
        for (let n = 0; n < 4; n++) {
          const a = me.angle * 0.02 + (n * Math.PI) / 2;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 6), cy - Math.sin(a) * (r - 6)); ctx.stroke();
        }
        if (me.targetRpm) {
          const frac = clamp(Math.abs(me.rpm) / Math.max(1, Math.abs(me.targetRpm)), 0, 1.2);
          ctx.strokeStyle = col.accent; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx, cy, r + 8, -Math.PI / 2, -Math.PI / 2 + frac * TAU * 0.8333); ctx.stroke();
        }
      } else if (me.kind === 'roller' || me.kind === 'climber') {
        if (me.kind === 'roller') {
          [[48, 60], [102, 60]].forEach(([cx, cy], n) => {
            ctx.strokeStyle = col.ink; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(cx, cy, 20, 0, TAU); ctx.stroke();
            for (let k = 0; k < 3; k++) {
              const a = (n ? -1 : 1) * me.angle * 0.05 + (k * TAU) / 3;
              ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 17, cy - Math.sin(a) * 17); ctx.stroke();
            }
          });
          if (me.hasPiece) { ctx.fillStyle = '#f08a24'; ctx.beginPath(); ctx.arc(75, 60, 13, 0, TAU); ctx.fill(); }
          if (me.hasSensor) {
            ctx.fillStyle = me.hasPiece ? col.ok : col.line;
            ctx.beginPath(); ctx.arc(75, 102, 5, 0, TAU); ctx.fill();
          }
        } else {
          const lo = me.soft ? me.soft.min : 0;
          const hi = me.soft ? me.soft.max : 100;
          const frac = clamp((me.position - lo) / Math.max(1e-6, hi - lo), 0, 1);
          ctx.strokeStyle = col.lineStrong; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.moveTo(75, 10); ctx.lineTo(75, 110); ctx.stroke();
          const y = 104 - frac * 88;
          ctx.strokeStyle = col.ink; ctx.lineWidth = 5;
          ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(90, y); ctx.lineTo(90, y - 12); ctx.stroke();
        }
      } else if (me.kind === 'piston') {
        ctx.fillStyle = col.lineStrong; ctx.fillRect(18, 48, 60, 24);
        const rod = 10 + me.travel * 50;
        ctx.fillStyle = col.ink; ctx.fillRect(78, 56, rod, 8);
        ctx.fillRect(78 + rod, 46, 8, 28);
      }
      // readouts
      const lines = [];
      if (me.kind === 'elevator' || me.kind === 'arm') {
        lines.push([`${fmt(me.position)}${me.unit}`, `target ${fmt(me.target)}${me.unit}`]);
        lines.push([me.atTarget() ? 'At target' : me.stuckT > 1 ? 'Stuck short of the target' : 'Moving', `${fmt(me.amps, 0)} A`]);
        if (me.stuckT > 1) lines.push(['Try a bigger kG (or kP) under Tuning.', '', 'warn']);
      } else if (me.kind === 'flywheel') {
        lines.push([`${fmt(me.rpm, 0)} RPM`, `target ${fmt(me.targetRpm, 0)}`]);
        lines.push([me.atSpeed() ? 'At speed' : me.targetRpm ? 'Spinning up' : 'Stopped', `${fmt(me.amps, 0)} A`]);
      } else if (me.kind === 'roller') {
        lines.push([`${Math.round(me.out * 100)}% power`, me.hasSensor ? (me.hasPiece ? 'Has a game piece' : 'Empty') : '']);
      } else if (me.kind === 'climber') {
        lines.push([`${fmt(me.position)} rot`, `${Math.round(me.out * 100)}% power`]);
      } else if (me.kind === 'piston') {
        lines.push([me.extended ? (sub.src.extendName || 'Extended') : (sub.src.retractName || 'Retracted'), '']);
      }
      v.read.replaceChildren(...lines.map(([a, b, tone]) => el('div', { class: tone || null }, el('span', null, a), el('span', { class: 'muted' }, b))));
      if (v.toggle) v.toggle.textContent = me.hasPiece ? 'Take the game piece out' : 'Give it a game piece';
    }

    function drawLeds(v) {
      const L = v.light;
      const w = Math.max(120, v.cv.clientWidth || 300);
      const ctx = fit(v.cv, w, 26);
      ctx.clearRect(0, 0, w, 26);
      const n = 24;
      const step = w / n;
      for (let i = 0; i < n; i++) {
        const c = L.rgb(i, n, sim.t);
        const lit = c[0] + c[1] + c[2] > 0;
        ctx.fillStyle = lit ? `rgb(${c[0]},${c[1]},${c[2]})` : 'rgba(128,128,128,0.25)';
        ctx.beginPath(); ctx.arc(step * (i + 0.5), 13, Math.min(8, step * 0.38), 0, TAU); ctx.fill();
      }
      const what = { solid: 'Solid', strobe: 'Flashing', rainbow: 'Rainbow', alliance: 'Alliance color', off: 'Off' }[L.pattern] || L.pattern;
      const colName = (G.LED_COLORS.find((c) => c[0] === L.color) || [null, ''])[1];
      v.read.replaceChildren(el('div', null, el('span', null, what + (L.pattern === 'solid' || L.pattern === 'strobe' ? ' ' + colName.toLowerCase() : '')), el('span')));
    }

    let lastSlow = 0;
    function render() {
      const col = colors();
      clock.textContent = `${sim.mode === 'disabled' ? 'Disabled' : sim.mode === 'auto' ? 'Auto' : 'Teleop'} ${fmt(sim.t - sim.modeStart, 1)} s`;
      if (sim.hasDrive) {
        drawField(col);
        const D = sim.drive;
        const speed = Math.hypot(D.vx, D.vy);
        const scale = sim.speedScale();
        driveReadout.replaceChildren(...[
          el('span', null, `x ${fmt(D.x, 2)} m · y ${fmt(D.y, 2)} m · facing ${fmt(D.th / DEG, 0)}°`),
          el('span', null, `${fmt(speed, 1)} m/s`),
          D.showPath ? el('span', { class: 'warn' }, `${D.path ? 'on' : 'stopped on'} "${D.showPath.name}" at ${fmt(D.pathPos, 2)}`) : null,
          el('span', { class: scale < 0.999 ? 'warn' : 'muted' }, `drive speed ${Math.round(scale * 100)}%`)].filter(Boolean));
        root.querySelectorAll('.sim-stick').forEach((cv) => {
          const st = sim.input.sticks(M().driveCtl);
          if (cv.dataset.stick === 'left') drawStick(cv, st.lx, st.ly, col); else drawStick(cv, st.rx, st.ry, col);
        });
      }
      // controller state
      root.querySelectorAll('.sim-btn').forEach((b) => {
        const ctl = M().controllers.find((c) => c.id === b.dataset.ctl);
        if (ctl) b.setAttribute('aria-pressed', String(sim.input.pressed(ctl, b.dataset.button)));
      });
      root.querySelectorAll('.sim-ctl').forEach((box) => {
        const idx = M().controllers.findIndex((c) => c.id === box.dataset.ctl);
        const ctl = M().controllers[idx];
        const rumbling = ctl && sim.input.rumbleOf(ctl) > 0;
        box.querySelector('.sim-rumble').hidden = !rumbling;
        box.classList.toggle('rumbling', !!rumbling);
        box.querySelector('.sim-pad').hidden = !pads.connected[idx];
      });
      // vision
      const V = M().vision;
      if (V) {
        const P = sim.vision.primary;
        const rows = [el('div', { class: 'sim-kv' }, el('span', null, 'Sees'),
          el('span', null, P ? `tag ${P.tag.id}, ${fmt(P.dist, 1)} m, tx ${fmt(P.tx, 1)}°` : 'no tag'))];
        rows.push(el('div', { class: 'sim-kv' }, el('span', null, 'Aimed'), el('span', null, sim.vision.isAimed() ? 'yes' : 'no')));
        V.zones.forEach((z) => {
          const inside = sim.vision.inZone(z);
          rows.push(el('div', { class: 'sim-kv' + (inside ? ' on' : '') }, el('span', null, z.label),
            el('span', null, `${inside ? 'inside' : 'outside'} · ${fmt(sim.vision.distanceTo(z.ids), 1)} m`)));
        });
        V.tables.forEach((tb) => {
          rows.push(el('div', { class: 'sim-kv' }, el('span', null, tb.label),
            el('span', null, `${fmt(sim.vision.tableValue(tb), tb.unit === 'RPM' ? 0 : 1)} ${tb.unit} at ${fmt(sim.vision.distanceTo(tb.ids), 1)} m`)));
        });
        if (!V.zones.length && !V.tables.length) rows.push(el('p', { class: 'muted small' }, 'Add zones and distance tables on the AprilTags page.'));
        visionBody.replaceChildren(...rows);
      }
      // commands
      const running = sim.sched.running.filter((c) => !c.inner || !sim.sched.isScheduled(c.inner));
      cmdList.replaceChildren(...(running.length ? running.map((c) => el('li', { class: sim.sched.isDefault(c) ? 'muted' : '' },
        c.name, sim.sched.isDefault(c) ? ' (default)' : '')) : [el('li', { class: 'muted' }, 'Nothing running')]));
      // log
      const recent = sim.log.slice(-6).reverse();
      logList.replaceChildren(...(recent.length ? recent.map((x) => el('li', null, el('span', { class: 'muted' }, fmt(x.t, 1) + ' s'), ' ', x.text))
        : [el('li', { class: 'muted' }, 'Pick a mode above to start.')]));
      mechViews.forEach((v) => (v.light ? drawLeds(v) : drawMech(v, col)));
      lastSlow = sim.t;
    }

    function frame(now) {
      if (destroyed) return;
      if (!last) last = now;
      acc = Math.min(0.25, acc + (now - last) / 1000);
      last = now;
      pollPads();
      let n = 0;
      while (acc >= LOOP && n < 8) { sim.step(); acc -= LOOP; n++; }
      render();
      raf = requestAnimationFrame(frame);
    }

    buildForRobot();
    if (o.autoId && sim.autos.some((a) => a.id === o.autoId)) {
      sim.autoId = o.autoId;
      autoSelect.value = o.autoId;
      if (o.start) { sim.setMode('auto'); syncBar(); }
    }
    raf = requestAnimationFrame(frame);

    return {
      get sim() { return sim; },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        sim.input.clearSource('key');
      },
    };
  }

  const api = { create, mount, TAGS, FIELD_L, FIELD_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RobotSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
