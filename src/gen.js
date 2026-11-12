/*
 * Robot Code Builder: the code generator.
 *
 * Turns a robot description (plain JSON, the same thing the "Save robot file"
 * button writes) into WPILib command-based Java. There is no DOM code in this
 * file, so the web page and the Node tests run exactly the same generator.
 *
 * Checked against WPILib 2026.2.1, Phoenix 6 26.3.0 and REVLib 2026.0.5.
 */
(function (root) {
  'use strict';

  /* ================================================================ catalogs */

  const LIBS_TEXT = 'WPILib 2026, Phoenix 6 (26.x) and REVLib 2026';

  const MOTORS = {
    // Physics numbers match WPILib's DCMotor (12 V): stall torque N·m, stall and free current A.
    krakenX60: { label: 'Kraken X60', ctrl: 'talonfx', freeRpm: 6000, stator: 80, supply: 40, stallTorque: 7.09, stallCurrent: 366, freeCurrent: 2 },
    krakenX44: { label: 'Kraken X44', ctrl: 'talonfx', freeRpm: 7758, stator: 60, supply: 40, stallTorque: 4.11, stallCurrent: 279, freeCurrent: 2 },
    falcon500: { label: 'Falcon 500', ctrl: 'talonfx', freeRpm: 6380, stator: 80, supply: 40, stallTorque: 4.69, stallCurrent: 257, freeCurrent: 1.5 },
    neo: { label: 'NEO', ctrl: 'sparkmax', freeRpm: 5676, current: 40, stallTorque: 2.6, stallCurrent: 105, freeCurrent: 1.8 },
    neoVortex: { label: 'NEO Vortex', ctrl: 'sparkflex', freeRpm: 6784, current: 50, stallTorque: 3.6, stallCurrent: 211, freeCurrent: 3.6 },
    neo550: { label: 'NEO 550', ctrl: 'sparkmax', freeRpm: 11000, current: 20, stallTorque: 0.97, stallCurrent: 100, freeCurrent: 1.4 },
  };

  const CONTROLLERS = {
    talonfx: { label: 'Talon FX', vendor: 'ctre', cls: 'TalonFX' },
    sparkmax: { label: 'SPARK MAX', vendor: 'rev', cls: 'SparkMax', cfg: 'SparkMaxConfig' },
    sparkflex: { label: 'SPARK Flex', vendor: 'rev', cls: 'SparkFlex', cfg: 'SparkFlexConfig' },
  };

  const PRESETS = {
    roller: { label: 'Roller', defaultName: 'Intake', blurb: 'Intake, indexer, feeder or conveyor that spins at set speeds.' },
    flywheel: { label: 'Shooter', defaultName: 'Shooter', blurb: 'Flywheel that spins up to a set RPM and holds it.' },
    elevator: { label: 'Elevator', defaultName: 'Elevator', blurb: 'Lifts to set heights, measured in inches.' },
    arm: { label: 'Arm', defaultName: 'Arm', blurb: 'Pivot, wrist or arm that moves to set angles.' },
    climber: { label: 'Climber', defaultName: 'Climber', blurb: 'Winch or hook that drives up and down.' },
    piston: { label: 'Pneumatic', defaultName: 'Claw', blurb: 'Air piston on a solenoid that extends and retracts.', noMotor: true },
  };

  /** Closed-loop presets: these get live tuning, SysId and simulation. */
  const CLOSED_LOOP = ['flywheel', 'elevator', 'arm'];

  const SYSID_TESTS = [
    ['Quasistatic', 'Forward', 'quasistatic', 'kForward', 'SysId: slow ramp forward'],
    ['Quasistatic', 'Reverse', 'quasistatic', 'kReverse', 'SysId: slow ramp backward'],
    ['Dynamic', 'Forward', 'dynamic', 'kForward', 'SysId: quick step forward'],
    ['Dynamic', 'Reverse', 'dynamic', 'kReverse', 'SysId: quick step backward'],
  ];

  const LIGHT_TYPES = {
    candle: { label: 'CTRE CANdle', blurb: 'LED controller on the CAN bus. Runs animations on its own.' },
    blinkin: { label: 'REV Blinkin', blurb: 'LED driver on a PWM port with built-in patterns.' },
    strip: { label: 'LED strip on the roboRIO', blurb: 'Addressable strip (WS2812B style) on a PWM port.' },
  };

  const CONTROLLER_TYPES = {
    xbox: { label: 'Xbox controller', cls: 'CommandXboxController' },
    ps4: { label: 'PS4 controller', cls: 'CommandPS4Controller' },
    ps5: { label: 'PS5 controller', cls: 'CommandPS5Controller' },
    joystick: { label: 'Flight joystick', cls: 'CommandJoystick' },
  };

  const DPAD = [['povUp', 'D-pad up'], ['povDown', 'D-pad down'], ['povLeft', 'D-pad left'], ['povRight', 'D-pad right']];
  const PS_FACE = [['cross', 'Cross'], ['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle'],
    ['L1', 'L1'], ['R1', 'R1'], ['L2', 'L2'], ['R2', 'R2']];
  const BUTTONS = {
    xbox: [['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'], ['leftBumper', 'Left bumper'], ['rightBumper', 'Right bumper'],
      ['leftTrigger', 'Left trigger'], ['rightTrigger', 'Right trigger'], ['back', 'Back'], ['start', 'Start'],
      ['leftStick', 'Left stick press'], ['rightStick', 'Right stick press']].concat(DPAD),
    ps4: PS_FACE.concat([['share', 'Share'], ['options', 'Options'], ['L3', 'L3 (left stick press)'],
      ['R3', 'R3 (right stick press)'], ['PS', 'PS button'], ['touchpad', 'Touchpad']], DPAD),
    ps5: PS_FACE.concat([['create', 'Create'], ['options', 'Options'], ['L3', 'L3 (left stick press)'],
      ['R3', 'R3 (right stick press)'], ['PS', 'PS button'], ['touchpad', 'Touchpad']], DPAD),
    joystick: [['button1', 'Trigger (button 1)']].concat(
      Array.from({ length: 11 }, (_, i) => ['button' + (i + 2), 'Button ' + (i + 2)]), DPAD),
  };

  /** Default drive buttons per controller type: [reset heading, x-lock, slow mode]. */
  const DRIVE_BUTTON_DEFAULTS = {
    xbox: ['leftBumper', 'x', 'rightBumper'],
    ps4: ['L1', 'square', 'R1'],
    ps5: ['L1', 'square', 'R1'],
    joystick: ['button2', 'button3', 'button4'],
  };

  const WHEN = {
    held: { method: 'whileTrue', label: 'while held' },
    pressed: { method: 'onTrue', label: 'when pressed' },
    toggle: { method: 'toggleOnTrue', label: 'toggle on press' },
    released: { method: 'onFalse', label: 'when released' },
  };

  /** Named LED colors: [enum name, label, rgb, Blinkin solid code, Blinkin strobe code]. */
  const LED_COLORS = [
    ['RED', 'Red', [255, 0, 0], 0.61, -0.11],
    ['ORANGE', 'Orange', [255, 80, 0], 0.65, -0.07],
    ['YELLOW', 'Yellow', [255, 200, 0], 0.69, -0.07],
    ['GREEN', 'Green', [0, 255, 0], 0.77, -0.05],
    ['CYAN', 'Cyan', [0, 255, 255], 0.81, -0.05],
    ['BLUE', 'Blue', [0, 0, 255], 0.87, -0.09],
    ['PURPLE', 'Purple', [150, 0, 255], 0.91, -0.05],
    ['PINK', 'Pink', [255, 40, 140], 0.57, -0.11],
    ['WHITE', 'White', [255, 255, 255], 0.93, -0.05],
    ['OFF', 'Off', [0, 0, 0], 0.99, 0.99],
  ];
  const LED_COLOR_KEYS = LED_COLORS.map((c) => c[0]);

  const LED_PATTERNS = {
    solid: 'Solid color',
    strobe: 'Flashing color',
    rainbow: 'Rainbow',
    alliance: 'Alliance color',
    off: 'Off',
  };

  const CANDLE_STRIP_TYPES = ['GRB', 'RGB', 'BRG', 'GRBW', 'RGBW', 'BRGW'];
  const STRIP_ORDERS = ['GRB', 'RGB', 'RBG', 'BGR', 'BRG', 'GBR'];

  /* Names the generated code already uses, so user names never collide with them. */
  const RESERVED_CLASSES = ['Robot', 'RobotContainer', 'Constants', 'Main', 'Telemetry', 'CommandSwerveDrivetrain',
    'TunerConstants', 'LedColor', 'TalonFX', 'SparkMax', 'SparkFlex', 'CANdle', 'CANcoder', 'CANrange', 'CANBus',
    'Command', 'Commands', 'SubsystemBase', 'Subsystem', 'SmartDashboard', 'DigitalInput', 'DutyCycleEncoder',
    'MathUtil', 'Units', 'Color', 'LEDPattern', 'DriverStation', 'Alliance', 'Trigger', 'AddressableLED',
    'AddressableLEDBuffer', 'Spark', 'RelativeEncoder', 'Follower', 'StatusCode', 'SwerveRequest', 'Math',
    'String', 'Object', 'System', 'Integer', 'Double', 'Boolean', 'Optional', 'Override', 'Deprecated',
    'IdleMode', 'MotorType', 'ResetMode', 'PersistMode', 'ControlType', 'FeedbackSensor', 'Timer',
    'Autos', 'AutoBuilder', 'NamedCommands', 'PathPlannerPath', 'SendableChooser', 'CommandScheduler',
    'RobotConfig', 'PIDConstants', 'PPHolonomicDriveController', 'FollowPathCommand', 'BooleanSupplier', 'Pose2d',
    'Vision', 'Combos', 'Steps', 'Compressor', 'DoubleSolenoid', 'Solenoid', 'PneumaticsModuleType', 'Field2d',
    'PIDController', 'Pose3d', 'Rotation2d', 'Transform2d', 'Matrix', 'VecBuilder', 'NetworkTable', 'NetworkTableInstance',
    'Mechanism2d', 'MechanismLigament2d', 'ElevatorSim', 'SingleJointedArmSim', 'FlywheelSim', 'DCMotor', 'SysIdRoutine',
    'RobotBase', 'RobotController', 'LinearSystemId', 'ChassisReference', 'Set', 'AprilTagFieldLayout', 'AprilTagFields',
    'Limelight', 'Measurement', 'Slot0Configs', 'VoltageOut', 'SparkMaxSim', 'SparkFlexSim'];

  /** Directions a timed drive step can go, as robot-relative unit vectors (x forward, y left). */
  const DRIVE_DIRS = {
    forward: { label: 'Forward', vec: [1, 0] },
    backward: { label: 'Backward', vec: [-1, 0] },
    left: { label: 'Left', vec: [0, 1] },
    right: { label: 'Right', vec: [0, -1] },
  };

  /** Building blocks for autonomous routines. */
  const STEP_TYPES = {
    action: { label: 'Run an action', blurb: 'Run something a subsystem can do.' },
    drive: { label: 'Drive', blurb: 'Drive straight for a set time.', swerve: true },
    wait: { label: 'Wait', blurb: 'Pause for a set time.' },
    until: { label: 'Wait until', blurb: 'Pause until a sensor or mechanism is ready.' },
    path: { label: 'Follow a path', blurb: 'Drive a path drawn in PathPlanner.', pathPlanner: true },
  };
  const ACTION_MODES = {
    finish: 'Until it finishes',
    time: 'For a set time',
    background: 'Start it and move on',
  };

  const RESERVED_METHODS = new Set(['run', 'runOnce', 'runEnd', 'startEnd', 'startRun', 'defer', 'idle', 'periodic',
    'simulationPeriodic', 'getName', 'setName', 'register', 'getSubsystem', 'setSubsystem', 'addChild',
    'initSendable', 'setDefaultCommand', 'removeDefaultCommand', 'getDefaultCommand', 'getCurrentCommand',
    'equals', 'hashCode', 'toString', 'getClass', 'notify', 'notifyAll', 'wait', 'finalize', 'clone',
    'setSpeed', 'setTarget', 'holdTarget', 'setTargetRpm', 'hasGamePiece', 'atTarget', 'atSpeed', 'atBottom',
    'goTo', 'spinUp', 'jog', 'applyConfig', 'getRpm', 'getTargetRpm', 'getHeightInches', 'getTargetInches',
    'getAngleDegrees', 'getTargetDegrees', 'getPosition', 'getAbsoluteRaw', 'getAbsoluteDegrees',
    'syncToAbsoluteEncoder', 'absoluteEncoderConnected', 'resetPosition', 'showSolid', 'showStrobe',
    'showRainbow', 'showOff', 'showAllianceColor', 'changeTo', 'toRgbw', 'toColor', 'show', 'stop',
    'jogUp', 'jogDown', 'zeroEncoder', 'syncEncoder', 'resetToStartingAngle', 'setExtended', 'isExtended',
    'publishTuning', 'updateTuning', 'resetToBottom', 'hasTarget', 'isAimed', 'aimRate', 'aimAtTag', 'alignTo',
    'nearestSpot', 'driveTo', 'isAt', 'sysIdQuasistaticForward', 'sysIdQuasistaticReverse', 'sysIdDynamicForward',
    'sysIdDynamicReverse', 'spinUpTo', 'track', 'runAt', 'distanceTo', 'driveSpeedScale']);

  const JAVA_KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do ' +
    'double else enum extends final finally float for goto if implements import instanceof int interface long ' +
    'native new package private protected public return short static strictfp super switch synchronized this ' +
    'throw throws transient try void volatile while true false null var record yield sealed permits').split(' '));

  /* ================================================================ helpers */

  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  const int = (v, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : def; };
  const bool = (v) => v === true || v === 'true';
  const str = (v, def) => (typeof v === 'string' ? v : def);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const positive = (v, def) => { const n = num(v, def); return n > 0 ? n : def; };

  /** Splits "Coral Intake", "coralIntake" and "L2_arm" into words. Keeps runs like "LEDs" together. */
  function words(s) {
    return String(s || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  function pascal(s) { return words(s).map(cap).join(''); }
  function camel(s) {
    const w = words(s);
    if (!w.length) return '';
    return w[0].toLowerCase() + w.slice(1).map(cap).join('');
  }

  /** Makes `base` unique within `used` (case-insensitive) by adding 2, 3, ... */
  function unique(base, used) {
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = base + n++;
    used.add(name.toLowerCase());
    return name;
  }

  /** Java double literal. */
  function d(v) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    if (Number.isInteger(n)) return n.toFixed(1);
    let s = String(+n.toPrecision(12));
    if (!/[.eE]/.test(s)) s += '.0';
    return s;
  }
  /** Java int literal. */
  function i(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? String(n) : '0'; }
  /** Java boolean literal. */
  function b(v) { return v ? 'true' : 'false'; }
  /** Java string literal contents. */
  function q(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' '); }
  /** Text that is safe inside a Java comment. */
  function c(s) { return String(s).replace(/\*\//g, '* /').replace(/[\r\n]/g, ' '); }
  function sig(x, n) { return x ? +Number(x).toPrecision(n || 4) : 0; }

  /** Collects imports and prints them sorted and grouped like WPILib projects. */
  function Imports() {
    const set = new Set();
    return {
      add(...xs) { xs.forEach((x) => set.add(x)); },
      has(x) { return set.has(x); },
      render() {
        const all = Array.from(set);
        const statics = all.filter((x) => x.startsWith('static ')).sort();
        const normal = all.filter((x) => !x.startsWith('static ')).sort();
        const out = [];
        statics.forEach((x) => out.push('import ' + x + ';'));
        if (statics.length && normal.length) out.push('');
        let group = null;
        normal.forEach((x) => {
          const g = x.split('.')[0];
          if (group !== null && g !== group) out.push('');
          group = g;
          out.push('import ' + x + ';');
        });
        return out.join('\n');
      },
    };
  }

  /** A tiny Java source writer with 4-space indentation. */
  function Writer() {
    const out = [];
    let depth = 0;
    const pad = () => '    '.repeat(depth);
    const w = {
      ln(s) { out.push(s ? pad() + s : ''); return w; },
      open(s) { w.ln(s + ' {'); depth++; return w; },
      close(tail) { depth--; w.ln('}' + (tail || '')); return w; },
      blank() { if (out.length && out[out.length - 1] !== '') out.push(''); return w; },
      doc(text) {
        const lines = Array.isArray(text) ? text : [text];
        if (lines.length === 1) w.ln('/** ' + c(lines[0]) + ' */');
        else { w.ln('/**'); lines.forEach((l) => w.ln(l ? ' * ' + c(l) : ' *')); w.ln(' */'); }
        return w;
      },
      text() { return out.join('\n'); },
    };
    return w;
  }

  /** One nested Constants class. */
  function ConstBlock(className, doc) {
    const items = [];
    const used = new Set();
    return {
      className,
      doc,
      used,
      add(type, name, value, comment) { used.add(name.toLowerCase()); items.push({ type, name, value, comment }); return name; },
      gap(comment) { items.push({ gap: true, comment }); },
      /** Reserves a unique constant name made from a user label. */
      name(prefix, label, suffix, fallback) {
        const core = pascal(label) || fallback;
        return unique(prefix + core + suffix, used);
      },
      render(w) {
        if (doc) w.doc(doc);
        w.open('public static final class ' + className);
        let first = true;
        items.forEach((it) => {
          if (it.gap) {
            if (!first) w.blank();
            if (it.comment) w.ln('// ' + c(it.comment));
            return;
          }
          first = false;
          const line = 'public static final ' + it.type + ' ' + it.name + ' = ' + it.value + ';';
          w.ln(it.comment ? line + ' // ' + c(it.comment) : line);
        });
        w.close();
      },
    };
  }

  function uid(prefix) { return (prefix || 'x') + Math.random().toString(36).slice(2, 9); }

  /* ================================================================ defaults */

  function defaultGains(preset, vendor) {
    const ctre = vendor === 'ctre';
    switch (preset) {
      case 'flywheel': return ctre ? { kP: 0.1, kI: 0, kD: 0, kS: 0.1, kV: 0.12 } : { kP: 0.0002, kI: 0, kD: 0, kS: 0.1, kV: 0.0021 };
      case 'elevator': return ctre ? { kP: 2, kI: 0, kD: 0.05, kS: 0.1, kV: 0.2, kG: 0.3 } : { kP: 0.1, kI: 0, kD: 0, kS: 0.1, kV: 0.2, kG: 0.3 };
      case 'arm': return ctre ? { kP: 20, kI: 0, kD: 0.2, kS: 0.1, kV: 4, kG: 0.3 } : { kP: 0.01, kI: 0, kD: 0, kS: 0.1, kV: 0.01, kG: 0.3 };
      default: return {};
    }
  }

  /** kV estimate: 12 volts divided by the free speed in the units the gains use. */
  function estimateKV(sub, vendor) {
    const motor = MOTORS[sub.motor] || MOTORS.krakenX60;
    const ratio = positive(sub.gearRatio, 1);
    const freeRps = motor.freeRpm / 60;
    switch (sub.preset) {
      case 'flywheel': return sig(vendor === 'ctre' ? 12 / (freeRps / ratio) : 12 / (motor.freeRpm / ratio));
      case 'elevator': {
        const inchesPerRot = (Math.PI * positive(sub.drumDiameter, 1.757) * positive(sub.travelMultiplier, 1)) / ratio;
        return sig(12 / (freeRps * inchesPerRot));
      }
      case 'arm': return sig(vendor === 'ctre' ? 12 / (freeRps / ratio) : 12 / ((freeRps / ratio) * 360));
      default: return 0;
    }
  }

  /**
   * kG estimate: the volts that hold the weight still, from the motor, the gearing, the number of
   * motors and the weight and size typed in for the simulator. kG is in volts for both vendors.
   */
  function estimateKG(sub) {
    const motor = MOTORS[sub.motor] || MOTORS.krakenX60;
    const motors = 1 + (Array.isArray(sub.followers) ? sub.followers.length : 0);
    const ratio = positive(sub.gearRatio, 1);
    let torque;
    if (sub.preset === 'elevator') {
      const radius = (positive(sub.drumDiameter, 1.757) * positive(sub.travelMultiplier, 1) * 0.0254) / 2;
      torque = positive(sub.simMassLbs, 15) * 0.45359237 * 9.81 * radius;
    } else if (sub.preset === 'arm') {
      torque = (positive(sub.simMassLbs, 8) * 0.45359237 * 9.81 * positive(sub.simLength, 20) * 0.0254) / 2;
    } else return 0;
    const amps = torque / ratio / motors / (motor.stallTorque / motor.stallCurrent);
    return sig(amps * (12 / motor.stallCurrent), 3);
  }

  function newAction(name, speed, stopOnPiece) { return { id: uid('a'), name, speed, stopOnPiece: !!stopOnPiece }; }
  function newSetpoint(name, value) { return { id: uid('p'), name, value }; }
  function newSpeed(name, rpm) { return { id: uid('r'), name, rpm }; }

  function newSubsystem(preset, opts) {
    const o = opts || {};
    const s = {
      id: o.id || uid('s'),
      preset,
      name: o.name || PRESETS[preset].defaultName,
      motor: o.motor || 'krakenX60',
      vortexController: 'sparkflex',
      canId: o.canId != null ? o.canId : 20,
      inverted: false,
      brake: true,
      statorLimit: 80,
      supplyLimit: 40,
      currentLimit: 40,
      followers: [],
      gearRatio: 1,
    };
    switch (preset) {
      case 'roller':
        Object.assign(s, {
          brake: false,
          actions: [newAction('Run In', 80, true), newAction('Run Out', -60, false)],
          sensor: { type: 'none', dio: 0, activeLow: true, canId: 40, distance: 0.1 },
        });
        break;
      case 'flywheel':
        Object.assign(s, {
          brake: false,
          speeds: [newSpeed('Close Shot', 3000), newSpeed('Far Shot', 4500)],
          toleranceRpm: 100,
          simWheelMassLbs: 1.5,
          simWheelDiameter: 4,
        });
        break;
      case 'elevator':
        Object.assign(s, {
          gearRatio: 9,
          drumDiameter: 1.757,
          travelMultiplier: 1,
          maxPos: 50,
          setpoints: [newSetpoint('Stow', 0), newSetpoint('Low', 18), newSetpoint('High', 46)],
          tolerance: 0.5,
          profile: true,
          cruise: 40,
          accel: 80,
          jogLead: 2,
          limitSwitch: { enabled: false, dio: 1, normallyOpen: true },
          simMassLbs: 15,
        });
        break;
      case 'arm':
        Object.assign(s, {
          gearRatio: 50,
          encoder: 'builtin',
          encoderDio: 2,
          encoderOffset: 0,
          encoderInverted: false,
          cancoderId: 41,
          startAngle: 90,
          minPos: -30,
          maxPos: 120,
          setpoints: [newSetpoint('Stow', 90), newSetpoint('Intake', -20), newSetpoint('Score', 35)],
          tolerance: 2,
          profile: true,
          cruise: 180,
          accel: 360,
          jogLead: 10,
          simLength: 20,
          simMassLbs: 8,
        });
        break;
      case 'climber':
        Object.assign(s, {
          gearRatio: 25,
          actions: [newAction('Climb Up', 100), newAction('Climb Down', -100)],
          softLimits: { enabled: false, min: 0, max: 100 },
        });
        break;
      case 'piston':
        Object.assign(s, {
          solenoid: 'double', forwardChannel: 0, reverseChannel: 1, channel: 0,
          startState: 'retracted', extendName: 'Extend', retractName: 'Retract',
        });
        break;
      default:
        break;
    }
    applyMotorDefaults(s);
    s.gains = { ctre: defaultGains(preset, 'ctre'), rev: defaultGains(preset, 'rev') };
    if (s.gains.ctre.kV !== undefined) {
      s.gains.ctre.kV = estimateKV(s, 'ctre');
      s.gains.rev.kV = estimateKV(s, 'rev');
    }
    if (s.gains.ctre.kG !== undefined) {
      s.gains.ctre.kG = estimateKG(s);
      s.gains.rev.kG = estimateKG(s);
    }
    return s;
  }

  /** Sets current limits to sensible values for the chosen motor. */
  function applyMotorDefaults(s) {
    const m = MOTORS[s.motor] || MOTORS.krakenX60;
    if (m.ctrl === 'talonfx') { s.statorLimit = m.stator; s.supplyLimit = m.supply; } else { s.currentLimit = m.current; }
  }

  function newLight(type, opts) {
    const o = opts || {};
    return {
      id: o.id || uid('l'),
      type,
      name: o.name || 'LEDs',
      canId: o.canId != null ? o.canId : 50,
      stripLength: 60,
      includeOnboard: true,
      stripType: 'GRB',
      brightness: 50,
      pwmPort: 0,
      rules: [
        { id: uid('u'), when: 'disabled', pattern: 'rainbow', color: 'PURPLE' },
      ],
      otherwise: { pattern: 'alliance', color: 'PURPLE' },
      signals: [{ id: uid('g'), name: 'Want Game Piece', pattern: 'strobe', color: 'YELLOW' }],
    };
  }

  function newController(name, type, port) {
    return { id: uid('c'), name, type: type || 'xbox', port: port != null ? port : 0 };
  }

  function newRobot() {
    const driver = newController('Driver', 'xbox', 0);
    return {
      app: 'robot-code-builder',
      version: 1,
      project: {
        teamNumber: '',
        robotName: 'New Robot',
        tunerSwerve: true,
        swerveIds: '',
        swerveBus: 'rio',
        ctreBus: 'rio',
        phoenixPro: false,
        liveTuning: false,
        sysId: false,
        simulation: true,
        pneumaticsModule: 'revph',
        pneumaticsCanId: 1,
        compressor: 'digital',
        minPsi: 80,
        maxPsi: 120,
      },
      subsystems: [],
      controllers: [driver],
      drive: {
        controllerId: driver.id,
        maxSpeedPct: 100,
        maxTurnRps: 0.75,
        deadbandPct: 10,
        resetButton: 'leftBumper',
        brakeButton: 'x',
        slowButton: 'rightBumper',
        slowPct: 40,
        sysId: false,
        aimButton: 'none',
      },
      bindings: [],
      lights: [],
      autos: newAutos(),
      vision: newVision(),
      combos: [],
      rumbles: [],
      paths: [],
      ppAutos: [],
    };
  }

  /** A zone: "the robot is within X m of these tags". It can slow the drive, change LEDs or run an action. */
  function newZone(name) {
    return { id: uid('z'), name: name || 'New Zone', tags: '', distance: 1.5, slowPct: '', runTarget: '', runAction: '' };
  }
  /** A distance table: picks a speed, angle or height from the distance to some tags. */
  function newTable(name, target) {
    return {
      id: uid('d'), name: name || 'New Table', tags: '', target: target || '',
      points: [{ id: uid('q'), distance: 1, value: 0 }, { id: uid('q'), distance: 4, value: 0 }],
    };
  }
  /** Shake a controller for a moment when something becomes true. */
  function newRumble(controllerId, when) {
    return { id: uid('w'), controllerId: controllerId || '', when: when || '', seconds: 0.4, strength: 60 };
  }

  function newVision() {
    return {
      cameras: [], spots: [], zones: [], tables: [],
      aimP: 4, aimTolerance: 2, alignP: 3, alignMaxSpeed: 2, headingP: 7, alignTolerance: 0.03, alignAngleTolerance: 2,
    };
  }
  function newCamera(name) {
    return { id: uid('v'), name: name || 'limelight', megaTag2: true, aim: false, trust: 0.7, maxDistance: 4 };
  }
  function newSpot(name) {
    return { id: uid('o'), name: name || 'New Spot', tags: '', distance: 0.5, sideways: 0 };
  }
  function newCombo(name) {
    return { id: uid('k'), name: name || 'New Combo', steps: [] };
  }

  function newAutos() {
    return { pathPlanner: true, translationP: 10, rotationP: 7, defaultAuto: '', routines: [] };
  }
  function newRoutine(name) {
    return { id: uid('t'), name: name || 'New Auto', resetHeading: true, steps: [] };
  }
  /** A new step of a type, filled with sensible values. `firstPath` marks the routine's first path step. */
  function newStep(type, opts) {
    const o = opts || {};
    const s = { id: uid('e'), type };
    if (type === 'drive') Object.assign(s, { direction: 'forward', speed: 1, seconds: 2 });
    if (type === 'action') Object.assign(s, { target: o.target || '', action: o.action || '', mode: o.mode || 'time', seconds: 1 });
    if (type === 'wait') Object.assign(s, { seconds: 0.5 });
    if (type === 'until') Object.assign(s, { condition: o.condition || '', seconds: 3 });
    if (type === 'path') Object.assign(s, { pathName: o.pathName || '', resetPose: !!o.firstPath, spots: [] });
    return s;
  }

  /** The example robot the page opens with. */
  function exampleRobot() {
    const r = newRobot();
    r.project.robotName = 'Example Robot';
    r.project.swerveIds = '1-12, 13';
    const operator = newController('Operator', 'xbox', 1);
    r.controllers.push(operator);
    const driver = r.controllers[0];

    const intake = newSubsystem('roller', { name: 'Intake', motor: 'neoVortex', canId: 20 });
    intake.sensor = { type: 'dio', dio: 0, activeLow: true, canId: 40, distance: 0.1 };
    const elevator = newSubsystem('elevator', { name: 'Elevator', motor: 'krakenX60', canId: 21 });
    elevator.followers = [{ id: uid('f'), canId: 22, opposite: true }];
    const arm = newSubsystem('arm', { name: 'Arm', motor: 'neo', canId: 23 });
    arm.encoder = 'throughboreSpark';
    arm.encoderOffset = 0.25;
    const climber = newSubsystem('climber', { name: 'Climber', motor: 'krakenX60', canId: 24 });
    climber.softLimits = { enabled: true, min: 0, max: 120 };
    [intake, elevator, arm, climber].forEach(applyMotorDefaults);
    [elevator, arm].forEach((s) => {
      s.gains.ctre.kV = estimateKV(s, 'ctre');
      s.gains.rev.kV = estimateKV(s, 'rev');
      s.gains.ctre.kG = estimateKG(s);
      s.gains.rev.kG = estimateKG(s);
    });
    r.subsystems = [intake, elevator, arm, climber];

    const leds = newLight('candle', { name: 'LEDs', canId: 30 });
    leds.rules = [
      { id: uid('u'), when: 'disabled', pattern: 'rainbow', color: 'PURPLE' },
      { id: uid('u'), when: 'piece:' + intake.id, pattern: 'solid', color: 'GREEN' },
      { id: uid('u'), when: 'moving:' + elevator.id, pattern: 'strobe', color: 'WHITE' },
    ];
    r.lights = [leds];

    const bind = (ctl, button, when, target, action) => ({ id: uid('b'), controllerId: ctl.id, button, when, target, action });
    r.bindings = [
      bind(operator, 'rightTrigger', 'held', intake.id, 'act:' + intake.actions[0].id),
      bind(operator, 'leftTrigger', 'held', intake.id, 'act:' + intake.actions[1].id),
      bind(operator, 'a', 'pressed', elevator.id, 'sp:' + elevator.setpoints[0].id),
      bind(operator, 'a', 'pressed', arm.id, 'sp:' + arm.setpoints[0].id),
      bind(operator, 'b', 'pressed', elevator.id, 'sp:' + elevator.setpoints[1].id),
      bind(operator, 'y', 'pressed', elevator.id, 'sp:' + elevator.setpoints[2].id),
      bind(operator, 'x', 'pressed', arm.id, 'sp:' + arm.setpoints[2].id),
      bind(operator, 'povDown', 'pressed', arm.id, 'sp:' + arm.setpoints[1].id),
      bind(operator, 'povUp', 'held', elevator.id, 'jogUp'),
      bind(driver, 'povUp', 'held', climber.id, 'act:' + climber.actions[0].id),
      bind(driver, 'povDown', 'held', climber.id, 'act:' + climber.actions[1].id),
      bind(driver, 'y', 'held', leds.id, 'signal:' + leds.signals[0].id),
    ];

    const step = (type, extra) => Object.assign(newStep(type), extra);
    const leave = newRoutine('Leave Zone');
    leave.steps = [step('drive', { direction: 'forward', speed: 1, seconds: 2 })];
    const score = newRoutine('Score and Leave');
    score.steps = [
      step('action', { target: elevator.id, action: 'sp:' + elevator.setpoints[2].id, mode: 'finish' }),
      step('action', { target: intake.id, action: 'act:' + intake.actions[1].id, mode: 'time', seconds: 0.5 }),
      step('action', { target: elevator.id, action: 'sp:' + elevator.setpoints[0].id, mode: 'background' }),
      step('drive', { direction: 'backward', speed: 1.5, seconds: 1.5 }),
    ];
    r.autos.routines = [leave, score];

    // A PathPlanner path with actions along it: flash the LEDs, stop to lower the arm, then intake while driving.
    r.paths = [{ id: uid('n'), name: 'Example Path', data: examplePath(), fromApp: true }];
    const demo = newRoutine('Path Demo');
    demo.steps = [
      step('path', {
        pathName: 'Example Path', resetPose: true, spots: [
          newPathSpot('drive', { pos: 0.2, target: leds.id, action: 'signal:' + leds.signals[0].id, until: 'time', seconds: 1.5 }),
          newPathSpot('stop', { pos: 1, target: arm.id, action: 'sp:' + arm.setpoints[1].id, mode: 'finish' }),
          newPathSpot('drive', { pos: 1.2, target: intake.id, action: 'act:' + intake.actions[0].id, until: 'pathEnd' }),
        ],
      }),
      step('action', { target: intake.id, action: 'act:' + intake.actions[1].id, mode: 'time', seconds: 0.5 }),
    ];
    r.autos.routines.push(demo);

    // A button combo on the operator's right bumper.
    const scoreHigh = newCombo('Score High');
    scoreHigh.steps = [
      step('action', { target: elevator.id, action: 'sp:' + elevator.setpoints[2].id, mode: 'finish' }),
      step('action', { target: arm.id, action: 'sp:' + arm.setpoints[2].id, mode: 'finish' }),
      step('action', { target: intake.id, action: 'act:' + intake.actions[1].id, mode: 'time', seconds: 0.4 }),
      step('action', { target: arm.id, action: 'sp:' + arm.setpoints[0].id, mode: 'background' }),
      step('action', { target: elevator.id, action: 'sp:' + elevator.setpoints[0].id, mode: 'background' }),
    ];
    r.combos = [scoreHigh];
    r.bindings.push(bind(operator, 'rightBumper', 'pressed', 'combos', 'combo:' + scoreHigh.id));

    // One Limelight, aiming on the driver's left trigger and lining up with the nearest tag.
    const cam = newCamera('limelight');
    cam.aim = true;
    const spot = newSpot('Nearest Tag');
    spot.tags = '1-32';
    spot.distance = 0.8;
    r.vision.cameras = [cam];
    r.vision.spots = [spot];
    r.drive.aimButton = 'leftTrigger';
    r.bindings.push(bind(driver, 'a', 'held', 'vision', 'spot:' + spot.id));

    // Close to any tag: drive at half speed and turn the LEDs yellow.
    const close = newZone('Close to Tag');
    close.tags = '1-32';
    close.distance = 1;
    close.slowPct = 50;
    r.vision.zones = [close];
    leds.rules.push({ id: uid('u'), when: 'zone:' + close.id, pattern: 'solid', color: 'YELLOW' });
    // The arm tilts up more the farther the robot is from a tag (operator left bumper).
    const armTable = newTable('Arm by Distance', arm.id);
    armTable.tags = '1-32';
    armTable.points = [{ id: uid('q'), distance: 1, value: 20 }, { id: uid('q'), distance: 3, value: 45 }, { id: uid('q'), distance: 5, value: 60 }];
    r.vision.tables = [armTable];
    r.bindings.push(bind(operator, 'leftBumper', 'held', arm.id, 'table:' + armTable.id));
    // The driver's controller shakes when the intake gets a game piece.
    r.rumbles = [newRumble(driver.id, 'piece:' + intake.id)];
    return r;
  }


  /* ================================================================ PathPlanner paths */

  /**
   * Reads PathPlanner .path files (PathPlanner 2025 and later). A "position" counts waypoints the
   * way PathPlanner does: 0 is the first waypoint, 1 the second, 1.5 is halfway between them.
   */
  const PathGeom = (() => {
    const cache = typeof WeakMap === 'function' ? new WeakMap() : null;
    const FIELD_PP_W = 8.07;
    const pt = (o) => (o && Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y)) ? { x: Number(o.x), y: Number(o.y) } : null);
    /** The waypoints of a parsed .path file, or null if it doesn't look like a path. */
    function waypoints(data) {
      if (!data || typeof data !== 'object' || !Array.isArray(data.waypoints) || data.waypoints.length < 2) return null;
      if (cache && cache.has(data)) return cache.get(data);
      const w = data.waypoints.map((p) => ({ anchor: pt(p && p.anchor), prev: pt(p && p.prevControl), next: pt(p && p.nextControl) }));
      const ok = w.every((x) => x.anchor);
      if (ok) {
        // A missing control point makes that end of the segment straight.
        w.forEach((x, i) => {
          if (i < w.length - 1 && !x.next) x.next = x.anchor;
          if (i > 0 && !x.prev) x.prev = x.anchor;
        });
      }
      const out = ok ? w : null;
      if (cache) cache.set(data, out);
      return out;
    }
    const valid = (data) => !!waypoints(data);
    const lastPos = (data) => { const w = waypoints(data); return w ? w.length - 1 : 0; };
    function bezier(a, b, c, e, t) {
      const u = 1 - t;
      const k0 = u * u * u; const k1 = 3 * u * u * t; const k2 = 3 * u * t * t; const k3 = t * t * t;
      return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * e.x, y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * e.y };
    }
    /** Field point (meters) at a position. */
    function pointAt(data, pos) {
      const w = waypoints(data);
      if (!w) return null;
      const last = w.length - 1;
      const p = Math.min(Math.max(Number(pos) || 0, 0), last);
      const s = Math.min(Math.floor(p), last - 1);
      return bezier(w[s].anchor, w[s].next, w[s + 1].prev, w[s + 1].anchor, p - s);
    }
    /** Points along the path, about `step` apart in position: [{pos, x, y}]. */
    function sample(data, step, from, to) {
      const last = lastPos(data);
      if (!last) return [];
      const a = from == null ? 0 : Math.max(0, Math.min(last, from));
      const b = to == null ? last : Math.max(a, Math.min(last, to));
      const n = Math.max(1, Math.ceil((b - a) / (step || 0.02)));
      const out = [];
      for (let i = 0; i <= n; i++) {
        const pos = a + ((b - a) * i) / n;
        const p = pointAt(data, pos);
        out.push({ pos, x: p.x, y: p.y });
      }
      return out;
    }
    /** The spot on the path nearest to a field point: {pos, x, y, dist}. */
    function nearest(data, x, y) {
      let best = null;
      sample(data, 0.004).forEach((p) => {
        const dist = Math.hypot(p.x - x, p.y - y);
        if (!best || dist < best.dist) best = { pos: p.pos, x: p.x, y: p.y, dist };
      });
      return best;
    }
    function length(data, from, to) {
      const pts = sample(data, 0.01, from, to);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return total;
    }
    /** Every anchor and control point, for fitting the path in a view. */
    function bounds(data) {
      const w = waypoints(data);
      if (!w) return null;
      const xs = [];
      const ys = [];
      w.forEach((p) => [p.anchor, p.prev, p.next].forEach((q) => { if (q) { xs.push(q.x); ys.push(q.y); } }));
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    const deg = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
    /** Which way the robot faces (degrees) at a position: blended between rotation targets. */
    function rotationAt(data, pos) {
      const last = lastPos(data);
      for (const z of Array.isArray(data.pointTowardsZones) ? data.pointTowardsZones : []) {
        const f = pt(z && z.fieldPosition);
        if (f && pos >= deg(z.minWaypointRelativePos, 1e9) && pos <= deg(z.maxWaypointRelativePos, -1)) {
          const p = pointAt(data, pos);
          return (Math.atan2(f.y - p.y, f.x - p.x) * 180) / Math.PI + deg(z.rotationOffset, 0);
        }
      }
      const goal = deg((data.goalEndState || {}).rotation, 0);
      let prevPos = 0;
      let prevRot = data.idealStartingState ? deg(data.idealStartingState.rotation, goal) : goal;
      let nextPos = last;
      let nextRot = goal;
      (Array.isArray(data.rotationTargets) ? data.rotationTargets : []).forEach((r) => {
        const rp = deg(r && r.waypointRelativePos, -1);
        const rr = deg(r && r.rotationDegrees, 0);
        if (rp <= pos && rp >= prevPos) { prevPos = rp; prevRot = rr; }
        if (rp >= pos && rp <= nextPos) { nextPos = rp; nextRot = rr; }
      });
      const f = nextPos > prevPos ? (pos - prevPos) / (nextPos - prevPos) : 0;
      const diff = ((((nextRot - prevRot) % 360) + 540) % 360) - 180;
      return prevRot + diff * f;
    }
    /** Speed limits at a position, from the path's constraints and constraint zones. */
    function limits(data, pos) {
      const g = data.globalConstraints || {};
      let v = g.unlimited ? 6 : deg(g.maxVelocity, 3);
      let a = g.unlimited ? 12 : deg(g.maxAcceleration, 3);
      (Array.isArray(data.constraintZones) ? data.constraintZones : []).forEach((z) => {
        if (z && z.constraints && pos >= deg(z.minWaypointRelativePos, 1e9) && pos <= deg(z.maxWaypointRelativePos, -1)) {
          v = z.constraints.unlimited ? v : deg(z.constraints.maxVelocity, v);
          a = z.constraints.unlimited ? a : deg(z.constraints.maxAcceleration, a);
        }
      });
      return { v: Math.max(0.05, v), a: Math.max(0.05, a) };
    }
    /**
     * A drive plan along part of a path, close to what PathPlanner does: speed up, cruise, slow for
     * curves and constraint zones, and arrive at endV. Returns {points: [{pos, x, y, d, v, t, rot}], time, length}.
     */
    function trajectory(data, from, to, startV, endV) {
      const pts = sample(data, 0.01, from, to);
      if (pts.length < 2) return { points: pts.map((p) => Object.assign(p, { d: 0, v: 0, t: 0, rot: rotationAt(data, p.pos) })), time: 0, length: 0 };
      let dist = 0;
      pts.forEach((p, i) => {
        if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
        p.d = dist;
        const L = limits(data, p.pos);
        p.vmax = L.v;
        p.a = L.a;
      });
      for (let i = 1; i < pts.length - 1; i++) {
        const A = pts[i - 1]; const B = pts[i]; const C = pts[i + 1];
        const ab = Math.hypot(B.x - A.x, B.y - A.y); const bc = Math.hypot(C.x - B.x, C.y - B.y); const ac = Math.hypot(C.x - A.x, C.y - A.y);
        const area2 = Math.abs((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x));
        const k = ab * bc * ac > 1e-9 ? (2 * area2) / (ab * bc * ac) : 0;
        if (k > 1e-6) B.vmax = Math.min(B.vmax, Math.sqrt(B.a / k));
      }
      const n = pts.length - 1;
      pts[0].v = Math.min(Math.max(0, startV || 0), pts[0].vmax);
      for (let i = 1; i <= n; i++) pts[i].v = Math.min(pts[i].vmax, Math.sqrt(pts[i - 1].v ** 2 + 2 * pts[i].a * (pts[i].d - pts[i - 1].d)));
      pts[n].v = Math.min(pts[n].v, Math.max(0, endV || 0));
      for (let i = n - 1; i >= 0; i--) pts[i].v = Math.min(pts[i].v, Math.sqrt(pts[i + 1].v ** 2 + 2 * pts[i].a * (pts[i + 1].d - pts[i].d)));
      let t = 0;
      pts.forEach((p, i) => {
        if (i) {
          const ds = p.d - pts[i - 1].d;
          t += ds > 0 ? ds / Math.max((p.v + pts[i - 1].v) / 2, 0.05) : 0;
        }
        p.t = t;
        p.rot = rotationAt(data, p.pos);
      });
      return { points: pts, time: t, length: dist };
    }

    const r3 = (o) => (o ? { x: +Number(o.x).toFixed(3), y: +Number(o.y).toFixed(3) } : null);
    const round4 = (v) => +Number(v).toFixed(4);
    /** Forget the parsed waypoints after a path was changed in place. */
    function touch(data) { if (cache) cache.delete(data); }
    /** Moves everything that sits at a position along the path (rotation targets, markers, zones). */
    function remapPath(data, f) {
      const list = (k) => (Array.isArray(data[k]) ? data[k] : []);
      list('rotationTargets').forEach((r) => { r.waypointRelativePos = round4(f(deg(r.waypointRelativePos, 0))); });
      list('eventMarkers').forEach((m) => {
        m.waypointRelativePos = round4(f(deg(m.waypointRelativePos, 0)));
        if (m.endWaypointRelativePos != null && deg(m.endWaypointRelativePos, -1) >= 0) m.endWaypointRelativePos = round4(f(deg(m.endWaypointRelativePos, 0)));
      });
      ['constraintZones', 'pointTowardsZones'].forEach((k) => list(k).forEach((z) => {
        const a = round4(f(deg(z.minWaypointRelativePos, 0)));
        const b = round4(f(deg(z.maxWaypointRelativePos, 0)));
        z.minWaypointRelativePos = Math.min(a, b);
        z.maxWaypointRelativePos = Math.max(a, b);
      }));
      list('rotationTargets').sort((x, y) => x.waypointRelativePos - y.waypointRelativePos);
      list('eventMarkers').sort((x, y) => x.waypointRelativePos - y.waypointRelativePos);
      touch(data);
    }
    const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    /** Adds a waypoint at a position without changing the path's shape. Returns how positions moved. */
    function insertWaypoint(data, pos) {
      const w = data.waypoints;
      const last = w.length - 1;
      const s = Math.min(Math.floor(pos), last - 1);
      const t = pos - s;
      if (!(t > 0.02 && t < 0.98)) return null;
      const A = w[s];
      const B = w[s + 1];
      const a = pt(A.anchor);
      const e = pt(B.anchor);
      const b = pt(A.nextControl) || a;
      const c = pt(B.prevControl) || e;
      const p01 = lerp(a, b, t); const p12 = lerp(b, c, t); const p23 = lerp(c, e, t);
      const p012 = lerp(p01, p12, t); const p123 = lerp(p12, p23, t); const mid = lerp(p012, p123, t);
      A.nextControl = r3(p01);
      B.prevControl = r3(p23);
      w.splice(s + 1, 0, { anchor: r3(mid), prevControl: r3(p012), nextControl: r3(p123), isLocked: false, linkedName: null });
      const f = (p) => (p <= s ? p : p <= s + t ? s + (p - s) / t : p < s + 1 ? s + 1 + (p - s - t) / (1 - t) : p + 1);
      remapPath(data, f);
      return f;
    }
    /** Adds a waypoint at the end, with control points that keep the curve smooth. */
    function appendWaypoint(data, x, y) {
      const w = data.waypoints;
      const L = w[w.length - 1];
      const a = pt(L.anchor);
      const dist = Math.hypot(x - a.x, y - a.y);
      if (dist < 0.1) return false;
      const ux = (x - a.x) / dist; const uy = (y - a.y) / dist;
      const prev = pt(L.prevControl);
      let tx = ux; let ty = uy;
      if (prev && Math.hypot(a.x - prev.x, a.y - prev.y) > 1e-6) { const l = Math.hypot(a.x - prev.x, a.y - prev.y); tx = (a.x - prev.x) / l; ty = (a.y - prev.y) / l; }
      L.nextControl = r3({ x: a.x + tx * dist * 0.4, y: a.y + ty * dist * 0.4 });
      w.push({ anchor: r3({ x, y }), prevControl: r3({ x: x - ux * dist * 0.4, y: y - uy * dist * 0.4 }), nextControl: null, isLocked: false, linkedName: null });
      touch(data);
      return true;
    }
    /** Removes a waypoint (a path keeps at least two). Returns how positions moved. */
    function deleteWaypoint(data, k) {
      const w = data.waypoints;
      const n = w.length;
      if (n <= 2 || k < 0 || k >= n) return null;
      let f;
      w.splice(k, 1);
      if (k === 0) { w[0].prevControl = null; f = (p) => Math.max(0, p - 1); }
      else if (k === n - 1) { w[w.length - 1].nextControl = null; f = (p) => Math.min(n - 2, p); }
      else f = (p) => (p <= k - 1 ? p : p >= k + 1 ? p - 1 : k - 1 + (p - (k - 1)) / 2);
      remapPath(data, f);
      return f;
    }
    /** Drives the path the other way. Returns how positions moved. */
    function reversePath(data) {
      const w = data.waypoints;
      const last = w.length - 1;
      w.reverse();
      w.forEach((p) => { const t = p.prevControl; p.prevControl = p.nextControl; p.nextControl = t; });
      data.idealStartingState = data.idealStartingState || { velocity: 0, rotation: 0 };
      data.goalEndState = data.goalEndState || { velocity: 0, rotation: 0 };
      const sr = data.idealStartingState.rotation;
      data.idealStartingState.rotation = data.goalEndState.rotation;
      data.goalEndState.rotation = sr;
      const f = (p) => last - p;
      remapPath(data, f);
      return f;
    }
    /** Flips the path top to bottom, for the other side of the field. Positions don't move. */
    function mirrorPath(data) {
      const fy = (o) => (o ? { x: Number(o.x), y: +(FIELD_PP_W - Number(o.y)).toFixed(3) } : null);
      data.waypoints.forEach((p) => { p.anchor = fy(p.anchor); p.prevControl = fy(p.prevControl); p.nextControl = fy(p.nextControl); });
      const neg = (v) => +(-deg(v, 0)).toFixed(2);
      if (data.idealStartingState) data.idealStartingState.rotation = neg(data.idealStartingState.rotation);
      if (data.goalEndState) data.goalEndState.rotation = neg(data.goalEndState.rotation);
      (Array.isArray(data.rotationTargets) ? data.rotationTargets : []).forEach((r) => { r.rotationDegrees = neg(r.rotationDegrees); });
      (Array.isArray(data.pointTowardsZones) ? data.pointTowardsZones : []).forEach((z) => { z.fieldPosition = fy(z.fieldPosition); z.rotationOffset = neg(z.rotationOffset); });
      touch(data);
    }
    /** Fills in anything a PathPlanner 2025+ .path file needs, keeping what is already there. */
    function complete(data) {
      const limits = { maxVelocity: 3.0, maxAcceleration: 3.0, maxAngularVelocity: 540.0, maxAngularAcceleration: 720.0, nominalVoltage: 12.0, unlimited: false };
      const out = data;
      if (!out.version) out.version = '2025.0';
      ['rotationTargets', 'constraintZones', 'pointTowardsZones', 'eventMarkers'].forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
      out.globalConstraints = Object.assign({}, limits, out.globalConstraints || {});
      out.goalEndState = Object.assign({ velocity: 0, rotation: 0 }, out.goalEndState || {});
      out.idealStartingState = Object.assign({ velocity: 0, rotation: 0 }, out.idealStartingState || {});
      if (typeof out.reversed !== 'boolean') out.reversed = false;
      if (!('folder' in out)) out.folder = null;
      if (typeof out.useDefaultConstraints !== 'boolean') out.useDefaultConstraints = true;
      out.waypoints.forEach((p) => {
        if (!('isLocked' in p)) p.isLocked = false;
        if (!('linkedName' in p)) p.linkedName = null;
      });
      return out;
    }
    /** What a PathPlanner 2026 robot needs in a .path file, so an old file can be caught before it crashes the code. */
    function missingKeys(data) {
      return ['waypoints', 'rotationTargets', 'constraintZones', 'pointTowardsZones', 'eventMarkers', 'globalConstraints', 'goalEndState', 'idealStartingState']
        .filter((k) => data[k] == null);
    }
    /** A new two-waypoint path. */
    function blank(x0, y0, x1, y1) {
      const dx = (x1 - x0) * 0.4; const dy = (y1 - y0) * 0.4;
      return complete({
        version: '2025.0',
        waypoints: [
          { anchor: r3({ x: x0, y: y0 }), prevControl: null, nextControl: r3({ x: x0 + dx, y: y0 + dy }), isLocked: false, linkedName: null },
          { anchor: r3({ x: x1, y: y1 }), prevControl: r3({ x: x1 - dx, y: y1 - dy }), nextControl: null, isLocked: false, linkedName: null },
        ],
      });
    }

    return {
      waypoints, valid, lastPos, pointAt, sample, nearest, length, bounds, rotationAt, trajectory,
      touch, remapPath, insertWaypoint, appendWaypoint, deleteWaypoint, reversePath, mirrorPath, complete, missingKeys, blank,
    };
  })();

  /** Visits every command in a PathPlanner auto or event marker command tree. */
  function walkPP(cmd, fn) {
    if (!cmd || typeof cmd !== 'object') return;
    fn(cmd);
    const kids = cmd.data && Array.isArray(cmd.data.commands) ? cmd.data.commands : [];
    kids.forEach((k) => walkPP(k, fn));
  }

  /** A spot on a path where something happens: the robot stops there, or runs an action while driving. */
  function newPathSpot(kind, opts) {
    return Object.assign({
      id: uid('h'), pos: 0, kind: kind === 'drive' ? 'drive' : 'stop', do: 'action', target: '', action: '',
      mode: 'finish', until: 'pathEnd', endPos: '', seconds: 1, condition: '',
    }, opts || {});
  }

  /** A small example path for the example robot, in PathPlanner's .path format. */
  function examplePath() {
    const wp = (ax, ay, prev, next) => ({
      anchor: { x: ax, y: ay }, prevControl: prev ? { x: prev[0], y: prev[1] } : null,
      nextControl: next ? { x: next[0], y: next[1] } : null, isLocked: false, linkedName: null,
    });
    const limits = { maxVelocity: 3.0, maxAcceleration: 3.0, maxAngularVelocity: 540.0, maxAngularAcceleration: 720.0, nominalVoltage: 12.0, unlimited: false };
    return {
      version: '2025.0',
      waypoints: [wp(3.4, 6.0, null, [4.6, 6.0]), wp(6.2, 6.1, [5.2, 6.1], [7.0, 6.1]), wp(7.8, 4.9, [7.7, 5.6], null)],
      rotationTargets: [],
      constraintZones: [],
      pointTowardsZones: [],
      eventMarkers: [],
      globalConstraints: limits,
      goalEndState: { velocity: 0, rotation: -45.0 },
      reversed: false,
      folder: null,
      idealStartingState: { velocity: 0, rotation: 0.0 },
      useDefaultConstraints: true,
    };
  }

  /* ================================================================ model */

  /** Writes tag numbers short for comments: [1, 2, 3, 5] becomes "1-3, 5". */
  function idText(ids) {
    const sorted = Array.from(new Set(ids)).sort((a, b) => a - b);
    const out = [];
    for (let n = 0; n < sorted.length; n++) {
      let end = n;
      while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
      out.push(end - n >= 2 ? `${sorted[n]}-${sorted[end]}` : sorted.slice(n, end + 1).join(', '));
      n = end;
    }
    return out.join(', ');
  }

  /** Reads a whitespace/comma list like "1-12, 13" into numbers. */
  function parseIdList(text) {
    const out = [];
    String(text || '').split(/[\s,;]+/).forEach((part) => {
      if (!part) return;
      const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        const a = +m[1]; const z = +m[2];
        if (z >= a && z - a < 64) for (let x = a; x <= z; x++) out.push(x);
      } else if (/^\d+$/.test(part)) out.push(+part);
    });
    return out;
  }

  function controllerOf(sub) {
    const m = MOTORS[sub.motor] || MOTORS.krakenX60;
    if (sub.motor === 'neoVortex' && sub.vortexController === 'sparkmax') return 'sparkmax';
    return m.ctrl;
  }

  /**
   * Works out every name, action and check for a robot. The page uses this for
   * dropdowns and warnings, and the generator uses it to write code.
   */
  function buildModel(robotIn) {
    const robot = robotIn || newRobot();
    const project = Object.assign({}, newRobot().project, robot.project || {});
    const issues = [];
    const warn = (text, target, level) => issues.push({ level: level || 'warn', text, target: target || null });

    const classUsed = new Set(RESERVED_CLASSES.map((x) => x.toLowerCase()));
    const fieldUsed = new Set(['driver', 'drivetrain', 'drive', 'brake', 'logger', 'maxspeed', 'maxangularrate', 'autos',
      'vision', 'combos', 'compressor', 'aimdrive']
      .map((x) => x.toLowerCase()));
    const constClassUsed = new Set(['operatorconstants', 'driveconstants']);

    // ---------- controllers
    const controllers = arr(robot.controllers).map((ctl, idx) => {
      const type = CONTROLLER_TYPES[ctl.type] ? ctl.type : 'xbox';
      const label = str(ctl.name, '').trim() || 'Controller ' + (idx + 1);
      let field = camel(label) || 'controller';
      if (JAVA_KEYWORDS.has(field) || /^[0-9]/.test(field)) field = 'controller' + pascal(label);
      if (field === 'driver' && idx > 0) field = 'driverController';
      if (idx === 0 && field === 'driver') fieldUsed.delete('driver');
      field = unique(field, fieldUsed);
      return {
        id: ctl.id, src: ctl, label, type, port: int(ctl.port, idx), field,
        cls: CONTROLLER_TYPES[type].cls,
        portConst: 'k' + cap(field) + 'Port',
      };
    });
    const ctlById = new Map(controllers.map((x) => [x.id, x]));

    // ---------- subsystems
    const subsystems = arr(robot.subsystems).filter((s) => PRESETS[s.preset]).map((src, idx) => {
      const label = str(src.name, '').trim() || PRESETS[src.preset].defaultName;
      let cls = pascal(label);
      if (!cls || /^[0-9]/.test(cls)) cls = PRESETS[src.preset].defaultName + (cls || idx + 1);
      if (classUsed.has(cls.toLowerCase())) cls = cls + 'Subsystem';
      cls = unique(cls, classUsed);
      let field = camel(cls);
      if (JAVA_KEYWORDS.has(field)) field = field + 'Subsystem';
      field = unique(field, fieldUsed);
      const constClass = unique(cls + 'Constants', constClassUsed);
      const noMotor = !!PRESETS[src.preset].noMotor;
      const ctrl = noMotor ? null : controllerOf(src);
      const vendor = noMotor ? null : CONTROLLERS[ctrl].vendor;
      const m = {
        id: src.id, src, kind: 'subsystem', preset: src.preset, label, cls, field, constClass, ctrl, vendor, noMotor,
        motorLabel: noMotor ? '' : (MOTORS[src.motor] || MOTORS.krakenX60).label,
        gains: noMotor ? {} : Object.assign({}, defaultGains(src.preset, vendor), (src.gains || {})[vendor] || {}),
        methodsUsed: new Set(RESERVED_METHODS),
        actions: [],
        conditions: [],
      };
      if (cls !== pascal(label)) {
        warn(`"${label}" becomes the Java class ${cls} so it can't clash with other names.`, { kind: 'subsystem', id: src.id }, 'info');
      }
      const followers = noMotor ? [] : arr(src.followers);
      m.followers = followers.map((f, n) => {
        const one = followers.length === 1;
        return {
          src: f,
          field: one ? 'follower' : 'follower' + (n + 1),
          idConst: one ? 'kFollowerId' : 'kFollower' + (n + 1) + 'Id',
          oppConst: one ? 'kFollowerOpposesLeader' : 'kFollower' + (n + 1) + 'OpposesLeader',
        };
      });
      describeActions(m, warn, project);
      return m;
    });
    const subById = new Map(subsystems.map((x) => [x.id, x]));

    // ---------- lights
    const lights = arr(robot.lights).filter((l) => LIGHT_TYPES[l.type]).map((src, idx) => {
      const label = str(src.name, '').trim() || 'LEDs';
      let cls = pascal(label);
      if (!cls || /^[0-9]/.test(cls)) cls = 'LEDs' + (cls || idx + 1);
      if (classUsed.has(cls.toLowerCase())) cls = cls + 'Subsystem';
      cls = unique(cls, classUsed);
      let field = camel(cls);
      if (JAVA_KEYWORDS.has(field)) field = field + 'Subsystem';
      field = unique(field, fieldUsed);
      const constClass = unique(cls + 'Constants', constClassUsed);
      const m = {
        id: src.id, src, kind: 'light', type: src.type, label, cls, field, constClass,
        methodsUsed: new Set(RESERVED_METHODS), actions: [],
      };
      arr(src.signals).forEach((sg, n) => {
        const method = uniqueMethod(m, camel(sg.name), 'signal' + (n + 1));
        m.actions.push({ key: 'signal:' + sg.id, label: str(sg.name, 'Signal'), method, signal: sg, pp: str(sg.name, 'Signal'), finishes: false });
      });
      return m;
    });
    const lightById = new Map(lights.map((x) => [x.id, x]));

    // ---------- PathPlanner paths imported into (or made in) the app
    const pathNames = new Set();
    const paths = arr(robot.paths).filter((p) => p && typeof p.name === 'string' && p.name.trim() && PathGeom.valid(p.data)).map((p) => {
      const name = p.name.trim();
      if (pathNames.has(name)) warn(`Two paths are named "${name}". Only the first one is used.`, { kind: 'paths' });
      pathNames.add(name);
      return { id: p.id, name, data: p.data, last: PathGeom.lastPos(p.data), fromApp: !!p.fromApp };
    });

    // ---------- vision and button combos
    paths.forEach((p) => {
      const missing = PathGeom.missingKeys(p.data);
      if (missing.length && !p.fromApp) {
        warn(`${p.name}.path is from an older PathPlanner (it has no ${missing.join(', ')}). Open it in PathPlanner 2026 and save it, or the robot code can't load it.`, { kind: 'paths' });
      }
    });
    const ppAutos = arr(robot.ppAutos).filter((a) => a && typeof a.name === 'string' && a.data && a.data.command).map((a) => {
      const usedPaths = [];
      const usedNamed = [];
      walkPP(a.data.command, (c) => {
        const d = c.data || {};
        if (c.type === 'path' && typeof d.pathName === 'string' && !usedPaths.includes(d.pathName)) usedPaths.push(d.pathName);
        if (c.type === 'named' && typeof d.name === 'string' && !usedNamed.includes(d.name)) usedNamed.push(d.name);
      });
      return { id: a.id, name: a.name, data: a.data, paths: usedPaths, named: usedNamed, resetOdom: !!a.data.resetOdom, choreo: !!a.data.choreoAuto };
    });

    const vision = buildVision(robot, project, warn);
    if (vision) attachTables(vision, subsystems, warn);
    const stepCtx = buildStepContext(subsystems, lights, vision);
    const combos = buildCombos(robot, stepCtx, warn);
    if (vision) {
      // A zone can run an action while the robot is inside it.
      const all = subsystems.concat(lights, [vision], combos.actions.length ? [combos] : []);
      vision.zones.forEach((z) => {
        if (!z.src.runTarget || !z.src.runAction) return;
        const t = all.find((x) => x.id === z.src.runTarget);
        if (z.src.runAction === 'value' && t && TABLE_TARGETS[t.preset]) {
          // "Set Shooter to 3000 RPM while in the zone"
          const T = TABLE_TARGETS[t.preset];
          z.value = num(z.src.runValue, 0);
          supplierCall(t, '', '0');
          const constName = `VisionConstants.k${z.key}ZoneValue`;
          z.run = { t, a: { key: 'value', label: `${T.zoneLabel} (${z.value} ${T.unit})`, expr: (p) => supplierCall(t, p, constName) } };
          return;
        }
        const a = t && t.actions.find((x) => x.key === z.src.runAction);
        if (!a) { warn(`AprilTag zone "${z.label}": the action it runs no longer exists, so that part was left out.`, { kind: 'vision' }); return; }
        z.run = { t, a };
      });
    }

    // ---------- conditions the LED rules can use
    const conditions = [
      { key: 'disabled', label: 'Robot is disabled', expr: 'DriverStation.isDisabled()', ds: true },
      { key: 'auto', label: 'Autonomous is running', expr: 'DriverStation.isAutonomousEnabled()', ds: true },
      { key: 'teleop', label: 'Teleop is running', expr: 'DriverStation.isTeleopEnabled()', ds: true },
    ];
    subsystems.forEach((m) => m.conditions.forEach((cd) => conditions.push(cd)));
    if (vision) vision.conditions.forEach((cd) => conditions.push(cd));
    const condByKey = new Map(conditions.map((x) => [x.key, x]));

    // ---------- rumble alerts
    const rumbles = [];
    arr(robot.rumbles).forEach((rb) => {
      if (!rb) return;
      const ctl = ctlById.get(rb.controllerId);
      const cond = condByKey.get(rb.when);
      if (!ctl || !cond) { warn('A rumble alert is missing its controller or what it waits for, so it was left out.', { kind: 'controls' }); return; }
      rumbles.push({ src: rb, ctl, cond, seconds: Math.min(3, positive(rb.seconds, 0.4)), strength: Math.min(1, Math.max(0.05, num(rb.strength, 60) / 100)) });
    });

    // ---------- drive
    const drive = Object.assign({}, newRobot().drive, robot.drive || {});
    const driveCtl = project.tunerSwerve ? (ctlById.get(drive.controllerId) || controllers[0] || null) : null;
    if (project.tunerSwerve && !driveCtl) warn('Add a controller so the swerve drive has something to drive with.', { kind: 'controls' }, 'error');

    // ---------- bindings
    const bindings = [];
    const bindSeen = new Map();
    arr(robot.bindings).forEach((bd) => {
      const ctl = ctlById.get(bd.controllerId);
      const target = subById.get(bd.target) || lightById.get(bd.target) ||
        (bd.target === 'vision' ? vision : null) || (bd.target === 'combos' && combos.actions.length ? combos : null);
      const action = target && target.actions.find((a) => a.key === bd.action);
      const btn = ctl && BUTTONS[ctl.type].find((x) => x[0] === bd.button);
      const when = WHEN[bd.when] ? bd.when : 'pressed';
      if (!ctl || !target || !action || !btn) {
        warn('A button binding is missing its controller, button, subsystem or action, so it was left out of the code.', { kind: 'controls' });
        return;
      }
      const key = ctl.id + '|' + bd.button + '|' + when + '|' + target.id;
      if (bindSeen.has(key)) {
        warn(`${ctl.label} ${btn[1]} (${WHEN[when].label}) runs two ${target.label} actions. Only the last one will win.`, { kind: 'controls' });
      }
      bindSeen.set(key, true);
      bindings.push({ src: bd, ctl, target, action, button: bd.button, buttonLabel: btn[1], when });
    });

    // Drive button conflicts
    const driveButtons = [];
    if (driveCtl) {
      const names = BUTTONS[driveCtl.type].map((x) => x[0]);
      const pick = (key, idx) => (names.includes(drive[key]) ? drive[key] : (drive[key] === 'none' ? 'none' : DRIVE_BUTTON_DEFAULTS[driveCtl.type][idx]));
      drive.resetButton = pick('resetButton', 0);
      drive.brakeButton = pick('brakeButton', 1);
      drive.slowButton = pick('slowButton', 2);
      drive.aimButton = vision && names.includes(drive.aimButton) ? drive.aimButton : 'none';
      [['resetButton', 'reset the field heading'], ['brakeButton', 'lock the wheels'], ['slowButton', 'slow mode'], ['aimButton', 'aim at AprilTags']].forEach(([k, what]) => {
        if (drive[k] !== 'none') driveButtons.push({ button: drive[k], what });
      });
      if (drive.sysId && driveCtl.type === 'xbox') {
        ['back', 'start', 'x', 'y'].forEach((bt) => driveButtons.push({ button: bt, what: 'SysId tests', combo: true }));
      }
      bindings.forEach((bd) => {
        if (bd.ctl.id !== driveCtl.id) return;
        const clash = driveButtons.find((x) => x.button === bd.button && !x.combo);
        if (clash) warn(`${bd.ctl.label} ${bd.buttonLabel} is already used to ${clash.what}. Pick another button for ${bd.target.label}: ${bd.action.label}.`, { kind: 'controls' });
      });
      const seenDrive = new Set();
      driveButtons.filter((x) => !x.combo).forEach((x) => {
        if (seenDrive.has(x.button)) warn('Two drive features use the same button. Give each its own button.', { kind: 'controls' });
        seenDrive.add(x.button);
      });
    }

    // ---------- light rules
    lights.forEach((lt) => {
      lt.rules = arr(lt.src.rules).map((rule) => {
        const cond = condByKey.get(rule.when);
        if (!cond) {
          warn(`${lt.label}: one status rule points at something that no longer exists, so it was skipped.`, { kind: 'light', id: lt.id });
          return null;
        }
        return { cond, pattern: LED_PATTERNS[rule.pattern] ? rule.pattern : 'solid', color: LED_COLOR_KEYS.includes(rule.color) ? rule.color : 'WHITE' };
      }).filter(Boolean);
      const o = lt.src.otherwise || {};
      lt.otherwise = { pattern: LED_PATTERNS[o.pattern] ? o.pattern : 'off', color: LED_COLOR_KEYS.includes(o.color) ? o.color : 'WHITE' };
    });

    // ---------- devices and port checks
    const devices = [];
    const addDev = (bus, id, what, owner, ownerRef, vendor) => devices.push({ bus, id: int(id, -1), what, owner, ownerRef, vendor });
    const pistons = subsystems.filter((m) => m.preset === 'piston');
    const pneumatics = pistons.length ? {
      type: project.pneumaticsModule === 'ctrepcm' ? 'CTREPCM' : 'REVPH',
      label: project.pneumaticsModule === 'ctrepcm' ? 'PCM' : 'PH',
      name: project.pneumaticsModule === 'ctrepcm' ? 'CTRE Pneumatics Control Module' : 'REV Pneumatic Hub',
      channels: project.pneumaticsModule === 'ctrepcm' ? 8 : 16,
      canId: int(project.pneumaticsCanId, project.pneumaticsModule === 'ctrepcm' ? 0 : 1),
      analog: project.pneumaticsModule !== 'ctrepcm' && project.compressor === 'analog',
      minPsi: Math.min(120, Math.max(0, num(project.minPsi, 80))),
      maxPsi: Math.min(120, Math.max(0, num(project.maxPsi, 120))),
    } : null;
    if (pneumatics) {
      addDev('can', pneumatics.canId, pneumatics.name, 'Pneumatics', { kind: 'robot' }, 'rio');
      if (pneumatics.analog && pneumatics.minPsi >= pneumatics.maxPsi) warn('Pneumatics: the compressor turn-on pressure must be below the turn-off pressure.', { kind: 'robot' }, 'error');
    }
    subsystems.forEach((m) => {
      const s = m.src;
      const ref = { kind: 'subsystem', id: m.id };
      if (m.preset === 'piston') {
        if (s.solenoid === 'single') addDev('pneu', s.channel, 'Solenoid', m.label, ref);
        else {
          addDev('pneu', s.forwardChannel, 'Solenoid (extend side)', m.label, ref);
          addDev('pneu', s.reverseChannel, 'Solenoid (retract side)', m.label, ref);
        }
        return;
      }
      const motorWhat = `${m.motorLabel} (${CONTROLLERS[m.ctrl].label})`;
      addDev('can', s.canId, motorWhat + ', main motor', m.label, ref, m.vendor);
      m.followers.forEach((f) => addDev('can', f.src.canId, motorWhat + ', follower', m.label, ref, m.vendor));
      if (s.preset === 'roller' && s.sensor) {
        if (s.sensor.type === 'dio') addDev('dio', s.sensor.dio, 'Game piece sensor', m.label, ref);
        if (s.sensor.type === 'canrange') addDev('can', s.sensor.canId, 'CANrange (game piece sensor)', m.label, ref, 'ctre');
      }
      if (s.preset === 'elevator' && s.limitSwitch && s.limitSwitch.enabled) addDev('dio', s.limitSwitch.dio, 'Bottom limit switch', m.label, ref);
      if (s.preset === 'arm') {
        if (s.encoder === 'throughboreDio') addDev('dio', s.encoderDio, 'Through Bore Encoder (absolute)', m.label, ref);
        if (s.encoder === 'cancoder') addDev('can', s.cancoderId, 'CANcoder', m.label, ref, 'ctre');
      }
    });
    lights.forEach((lt) => {
      const ref = { kind: 'light', id: lt.id };
      if (lt.type === 'candle') addDev('can', lt.src.canId, 'CANdle', lt.label, ref, 'ctre');
      else addDev('pwm', lt.src.pwmPort, lt.type === 'blinkin' ? 'REV Blinkin' : 'Addressable LED strip', lt.label, ref);
    });
    controllers.forEach((ctl) => addDev('usb', ctl.port, CONTROLLER_TYPES[ctl.type].label, ctl.label, { kind: 'controls' }));

    const swerveIds = project.tunerSwerve ? parseIdList(project.swerveIds) : [];
    const ctreBus = str(project.ctreBus, 'rio').trim() || 'rio';
    const swerveBus = str(project.swerveBus, 'rio').trim() || 'rio';
    const canBusOf = (dev) => (dev.vendor === 'ctre' ? ctreBus : 'rio');

    const groups = new Map();
    devices.forEach((dev) => {
      const k = dev.bus === 'can' ? 'can:' + canBusOf(dev) + ':' + dev.id : dev.bus + ':' + dev.id;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(dev);
    });
    const busNames = { can: 'CAN ID', dio: 'DIO port', pwm: 'PWM port', usb: 'controller port', pneu: 'Solenoid channel' };
    groups.forEach((list) => {
      if (list.length < 2) return;
      const dev = list[0];
      const who = list.map((x) => `${x.owner} (${x.what})`).join(' and ');
      warn(`${busNames[dev.bus]} ${dev.id} is used twice: ${who}. Each one needs its own number.`, dev.ownerRef, 'error');
    });
    devices.forEach((dev) => {
      if (dev.bus === 'can') {
        if (dev.id < 0 || dev.id > 62) warn(`${dev.owner}: CAN ID ${dev.id} is out of range. Use 1 to 62.`, dev.ownerRef, 'error');
        else if (dev.id === 0) warn(`${dev.owner}: CAN ID 0 is the factory default. Give the ${dev.what} its own ID from 1 to 62.`, dev.ownerRef);
        if (canBusOf(dev) === swerveBus && swerveIds.includes(dev.id)) {
          warn(`${dev.owner}: CAN ID ${dev.id} is also used by the swerve drive.`, dev.ownerRef, 'error');
        }
      }
      if (dev.bus === 'dio' && (dev.id < 0 || dev.id > 25)) warn(`${dev.owner}: DIO port ${dev.id} doesn't exist. The roboRIO has 0 to 9 (10 to 25 on the MXP).`, dev.ownerRef, 'error');
      if (dev.bus === 'pwm' && (dev.id < 0 || dev.id > 19)) warn(`${dev.owner}: PWM port ${dev.id} doesn't exist. The roboRIO has 0 to 9 (10 to 19 on the MXP).`, dev.ownerRef, 'error');
      if (dev.bus === 'usb' && (dev.id < 0 || dev.id > 5)) warn(`${dev.owner}: controller port ${dev.id} doesn't exist. The Driver Station has ports 0 to 5.`, dev.ownerRef, 'error');
      if (dev.bus === 'pneu' && pneumatics && (dev.id < 0 || dev.id >= pneumatics.channels)) {
        warn(`${dev.owner}: solenoid channel ${dev.id} doesn't exist. The ${pneumatics.label} has channels 0 to ${pneumatics.channels - 1}.`, dev.ownerRef, 'error');
      }
    });
    if (lights.filter((x) => x.type === 'strip').length > 1) {
      warn('The roboRIO can only run one addressable LED strip. Chain the strips together on one PWM port instead.', { kind: 'light', id: lights.filter((x) => x.type === 'strip')[1].id }, 'error');
    }

    // ---------- value checks
    subsystems.forEach((m) => checkValues(m, warn));
    lights.forEach((lt) => {
      const s = lt.src;
      if (lt.type === 'candle' && !s.includeOnboard && int(s.stripLength, 0) <= 0) {
        warn(`${lt.label}: turn on the CANdle's own LEDs or add a strip length, or there's nothing to light.`, { kind: 'light', id: lt.id });
      }
      if (lt.type === 'strip' && int(s.stripLength, 0) <= 0) warn(`${lt.label}: set how many LEDs are on the strip.`, { kind: 'light', id: lt.id }, 'error');
      if (lt.type === 'blinkin' && lt.rules.some((r) => r.cond.key === 'disabled')) {
        warn(`${lt.label}: the Blinkin can't change while the robot is disabled, because the roboRIO turns PWM off. Its "disabled" rule won't show.`, { kind: 'light', id: lt.id }, 'info');
      }
    });

    const autos = buildAutos(robot, project, stepCtx, combos, warn, paths);
    // Named commands in PathPlanner's own autos and markers must match the ones the code registers.
    if (autos.usePP) {
      const registered = new Set(autos.named.map((n) => n.name));
      const unknown = (names) => names.filter((n) => !registered.has(n)).map((n) => `"${n}"`);
      ppAutos.forEach((a) => {
        const bad = unknown(a.named);
        if (bad.length) {
          warn(`PathPlanner auto "${a.name}" uses ${bad.join(', ')}, which the code doesn't register, so ${bad.length > 1 ? 'they do' : 'it does'} nothing on the robot. Use a name from the list under Auto settings.`, { kind: 'paths' });
        }
        const noPath = a.paths.filter((n) => !paths.some((p) => p.name === n));
        if (noPath.length) warn(`PathPlanner auto "${a.name}" follows ${noPath.map((n) => `"${n}"`).join(', ')}. Import ${noPath.length > 1 ? 'those .path files' : 'that .path file'} to see it in the simulator.`, { kind: 'paths' }, 'info');
        if (autos.routines.some((r) => r.chooserName === a.name)) warn(`A routine and a PathPlanner auto are both named "${a.name}". Rename one so the auto chooser shows both.`, { kind: 'paths' });
      });
      paths.forEach((p) => {
        const names = [];
        arr(p.data.eventMarkers).forEach((m) => walkPP(m && m.command, (c) => { if (c.type === 'named' && c.data && typeof c.data.name === 'string') names.push(c.data.name); }));
        const bad = unknown(Array.from(new Set(names)));
        if (bad.length) warn(`Path "${p.name}" has event markers that run ${bad.join(', ')}, which the code doesn't register.`, { kind: 'paths' });
      });
    }

    const hasCtre = subsystems.some((m) => m.vendor === 'ctre' ||
      (m.preset === 'roller' && m.src.sensor && m.src.sensor.type === 'canrange') ||
      (m.preset === 'arm' && m.src.encoder === 'cancoder')) || lights.some((l) => l.type === 'candle');
    const hasRev = subsystems.some((m) => m.vendor === 'rev');

    return {
      robot, project, controllers, subsystems, lights, bindings, conditions, drive, driveCtl, driveButtons, autos,
      vision, combos, stepCtx, pneumatics, rumbles, paths, ppAutos, devices, issues, hasCtre, hasRev, ctreBus,
      find(kind, id) { return kind === 'light' ? lightById.get(id) : subById.get(id); },
    };
  }

  /**
   * What steps (in combos and autos) can use: subsystems, lights and vision, plus what
   * "Wait until" can wait for. Steps run inside Autos.java and Combos.java, so they reach
   * everything through RobotContainer ("robot.").
   */
  function buildStepContext(subsystems, lights, vision) {
    const targets = subsystems.concat(lights, vision ? [vision] : []);
    const conditions = [];
    subsystems.forEach((m) => {
      if (m.preset === 'roller' && m.src.sensor && m.src.sensor.type !== 'none') {
        conditions.push({ key: 'piece:' + m.id, label: `${m.label} has a game piece`, expr: `robot.${m.field}.hasGamePiece()` });
      }
      if (m.preset === 'flywheel') conditions.push({ key: 'atspeed:' + m.id, label: `${m.label} is at speed`, expr: `robot.${m.field}.atSpeed()` });
      if (m.preset === 'elevator' || m.preset === 'arm') {
        conditions.push({ key: 'attarget:' + m.id, label: `${m.label} reached its target`, expr: `robot.${m.field}.atTarget()` });
      }
      if (m.preset === 'piston') conditions.push({ key: 'extended:' + m.id, label: `${m.label} is extended`, expr: `robot.${m.field}.isExtended()` });
    });
    if (vision) {
      conditions.push({ key: 'vision:target', label: 'Vision sees an AprilTag', expr: 'robot.vision.hasTarget()' });
      conditions.push({ key: 'vision:aimed', label: 'Vision is aimed at the tag', expr: 'robot.vision.isAimed()' });
      vision.zones.forEach((z) => conditions.push({ key: 'zone:' + z.id, label: `Robot is in ${z.label}`, expr: `robot.vision.${z.method}()` }));
    }
    return { targets, conditions };
  }

  /** Checks saved steps and resolves what they point at. Bad steps are skipped with a warning. */
  function normalizeSteps(rawSteps, label, ref, ctx, opts, warn) {
    const clampSecs = (v, def) => Math.min(15, Math.max(0.02, positive(v, def)));
    const steps = [];
    let firstPathSeen = false;
    arr(rawSteps).forEach((st, sIdx) => {
      const where = `${label}, step ${sIdx + 1}`;
      if (!st || !STEP_TYPES[st.type]) { warn(`${where}: unknown step, skipped.`, ref); return; }
      if (st.type === 'drive') {
        if (!opts.drive) {
          warn(`${where}: ${opts.combo ? 'drive steps only work in autos' : 'driving needs the Tuner X swerve drive (Robot settings)'}, so this step was skipped.`, ref);
          return;
        }
        const dir = DRIVE_DIRS[st.direction] ? st.direction : 'forward';
        const speed = Math.min(5, positive(st.speed, 1));
        const [vx, vy] = DRIVE_DIRS[dir].vec;
        steps.push({ type: 'drive', dir, speed, x: vx * speed, y: vy * speed, seconds: clampSecs(st.seconds, 1) });
      } else if (st.type === 'action') {
        const t = ctx.targets.find((x) => x.id === st.target);
        const a = t && t.actions.find((x) => x.key === st.action && x.pp);
        if (!a) { warn(`${where}: the action it ran no longer exists, so this step was skipped.`, ref); return; }
        let mode = ACTION_MODES[st.mode] ? st.mode : 'time';
        const seconds = clampSecs(st.seconds, 1);
        if (mode === 'finish' && !a.finishes) {
          warn(`${where}: "${t.label}: ${a.label}" never finishes by itself, so it runs for ${seconds} s instead.`, ref);
          mode = 'time';
        }
        steps.push({ type: 'action', target: t, action: a, mode, seconds });
      } else if (st.type === 'wait') {
        steps.push({ type: 'wait', seconds: clampSecs(st.seconds, 0.5) });
      } else if (st.type === 'until') {
        const cond = ctx.conditions.find((x) => x.key === st.condition);
        if (!cond) { warn(`${where}: what it waited for no longer exists, so this step was skipped.`, ref); return; }
        steps.push({ type: 'until', cond, seconds: clampSecs(st.seconds, 3) });
      } else if (st.type === 'path') {
        if (!opts.path) {
          const why = opts.combo ? 'path steps only work in autos' : opts.drive ? 'following a path needs PathPlanner turned on' : 'following a path needs the Tuner X swerve drive and PathPlanner';
          warn(`${where}: ${why}, so this step was skipped.`, ref);
          return;
        }
        const pathName = str(st.pathName, '').trim().replace(/\.path$/i, '');
        if (!pathName) { warn(`${where}: type the name of the path from PathPlanner.`, ref); return; }
        const known = arr(ctx.paths);
        const info = known.find((p) => p.name === pathName) || null;
        const nearly = !info && known.find((p) => p.name.toLowerCase() === pathName.toLowerCase());
        if (nearly) warn(`${where}: the path is called "${nearly.name}". Capital letters matter on the robot.`, ref);
        const spots = normalizeSpots(st.spots, where, ref, ctx, info, warn);
        if (spots.length && !info) warn(`${where}: import "${pathName}.path" (Autonomous > Paths) to see where its actions are.`, ref, 'info');
        steps.push({ type: 'path', pathName, resetPose: !!st.resetPose, spots, path: info });
        if (!firstPathSeen && !st.resetPose) {
          warn(`${where}: the first path usually starts by setting the robot's position to the path's start. Check "Start here" unless an earlier step already did.`, ref, 'info');
        }
        firstPathSeen = true;
      }
    });
    return steps;
  }

  /** True when an action moves the drivetrain, so it can't run while a path is driving. */
  function drivesRobot(t, a) {
    if (t.kind === 'vision') return true;
    return t.kind === 'combos' && !!a.combo && a.combo.steps.some((s) => s.type === 'action' && s.target.kind === 'vision');
  }

  /** Checks the actions placed along a path step and resolves what they point at. */
  function normalizeSpots(raw, where, ref, ctx, info, warn) {
    const clampSecs = (v, def) => Math.min(15, Math.max(0.02, positive(v, def)));
    const out = [];
    arr(raw).forEach((sp, k) => {
      if (!sp) return;
      const at = `${where}, path action ${k + 1}`;
      let pos = num(sp.pos, NaN);
      if (!Number.isFinite(pos)) { warn(`${at}: pick a spot on the path for it.`, ref); return; }
      pos = Math.max(0, pos);
      if (info && pos > info.last + 1e-6) {
        warn(`${at} is past the end of "${info.name}", which ends at ${info.last}. It was skipped.`, ref);
        return;
      }
      pos = +pos.toFixed(3);
      if (sp.kind === 'stop') {
        if (sp.do === 'wait') { out.push({ kind: 'stop', pos, do: 'wait', seconds: clampSecs(sp.seconds, 1) }); return; }
        if (sp.do === 'until') {
          const cond = ctx.conditions.find((x) => x.key === sp.condition);
          if (!cond) { warn(`${at}: what it waits for no longer exists, so it was skipped.`, ref); return; }
          out.push({ kind: 'stop', pos, do: 'until', cond, seconds: clampSecs(sp.seconds, 3) });
          return;
        }
      }
      const t = ctx.targets.find((x) => x.id === sp.target);
      const a = t && t.actions.find((x) => x.key === sp.action && x.pp);
      if (!a) { warn(`${at}: the action it ran no longer exists, so it was skipped.`, ref); return; }
      const seconds = clampSecs(sp.seconds, 1);
      if (sp.kind === 'stop') {
        const mode = sp.mode === 'finish' && a.finishes ? 'finish' : 'time';
        if (sp.mode === 'finish' && !a.finishes) {
          warn(`${at}: "${t.label}: ${a.label}" never finishes by itself, so the robot runs it for ${seconds} s there.`, ref);
        }
        out.push({ kind: 'stop', pos, do: 'action', target: t, action: a, mode, seconds });
        return;
      }
      if (drivesRobot(t, a)) {
        warn(`${at}: "${t.label}: ${a.label}" drives the robot, so it can't run while the path drives. Make it a stop instead.`, ref);
        return;
      }
      let until = ['spot', 'pathEnd', 'time', 'keep'].includes(sp.until) ? sp.until : 'pathEnd';
      let endPos = null;
      if (until === 'spot') {
        endPos = num(sp.endPos, NaN);
        if (info && endPos > info.last) endPos = info.last;
        if (!(endPos > pos + 1e-6)) {
          warn(`${at}: its end spot must come after where it starts, so it runs until the robot stops instead.`, ref);
          until = 'pathEnd';
          endPos = null;
        } else endPos = +endPos.toFixed(3);
      }
      out.push({ kind: 'drive', pos, target: t, action: a, until, endPos, seconds });
    });
    out.sort((x, y) => x.pos - y.pos);
    out.forEach((x) => {
      if (x.kind !== 'drive' || x.until !== 'spot') return;
      const stop = out.find((y) => y.kind === 'stop' && y.pos > x.pos + 1e-6 && y.pos < x.endPos - 1e-6);
      if (stop) warn(`${where}: "${x.target.label}: ${x.action.label}" ends at the stop at ${stop.pos}, because the robot stops there.`, ref, 'info');
    });
    return out;
  }

  /** AprilTag vision with Limelights. Returns null when there are no cameras or no swerve. */
  function buildVision(robot, project, warn) {
    const src = Object.assign({}, newVision(), robot.vision || {});
    const cams = arr(src.cameras);
    const ref = { kind: 'vision' };
    if (!cams.length) return null;
    if (!project.tunerSwerve) {
      warn('AprilTag vision needs the Tuner X swerve drive (Robot settings), so it was left out of the code.', ref);
      return null;
    }
    const keysUsed = new Set();
    const namesUsed = new Set();
    const cameras = cams.map((cam, idx) => {
      const name = str(cam.name, '').trim() || 'limelight';
      let key = pascal(name.replace(/^limelight-?/i, '')) || (idx ? 'Camera' + (idx + 1) : 'Main');
      if (/^[0-9]/.test(key)) key = 'Camera' + key;
      key = unique(key, keysUsed);
      if (namesUsed.has(name.toLowerCase())) warn(`Two cameras are named "${name}". Each Limelight needs its own name.`, ref, 'error');
      namesUsed.add(name.toLowerCase());
      if (!/^limelight(-[a-z0-9]+)?$/i.test(name)) {
        warn(`Camera "${name}": Limelight names look like "limelight" or "limelight-front". Check the name on the Limelight's web page.`, ref);
      }
      return {
        src: cam, name, key, megaTag2: cam.megaTag2 !== false,
        trust: positive(cam.trust, 0.7), maxDistance: positive(cam.maxDistance, 4),
      };
    });
    const aimIdx = Math.max(0, cams.findIndex((c) => c && c.aim));
    const m = {
      kind: 'vision', id: 'vision', label: 'Vision', field: 'vision', cls: 'Vision', constClass: 'VisionConstants',
      src, cameras, aimIdx, spots: [], actions: [], methodsUsed: new Set(RESERVED_METHODS),
      aimP: positive(src.aimP, 4), aimTolerance: positive(src.aimTolerance, 2), alignP: positive(src.alignP, 3),
      alignMaxSpeed: positive(src.alignMaxSpeed, 2), headingP: positive(src.headingP, 7),
      alignTolerance: positive(src.alignTolerance, 0.03), alignAngleTolerance: positive(src.alignAngleTolerance, 2),
    };
    m.actions.push({ key: 'aim', label: 'Turn to face the tag', method: 'aimAtTag', pp: 'Aim at Tag', finishes: true, finishLabel: 'Until it faces the tag' });
    arr(src.spots).forEach((sp, n) => {
      const label = str(sp.name, '').trim() || 'Spot ' + (n + 1);
      const ids = parseIdList(sp.tags).filter((x) => x >= 1 && x <= 99);
      if (!ids.length) { warn(`AprilTag spot "${label}" has no tag numbers, so it was left out.`, ref); return; }
      const method = uniqueMethod(m, 'alignTo' + pascal(label), 'alignToSpot' + (n + 1));
      const spot = { src: sp, label, ids, method, distance: num(sp.distance, 0.5), sideways: num(sp.sideways, 0) };
      m.spots.push(spot);
      m.actions.push({ key: 'spot:' + sp.id, label: 'Drive to ' + label, method, pp: 'Align ' + label, finishes: true, finishLabel: 'Until it gets there', spot });
    });

    // Constant names (kNearReefTags...) share one namespace, so keep the keys unique.
    const keysForConsts = new Set(cameras.map((c) => c.key.toLowerCase()));
    m.zones = [];
    arr(src.zones).forEach((z, n) => {
      if (!z) return;
      const label = str(z.name, '').trim() || 'Zone ' + (n + 1);
      const ids = parseIdList(z.tags).filter((x) => x >= 1 && x <= 99);
      if (!ids.length) { warn(`AprilTag zone "${label}" has no tag numbers, so it was left out.`, ref); return; }
      let key = pascal(label).replace(/(.)Zone$/, '$1') || 'Zone' + (n + 1);
      if (/^[0-9]/.test(key)) key = 'Zone' + key;
      key = unique(key, keysForConsts);
      const slowRaw = num(z.slowPct, NaN);
      const slow = Number.isFinite(slowRaw) && slowRaw > 0 && slowRaw < 100 ? slowRaw / 100 : null;
      m.zones.push({ src: z, id: z.id, label, key, ids, distance: positive(z.distance, 1.5), slow, method: uniqueMethod(m, 'in' + pascal(label), 'inZone' + (n + 1)), run: null, value: null });
    });
    m.tables = [];
    arr(src.tables).forEach((tb, n) => {
      if (!tb) return;
      const label = str(tb.name, '').trim() || 'Table ' + (n + 1);
      const ids = parseIdList(tb.tags).filter((x) => x >= 1 && x <= 99);
      const points = arr(tb.points).map((p) => ({ d: num(p.distance, NaN), v: num(p.value, NaN) }))
        .filter((p) => Number.isFinite(p.d) && Number.isFinite(p.v)).sort((a, b) => a.d - b.d);
      if (!ids.length) { warn(`Distance table "${label}" has no tag numbers, so it was left out.`, ref); return; }
      if (!points.length) { warn(`Distance table "${label}" has no distance and value pairs, so it was left out.`, ref); return; }
      let key = pascal(label).replace(/(.)Table$/, '$1') || 'Table' + (n + 1);
      if (/^[0-9]/.test(key)) key = 'Table' + key;
      key = unique(key, keysForConsts);
      m.tables.push({ src: tb, id: tb.id, label, key, ids, points, targetId: tb.target, method: uniqueMethod(m, camel(key) + 'Value', 'table' + (n + 1) + 'Value') });
    });

    m.conditions = [
      { key: 'vision:target', label: 'Vision sees an AprilTag', expr: 'vision.hasTarget()' },
      { key: 'vision:aimed', label: 'Vision is aimed at the tag', expr: 'vision.isAimed()' },
    ].concat(m.zones.map((z) => ({ key: 'zone:' + z.id, label: `Robot is in ${z.label}`, expr: `vision.${z.method}()` })));
    return m;
  }

  /** Subsystems that a distance table or a zone can set to a number, and the method that takes it. */
  const TABLE_TARGETS = {
    flywheel: { unit: 'RPM', method: 'spinUpTo', what: 'speed', zoneLabel: 'Spin at a set speed' },
    elevator: { unit: 'in', method: 'track', what: 'height', zoneLabel: 'Go to a set height' },
    arm: { unit: 'degrees', method: 'track', what: 'angle', zoneLabel: 'Go to a set angle' },
    roller: { unit: '%', method: 'runAt', what: 'speed', zoneLabel: 'Run at a set speed' },
  };
  /** Java that passes a changing number to a subsystem's table method. Rollers take -1 to 1, so % is divided by 100. */
  function supplierCall(m, prefix, valueExpr) {
    const T = TABLE_TARGETS[m.preset];
    m.supplierMethods = m.supplierMethods || new Set();
    m.supplierMethods.add(T.method);
    return `${prefix}${m.field}.${T.method}(() -> ${valueExpr}${m.preset === 'roller' ? ' / 100.0' : ''})`;
  }

  /** Each distance table becomes an action on the subsystem it drives, like "Shooter: Speaker Shot (by distance)". */
  function attachTables(vision, subsystems, warn) {
    vision.tables = vision.tables.filter((tb) => {
      const m = subsystems.find((x) => x.id === tb.targetId);
      if (!m || !TABLE_TARGETS[m.preset]) {
        warn(`Distance table "${tb.label}" needs a shooter, elevator, arm or roller to drive, so it was left out.`, { kind: 'vision' });
        return false;
      }
      const T = TABLE_TARGETS[m.preset];
      tb.target = m;
      tb.unit = T.unit;
      tb.what = T.what;
      // Mark the method as used now, so the subsystem writes it even if only the simulator uses the table.
      supplierCall(m, '', '0');
      m.actions.push({
        key: 'table:' + tb.id, label: /distance/i.test(tb.label) ? tb.label : `${tb.label} (by distance)`,
        pp: /distance/i.test(tb.label) ? tb.label : `${tb.label} by Distance`, finishes: false, table: tb,
        expr: (p) => supplierCall(m, p, `${p}vision.${tb.method}()`),
      });
      return true;
    });
  }

  /** The Java that makes the command for an action. `prefix` is "" in RobotContainer and "robot." elsewhere. */
  function actionCall(target, action, prefix) {
    return action.expr ? action.expr(prefix) : `${prefix}${target.field}.${action.method}()`;
  }

  /** Button combos: several steps in a row on one button. */
  function buildCombos(robot, ctx, warn) {
    const used = new Set(['robot', 'equals', 'hashcode', 'tostring', 'getclass', 'notify', 'notifyall', 'wait', 'finalize', 'clone',
      'rununtildone', 'runfor', 'start', 'waituntil']);
    const target = { kind: 'combos', id: 'combos', label: 'Combos', ppLabel: 'Combo', field: 'combos', cls: 'Combos', actions: [], combos: [] };
    const namesUsed = new Set();
    arr(robot.combos).forEach((cb, idx) => {
      if (!cb) return;
      const label = str(cb.name, '').trim() || 'Combo ' + (idx + 1);
      const ref = { kind: 'combo', id: cb.id };
      if (namesUsed.has(label.toLowerCase())) warn(`Two combos are named "${label}". Give each its own name.`, ref);
      namesUsed.add(label.toLowerCase());
      let method = camel(label);
      if (!method || !/^[a-z]/.test(method) || JAVA_KEYWORDS.has(method)) method = 'combo' + (pascal(label) || idx + 1);
      method = unique(method, used);
      const steps = normalizeSteps(cb.steps, label, ref, ctx, { drive: false, path: false, combo: true }, warn);
      if (!steps.length) warn(`${label} has no steps yet, so it does nothing.`, ref, 'info');
      const c = { id: cb.id, src: cb, label, method, steps };
      target.combos.push(c);
      target.actions.push({ key: 'combo:' + cb.id, label, method, pp: label, finishes: true, finishLabel: 'Until it finishes', combo: c });
    });
    return target;
  }

  /** The autonomous part: named commands for PathPlanner and the routines. */
  function buildAutos(robot, project, ctx, combos, warn, paths) {
    const src = Object.assign({}, newAutos(), robot.autos || {});
    const swerve = !!project.tunerSwerve;
    const usePP = swerve && src.pathPlanner !== false;
    const targets = ctx.targets.concat(combos.actions.length ? [combos] : []);
    const actx = { targets, conditions: ctx.conditions, paths: paths || [] };

    // Every action except jogging and SysId becomes a PathPlanner named command, like "Elevator High".
    const named = [];
    const namedUsed = new Set();
    targets.forEach((t) => t.actions.forEach((a) => {
      if (!a.pp) return;
      const base = ((t.ppLabel || t.label) + ' ' + a.pp).replace(/\s+/g, ' ').trim();
      let name = base;
      for (let n = 2; namedUsed.has(name.toLowerCase()); n++) name = base + ' ' + n;
      namedUsed.add(name.toLowerCase());
      named.push({ name, target: t, action: a });
    }));

    const methodsUsed = new Set(['getSelected', 'configurePathPlanner', 'registerNamedCommands', 'resetHeading',
      'drive', 'runFor', 'runUntilDone', 'start', 'waitUntil', 'followPath', 'robot', 'drivetrain', 'chooser',
      'stopAt', 'whileDriving', 'startAt', 'follow',
      'equals', 'hashCode', 'toString', 'getClass', 'notify', 'notifyAll', 'wait', 'finalize', 'clone'].map((x) => x.toLowerCase()));
    const chooserNames = new Set(['none']);

    const routines = arr(src.routines).map((rt, idx) => {
      const label = str(rt.name, '').trim() || 'Auto ' + (idx + 1);
      const ref = { kind: 'routine', id: rt.id };
      let method = camel(label);
      if (!method || !/^[a-z]/.test(method) || JAVA_KEYWORDS.has(method)) method = 'auto' + (pascal(label) || idx + 1);
      method = unique(method, methodsUsed);
      let chooserName = label;
      if (chooserNames.has(chooserName.toLowerCase())) {
        warn(`Two autos are named "${label}". Give each its own name so the drivers can tell them apart.`, ref);
        for (let n = 2; chooserNames.has(chooserName.toLowerCase()); n++) chooserName = label + ' ' + n;
      }
      chooserNames.add(chooserName.toLowerCase());
      const steps = normalizeSteps(rt.steps, label, ref, actx, { drive: swerve, path: usePP }, warn);
      if (!steps.length) warn(`${label} has no steps yet, so it does nothing.`, ref, 'info');
      const resetHeading = swerve && rt.resetHeading !== false;
      return { id: rt.id, src: rt, label, chooserName, method, steps, resetHeading };
    });

    const def = routines.find((r) => r.id === src.defaultAuto) || null;
    if (src.defaultAuto && !def) warn('The default auto was deleted, so the default is now "None".', { kind: 'autos' });
    return {
      src, swerve, usePP, targets, conditions: ctx.conditions, named, routines, defaultRoutine: def, paths: paths || [],
      enabled: usePP || routines.length > 0,
      translationP: positive(src.translationP, 10),
      rotationP: positive(src.rotationP, 7),
    };
  }

  function uniqueMethod(m, base, fallback) {
    let name = base || fallback;
    if (!/^[a-z]/i.test(name) || JAVA_KEYWORDS.has(name)) name = fallback;
    if (m.methodsUsed.has(name)) name = name + 'Command';
    let out = name;
    let n = 2;
    while (m.methodsUsed.has(out)) out = name + n++;
    m.methodsUsed.add(out);
    return out;
  }

  /** Fills in the bindable actions and LED conditions for a subsystem. */
  function describeActions(m, warn, project) {
    const s = m.src;
    const ref = { kind: 'subsystem', id: m.id };
    const push = (key, label, method, extra) => m.actions.push(Object.assign({ key, label, method }, extra || {}));
    switch (m.preset) {
      case 'piston': {
        const ext = str(s.extendName, '').trim() || 'Extend';
        const ret = str(s.retractName, '').trim() || 'Retract';
        push('extend', ext, uniqueMethod(m, camel(ext), 'extend'), { pp: ext, finishes: true });
        push('retract', ret, uniqueMethod(m, camel(ret), 'retract'), { pp: ret, finishes: true });
        push('toggle', 'Toggle', uniqueMethod(m, 'toggle', 'togglePiston'), { pp: 'Toggle', finishes: true });
        m.conditions.push({ key: 'extended:' + m.id, label: `${m.label} is extended`, expr: m.field + '.isExtended()' });
        break;
      }
      case 'roller':
      case 'climber':
        arr(s.actions).forEach((a, n) => {
          const loads = m.preset === 'roller' && !!a.stopOnPiece && !!s.sensor && s.sensor.type !== 'none';
          push('act:' + a.id, str(a.name, 'Action'), uniqueMethod(m, camel(a.name), 'action' + (n + 1)),
            { item: a, pp: str(a.name, 'Action'), finishes: loads, finishLabel: loads ? "Until it's loaded" : null });
        });
        push('stop', 'Stop', 'stop', { pp: 'Stop', finishes: true });
        if (m.preset === 'climber') push('zero', 'Zero the encoder', 'zeroEncoder', { pp: 'Zero Encoder', finishes: true });
        if (m.preset === 'roller' && s.sensor && s.sensor.type !== 'none') {
          m.conditions.push({ key: 'piece:' + m.id, label: `${m.label} has a game piece`, expr: m.field + '.hasGamePiece()' });
        }
        break;
      case 'flywheel':
        arr(s.speeds).forEach((sp, n) => {
          push('speed:' + sp.id, 'Spin up: ' + str(sp.name, 'Speed'), uniqueMethod(m, 'spinUp' + pascal(sp.name), 'spinUpSpeed' + (n + 1)),
            { item: sp, pp: str(sp.name, 'Speed'), finishes: false });
        });
        push('stop', 'Stop', 'stop', { pp: 'Stop', finishes: true });
        m.conditions.push({ key: 'atspeed:' + m.id, label: `${m.label} is at speed`, expr: m.field + '.atSpeed()' });
        break;
      case 'elevator':
      case 'arm':
        arr(s.setpoints).forEach((sp, n) => {
          push('sp:' + sp.id, 'Go to ' + str(sp.name, 'setpoint'), uniqueMethod(m, 'goTo' + pascal(sp.name), 'goToSetpoint' + (n + 1)),
            { item: sp, pp: str(sp.name, 'Setpoint'), finishes: true, finishLabel: 'Until it gets there' });
        });
        push('jogUp', 'Jog up (while held)', 'jogUp');
        push('jogDown', 'Jog down (while held)', 'jogDown');
        if (m.preset === 'elevator') push('zero', 'Zero the encoder', 'zeroEncoder', { pp: 'Zero Encoder', finishes: true });
        else if (s.encoder === 'builtin' || !s.encoder) push('zero', 'Reset to starting angle', 'resetToStartingAngle', { pp: 'Reset Angle', finishes: true });
        else push('zero', 'Re-sync with absolute encoder', 'syncEncoder', { pp: 'Sync Encoder', finishes: true });
        m.conditions.push({ key: 'moving:' + m.id, label: `${m.label} is moving`, expr: '!' + m.field + '.atTarget()' });
        break;
      default:
        break;
    }
    // SysId tests go on buttons only (not autos), so they get no PathPlanner name.
    if (project && project.sysId && CLOSED_LOOP.includes(m.preset)) {
      SYSID_TESTS.forEach(([kind, dir, , , label]) => push(`sysid:${kind}${dir}`, label, `sysId${kind}${dir}`));
    }
    const names = new Set();
    m.actions.forEach((a) => {
      if (!a.item) return;
      const n = str(a.item.name, '').trim().toLowerCase();
      if (!n) warn(`${m.label}: one ${m.preset === 'elevator' || m.preset === 'arm' ? 'setpoint' : 'action'} has no name.`, ref);
      else if (names.has(n)) warn(`${m.label}: two entries are named "${a.item.name}". Give each its own name.`, ref);
      names.add(n);
    });
  }

  function checkValues(m, warn) {
    const s = m.src;
    const ref = { kind: 'subsystem', id: m.id };
    if (m.preset === 'piston') {
      if (s.solenoid !== 'single' && int(s.forwardChannel, 0) === int(s.reverseChannel, 1)) {
        warn(`${m.label}: the extend and retract channels must be different.`, ref, 'error');
      }
      return;
    }
    if (!(num(s.gearRatio, 0) > 0)) warn(`${m.label}: the gear ratio must be more than 0. The code uses 1 until it's fixed.`, ref, 'error');
    if (m.preset === 'elevator') {
      if (!(num(s.drumDiameter, 0) > 0)) warn(`${m.label}: the sprocket or drum diameter must be more than 0.`, ref, 'error');
      const max = num(s.maxPos, 0);
      arr(s.setpoints).forEach((sp) => {
        const v = num(sp.value, 0);
        if (v < 0 || v > max) warn(`${m.label}: "${sp.name}" (${v} in) is outside 0 to ${max} in, so it will stop at the limit.`, ref);
      });
    }
    if (m.preset === 'arm') {
      const lo = num(s.minPos, -90); const hi = num(s.maxPos, 90);
      if (lo >= hi) warn(`${m.label}: the lowest angle must be below the highest angle.`, ref, 'error');
      arr(s.setpoints).forEach((sp) => {
        const v = num(sp.value, 0);
        if (v < lo || v > hi) warn(`${m.label}: "${sp.name}" (${v}°) is outside ${lo}° to ${hi}°, so it will stop at the limit.`, ref);
      });
      if (s.encoder === 'throughboreSpark' && m.vendor !== 'rev') {
        warn(`${m.label}: a Through Bore plugged into a SPARK only works with a NEO or Vortex. Pick "roboRIO DIO port" for a Talon FX.`, ref, 'error');
      }
    }
    if ((m.preset === 'roller' || m.preset === 'climber') && !arr(s.actions).length) warn(`${m.label}: add at least one action so a button can run it.`, ref);
    if ((m.preset === 'elevator' || m.preset === 'arm') && !arr(s.setpoints).length) warn(`${m.label}: add at least one setpoint.`, ref);
    if (m.preset === 'flywheel' && !arr(s.speeds).length) warn(`${m.label}: add at least one speed.`, ref);
    if (m.preset === 'climber' && s.softLimits && s.softLimits.enabled && num(s.softLimits.min, 0) >= num(s.softLimits.max, 0)) {
      warn(`${m.label}: the bottom soft limit must be below the top one.`, ref, 'error');
    }
  }

  /* ================================================================ shared code pieces */

  const foc = (ctx) => (ctx.project.phoenixPro ? '' : '.withEnableFOC(false)');

  function motorConstants(k, m) {
    const s = m.src;
    k.add('int', 'kMotorId', i(s.canId), `CAN ID of the ${m.motorLabel} (${CONTROLLERS[m.ctrl].label})`);
    k.add('boolean', 'kMotorInverted', b(bool(s.inverted)), 'Flip this if the motor spins the wrong way');
    m.followers.forEach((f) => {
      k.add('int', f.idConst, i(f.src.canId), 'CAN ID of a follower motor');
      k.add('boolean', f.oppConst, b(bool(f.src.opposite)), 'True if this motor faces the other way');
    });
    if (m.ctrl === 'talonfx') {
      k.add('double', 'kStatorCurrentLimit', d(positive(s.statorLimit, 80)), 'Amps');
      k.add('double', 'kSupplyCurrentLimit', d(positive(s.supplyLimit, 40)), 'Amps');
    } else {
      k.add('int', 'kCurrentLimit', i(positive(s.currentLimit, 40)), 'Amps (smart current limit)');
    }
  }

  function emitMotorFields(w, m, imp, opts) {
    const C = m.constClass;
    if (m.ctrl === 'talonfx') {
      imp.add('com.ctre.phoenix6.hardware.TalonFX', 'frc.robot.Constants');
      w.ln(`private final TalonFX motor = new TalonFX(${C}.kMotorId, Constants.kCtreCanBus);`);
      m.followers.forEach((f) => w.ln(`private final TalonFX ${f.field} = new TalonFX(${C}.${f.idConst}, Constants.kCtreCanBus);`));
    } else {
      const cls = CONTROLLERS[m.ctrl].cls;
      imp.add('com.revrobotics.spark.' + cls, 'com.revrobotics.spark.SparkLowLevel.MotorType');
      w.ln(`private final ${cls} motor = new ${cls}(${C}.kMotorId, MotorType.kBrushless);`);
      m.followers.forEach((f) => w.ln(`private final ${cls} ${f.field} = new ${cls}(${C}.${f.idConst}, MotorType.kBrushless);`));
      if (opts && opts.encoder) {
        imp.add('com.revrobotics.RelativeEncoder');
        w.ln('private final RelativeEncoder encoder = motor.getEncoder();');
      }
      if (opts && opts.closedLoop) {
        imp.add('com.revrobotics.spark.SparkClosedLoopController');
        w.ln('private final SparkClosedLoopController controller = motor.getClosedLoopController();');
      }
    }
  }

  function emitTalonConfigStart(w, m, imp) {
    const C = m.constClass;
    imp.add('com.ctre.phoenix6.configs.TalonFXConfiguration', 'com.ctre.phoenix6.signals.InvertedValue',
      'com.ctre.phoenix6.signals.NeutralModeValue');
    w.ln('TalonFXConfiguration config = new TalonFXConfiguration();');
    w.ln(`config.MotorOutput.Inverted = ${C}.kMotorInverted`);
    w.ln('        ? InvertedValue.Clockwise_Positive');
    w.ln('        : InvertedValue.CounterClockwise_Positive;');
    w.ln(`config.MotorOutput.NeutralMode = NeutralModeValue.${bool(m.src.brake) ? 'Brake' : 'Coast'};`);
    w.ln(`config.CurrentLimits.StatorCurrentLimit = ${C}.kStatorCurrentLimit;`);
    w.ln('config.CurrentLimits.StatorCurrentLimitEnable = true;');
    w.ln(`config.CurrentLimits.SupplyCurrentLimit = ${C}.kSupplyCurrentLimit;`);
    w.ln('config.CurrentLimits.SupplyCurrentLimitEnable = true;');
  }

  function emitTalonConfigFinish(w, m, imp) {
    const C = m.constClass;
    w.ln('applyConfig(motor, config);');
    if (!m.followers.length) return;
    imp.add('com.ctre.phoenix6.controls.Follower', 'com.ctre.phoenix6.signals.MotorAlignmentValue');
    w.blank();
    w.ln('// Followers copy the main motor. They only need its brake mode and current limits.');
    w.ln('TalonFXConfiguration followerConfig = new TalonFXConfiguration();');
    w.ln('followerConfig.MotorOutput.NeutralMode = config.MotorOutput.NeutralMode;');
    w.ln('followerConfig.CurrentLimits = config.CurrentLimits;');
    m.followers.forEach((f) => {
      w.ln(`applyConfig(${f.field}, followerConfig);`);
      w.ln(`${f.field}.setControl(new Follower(${C}.kMotorId,`);
      w.ln(`        ${C}.${f.oppConst} ? MotorAlignmentValue.Opposed : MotorAlignmentValue.Aligned));`);
    });
  }

  function emitTalonApplyHelper(w, m, imp) {
    imp.add('com.ctre.phoenix6.StatusCode', 'edu.wpi.first.wpilibj.DriverStation');
    w.blank();
    w.doc('Sends a config to a Talon FX. Tries a few times in case the CAN bus is busy at startup.');
    w.open('private static void applyConfig(TalonFX talon, TalonFXConfiguration config)');
    w.ln('StatusCode status = StatusCode.StatusCodeNotInitialized;');
    w.open('for (int attempt = 0; attempt < 5 && !status.isOK(); attempt++)');
    w.ln('status = talon.getConfigurator().apply(config);');
    w.close();
    w.open('if (!status.isOK())');
    w.ln(`DriverStation.reportWarning("${q(m.cls)}: could not configure Talon FX " + talon.getDeviceID() + ": " + status, false);`);
    w.close();
    w.close();
  }

  function emitSparkConfigStart(w, m, imp) {
    const C = m.constClass;
    const cfg = CONTROLLERS[m.ctrl].cfg;
    imp.add('com.revrobotics.spark.config.' + cfg, 'com.revrobotics.spark.config.SparkBaseConfig.IdleMode');
    w.ln(`${cfg} config = new ${cfg}();`);
    w.ln(`config.inverted(${C}.kMotorInverted)`);
    w.ln(`        .idleMode(IdleMode.${bool(m.src.brake) ? 'kBrake' : 'kCoast'})`);
    w.ln(`        .smartCurrentLimit(${C}.kCurrentLimit);`);
  }

  function emitSparkConfigFinish(w, m, imp) {
    const C = m.constClass;
    const cfg = CONTROLLERS[m.ctrl].cfg;
    imp.add('com.revrobotics.PersistMode', 'com.revrobotics.ResetMode');
    w.ln('motor.configure(config, ResetMode.kResetSafeParameters, PersistMode.kPersistParameters);');
    if (!m.followers.length) return;
    w.blank();
    w.ln('// Followers copy everything the main motor does.');
    m.followers.forEach((f) => {
      w.ln(`${cfg} ${f.field}Config = new ${cfg}();`);
      w.ln(`${f.field}Config.idleMode(IdleMode.${bool(m.src.brake) ? 'kBrake' : 'kCoast'})`);
      w.ln(`        .smartCurrentLimit(${C}.kCurrentLimit)`);
      w.ln(`        .follow(motor, ${C}.${f.oppConst});`);
      w.ln(`${f.field}.configure(${f.field}Config, ResetMode.kResetSafeParameters, PersistMode.kPersistParameters);`);
    });
  }

  function gainConstants(k, m, units) {
    const g = m.gains;
    k.gap(`Tuning (${units}). These are starting values: tune them on the robot.`);
    k.add('double', 'kP', d(num(g.kP, 0)));
    k.add('double', 'kI', d(num(g.kI, 0)));
    k.add('double', 'kD', d(num(g.kD, 0)));
    k.add('double', 'kS', d(num(g.kS, 0)), 'Volts to get it moving');
    k.add('double', 'kV', d(num(g.kV, 0)), 'Volts per unit of speed');
    if (g.kG !== undefined) k.add('double', 'kG', d(num(g.kG, 0)), 'Volts to hold it up against gravity');
  }

  function header(desc) {
    return [`// Generated by Robot Code Builder (${LIBS_TEXT}).`, '// ' + c(desc), ''].join('\n');
  }

  function javaFile(pkg, imp, body, desc) {
    return header(desc) + 'package ' + pkg + ';\n\n' + (imp.render() ? imp.render() + '\n\n' : '') + body + '\n';
  }

  function telemetryKey(m, what) { return q(m.label + '/' + what); }

  /* ================================================================ roller + climber */

  function genOpenLoop(m, ctx) {
    const s = m.src;
    const C = m.constClass;
    const talon = m.ctrl === 'talonfx';
    const roller = m.preset === 'roller';
    const climber = m.preset === 'climber';
    const sensor = roller && s.sensor && s.sensor.type !== 'none' ? s.sensor : null;
    const soft = climber && s.softLimits && s.softLimits.enabled ? s.softLimits : null;
    const k = ConstBlock(C, `${m.label}: ${roller ? 'rollers that spin at set speeds' : 'climber that drives up and down'}.`);
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.SubsystemBase',
      'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard', 'frc.robot.Constants.' + C);

    motorConstants(k, m);
    if (climber) k.add('double', 'kGearRatio', d(positive(s.gearRatio, 1)), 'Motor turns per spool or output turn');
    k.gap('Speeds from -1.0 (full reverse) to 1.0 (full forward)');
    const speedConsts = new Map();
    m.actions.filter((a) => a.item).forEach((a) => {
      const name = k.name('k', a.item.name, 'Speed', 'Action');
      speedConsts.set(a.key, name);
      k.add('double', name, d(Math.max(-1, Math.min(1, num(a.item.speed, 0) / 100))));
    });
    if (sensor) {
      k.gap('Game piece sensor');
      if (sensor.type === 'dio') {
        k.add('int', 'kSensorDio', i(sensor.dio), 'roboRIO DIO port');
        k.add('boolean', 'kSensorActiveLow', b(bool(sensor.activeLow)), 'True if it reads false when it sees a game piece (most beam breaks)');
      } else {
        k.add('int', 'kSensorId', i(sensor.canId), 'CAN ID of the CANrange');
        k.add('double', 'kSensorDistanceMeters', d(positive(sensor.distance, 0.1)), 'Anything closer than this counts as a game piece');
      }
    }
    if (soft) {
      k.gap('Soft limits, in output rotations from where it started');
      k.add('double', 'kMinRotations', d(num(soft.min, 0)));
      k.add('double', 'kMaxRotations', d(num(soft.max, 0)));
    }

    const w = Writer();
    w.doc(roller
      ? [`${m.label}: spins rollers at set speeds.`, '', 'Every action runs while its command runs and stops the rollers when it ends.']
      : [`${m.label}: drives up and down at set speeds.`, '', 'The encoder starts at 0 when the robot turns on, so start with the climber at the bottom.']);
    w.open(`public class ${m.cls} extends SubsystemBase`);
    emitMotorFields(w, m, imp, { encoder: climber && !talon });
    if (talon) {
      imp.add('com.ctre.phoenix6.controls.DutyCycleOut');
      w.ln(`private final DutyCycleOut dutyRequest = new DutyCycleOut(0)${foc(ctx)};`);
    }
    if (sensor && sensor.type === 'dio') {
      imp.add('edu.wpi.first.wpilibj.DigitalInput');
      w.ln(`private final DigitalInput sensor = new DigitalInput(${C}.kSensorDio);`);
    }
    if (sensor && sensor.type === 'canrange') {
      imp.add('com.ctre.phoenix6.hardware.CANrange', 'frc.robot.Constants');
      w.ln(`private final CANrange sensor = new CANrange(${C}.kSensorId, Constants.kCtreCanBus);`);
    }
    w.blank();
    w.open(`public ${m.cls}()`);
    if (talon) {
      emitTalonConfigStart(w, m, imp);
      if (climber) w.ln(`config.Feedback.SensorToMechanismRatio = ${C}.kGearRatio;`);
      if (soft) {
        w.ln('config.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;');
        w.ln(`config.SoftwareLimitSwitch.ForwardSoftLimitThreshold = ${C}.kMaxRotations;`);
        w.ln('config.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;');
        w.ln(`config.SoftwareLimitSwitch.ReverseSoftLimitThreshold = ${C}.kMinRotations;`);
      }
      emitTalonConfigFinish(w, m, imp);
    } else {
      emitSparkConfigStart(w, m, imp);
      if (climber) {
        w.ln(`config.encoder.positionConversionFactor(1.0 / ${C}.kGearRatio);`);
      }
      if (soft) {
        w.ln(`config.softLimit.forwardSoftLimit(${C}.kMaxRotations).forwardSoftLimitEnabled(true)`);
        w.ln(`        .reverseSoftLimit(${C}.kMinRotations).reverseSoftLimitEnabled(true);`);
      }
      emitSparkConfigFinish(w, m, imp);
    }
    if (sensor && sensor.type === 'canrange') {
      imp.add('com.ctre.phoenix6.configs.CANrangeConfiguration');
      w.blank();
      w.ln('CANrangeConfiguration sensorConfig = new CANrangeConfiguration();');
      w.ln(`sensorConfig.ProximityParams.ProximityThreshold = ${C}.kSensorDistanceMeters;`);
      w.ln('sensor.getConfigurator().apply(sensorConfig);');
    }
    if (climber) {
      w.blank();
      w.ln(talon ? 'motor.setPosition(0);' : 'encoder.setPosition(0);');
    }
    w.close();

    w.blank();
    w.doc('Runs the motor. 1.0 is full speed forward, -1.0 is full speed backward.');
    w.open('private void setSpeed(double speed)');
    w.ln(talon ? 'motor.setControl(dutyRequest.withOutput(speed));' : 'motor.set(speed);');
    w.close();

    if (sensor) {
      w.blank();
      w.doc('True when the sensor sees a game piece.');
      w.open('public boolean hasGamePiece()');
      if (sensor.type === 'dio') w.ln(`return ${C}.kSensorActiveLow ? !sensor.get() : sensor.get();`);
      else w.ln('return sensor.getIsDetected().getValue();');
      w.close();
    }
    if (climber) {
      w.blank();
      w.doc('How far the climber has turned since it started, in output rotations.');
      w.open('public double getPosition()');
      w.ln(talon ? 'return motor.getPosition().getValueAsDouble();' : 'return encoder.getPosition();');
      w.close();
    }

    m.actions.filter((a) => a.item).forEach((a) => {
      const stopsOnPiece = roller && sensor && a.item.stopOnPiece;
      w.blank();
      w.doc(`${a.label}: runs at ${Math.round(num(a.item.speed, 0))}% while the command runs${stopsOnPiece ? ', and stops by itself once it has a game piece' : ''}.`);
      w.open(`public Command ${a.method}()`);
      w.ln(`return startEnd(() -> setSpeed(${C}.${speedConsts.get(a.key)}), () -> setSpeed(0))`);
      if (stopsOnPiece) w.ln('        .until(this::hasGamePiece)');
      w.ln(`        .withName("${q(m.label + ': ' + a.label)}");`);
      w.close();
    });
    if (m.supplierMethods && m.supplierMethods.has('runAt')) {
      imp.add('java.util.function.DoubleSupplier', 'edu.wpi.first.math.MathUtil');
      w.blank();
      w.doc(['Runs at a speed that can change every loop, from -1.0 to 1.0. AprilTag zones and', 'distance tables use it. Stops when the command ends.']);
      w.open('public Command runAt(DoubleSupplier speed)');
      w.ln('return runEnd(() -> setSpeed(MathUtil.clamp(speed.getAsDouble(), -1.0, 1.0)), () -> setSpeed(0))');
      w.ln(`        .withName("${q(m.label + ': Run at Speed')}");`);
      w.close();
    }
    w.blank();
    w.doc('Stops the motor.');
    w.open('public Command stop()');
    w.ln(`return runOnce(() -> setSpeed(0)).withName("${q(m.label + ': Stop')}");`);
    w.close();
    if (climber) {
      w.blank();
      w.doc('Sets the current position as 0. Use it when the climber is all the way down.');
      w.open('public Command zeroEncoder()');
      w.ln(`return runOnce(() -> ${talon ? 'motor.setPosition(0)' : 'encoder.setPosition(0)'}).ignoringDisable(true)`);
      w.ln(`        .withName("${q(m.label + ': Zero Encoder')}");`);
      w.close();
    }

    w.blank();
    w.ln('@Override');
    w.open('public void periodic()');
    if (sensor) w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'Has Game Piece')}", hasGamePiece());`);
    if (climber) w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Position (rot)')}", getPosition());`);
    w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Current (A)')}", ${talon ? 'motor.getStatorCurrent().getValueAsDouble()' : 'motor.getOutputCurrent()'});`);
    w.close();
    if (talon) emitTalonApplyHelper(w, m, imp);
    w.close();

    return { consts: k, file: javaFile('frc.robot.subsystems', imp, w.text(), m.label + ' subsystem.'), speedConsts };
  }

  /* ================================================================ flywheel */

  function genFlywheel(m, ctx) {
    const s = m.src;
    const C = m.constClass;
    const talon = m.ctrl === 'talonfx';
    const k = ConstBlock(C, `${m.label}: flywheel that holds a set speed.`);
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.SubsystemBase',
      'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard', 'frc.robot.Constants.' + C);
    motorConstants(k, m);
    k.add('double', 'kGearRatio', d(positive(s.gearRatio, 1)), 'Motor turns per flywheel turn (less than 1 if geared up)');
    k.gap('Speeds in flywheel RPM');
    const rpmConsts = new Map();
    m.actions.filter((a) => a.item).forEach((a) => {
      const name = k.name('k', a.item.name, 'Rpm', 'Speed');
      rpmConsts.set(a.key, name);
      k.add('double', name, d(num(a.item.rpm, 0)));
    });
    k.add('double', 'kToleranceRpm', d(positive(s.toleranceRpm, 100)), 'Counts as "at speed" within this many RPM');
    gainConstants(k, m, talon ? 'volts per rotation per second' : 'kP in output per RPM, kS and kV in volts');
    const tune = !!ctx.project.liveTuning;
    const sysid = !!ctx.project.sysId;
    const simOn = ctx.project.simulation !== false;
    if (simOn) {
      const lbs = positive(s.simWheelMassLbs, 1.5);
      const dia = positive(s.simWheelDiameter, 4);
      const radius = (dia * 0.0254) / 2;
      k.gap('Simulation only');
      k.add('double', 'kSimMomentOfInertia', d(sig(0.5 * lbs * 0.45359237 * radius * radius, 4)), `kg m^2, for a ${lbs} lb, ${dia} in wheel`);
    }

    const w = Writer();
    w.doc([`${m.label}: a flywheel that spins up to a set RPM and holds it.`, '', 'Each speed command keeps the flywheel spinning until the command ends, then lets it coast down.']);
    w.open(`public class ${m.cls} extends SubsystemBase`);
    emitMotorFields(w, m, imp, { encoder: true, closedLoop: true });
    if (talon) {
      imp.add('com.ctre.phoenix6.controls.VelocityVoltage', 'com.ctre.phoenix6.controls.NeutralOut');
      w.ln(`private final VelocityVoltage velocityRequest = new VelocityVoltage(0).withSlot(0)${foc(ctx)};`);
      w.ln('private final NeutralOut stopRequest = new NeutralOut();');
    }
    w.ln('private double targetRpm = 0.0;');
    if (tune) {
      w.blank();
      emitTuningFields(w, m);
    }
    if (simOn) {
      imp.add('edu.wpi.first.wpilibj.simulation.FlywheelSim', 'edu.wpi.first.math.system.plant.DCMotor',
        'edu.wpi.first.math.system.plant.LinearSystemId');
      w.blank();
      w.ln('// Simulation: a physics model of the flywheel that only runs in the simulator.');
      w.ln('private final FlywheelSim sim = new FlywheelSim(');
      w.ln(`        LinearSystemId.createFlywheelSystem(${dcMotor(m)}, ${C}.kSimMomentOfInertia, ${C}.kGearRatio),`);
      w.ln(`        ${dcMotor(m)});`);
      emitSparkSimField(w, m, imp);
    }
    if (sysid) emitSysIdFields(w, m, imp, ctx);
    w.blank();
    w.open(`public ${m.cls}()`);
    if (talon) {
      emitTalonConfigStart(w, m, imp);
      w.ln(`config.Feedback.SensorToMechanismRatio = ${C}.kGearRatio;`);
      w.ln(`config.Slot0.kP = ${C}.kP;`);
      w.ln(`config.Slot0.kI = ${C}.kI;`);
      w.ln(`config.Slot0.kD = ${C}.kD;`);
      w.ln(`config.Slot0.kS = ${C}.kS;`);
      w.ln(`config.Slot0.kV = ${C}.kV;`);
      emitTalonConfigFinish(w, m, imp);
    } else {
      imp.add('com.revrobotics.spark.FeedbackSensor');
      emitSparkConfigStart(w, m, imp);
      w.ln('// Encoder reads flywheel rotations and flywheel RPM.');
      w.ln(`config.encoder.positionConversionFactor(1.0 / ${C}.kGearRatio)`);
      w.ln(`        .velocityConversionFactor(1.0 / ${C}.kGearRatio);`);
      w.ln('config.closedLoop.feedbackSensor(FeedbackSensor.kPrimaryEncoder)');
      w.ln(`        .pid(${C}.kP, ${C}.kI, ${C}.kD);`);
      w.ln(`config.closedLoop.feedForward.kS(${C}.kS).kV(${C}.kV);`);
      emitSparkConfigFinish(w, m, imp);
    }
    if (tune) {
      imp.add('frc.robot.Constants');
      w.open('if (Constants.kLiveTuning)');
      w.ln('publishTuning();');
      w.close();
    }
    w.close();

    w.blank();
    w.doc('Flywheel speed in RPM.');
    w.open('public double getRpm()');
    w.ln(talon ? 'return motor.getVelocity().getValueAsDouble() * 60.0;' : 'return encoder.getVelocity();');
    w.close();
    w.blank();
    w.doc('The speed it is trying to reach, in RPM. 0 when stopped.');
    w.open('public double getTargetRpm()');
    w.ln('return targetRpm;');
    w.close();
    w.blank();
    w.doc('True when the flywheel is spinning and within tolerance of its target speed.');
    w.open('public boolean atSpeed()');
    w.ln(`return targetRpm != 0 && Math.abs(getRpm() - targetRpm) <= ${C}.kToleranceRpm;`);
    w.close();
    w.blank();
    w.open('private void setTargetRpm(double rpm)');
    w.ln('targetRpm = rpm;');
    w.ln('if (rpm == 0) {');
    w.ln('    ' + (talon ? 'motor.setControl(stopRequest);' : 'motor.set(0);'));
    w.ln('} else {');
    w.ln('    ' + (talon ? 'motor.setControl(velocityRequest.withVelocity(rpm / 60.0));' : 'controller.setSetpoint(rpm, ControlType.kVelocity);'));
    w.ln('}');
    if (!talon) imp.add('com.revrobotics.spark.SparkBase.ControlType');
    w.close();
    w.blank();
    w.doc('Spins up to a speed and holds it until the command ends.');
    w.open('public Command spinUp(double rpm)');
    w.ln('return startEnd(() -> setTargetRpm(rpm), () -> setTargetRpm(0));');
    w.close();
    if (m.supplierMethods && m.supplierMethods.has('spinUpTo')) {
      imp.add('java.util.function.DoubleSupplier');
      w.blank();
      w.doc(['Spins at a speed in RPM that can change every loop. AprilTag zones and distance tables', 'use it. Coasts down when the command ends.']);
      w.open('public Command spinUpTo(DoubleSupplier rpm)');
      w.ln('return runEnd(() -> setTargetRpm(rpm.getAsDouble()), () -> setTargetRpm(0))');
      w.ln(`        .withName("${q(m.label + ': Spin Up')}");`);
      w.close();
    }
    m.actions.filter((a) => a.item).forEach((a) => {
      w.blank();
      w.doc(`${a.item.name}: ${Math.round(num(a.item.rpm, 0))} RPM.`);
      w.open(`public Command ${a.method}()`);
      w.ln(`return spinUp(${C}.${rpmConsts.get(a.key)}).withName("${q(m.label + ': ' + a.item.name)}");`);
      w.close();
    });
    w.blank();
    w.doc('Lets the flywheel coast to a stop.');
    w.open('public Command stop()');
    w.ln(`return runOnce(() -> setTargetRpm(0)).withName("${q(m.label + ': Stop')}");`);
    w.close();
    if (sysid) emitSysIdCommands(w, m, '() -> setTargetRpm(0)');
    w.blank();
    w.ln('@Override');
    w.open('public void periodic()');
    if (tune) {
      w.open('if (Constants.kLiveTuning)');
      w.ln('updateTuning();');
      w.close();
    }
    w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'RPM')}", getRpm());`);
    w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Target RPM')}", targetRpm);`);
    w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'At Speed')}", atSpeed());`);
    w.close();
    if (simOn) {
      imp.add('edu.wpi.first.wpilibj.RobotController');
      w.blank();
      w.ln('@Override');
      w.open('public void simulationPeriodic()');
      if (talon) {
        emitTalonSimStart(w, m, imp);
        w.ln('sim.update(0.02);');
        w.ln(`// The Talon FX measures the motor, which turns ${C}.kGearRatio times per flywheel turn.`);
        w.ln(`double rotorRps = sim.getAngularVelocityRPM() / 60.0 * ${C}.kGearRatio;`);
        w.ln('simState.setRotorVelocity(rotorRps);');
        w.ln('simState.addRotorPosition(rotorRps * 0.02);');
      } else {
        w.ln('double vbus = RobotController.getBatteryVoltage();');
        w.ln('sim.setInputVoltage(motorSim.getAppliedOutput() * vbus);');
        w.ln('sim.update(0.02);');
        w.ln('// The encoder reads flywheel RPM, so give it the speed in RPM.');
        w.ln('motorSim.iterate(sim.getAngularVelocityRPM(), vbus, 0.02);');
      }
      w.close();
    }
    if (tune) emitTuningMethods(w, m, imp);
    if (talon) emitTalonApplyHelper(w, m, imp);
    w.close();

    return { consts: k, file: javaFile('frc.robot.subsystems', imp, w.text(), m.label + ' subsystem.') };
  }

  /* ================================================================ elevator + arm */

  function genPosition(m, ctx) {
    const s = m.src;
    const C = m.constClass;
    const talon = m.ctrl === 'talonfx';
    const arm = m.preset === 'arm';
    const profile = s.profile !== false;
    const enc = arm ? (s.encoder || 'builtin') : 'builtin';
    const absolute = arm && enc !== 'builtin';
    const limit = !arm && s.limitSwitch && s.limitSwitch.enabled ? s.limitSwitch : null;
    const tune = !!ctx.project.liveTuning;
    const sysid = !!ctx.project.sysId;
    const simOn = ctx.project.simulation !== false;
    const U = arm
      ? { word: 'angle', unit: 'Degrees', abbr: ' degrees', get: 'getAngleDegrees', target: 'targetDegrees', getTarget: 'getTargetDegrees', min: 'kMinDegrees', max: 'kMaxDegrees', tol: 'kToleranceDegrees', jog: 'kJogLeadDegrees', cruise: 'kCruiseVelocityDegPerSec', accel: 'kAccelerationDegPerSecSq' }
      : { word: 'height', unit: 'Inches', abbr: ' in', get: 'getHeightInches', target: 'targetInches', getTarget: 'getTargetInches', min: 'kMinInches', max: 'kMaxInches', tol: 'kToleranceInches', jog: 'kJogLeadInches', cruise: 'kCruiseVelocityInchesPerSec', accel: 'kAccelerationInchesPerSecSq' };

    const k = ConstBlock(C, arm ? `${m.label}: moves to set angles. 0 degrees is horizontal, positive is up.` : `${m.label}: moves to set heights. 0 in is all the way down.`);
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.Commands',
      'edu.wpi.first.wpilibj2.command.SubsystemBase', 'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard',
      'edu.wpi.first.math.MathUtil', 'edu.wpi.first.wpilibj.DriverStation', 'frc.robot.Constants.' + C);
    if (arm && talon) imp.add('edu.wpi.first.math.util.Units');

    motorConstants(k, m);
    k.add('double', 'kGearRatio', d(positive(s.gearRatio, 1)), arm ? 'Motor turns per arm turn' : 'Motor turns per sprocket turn');
    if (!arm) {
      k.add('double', 'kSprocketDiameterInches', d(positive(s.drumDiameter, 1.757)), 'Pitch diameter of the sprocket or drum');
      k.add('double', 'kTravelMultiplier', d(positive(s.travelMultiplier, 1)), '1 for single stage or continuous rigging, 2 for a 2-stage cascade');
      k.add('double', 'kInchesPerMotorRotation', 'Math.PI * kSprocketDiameterInches * kTravelMultiplier / kGearRatio', 'How far it moves per motor turn');
    }
    k.gap(`Limits and setpoints, in ${U.unit.toLowerCase()}`);
    if (arm) {
      k.add('double', 'kMinDegrees', d(num(s.minPos, -30)));
      k.add('double', 'kMaxDegrees', d(num(s.maxPos, 120)));
    } else {
      k.add('double', 'kMinInches', '0.0');
      k.add('double', 'kMaxInches', d(num(s.maxPos, 50)));
    }
    const spConsts = new Map();
    m.actions.filter((a) => a.item).forEach((a) => {
      const name = k.name('k', a.item.name, U.unit, 'Setpoint');
      spConsts.set(a.key, name);
      k.add('double', name, d(num(a.item.value, 0)));
    });
    k.add('double', U.tol, d(positive(s.tolerance, arm ? 2 : 0.5)), 'Counts as "there" within this much');
    k.add('double', U.jog, d(positive(s.jogLead, arm ? 10 : 2)), 'How far ahead of itself a jog aims. Bigger is faster');
    if (profile) {
      k.add('double', U.cruise, d(positive(s.cruise, arm ? 180 : 40)), 'Top speed while moving to a setpoint');
      k.add('double', U.accel, d(positive(s.accel, arm ? 360 : 80)), 'How fast it speeds up and slows down');
    }
    if (arm) {
      k.gap('Encoder');
      if (absolute) {
        if (enc === 'throughboreDio') k.add('int', 'kAbsoluteEncoderDio', i(s.encoderDio), 'roboRIO DIO port of the Through Bore Encoder');
        if (enc === 'cancoder') k.add('int', 'kCANcoderId', i(s.cancoderId), 'CAN ID of the CANcoder');
        k.add('double', 'kAbsoluteEncoderOffset', d(num(s.encoderOffset, 0)), 'Raw reading (0 to 1) when the arm is horizontal');
        k.add('boolean', 'kAbsoluteEncoderInverted', b(bool(s.encoderInverted)), 'Flip this if the angle goes down when the arm goes up');
      } else {
        k.add('double', 'kStartingDegrees', d(num(s.startAngle, 90)), 'Where the arm must be when the robot turns on');
      }
      if (absolute && simOn) k.add('double', 'kStartingDegrees', d(num(s.startAngle, 90)), 'Where the simulator starts the arm');
    }
    if (limit) {
      k.gap('Bottom limit switch');
      k.add('int', 'kBottomLimitDio', i(limit.dio), 'roboRIO DIO port');
      k.add('boolean', 'kBottomLimitNormallyOpen', b(limit.normallyOpen !== false), 'True for normally open switches (most common)');
    }
    const ctreUnits = arm ? 'volts per arm rotation' : 'volts per inch';
    const revUnits = arm ? 'kP in output per degree, kS, kV and kG in volts' : 'kP in output per inch, kS, kV and kG in volts';
    gainConstants(k, m, talon ? ctreUnits : revUnits);
    if (simOn) {
      k.gap('Simulation only');
      if (arm) {
        k.add('double', 'kSimArmLengthInches', d(positive(s.simLength, 20)), 'From the pivot to the end of the arm');
        k.add('double', 'kSimArmMassKg', d(sig(positive(s.simMassLbs, 8) * 0.45359237, 4)), `${positive(s.simMassLbs, 8)} lb`);
      } else {
        k.add('double', 'kSimCarriageMassKg', d(sig(positive(s.simMassLbs, 15) * 0.45359237, 4)), `${positive(s.simMassLbs, 15)} lb, everything the motors lift`);
      }
    }

    const w = Writer();
    const docs = arm
      ? [`${m.label}: moves to set angles. 0 degrees is horizontal and positive angles point up.`, '']
      : [`${m.label}: moves to set heights in inches.`, ''];
    if (arm && absolute) docs.push('The absolute encoder tells the code where the arm is when the robot turns on.', 'After that, the motor\'s own encoder runs the control loop.');
    else if (arm) docs.push('The arm must be at the starting angle when the robot turns on.');
    else docs.push('The elevator must be all the way down when the robot turns on. That spot is 0 inches.');
    docs.push('', `When nothing else is using it, it holds its last target ${U.word}.`);
    w.doc(docs);
    w.open(`public class ${m.cls} extends SubsystemBase`);
    emitMotorFields(w, m, imp, { encoder: true, closedLoop: true });
    if (talon) {
      const req = profile ? 'MotionMagicVoltage' : 'PositionVoltage';
      imp.add('com.ctre.phoenix6.controls.' + req);
      w.ln(`private final ${req} positionRequest = new ${req}(0).withSlot(0)${foc(ctx)};`);
    }
    if (enc === 'throughboreDio') {
      imp.add('edu.wpi.first.wpilibj.DutyCycleEncoder');
      w.ln(`private final DutyCycleEncoder absoluteEncoder = new DutyCycleEncoder(${C}.kAbsoluteEncoderDio);`);
    }
    if (enc === 'throughboreSpark') {
      imp.add('com.revrobotics.spark.SparkAbsoluteEncoder');
      w.ln('private final SparkAbsoluteEncoder absoluteEncoder = motor.getAbsoluteEncoder();');
    }
    if (enc === 'cancoder') {
      imp.add('com.ctre.phoenix6.hardware.CANcoder', 'frc.robot.Constants');
      w.ln(`private final CANcoder cancoder = new CANcoder(${C}.kCANcoderId, Constants.kCtreCanBus);`);
    }
    if (limit) {
      imp.add('edu.wpi.first.wpilibj.DigitalInput');
      w.ln(`private final DigitalInput bottomLimit = new DigitalInput(${C}.kBottomLimitDio);`);
      w.ln('private boolean wasAtBottom = false;');
    }
    if (absolute) w.ln('private int disabledLoops = 0;');
    w.ln(`private double ${U.target} = 0.0;`);
    if (tune) {
      w.blank();
      emitTuningFields(w, m);
    }
    if (simOn) {
      imp.add('edu.wpi.first.math.system.plant.DCMotor', 'edu.wpi.first.math.util.Units',
        'edu.wpi.first.wpilibj.smartdashboard.Mechanism2d', 'edu.wpi.first.wpilibj.smartdashboard.MechanismLigament2d',
        arm ? 'edu.wpi.first.wpilibj.simulation.SingleJointedArmSim' : 'edu.wpi.first.wpilibj.simulation.ElevatorSim');
      w.blank();
      w.ln(`// A picture of the ${arm ? 'arm' : 'elevator'} for the dashboard. It works on the real robot too.`);
      if (arm) {
        w.ln(`private final Mechanism2d mechanism = new Mechanism2d(2.5 * ${C}.kSimArmLengthInches, 2.5 * ${C}.kSimArmLengthInches);`);
        w.ln(`private final MechanismLigament2d armLine = mechanism.getRoot("Pivot", 1.25 * ${C}.kSimArmLengthInches, 1.25 * ${C}.kSimArmLengthInches)`);
        w.ln(`        .append(new MechanismLigament2d("Arm", ${C}.kSimArmLengthInches, 0));`);
      } else {
        w.ln(`private final Mechanism2d mechanism = new Mechanism2d(20, ${C}.kMaxInches + 12);`);
        w.ln('private final MechanismLigament2d carriage = mechanism.getRoot("Bottom", 10, 4)');
        w.ln('        .append(new MechanismLigament2d("Carriage", 1, 90));');
      }
      w.ln('// Simulation: a physics model that only runs in the simulator.');
      if (arm) {
        w.ln('private final SingleJointedArmSim sim = new SingleJointedArmSim(');
        w.ln(`        ${dcMotor(m)},`);
        w.ln(`        ${C}.kGearRatio,`);
        w.ln(`        SingleJointedArmSim.estimateMOI(Units.inchesToMeters(${C}.kSimArmLengthInches), ${C}.kSimArmMassKg),`);
        w.ln(`        Units.inchesToMeters(${C}.kSimArmLengthInches),`);
        w.ln(`        Units.degreesToRadians(${C}.kMinDegrees),`);
        w.ln(`        Units.degreesToRadians(${C}.kMaxDegrees),`);
        w.ln('        true,');
        w.ln(`        Units.degreesToRadians(${C}.kStartingDegrees));`);
      } else {
        w.ln('private final ElevatorSim sim = new ElevatorSim(');
        w.ln(`        ${dcMotor(m)},`);
        w.ln(`        ${C}.kGearRatio,`);
        w.ln(`        ${C}.kSimCarriageMassKg,`);
        w.ln('        // A cascade moves the carriage faster, the same as a bigger drum would.');
        w.ln(`        Units.inchesToMeters(${C}.kSprocketDiameterInches * ${C}.kTravelMultiplier / 2),`);
        w.ln('        0.0,');
        w.ln(`        Units.inchesToMeters(${C}.kMaxInches),`);
        w.ln('        true,');
        w.ln('        0.0);');
      }
      emitSparkSimField(w, m, imp);
    }
    if (sysid) emitSysIdFields(w, m, imp, ctx);
    w.blank();

    // ---- constructor
    w.open(`public ${m.cls}()`);
    if (talon) {
      imp.add('com.ctre.phoenix6.signals.GravityTypeValue');
      emitTalonConfigStart(w, m, imp);
      if (arm) {
        w.ln('// The code works in arm rotations: 0 is horizontal.');
        w.ln(`config.Feedback.SensorToMechanismRatio = ${C}.kGearRatio;`);
      } else {
        w.ln('// The code works in inches of travel instead of rotations.');
        w.ln(`config.Feedback.SensorToMechanismRatio = 1.0 / ${C}.kInchesPerMotorRotation;`);
      }
      w.ln(`config.Slot0.kP = ${C}.kP;`);
      w.ln(`config.Slot0.kI = ${C}.kI;`);
      w.ln(`config.Slot0.kD = ${C}.kD;`);
      w.ln(`config.Slot0.kS = ${C}.kS;`);
      w.ln(`config.Slot0.kV = ${C}.kV;`);
      w.ln(`config.Slot0.kG = ${C}.kG;`);
      w.ln(`config.Slot0.GravityType = GravityTypeValue.${arm ? 'Arm_Cosine' : 'Elevator_Static'};`);
      const conv = (x) => (arm ? `Units.degreesToRotations(${C}.${x})` : `${C}.${x}`);
      if (profile) {
        w.ln(`config.MotionMagic.MotionMagicCruiseVelocity = ${conv(U.cruise)};`);
        w.ln(`config.MotionMagic.MotionMagicAcceleration = ${conv(U.accel)};`);
      }
      w.ln('config.SoftwareLimitSwitch.ForwardSoftLimitEnable = true;');
      w.ln(`config.SoftwareLimitSwitch.ForwardSoftLimitThreshold = ${conv(U.max)};`);
      w.ln('config.SoftwareLimitSwitch.ReverseSoftLimitEnable = true;');
      w.ln(`config.SoftwareLimitSwitch.ReverseSoftLimitThreshold = ${conv(U.min)};`);
      emitTalonConfigFinish(w, m, imp);
    } else {
      imp.add('com.revrobotics.spark.FeedbackSensor');
      emitSparkConfigStart(w, m, imp);
      if (arm) {
        w.ln('// The encoder reads arm degrees (0 is horizontal) and degrees per second.');
        w.ln(`config.encoder.positionConversionFactor(360.0 / ${C}.kGearRatio)`);
        w.ln(`        .velocityConversionFactor(360.0 / ${C}.kGearRatio / 60.0);`);
      } else {
        w.ln('// The encoder reads inches of travel and inches per second.');
        w.ln(`config.encoder.positionConversionFactor(${C}.kInchesPerMotorRotation)`);
        w.ln(`        .velocityConversionFactor(${C}.kInchesPerMotorRotation / 60.0);`);
      }
      if (enc === 'throughboreSpark') {
        w.ln('// The Through Bore on the data port reads 0 to 1 rotations.');
        w.ln(m.ctrl === 'sparkmax'
          ? 'config.absoluteEncoder.setSparkMaxDataPortConfig().positionConversionFactor(1.0);'
          : 'config.absoluteEncoder.positionConversionFactor(1.0);');
      }
      w.ln('config.closedLoop.feedbackSensor(FeedbackSensor.kPrimaryEncoder)');
      w.ln(`        .pid(${C}.kP, ${C}.kI, ${C}.kD);`);
      if (arm) {
        w.ln('// kCos holds the arm up. The ratio turns degrees into arm rotations for the cosine.');
        w.ln(`config.closedLoop.feedForward.kS(${C}.kS).kV(${C}.kV).kCos(${C}.kG).kCosRatio(1.0 / 360.0);`);
      } else {
        w.ln(`config.closedLoop.feedForward.kS(${C}.kS).kV(${C}.kV).kG(${C}.kG);`);
      }
      if (profile) {
        w.ln(`config.closedLoop.maxMotion.cruiseVelocity(${C}.${U.cruise})`);
        w.ln(`        .maxAcceleration(${C}.${U.accel});`);
      }
      w.ln(`config.softLimit.forwardSoftLimit(${C}.${U.max}).forwardSoftLimitEnabled(true)`);
      w.ln(`        .reverseSoftLimit(${C}.${U.min}).reverseSoftLimitEnabled(true);`);
      emitSparkConfigFinish(w, m, imp);
    }
    if (enc === 'cancoder') {
      imp.add('com.ctre.phoenix6.configs.CANcoderConfiguration');
      w.blank();
      w.ln('// Read the CANcoder raw (0 to 1 rotations). The offset is applied in getAbsoluteDegrees().');
      w.ln('CANcoderConfiguration cancoderConfig = new CANcoderConfiguration();');
      w.ln('cancoderConfig.MagnetSensor.AbsoluteSensorDiscontinuityPoint = 1.0;');
      w.ln('cancoder.getConfigurator().apply(cancoderConfig);');
    }
    w.blank();
    if (absolute) {
      w.ln('// periodic() copies the absolute encoder angle in while the robot is disabled.');
    } else if (arm) {
      w.ln(talon ? `motor.setPosition(Units.degreesToRotations(${C}.kStartingDegrees));` : `encoder.setPosition(${C}.kStartingDegrees);`);
      w.ln(`${U.target} = ${C}.kStartingDegrees;`);
    } else {
      w.ln(talon ? 'motor.setPosition(0);' : 'encoder.setPosition(0);');
    }
    if (absolute && simOn) {
      imp.add('edu.wpi.first.wpilibj.RobotBase');
      w.open('if (RobotBase.isSimulation())');
      w.ln('// The simulator has no absolute encoder, so start at the simulated angle.');
      w.ln(talon ? `motor.setPosition(Units.degreesToRotations(${C}.kStartingDegrees));` : `encoder.setPosition(${C}.kStartingDegrees);`);
      w.ln(`${U.target} = ${C}.kStartingDegrees;`);
      w.close();
    }
    if (simOn) w.ln(`SmartDashboard.putData("${telemetryKey(m, 'Mechanism')}", mechanism);`);
    if (tune) {
      imp.add('frc.robot.Constants');
      w.open('if (Constants.kLiveTuning)');
      w.ln('publishTuning();');
      w.close();
    }
    w.ln(`setDefaultCommand(run(this::holdTarget).withName("${q(m.label + ': Hold')}"));`);
    w.close();

    // ---- readings
    w.blank();
    w.doc(arm ? 'Current arm angle in degrees. 0 is horizontal.' : 'Current height in inches above the bottom.');
    w.open(`public double ${U.get}()`);
    if (talon) w.ln(arm ? 'return Units.rotationsToDegrees(motor.getPosition().getValueAsDouble());' : 'return motor.getPosition().getValueAsDouble();');
    else w.ln('return encoder.getPosition();');
    w.close();
    w.blank();
    w.doc(`The ${U.word} it is trying to reach.`);
    w.open(`public double ${U.getTarget}()`);
    w.ln(`return ${U.target};`);
    w.close();
    w.blank();
    w.doc(`True when it is within tolerance of its target ${U.word}.`);
    w.open('public boolean atTarget()');
    w.ln(`return Math.abs(${U.get}() - ${U.target}) <= ${C}.${U.tol};`);
    w.close();

    // ---- control
    w.blank();
    w.open(`private void setTarget(double ${arm ? 'degrees' : 'inches'})`);
    w.ln(`${U.target} = MathUtil.clamp(${arm ? 'degrees' : 'inches'}, ${C}.${U.min}, ${C}.${U.max});`);
    if (talon) {
      w.ln(`motor.setControl(positionRequest.withPosition(${arm ? `Units.degreesToRotations(${U.target})` : U.target}));`);
    } else {
      imp.add('com.revrobotics.spark.SparkBase.ControlType');
      w.ln(`controller.setSetpoint(${U.target}, ControlType.${profile ? 'kMAXMotionPositionControl' : 'kPosition'});`);
    }
    w.close();
    w.blank();
    w.open('private void holdTarget()');
    w.ln(`setTarget(${U.target});`);
    w.close();

    if (absolute) {
      w.blank();
      w.doc('Raw absolute encoder reading, 0 to 1 rotations. Use it to find kAbsoluteEncoderOffset.');
      w.open('public double getAbsoluteRaw()');
      if (enc === 'cancoder') w.ln('return cancoder.getAbsolutePosition().getValueAsDouble();');
      else w.ln('return absoluteEncoder.get' + (enc === 'throughboreSpark' ? 'Position' : '') + '();');
      w.close();
      w.blank();
      w.doc('Arm angle from the absolute encoder, in degrees. 0 is horizontal.');
      w.open('public double getAbsoluteDegrees()');
      w.ln(`double rotations = getAbsoluteRaw() - ${C}.kAbsoluteEncoderOffset;`);
      w.open(`if (${C}.kAbsoluteEncoderInverted)`);
      w.ln('rotations = -rotations;');
      w.close();
      w.ln('return MathUtil.inputModulus(rotations * 360.0, -180.0, 180.0);');
      w.close();
      w.blank();
      w.open('private boolean absoluteEncoderConnected()');
      if (enc === 'cancoder') w.ln('return cancoder.isConnected();');
      else if (enc === 'throughboreDio') w.ln('return absoluteEncoder.isConnected();');
      else w.ln('return true;');
      w.close();
      w.blank();
      w.doc('Copies the absolute encoder angle into the motor encoder, which runs the control loop.');
      w.open('public void syncToAbsoluteEncoder()');
      w.ln('double degrees = getAbsoluteDegrees();');
      if (talon) {
        w.ln('// A timeout of 0 sends the new position without waiting for a reply, so the loop never stalls.');
        w.ln('motor.setPosition(Units.degreesToRotations(degrees), 0.0);');
      } else {
        w.ln('encoder.setPosition(degrees);');
      }
      w.ln(`${U.target} = degrees;`);
      w.close();
    }

    // ---- commands
    w.blank();
    w.doc(`Moves to a${arm ? 'n angle' : ' height'} and finishes once it gets there.`);
    w.open(`public Command goTo(double ${arm ? 'degrees' : 'inches'})`);
    w.ln(`return runOnce(() -> setTarget(${arm ? 'degrees' : 'inches'})).andThen(Commands.waitUntil(this::atTarget));`);
    w.close();
    if (m.supplierMethods && m.supplierMethods.has('track')) {
      const v = arm ? 'degrees' : 'inches';
      imp.add('java.util.function.DoubleSupplier');
      w.blank();
      w.doc([`Follows a${arm ? 'n angle' : ' height'} that can change every loop. AprilTag zones and distance tables`, 'use it. When the command ends it holds where it was going.']);
      w.open(`public Command track(DoubleSupplier ${v})`);
      w.ln(`return run(() -> setTarget(${v}.getAsDouble()))`);
      w.ln(`        .withName("${q(m.label + ': Track')}");`);
      w.close();
    }
    m.actions.filter((a) => a.item).forEach((a) => {
      w.blank();
      w.doc(`${a.item.name}: ${num(a.item.value, 0)}${U.abbr}.`);
      w.open(`public Command ${a.method}()`);
      w.ln(`return goTo(${C}.${spConsts.get(a.key)}).withName("${q(m.label + ': ' + a.item.name)}");`);
      w.close();
    });
    ['Up', 'Down'].forEach((dir) => {
      w.blank();
      w.doc(`Moves ${dir.toLowerCase()} while the button is held, then holds where it stopped.`);
      w.open(`public Command jog${dir}()`);
      w.ln(`return runEnd(() -> setTarget(${U.get}() ${dir === 'Up' ? '+' : '-'} ${C}.${U.jog}), () -> setTarget(${U.get}()))`);
      w.ln(`        .withName("${q(m.label + ': Jog ' + dir)}");`);
      w.close();
    });
    w.blank();
    if (!arm) {
      w.doc('Sets the current height as 0. Use it when the elevator is all the way down.');
      w.open('public Command zeroEncoder()');
      w.ln('return runOnce(this::resetToBottom).ignoringDisable(true)');
      w.ln(`        .withName("${q(m.label + ': Zero Encoder')}");`);
      w.close();
      w.blank();
      w.open('private void resetToBottom()');
      w.ln(talon ? 'motor.setPosition(0);' : 'encoder.setPosition(0);');
      w.ln(`${U.target} = 0.0;`);
      w.close();
    } else if (absolute) {
      w.doc('Reads the absolute encoder again. Use it if the arm angle looks wrong.');
      w.open('public Command syncEncoder()');
      w.ln('return runOnce(this::syncToAbsoluteEncoder).ignoringDisable(true)');
      w.ln(`        .withName("${q(m.label + ': Sync Encoder')}");`);
      w.close();
    } else {
      w.doc('Tells the code the arm is at its starting angle. Put the arm there first.');
      w.open('public Command resetToStartingAngle()');
      w.open('return runOnce(() ->');
      w.ln(talon ? `motor.setPosition(Units.degreesToRotations(${C}.kStartingDegrees));` : `encoder.setPosition(${C}.kStartingDegrees);`);
      w.ln(`${U.target} = ${C}.kStartingDegrees;`);
      w.close(`).ignoringDisable(true).withName("${q(m.label + ': Reset Angle')}");`);
      w.close();
    }
    if (limit) {
      w.blank();
      w.doc('True when the bottom limit switch is pressed.');
      w.open('public boolean atBottom()');
      w.ln(`return ${C}.kBottomLimitNormallyOpen ? !bottomLimit.get() : bottomLimit.get();`);
      w.close();
    }
    if (sysid) emitSysIdCommands(w, m, `() -> setTarget(${U.get}())`);

    // ---- periodic
    w.blank();
    w.ln('@Override');
    w.open('public void periodic()');
    if (tune) {
      w.open('if (Constants.kLiveTuning)');
      w.ln('updateTuning();');
      w.close();
    }
    if (limit) {
      w.ln('// Re-zero every time the carriage reaches the bottom switch.');
      w.ln('boolean bottom = atBottom();');
      w.open('if (bottom && !wasAtBottom)');
      w.ln('resetToBottom();');
      w.close();
      w.ln('wasAtBottom = bottom;');
    }
    w.open('if (DriverStation.isDisabled())');
    if (absolute) {
      w.ln('// Re-read the absolute encoder twice a second. That catches its first reading');
      w.ln('// after power-on and anyone moving the arm by hand.');
      if (simOn) {
        imp.add('edu.wpi.first.wpilibj.RobotBase');
        w.open('if (RobotBase.isReal() && disabledLoops % 25 == 0 && absoluteEncoderConnected())');
      } else {
        w.open('if (disabledLoops % 25 == 0 && absoluteEncoderConnected())');
      }
      w.ln('syncToAbsoluteEncoder();');
      w.close();
      w.ln('disabledLoops++;');
    }
    w.ln(`// Keep the target where the ${arm ? 'arm' : 'elevator'} is, so it holds still when enabled.`);
    w.ln(`${U.target} = ${U.get}();`);
    if (absolute) {
      w.close(' else {');
      w.ln('    disabledLoops = 0;');
      w.ln('}');
    } else {
      w.close();
    }
    const label = arm ? 'Angle (deg)' : 'Height (in)';
    w.ln(`SmartDashboard.putNumber("${telemetryKey(m, label)}", ${U.get}());`);
    w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Target ' + (arm ? '(deg)' : '(in)'))}", ${U.target});`);
    w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'At Target')}", atTarget());`);
    if (absolute) {
      w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Absolute Raw')}", getAbsoluteRaw());`);
      w.ln(`SmartDashboard.putNumber("${telemetryKey(m, 'Absolute Angle (deg)')}", getAbsoluteDegrees());`);
      if (enc !== 'throughboreSpark') w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'Absolute Connected')}", absoluteEncoderConnected());`);
    }
    if (limit) w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'At Bottom')}", atBottom());`);
    if (simOn) w.ln(arm ? 'armLine.setAngle(getAngleDegrees());' : 'carriage.setLength(1 + getHeightInches());');
    w.close();

    if (simOn) {
      imp.add('edu.wpi.first.wpilibj.RobotController');
      w.blank();
      w.ln('@Override');
      w.open('public void simulationPeriodic()');
      if (talon) {
        emitTalonSimStart(w, m, imp);
        w.ln('sim.update(0.02);');
        if (arm) {
          w.ln('// Motor turns, counted from where the arm started (the code set that spot at startup).');
          w.ln(`double armTurns = Units.radiansToRotations(sim.getAngleRads()) - Units.degreesToRotations(${C}.kStartingDegrees);`);
          w.ln(`simState.setRawRotorPosition(armTurns * ${C}.kGearRatio);`);
          w.ln(`simState.setRotorVelocity(Units.radiansToRotations(sim.getVelocityRadPerSec()) * ${C}.kGearRatio);`);
        } else {
          w.ln('// The Talon FX counts motor turns, so turn the inches back into motor turns.');
          w.ln(`simState.setRawRotorPosition(Units.metersToInches(sim.getPositionMeters()) / ${C}.kInchesPerMotorRotation);`);
          w.ln(`simState.setRotorVelocity(Units.metersToInches(sim.getVelocityMetersPerSecond()) / ${C}.kInchesPerMotorRotation);`);
        }
      } else {
        w.ln('double vbus = RobotController.getBatteryVoltage();');
        w.ln('sim.setInputVoltage(motorSim.getAppliedOutput() * vbus);');
        w.ln('sim.update(0.02);');
        w.ln(`// The SPARK's encoder works in ${arm ? 'degrees' : 'inches'}, so give it the speed in those units.`);
        w.ln(arm
          ? 'motorSim.iterate(Units.radiansToDegrees(sim.getVelocityRadPerSec()), vbus, 0.02);'
          : 'motorSim.iterate(Units.metersToInches(sim.getVelocityMetersPerSecond()), vbus, 0.02);');
      }
      w.close();
    }
    if (tune) emitTuningMethods(w, m, imp);
    if (talon) emitTalonApplyHelper(w, m, imp);
    w.close();

    return { consts: k, file: javaFile('frc.robot.subsystems', imp, w.text(), m.label + ' subsystem.') };
  }

  /* ================================================================ lights */

  function genLedColorEnum() {
    const w = Writer();
    w.doc(['Colors the robot\'s LEDs can show.', '', 'The two numbers after the RGB values are REV Blinkin codes for that', 'color as a solid and as the closest strobe.']);
    w.open('public enum LedColor');
    LED_COLORS.forEach((col, idx) => {
      const [name, , rgb, solid, strobe] = col;
      w.ln(`${name}(${rgb.join(', ')}, ${d(solid)}, ${d(strobe)})${idx === LED_COLORS.length - 1 ? ';' : ','}`);
    });
    w.blank();
    w.ln('public final int red;');
    w.ln('public final int green;');
    w.ln('public final int blue;');
    w.ln('public final double blinkinSolid;');
    w.ln('public final double blinkinStrobe;');
    w.blank();
    w.open('LedColor(int red, int green, int blue, double blinkinSolid, double blinkinStrobe)');
    w.ln('this.red = red;');
    w.ln('this.green = green;');
    w.ln('this.blue = blue;');
    w.ln('this.blinkinSolid = blinkinSolid;');
    w.ln('this.blinkinStrobe = blinkinStrobe;');
    w.close();
    w.close();
    return javaFile('frc.robot.subsystems', Imports(), w.text(), 'Named LED colors shared by every light.');
  }

  function genLights(lt, ctx) {
    const s = lt.src;
    const C = lt.constClass;
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.SubsystemBase',
      'edu.wpi.first.wpilibj.DriverStation', 'edu.wpi.first.wpilibj.DriverStation.Alliance',
      'frc.robot.Constants.' + C);
    const k = ConstBlock(C, `${lt.label}: ${LIGHT_TYPES[lt.type].label}.`);
    const w = Writer();
    const brightness = Math.max(0, Math.min(100, num(s.brightness, 50)));

    if (lt.type === 'candle') {
      const length = Math.max(0, int(s.stripLength, 0));
      const first = s.includeOnboard !== false ? 0 : 8;
      const last = Math.max(first, 7 + length);
      k.add('int', 'kCANdleId', i(s.canId), 'CAN ID of the CANdle');
      k.add('int', 'kFirstLed', i(first), '0 to 7 are the LEDs on the CANdle itself');
      k.add('int', 'kLastLed', i(last), `Last LED of the strip (8 + ${length} LEDs - 1)`);
      k.add('double', 'kBrightness', d(brightness / 100), '0.0 to 1.0');
      imp.add('com.ctre.phoenix6.configs.CANdleConfiguration', 'com.ctre.phoenix6.controls.EmptyAnimation',
        'com.ctre.phoenix6.controls.RainbowAnimation', 'com.ctre.phoenix6.controls.SolidColor',
        'com.ctre.phoenix6.controls.StrobeAnimation', 'com.ctre.phoenix6.hardware.CANdle',
        'com.ctre.phoenix6.signals.RGBWColor', 'com.ctre.phoenix6.signals.StatusLedWhenActiveValue',
        'com.ctre.phoenix6.signals.StripTypeValue', 'frc.robot.Constants');
      const strip = CANDLE_STRIP_TYPES.includes(s.stripType) ? s.stripType : 'GRB';
      w.doc([`${lt.label}: LEDs run by a CTRE CANdle.`, '', 'Patterns are only sent when they change, so the CAN bus stays quiet.']);
      w.open(`public class ${lt.cls} extends SubsystemBase`);
      w.ln(`private final CANdle candle = new CANdle(${C}.kCANdleId, Constants.kCtreCanBus);`);
      w.ln(`private final SolidColor solidRequest = new SolidColor(${C}.kFirstLed, ${C}.kLastLed);`);
      w.ln(`private final StrobeAnimation strobeRequest = new StrobeAnimation(${C}.kFirstLed, ${C}.kLastLed).withSlot(0);`);
      w.ln(`private final RainbowAnimation rainbowRequest = new RainbowAnimation(${C}.kFirstLed, ${C}.kLastLed).withSlot(0);`);
      w.ln('private final EmptyAnimation clearAnimation = new EmptyAnimation(0);');
      w.ln('private String showing = "";');
      w.blank();
      w.open(`public ${lt.cls}()`);
      w.ln('CANdleConfiguration config = new CANdleConfiguration();');
      w.ln(`config.LED.StripType = StripTypeValue.${strip};`);
      w.ln(`config.LED.BrightnessScalar = ${C}.kBrightness;`);
      w.ln('config.CANdleFeatures.StatusLedWhenActive = StatusLedWhenActiveValue.Disabled;');
      w.ln('candle.getConfigurator().apply(config);');
      w.open('for (int slot = 0; slot < 8; slot++)');
      w.ln('candle.setControl(new EmptyAnimation(slot));');
      w.close();
      w.close();
      w.blank();
      w.doc('Shows one color on every LED.');
      w.open('public void showSolid(LedColor color)');
      w.open('if (changeTo("solid " + color))');
      w.ln('candle.setControl(clearAnimation);');
      w.ln('candle.setControl(solidRequest.withColor(toRgbw(color)));');
      w.close();
      w.close();
      w.blank();
      w.doc('Flashes one color.');
      w.open('public void showStrobe(LedColor color)');
      w.open('if (changeTo("strobe " + color))');
      w.ln('candle.setControl(strobeRequest.withColor(toRgbw(color)));');
      w.close();
      w.close();
      w.blank();
      w.doc('Runs a rainbow.');
      w.open('public void showRainbow()');
      w.open('if (changeTo("rainbow"))');
      w.ln('candle.setControl(rainbowRequest);');
      w.close();
      w.close();
      w.blank();
      w.open('private static RGBWColor toRgbw(LedColor color)');
      w.ln('return new RGBWColor(color.red, color.green, color.blue);');
      w.close();
    } else if (lt.type === 'blinkin') {
      k.add('int', 'kBlinkinPwmPort', i(s.pwmPort), 'roboRIO PWM port');
      imp.add('edu.wpi.first.wpilibj.motorcontrol.Spark');
      w.doc([`${lt.label}: LEDs run by a REV Blinkin.`, '', 'The Blinkin acts like a PWM motor controller: each "speed" picks a pattern.', 'It can\'t change while the robot is disabled, because the roboRIO turns PWM off.']);
      w.open(`public class ${lt.cls} extends SubsystemBase`);
      w.ln(`private final Spark blinkin = new Spark(${C}.kBlinkinPwmPort);`);
      w.ln('private double code = LedColor.OFF.blinkinSolid;');
      w.ln('private String showing = "";');
      w.blank();
      w.doc('Shows one color.');
      w.open('public void showSolid(LedColor color)');
      w.open('if (changeTo("solid " + color))');
      w.ln('code = color.blinkinSolid;');
      w.close();
      w.close();
      w.blank();
      w.doc('Flashes the closest color the Blinkin can strobe (red, blue, gold or white).');
      w.open('public void showStrobe(LedColor color)');
      w.open('if (changeTo("strobe " + color))');
      w.ln('code = color.blinkinStrobe;');
      w.close();
      w.close();
      w.blank();
      w.doc('Runs the Blinkin rainbow pattern.');
      w.open('public void showRainbow()');
      w.open('if (changeTo("rainbow"))');
      w.ln('code = -0.99;');
      w.close();
      w.close();
    } else {
      const length = Math.max(1, int(s.stripLength, 60));
      const order = STRIP_ORDERS.includes(s.stripType) ? s.stripType : 'GRB';
      k.add('int', 'kPwmPort', i(s.pwmPort), 'roboRIO PWM port');
      k.add('int', 'kLedCount', i(length), 'How many LEDs are on the strip');
      k.add('double', 'kBrightnessPercent', d(brightness), '0 to 100');
      imp.add('static edu.wpi.first.units.Units.*', 'edu.wpi.first.wpilibj.AddressableLED',
        'edu.wpi.first.wpilibj.AddressableLEDBuffer', 'edu.wpi.first.wpilibj.LEDPattern',
        'edu.wpi.first.wpilibj.util.Color');
      w.doc([`${lt.label}: an addressable LED strip on a roboRIO PWM port.`, '', 'The pattern is drawn into a buffer every loop.']);
      w.open(`public class ${lt.cls} extends SubsystemBase`);
      w.ln(`private final AddressableLED strip = new AddressableLED(${C}.kPwmPort);`);
      w.ln(`private final AddressableLEDBuffer buffer = new AddressableLEDBuffer(${C}.kLedCount);`);
      w.ln('private LEDPattern pattern = LEDPattern.kOff;');
      w.ln('private String showing = "";');
      w.blank();
      w.open(`public ${lt.cls}()`);
      if (order !== 'GRB') w.ln(`strip.setColorOrder(AddressableLED.ColorOrder.k${order});`);
      w.ln('strip.setLength(buffer.getLength());');
      w.ln('strip.setData(buffer);');
      w.ln('strip.start();');
      w.close();
      w.blank();
      w.doc('Shows one color on every LED.');
      w.open('public void showSolid(LedColor color)');
      w.open('if (changeTo("solid " + color))');
      w.ln(`pattern = LEDPattern.solid(toColor(color)).atBrightness(Percent.of(${C}.kBrightnessPercent));`);
      w.close();
      w.close();
      w.blank();
      w.doc('Flashes one color.');
      w.open('public void showStrobe(LedColor color)');
      w.open('if (changeTo("strobe " + color))');
      w.ln(`pattern = LEDPattern.solid(toColor(color)).blink(Seconds.of(0.1)).atBrightness(Percent.of(${C}.kBrightnessPercent));`);
      w.close();
      w.close();
      w.blank();
      w.doc('Runs a scrolling rainbow.');
      w.open('public void showRainbow()');
      w.open('if (changeTo("rainbow"))');
      w.ln(`pattern = LEDPattern.rainbow(255, 128).scrollAtRelativeSpeed(Hertz.of(0.5)).atBrightness(Percent.of(${C}.kBrightnessPercent));`);
      w.close();
      w.close();
      w.blank();
      w.open('private static Color toColor(LedColor color)');
      w.ln('return new Color(color.red, color.green, color.blue);');
      w.close();
    }

    // shared by all three
    w.blank();
    w.doc('Turns the LEDs off.');
    w.open('public void showOff()');
    w.ln('showSolid(LedColor.OFF);');
    w.close();
    w.blank();
    w.doc('Red or blue to match the alliance. Uses the fallback color before the alliance is known.');
    w.open('public void showAllianceColor(LedColor fallback)');
    w.ln('var alliance = DriverStation.getAlliance();');
    w.ln('showSolid(alliance.isEmpty() ? fallback : alliance.get() == Alliance.Red ? LedColor.RED : LedColor.BLUE);');
    w.close();
    w.blank();
    w.doc('Remembers the pattern and returns true if it is different from the last one.');
    w.open('private boolean changeTo(String pattern)');
    w.open('if (pattern.equals(showing))');
    w.ln('return false;');
    w.close();
    w.ln('showing = pattern;');
    w.ln('return true;');
    w.close();

    lt.actions.forEach((a) => {
      const sg = a.signal;
      w.blank();
      w.doc(`${sg.name}: ${describePattern(sg.pattern, sg.color)} while the command runs.`);
      w.open(`public Command ${a.method}()`);
      w.ln(`return run(() -> ${patternCall('', sg.pattern, sg.color)}).ignoringDisable(true)`);
      w.ln(`        .withName("${q(lt.label + ': ' + sg.name)}");`);
      w.close();
    });

    if (lt.type !== 'candle') {
      w.blank();
      w.ln('@Override');
      w.open('public void periodic()');
      if (lt.type === 'blinkin') w.ln('blinkin.set(code);');
      else {
        w.ln('pattern.applyTo(buffer);');
        w.ln('strip.setData(buffer);');
      }
      w.close();
    }
    w.close();
    return { consts: k, file: javaFile('frc.robot.subsystems', imp, w.text(), lt.label + ' lights.') };
  }

  function colorLabel(key) { const col = LED_COLORS.find((x) => x[0] === key); return col ? col[1].toLowerCase() : 'white'; }
  function describePattern(pattern, color) {
    switch (pattern) {
      case 'solid': return 'shows solid ' + colorLabel(color);
      case 'strobe': return 'flashes ' + colorLabel(color);
      case 'rainbow': return 'shows a rainbow';
      case 'alliance': return 'shows the alliance color';
      default: return 'turns the LEDs off';
    }
  }
  /** Java call for a pattern; `target` is "leds." or "" (inside the class). */
  function patternCall(target, pattern, color) {
    const col = 'LedColor.' + (LED_COLOR_KEYS.includes(color) ? color : 'WHITE');
    switch (pattern) {
      case 'solid': return `${target}showSolid(${col})`;
      case 'strobe': return `${target}showStrobe(${col})`;
      case 'rainbow': return `${target}showRainbow()`;
      case 'alliance': return `${target}showAllianceColor(${col})`;
      default: return `${target}showOff()`;
    }
  }

  /* ================================================================ Constants + RobotContainer */

  function genConstants(model, blocks) {
    const imp = Imports();
    const w = Writer();
    const p = model.project;
    const team = String(p.teamNumber || '').trim();
    w.doc(['Every CAN ID, port, gear ratio, setpoint and tuning value for the robot, in one place.',
      '', `Made for ${p.robotName || 'the robot'}${team ? ' (team ' + team + ')' : ''}. Change numbers here, not in the subsystem files.`]);
    w.open('public final class Constants');
    w.ln('private Constants() {}');
    if (model.project.liveTuning && model.subsystems.some((m) => CLOSED_LOOP.includes(m.preset))) {
      w.blank();
      w.doc('Live tuning: gains can be changed on the dashboard while the robot runs. Set to false for competitions.');
      w.ln('public static final boolean kLiveTuning = true;');
    }
    if (model.hasCtre) {
      imp.add('com.ctre.phoenix6.CANBus');
      w.blank();
      w.doc('CAN bus for the CTRE mechanism devices. The swerve drive sets its own bus in TunerConstants.');
      w.ln(model.ctreBus === 'rio'
        ? 'public static final CANBus kCtreCanBus = CANBus.roboRIO();'
        : `public static final CANBus kCtreCanBus = new CANBus("${q(model.ctreBus)}");`);
    }
    w.blank();
    const ops = ConstBlock('OperatorConstants', 'Driver Station USB ports for the controllers.');
    model.controllers.forEach((ctl) => ops.add('int', ctl.portConst, i(ctl.port), ctl.label + ', ' + CONTROLLER_TYPES[ctl.type].label));
    if (model.controllers.length) ops.render(w);
    if (model.driveCtl) {
      const dr = model.drive;
      w.blank();
      const dc = ConstBlock('DriveConstants', 'Swerve driving feel.');
      dc.add('double', 'kMaxSpeedFraction', d(Math.max(0.05, Math.min(1, num(dr.maxSpeedPct, 100) / 100))), 'Fraction of the top speed from Tuner X');
      dc.add('double', 'kMaxTurnRotationsPerSecond', d(positive(dr.maxTurnRps, 0.75)), 'Fastest turn');
      dc.add('double', 'kDeadband', d(Math.max(0, Math.min(0.5, num(dr.deadbandPct, 10) / 100))), 'Stick movement smaller than this is ignored');
      if (dr.slowButton !== 'none') dc.add('double', 'kSlowModeFraction', d(Math.max(0.05, Math.min(1, num(dr.slowPct, 40) / 100))), 'Speed while slow mode is held');
      dc.render(w);
    }
    if (model.autos.usePP) {
      w.blank();
      const ac = ConstBlock('AutoConstants', 'Autonomous: how hard PathPlanner steers the robot back onto a path.');
      ac.add('double', 'kPathTranslationP', d(model.autos.translationP), 'Fixes position error');
      ac.add('double', 'kPathRotationP', d(model.autos.rotationP), 'Fixes heading error');
      ac.render(w);
    }
    if (model.pneumatics) {
      const P = model.pneumatics;
      w.blank();
      const pc = ConstBlock('PneumaticsConstants', `Air: the ${P.name}.`);
      pc.add('int', 'kModuleId', i(P.canId), `CAN ID of the ${P.label}`);
      if (P.analog) {
        pc.add('double', 'kMinPressurePsi', d(P.minPsi), 'The compressor turns on below this');
        pc.add('double', 'kMaxPressurePsi', d(P.maxPsi), 'and off above this');
      }
      pc.render(w);
    }
    if (model.vision) {
      w.blank();
      visionConstants(model.vision).render(w);
    }
    blocks.forEach((blk) => { w.blank(); blk.render(w); });
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'All robot constants.');
  }

  function genRobotContainer(model) {
    const imp = Imports();
    const w = Writer();
    const p = model.project;
    imp.add('edu.wpi.first.wpilibj2.command.Command');
    if (model.controllers.length) imp.add('frc.robot.Constants.OperatorConstants');

    w.doc(['Makes the robot\'s subsystems and connects controller buttons to commands.',
      '', 'Generated by Robot Code Builder. Re-generating replaces this file, so keep a copy of any changes you make by hand.']);
    w.open('public class RobotContainer');
    if (model.controllers.length) {
      w.ln('// Controllers');
      model.controllers.forEach((ctl) => {
        imp.add('edu.wpi.first.wpilibj2.command.button.' + ctl.cls);
        w.ln(`private final ${ctl.cls} ${ctl.field} = new ${ctl.cls}(OperatorConstants.${ctl.portConst});`);
      });
    }
    const dc = model.driveCtl;
    if (dc) {
      imp.add('static edu.wpi.first.units.Units.*', 'com.ctre.phoenix6.swerve.SwerveModule.DriveRequestType',
        'com.ctre.phoenix6.swerve.SwerveRequest', 'edu.wpi.first.wpilibj2.command.button.RobotModeTriggers',
        'frc.robot.Constants.DriveConstants', 'frc.robot.generated.TunerConstants',
        'frc.robot.subsystems.CommandSwerveDrivetrain');
      w.blank();
      w.ln('// Swerve drive, made by Phoenix Tuner X');
      w.ln('private final double maxSpeed = DriveConstants.kMaxSpeedFraction * TunerConstants.kSpeedAt12Volts.in(MetersPerSecond);');
      w.ln('private final double maxAngularRate = RotationsPerSecond.of(DriveConstants.kMaxTurnRotationsPerSecond).in(RadiansPerSecond);');
      w.ln('private final SwerveRequest.FieldCentric drive = new SwerveRequest.FieldCentric()');
      w.ln('        .withDeadband(maxSpeed * DriveConstants.kDeadband)');
      w.ln('        .withRotationalDeadband(maxAngularRate * DriveConstants.kDeadband)');
      w.ln('        .withDriveRequestType(DriveRequestType.OpenLoopVoltage);');
      if (model.drive.brakeButton !== 'none') w.ln('private final SwerveRequest.SwerveDriveBrake brake = new SwerveRequest.SwerveDriveBrake();');
      if (model.vision && model.drive.aimButton !== 'none') {
        w.ln('// Like drive, but with no turning deadband, so aiming can make small corrections.');
        w.ln('private final SwerveRequest.FieldCentric aimDrive = new SwerveRequest.FieldCentric()');
        w.ln('        .withDeadband(maxSpeed * DriveConstants.kDeadband)');
        w.ln('        .withDriveRequestType(DriveRequestType.OpenLoopVoltage);');
      }
      w.ln('private final Telemetry logger = new Telemetry(maxSpeed);');
      w.ln('public final CommandSwerveDrivetrain drivetrain = TunerConstants.createDrivetrain();');
    }
    if (model.subsystems.length || model.lights.length) {
      w.blank();
      w.ln('// Subsystems');
      model.subsystems.concat(model.lights).forEach((m) => {
        imp.add('frc.robot.subsystems.' + m.cls);
        w.ln(`public final ${m.cls} ${m.field} = new ${m.cls}();`);
      });
    }
    if (model.vision) {
      imp.add('frc.robot.subsystems.Vision');
      w.blank();
      w.ln('// AprilTag vision (Vision.java). It keeps the swerve drive\'s field position accurate.');
      w.ln('public final Vision vision = new Vision(drivetrain);');
    }
    if (model.combos.combos.length) {
      w.blank();
      w.ln('// Button combos (Combos.java)');
      w.ln('public final Combos combos = new Combos(this);');
    }
    if (model.pneumatics) {
      imp.add('edu.wpi.first.wpilibj.Compressor', 'edu.wpi.first.wpilibj.PneumaticsModuleType',
        'frc.robot.Constants.PneumaticsConstants', 'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard');
      w.blank();
      w.ln('// Pneumatics: the compressor fills the air tanks by itself.');
      w.ln(`private final Compressor compressor = new Compressor(PneumaticsConstants.kModuleId, PneumaticsModuleType.${model.pneumatics.type});`);
    }
    const autosOn = model.autos.enabled;
    if (autosOn) {
      w.blank();
      w.ln('// Autonomous routines and the auto chooser (Autos.java)');
      w.ln('private final Autos autos;');
    }
    w.blank();
    w.open('public RobotContainer()');
    if (model.pneumatics) {
      w.ln(model.pneumatics.analog
        ? 'compressor.enableAnalog(PneumaticsConstants.kMinPressurePsi, PneumaticsConstants.kMaxPressurePsi);'
        : 'compressor.enableDigital(); // runs until the pressure switch says the tanks are full');
      w.ln('SmartDashboard.putData("Compressor", compressor);');
    }
    if (dc) w.ln('configureDriving();');
    w.ln('configureButtons();');
    if (model.lights.length) w.ln('configureLights();');
    if (autosOn) {
      w.ln('// Autos come last, because they use the subsystems made above.');
      w.ln('autos = new Autos(this);');
    }
    w.close();

    if (dc) {
      const dr = model.drive;
      const c = dc.field;
      const stick = dc.type === 'joystick'
        ? { y: `${c}.getY()`, x: `${c}.getX()`, r: `${c}.getTwist()`, text: 'Push the joystick to drive, twist it to turn.' }
        : { y: `${c}.getLeftY()`, x: `${c}.getLeftX()`, r: `${c}.getRightX()`, text: 'Left stick drives, right stick turns.' };
      const scale = dr.slowButton !== 'none' || (!!model.vision && model.vision.zones.some((z) => z.slow != null)) ? ' * speedScale()' : '';
      const btnLabel = (key) => (BUTTONS[dc.type].find((x) => x[0] === key) || [key, key])[1];
      w.blank();
      w.open('private void configureDriving()');
      w.ln(`// ${stick.text} Pushing a stick forward reads negative, so it is flipped.`);
      w.ln('drivetrain.setDefaultCommand(drivetrain.applyRequest(() -> drive');
      w.ln(`        .withVelocityX(-${stick.y} * maxSpeed${scale})`);
      w.ln(`        .withVelocityY(-${stick.x} * maxSpeed${scale})`);
      w.ln(`        .withRotationalRate(-${stick.r} * maxAngularRate${scale})));`);
      w.blank();
      w.ln('// While disabled, let the drive motors brake or coast the way Tuner X set them.');
      w.ln('final var idle = new SwerveRequest.Idle();');
      w.ln('RobotModeTriggers.disabled().whileTrue(drivetrain.applyRequest(() -> idle).ignoringDisable(true));');
      if (dr.resetButton !== 'none') {
        w.blank();
        w.ln(`// ${btnLabel(dr.resetButton)}: make the way the robot faces now "forward" for field-centric driving.`);
        w.ln(`${c}.${buttonExpr(dc.type, dr.resetButton)}.onTrue(drivetrain.runOnce(drivetrain::seedFieldCentric));`);
      }
      if (dr.brakeButton !== 'none') {
        w.ln(`// ${btnLabel(dr.brakeButton)}: point the wheels in an X so the robot is hard to push.`);
        w.ln(`${c}.${buttonExpr(dc.type, dr.brakeButton)}.whileTrue(drivetrain.applyRequest(() -> brake));`);
      }
      if (model.vision && dr.aimButton !== 'none') {
        w.ln(`// ${btnLabel(dr.aimButton)}: keep driving, but turn to face the AprilTag in view.`);
        w.ln(`${c}.${buttonExpr(dc.type, dr.aimButton)}.whileTrue(drivetrain.applyRequest(() -> aimDrive`);
        w.ln(`        .withVelocityX(-${stick.y} * maxSpeed${scale})`);
        w.ln(`        .withVelocityY(-${stick.x} * maxSpeed${scale})`);
        w.ln('        .withRotationalRate(vision.aimRate(maxAngularRate))));');
      }
      if (dr.sysId && dc.type === 'xbox') {
        imp.add('edu.wpi.first.wpilibj2.command.sysid.SysIdRoutine.Direction');
        w.blank();
        w.ln('// SysId drive tests: hold Back or Start with X or Y. Run each test once per log.');
        w.ln(`${c}.back().and(${c}.y()).whileTrue(drivetrain.sysIdDynamic(Direction.kForward));`);
        w.ln(`${c}.back().and(${c}.x()).whileTrue(drivetrain.sysIdDynamic(Direction.kReverse));`);
        w.ln(`${c}.start().and(${c}.y()).whileTrue(drivetrain.sysIdQuasistatic(Direction.kForward));`);
        w.ln(`${c}.start().and(${c}.x()).whileTrue(drivetrain.sysIdQuasistatic(Direction.kReverse));`);
      }
      w.blank();
      w.ln('drivetrain.registerTelemetry(logger::telemeterize);');
      w.close();
      const slowZones = !!model.vision && model.vision.zones.some((z) => z.slow != null);
      if (dr.slowButton !== 'none' || slowZones) {
        w.blank();
        const why = [];
        if (dr.slowButton !== 'none') why.push(`hold ${btnLabel(dr.slowButton)} for ${Math.round(num(dr.slowPct, 40))}% speed`);
        if (slowZones) why.push('AprilTag zones slow the robot down near their tags');
        w.doc(`How fast to drive: ${why.join(', and ')}.`);
        w.open('private double speedScale()');
        if (dr.slowButton !== 'none' && slowZones) {
          w.ln(`double scale = ${c}.${buttonExpr(dc.type, dr.slowButton)}.getAsBoolean() ? DriveConstants.kSlowModeFraction : 1.0;`);
          w.ln('return Math.min(scale, vision.driveSpeedScale());');
        } else if (slowZones) {
          w.ln('return vision.driveSpeedScale();');
        } else {
          w.ln(`return ${c}.${buttonExpr(dc.type, dr.slowButton)}.getAsBoolean() ? DriveConstants.kSlowModeFraction : 1.0;`);
        }
        w.close();
      }
    }

    w.blank();
    w.open('private void configureButtons()');
    if (!model.bindings.length) w.ln('// No buttons yet. Add some in Robot Code Builder under Controls.');
    let firstGroup = true;
    model.controllers.forEach((ctl) => {
      const list = model.bindings.filter((bd) => bd.ctl.id === ctl.id);
      if (!list.length) return;
      if (!firstGroup) w.blank();
      firstGroup = false;
      w.ln(`// ${ctl.label}`);
      list.forEach((bd) => {
        w.ln(`${ctl.field}.${buttonExpr(ctl.type, bd.button)}.${WHEN[bd.when].method}(${actionCall(bd.target, bd.action, '')});`);
      });
    });
    const zoneRuns = model.vision ? model.vision.zones.filter((z) => z.run) : [];
    if (zoneRuns.length) {
      imp.add('edu.wpi.first.wpilibj2.command.button.Trigger', 'edu.wpi.first.wpilibj2.command.button.RobotModeTriggers');
      if (zoneRuns.some((z) => z.value != null)) imp.add('frc.robot.Constants.VisionConstants');
      w.blank();
      w.ln('// AprilTag zones: run something while the robot is inside. Teleop only, so they never fight an auto.');
      zoneRuns.forEach((z) => {
        w.ln(`new Trigger(vision::${z.method}).and(RobotModeTriggers.teleop())`);
        w.ln(`        .whileTrue(${actionCall(z.run.t, z.run.a, '')});`);
      });
    }
    if (model.rumbles.length) {
      imp.add('edu.wpi.first.wpilibj2.command.button.Trigger', 'edu.wpi.first.wpilibj.GenericHID.RumbleType',
        'edu.wpi.first.wpilibj2.command.Commands');
      w.blank();
      w.ln('// Rumble alerts: shake a controller for a moment when something becomes true.');
      model.rumbles.forEach((rb) => {
        if (rb.cond.ds) imp.add('edu.wpi.first.wpilibj.DriverStation');
        w.ln(`new Trigger(() -> ${rb.cond.expr}).onTrue(Commands.startEnd(`);
        w.ln(`        () -> ${rb.ctl.field}.setRumble(RumbleType.kBothRumble, ${d(rb.strength)}),`);
        w.ln(`        () -> ${rb.ctl.field}.setRumble(RumbleType.kBothRumble, 0)).withTimeout(${d(rb.seconds)}));`);
      });
    }
    w.close();

    if (model.lights.length) {
      imp.add('frc.robot.subsystems.LedColor');
      w.blank();
      w.open('private void configureLights()');
      model.lights.forEach((lt, n) => {
        if (n) w.blank();
        const call = (pattern, color) => patternCall(lt.field + '.', pattern, color);
        const tail = `.ignoringDisable(true).withName("${q(lt.label + ': Status')}"));`;
        if (!lt.rules.length) {
          w.ln(`// ${lt.label}: what the lights show when no button is using them.`);
          w.ln(`${lt.field}.setDefaultCommand(${lt.field}.run(() -> ${call(lt.otherwise.pattern, lt.otherwise.color)})${tail}`);
        } else {
          w.ln(`// ${lt.label}: the first rule that is true picks the pattern.`);
          w.ln(`${lt.field}.setDefaultCommand(${lt.field}.run(() -> {`);
          lt.rules.forEach((rule, idx) => {
            if (rule.cond.ds) imp.add('edu.wpi.first.wpilibj.DriverStation');
            w.ln(`    ${idx === 0 ? 'if' : '} else if'} (${rule.cond.expr}) {`);
            w.ln(`        ${call(rule.pattern, rule.color)};`);
          });
          w.ln('    } else {');
          w.ln(`        ${call(lt.otherwise.pattern, lt.otherwise.color)};`);
          w.ln('    }');
          w.ln('})' + tail);
        }
      });
      w.close();
    }

    w.blank();
    if (autosOn) {
      w.doc('The auto picked in "Auto Chooser" on the dashboard.');
      w.open('public Command getAutonomousCommand()');
      w.ln('return autos.getSelected();');
    } else {
      imp.add('edu.wpi.first.wpilibj2.command.Commands');
      w.open('public Command getAutonomousCommand()');
      w.ln('return Commands.print("No autonomous command yet");');
    }
    w.close();
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'Subsystems, controllers and button bindings.');
  }

  function buttonExpr(type, key) {
    const m = type === 'joystick' && /^button(\d+)$/.exec(key);
    return m ? `button(${m[1]})` : key + '()';
  }

  /* ================================================================ pneumatics */

  function genPiston(m, ctx) {
    const s = m.src;
    const C = m.constClass;
    const pm = ctx.model.pneumatics;
    const dbl = s.solenoid !== 'single';
    const k = ConstBlock(C, `${m.label}: an air piston on a ${dbl ? 'double' : 'single'} solenoid.`);
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.SubsystemBase',
      'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard', 'edu.wpi.first.wpilibj.PneumaticsModuleType',
      'frc.robot.Constants.PneumaticsConstants', 'frc.robot.Constants.' + C);
    if (dbl) {
      k.add('int', 'kForwardChannel', i(s.forwardChannel), `${pm.label} channel that pushes it out`);
      k.add('int', 'kReverseChannel', i(s.reverseChannel), `${pm.label} channel that pulls it in`);
    } else {
      k.add('int', 'kChannel', i(s.channel), `${pm.label} channel`);
    }
    k.add('boolean', 'kStartExtended', b(s.startState === 'extended'), 'Where it goes when the robot turns on');

    const w = Writer();
    w.doc([`${m.label}: an air piston on a ${dbl ? 'double' : 'single'} solenoid.`, '',
      dbl ? 'A double solenoid stays where it was put, even when the robot is disabled.'
        : 'A single solenoid springs back (pulls in) when it turns off, like when the robot is disabled.']);
    w.open(`public class ${m.cls} extends SubsystemBase`);
    if (dbl) {
      imp.add('edu.wpi.first.wpilibj.DoubleSolenoid', 'edu.wpi.first.wpilibj.DoubleSolenoid.Value');
      w.ln(`private final DoubleSolenoid solenoid = new DoubleSolenoid(PneumaticsConstants.kModuleId,`);
      w.ln(`        PneumaticsModuleType.${pm.type}, ${C}.kForwardChannel, ${C}.kReverseChannel);`);
    } else {
      imp.add('edu.wpi.first.wpilibj.Solenoid');
      w.ln(`private final Solenoid solenoid = new Solenoid(PneumaticsConstants.kModuleId, PneumaticsModuleType.${pm.type}, ${C}.kChannel);`);
    }
    w.blank();
    w.open(`public ${m.cls}()`);
    w.ln(`setExtended(${C}.kStartExtended);`);
    w.close();
    w.blank();
    w.open('private void setExtended(boolean extended)');
    w.ln(dbl ? 'solenoid.set(extended ? Value.kForward : Value.kReverse);' : 'solenoid.set(extended);');
    w.close();
    w.blank();
    w.doc('True when the piston is pushed out.');
    w.open('public boolean isExtended()');
    w.ln(dbl ? 'return solenoid.get() == Value.kForward;' : 'return solenoid.get();');
    w.close();
    m.actions.forEach((a) => {
      const body = a.key === 'extend' ? 'setExtended(true)' : a.key === 'retract' ? 'setExtended(false)' : 'setExtended(!isExtended())';
      const what = a.key === 'extend' ? 'Pushes the piston out.' : a.key === 'retract' ? 'Pulls the piston in.' : 'Flips the piston to the other side.';
      w.blank();
      w.doc(`${a.label}: ${what}`);
      w.open(`public Command ${a.method}()`);
      w.ln(`return runOnce(() -> ${body}).withName("${q(m.label + ': ' + a.label)}");`);
      w.close();
    });
    w.blank();
    w.ln('@Override');
    w.open('public void periodic()');
    w.ln(`SmartDashboard.putBoolean("${telemetryKey(m, 'Extended')}", isExtended());`);
    w.close();
    w.close();
    return { consts: k, file: javaFile('frc.robot.subsystems', imp, w.text(), m.label + ' subsystem.') };
  }

  /* ================================================================ live tuning, SysId, simulation */

  const tuningKeys = (m) => (m.preset === 'flywheel' ? ['kP', 'kI', 'kD', 'kS', 'kV'] : ['kP', 'kI', 'kD', 'kS', 'kV', 'kG']);
  const tunedName = (k) => 'tuned' + cap(k);

  function emitTuningFields(w, m) {
    const C = m.constClass;
    w.ln('// Live tuning: change these on the dashboard while the robot runs (Constants.kLiveTuning).');
    tuningKeys(m).forEach((k) => w.ln(`private double ${tunedName(k)} = ${C}.${k};`));
  }

  function emitTuningMethods(w, m, imp) {
    const keys = tuningKeys(m);
    const talon = m.ctrl === 'talonfx';
    const key = (k) => telemetryKey(m, 'Tuning/' + k);
    w.blank();
    w.doc('Puts the gains on the dashboard so they can be changed while the robot runs.');
    w.open('private void publishTuning()');
    keys.forEach((k) => w.ln(`SmartDashboard.putNumber("${key(k)}", ${tunedName(k)});`));
    w.close();
    w.blank();
    w.doc('Reads the gains from the dashboard and sends them to the motor controller when one changes.');
    w.open('private void updateTuning()');
    keys.forEach((k) => w.ln(`double ${k} = SmartDashboard.getNumber("${key(k)}", ${tunedName(k)});`));
    w.ln(`if (${keys.map((k) => `${k} == ${tunedName(k)}`).join(' && ')}) {`);
    w.ln('    return;');
    w.ln('}');
    keys.forEach((k) => w.ln(`${tunedName(k)} = ${k};`));
    if (talon) {
      imp.add('com.ctre.phoenix6.configs.Slot0Configs');
      const gravity = m.preset === 'arm' ? 'Arm_Cosine' : 'Elevator_Static';
      w.ln('motor.getConfigurator().apply(new Slot0Configs()');
      if (m.preset === 'flywheel') {
        w.ln('        .withKP(kP).withKI(kI).withKD(kD).withKS(kS).withKV(kV));');
      } else {
        imp.add('com.ctre.phoenix6.signals.GravityTypeValue');
        w.ln('        .withKP(kP).withKI(kI).withKD(kD).withKS(kS).withKV(kV).withKG(kG)');
        w.ln(`        .withGravityType(GravityTypeValue.${gravity}));`);
      }
    } else {
      const cfg = CONTROLLERS[m.ctrl].cfg;
      imp.add('com.revrobotics.PersistMode', 'com.revrobotics.ResetMode', 'com.revrobotics.spark.config.' + cfg);
      w.ln(`${cfg} tuning = new ${cfg}();`);
      w.ln('tuning.closedLoop.pid(kP, kI, kD);');
      if (m.preset === 'arm') w.ln('tuning.closedLoop.feedForward.kS(kS).kV(kV).kCos(kG).kCosRatio(1.0 / 360.0);');
      else if (m.preset === 'elevator') w.ln('tuning.closedLoop.feedForward.kS(kS).kV(kV).kG(kG);');
      else w.ln('tuning.closedLoop.feedForward.kS(kS).kV(kV);');
      w.ln('// Only these settings change. Nothing is reset or saved to the SPARK.');
      w.ln('motor.configure(tuning, ResetMode.kNoResetSafeParameters, PersistMode.kNoPersistParameters);');
    }
    w.close();
  }

  /** SysId: the routine that runs the tests and logs what the mechanism does. */
  function emitSysIdFields(w, m, imp, ctx) {
    const talon = m.ctrl === 'talonfx';
    imp.add('static edu.wpi.first.units.Units.*', 'edu.wpi.first.wpilibj2.command.sysid.SysIdRoutine');
    const step = m.preset === 'flywheel' ? 7 : 4;
    const pos = { talon: 'motor.getPosition().getValueAsDouble()', rev: 'encoder.getPosition()' }[talon ? 'talon' : 'rev'];
    const vel = { talon: 'motor.getVelocity().getValueAsDouble()', rev: 'encoder.getVelocity()' }[talon ? 'talon' : 'rev'];
    let logLines;
    if (m.preset === 'elevator') {
      imp.add('edu.wpi.first.math.util.Units');
      logLines = [`.linearPosition(Meters.of(Units.inchesToMeters(${pos})))`, `.linearVelocity(MetersPerSecond.of(Units.inchesToMeters(${vel})))`];
    } else if (m.preset === 'arm') {
      logLines = talon
        ? [`.angularPosition(Rotations.of(${pos}))`, `.angularVelocity(RotationsPerSecond.of(${vel}))`]
        : [`.angularPosition(Degrees.of(${pos}))`, `.angularVelocity(DegreesPerSecond.of(${vel}))`];
    } else {
      logLines = talon
        ? [`.angularPosition(Rotations.of(${pos}))`, `.angularVelocity(RotationsPerSecond.of(${vel}))`]
        : [`.angularPosition(Rotations.of(${pos}))`, `.angularVelocity(RPM.of(${vel}))`];
    }
    w.blank();
    w.ln('// SysId measures kS, kV, kA and kG. The data goes to the robot\'s WPILib log for the SysId tool.');
    if (talon) {
      imp.add('com.ctre.phoenix6.controls.VoltageOut');
      w.ln(`private final VoltageOut sysIdRequest = new VoltageOut(0)${foc(ctx)};`);
    }
    w.ln('private final SysIdRoutine sysId = new SysIdRoutine(');
    w.ln(`        new SysIdRoutine.Config(Volts.of(1).per(Second), Volts.of(${step}), Seconds.of(10)),`);
    w.ln('        new SysIdRoutine.Mechanism(');
    w.ln(talon ? '                volts -> motor.setControl(sysIdRequest.withOutput(volts.in(Volts))),' : '                volts -> motor.setVoltage(volts.in(Volts)),');
    w.ln(`                log -> log.motor("${q(m.cls)}")`);
    w.ln(`                        .voltage(Volts.of(${talon ? 'motor.getMotorVoltage().getValueAsDouble()' : 'motor.getAppliedOutput() * motor.getBusVoltage()'}))`);
    w.ln(`                        ${logLines[0]}`);
    w.ln(`                        ${logLines[1]},`);
    w.ln('                this));');
  }

  function emitSysIdCommands(w, m, after) {
    SYSID_TESTS.forEach(([kind, dir, fn, value, label]) => {
      w.blank();
      w.doc(`${label}. Hold the button until it stops or gets near the end of its travel. Run each test once.`);
      w.open(`public Command sysId${kind}${dir}()`);
      w.ln(`return sysId.${fn}(SysIdRoutine.Direction.${value})${after ? `.finallyDo(${after})` : ''}`);
      w.ln(`        .withName("${q(m.label + ': SysId ' + kind + ' ' + dir)}");`);
      w.close();
    });
  }

  function dcMotor(m) {
    const fn = { krakenX60: 'getKrakenX60', krakenX44: 'getKrakenX44', falcon500: 'getFalcon500', neo: 'getNEO', neoVortex: 'getNeoVortex', neo550: 'getNeo550' }[m.src.motor] || 'getKrakenX60';
    return `DCMotor.${fn}(${1 + m.followers.length})`;
  }

  /** The simulator for a Talon FX or SPARK leader. Returns the Java for the SPARK sim field, if any. */
  function emitSparkSimField(w, m, imp) {
    if (m.ctrl === 'talonfx') return;
    const simCls = m.ctrl === 'sparkflex' ? 'SparkFlexSim' : 'SparkMaxSim';
    imp.add('com.revrobotics.sim.' + simCls);
    w.ln(`private final ${simCls} motorSim = new ${simCls}(motor, ${dcMotor(m)});`);
  }

  /** Start of simulationPeriodic for a Talon FX: battery voltage in, motor voltage out. */
  function emitTalonSimStart(w, m, imp) {
    imp.add('com.ctre.phoenix6.sim.ChassisReference', 'edu.wpi.first.wpilibj.RobotController');
    w.ln('var simState = motor.getSimState();');
    w.ln(`simState.Orientation = ${m.constClass}.kMotorInverted ? ChassisReference.Clockwise_Positive : ChassisReference.CounterClockwise_Positive;`);
    w.ln('simState.setSupplyVoltage(RobotController.getBatteryVoltage());');
    w.ln('sim.setInputVoltage(simState.getMotorVoltage());');
  }

  /* ================================================================ vision */

  function visionConstants(V) {
    const k = ConstBlock('VisionConstants', 'AprilTag vision with Limelight cameras.');
    V.cameras.forEach((cam) => {
      k.gap(`Limelight "${cam.name}"`);
      k.add('String', `k${cam.key}Name`, `"${q(cam.name)}"`, 'The name on the Limelight\'s web page');
      k.add('boolean', `k${cam.key}MegaTag2`, b(cam.megaTag2), 'MegaTag2 is steadier. It uses the gyro for heading');
      k.add('double', `k${cam.key}Trust`, d(cam.trust), 'Position error in meters. Smaller = trust the camera more');
      k.add('double', `k${cam.key}MaxDistanceMeters`, d(cam.maxDistance), 'Ignore tags farther away than this');
    });
    k.gap('Aiming and lining up');
    k.add('double', 'kAimP', d(V.aimP), 'Turn speed (rad/s) for each radian the tag is off center');
    k.add('double', 'kAimToleranceDegrees', d(V.aimTolerance), 'Counts as aimed within this many degrees');
    k.add('double', 'kAimMaxRate', '3.0', 'Fastest turn while aiming in place, rad/s');
    k.add('double', 'kAlignP', d(V.alignP), 'Drive speed (m/s) for each meter away from the spot');
    k.add('double', 'kAlignMaxSpeed', d(V.alignMaxSpeed), 'Fastest drive while lining up, m/s');
    k.add('double', 'kAlignHeadingP', d(V.headingP), 'Turn speed (rad/s) for each radian off the spot\'s heading');
    k.add('double', 'kAlignToleranceMeters', d(V.alignTolerance), 'Counts as there within this distance');
    k.add('double', 'kAlignToleranceDegrees', d(V.alignAngleTolerance), 'and within this many degrees');
    if (V.zones.length) {
      k.gap('AprilTag zones. The robot is "in" a zone when the nearest of its tags is closer than the zone distance');
      if (V.zones.some((z) => z.slow != null)) k.add('double', 'kSlowRampMeters', '0.5', 'Slow zones start easing the speed down this far outside the zone');
    }
    V.zones.forEach((z) => {
      k.gap(`Zone "${z.label}"`);
      k.add('int[]', `k${z.key}ZoneTags`, `{${z.ids.join(', ')}}`, 'AprilTag numbers');
      k.add('double', `k${z.key}ZoneDistanceMeters`, d(z.distance), 'In the zone when closer than this');
      if (z.slow != null) k.add('double', `k${z.key}ZoneSlowFraction`, d(z.slow), 'Drive speed inside the zone (1.0 = full speed)');
      if (z.value != null) {
        const T = TABLE_TARGETS[z.run.t.preset];
        k.add('double', `k${z.key}ZoneValue`, d(z.value), `${z.run.t.label} ${T.what} inside the zone, ${T.unit}`);
      }
    });
    V.tables.forEach((tb) => {
      k.gap(`Distance table "${tb.label}": picks the ${tb.target.label} ${tb.what} from the distance to the tags`);
      k.add('int[]', `k${tb.key}TableTags`, `{${tb.ids.join(', ')}}`, 'AprilTag numbers. Uses the nearest one');
      k.add('double[]', `k${tb.key}TableDistances`, `{${tb.points.map((pt) => d(pt.d)).join(', ')}}`, 'Meters, smallest first');
      k.add('double[]', `k${tb.key}TableValues`, `{${tb.points.map((pt) => d(pt.v)).join(', ')}}`, `${cap(tb.what)} at each distance, ${tb.unit}. In between is blended`);
    });
    return k;
  }

  function genVision(model) {
    const V = model.vision;
    const imp = Imports();
    const w = Writer();
    imp.add('com.ctre.phoenix6.swerve.SwerveRequest', 'com.ctre.phoenix6.swerve.SwerveRequest.ForwardPerspectiveValue',
      'edu.wpi.first.apriltag.AprilTagFieldLayout', 'edu.wpi.first.apriltag.AprilTagFields', 'edu.wpi.first.math.MathUtil',
      'edu.wpi.first.math.Matrix', 'edu.wpi.first.math.VecBuilder', 'edu.wpi.first.math.controller.PIDController',
      'edu.wpi.first.math.geometry.Pose2d', 'edu.wpi.first.math.geometry.Pose3d', 'edu.wpi.first.math.geometry.Rotation2d',
      'edu.wpi.first.math.geometry.Transform2d', 'edu.wpi.first.math.numbers.N1', 'edu.wpi.first.math.numbers.N3',
      'edu.wpi.first.math.util.Units', 'edu.wpi.first.networktables.DoubleArrayPublisher',
      'edu.wpi.first.networktables.DoubleArraySubscriber', 'edu.wpi.first.networktables.DoubleSubscriber',
      'edu.wpi.first.networktables.NetworkTable', 'edu.wpi.first.networktables.NetworkTableInstance',
      'edu.wpi.first.networktables.TimestampedDoubleArray', 'edu.wpi.first.wpilibj.DriverStation',
      'edu.wpi.first.wpilibj.smartdashboard.Field2d', 'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard',
      'edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.Commands',
      'edu.wpi.first.wpilibj2.command.SubsystemBase', 'frc.robot.Constants.VisionConstants',
      'java.util.Optional', 'java.util.Set');
    if (V.zones.length || V.tables.length) imp.add('edu.wpi.first.math.geometry.Translation2d');
    if (V.tables.length) imp.add('edu.wpi.first.math.interpolation.InterpolatingDoubleTreeMap');
    const C = 'VisionConstants';
    const aim = V.cameras[V.aimIdx] || V.cameras[0];

    w.doc(['AprilTag vision with Limelight cameras.', '',
      'Every loop, each camera turns the AprilTags it sees into a robot position on the field, and',
      'good readings are added to the swerve drive\'s position estimate. That keeps paths and lining',
      'up accurate.', '',
      'On each Limelight\'s web page: use an AprilTag pipeline and set where the camera sits on the',
      'robot (Robot Space). Readings are read straight from NetworkTables, so no extra library is needed.']);
    w.open('public class Vision extends SubsystemBase');
    w.ln('private final CommandSwerveDrivetrain drivetrain;');
    w.ln('private final Limelight[] cameras = {');
    V.cameras.forEach((cam) => {
      w.ln(`        new Limelight(${C}.k${cam.key}Name, ${C}.k${cam.key}MegaTag2, ${C}.k${cam.key}Trust, ${C}.k${cam.key}MaxDistanceMeters),`);
    });
    w.ln('};');
    w.doc('The camera used for aiming.');
    w.ln(`private final Limelight aimCamera = cameras[${V.cameras.indexOf(aim)}];`);
    w.ln('private final AprilTagFieldLayout fieldLayout = AprilTagFieldLayout.loadField(AprilTagFields.kDefaultField);');
    w.ln('private final Field2d field = new Field2d();');
    w.ln('private final SwerveRequest.FieldCentricFacingAngle alignRequest = new SwerveRequest.FieldCentricFacingAngle()');
    w.ln('        .withForwardPerspective(ForwardPerspectiveValue.BlueAlliance)');
    w.ln(`        .withHeadingPID(${C}.kAlignHeadingP, 0, 0);`);
    w.ln('private final SwerveRequest.RobotCentric aimRequest = new SwerveRequest.RobotCentric();');
    w.ln(`private final PIDController xController = new PIDController(${C}.kAlignP, 0, 0);`);
    w.ln(`private final PIDController yController = new PIDController(${C}.kAlignP, 0, 0);`);
    if (V.tables.length) {
      w.ln('// Distance tables: blend between the points you measured.');
      V.tables.forEach((tb) => {
        w.ln(`private final InterpolatingDoubleTreeMap ${camel(tb.key)}Table = makeTable(${C}.k${tb.key}TableDistances, ${C}.k${tb.key}TableValues);`);
      });
    }
    w.blank();
    w.open('public Vision(CommandSwerveDrivetrain drivetrain)');
    w.ln('this.drivetrain = drivetrain;');
    w.ln('SmartDashboard.putData("Field", field);');
    w.close();
    w.blank();
    w.ln('@Override');
    w.open('public void periodic()');
    w.ln('var state = drivetrain.getState();');
    w.ln('double yawDegrees = state.Pose.getRotation().getDegrees();');
    w.ln('double yawRate = Units.radiansToDegrees(state.Speeds.omegaRadiansPerSecond);');
    w.ln('boolean disabled = DriverStation.isDisabled();');
    w.open('for (Limelight camera : cameras)');
    w.ln('camera.setRobotYaw(yawDegrees, yawRate);');
    w.ln('// The Tuner X drivetrain converts this FPGA timestamp to its own time base.');
    w.ln('camera.estimate(disabled, yawRate).ifPresent(');
    w.ln('        m -> drivetrain.addVisionMeasurement(m.pose(), m.timestampSeconds(), m.stdDevs()));');
    w.close();
    w.ln('field.setRobotPose(drivetrain.getState().Pose);');
    w.ln('SmartDashboard.putBoolean("Vision/Has Target", hasTarget());');
    w.ln('SmartDashboard.putBoolean("Vision/Aimed", isAimed());');
    V.zones.forEach((z) => w.ln(`SmartDashboard.putBoolean("${q('Vision/In ' + z.label)}", ${z.method}());`));
    if (V.zones.some((z) => z.slow != null)) w.ln('SmartDashboard.putNumber("Vision/Drive Speed Scale", driveSpeedScale());');
    V.tables.forEach((tb) => w.ln(`SmartDashboard.putNumber("${q('Vision/' + tb.label)}", ${tb.method}());`));
    w.close();

    w.blank();
    w.doc('True when the aiming camera sees an AprilTag.');
    w.open('public boolean hasTarget()');
    w.ln('return aimCamera.hasTarget();');
    w.close();
    w.blank();
    w.doc('True when the robot points at the tag the aiming camera sees.');
    w.open('public boolean isAimed()');
    w.ln(`return hasTarget() && Math.abs(aimCamera.tx()) <= ${C}.kAimToleranceDegrees;`);
    w.close();
    w.blank();
    w.doc(['How fast to turn (rad/s, counterclockwise is positive) to point at the tag the aiming', 'camera sees. 0 when no tag is in view.']);
    w.open('public double aimRate(double maxRadiansPerSecond)');
    w.open('if (!hasTarget())');
    w.ln('return 0;');
    w.close();
    w.ln(`double rate = -Units.degreesToRadians(aimCamera.tx()) * ${C}.kAimP;`);
    w.ln('return MathUtil.clamp(rate, -maxRadiansPerSecond, maxRadiansPerSecond);');
    w.close();
    w.blank();
    w.doc('Turns in place until the robot faces the tag. Gives up after 2 seconds.');
    w.open('public Command aimAtTag()');
    w.ln('return drivetrain.applyRequest(() -> aimRequest');
    w.ln(`                .withVelocityX(0).withVelocityY(0).withRotationalRate(aimRate(${C}.kAimMaxRate)))`);
    w.ln('        .until(this::isAimed)');
    w.ln('        .withTimeout(2)');
    w.ln('        .withName("Vision: Aim at Tag");');
    w.close();

    if (V.zones.length || V.tables.length) {
      w.blank();
      w.doc(['How far the robot is from the nearest of these tags, in meters. It uses the robot\'s', 'field position, so the tag does not have to be in view. Very large if none are on the field.']);
      w.open('public double distanceTo(int[] tagIds)');
      w.ln('Translation2d robot = drivetrain.getState().Pose.getTranslation();');
      w.ln('double nearest = Double.MAX_VALUE;');
      w.open('for (int id : tagIds)');
      w.ln('Optional<Pose3d> tag = fieldLayout.getTagPose(id);');
      w.open('if (tag.isPresent())');
      w.ln('nearest = Math.min(nearest, tag.get().toPose2d().getTranslation().getDistance(robot));');
      w.close();
      w.close();
      w.ln('return nearest;');
      w.close();
    }
    V.zones.forEach((z) => {
      w.blank();
      w.doc(`${z.label}: true when the robot is within ${z.distance} m of tag${z.ids.length > 1 ? 's' : ''} ${idText(z.ids)}.`);
      w.open(`public boolean ${z.method}()`);
      w.ln(`return distanceTo(${C}.k${z.key}ZoneTags) <= ${C}.k${z.key}ZoneDistanceMeters;`);
      w.close();
    });
    const slowZones = V.zones.filter((z) => z.slow != null);
    if (slowZones.length) {
      w.blank();
      w.doc(['How fast the driver may drive, from 0 to 1 (full speed). Coming up to a slow zone,', 'it eases down to that zone\'s speed so the robot does not jerk.']);
      w.open('public double driveSpeedScale()');
      w.ln('double scale = 1.0;');
      slowZones.forEach((z) => {
        w.ln(`scale = Math.min(scale, slowScale(${C}.k${z.key}ZoneTags, ${C}.k${z.key}ZoneDistanceMeters,`);
        w.ln(`        ${C}.k${z.key}ZoneSlowFraction));`);
      });
      w.ln('return scale;');
      w.close();
      w.blank();
      w.open('private double slowScale(int[] tagIds, double zoneMeters, double slowFraction)');
      w.ln(`double outside = MathUtil.clamp((distanceTo(tagIds) - zoneMeters) / ${C}.kSlowRampMeters, 0.0, 1.0);`);
      w.ln('return slowFraction + (1.0 - slowFraction) * outside;');
      w.close();
    }
    V.tables.forEach((tb) => {
      w.blank();
      w.doc(`${tb.label}: the ${tb.target.label} ${tb.what} (${tb.unit}) for the distance to tag${tb.ids.length > 1 ? 's' : ''} ${idText(tb.ids)}.`);
      w.open(`public double ${tb.method}()`);
      w.ln(`return ${camel(tb.key)}Table.get(distanceTo(${C}.k${tb.key}TableTags));`);
      w.close();
    });
    if (V.tables.length) {
      w.blank();
      w.doc('Makes a lookup table. Between two points it blends; past the ends it uses the end value.');
      w.open('private static InterpolatingDoubleTreeMap makeTable(double[] distances, double[] values)');
      w.ln('InterpolatingDoubleTreeMap table = new InterpolatingDoubleTreeMap();');
      w.open('for (int i = 0; i < Math.min(distances.length, values.length); i++)');
      w.ln('table.put(distances[i], values[i]);');
      w.close();
      w.ln('return table;');
      w.close();
    }

    V.spots.forEach((sp) => {
      w.blank();
      w.doc([`${sp.label}: lines up ${sp.distance} m in front of the nearest of tags ${idText(sp.ids)}` +
        (sp.sideways ? `, ${Math.abs(sp.sideways)} m to the ${sp.sideways > 0 ? 'left' : 'right'}` : '') + ', facing it.']);
      w.open(`public Command ${sp.method}()`);
      w.ln(`return alignTo(new int[] {${sp.ids.join(', ')}}, ${d(sp.distance)}, ${d(sp.sideways)})`);
      w.ln(`        .withName("${q('Vision: ' + sp.label)}");`);
      w.close();
    });

    w.blank();
    w.doc(['Drives to a spot in front of the nearest listed tag and turns to face it.', '',
      'distanceMeters is how far out from the tag. sidewaysMeters moves the spot to the left',
      '(positive) or right (negative) as seen by the robot facing the tag.']);
    w.open('private Command alignTo(int[] tagIds, double distanceMeters, double sidewaysMeters)');
    w.ln('return Commands.defer(() -> nearestSpot(tagIds, distanceMeters, sidewaysMeters)');
    w.ln('        .map(this::driveTo)');
    w.ln('        .orElse(Commands.print("None of those AprilTags are on the field")), Set.of(drivetrain));');
    w.close();
    w.blank();
    w.open('private Optional<Pose2d> nearestSpot(int[] tagIds, double distanceMeters, double sidewaysMeters)');
    w.ln('Pose2d robot = drivetrain.getState().Pose;');
    w.ln('Pose2d best = null;');
    w.ln('double bestDistance = Double.MAX_VALUE;');
    w.open('for (int id : tagIds)');
    w.ln('Optional<Pose3d> tag = fieldLayout.getTagPose(id);');
    w.open('if (tag.isEmpty())');
    w.ln('continue;');
    w.close();
    w.ln('// The tag\'s x axis points out of its face. Turn around so the robot faces the tag.');
    w.ln('Pose2d spot = tag.get().toPose2d()');
    w.ln('        .transformBy(new Transform2d(distanceMeters, -sidewaysMeters, Rotation2d.k180deg));');
    w.ln('double distance = spot.getTranslation().getDistance(robot.getTranslation());');
    w.open('if (distance < bestDistance)');
    w.ln('bestDistance = distance;');
    w.ln('best = spot;');
    w.close();
    w.close();
    w.ln('return Optional.ofNullable(best);');
    w.close();
    w.blank();
    w.doc('Drives straight to a spot on the field and stops there. Gives up after 4 seconds.');
    w.open('private Command driveTo(Pose2d target)');
    w.ln('return drivetrain.applyRequest(() -> {');
    w.ln('            Pose2d pose = drivetrain.getState().Pose;');
    w.ln(`            double vx = MathUtil.clamp(xController.calculate(pose.getX(), target.getX()), -${C}.kAlignMaxSpeed, ${C}.kAlignMaxSpeed);`);
    w.ln(`            double vy = MathUtil.clamp(yController.calculate(pose.getY(), target.getY()), -${C}.kAlignMaxSpeed, ${C}.kAlignMaxSpeed);`);
    w.ln('            return alignRequest.withVelocityX(vx).withVelocityY(vy).withTargetDirection(target.getRotation());');
    w.ln('        })');
    w.ln('        .until(() -> isAt(target))');
    w.ln('        .withTimeout(4);');
    w.close();
    w.blank();
    w.open('private boolean isAt(Pose2d target)');
    w.ln('Pose2d pose = drivetrain.getState().Pose;');
    w.ln(`return pose.getTranslation().getDistance(target.getTranslation()) <= ${C}.kAlignToleranceMeters`);
    w.ln(`        && Math.abs(pose.getRotation().minus(target.getRotation()).getDegrees()) <= ${C}.kAlignToleranceDegrees;`);
    w.close();

    // The Limelight reader
    w.blank();
    w.doc(['One Limelight, read straight from NetworkTables.', '',
      'botpose arrays are [x, y, z, roll, pitch, yaw, latency ms, tag count, tag span, average tag',
      'distance, average tag area], then 7 numbers per tag (the 7th is ambiguity).']);
    w.open('private static class Limelight');
    w.ln('private final boolean megaTag2;');
    w.ln('private final double trust;');
    w.ln('private final double maxDistance;');
    w.ln('private final DoubleArraySubscriber megaTag1Pose;');
    w.ln('private final DoubleArraySubscriber megaTag2Pose;');
    w.ln('private final DoubleArrayPublisher robotOrientation;');
    w.ln('private final DoubleSubscriber targetValid;');
    w.ln('private final DoubleSubscriber targetX;');
    w.ln('private long lastTimestamp = 0;');
    w.blank();
    w.open('Limelight(String name, boolean megaTag2, double trust, double maxDistance)');
    w.ln('NetworkTable table = NetworkTableInstance.getDefault().getTable(name);');
    w.ln('this.megaTag2 = megaTag2;');
    w.ln('this.trust = trust;');
    w.ln('this.maxDistance = maxDistance;');
    w.ln('megaTag1Pose = table.getDoubleArrayTopic("botpose_wpiblue").subscribe(new double[0]);');
    w.ln('megaTag2Pose = table.getDoubleArrayTopic("botpose_orb_wpiblue").subscribe(new double[0]);');
    w.ln('robotOrientation = table.getDoubleArrayTopic("robot_orientation_set").publish();');
    w.ln('targetValid = table.getDoubleTopic("tv").subscribe(0);');
    w.ln('targetX = table.getDoubleTopic("tx").subscribe(0);');
    w.close();
    w.blank();
    w.open('boolean hasTarget()');
    w.ln('return targetValid.get() >= 1;');
    w.close();
    w.blank();
    w.doc('How far the tag is from the center of the picture, in degrees. Positive is to the right.');
    w.open('double tx()');
    w.ln('return targetX.get();');
    w.close();
    w.blank();
    w.doc('MegaTag2 needs to know which way the robot faces.');
    w.open('void setRobotYaw(double yawDegrees, double yawRateDegreesPerSecond)');
    w.ln('robotOrientation.set(new double[] {yawDegrees, yawRateDegreesPerSecond, 0, 0, 0, 0});');
    w.close();
    w.blank();
    w.doc(['The robot\'s position as this camera sees it, if it looks trustworthy.', '',
      'While disabled it uses MegaTag1, which can also fix the robot\'s heading before the match.',
      'While enabled it uses MegaTag2 (if turned on), which is steadier but trusts the gyro.']);
    w.open('Optional<Measurement> estimate(boolean disabled, double yawRateDegreesPerSecond)');
    w.ln('boolean useMegaTag2 = megaTag2 && !disabled;');
    w.ln('TimestampedDoubleArray sample = (useMegaTag2 ? megaTag2Pose : megaTag1Pose).getAtomic();');
    w.ln('double[] data = sample.value;');
    w.open('if (data.length < 11 || sample.timestamp == lastTimestamp)');
    w.ln('return Optional.empty();');
    w.close();
    w.ln('lastTimestamp = sample.timestamp;');
    w.ln('int tagCount = (int) data[7];');
    w.ln('double averageDistance = data[9];');
    w.open('if (tagCount < 1 || averageDistance > maxDistance)');
    w.ln('return Optional.empty();');
    w.close();
    w.ln('// MegaTag2 readings smear while the robot spins fast.');
    w.open('if (useMegaTag2 && Math.abs(yawRateDegreesPerSecond) > 720)');
    w.ln('return Optional.empty();');
    w.close();
    w.ln('// One tag seen with MegaTag1 can flip between two answers. Skip it unless it is clear.');
    w.open('if (!useMegaTag2 && tagCount == 1 && data.length >= 18 && data[17] > 0.7)');
    w.ln('return Optional.empty();');
    w.close();
    w.ln('Pose2d pose = new Pose2d(data[0], data[1], Rotation2d.fromDegrees(data[5]));');
    w.ln('double timestamp = sample.timestamp / 1e6 - data[6] / 1000.0;');
    w.ln('// Only MegaTag1 with two or more tags is good enough to correct the heading.');
    w.ln('double headingTrust = !useMegaTag2 && tagCount >= 2 ? trust : 9999999;');
    w.ln('return Optional.of(new Measurement(pose, timestamp, VecBuilder.fill(trust, trust, headingTrust)));');
    w.close();
    w.close();
    w.blank();
    w.doc('A robot position from a camera, when it was seen, and how much to trust it.');
    w.ln('private record Measurement(Pose2d pose, double timestampSeconds, Matrix<N3, N1> stdDevs) {}');
    w.close();
    return javaFile('frc.robot.subsystems', imp, w.text(), 'AprilTag vision.');
  }

  /* ================================================================ combos and shared steps */

  function genSteps() {
    const imp = Imports();
    imp.add('edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.CommandScheduler',
      'edu.wpi.first.wpilibj2.command.Commands', 'java.util.function.BooleanSupplier');
    const w = Writer();
    w.doc(['Building blocks that combos and autos share.', '',
      'Each step runs as a proxy, so a combo or auto only holds a subsystem while that step uses it.',
      'That lets something started with start() keep running while later steps use other subsystems.']);
    w.open('public final class Steps');
    w.ln('private Steps() {}');
    w.blank();
    w.doc('Runs a command until it finishes by itself.');
    w.open('public static Command runUntilDone(Command command)');
    w.ln('return command.asProxy();');
    w.close();
    w.blank();
    w.doc('Runs a command for a set time, then stops it.');
    w.open('public static Command runFor(Command command, double seconds)');
    w.ln('return command.withTimeout(seconds).asProxy();');
    w.close();
    w.blank();
    w.doc(['Starts a command and moves on right away. It keeps running until it finishes, another', 'step needs that subsystem, or the robot is disabled.']);
    w.open('public static Command start(Command command)');
    w.ln('return Commands.runOnce(() -> CommandScheduler.getInstance().schedule(command));');
    w.close();
    w.blank();
    w.doc('Waits until something is true, but never longer than maxSeconds.');
    w.open('public static Command waitUntil(BooleanSupplier condition, double maxSeconds)');
    w.ln('return Commands.waitUntil(condition).withTimeout(maxSeconds);');
    w.close();
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'Step helpers shared by combos and autos.');
  }

  function genCombos(model) {
    const K = model.combos;
    const imp = Imports();
    imp.add('static frc.robot.Steps.*', 'edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.Commands');
    const w = Writer();
    w.doc(['Button combos: several actions in a row on one button.', '',
      'Put them on buttons in Robot Code Builder under Controls > Buttons. Autos can run them too.',
      '', 'Generated by Robot Code Builder. Re-generating replaces this file.']);
    w.open('public class Combos');
    w.ln('private final RobotContainer robot;');
    w.blank();
    w.open('public Combos(RobotContainer robot)');
    w.ln('this.robot = robot;');
    w.close();
    K.combos.forEach((cb) => {
      const calls = cb.steps.map(stepCall);
      w.blank();
      const docLines = [cb.label + (calls.length ? ':' : ': does nothing yet.')];
      calls.forEach((cl, n) => docLines.push(`${n + 1}. ${cl.text}`));
      w.doc(docLines);
      w.open(`public Command ${cb.method}()`);
      if (!calls.length) {
        w.ln(`return Commands.none().withName("${q('Combo: ' + cb.label)}");`);
      } else {
        w.ln('return Commands.sequence(');
        calls.forEach((cl, n) => w.ln(`        ${cl.code}${n === calls.length - 1 ? ')' : ','}`));
        w.ln(`        .withName("${q('Combo: ' + cb.label)}");`);
      }
      w.close();
    });
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'Button combos.');
  }

  /* ================================================================ autonomous */

  /** "1.5" as a spot on a path, for comments. */
  function spotText(pos) {
    const n = Math.floor(pos + 1e-9);
    return Math.abs(pos - n) < 1e-6 ? `waypoint ${n}` : `${+pos.toFixed(2)}`;
  }

  /** The Java for one action on a path (see PathSteps.java), and a line for the Javadoc. */
  function spotCall(sp, secs) {
    const at = d(sp.pos);
    if (sp.kind === 'stop') {
      if (sp.do === 'wait') return { code: `stopAt(${at}, "Wait", Commands.waitSeconds(${d(sp.seconds)}))`, text: `At ${spotText(sp.pos)}: stop and wait ${secs(sp.seconds)}` };
      if (sp.do === 'until') {
        return {
          code: `stopAt(${at}, "${q('Wait until ' + sp.cond.label)}", waitUntil(() -> ${sp.cond.expr}, ${d(sp.seconds)}))`,
          text: `At ${spotText(sp.pos)}: stop until ${sp.cond.label} (at most ${secs(sp.seconds)})`,
        };
      }
      const name = `${sp.target.label}: ${sp.action.label}`;
      const call = actionCall(sp.target, sp.action, 'robot.');
      return sp.mode === 'finish'
        ? { code: `stopAt(${at}, "${q(name)}", runUntilDone(${call}))`, text: `At ${spotText(sp.pos)}: stop and run ${name} until it finishes` }
        : { code: `stopAt(${at}, "${q(name)}", runFor(${call}, ${d(sp.seconds)}))`, text: `At ${spotText(sp.pos)}: stop and run ${name} for ${secs(sp.seconds)}` };
    }
    const name = `${sp.target.label}: ${sp.action.label}`;
    const call = actionCall(sp.target, sp.action, 'robot.');
    switch (sp.until) {
      case 'spot':
        return { code: `whileDriving(${at}, ${d(sp.endPos)}, "${q(name)}", ${call})`, text: `From ${spotText(sp.pos)} to ${spotText(sp.endPos)}: ${name} while driving` };
      case 'time':
        return { code: `startAt(${at}, "${q(name)}", ${call}.withTimeout(${d(sp.seconds)}))`, text: `At ${spotText(sp.pos)}: start ${name} for ${secs(sp.seconds)} while driving` };
      case 'keep':
        return { code: `startAt(${at}, "${q(name)}", ${call})`, text: `At ${spotText(sp.pos)}: start ${name} and let it keep going` };
      default:
        return { code: `whileDriving(${at}, -1, "${q(name)}", ${call})`, text: `From ${spotText(sp.pos)}: ${name} until the robot stops` };
    }
  }

  /** The Java call for one routine step, and a plain-English line for the Javadoc. */
  function stepCall(st) {
    const secs = (v) => `${+Number(v).toFixed(2)} s`;
    switch (st.type) {
      case 'drive':
        return { code: `drive(${d(st.x)}, ${d(st.y)}, ${d(st.seconds)})`, text: `Drive ${DRIVE_DIRS[st.dir].label.toLowerCase()} at ${st.speed} m/s for ${secs(st.seconds)}` };
      case 'action': {
        const call = actionCall(st.target, st.action, 'robot.');
        const what = `${st.target.label}: ${st.action.label}`;
        if (st.mode === 'finish') return { code: `runUntilDone(${call})`, text: `${what}, until it finishes` };
        if (st.mode === 'background') return { code: `start(${call})`, text: `Start ${what} and keep going` };
        return { code: `runFor(${call}, ${d(st.seconds)})`, text: `${what} for ${secs(st.seconds)}` };
      }
      case 'wait':
        return { code: `Commands.waitSeconds(${d(st.seconds)})`, text: `Wait ${secs(st.seconds)}` };
      case 'until':
        return { code: `waitUntil(() -> ${st.cond.expr}, ${d(st.seconds)})`, text: `Wait until ${st.cond.label} (at most ${secs(st.seconds)})` };
      case 'path': {
        const text = `Follow the PathPlanner path "${st.pathName}"${st.resetPose ? ', starting at its first point' : ''}`;
        if (!st.spots || !st.spots.length) return { code: `followPath("${q(st.pathName)}", ${b(st.resetPose)})`, text };
        const parts = st.spots.map((sp) => spotCall(sp, secs));
        const code = `followPath("${q(st.pathName)}", ${b(st.resetPose)},\n` +
          parts.map((p, i) => '        ' + p.code + (i === parts.length - 1 ? ')' : ',')).join('\n');
        return { code, text, sub: parts.map((p) => p.text) };
      }
      default:
        return { code: 'Commands.none()', text: 'Nothing' };
    }
  }

  function genAutos(model) {
    const A = model.autos;
    const imp = Imports();
    const w = Writer();
    imp.add('edu.wpi.first.wpilibj.smartdashboard.SendableChooser', 'edu.wpi.first.wpilibj.smartdashboard.SmartDashboard',
      'edu.wpi.first.wpilibj2.command.Command', 'edu.wpi.first.wpilibj2.command.Commands');
    const all = A.routines.reduce((list, r) => list.concat(r.steps), []);
    const has = (type, mode) => all.some((s) => s.type === type && (!mode || s.mode === mode));
    const uses = {
      heading: A.routines.some((r) => r.resetHeading),
      drive: has('drive'),
      finish: has('action', 'finish'),
      time: has('action', 'time'),
      background: has('action', 'background'),
      until: has('until'),
      path: has('path'),
    };
    const needDrivetrain = A.usePP || uses.drive || uses.heading;

    w.doc(['Autonomous routines and the auto chooser on the dashboard.', '',
      'Pick an auto in "Auto Chooser" on the dashboard before each match.' + (A.usePP ? ' Autos made in the' : ''),
      A.usePP ? 'PathPlanner app show up in the same list.' : null,
      '', 'Each step runs as a proxy, so a routine only holds a subsystem while that step uses it.',
      'That lets a step started in the background keep running while later steps use other subsystems.',
      '', 'Generated by Robot Code Builder. Re-generating replaces this file.'].filter((x) => x !== null));
    w.open('public class Autos');
    w.ln('private final RobotContainer robot;');
    if (needDrivetrain) {
      imp.add('frc.robot.subsystems.CommandSwerveDrivetrain');
      w.ln('private final CommandSwerveDrivetrain drivetrain;');
    }
    if (A.usePP) {
      imp.add('com.ctre.phoenix6.swerve.SwerveRequest');
      w.ln('private final SwerveRequest.ApplyRobotSpeeds pathRequest = new SwerveRequest.ApplyRobotSpeeds();');
    }
    if (uses.drive) {
      imp.add('com.ctre.phoenix6.swerve.SwerveRequest', 'com.ctre.phoenix6.swerve.SwerveModule.DriveRequestType');
      w.ln('private final SwerveRequest.RobotCentric driveRequest = new SwerveRequest.RobotCentric()');
      w.ln('        .withDriveRequestType(DriveRequestType.OpenLoopVoltage);');
    }
    w.ln('private final SendableChooser<Command> chooser;');
    w.blank();

    // ---- constructor
    w.open('public Autos(RobotContainer robot)');
    w.ln('this.robot = robot;');
    if (needDrivetrain) w.ln('this.drivetrain = robot.drivetrain;');
    w.blank();
    if (A.usePP) {
      imp.add('com.pathplanner.lib.auto.AutoBuilder', 'com.pathplanner.lib.commands.FollowPathCommand',
        'edu.wpi.first.wpilibj2.command.CommandScheduler');
      w.ln('// PathPlanner needs the drive set up and the named commands registered before it loads any autos.');
      w.ln('boolean pathPlannerReady = configurePathPlanner();');
      w.ln('registerNamedCommands();');
      w.ln('if (pathPlannerReady) {');
      w.ln('    chooser = AutoBuilder.buildAutoChooser(); // every auto made in the PathPlanner app, plus "None"');
      w.ln('} else {');
      w.ln('    chooser = new SendableChooser<>();');
      w.ln('    chooser.setDefaultOption("None", Commands.none());');
      w.ln('}');
    } else {
      w.ln('chooser = new SendableChooser<>();');
      w.ln('chooser.setDefaultOption("None", Commands.none());');
    }
    if (A.routines.length) w.ln('// Routines made in Robot Code Builder.');
    A.routines.forEach((r) => {
      const isDefault = A.defaultRoutine && A.defaultRoutine.id === r.id;
      w.ln(`chooser.${isDefault ? 'setDefaultOption' : 'addOption'}("${q(r.chooserName)}", ${r.method}());`);
    });
    w.ln('SmartDashboard.putData("Auto Chooser", chooser);');
    if (A.usePP) {
      w.blank();
      w.open('if (pathPlannerReady)');
      w.ln("// Follow a path once in the background so the first real path doesn't stutter.");
      w.ln('CommandScheduler.getInstance().schedule(FollowPathCommand.warmupCommand());');
      w.close();
    }
    w.close();
    w.blank();
    w.doc('The auto picked on the dashboard.');
    w.open('public Command getSelected()');
    w.ln('return chooser.getSelected();');
    w.close();

    // ---- PathPlanner
    if (A.usePP) {
      imp.add('com.pathplanner.lib.auto.NamedCommands', 'com.pathplanner.lib.config.PIDConstants',
        'com.pathplanner.lib.config.RobotConfig', 'com.pathplanner.lib.controllers.PPHolonomicDriveController',
        'edu.wpi.first.wpilibj.DriverStation', 'edu.wpi.first.wpilibj.DriverStation.Alliance',
        'frc.robot.Constants.AutoConstants');
      w.blank();
      w.doc(["Connects PathPlanner to the swerve drive. Returns false if PathPlanner isn't set up yet.", '',
        'If your CommandSwerveDrivetrain already does this, its setup is used instead.']);
      w.open('private boolean configurePathPlanner()');
      w.open('if (AutoBuilder.isConfigured())');
      w.ln('return true;');
      w.close();
      w.open('try');
      w.ln("// The robot's size, weight and gearing come from the PathPlanner app's settings.");
      w.ln('RobotConfig config = RobotConfig.fromGUISettings();');
      w.ln('AutoBuilder.configure(');
      w.ln('        () -> drivetrain.getState().Pose,');
      w.ln('        drivetrain::resetPose,');
      w.ln('        () -> drivetrain.getState().Speeds,');
      w.ln('        (speeds, feedforwards) -> drivetrain.setControl(pathRequest.withSpeeds(speeds)');
      w.ln('                .withWheelForceFeedforwardsX(feedforwards.robotRelativeForcesXNewtons())');
      w.ln('                .withWheelForceFeedforwardsY(feedforwards.robotRelativeForcesYNewtons())),');
      w.ln('        new PPHolonomicDriveController(');
      w.ln('                new PIDConstants(AutoConstants.kPathTranslationP, 0, 0),');
      w.ln('                new PIDConstants(AutoConstants.kPathRotationP, 0, 0)),');
      w.ln('        config,');
      w.ln('        // Paths are drawn for the blue side. Flip them when we are red.');
      w.ln('        () -> DriverStation.getAlliance().orElse(Alliance.Blue) == Alliance.Red,');
      w.ln('        drivetrain);');
      w.ln('return true;');
      w.close(' catch (Exception e) {');
      w.ln('    DriverStation.reportError("PathPlanner isn\'t set up yet. Save the robot settings in the PathPlanner app. "');
      w.ln('            + e.getMessage(), false);');
      w.ln('    return false;');
      w.ln('}');
      w.close();
      w.blank();
      w.doc(['Commands PathPlanner autos can use. Type these exact names into the', 'named command blocks in the PathPlanner app.']);
      w.open('private void registerNamedCommands()');
      if (!A.named.length) w.ln('// Add subsystems in Robot Code Builder to get named commands.');
      A.named.forEach((nc) => w.ln(`NamedCommands.registerCommand("${q(nc.name)}", ${actionCall(nc.target, nc.action, 'robot.')});`));
      w.close();
    }

    // ---- routines
    A.routines.forEach((r) => {
      const calls = [];
      if (r.resetHeading) calls.push({ code: 'resetHeading()', text: 'Make the way the robot faces "forward"' });
      r.steps.forEach((st) => calls.push(stepCall(st)));
      w.blank();
      const docLines = [r.label + (calls.length ? ':' : ': does nothing yet.')];
      calls.forEach((cl, n) => {
        docLines.push(`${n + 1}. ${cl.text}`);
        (cl.sub || []).forEach((line) => docLines.push(`   - ${line}`));
      });
      w.doc(docLines);
      w.open(`private Command ${r.method}()`);
      if (!calls.length) {
        w.ln(`return Commands.none().withName("${q('Auto: ' + r.label)}");`);
      } else {
        w.ln('return Commands.sequence(');
        calls.forEach((cl, n) => {
          const lines = cl.code.split('\n');
          lines.forEach((line, i) => w.ln(`        ${line}${i === lines.length - 1 ? (n === calls.length - 1 ? ')' : ',') : ''}`));
        });
        w.ln(`        .withName("${q('Auto: ' + r.label)}");`);
      }
      w.close();
    });

    // ---- step helpers, only the ones the routines use
    if (uses.heading) {
      w.blank();
      w.doc(['Makes the way the robot faces right now "forward" for field-centric driving.',
        'Start the robot facing away from your driver station.']);
      w.open('private Command resetHeading()');
      w.ln('return Commands.runOnce(drivetrain::seedFieldCentric);');
      w.close();
    }
    if (uses.drive) {
      w.blank();
      w.doc(['Drives without turning, relative to the robot, then stops.', 'x is forward and y is left, in meters per second.']);
      w.open('private Command drive(double xMetersPerSecond, double yMetersPerSecond, double seconds)');
      w.ln('return drivetrain.applyRequest(() -> driveRequest');
      w.ln('                .withVelocityX(xMetersPerSecond).withVelocityY(yMetersPerSecond).withRotationalRate(0))');
      w.ln('        .withTimeout(seconds)');
      w.ln('        .andThen(drivetrain.runOnce(() -> drivetrain.setControl(');
      w.ln('                driveRequest.withVelocityX(0).withVelocityY(0).withRotationalRate(0))))');
      w.ln('        .asProxy();');
      w.close();
    }
    // runUntilDone, runFor, start and waitUntil come from Steps.java.
    const spots = all.filter((s) => s.type === 'path').reduce((list, s) => list.concat(s.spots || []), []);
    const stopSteps = spots.some((sp) => sp.kind === 'stop' && sp.do !== 'wait');
    if (uses.finish || uses.time || uses.background || uses.until || stopSteps) imp.add('static frc.robot.Steps.*');
    if (spots.length) imp.add('static frc.robot.PathSteps.*');
    if (uses.path) {
      imp.add('com.pathplanner.lib.path.PathPlannerPath', 'edu.wpi.first.math.geometry.Pose2d', 'edu.wpi.first.wpilibj.DriverStation');
      w.blank();
      w.doc(['Follows a path drawn in the PathPlanner app.', '',
        "startHere sets the robot's position to the path's first point, flipped for the red side."]
        .concat(spots.length ? ['spots are actions along the path (see PathSteps.java).'] : []));
      w.open(spots.length ? 'private Command followPath(String pathName, boolean startHere, PathSteps.Spot... spots)'
        : 'private Command followPath(String pathName, boolean startHere)');
      w.open('try');
      w.ln('PathPlannerPath path = PathPlannerPath.fromPathFile(pathName);');
      w.ln(spots.length ? 'Command follow = spots.length == 0 ? AutoBuilder.followPath(path) : PathSteps.follow(path, spots);'
        : 'Command follow = AutoBuilder.followPath(path);');
      w.open('if (startHere)');
      w.ln('Pose2d start = path.getStartingHolonomicPose().orElse(path.getStartingDifferentialPose());');
      w.ln('follow = AutoBuilder.resetOdom(start).andThen(follow);');
      w.close();
      w.ln('return follow.asProxy();');
      w.close(' catch (Exception e) {');
      w.ln('    DriverStation.reportError("Couldn\'t load the PathPlanner path \\"" + pathName + "\\": " + e.getMessage(), false);');
      w.ln('    return Commands.none();');
      w.ln('}');
      w.close();
    }
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'Autonomous routines and the auto chooser.');
  }


  /* ================================================================ actions along paths */

  function genPathSteps() {
    const imp = Imports();
    imp.add('com.pathplanner.lib.auto.AutoBuilder', 'com.pathplanner.lib.path.ConstraintsZone', 'com.pathplanner.lib.path.EventMarker',
      'com.pathplanner.lib.path.GoalEndState', 'com.pathplanner.lib.path.IdealStartingState', 'com.pathplanner.lib.path.PathPlannerPath',
      'com.pathplanner.lib.path.PointTowardsZone', 'com.pathplanner.lib.path.RotationTarget', 'com.pathplanner.lib.path.Waypoint',
      'edu.wpi.first.math.geometry.Rotation2d', 'edu.wpi.first.math.geometry.Translation2d', 'edu.wpi.first.wpilibj2.command.Command',
      'edu.wpi.first.wpilibj2.command.CommandScheduler', 'edu.wpi.first.wpilibj2.command.Commands', 'java.util.ArrayList',
      'java.util.Arrays', 'java.util.Comparator', 'java.util.List', 'java.util.function.DoubleUnaryOperator');
    const w = Writer();
    w.doc(['Actions at spots along a PathPlanner path, set up in Robot Code Builder.', '',
      'A spot is a "waypoint-relative position", the same numbers PathPlanner uses: 0 is the first',
      'waypoint, 1 is the second, and 1.5 is halfway between the second and the third.', '',
      'At a stop spot the path is cut in two: the robot drives there, stops, runs the action, then',
      'drives the rest. The other spots become event markers, so their actions run while the robot',
      'keeps driving. Your .path files are not changed. The pieces are made when the code starts.']);
    w.open('public final class PathSteps');
    w.ln('private PathSteps() {}');
    w.blank();
    w.doc('One action at a spot. endPosition is -1 when it does not end at a later spot.');
    w.ln('public record Spot(double position, double endPosition, boolean stop, String name, Command command) {}');
    w.blank();
    w.doc('Drives to the spot, stops, runs the command, then keeps driving.');
    w.open('public static Spot stopAt(double position, String name, Command command)');
    w.ln('return new Spot(position, -1, true, name, command);');
    w.close();
    w.blank();
    w.doc(['Runs a command while the robot keeps driving, from a spot until a later spot. With an end of -1',
      'it runs until the robot stops: at the end of the path or at the next stop spot.']);
    w.open('public static Spot whileDriving(double position, double endPosition, String name, Command command)');
    w.ln('return new Spot(position, endPosition, false, name, runOffPath(command));');
    w.close();
    w.blank();
    w.doc('Starts a command at a spot and lets it keep going, even after the path ends.');
    w.open('public static Spot startAt(double position, String name, Command command)');
    w.ln('return new Spot(position, -1, false, name, Commands.runOnce(() -> CommandScheduler.getInstance().schedule(command)));');
    w.close();
    w.blank();
    w.doc('Follows the path, stopping at each stop spot to run its action and running the others on the way.');
    w.open('public static Command follow(PathPlannerPath path, Spot... spots)');
    w.ln('List<Spot> sorted = new ArrayList<>(Arrays.asList(spots));');
    w.ln('sorted.sort(Comparator.comparingDouble(Spot::position));');
    w.ln('double last = path.getWaypoints().size() - 1;');
    w.ln('List<Command> steps = new ArrayList<>();');
    w.ln('double from = 0.0;');
    w.open('for (Spot spot : sorted)');
    w.open('if (!spot.stop())');
    w.ln('continue;');
    w.close();
    w.ln('double at = Math.max(0.0, Math.min(last, spot.position()));');
    w.open('if (at - from > 0.001)');
    w.ln('// Drive to the stop, ending stopped there.');
    w.ln('steps.add(AutoBuilder.followPath(piece(path, from, at, sorted, true)));');
    w.ln('from = at;');
    w.close();
    w.ln('steps.add(spot.command());');
    w.close();
    w.open('if (last - from > 0.001)');
    w.ln('steps.add(AutoBuilder.followPath(piece(path, from, last, sorted, false)));');
    w.close();
    w.ln('return Commands.sequence(steps.toArray(Command[]::new));');
    w.close();
    w.blank();
    w.doc('The part of a path between two spots, with the markers and targets that fall inside it.');
    w.open('private static PathPlannerPath piece(PathPlannerPath path, double from, double to, List<Spot> spots, boolean stopAtEnd)');
    w.ln('List<Waypoint> wps = path.getWaypoints();');
    w.ln('double last = wps.size() - 1;');
    w.ln('boolean toEnd = to >= last - 1e-9;');
    w.ln('int lastSegment = wps.size() - 2;');
    w.ln('int first = Math.min((int) Math.floor(from), lastSegment);');
    w.ln('int end = Math.max(first, Math.min((int) Math.ceil(to) - 1, lastSegment));');
    w.ln('// Cut each Bezier segment the piece covers.');
    w.ln('List<Translation2d[]> curves = new ArrayList<>();');
    w.open('for (int s = first; s <= end; s++)');
    w.ln('double t0 = s == first ? from - s : 0.0;');
    w.ln('double t1 = s == end ? to - s : 1.0;');
    w.ln('Translation2d[] curve = {wps.get(s).anchor(), wps.get(s).nextControl(), wps.get(s + 1).prevControl(), wps.get(s + 1).anchor()};');
    w.ln('curve = split(curve, t1)[0];');
    w.ln('curves.add(split(curve, t1 > 0 ? t0 / t1 : 0.0)[1]);');
    w.close();
    w.ln('List<Waypoint> waypoints = new ArrayList<>();');
    w.open('for (int i = 0; i <= curves.size(); i++)');
    w.ln('Translation2d prev = i > 0 ? curves.get(i - 1)[2] : null;');
    w.ln('Translation2d anchor = i < curves.size() ? curves.get(i)[0] : curves.get(i - 1)[3];');
    w.ln('Translation2d next = i < curves.size() ? curves.get(i)[1] : null;');
    w.ln('waypoints.add(new Waypoint(prev, anchor, next));');
    w.close();
    w.ln('// Where a spot on the whole path lands on this piece.');
    w.ln('DoubleUnaryOperator map = (p) -> {');
    w.ln('    int s = Math.max(first, Math.min(end, (int) Math.floor(p)));');
    w.ln('    double t0 = s == first ? from - s : 0.0;');
    w.ln('    double t1 = s == end ? to - s : 1.0;');
    w.ln('    return (s - first) + (t1 > t0 ? (p - s - t0) / (t1 - t0) : 0.0);');
    w.ln('};');
    w.ln('List<RotationTarget> rotations = new ArrayList<>();');
    w.open('for (RotationTarget r : path.getRotationTargets())');
    w.open('if (r.position() > from && r.position() < to)');
    w.ln('rotations.add(new RotationTarget(map.applyAsDouble(r.position()), r.rotation()));');
    w.close();
    w.close();
    w.ln('List<PointTowardsZone> pointZones = new ArrayList<>();');
    w.open('for (PointTowardsZone z : path.getPointTowardsZones())');
    w.ln('double a = Math.max(z.minPosition(), from);');
    w.ln('double b = Math.min(z.maxPosition(), to);');
    w.open('if (b > a)');
    w.ln('pointZones.add(new PointTowardsZone(z.name(), z.targetPosition(), z.rotationOffset(), map.applyAsDouble(a), map.applyAsDouble(b)));');
    w.close();
    w.close();
    w.ln('List<ConstraintsZone> zones = new ArrayList<>();');
    w.open('for (ConstraintsZone z : path.getConstraintZones())');
    w.ln('double a = Math.max(z.minPosition(), from);');
    w.ln('double b = Math.min(z.maxPosition(), to);');
    w.open('if (b > a)');
    w.ln('zones.add(new ConstraintsZone(map.applyAsDouble(a), map.applyAsDouble(b), z.constraints()));');
    w.close();
    w.close();
    w.ln('// Markers from the PathPlanner app, then the actions from Robot Code Builder.');
    w.ln('List<EventMarker> markers = new ArrayList<>();');
    w.open('for (EventMarker m : path.getEventMarkers())');
    w.open('if (m.position() >= from - 1e-9 && (m.position() < to - 1e-9 || toEnd))');
    w.ln('double endAt = m.endPosition() < 0 ? -1.0 : map.applyAsDouble(Math.min(m.endPosition(), to));');
    w.ln('markers.add(new EventMarker(m.triggerName(), map.applyAsDouble(m.position()), endAt, m.command()));');
    w.close();
    w.close();
    w.open('for (Spot spot : spots)');
    w.ln('double p = Math.max(0.0, Math.min(last, spot.position()));');
    w.open('if (!spot.stop() && p >= from - 1e-9 && (p < to - 1e-9 || toEnd))');
    w.ln('double endAt = spot.endPosition() < 0 ? -1.0 : map.applyAsDouble(Math.min(spot.endPosition(), to));');
    w.ln('markers.add(new EventMarker(spot.name(), map.applyAsDouble(p), endAt, spot.command()));');
    w.close();
    w.close();
    w.ln('IdealStartingState start = from <= 1e-9 ? path.getIdealStartingState() : new IdealStartingState(0.0, rotationAt(path, from));');
    w.ln('GoalEndState goal = toEnd && !stopAtEnd ? path.getGoalEndState() : new GoalEndState(0.0, rotationAt(path, to));');
    w.ln('return new PathPlannerPath(waypoints, rotations, pointZones, zones, markers, path.getGlobalConstraints(), start, goal, path.isReversed());');
    w.close();
    w.blank();
    w.doc('Which way the robot faces at a spot, blended between the rotation targets around it.');
    w.open('private static Rotation2d rotationAt(PathPlannerPath path, double position)');
    w.ln('double prevPos = 0.0;');
    w.ln('Rotation2d prevRot = path.getIdealStartingState() != null ? path.getIdealStartingState().rotation() : path.getGoalEndState().rotation();');
    w.ln('double nextPos = path.getWaypoints().size() - 1;');
    w.ln('Rotation2d nextRot = path.getGoalEndState().rotation();');
    w.open('for (RotationTarget r : path.getRotationTargets())');
    w.open('if (r.position() <= position && r.position() >= prevPos)');
    w.ln('prevPos = r.position();');
    w.ln('prevRot = r.rotation();');
    w.close();
    w.open('if (r.position() >= position && r.position() <= nextPos)');
    w.ln('nextPos = r.position();');
    w.ln('nextRot = r.rotation();');
    w.close();
    w.close();
    w.ln('return prevRot.interpolate(nextRot, nextPos > prevPos ? (position - prevPos) / (nextPos - prevPos) : 0.0);');
    w.close();
    w.blank();
    w.doc('Cuts a cubic Bezier curve in two at t (de Casteljau).');
    w.open('private static Translation2d[][] split(Translation2d[] c, double t)');
    w.ln('Translation2d p01 = c[0].interpolate(c[1], t);');
    w.ln('Translation2d p12 = c[1].interpolate(c[2], t);');
    w.ln('Translation2d p23 = c[2].interpolate(c[3], t);');
    w.ln('Translation2d p012 = p01.interpolate(p12, t);');
    w.ln('Translation2d p123 = p12.interpolate(p23, t);');
    w.ln('Translation2d mid = p012.interpolate(p123, t);');
    w.ln('return new Translation2d[][] {{c[0], p01, p012, mid}, {mid, p123, p23, c[3]}};');
    w.close();
    w.blank();
    w.doc(['Runs a command from an event marker without the path needing that subsystem, so a path',
      'never fights the rest of the auto. It is like asProxy(), but asProxy() does not work inside a',
      'marker: a command scheduled while the path runs only starts at the end of the loop, and the',
      'proxy would think it had already finished.']);
    w.open('private static Command runOffPath(Command command)');
    w.open('return new Command()');
    w.ln('private boolean started;');
    w.blank();
    w.ln('@Override');
    w.open('public void initialize()');
    w.ln('started = false;');
    w.ln('CommandScheduler.getInstance().schedule(command);');
    w.close();
    w.blank();
    w.ln('@Override');
    w.open('public void execute()');
    w.ln('started |= command.isScheduled();');
    w.close();
    w.blank();
    w.ln('@Override');
    w.open('public boolean isFinished()');
    w.ln('return started && !command.isScheduled();');
    w.close();
    w.blank();
    w.ln('@Override');
    w.open('public void end(boolean interrupted)');
    w.open('if (interrupted)');
    w.ln('command.cancel();');
    w.close();
    w.close();
    w.close(';');
    w.close();
    w.close();
    return javaFile('frc.robot', imp, w.text(), 'Actions at spots along PathPlanner paths.');
  }

  /* ================================================================ README + wiring */

  function wiringRows(model) {
    const order = ['can', 'dio', 'pwm', 'pneu', 'usb'];
    return model.devices.slice().sort((a, b) => (a.bus === b.bus ? a.id - b.id : order.indexOf(a.bus) - order.indexOf(b.bus)));
  }

  function genReadme(model) {
    const p = model.project;
    const lines = [];
    const team = String(p.teamNumber || '').trim();
    lines.push(`${p.robotName || 'Robot'}${team ? ' - Team ' + team : ''}`);
    lines.push('Generated by Robot Code Builder for ' + LIBS_TEXT + '.');
    lines.push('');
    lines.push('HOW TO ADD THIS TO YOUR ROBOT PROJECT');
    if (p.tunerSwerve) {
      lines.push('1. Make the swerve project in Phoenix Tuner X (Mechanisms > Swerve Project Generator)');
      lines.push('   and open it in WPILib VS Code.');
      lines.push('2. Copy the "src" folder from this zip into the project folder.');
      lines.push('   Say yes when it asks to replace RobotContainer.java. Your swerve code');
      lines.push('   (TunerConstants, CommandSwerveDrivetrain, Telemetry) stays as it is.');
    } else {
      lines.push('1. Open a WPILib command-based Java project in WPILib VS Code.');
      lines.push('2. Copy the "src" folder from this zip into the project folder and replace');
      lines.push('   RobotContainer.java.');
    }
    const libs = [];
    if (model.hasCtre || p.tunerSwerve) libs.push('Phoenix 6');
    if (model.hasRev) libs.push('REVLib');
    if (model.autos.usePP) libs.push('PathplannerLib');
    if (libs.length) {
      const list = libs.length > 1 ? libs.slice(0, -1).join(', ') + ' and ' + libs[libs.length - 1] : libs[0];
      lines.push(`3. Install the vendor libraries: ${list}. In VS Code, open the WPILib`);
      lines.push('   Vendor Dependencies panel and install them from the list.');
    } else {
      lines.push('3. No vendor libraries are needed.');
    }
    lines.push('4. Build (WPILib: Build Robot Code), then deploy with the robot on blocks.');
    lines.push('');
    lines.push('BEFORE YOU ENABLE');
    lines.push('- Put the robot on blocks. Check that every motor spins the right way.');
    lines.push('  If one is backwards, flip its "Inverted" value in Constants.java.');
    model.subsystems.forEach((m) => {
      if (m.preset === 'elevator') lines.push(`- ${m.label}: turn the robot on with the elevator all the way down.`);
      if (m.preset === 'arm' && (m.src.encoder || 'builtin') === 'builtin') lines.push(`- ${m.label}: turn the robot on with the arm at ${num(m.src.startAngle, 90)} degrees.`);
      if (m.preset === 'arm' && m.src.encoder && m.src.encoder !== 'builtin') lines.push(`- ${m.label}: set kAbsoluteEncoderOffset. Hold the arm level and read "${m.label}/Absolute Raw" on the dashboard.`);
      if (m.preset === 'climber') lines.push(`- ${m.label}: turn the robot on with the climber all the way down.`);
    });
    lines.push('- PID and feedforward values are starting points. Tune them slowly.');
    const A = model.autos;
    if (A.enabled) {
      lines.push('');
      lines.push('AUTONOMOUS');
      lines.push('- Pick an auto in "Auto Chooser" on the dashboard before every match.');
      if (A.routines.length) {
        lines.push(`- Routines from Robot Code Builder: ${A.routines.map((r) => r.chooserName).join(', ')}.`);
      }
      lines.push(`- If nobody picks one, it runs: ${A.defaultRoutine ? A.defaultRoutine.chooserName : 'None (the robot sits still)'}.`);
      if (A.routines.some((r) => r.resetHeading)) {
        lines.push('- Start the robot facing away from your driver station. The routines use that');
        lines.push('  direction as "forward" for field-centric driving.');
      }
      if (A.usePP) {
        lines.push('- PathPlanner: open this project folder in the PathPlanner app and fill in');
        lines.push('  Settings > Robot Config (mass, MOI, wheel size, gearing, motor, current limit,');
        lines.push('  module positions). Until then the robot reports "PathPlanner isn\'t set up yet"');
        lines.push('  and only the routines above show up in the chooser.');
        if (A.named.length) {
          const spotted = A.routines.filter((r) => r.steps.some((st) => st.type === 'path' && st.spots.length));
          if (spotted.length) {
            lines.push(`- Actions along paths (${spotted.map((r) => r.chooserName).join(', ')}) are in PathSteps.java. They are`);
            lines.push('  added when the code starts, so your .path files are not changed. If you move or add');
            lines.push('  waypoints in PathPlanner, import the path into Robot Code Builder again and check the spots.');
          }
          const made = model.paths.filter((pp) => pp.fromApp);
          if (made.length) lines.push(`- Paths made in Robot Code Builder are in the zip: ${made.map((pp) => pp.name).join(', ')}.`);
          lines.push('- Named commands you can use in PathPlanner autos:');
          A.named.forEach((nc) => lines.push('    ' + nc.name));
        }
      }
    }
    if (model.vision) {
      const V = model.vision;
      lines.push('');
      lines.push('APRILTAG VISION');
      lines.push(`- Cameras: ${V.cameras.map((c) => c.name).join(', ')}. On each Limelight's web page, use an AprilTag`);
      lines.push('  pipeline and set where the camera sits on the robot (Robot Space). The names here must');
      lines.push('  match the names on the web page.');
      lines.push('- The dashboard "Field" shows where the robot thinks it is. Check it before every match.');
      lines.push('- Before the match, the cameras also fix which way the robot faces (MegaTag1, 2+ tags).');
      if (V.spots.length) lines.push(`- Line-up spots: ${V.spots.map((s) => s.label).join(', ')}. Test them slowly on blocks first.`);
      if (V.zones.length) {
        lines.push(`- Zones: ${V.zones.map((z) => z.label).join(', ')}. They use the robot's field position, so they`);
        lines.push('  are only as good as the "Field" view. Check "Vision/In ..." on the dashboard.');
        if (V.zones.some((z) => z.run)) lines.push('  Zone actions run in teleop only.');
      }
      if (V.tables.length) {
        lines.push(`- Distance tables: ${V.tables.map((t) => t.label).join(', ')}. Measure real shots at a few`);
        lines.push('  distances and put them in Constants.java (VisionConstants). The dashboard shows each');
        lines.push('  table\'s current value under "Vision/".');
      }
    }
    if (model.rumbles.length) {
      lines.push('');
      lines.push('RUMBLE ALERTS');
      model.rumbles.forEach((rb) => lines.push(`- ${rb.ctl.label} shakes when: ${rb.cond.label}.`));
    }
    if (model.combos.combos.length) {
      lines.push('');
      lines.push('BUTTON COMBOS');
      lines.push(`- ${model.combos.combos.map((c) => c.label).join(', ')}. They live in Combos.java.`);
    }
    const closedLoop = model.subsystems.filter((m) => CLOSED_LOOP.includes(m.preset));
    if (p.sysId && closedLoop.length) {
      lines.push('');
      lines.push('SYSID (MEASURING kS, kV, kA, kG)');
      lines.push('1. Put the four SysId tests on buttons (Controls > Buttons in Robot Code Builder).');
      lines.push('2. Enable, then hold each test button until it stops or nears the end of travel.');
      lines.push('3. Get the .wpilog from the robot (WPILib Data Log Tool or AdvantageScope).');
      lines.push('4. Open it in the SysId tool (WPILib: Start Tool > SysId) and analyze.');
      lines.push('5. Type the kS, kV and kG it gives into Robot Code Builder (Tuning > Use SysId results).');
      lines.push('   It converts them to the units this code uses.');
    }
    if (p.liveTuning && closedLoop.length) {
      lines.push('');
      lines.push('LIVE TUNING');
      lines.push('- Change gains on the dashboard under "<Subsystem>/Tuning". They apply right away.');
      lines.push('- Copy good values back into Constants.java, then set kLiveTuning to false for matches.');
    }
    if (p.simulation !== false && closedLoop.length) {
      lines.push('');
      lines.push('SIMULATION');
      lines.push('- In VS Code: WPILib: Simulate Robot Code. Pick the Sim GUI, then drag a controller in.');
      lines.push('- Each elevator and arm has a picture on the dashboard ("<Subsystem>/Mechanism").');
      lines.push('- The simulator is a rough model. Real gains still need tuning on the robot.');
    }
    lines.push('');
    lines.push('WIRING');
    const busTitle = { can: 'CAN', dio: 'DIO', pwm: 'PWM', pneu: 'SOL', usb: 'USB' };
    wiringRows(model).forEach((dev) => {
      lines.push(`${busTitle[dev.bus].padEnd(4)} ${String(dev.id).padStart(2)}  ${dev.owner}: ${dev.what}`);
    });
    if (p.tunerSwerve && String(p.swerveIds || '').trim()) lines.push(`CAN  ${String(p.swerveIds).trim()}  Swerve drive (from Tuner X)`);
    if (model.issues.length) {
      lines.push('');
      lines.push('CHECKS');
      model.issues.forEach((x) => lines.push(`- [${x.level}] ${x.text}`));
    }
    lines.push('');
    return lines.join('\r\n');
  }

  /* ================================================================ entry point */

  /**
   * Generates every file. Returns { files: [{path, name, content}], model }.
   */
  function generate(robot) {
    const model = buildModel(robot);
    const ctx = { project: model.project, model };
    const files = [];
    const blocks = [];
    model.subsystems.forEach((m) => {
      let out;
      if (m.preset === 'roller' || m.preset === 'climber') out = genOpenLoop(m, ctx);
      else if (m.preset === 'flywheel') out = genFlywheel(m, ctx);
      else if (m.preset === 'piston') out = genPiston(m, ctx);
      else out = genPosition(m, ctx);
      blocks.push(out.consts);
      files.push({ path: `src/main/java/frc/robot/subsystems/${m.cls}.java`, name: m.cls + '.java', content: out.file, owner: m.id });
    });
    model.lights.forEach((lt) => {
      const out = genLights(lt, ctx);
      blocks.push(out.consts);
      files.push({ path: `src/main/java/frc/robot/subsystems/${lt.cls}.java`, name: lt.cls + '.java', content: out.file, owner: lt.id });
    });
    if (model.lights.length) {
      files.push({ path: 'src/main/java/frc/robot/subsystems/LedColor.java', name: 'LedColor.java', content: genLedColorEnum() });
    }
    if (model.vision) {
      files.push({ path: 'src/main/java/frc/robot/subsystems/Vision.java', name: 'Vision.java', content: genVision(model), owner: 'vision' });
    }
    if (model.autos.enabled || model.combos.combos.length) {
      files.unshift({ path: 'src/main/java/frc/robot/Steps.java', name: 'Steps.java', content: genSteps() });
    }
    if (model.combos.combos.length) {
      files.unshift({ path: 'src/main/java/frc/robot/Combos.java', name: 'Combos.java', content: genCombos(model) });
    }
    const pathSpots = model.autos.usePP && model.autos.routines.some((r) => r.steps.some((s) => s.type === 'path' && s.spots.length));
    if (pathSpots) {
      files.unshift({ path: 'src/main/java/frc/robot/PathSteps.java', name: 'PathSteps.java', content: genPathSteps() });
    }
    if (model.autos.enabled) {
      files.unshift({ path: 'src/main/java/frc/robot/Autos.java', name: 'Autos.java', content: genAutos(model) });
    }
    if (model.autos.usePP) {
      // Paths made in Robot Code Builder (like the example) go in the zip. Imported ones are already in your project.
      model.paths.filter((p) => p.fromApp).forEach((p) => files.push({
        path: `src/main/deploy/pathplanner/paths/${p.name}.path`, name: p.name + '.path',
        content: JSON.stringify(PathGeom.complete(JSON.parse(JSON.stringify(p.data))), null, 2) + '\n',
      }));
    }
    files.unshift({ path: 'src/main/java/frc/robot/RobotContainer.java', name: 'RobotContainer.java', content: genRobotContainer(model) });
    files.unshift({ path: 'src/main/java/frc/robot/Constants.java', name: 'Constants.java', content: genConstants(model, blocks) });
    files.push({ path: 'README.txt', name: 'README.txt', content: genReadme(model) });
    return { files, model };
  }

  const api = {
    MOTORS, CONTROLLERS, PRESETS, LIGHT_TYPES, CONTROLLER_TYPES, BUTTONS, DRIVE_BUTTON_DEFAULTS, WHEN,
    LED_COLORS, LED_PATTERNS, CANDLE_STRIP_TYPES, STRIP_ORDERS, LIBS_TEXT,
    DRIVE_DIRS, STEP_TYPES, ACTION_MODES, newAutos, newRoutine, newStep, CLOSED_LOOP, SYSID_TESTS,
    newVision, newCamera, newSpot, newCombo, newZone, newTable, newRumble, TABLE_TARGETS, PathGeom, newPathSpot, examplePath, walkPP,
    newRobot, exampleRobot, newSubsystem, newLight, newController, newAction, newSetpoint, newSpeed, uid,
    applyMotorDefaults, estimateKV, estimateKG, defaultGains, controllerOf, buildModel, generate, parseIdList,
    pascal, camel, wiringRows,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RobotGen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
