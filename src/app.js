/* Robot Code Builder: the page. Everything that writes Java lives in gen.js (window.RobotGen). */
(function () {
  'use strict';
  const G = window.RobotGen;
  const KEY_ROBOT = 'robot-code-builder/robot/v1';
  const KEY_UI = 'robot-code-builder/ui/v1';
  const $ = (id) => document.getElementById(id);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  /* ------------------------------------------------------------ DOM helper */

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    let value;
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'value') value = v;
        else if (k === 'checked') el.checked = true;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    add(el, kids);
    if (value !== undefined) el.value = String(value);
    return el;
  }
  function add(el, kids) {
    kids.forEach((k) => {
      if (k === null || k === undefined || k === false || k === true) return;
      if (Array.isArray(k)) add(el, k);
      else el.append(k.nodeType ? k : document.createTextNode(String(k)));
    });
  }

  let toastTimer = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
  }

  function readStore(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage is blocked here; the page still works */ }
  }

  /* ------------------------------------------------------------ state */

  let robot = null;
  const ui = {
    sel: { kind: 'robot' },
    file: 'Constants.java',
    lastFile: null,
    files: [],
    model: null,
    error: null,
    help: new Set(),
    checksOpen: true,
    confirmDelete: null,
    confirmReset: false,
    sysIdInput: {},
    sim: null,
    simAuto: null,
    pathObservers: [],
    lastSpot: null,
    pathEdit: null,
  };

  /** Fills gaps in a saved or hand-edited robot so older files keep working. */
  function migrate(data) {
    if (!data || typeof data !== 'object' || (!Array.isArray(data.subsystems) && !data.project)) {
      throw new Error("That file isn't a robot file from Robot Code Builder.");
    }
    const base = G.newRobot();
    const r = {
      app: 'robot-code-builder',
      version: 1,
      example: !!data.example,
      project: Object.assign({}, base.project, data.project || {}),
      drive: Object.assign({}, base.drive, data.drive || {}),
    };
    r.subsystems = arr(data.subsystems).filter((s) => s && G.PRESETS[s.preset]).map((s) => {
      const def = G.newSubsystem(s.preset, { id: s.id || G.uid('s') });
      const out = Object.assign({}, def, s);
      out.id = s.id || def.id;
      out.gains = {
        ctre: Object.assign({}, def.gains.ctre, (s.gains || {}).ctre || {}),
        rev: Object.assign({}, def.gains.rev, (s.gains || {}).rev || {}),
      };
      out.followers = arr(s.followers).map((f) => Object.assign({ id: G.uid('f'), canId: 0, opposite: false }, f));
      ['actions', 'setpoints', 'speeds'].forEach((k) => {
        if (def[k]) out[k] = arr(s[k]).map((x) => Object.assign({ id: G.uid('i') }, x));
      });
      ['sensor', 'limitSwitch', 'softLimits'].forEach((k) => {
        if (def[k]) out[k] = Object.assign({}, def[k], s[k] || {});
      });
      return out;
    });
    r.lights = arr(data.lights).filter((l) => l && G.LIGHT_TYPES[l.type]).map((l) => {
      const def = G.newLight(l.type, { id: l.id || G.uid('l') });
      const out = Object.assign({}, def, l);
      out.id = l.id || def.id;
      out.rules = arr(l.rules).map((x) => Object.assign({ id: G.uid('u'), when: 'disabled', pattern: 'solid', color: 'WHITE' }, x));
      out.signals = arr(l.signals).map((x) => Object.assign({ id: G.uid('g'), name: 'Signal', pattern: 'strobe', color: 'WHITE' }, x));
      out.otherwise = Object.assign({ pattern: 'off', color: 'WHITE' }, l.otherwise || {});
      return out;
    });
    r.controllers = arr(data.controllers).map((c, i) => ({
      id: c.id || G.uid('c'),
      name: typeof c.name === 'string' ? c.name : 'Controller ' + (i + 1),
      type: G.CONTROLLER_TYPES[c.type] ? c.type : 'xbox',
      port: Number.isFinite(Number(c.port)) ? Number(c.port) : i,
    }));
    r.bindings = arr(data.bindings).map((b) => Object.assign({ id: G.uid('b'), when: 'pressed' }, b));
    const da = data.autos || {};
    r.autos = Object.assign(G.newAutos(), da);
    r.autos.routines = arr(da.routines).map((rt, i) => ({
      id: rt.id || G.uid('t'),
      name: typeof rt.name === 'string' ? rt.name : 'Auto ' + (i + 1),
      resetHeading: rt.resetHeading !== false,
      steps: arr(rt.steps).filter((s) => s && G.STEP_TYPES[s.type]).map((s) => {
        const out = Object.assign(G.newStep(s.type), s);
        if (s.type === 'path') out.spots = arr(s.spots).filter(Boolean).map((sp) => Object.assign(G.newPathSpot(sp.kind), sp));
        return out;
      }),
    }));
    r.ppAutos = arr(data.ppAutos).filter((a) => a && typeof a.name === 'string' && a.data && a.data.command)
      .map((a) => ({ id: a.id || G.uid('a'), name: a.name, data: a.data, imported: a.imported || null }));
    r.paths = arr(data.paths).filter((p) => p && typeof p.name === 'string' && G.PathGeom.valid(p.data))
      .map((p) => ({ id: p.id || G.uid('n'), name: p.name, data: p.data, imported: p.imported || null, fromApp: !!p.fromApp }));
    const dv = data.vision || {};
    r.vision = Object.assign(G.newVision(), dv);
    r.vision.cameras = arr(dv.cameras).filter(Boolean).map((c) => Object.assign(G.newCamera(), c));
    r.vision.spots = arr(dv.spots).filter(Boolean).map((s) => Object.assign(G.newSpot(), s));
    r.vision.zones = arr(dv.zones).filter(Boolean).map((z) => Object.assign(G.newZone(), z));
    r.vision.tables = arr(dv.tables).filter(Boolean).map((t) => {
      const out = Object.assign(G.newTable(), t);
      out.points = arr(t.points).filter(Boolean).map((p) => Object.assign({ id: G.uid('q'), distance: 0, value: 0 }, p));
      return out;
    });
    r.combos = arr(data.combos).filter(Boolean).map((cb, i) => ({
      id: cb.id || G.uid('k'),
      name: typeof cb.name === 'string' ? cb.name : 'Combo ' + (i + 1),
      steps: arr(cb.steps).filter((s) => s && G.STEP_TYPES[s.type]).map((s) => Object.assign(G.newStep(s.type), s)),
    }));
    r.rumbles = arr(data.rumbles).filter(Boolean).map((x) => Object.assign(G.newRumble(), x));
    if (!r.controllers.some((c) => c.id === r.drive.controllerId)) r.drive.controllerId = r.controllers[0] ? r.controllers[0].id : null;
    return r;
  }

  function nextCanId() {
    const used = new Set(G.parseIdList(robot.project.swerveIds));
    G.buildModel(robot).devices.filter((d) => d.bus === 'can').forEach((d) => used.add(d.id));
    const max = Math.max(0, ...used);
    for (let n = max + 1; n <= 62; n++) if (!used.has(n)) return n;
    for (let n = 1; n <= 62; n++) if (!used.has(n)) return n;
    return 62;
  }
  function nextPort(bus) {
    const used = new Set(G.buildModel(robot).devices.filter((d) => d.bus === bus).map((d) => d.id));
    for (let n = 0; n < 10; n++) if (!used.has(n)) return n;
    return 0;
  }
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  /* ------------------------------------------------------------ help text */

  const H = {
    team: 'Your FRC team number. It goes in the comments and the README.',
    swerve: 'Turn this on if your swerve code comes from the Swerve Project Generator in Phoenix Tuner X. The driving code goes in RobotContainer and your TunerConstants file is left alone.',
    swerveIds: 'The CAN IDs your swerve already uses: drive motors, steer motors, CANcoders and the Pigeon. You get a warning if a mechanism reuses one. Example: 1-12, 13',
    swerveBus: 'Type "rio" if the swerve is on the roboRIO\'s CAN bus, or your CANivore\'s name if it\'s on a CANivore.',
    ctreBus: 'Where the Talon FXs, CANcoders, CANrange and CANdle for your mechanisms are plugged in. "rio" is the roboRIO\'s own CAN bus. Type your CANivore\'s name if they are on a CANivore. REV SPARKs always use the roboRIO bus.',
    pro: 'Only check this if these motors have a Phoenix Pro license. It turns on FOC, which gives about 15% more power.',
    motor: 'The motor model. The motor controller comes with it: Kraken and Falcon have a Talon FX built in, NEO and NEO 550 use a SPARK MAX, and NEO Vortex uses a SPARK Flex.',
    vortex: 'Pick SPARK MAX only if you run the Vortex through a Solo Adapter.',
    canId: 'The ID set on the motor controller with Phoenix Tuner X (CTRE) or REV Hardware Client (REV). Every device on a CAN bus needs its own ID from 1 to 62.',
    idle: 'Brake holds the mechanism still when it stops. Coast lets it spin freely. Arms, elevators and climbers usually use brake.',
    inverted: 'Check this if a positive speed makes the mechanism go the wrong way. Test with the robot on blocks.',
    stator: 'Limits motor torque and heat. 80 A is a safe start for a Kraken X60 or Falcon.',
    supply: 'Limits the current pulled from the battery so breakers don\'t trip. 40 A is a safe start.',
    smart: 'Protects the motor. Good starting points: NEO 40 A, NEO Vortex 50 A, NEO 550 20 A.',
    followers: 'Extra motors that copy the main motor, like a second motor on the same gearbox. They use the same motor model. Check "Spins opposite" if one is mounted facing the other way.',
    gear: 'How many times the motor turns for one turn of the output. A 25:1 gearbox is 25. For two stages, multiply them: 5:1 and 4:1 make 20.',
    gearFly: 'Motor turns per flywheel turn. Use 1 for direct drive. Use less than 1 if the flywheel spins faster than the motor, like 0.5 for 1:2.',
    gearElev: 'Motor turns per turn of the sprocket or drum that pulls the elevator.',
    gearClimb: 'Motor turns per turn of the spool or output shaft.',
    sprocket: 'Pitch diameter of the sprocket or drum. A 22-tooth #25 sprocket is 1.757 in. A 16-tooth #25 sprocket is 1.281 in.',
    travel: 'How far the carriage moves for each inch of chain or rope. 1 for single stage or continuous rigging, 2 for a 2-stage cascade, 3 for a 3-stage cascade.',
    maxHeight: 'How high the elevator can go, in inches above the bottom. The code won\'t drive past this.',
    setpointsElev: 'Heights the elevator can go to. Each one becomes a command you can put on a button.',
    setpointsArm: 'Angles the arm can go to. 0° is level and 90° is straight up. Each one becomes a command you can put on a button.',
    tolerance: 'How close counts as "there". A move command finishes once it gets this close.',
    profile: 'Moves smoothly by speeding up and slowing down instead of jumping. It uses Motion Magic on a Talon FX and MAXMotion on a SPARK.',
    cruise: 'Top speed while moving to a setpoint.',
    accel: 'How fast it speeds up and slows down. Lower is gentler.',
    jog: 'Jog buttons aim this far ahead of where the mechanism is. A bigger number jogs faster.',
    limit: 'A switch at the bottom of the elevator, wired to a roboRIO DIO port. The height resets to 0 every time the switch is pressed.',
    normallyOpen: 'Most limit switches are normally open. Uncheck this if yours is wired normally closed.',
    encoder: 'How the code knows the arm angle. The motor\'s own encoder only counts from where it started, so the arm has to start in the same spot every time. An absolute encoder (Through Bore or CANcoder) knows the real angle as soon as the robot turns on.',
    startAngle: 'Where the arm is when the robot turns on, like resting on a hard stop. 0° is level, 90° is straight up.',
    offset: 'The raw reading (0 to 1) when the arm is level. To find it: deploy with 0 here, hold the arm level, read "NAME/Absolute Raw" on the dashboard, then type that number here.',
    encInv: 'Check this if the angle on the dashboard goes down when the arm moves up.',
    angles: 'The arm is never driven past these angles. They work like soft limits.',
    gains: 'kP pushes harder the farther it is from the target. kD calms overshoot. kS is the voltage it takes to start moving. kV is the voltage per unit of speed. kG holds the mechanism up against gravity. Start small and raise kP slowly on the robot.',
    actions: 'Each action spins the rollers at a speed while its button runs it. Negative speeds spin backward.',
    actionsClimb: 'Speeds the climber runs at while its button is held. Negative speeds go down.',
    sensor: 'Tells the code when a game piece is inside, so intake actions can stop by themselves and the lights can change.',
    activeLow: 'Most beam breaks and switches read false when they are triggered. Uncheck this if yours reads true.',
    distance: 'Anything closer than this counts as a game piece. 0.1 m is about 4 inches.',
    speeds: 'Speeds the shooter can spin up to. It spins while the button runs the command and coasts down after.',
    tolRpm: 'How close to the target speed counts as "at speed" for the lights.',
    soft: 'Stops the climber before it winds too far. Measured in output turns from where it was when the robot turned on. Read "NAME/Position (rot)" on the dashboard to find good numbers.',
    controllers: 'The port numbers match the USB tab in the Driver Station.',
    topSpeed: 'Percent of the top speed Tuner X calculated for your swerve.',
    turn: 'How fast the robot spins at full stick, in turns per second. 0.75 is three quarters of a turn.',
    deadband: 'Stick movement smaller than this is ignored, so the robot doesn\'t creep.',
    resetBtn: 'Press this with the robot facing away from you to fix field-centric driving.',
    brakeBtn: 'Hold to point the wheels in an X so other robots can\'t push you.',
    slowBtn: 'Hold to drive slower for lining up.',
    sysId: 'Adds the Tuner X tuning tests on Back or Start plus X or Y. Only for Xbox controllers.',
    when: 'While held runs while the button is down. When pressed starts it and lets it finish. Toggle starts on one press and stops on the next. When released starts when you let go.',
    rules: 'The lights show the first rule that is true, from the top. "Otherwise" is used when none are true.',
    signals: 'Patterns a driver can show with a button, like asking the human player for a game piece. Put them on buttons under Controls.',
    stripLen: 'How many LEDs are on the strip plugged into the CANdle. The 8 LEDs on the CANdle itself are separate.',
    onboard: 'Also light the 8 LEDs on the CANdle itself.',
    stripType: 'The color order of the strip. Most WS2812B strips are GRB. If red shows up as green, try RGB.',
    brightness: 'Lower brightness is easier on the eyes and on the battery.',
    pwm: 'The roboRIO PWM port the cable is plugged into.',
    stripCount: 'How many LEDs are on the strip.',
    defaultAuto: 'Drivers pick an auto in "Auto Chooser" on the dashboard (Elastic, Shuffleboard or SmartDashboard). This one runs if nobody picks.',
    pathPlanner: 'PathPlanner is a free app for drawing paths and building autos. With this on, autos made in PathPlanner show up in the chooser, and every subsystem action can be used in them by name.',
    ppP: 'How hard the robot steers back onto a path when it drifts off. The defaults (10 and 7) come from CTRE\'s example and work for most swerve robots.',
    named: 'Type these exact names into the named command blocks in PathPlanner. Each one runs that action.',
    resetHeading: 'Sets "forward" for field-centric driving to the way the robot faces when auto starts. Start the robot facing away from your driver station.',
    steps: 'The robot does these one after another, from the top.',
    mode: '"Until it finishes" waits for it to get there. "For a set time" runs it, then stops it. "Start it and move on" starts it and goes straight to the next step while it keeps running.',
    driveStep: 'Drives straight without turning, relative to the robot, then stops.',
    untilStep: 'Pauses until something is ready. "Give up after" keeps the auto from getting stuck if it never is.',
    pathStep: 'The path\'s name exactly as it appears in the PathPlanner app. "Start here" sets the robot\'s position to the path\'s first point. Check it on the first path of a routine.',
    pneuModule: 'The air controller your solenoids plug into: a REV Pneumatic Hub (PH) or a CTRE Pneumatics Control Module (PCM).',
    pneuCan: 'CAN ID of the PH or PCM. A new REV PH is 1 and a new CTRE PCM is 0.',
    compressor: 'A pressure switch turns the compressor off when the tanks are full. A REV PH can use an analog pressure sensor instead and stop at an exact pressure.',
    solenoid: 'A double solenoid has two channels (out and in) and stays put when the robot is disabled. A single solenoid has one channel and springs back when it turns off.',
    channels: 'The channel numbers printed next to the solenoid ports on the PH or PCM.',
    startState: 'Where the piston goes when the robot code starts.',
    liveTuning: 'Puts each mechanism\'s PID and feedforward values on the dashboard, so you can change them while the robot runs. Turn it off for competitions.',
    sysIdTools: 'Adds SysId tests to shooters, elevators and arms. Put them on buttons and run them, and the SysId tool measures kS, kV and kG for you.',
    simulation: 'Lets the code run on a laptop in WPILib\'s simulator. Elevators and arms also get a moving picture on the dashboard.',
    sysIdConvert: 'Type what the SysId tool reports. The app converts it to the units this code uses and fills in the gains above.',
    simMass: 'Only the simulator uses this, so a rough number is fine.',
    cameras: 'Each Limelight\'s name exactly as it appears on its web page, like "limelight" or "limelight-front". MegaTag2 gives steadier positions by trusting the gyro for heading. Trust is how far off (in meters) a reading might be: smaller trusts the camera more. Tags farther than the max distance are ignored.',
    spots: 'Spots in front of AprilTags where the robot can drive to line up. It picks the nearest tag from the list. "Out" is how far in front of the tag; "Left" moves the spot sideways as seen by the robot facing the tag (negative is right).',
    aimBtn: 'Hold to keep driving with the left stick while the robot turns to face the AprilTag in view.',
    combos: 'A combo runs several actions in a row from one button, like "elevator up, arm out, spit, stow".',
    zones: 'A zone is the area within some distance of a group of AprilTags, worked out from the robot\'s position on the field. Inside a zone the robot can drive slower and run an action (teleop only). To change the LEDs, press "Light up inside": it adds a status rule on the Lights page. Leave "Drive speed inside" empty to keep full speed.',
    tables: 'A distance table picks a number from how far the robot is from the nearest listed tag, like shooter RPM or arm angle. Measure a few real shots and type them in. Between two distances it blends; past the ends it uses the end values. Each table becomes an action you can put on a button, in a combo or in an auto, or run from a zone.',
    paths: 'A .path file is one path drawn in PathPlanner. Robot Code Builder reads it to draw the path, so you can click along it to add actions, and so the simulator can drive it. Your robot still loads the file from the deploy folder.',
    rumbles: 'Shakes a controller for a moment when something becomes true, like "the intake has a game piece" or "the robot is in a zone". It only works while the robot is enabled.',
    cheat: 'A picture of each controller showing what every button does. Download it and print it for drive team practice.',
  };

  /* ------------------------------------------------------------ form helpers */

  function helpButton(id) {
    const open = ui.help.has(id);
    return h('button', {
      class: 'help-btn', type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id + '-help',
      'aria-label': 'What is this?', title: 'What is this?',
      onclick: (e) => {
        const p = $(id + '-help');
        const nowOpen = p.hidden;
        p.hidden = !nowOpen;
        e.currentTarget.setAttribute('aria-expanded', String(nowOpen));
        if (nowOpen) ui.help.add(id); else ui.help.delete(id);
      },
    }, '?');
  }
  function helpPara(id, text) {
    return h('p', { class: 'help', id: id + '-help', hidden: !ui.help.has(id) }, text);
  }
  function field(id, label, control, opts) {
    const o = opts || {};
    return h('div', { class: 'field' + (o.wide ? ' wide' : '') },
      h('div', { class: 'field-label' }, h('label', { for: id }, label), o.help && helpButton(id)),
      control,
      o.hint && h('p', { class: 'hint' }, o.hint),
      o.help && helpPara(id, o.help));
  }
  function textIn(id, obj, key, opts) {
    const o = opts || {};
    return h('input', {
      id, type: 'text', value: obj[key] == null ? '' : obj[key], placeholder: o.placeholder, maxlength: o.max || 60,
      spellcheck: 'false', autocomplete: 'off', 'aria-label': o.aria,
      oninput: (e) => { obj[key] = e.target.value; changed(); },
      onchange: o.rerender ? () => changed('rerender') : null,
    });
  }
  function numIn(id, obj, key, opts) {
    const o = opts || {};
    const input = h('input', {
      id, type: 'number', inputmode: 'decimal', value: obj[key] == null ? '' : obj[key], step: o.step || 'any',
      min: o.min, max: o.max, 'aria-label': o.aria,
      oninput: (e) => {
        const raw = e.target.value;
        const n = parseFloat(raw);
        obj[key] = raw === '' ? '' : Number.isFinite(n) ? n : raw;
        if (o.after) o.after();
        changed();
      },
      onchange: o.rerender ? () => changed('rerender') : null,
    });
    return o.unit ? h('div', { class: 'with-unit' }, input, h('span', { class: 'unit', 'aria-hidden': 'true' }, o.unit)) : input;
  }
  function selectIn(id, obj, key, options, opts) {
    const o = opts || {};
    const current = obj[key] == null ? '' : String(obj[key]);
    const list = options.slice();
    if (!list.some((x) => String(x[0]) === current)) list.unshift(['', o.placeholder || 'Choose one']);
    return h('select', {
      id, value: current, 'aria-label': o.aria,
      onchange: (e) => {
        const v = e.target.value;
        obj[key] = o.number ? Number(v) : v;
        if (o.after) o.after(v);
        changed('rerender');
      },
    }, list.map((x) => h('option', { value: x[0] }, x[1])));
  }
  function checkIn(id, obj, key, label, opts) {
    const o = opts || {};
    return h('label', { class: 'check' },
      h('input', {
        id, type: 'checkbox', checked: !!obj[key],
        onchange: (e) => { obj[key] = e.target.checked; if (o.after) o.after(); changed('rerender'); },
      }),
      h('span', null, label));
  }
  function segIn(id, obj, key, options) {
    return h('div', { class: 'seg', role: 'radiogroup', id },
      options.map(([value, label], idx) => h('label', null,
        h('input', {
          type: 'radio', name: id, id: id + '-' + idx, checked: obj[key] === value,
          onchange: () => { obj[key] = value; changed('rerender'); },
        }),
        h('span', null, label))));
  }
  function sheet(title, ...content) { return h('section', { class: 'sheet' }, h('h3', null, title), content); }
  function grid(...fields) { return h('div', { class: 'grid' }, fields); }
  function note(text, warnTone) { return h('p', { class: 'note' + (warnTone ? ' warn' : '') }, text); }

  function move(list, idx, delta) {
    const to = idx + delta;
    if (to < 0 || to >= list.length) return;
    const [it] = list.splice(idx, 1);
    list.splice(to, 0, it);
  }

  /**
   * A list of rows (setpoints, speeds, followers...). `row` returns the fields for one item.
   * `card` lays each item out as a wrapping card instead of a single line.
   */
  function listBlock(o) {
    const items = o.items;
    const btnW = o.reorder ? 118 : 34;
    const rows = items.map((it, idx) => {
      const fields = o.row(it, idx);
      const btns = h('div', { class: 'row-btns' },
        o.reorder && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: idx === 0, onclick: () => { move(items, idx, -1); changed('rerender'); } }, '↑'),
        o.reorder && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: idx === items.length - 1, onclick: () => { move(items, idx, 1); changed('rerender'); } }, '↓'),
        h('button', {
          class: 'icon-btn remove', type: 'button', 'aria-label': 'Remove ' + (o.noun || 'row'), title: 'Remove',
          onclick: () => { items.splice(idx, 1); if (o.onRemove) o.onRemove(it); changed('rerender'); },
        }, '×'));
      if (o.card) return h('div', { class: 'card-row' }, h('div', { class: 'card-fields' }, fields), btns);
      return h('div', { class: 'row' }, h('div', { class: 'row-fields', style: `--cols: ${o.cols}` }, fields), btns);
    });
    return h('div', { class: 'list-block' },
      (o.title || o.help) && h('div', { class: 'list-title' }, o.title && h('h4', null, o.title), o.help && helpButton(o.id)),
      o.help && helpPara(o.id, o.help),
      items.length && o.head && !o.card
        ? h('div', { class: 'row head-row', 'aria-hidden': 'true' }, h('div', { class: 'row-fields row-head', style: `--cols: ${o.cols}` }, o.head.map((x) => h('span', null, x))), h('span', { style: `width: ${btnW}px` }))
        : null,
      items.length ? h('div', { class: 'rows' }, rows) : h('p', { class: 'empty' }, o.empty),
      o.add && h('button', {
        class: 'btn add small', type: 'button', id: o.id + '-add', disabled: o.addDisabled,
        onclick: () => { o.add(); changed('rerender'); },
      }, '+ ' + o.addLabel));
  }
  function mini(id, label, control) {
    return h('div', { class: 'mini' }, h('label', { for: id }, label), control);
  }

  /* ------------------------------------------------------------ rail (parts list) */

  function issuesFor(id) {
    const list = ((ui.model && ui.model.issues) || []).filter((x) => x.target && x.target.id === id);
    if (list.some((x) => x.level === 'error')) return 'error';
    if (list.some((x) => x.level === 'warn')) return 'warn';
    return null;
  }
  function tag(bus, id) {
    return h('span', { class: 'tag ' + bus }, h('span', { class: 'bus' }, bus.toUpperCase()), String(id));
  }
  function railItem(sel, name, sub, extra, dotLevel) {
    const current = ui.sel.kind === sel.kind && (ui.sel.id || null) === (sel.id || null);
    return h('button', { class: 'rail-item', type: 'button', 'aria-current': current ? 'true' : 'false', onclick: () => select(sel) },
      h('span', { class: 'ri-name' }, dotLevel && h('span', { class: 'dot ' + dotLevel, title: dotLevel === 'error' ? 'Has a problem' : 'Has a warning' }), name),
      extra || h('span'),
      sub && h('span', { class: 'ri-sub' }, sub));
  }
  function railGroup(title, addSel, addLabel, items, empty) {
    return h('div', { class: 'rail-group' },
      h('div', { class: 'rail-head' }, h('h2', null, title),
        addSel && h('button', {
          class: 'rail-add', type: 'button', 'aria-label': addLabel, title: addLabel,
          onclick: () => (typeof addSel === 'function' ? addSel() : select(addSel)),
        }, '+')),
      items.length ? items : h('p', { class: 'rail-empty' }, empty));
  }
  function renderRail() {
    const p = robot.project;
    const lightTag = (l) => (l.type === 'candle' ? tag('can', l.canId) : tag('pwm', l.pwmPort));
    const ctlIssue = ((ui.model && ui.model.issues) || []).some((x) => x.target && x.target.kind === 'controls' && x.level !== 'info');
    const autosIssue = ((ui.model && ui.model.issues) || []).some((x) => x.target && x.target.kind === 'autos' && x.level !== 'info') ? 'warn' : null;
    const visionIssue = ((ui.model && ui.model.issues) || []).some((x) => x.target && x.target.kind === 'vision' && x.level !== 'info') ? 'warn' : null;
    const subLine = (s) => (s.preset === 'piston'
      ? 'Pneumatic · ' + (s.solenoid === 'single' ? 'single solenoid' : 'double solenoid')
      : G.PRESETS[s.preset].label + ' · ' + (G.MOTORS[s.motor] || G.MOTORS.krakenX60).label);
    const subTag = (s) => (s.preset === 'piston'
      ? tag('sol', s.solenoid === 'single' ? s.channel : s.forwardChannel + '/' + s.reverseChannel)
      : tag('can', s.canId));
    const V = robot.vision;
    $('rail').replaceChildren(
      railGroup('Robot', null, null, [
        railItem({ kind: 'robot' }, 'Robot settings', p.tunerSwerve ? 'Tuner X swerve' : 'No swerve code'),
        railItem({ kind: 'wiring' }, 'Wiring sheet', 'Every CAN ID and port'),
        railItem({ kind: 'simulator' }, 'Simulator', 'Drive it right here'),
      ]),
      railGroup('Subsystems', { kind: 'add-subsystem' }, 'Add a subsystem', robot.subsystems.map((s) => railItem(
        { kind: 'subsystem', id: s.id }, s.name || 'Unnamed', subLine(s), subTag(s), issuesFor(s.id))), 'Nothing yet. Press + to add one.'),
      railGroup('Controls', null, null, [
        railItem({ kind: 'controllers' }, 'Controllers and driving', plural(robot.controllers.length, 'controller'), null, ctlIssue ? 'warn' : null),
        railItem({ kind: 'bindings' }, 'Buttons', plural(robot.bindings.length, 'button binding')),
        railItem({ kind: 'cheatsheet' }, 'Driver cheat sheet', 'What every button does'),
      ]),
      railGroup('Combos', addCombo, 'Add a combo', robot.combos.map((cb) => railItem(
        { kind: 'combo', id: cb.id }, cb.name || 'Unnamed', plural(cb.steps.length, 'step'), null, issuesFor(cb.id))),
      'One button, several actions. Press + to add one.'),
      railGroup('Autonomous', addRoutine, 'Add an auto routine', [
        railItem({ kind: 'autos' }, 'Auto settings', p.tunerSwerve && robot.autos.pathPlanner !== false ? 'Chooser · PathPlanner on' : 'Chooser and default auto', null, autosIssue),
        railItem({ kind: 'paths' }, 'Paths', robot.paths.length || robot.ppAutos.length
          ? [robot.paths.length && plural(robot.paths.length, 'path'), robot.ppAutos.length && plural(robot.ppAutos.length, 'PathPlanner auto')].filter(Boolean).join(' · ')
          : 'Draw or import paths'),
      ].concat(robot.autos.routines.map((rt) => railItem(
        { kind: 'routine', id: rt.id }, rt.name || 'Unnamed',
        plural(rt.steps.length, 'step') + (robot.autos.defaultAuto === rt.id ? ' · default' : ''), null, issuesFor(rt.id)))), ''),
      railGroup('Vision', null, null, [
        railItem({ kind: 'vision' }, 'AprilTags',
          V.cameras.length ? [plural(V.cameras.length, 'Limelight'), V.spots.length && plural(V.spots.length, 'spot'),
            V.zones.length && plural(V.zones.length, 'zone'), V.tables.length && plural(V.tables.length, 'table')].filter(Boolean).join(' · ') : 'No cameras yet', null, visionIssue),
      ]),
      railGroup('Lights', { kind: 'add-light' }, 'Add lights', robot.lights.map((l) => railItem(
        { kind: 'light', id: l.id }, l.name || 'Unnamed', G.LIGHT_TYPES[l.type].label, lightTag(l), issuesFor(l.id))), 'No lights. Press + to add some.'));
  }

  function renderTop() {
    const p = robot.project;
    const team = String(p.teamNumber || '').trim();
    $('robot-id').textContent = (p.robotName || 'Unnamed robot') + (team ? ' · Team ' + team : '');
    const banner = $('banner');
    if (robot.example) {
      banner.replaceChildren(h('div', { class: 'banner' },
        h('span', null, h('strong', null, 'This is an example robot. '), 'Click through the parts on the left, change anything, and watch the code update.'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn small primary', type: 'button', onclick: startNewRobot }, 'Start my own robot'),
          h('button', { class: 'btn small ghost', type: 'button', onclick: () => { robot.example = false; save(); renderTop(); } }, 'Keep the example'))));
    } else banner.replaceChildren();
  }

  /* ------------------------------------------------------------ selection + updates */

  function fileFor(sel) {
    if (sel.kind === 'subsystem' || sel.kind === 'light') {
      const f = ui.files.find((x) => x.owner === sel.id);
      return f ? f.name : null;
    }
    if (sel.kind === 'controllers' || sel.kind === 'bindings') return 'RobotContainer.java';
    if (sel.kind === 'autos' || sel.kind === 'routine' || sel.kind === 'paths') return 'Autos.java';
    if (sel.kind === 'path') {
      const p = robot.paths.find((x) => x.id === sel.id);
      return p && p.fromApp ? p.name + '.path' : 'Autos.java';
    }
    if (sel.kind === 'vision') return 'Vision.java';
    if (sel.kind === 'combo') return 'Combos.java';
    if (sel.kind === 'cheatsheet') return 'RobotContainer.java';
    if (sel.kind === 'robot') return 'Constants.java';
    if (sel.kind === 'wiring') return 'README.txt';
    return null;
  }
  function select(sel) {
    ui.sel = { kind: sel.kind, id: sel.id };
    ui.confirmDelete = null;
    ui.confirmReset = false;
    const f = fileFor(ui.sel);
    if (f) ui.file = f;
    renderRail();
    renderEditor(true);
    renderOutput();
    saveUi();
    // On a phone the form sits below the parts list, so bring it into view.
    if (window.matchMedia('(max-width: 760px)').matches) {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('editor').scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    }
  }

  let regenTimer = null;
  let saveTimer = null;
  function changed(mode) {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(regen, 140);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
    renderTop();
    renderRail();
    if (mode === 'rerender') renderEditor();
  }
  function regen() {
    clearTimeout(regenTimer);
    try {
      const out = G.generate(robot);
      ui.files = out.files;
      ui.model = out.model;
      ui.error = null;
    } catch (err) {
      ui.error = err;
      console.error(err);
    }
    renderOutput();
    renderRail();
  }
  function save() {
    clearTimeout(saveTimer);
    writeStore(KEY_ROBOT, robot);
  }
  function saveUi() { writeStore(KEY_UI, { sel: ui.sel, file: ui.file }); }

  function renderEditor(resetScroll) {
    const ed = $('editor');
    if (ui.sim) { ui.sim.destroy(); ui.sim = null; }
    ui.pathObservers.forEach((o) => o.disconnect());
    ui.pathObservers = [];
    document.body.classList.toggle('sim-mode', ui.sel.kind === 'simulator' || ui.sel.kind === 'path');
    const activeEl = document.activeElement;
    const activeId = activeEl && ed.contains(activeEl) ? activeEl.id : null;
    const top = ed.scrollTop;
    const winY = window.scrollY;
    ed.replaceChildren(...[].concat(buildEditor()).flat(Infinity).filter(Boolean));
    if (resetScroll) ed.scrollTop = 0;
    else { ed.scrollTop = top; window.scrollTo(window.scrollX, winY); }
    if (activeId) { const el = $(activeId); if (el) el.focus({ preventScroll: true }); }
  }

  function buildEditor() {
    const s = ui.sel;
    if (s.kind === 'subsystem') {
      const sub = robot.subsystems.find((x) => x.id === s.id);
      if (sub) return subsystemEditor(sub);
    }
    if (s.kind === 'light') {
      const l = robot.lights.find((x) => x.id === s.id);
      if (l) return lightEditor(l);
    }
    if (s.kind === 'routine') {
      const rt = robot.autos.routines.find((x) => x.id === s.id);
      if (rt) return routineEditor(rt);
    }
    if (s.kind === 'combo') {
      const cb = robot.combos.find((x) => x.id === s.id);
      if (cb) return comboEditor(cb);
    }
    switch (s.kind) {
      case 'simulator': return simulatorView();
      case 'paths': return pathsEditor();
      case 'path': {
        const p = robot.paths.find((x) => x.id === s.id);
        return p ? pathEditorPage(p) : pathsEditor();
      }
      case 'autos': return autosEditor();
      case 'vision': return visionEditor();
      case 'cheatsheet': return cheatSheetEditor();
      case 'wiring': return wiringEditor();
      case 'controllers': return controllersEditor();
      case 'bindings': return bindingsEditor();
      case 'add-subsystem': return addSubsystemEditor();
      case 'add-light': return addLightEditor();
      default: return robotEditor();
    }
  }

  /** The simulator page. It mounts after the page is on screen and stops when you leave it. */
  function simulatorView() {
    const box = h('div', { class: 'sim-host' });
    queueMicrotask(() => {
      if (!box.isConnected || ui.sel.kind !== 'simulator') return;
      if (!window.RobotSim) { box.replaceChildren(note('The simulator did not load. Try reloading the page.', true)); return; }
      try {
        ui.sim = window.RobotSim.mount(box, robot, { autoId: ui.simAuto, start: !!ui.simAuto });
        ui.simAuto = null;
      } catch (err) {
        console.error(err);
        box.replaceChildren(note('The simulator hit a problem: ' + (err && err.message ? err.message : err), true));
      }
    });
    return box;
  }

  function head(kicker, title, blurb) {
    return h('div', { class: 'ed-head' }, h('div', { class: 'ed-kicker' }, kicker), h('h2', { class: 'ed-title' }, title), blurb && h('p', { class: 'ed-blurb' }, blurb));
  }
  function itemHead(kicker, obj, blurb, onDelete, what) {
    const id = 'name-' + obj.id;
    const confirming = ui.confirmDelete === obj.id;
    return h('div', { class: 'ed-head' },
      h('div', { class: 'ed-kicker' }, kicker),
      h('div', { class: 'ed-title-row' },
        h('label', { for: id, class: 'sr-only' }, 'Name'),
        h('input', {
          id, class: 'name-input', type: 'text', value: obj.name, maxlength: 40, spellcheck: 'false', autocomplete: 'off',
          oninput: (e) => { obj.name = e.target.value; changed(); },
        }),
        confirming
          ? h('div', { class: 'confirm-row' }, `Delete ${obj.name || 'this ' + what}?`,
            h('button', { class: 'btn danger small', type: 'button', id: id + '-del-yes', onclick: onDelete }, 'Delete'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { ui.confirmDelete = null; renderEditor(); } }, 'Cancel'))
          : h('button', { class: 'btn ghost small', type: 'button', id: id + '-del', onclick: () => { ui.confirmDelete = obj.id; renderEditor(); const b = $(id + '-del-yes'); if (b) b.focus(); } }, 'Delete')),
      h('p', { class: 'ed-blurb' }, blurb));
  }

  /* ------------------------------------------------------------ robot settings */

  function robotEditor() {
    const p = robot.project;
    return [
      head('Robot', 'Robot settings', 'The basics that every part of the code shares.'),
      sheet('About',
        grid(
          field('p-name', 'Robot name', textIn('p-name', p, 'robotName', { placeholder: 'Our 2027 robot' })),
          field('p-team', 'Team number', textIn('p-team', p, 'teamNumber', { placeholder: '1234', max: 6 }), { help: H.team }))),
      sheet('Drivetrain',
        field('p-swerve', 'Swerve drive', checkIn('p-swerve', p, 'tunerSwerve', 'My swerve code comes from Phoenix Tuner X'), { help: H.swerve, wide: true }),
        p.tunerSwerve && grid(
          field('p-sids', 'Swerve CAN IDs', textIn('p-sids', p, 'swerveIds', { placeholder: '1-12, 13' }), { help: H.swerveIds }),
          field('p-sbus', 'Swerve CAN bus', textIn('p-sbus', p, 'swerveBus', { placeholder: 'rio' }), { help: H.swerveBus })),
        p.tunerSwerve && note('Driving buttons and speeds are under Controls → Controllers and driving.')),
      sheet('CTRE devices',
        grid(
          field('p-bus', 'CAN bus for mechanisms', textIn('p-bus', p, 'ctreBus', { placeholder: 'rio' }), { help: H.ctreBus }),
          field('p-pro', 'Phoenix Pro', checkIn('p-pro', p, 'phoenixPro', 'These motors are Pro licensed'), { help: H.pro }))),
      sheet('Pneumatics',
        robot.subsystems.some((s) => s.preset === 'piston')
          ? grid(
            field('p-pm', 'Air controller', selectIn('p-pm', p, 'pneumaticsModule', [['revph', 'REV Pneumatic Hub'], ['ctrepcm', 'CTRE Pneumatics Control Module']], {
              after: (v) => { if (v === 'ctrepcm') p.compressor = 'digital'; },
            }), { help: H.pneuModule }),
            field('p-pcan', 'CAN ID', numIn('p-pcan', p, 'pneumaticsCanId', { step: 1, min: 0, max: 62 }), { help: H.pneuCan }),
            p.pneumaticsModule !== 'ctrepcm' && field('p-comp', 'Compressor stops by', selectIn('p-comp', p, 'compressor', [['digital', 'Pressure switch'], ['analog', 'Analog pressure sensor']]), { help: H.compressor }),
            p.pneumaticsModule !== 'ctrepcm' && p.compressor === 'analog' && field('p-pmin', 'Turn on below', numIn('p-pmin', p, 'minPsi', { unit: 'psi', step: 5, min: 0, max: 120 })),
            p.pneumaticsModule !== 'ctrepcm' && p.compressor === 'analog' && field('p-pmax', 'Turn off above', numIn('p-pmax', p, 'maxPsi', { unit: 'psi', step: 5, min: 0, max: 120 })))
          : note('Add a Pneumatic subsystem to set up the air controller and compressor.')),
      sheet('Testing tools',
        field('p-tune', 'Live tuning', checkIn('p-tune', p, 'liveTuning', 'Change PID values from the dashboard'), { help: H.liveTuning, wide: true }),
        field('p-sysid', 'SysId', checkIn('p-sysid', p, 'sysId', 'Add SysId tests to shooters, elevators and arms'), { help: H.sysIdTools, wide: true }),
        field('p-sim', 'Simulation', checkIn('p-sim', p, 'simulation', 'Run the code in WPILib\'s simulator'), { help: H.simulation, wide: true })),
      sheet('Start over',
        ui.confirmReset
          ? h('div', { class: 'confirm-row' }, ui.confirmReset === 'example' ? 'Replace this robot with the example?' : 'Replace this robot with a blank one?',
            h('button', { class: 'btn danger small', type: 'button', onclick: () => (ui.confirmReset === 'example' ? loadExample() : startNewRobot()) }, 'Replace it'),
            h('button', { class: 'btn small', type: 'button', onclick: saveRobotFile }, 'Save it first'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: () => { ui.confirmReset = false; renderEditor(); } }, 'Cancel'))
          : h('div', { class: 'confirm-row' },
            h('button', { class: 'btn small', type: 'button', onclick: () => { ui.confirmReset = 'new'; renderEditor(); } }, 'Start a blank robot'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { ui.confirmReset = 'example'; renderEditor(); } }, 'Load the example robot')),
        note(`Code is written for ${G.LIBS_TEXT}, command-based Java.`)),
    ];
  }

  /* ------------------------------------------------------------ subsystems */

  function ensureGains(s) {
    if (!s.gains) s.gains = {};
    ['ctre', 'rev'].forEach((v) => { s.gains[v] = Object.assign({}, G.defaultGains(s.preset, v), s.gains[v] || {}); });
  }

  function motorSheet(s) {
    const ctrl = G.controllerOf(s);
    const talon = ctrl === 'talonfx';
    const id = (k) => `s-${s.id}-${k}`;
    const onMotor = () => {
      G.applyMotorDefaults(s);
      ensureGains(s);
      if (s.preset === 'arm' && s.encoder === 'throughboreSpark' && G.controllerOf(s) === 'talonfx') s.encoder = 'throughboreDio';
    };
    return sheet('Motor',
      grid(
        field(id('motor'), 'Motor', selectIn(id('motor'), s, 'motor', Object.keys(G.MOTORS).map((k) => [k, G.MOTORS[k].label]), { after: onMotor }),
          { help: H.motor, hint: 'Controller: ' + G.CONTROLLERS[ctrl].label }),
        s.motor === 'neoVortex' && field(id('vtx'), 'Motor controller', selectIn(id('vtx'), s, 'vortexController', [['sparkflex', 'SPARK Flex'], ['sparkmax', 'SPARK MAX + Solo Adapter']]), { help: H.vortex }),
        field(id('can'), 'CAN ID', numIn(id('can'), s, 'canId', { step: 1, min: 0, max: 62 }), { help: H.canId }),
        field(id('idle'), 'When stopped', segIn(id('idle'), s, 'brake', [[true, 'Brake'], [false, 'Coast']]), { help: H.idle }),
        field(id('inv'), 'Direction', checkIn(id('inv'), s, 'inverted', 'Inverted'), { help: H.inverted }),
        talon && field(id('stator'), 'Stator current limit', numIn(id('stator'), s, 'statorLimit', { unit: 'A', step: 1, min: 1 }), { help: H.stator }),
        talon && field(id('supply'), 'Supply current limit', numIn(id('supply'), s, 'supplyLimit', { unit: 'A', step: 1, min: 1 }), { help: H.supply }),
        !talon && field(id('cur'), 'Current limit', numIn(id('cur'), s, 'currentLimit', { unit: 'A', step: 1, min: 1 }), { help: H.smart })),
      listBlock({
        id: id('fol'), title: 'Follower motors', help: H.followers, items: s.followers, noun: 'follower',
        cols: 'minmax(0, 150px) minmax(0, 1fr)', head: ['CAN ID', ''],
        empty: 'None. Add one if a second motor drives the same mechanism.',
        row: (f) => [
          numIn(`f-${f.id}-can`, f, 'canId', { step: 1, min: 0, max: 62, aria: 'Follower CAN ID' }),
          checkIn(`f-${f.id}-opp`, f, 'opposite', 'Spins opposite'),
        ],
        add: () => s.followers.push({ id: G.uid('f'), canId: nextCanId(), opposite: false }),
        addLabel: 'Add follower',
      }));
  }

  function gainsSheet(s) {
    ensureGains(s);
    const vendor = G.CONTROLLERS[G.controllerOf(s)].vendor;
    const g = s.gains[vendor];
    const ctre = vendor === 'ctre';
    const units = {
      flywheel: ctre ? { kP: 'V per rot/s of error', kI: 'V per rot', kD: 'V per rot/s²', kS: 'volts', kV: 'V per rot/s' }
        : { kP: 'output per RPM of error', kI: 'output per RPM·s', kD: 'output per RPM/s', kS: 'volts', kV: 'V per RPM' },
      elevator: ctre ? { kP: 'V per inch of error', kI: 'V per in·s', kD: 'V per in/s', kS: 'volts', kV: 'V per in/s', kG: 'volts' }
        : { kP: 'output per inch of error', kI: 'output per in·s', kD: 'output per in/s', kS: 'volts', kV: 'V per in/s', kG: 'volts' },
      arm: ctre ? { kP: 'V per arm turn of error', kI: 'V per turn·s', kD: 'V per turn/s', kS: 'volts', kV: 'V per turn/s', kG: 'volts at level' }
        : { kP: 'output per degree of error', kI: 'output per deg·s', kD: 'output per deg/s', kS: 'volts', kV: 'V per deg/s', kG: 'volts at level' },
    }[s.preset];
    const keys = Object.keys(units);
    const est = G.estimateKV(s, vendor);
    const estG = s.preset === 'flywheel' ? null : G.estimateKG(s);
    return sheet('Tuning',
      h('div', { class: 'list-title' }, h('h4', null, ctre ? 'Talon FX gains' : 'SPARK gains'), helpButton(`g-${s.id}`)),
      helpPara(`g-${s.id}`, H.gains),
      grid(...keys.map((k) => field(`g-${s.id}-${vendor}-${k}`, k, numIn(`g-${s.id}-${vendor}-${k}`, g, k, { step: 'any' }), { hint: units[k] }))),
      h('div', { class: 'estimate' },
        h('span', null, 'kV estimate for this motor and gearing: ', h('b', null, String(est))),
        h('button', { class: 'btn small', type: 'button', disabled: Number(g.kV) === est, onclick: () => { g.kV = est; changed('rerender'); } }, 'Use it')),
      estG != null && h('div', { class: 'estimate' },
        h('span', null, 'kG estimate from the motor, gearing and the weight under Simulation: ', h('b', null, String(estG))),
        h('button', { class: 'btn small', type: 'button', disabled: Number(g.kG) === estG, onclick: () => { g.kG = estG; changed('rerender'); } }, 'Use it')),
      robot.project.sysId && sysIdConverter(s, g, vendor),
      note('These are starting values. Put the robot on blocks and tune slowly.'));
  }

  /** Turns SysId results (meters or rotations) into the units this subsystem's gains use. */
  function sysIdConverter(s, g, vendor) {
    const vals = ui.sysIdInput[s.id] || (ui.sysIdInput[s.id] = { kS: '', kV: '', kG: '' });
    let factor = 1;
    if (s.preset === 'elevator') factor = 0.0254;
    else if (s.preset === 'arm' && vendor === 'rev') factor = 1 / 360;
    else if (s.preset === 'flywheel' && vendor === 'rev') factor = 1 / 60;
    const keys = s.preset === 'flywheel' ? ['kS', 'kV'] : ['kS', 'kV', 'kG'];
    const kvUnits = s.preset === 'elevator' ? 'V per m/s (SysId)' : 'V per rot/s (SysId)';
    const id = (k) => `sid-${s.id}-${k}`;
    return h('div', { class: 'list-block' },
      h('div', { class: 'list-title' }, h('h4', null, 'Use SysId results'), helpButton(`sid-${s.id}`)),
      helpPara(`sid-${s.id}`, H.sysIdConvert),
      grid(...keys.map((k) => field(id(k), k + ' from SysId', h('input', {
        id: id(k), type: 'number', inputmode: 'decimal', step: 'any', value: vals[k],
        oninput: (e) => { vals[k] = e.target.value; },
      }), { hint: k === 'kV' ? kvUnits : 'volts' }))),
      h('button', {
        class: 'btn small', type: 'button',
        onclick: () => {
          let n = 0;
          keys.forEach((k) => {
            const v = parseFloat(vals[k]);
            if (Number.isFinite(v)) { g[k] = +(k === 'kV' ? v * factor : v).toPrecision(5); n++; }
          });
          toast(n ? `Filled in ${plural(n, 'gain')} from SysId.` : 'Type at least one SysId number first.');
          changed('rerender');
        },
      }, 'Fill in the gains'));
  }

  function pistonSheet(s) {
    const id = (k) => `s-${s.id}-${k}`;
    const dbl = s.solenoid !== 'single';
    const pcm = robot.project.pneumaticsModule === 'ctrepcm';
    const mod = pcm ? 'PCM' : 'PH';
    const max = pcm ? 7 : 15;
    return [
      sheet('Solenoid',
        grid(
          field(id('sol'), 'Solenoid', selectIn(id('sol'), s, 'solenoid', [['double', 'Double (2 channels)'], ['single', 'Single (1 channel)']]), { help: H.solenoid }),
          dbl && field(id('fwd'), `Out channel (${mod})`, numIn(id('fwd'), s, 'forwardChannel', { step: 1, min: 0, max }), { help: H.channels }),
          dbl && field(id('rev'), `In channel (${mod})`, numIn(id('rev'), s, 'reverseChannel', { step: 1, min: 0, max })),
          !dbl && field(id('ch'), `Channel (${mod})`, numIn(id('ch'), s, 'channel', { step: 1, min: 0, max }), { help: H.channels }),
          field(id('start'), 'At startup', selectIn(id('start'), s, 'startState', [['retracted', 'Pulled in'], ['extended', 'Pushed out']]), { help: H.startState })),
        note('The air controller and compressor are set up in Robot settings.')),
      sheet('Action names',
        grid(
          field(id('ext'), 'Pushing out is called', textIn(id('ext'), s, 'extendName', { placeholder: 'Extend', max: 30 })),
          field(id('ret'), 'Pulling in is called', textIn(id('ret'), s, 'retractName', { placeholder: 'Retract', max: 30 }))),
        note('Each one, plus Toggle, becomes an action for buttons, combos and autos.')),
    ];
  }

  function simSheet(s) {
    const id = (k) => `s-${s.id}-${k}`;
    if (s.preset === 'flywheel') {
      return sheet('Simulation', grid(
        field(id('swm'), 'Flywheel weight', numIn(id('swm'), s, 'simWheelMassLbs', { unit: 'lb', step: 0.1, min: 0.1 }), { help: H.simMass }),
        field(id('swd'), 'Flywheel diameter', numIn(id('swd'), s, 'simWheelDiameter', { unit: 'in', step: 0.5, min: 0.5 }))));
    }
    if (s.preset === 'elevator') {
      return sheet('Simulation', grid(
        field(id('sm'), 'Weight it lifts', numIn(id('sm'), s, 'simMassLbs', { unit: 'lb', step: 1, min: 0.5 }), { help: H.simMass })));
    }
    const absolute = s.encoder && s.encoder !== 'builtin';
    return sheet('Simulation', grid(
      field(id('sl'), 'Arm length', numIn(id('sl'), s, 'simLength', { unit: 'in', step: 1, min: 1 }), { help: H.simMass }),
      field(id('sm'), 'Arm weight', numIn(id('sm'), s, 'simMassLbs', { unit: 'lb', step: 0.5, min: 0.1 })),
      absolute && field(id('ss'), 'Starting angle in the simulator', numIn(id('ss'), s, 'startAngle', { unit: '°', step: 1 }))));
  }

  function subsystemEditor(s) {
    const preset = G.PRESETS[s.preset];
    const blurbs = {
      roller: 'Spins at set speeds. Each action becomes a command for a button.',
      flywheel: 'Spins up to a set speed and holds it with closed-loop control.',
      elevator: 'Moves to set heights in inches and holds them against gravity.',
      arm: 'Moves to set angles and holds them against gravity. 0° is level, 90° is straight up.',
      climber: 'Drives up and down at set speeds while a button is held.',
      piston: 'An air piston that pushes out and pulls in. Each position becomes an action for a button.',
    };
    const parts = [itemHead(preset.label, s, blurbs[s.preset], () => deleteSubsystem(s), 'subsystem'),
      s.preset === 'piston' ? pistonSheet(s) : motorSheet(s)];
    const id = (k) => `s-${s.id}-${k}`;

    if (s.preset === 'roller') {
      const hasSensor = s.sensor && s.sensor.type !== 'none';
      parts.push(sheet('What it does', listBlock({
        id: id('act'), title: 'Actions', help: H.actions, items: s.actions, noun: 'action',
        cols: hasSensor ? 'minmax(0, 1fr) 120px minmax(0, 150px)' : 'minmax(0, 1fr) 120px',
        head: hasSensor ? ['Name', 'Speed', ''] : ['Name', 'Speed'],
        empty: 'No actions yet.',
        row: (a) => [
          textIn(`a-${a.id}-name`, a, 'name', { aria: 'Action name', max: 40 }),
          numIn(`a-${a.id}-spd`, a, 'speed', { unit: '%', min: -100, max: 100, step: 5, aria: 'Speed in percent' }),
          hasSensor && checkIn(`a-${a.id}-stop`, a, 'stopOnPiece', 'Stop when loaded'),
        ],
        add: () => s.actions.push(G.newAction('New Action', 50, false)),
        addLabel: 'Add action',
      })));
      parts.push(sheet('Game piece sensor',
        grid(
          field(id('sen'), 'Sensor', selectIn(id('sen'), s.sensor, 'type', [['none', 'None'], ['dio', 'Beam break or switch on a roboRIO DIO port'], ['canrange', 'CTRE CANrange']], {
            after: (v) => { if (v === 'canrange' && !s.sensor.canId) s.sensor.canId = nextCanId(); },
          }), { help: H.sensor }),
          s.sensor.type === 'dio' && field(id('dio'), 'DIO port', numIn(id('dio'), s.sensor, 'dio', { step: 1, min: 0, max: 9 })),
          s.sensor.type === 'dio' && field(id('low'), 'Reading', checkIn(id('low'), s.sensor, 'activeLow', 'Reads false when it sees a game piece'), { help: H.activeLow }),
          s.sensor.type === 'canrange' && field(id('rid'), 'CANrange CAN ID', numIn(id('rid'), s.sensor, 'canId', { step: 1, min: 0, max: 62 })),
          s.sensor.type === 'canrange' && field(id('rdist'), 'Detect distance', numIn(id('rdist'), s.sensor, 'distance', { unit: 'm', step: 0.01, min: 0.01 }), { help: H.distance }))));
    }

    if (s.preset === 'flywheel') {
      parts.push(sheet('Flywheel',
        grid(
          field(id('gr'), 'Gear ratio', numIn(id('gr'), s, 'gearRatio', { unit: ': 1', step: 'any', min: 0.01, after: () => {} }), { help: H.gearFly }),
          field(id('tol'), 'At-speed tolerance', numIn(id('tol'), s, 'toleranceRpm', { unit: 'RPM', step: 10, min: 1 }), { help: H.tolRpm })),
        listBlock({
          id: id('spd'), title: 'Speeds', help: H.speeds, items: s.speeds, noun: 'speed',
          cols: 'minmax(0, 1fr) 150px', head: ['Name', 'Speed'], empty: 'No speeds yet.',
          row: (sp) => [
            textIn(`r-${sp.id}-name`, sp, 'name', { aria: 'Speed name', max: 40 }),
            numIn(`r-${sp.id}-rpm`, sp, 'rpm', { unit: 'RPM', step: 50, aria: 'Speed in RPM' }),
          ],
          add: () => s.speeds.push(G.newSpeed('New Speed', 3000)),
          addLabel: 'Add speed',
        })));
      parts.push(gainsSheet(s));
    }

    if (s.preset === 'elevator') {
      parts.push(sheet('Gearing',
        grid(
          field(id('gr'), 'Gear ratio', numIn(id('gr'), s, 'gearRatio', { unit: ': 1', min: 0.01 }), { help: H.gearElev }),
          field(id('dia'), 'Sprocket or drum diameter', numIn(id('dia'), s, 'drumDiameter', { unit: 'in', step: 0.001, min: 0.1 }), { help: H.sprocket }),
          field(id('mul'), 'Rigging', selectIn(id('mul'), s, 'travelMultiplier', [['1', 'Single stage or continuous (×1)'], ['2', '2-stage cascade (×2)'], ['3', '3-stage cascade (×3)']], { number: true }), { help: H.travel }))));
      parts.push(sheet('Heights',
        grid(
          field(id('max'), 'Highest point', numIn(id('max'), s, 'maxPos', { unit: 'in', step: 0.5, min: 1 }), { help: H.maxHeight }),
          field(id('tol'), 'Tolerance', numIn(id('tol'), s, 'tolerance', { unit: 'in', step: 0.1, min: 0.05 }), { help: H.tolerance })),
        setpointList(s, 'in', H.setpointsElev)));
      parts.push(motionSheet(s, 'in/s', 'in/s²', 'in'));
      parts.push(sheet('Bottom limit switch',
        field(id('lim'), 'Limit switch', checkIn(id('lim'), s.limitSwitch, 'enabled', 'There is a switch at the bottom'), { help: H.limit, wide: true }),
        s.limitSwitch.enabled && grid(
          field(id('limdio'), 'DIO port', numIn(id('limdio'), s.limitSwitch, 'dio', { step: 1, min: 0, max: 9 })),
          field(id('limno'), 'Wiring', checkIn(id('limno'), s.limitSwitch, 'normallyOpen', 'Normally open'), { help: H.normallyOpen }))));
      parts.push(gainsSheet(s));
    }

    if (s.preset === 'arm') {
      const rev = G.CONTROLLERS[G.controllerOf(s)].vendor === 'rev';
      const encOptions = [['builtin', "The motor's built-in encoder"]];
      if (rev) encOptions.push(['throughboreSpark', "REV Through Bore on the SPARK's data port"]);
      encOptions.push(['throughboreDio', 'REV Through Bore on a roboRIO DIO port'], ['cancoder', 'CTRE CANcoder']);
      const abs = s.encoder && s.encoder !== 'builtin';
      parts.push(sheet('Gearing',
        grid(field(id('gr'), 'Gear ratio', numIn(id('gr'), s, 'gearRatio', { unit: ': 1', min: 0.01 }), { help: H.gear }))));
      parts.push(sheet('Encoder',
        field(id('enc'), 'Angle sensor', selectIn(id('enc'), s, 'encoder', encOptions, {
          after: (v) => { if (v === 'cancoder' && !s.cancoderId) s.cancoderId = nextCanId(); if (v === 'throughboreDio') s.encoderDio = s.encoderDio == null ? nextPort('dio') : s.encoderDio; },
        }), { help: H.encoder, wide: true }),
        grid(
          !abs && field(id('start'), 'Starting angle', numIn(id('start'), s, 'startAngle', { unit: '°', step: 1 }), { help: H.startAngle }),
          s.encoder === 'throughboreDio' && field(id('edio'), 'DIO port', numIn(id('edio'), s, 'encoderDio', { step: 1, min: 0, max: 9 })),
          s.encoder === 'cancoder' && field(id('ccid'), 'CANcoder CAN ID', numIn(id('ccid'), s, 'cancoderId', { step: 1, min: 0, max: 62 })),
          abs && field(id('off'), 'Offset (raw reading when level)', numIn(id('off'), s, 'encoderOffset', { step: 0.001, min: 0, max: 1 }), { help: H.offset.replace('NAME', G.pascal(s.name) ? s.name : 'Arm') }),
          abs && field(id('einv'), 'Encoder direction', checkIn(id('einv'), s, 'encoderInverted', 'Reads backwards'), { help: H.encInv })),
        abs && s.encoder === 'throughboreSpark' && note('Plug the Through Bore into the SPARK data port. A SPARK MAX needs the REV Absolute Encoder Adapter.')));
      parts.push(sheet('Angles',
        grid(
          field(id('min'), 'Lowest angle', numIn(id('min'), s, 'minPos', { unit: '°', step: 1 }), { help: H.angles }),
          field(id('max'), 'Highest angle', numIn(id('max'), s, 'maxPos', { unit: '°', step: 1 })),
          field(id('tol'), 'Tolerance', numIn(id('tol'), s, 'tolerance', { unit: '°', step: 0.5, min: 0.1 }), { help: H.tolerance })),
        setpointList(s, '°', H.setpointsArm)));
      parts.push(motionSheet(s, '°/s', '°/s²', '°'));
      parts.push(gainsSheet(s));
    }

    if (s.preset === 'climber') {
      parts.push(sheet('Climber',
        grid(field(id('gr'), 'Gear ratio', numIn(id('gr'), s, 'gearRatio', { unit: ': 1', min: 0.01 }), { help: H.gearClimb })),
        listBlock({
          id: id('act'), title: 'Actions', help: H.actionsClimb, items: s.actions, noun: 'action',
          cols: 'minmax(0, 1fr) 120px', head: ['Name', 'Speed'], empty: 'No actions yet.',
          row: (a) => [
            textIn(`a-${a.id}-name`, a, 'name', { aria: 'Action name', max: 40 }),
            numIn(`a-${a.id}-spd`, a, 'speed', { unit: '%', min: -100, max: 100, step: 5, aria: 'Speed in percent' }),
          ],
          add: () => s.actions.push(G.newAction('New Action', 50)),
          addLabel: 'Add action',
        })));
      parts.push(sheet('Soft limits',
        field(id('soft'), 'Soft limits', checkIn(id('soft'), s.softLimits, 'enabled', 'Stop the climber at set points'), { help: H.soft.replace('NAME', s.name || 'Climber'), wide: true }),
        s.softLimits.enabled && grid(
          field(id('smin'), 'Bottom', numIn(id('smin'), s.softLimits, 'min', { unit: 'turns', step: 1 })),
          field(id('smax'), 'Top', numIn(id('smax'), s.softLimits, 'max', { unit: 'turns', step: 1 })))));
    }
    if (G.CLOSED_LOOP.includes(s.preset) && robot.project.simulation !== false) parts.push(simSheet(s));
    return parts;
  }

  function setpointList(s, unit, help) {
    return listBlock({
      id: `s-${s.id}-sp`, title: 'Setpoints', help, items: s.setpoints, noun: 'setpoint',
      cols: 'minmax(0, 1fr) 140px', head: ['Name', unit === 'in' ? 'Height' : 'Angle'], empty: 'No setpoints yet.',
      row: (sp) => [
        textIn(`p-${sp.id}-name`, sp, 'name', { aria: 'Setpoint name', max: 40 }),
        numIn(`p-${sp.id}-val`, sp, 'value', { unit, step: unit === 'in' ? 0.5 : 1, aria: unit === 'in' ? 'Height in inches' : 'Angle in degrees' }),
      ],
      add: () => s.setpoints.push(G.newSetpoint('New Setpoint', 0)),
      addLabel: 'Add setpoint',
    });
  }

  function motionSheet(s, vel, acc, unit) {
    const id = (k) => `s-${s.id}-${k}`;
    return sheet('Motion',
      field(id('prof'), 'Smooth moves', checkIn(id('prof'), s, 'profile', 'Use a motion profile'), { help: H.profile, wide: true }),
      grid(
        s.profile !== false && field(id('cru'), 'Cruise speed', numIn(id('cru'), s, 'cruise', { unit: vel, step: 1, min: 0.1 }), { help: H.cruise }),
        s.profile !== false && field(id('acc'), 'Acceleration', numIn(id('acc'), s, 'accel', { unit: acc, step: 1, min: 0.1 }), { help: H.accel }),
        field(id('jog'), 'Jog lead', numIn(id('jog'), s, 'jogLead', { unit, step: 0.5, min: 0.1 }), { help: H.jog })));
  }

  /** Removes auto steps that use a deleted subsystem or lights. */
  function dropStepsFor(id) {
    const keep = (st) => st.target !== id && !String(st.condition || '').endsWith(':' + id);
    robot.autos.routines.forEach((rt) => { rt.steps = rt.steps.filter(keep); });
    robot.combos.forEach((cb) => { cb.steps = cb.steps.filter(keep); });
    robot.vision.zones.forEach((z) => { if (z.runTarget === id) { z.runTarget = ''; z.runAction = ''; } });
    robot.vision.tables.forEach((t) => { if (t.target === id) t.target = ''; });
    robot.rumbles = robot.rumbles.filter((x) => !String(x.when).endsWith(':' + id));
  }
  /** Removes everything that used one action (a table or a combo) by its key. */
  function dropAction(key) {
    robot.bindings = robot.bindings.filter((b) => b.action !== key);
    const keep = (st) => st.action !== key;
    robot.autos.routines.forEach((rt) => { rt.steps = rt.steps.filter(keep); });
    robot.combos.forEach((cb) => { cb.steps = cb.steps.filter(keep); });
    robot.vision.zones.forEach((z) => { if (z.runAction === key) { z.runTarget = ''; z.runAction = ''; } });
  }

  function deleteSubsystem(s) {
    robot.subsystems = robot.subsystems.filter((x) => x !== s);
    robot.bindings = robot.bindings.filter((b) => b.target !== s.id);
    dropStepsFor(s.id);
    robot.lights.forEach((l) => { l.rules = l.rules.filter((r) => !String(r.when).endsWith(':' + s.id)); });
    ui.confirmDelete = null;
    regen();
    select(robot.subsystems[0] ? { kind: 'subsystem', id: robot.subsystems[0].id } : { kind: 'add-subsystem' });
    changed();
    toast(`Deleted ${s.name || 'the subsystem'}. Its buttons and auto steps were removed too.`);
  }

  function addSubsystemEditor() {
    return [
      head('Subsystems', 'Add a subsystem', 'Pick the preset closest to your mechanism. You can rename it and change everything after.'),
      h('div', { class: 'cards' }, Object.keys(G.PRESETS).map((k) => h('button', {
        class: 'card', type: 'button', id: 'add-' + k,
        onclick: () => {
          const base = G.PRESETS[k].defaultName;
          const taken = new Set(robot.subsystems.map((x) => x.name.toLowerCase()));
          let name = base;
          for (let n = 2; taken.has(name.toLowerCase()); n++) name = base + ' ' + n;
          // The first piston also brings in the air controller, so give it a free CAN ID too.
          if (k === 'piston' && !robot.subsystems.some((x) => x.preset === 'piston')) robot.project.pneumaticsCanId = nextCanId();
          const s = G.newSubsystem(k, { name, canId: k === 'piston' ? 0 : nextCanId() });
          robot.subsystems.push(s);
          robot.example = false;
          regen();
          select({ kind: 'subsystem', id: s.id });
          changed();
          const nameInput = $('name-' + s.id);
          if (nameInput) nameInput.focus();
        },
      }, h('b', null, G.PRESETS[k].label), h('span', null, G.PRESETS[k].blurb)))),
    ];
  }

  /* ------------------------------------------------------------ controls */

  function buttonOptions(type, withNone) {
    const list = G.BUTTONS[type].map((x) => [x[0], x[1]]);
    return withNone ? [['none', 'None']].concat(list) : list;
  }
  function fixButtonsFor(ctl) {
    const valid = new Set(G.BUTTONS[ctl.type].map((x) => x[0]));
    robot.bindings.forEach((b) => { if (b.controllerId === ctl.id && !valid.has(b.button)) b.button = G.BUTTONS[ctl.type][0][0]; });
    if (robot.drive.controllerId === ctl.id) {
      const d = G.DRIVE_BUTTON_DEFAULTS[ctl.type];
      robot.drive.resetButton = d[0];
      robot.drive.brakeButton = d[1];
      robot.drive.slowButton = d[2];
    }
  }

  function controllersEditor() {
    const p = robot.project;
    const d = robot.drive;
    const dc = robot.controllers.find((c) => c.id === d.controllerId) || robot.controllers[0];
    const parts = [
      head('Controls', 'Controllers and driving', 'The controllers plugged into the Driver Station laptop, and how the robot drives.'),
      sheet('Controllers', listBlock({
        id: 'ctl', help: H.controllers, items: robot.controllers, noun: 'controller',
        cols: 'minmax(0, 1fr) minmax(0, 1fr) 90px', head: ['Name', 'Type', 'USB port'],
        empty: 'No controllers. Add one so the drivers can run the robot.',
        row: (c) => [
          textIn(`c-${c.id}-name`, c, 'name', { aria: 'Controller name', max: 30 }),
          selectIn(`c-${c.id}-type`, c, 'type', Object.keys(G.CONTROLLER_TYPES).map((k) => [k, G.CONTROLLER_TYPES[k].label]), { after: () => fixButtonsFor(c), aria: 'Controller type' }),
          numIn(`c-${c.id}-port`, c, 'port', { step: 1, min: 0, max: 5, aria: 'USB port' }),
        ],
        onRemove: (c) => {
          robot.bindings = robot.bindings.filter((b) => b.controllerId !== c.id);
          robot.rumbles = robot.rumbles.filter((x) => x.controllerId !== c.id);
          if (d.controllerId === c.id) d.controllerId = robot.controllers[0] ? robot.controllers[0].id : null;
        },
        add: () => {
          const used = new Set(robot.controllers.map((c) => Number(c.port)));
          let port = 0;
          while (used.has(port) && port < 5) port++;
          const names = ['Driver', 'Operator', 'Manipulator', 'Extra'];
          const name = names.find((n) => !robot.controllers.some((c) => c.name === n)) || 'Controller ' + (robot.controllers.length + 1);
          const c = G.newController(name, 'xbox', port);
          robot.controllers.push(c);
          if (!d.controllerId) d.controllerId = c.id;
        },
        addLabel: 'Add controller',
        addDisabled: robot.controllers.length >= 6,
      })),
    ];
    if (!p.tunerSwerve) {
      parts.push(sheet('Driving', note('Swerve driving is off. Turn it on in Robot settings if your drivetrain comes from Phoenix Tuner X.')));
      return parts;
    }
    if (!dc) {
      parts.push(sheet('Driving', note('Add a controller first. The swerve drive needs one to drive with.', true)));
      return parts;
    }
    const type = dc.type;
    parts.push(sheet('Driving',
      grid(
        field('d-ctl', 'Drive with', selectIn('d-ctl', d, 'controllerId', robot.controllers.map((c) => [c.id, c.name || 'Controller']), { after: () => fixButtonsFor(robot.controllers.find((c) => c.id === d.controllerId)) })),
        field('d-max', 'Top speed', numIn('d-max', d, 'maxSpeedPct', { unit: '%', step: 5, min: 5, max: 100 }), { help: H.topSpeed }),
        field('d-turn', 'Turn speed', numIn('d-turn', d, 'maxTurnRps', { unit: 'turns/s', step: 0.05, min: 0.1 }), { help: H.turn }),
        field('d-dead', 'Deadband', numIn('d-dead', d, 'deadbandPct', { unit: '%', step: 1, min: 0, max: 50 }), { help: H.deadband })),
      note(type === 'joystick' ? 'Push the joystick to drive and twist it to turn.' : 'Left stick drives, right stick turns. Driving is field-centric.'),
      grid(
        field('d-reset', 'Reset heading', selectIn('d-reset', d, 'resetButton', buttonOptions(type, true)), { help: H.resetBtn }),
        field('d-brake', 'Lock wheels in an X', selectIn('d-brake', d, 'brakeButton', buttonOptions(type, true)), { help: H.brakeBtn }),
        field('d-slow', 'Slow mode (hold)', selectIn('d-slow', d, 'slowButton', buttonOptions(type, true)), { help: H.slowBtn }),
        d.slowButton !== 'none' && field('d-slowp', 'Slow mode speed', numIn('d-slowp', d, 'slowPct', { unit: '%', step: 5, min: 5, max: 100 })),
        robot.vision.cameras.length > 0 && field('d-aim', 'Aim at AprilTag (hold)', selectIn('d-aim', d, 'aimButton', buttonOptions(type, true)), { help: H.aimBtn }),
        type === 'xbox' && field('d-sysid', 'Tuning', checkIn('d-sysid', d, 'sysId', 'Add SysId test buttons'), { help: H.sysId }))));
    return parts;
  }

  function bindingsEditor() {
    const model = G.buildModel(robot);
    const targets = model.subsystems.concat(model.lights, model.vision ? [model.vision] : [],
      model.combos.actions.length ? [model.combos] : []);
    const parts = [head('Controls', 'Buttons', 'Connect controller buttons to what your subsystems can do.')];
    if (!robot.controllers.length) {
      parts.push(note('Add a controller under Controllers and driving first.', true));
      return parts;
    }
    if (!targets.length) {
      parts.push(note('Add a subsystem or lights first. Their actions show up here.', true));
      return parts;
    }
    const taken = model.driveCtl ? model.driveButtons.filter((x) => !x.combo).map((x) => {
      const label = (G.BUTTONS[model.driveCtl.type].find((b) => b[0] === x.button) || [x.button, x.button])[1];
      return h('span', { class: 'chip' }, `${model.driveCtl.label} ${label}: ${x.what}`);
    }) : [];
    parts.push(sheet('Button bindings',
      taken.length && h('div', { class: 'taken' }, h('span', null, 'Used for driving:'), taken),
      listBlock({
        id: 'bind', help: H.when, items: robot.bindings, noun: 'binding', card: true,
        empty: 'No buttons yet. Add one to run a subsystem action.',
        row: (b) => {
          const ctl = robot.controllers.find((c) => c.id === b.controllerId);
          const type = ctl ? ctl.type : 'xbox';
          const target = targets.find((t) => t.id === b.target);
          const id = (k) => `b-${b.id}-${k}`;
          return [
            mini(id('ctl'), 'Controller', selectIn(id('ctl'), b, 'controllerId', robot.controllers.map((c) => [c.id, c.name || 'Controller']), {
              after: () => { const c = robot.controllers.find((x) => x.id === b.controllerId); if (c && !G.BUTTONS[c.type].some((x) => x[0] === b.button)) b.button = G.BUTTONS[c.type][0][0]; },
            })),
            mini(id('btn'), 'Button', selectIn(id('btn'), b, 'button', buttonOptions(type))),
            mini(id('when'), 'When', selectIn(id('when'), b, 'when', Object.keys(G.WHEN).map((k) => [k, cap(G.WHEN[k].label)]))),
            mini(id('tgt'), 'Runs on', selectIn(id('tgt'), b, 'target', targets.map((t) => [t.id, t.label]), {
              after: () => { const t = targets.find((x) => x.id === b.target); b.action = t && t.actions[0] ? t.actions[0].key : ''; },
            })),
            mini(id('act'), 'Action', selectIn(id('act'), b, 'action', target ? target.actions.map((a) => [a.key, a.label]) : [])),
          ];
        },
        add: () => {
          const ctl = robot.controllers[robot.controllers.length > 1 ? 1 : 0];
          const used = new Set(robot.bindings.filter((b) => b.controllerId === ctl.id).map((b) => b.button));
          model.driveButtons.forEach((x) => { if (model.driveCtl && model.driveCtl.id === ctl.id) used.add(x.button); });
          const free = G.BUTTONS[ctl.type].find((x) => !used.has(x[0])) || G.BUTTONS[ctl.type][0];
          const t = targets[0];
          robot.bindings.push({ id: G.uid('b'), controllerId: ctl.id, button: free[0], when: 'pressed', target: t.id, action: t.actions[0] ? t.actions[0].key : '' });
        },
        addLabel: 'Add button',
      })));
    parts.push(sheet('Rumble alerts',
      listBlock({
        id: 'rumble', help: H.rumbles, items: robot.rumbles, noun: 'alert', card: true,
        empty: 'No alerts yet. Add one to shake a controller when something happens.',
        row: (rb) => {
          const rid = (k) => `w-${rb.id}-${k}`;
          return [
            mini(rid('ctl'), 'Shake', selectIn(rid('ctl'), rb, 'controllerId', robot.controllers.map((c) => [c.id, c.name || 'Controller']))),
            mini(rid('when'), 'When', selectIn(rid('when'), rb, 'when', model.conditions.map((c) => [c.key, c.label]))),
            mini(rid('sec'), 'For', numIn(rid('sec'), rb, 'seconds', { unit: 's', step: 0.1, min: 0.1, max: 3 })),
            mini(rid('str'), 'Strength', numIn(rid('str'), rb, 'strength', { unit: '%', step: 10, min: 10, max: 100 })),
          ];
        },
        add: () => {
          const cond = model.conditions.find((x) => x.key.startsWith('piece:')) || model.conditions.find((x) => x.key.startsWith('zone:'))
            || model.conditions.find((x) => x.key === 'teleop');
          robot.rumbles.push(G.newRumble(robot.controllers[0].id, cond ? cond.key : 'teleop'));
        },
        addLabel: 'Add rumble alert',
      })));
    return parts;
  }

  /** Puts a distance table's action on a free button (held) and opens the Buttons page. */
  function bindTable(tb) {
    const ctl = robot.controllers[robot.controllers.length > 1 ? 1 : 0];
    if (!ctl) { toast('Add a controller first, under Controls.'); return; }
    const model = G.buildModel(robot);
    const used = new Set(robot.bindings.filter((b) => b.controllerId === ctl.id).map((b) => b.button));
    if (model.driveCtl && model.driveCtl.id === ctl.id) model.driveButtons.forEach((x) => used.add(x.button));
    const free = G.BUTTONS[ctl.type].find((x) => !used.has(x[0])) || G.BUTTONS[ctl.type][0];
    robot.bindings.push({ id: G.uid('b'), controllerId: ctl.id, button: free[0], when: 'held', target: tb.target, action: 'table:' + tb.id });
    changed();
    regen();
    select({ kind: 'bindings' });
    toast(`Put ${tb.name || 'the table'} on ${ctl.name || 'the controller'} ${free[1]} (while held). Change the button here if you like.`);
  }

  /** Adds (or finds) an LED status rule for a zone and opens those lights. */
  function zoneLeds(z) {
    const key = 'zone:' + z.id;
    const has = robot.lights.find((l) => l.rules.some((r) => r.when === key));
    const l = has || robot.lights[0];
    if (!has) {
      // After any "disabled" rules, so the robot still shows it is disabled.
      let at = 0;
      while (at < l.rules.length && l.rules[at].when === 'disabled') at++;
      l.rules.splice(at, 0, { id: G.uid('u'), when: key, pattern: 'solid', color: 'YELLOW' });
      changed();
      regen();
    }
    select({ kind: 'light', id: l.id });
    toast(has ? `Here is the rule for ${z.name || 'the zone'}.` : `Added "${z.name || 'Zone'}: solid yellow" to ${l.name || 'the lights'}. Pick the color here.`);
  }

  function pointsEditor(tb, unit) {
    return h('div', { class: 'points' },
      h('div', { class: 'points-row points-head', 'aria-hidden': 'true' }, h('span', null, 'Distance to the tag'), h('span', null, `Value${unit ? ' (' + unit + ')' : ''}`), h('span')),
      tb.points.map((p, idx) => h('div', { class: 'points-row' },
        numIn(`q-${p.id}-d`, p, 'distance', { unit: 'm', step: 0.25, min: 0, aria: `Point ${idx + 1} distance in meters` }),
        numIn(`q-${p.id}-v`, p, 'value', { unit: unit || null, step: unit === 'RPM' ? 50 : 1, aria: `Point ${idx + 1} value` }),
        h('button', {
          class: 'icon-btn remove', type: 'button', 'aria-label': `Remove point ${idx + 1}`, title: 'Remove', disabled: tb.points.length <= 1,
          onclick: () => { tb.points.splice(idx, 1); changed('rerender'); },
        }, '×'))),
      h('div', { class: 'row-btns' },
        h('button', {
          class: 'btn add small', type: 'button', id: `d-${tb.id}-addpt`,
          onclick: () => {
            const lastP = tb.points[tb.points.length - 1];
            tb.points.push({ id: G.uid('q'), distance: lastP ? (Number(lastP.distance) || 0) + 1 : 1, value: lastP ? lastP.value : 0 });
            changed('rerender');
          },
        }, '+ Add distance'),
        tb.target && h('button', { class: 'btn small', type: 'button', onclick: () => bindTable(tb) }, 'Put it on a button')));
  }

  /* ------------------------------------------------------------ autonomous */

  function copyText(text, done) {
    navigator.clipboard.writeText(text)
      .then(() => toast(done))
      .catch(() => toast("Couldn't copy here. The same list is in README.txt in the code download."));
  }

  function addRoutine() {
    const taken = new Set(robot.autos.routines.map((x) => String(x.name).toLowerCase()));
    let name = 'New Auto';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = 'New Auto ' + n;
    const rt = G.newRoutine(name);
    rt.resetHeading = !!robot.project.tunerSwerve;
    robot.autos.routines.push(rt);
    robot.example = false;
    regen();
    select({ kind: 'routine', id: rt.id });
    changed();
    const input = $('name-' + rt.id);
    if (input) { input.focus(); input.select(); }
  }

  function deleteRoutine(rt) {
    robot.autos.routines = robot.autos.routines.filter((x) => x !== rt);
    if (robot.autos.defaultAuto === rt.id) robot.autos.defaultAuto = '';
    ui.confirmDelete = null;
    regen();
    select(robot.autos.routines[0] ? { kind: 'routine', id: robot.autos.routines[0].id } : { kind: 'autos' });
    changed();
    toast(`Deleted ${rt.name || 'the routine'}.`);
  }

  function namedList(model) {
    const names = model.autos.named.map((n) => n.name);
    return h('div', { class: 'list-block' },
      h('div', { class: 'list-title' }, h('h4', null, 'Named commands'), helpButton('a-named')),
      helpPara('a-named', H.named),
      names.length
        ? h('div', { class: 'named' }, names.map((n) => h('code', { class: 'named-cmd' }, n)))
        : h('p', { class: 'empty' }, 'Add subsystems to get named commands.'),
      names.length > 0 && h('button', {
        class: 'btn small', type: 'button', onclick: () => copyText(names.join('\n'), 'Copied ' + plural(names.length, 'name')),
      }, 'Copy all names'));
  }

  function autosEditor() {
    const A = robot.autos;
    const model = G.buildModel(robot);
    const swerve = !!robot.project.tunerSwerve;
    const options = [['', 'None (the robot sits still)']].concat(A.routines.map((rt) => [rt.id, rt.name || 'Unnamed']));
    const ppOn = swerve && A.pathPlanner !== false;
    return [
      head('Autonomous', 'Auto settings', 'How the robot picks and runs its autonomous routine.'),
      sheet('Auto chooser',
        grid(field('a-def', 'Default auto', selectIn('a-def', A, 'defaultAuto', options), { help: H.defaultAuto })),
        h('div', { class: 'list-title' }, h('h4', null, 'Routines')),
        A.routines.length
          ? h('div', { class: 'taken' }, A.routines.map((rt) => h('button', {
            class: 'chip chip-btn', type: 'button', onclick: () => select({ kind: 'routine', id: rt.id }),
          }, rt.name || 'Unnamed')))
          : h('p', { class: 'empty' }, 'No routines yet.'),
        h('button', { class: 'btn add small', type: 'button', id: 'a-add', onclick: addRoutine }, '+ Add routine')),
      sheet('PathPlanner',
        swerve
          ? field('a-pp', 'PathPlanner', checkIn('a-pp', A, 'pathPlanner', 'Use PathPlanner for paths and autos'), { help: H.pathPlanner, wide: true })
          : note('PathPlanner needs the swerve drive from Phoenix Tuner X. Turn it on in Robot settings.'),
        ppOn && grid(
          field('a-tp', 'Translation kP', numIn('a-tp', A, 'translationP', { step: 0.5, min: 0 }), { help: H.ppP }),
          field('a-rp', 'Rotation kP', numIn('a-rp', A, 'rotationP', { step: 0.5, min: 0 }))),
        ppOn && h('ol', { class: 'how-to' },
          h('li', null, 'Install PathplannerLib from the WPILib Vendor Dependencies panel in VS Code.'),
          h('li', null, 'Open your robot project folder in the PathPlanner app.'),
          h('li', null, 'Fill in Settings → Robot Config (mass, MOI, wheel size, gearing, motor and module positions), then save.'),
          h('li', null, 'Draw paths and autos. Use the named commands below to run subsystem actions.')),
        ppOn && namedList(model)),
    ];
  }

  /** Keeps a step's "How" valid for its action. Setpoints default to waiting until they get there. */
  function fixMode(st, target) {
    const a = target && target.actions.find((x) => x.key === st.action);
    if (st.mode === 'finish' && !(a && a.finishes)) st.mode = 'time';
    else if (a && a.finishes && st.mode === 'time' && /^(sp:|stop$|zero$)/.test(st.action)) st.mode = 'finish';
  }

  function stepFields(st, idx, c) {
    const id = (k) => `e-${st.id}-${k}`;
    const kind = h('div', { class: 'mini step-kind' },
      h('span', { class: 'mini-label' }, 'Step ' + (idx + 1)),
      h('span', { class: 'mini-static' }, G.STEP_TYPES[st.type].label));
    const secs = (key, label, step) => mini(id(key), label, numIn(id(key), st, 'seconds', { unit: 's', step: step || 0.1, min: 0.1, max: 15 }));
    if (st.type === 'action') {
      const target = c.targets.find((t) => t.id === st.target);
      const actions = target ? target.actions.filter((a) => a.pp) : [];
      const action = actions.find((a) => a.key === st.action);
      const modes = Object.keys(G.ACTION_MODES)
        .filter((m) => m !== 'finish' || (action && action.finishes))
        .map((m) => [m, m === 'finish' && action && action.finishLabel ? action.finishLabel : G.ACTION_MODES[m]]);
      return [kind,
        mini(id('tgt'), 'Runs on', selectIn(id('tgt'), st, 'target', c.targets.map((t) => [t.id, t.label]), {
          after: () => {
            const t = c.targets.find((x) => x.id === st.target);
            const a = t && t.actions.find((x) => x.pp);
            st.action = a ? a.key : '';
            fixMode(st, t);
          },
        })),
        mini(id('act'), 'Action', selectIn(id('act'), st, 'action', actions.map((a) => [a.key, a.label]), { after: () => fixMode(st, target) })),
        mini(id('mode'), 'How', selectIn(id('mode'), st, 'mode', modes)),
        st.mode === 'time' && secs('sec', 'For'),
      ];
    }
    if (st.type === 'drive') {
      return [kind,
        mini(id('dir'), 'Direction', selectIn(id('dir'), st, 'direction', Object.keys(G.DRIVE_DIRS).map((k) => [k, G.DRIVE_DIRS[k].label]))),
        mini(id('spd'), 'Speed', numIn(id('spd'), st, 'speed', { unit: 'm/s', step: 0.1, min: 0.1, max: 5 })),
        secs('sec', 'For')];
    }
    if (st.type === 'wait') return [kind, secs('sec', 'For')];
    if (st.type === 'until') {
      return [kind,
        mini(id('cond'), 'Wait until', selectIn(id('cond'), st, 'condition', c.conds.map((x) => [x.key, x.label]))),
        secs('sec', 'Give up after', 0.5)];
    }
    if (st.type === 'path') {
      const listId = id('names');
      const input = textIn(id('name'), st, 'pathName', { placeholder: c.paths[0] ? c.paths[0].name : 'Start to Reef', max: 60, rerender: true });
      input.setAttribute('list', listId);
      return [kind,
        mini(id('name'), 'Path name', input),
        h('datalist', { id: listId }, c.paths.map((p) => h('option', { value: p.name }))),
        mini(id('start'), 'Position', checkIn(id('start'), st, 'resetPose', 'Start here')),
        c.pp && pathEditor(st, c)];
    }
    return [kind];
  }

  function routineEditor(rt) {
    const A = robot.autos;
    const model = G.buildModel(robot);
    const MA = model.autos;
    const c = {
      targets: MA.targets.filter((t) => t.actions.some((a) => a.pp)),
      conds: MA.conditions,
      swerve: MA.swerve,
      pp: MA.usePP,
      paths: model.paths,
    };
    const id = (k) => `t-${rt.id}-${k}`;
    const dflt = { on: A.defaultAuto === rt.id };
    const addStep = (type, opts) => () => { rt.steps.push(G.newStep(type, opts ? opts() : {})); changed('rerender'); };
    const firstAction = () => {
      const t = c.targets[0];
      const a = t && t.actions.find((x) => x.pp);
      return { target: t ? t.id : '', action: a ? a.key : '', mode: a && a.finishes && /^sp:/.test(a.key) ? 'finish' : 'time' };
    };
    let timed = 0;
    let waits = false;
    rt.steps.forEach((s) => {
      if (s.type === 'drive' || s.type === 'wait' || (s.type === 'action' && s.mode === 'time')) timed += Number(s.seconds) || 0;
      if (s.type === 'until' || (s.type === 'action' && s.mode === 'finish')) waits = true;
      if (s.type !== 'path') return;
      const info = model.paths.find((p) => p.name === String(s.pathName || '').trim());
      if (!info) { waits = true; return; }
      // Drive time for each piece between stops, plus the time spent stopped.
      const stops = arr(s.spots).filter((sp) => sp.kind === 'stop').map((sp) => ({ sp, pos: Math.min(info.last, Math.max(0, Number(sp.pos) || 0)) }))
        .sort((a, b) => a.pos - b.pos);
      let from = 0;
      stops.forEach(({ sp, pos }) => {
        if (pos - from > 0.001) { timed += G.PathGeom.trajectory(info.data, from, pos, 0, 0).time; from = pos; }
        if (sp.do === 'wait' || (sp.do === 'action' && sp.mode !== 'finish')) timed += Number(sp.seconds) || 0;
        else waits = true;
      });
      if (info.last - from > 0.001) timed += G.PathGeom.trajectory(info.data, from, info.last, 0, Number((info.data.goalEndState || {}).velocity) || 0).time;
    });
    return [
      itemHead('Auto routine', rt, 'Steps the robot runs one after another during autonomous. It shows up in "Auto Chooser" on the dashboard.', () => deleteRoutine(rt), 'routine'),
      sheet('Start',
        MA.swerve && field(id('head'), 'Heading', checkIn(id('head'), rt, 'resetHeading', 'Set "forward" to the way the robot faces'), { help: H.resetHeading, wide: true }),
        field(id('def'), 'Default', checkIn(id('def'), dflt, 'on', 'Run this if nobody picks an auto', { after: () => { A.defaultAuto = dflt.on ? rt.id : ''; } }), { help: H.defaultAuto, wide: true })),
      sheet('Steps',
        listBlock({
          id: id('steps'), help: [H.steps, H.mode].join(' '), items: rt.steps, noun: 'step', card: true, reorder: true,
          empty: 'No steps yet. Add the first one below.',
          row: (st, idx) => stepFields(st, idx, c),
        }),
        h('div', { class: 'add-row' },
          h('button', { class: 'btn add small', type: 'button', disabled: !c.targets.length, title: c.targets.length ? null : 'Add a subsystem first', onclick: addStep('action', firstAction) }, '+ Run an action'),
          c.swerve && h('button', { class: 'btn add small', type: 'button', onclick: addStep('drive') }, '+ Drive'),
          h('button', { class: 'btn add small', type: 'button', onclick: addStep('wait') }, '+ Wait'),
          c.conds.length > 0 && h('button', { class: 'btn add small', type: 'button', onclick: addStep('until', () => ({ condition: c.conds[0].key })) }, '+ Wait until'),
          c.pp && h('button', { class: 'btn add small', type: 'button', onclick: addStep('path', () => ({ firstPath: !rt.steps.some((s) => s.type === 'path') })) }, '+ Follow a path')),
        !c.swerve && note('Drive and path steps need the Tuner X swerve drive. Turn it on in Robot settings.'),
        rt.steps.length > 0 && h('p', { class: 'hint' }, `About ${timed.toFixed(1)} s${waits ? ', plus time spent waiting for mechanisms' : ''} (paths are estimated from their speed limits).`),
        rt.steps.length > 0 && h('div', { class: 'add-row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => { ui.simAuto = rt.id; select({ kind: 'simulator' }); } }, 'Watch it in the simulator'))),
    ];
  }


  /* ------------------------------------------------------------ PathPlanner paths */

  const FIELD = { l: 16.541, w: 8.069, zone: 4.03 };
  const ROBOT_M = 0.84;

  function cssColors() {
    const cs = getComputedStyle(document.body);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return {
      ink: v('--ink', '#16202a'), muted: v('--muted', '#586572'), line: v('--line', '#d1d8df'), lineStrong: v('--line-strong', '#b5c0ca'),
      panel: v('--panel', '#fff'), sunken: v('--sunken', '#f0f3f6'), accent: v('--accent', '#c94a0c'), err: v('--err', '#b9321b'),
      ok: v('--ok', '#1f7a3d'), info: v('--info', '#365f99'), warn: v('--warn', '#8f5d00'), font: cs.fontFamily,
    };
  }
  function fitCanvas(cv, w, hgt) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    cv.style.height = hgt + 'px';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }
  /** Meters to pixels, fitted around a path with some room to spare. */
  function pathBox(data, w, hgt, pad) {
    const b = G.PathGeom.bounds(data);
    const x0 = b.minX - pad; const x1 = b.maxX + pad; const y0 = b.minY - pad; const y1 = b.maxY + pad;
    const s = Math.min(w / (x1 - x0), hgt / (y1 - y0));
    const v = { s, x0: (x0 + x1) / 2 - w / 2 / s, y0: (y0 + y1) / 2 - hgt / 2 / s, w, h: hgt };
    v.X = (x) => (x - v.x0) * v.s;
    v.Y = (y) => v.h - (y - v.y0) * v.s;
    return v;
  }
  function drawBackdrop(ctx, v, col) {
    const { X, Y, s } = v;
    ctx.clearRect(0, 0, v.w, v.h);
    ctx.fillStyle = col.line;
    ctx.fillRect(0, 0, v.w, v.h);
    ctx.fillStyle = col.sunken;
    ctx.fillRect(X(0), Y(FIELD.w), FIELD.l * s, FIELD.w * s);
    ctx.fillStyle = 'rgba(47,111,222,0.10)';
    ctx.fillRect(X(0), Y(FIELD.w), FIELD.zone * s, FIELD.w * s);
    ctx.fillStyle = 'rgba(216,67,47,0.10)';
    ctx.fillRect(X(FIELD.l - FIELD.zone), Y(FIELD.w), FIELD.zone * s, FIELD.w * s);
    ctx.strokeStyle = col.lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(X(FIELD.l / 2), Y(0)); ctx.lineTo(X(FIELD.l / 2), Y(FIELD.w)); ctx.stroke();
    ctx.strokeRect(X(0), Y(FIELD.w), FIELD.l * s, FIELD.w * s);
    const tags = window.RobotSim ? window.RobotSim.TAGS : [];
    tags.forEach((t) => {
      ctx.save();
      ctx.translate(X(t.x), Y(t.y));
      ctx.rotate(-t.yaw);
      ctx.fillStyle = col.muted;
      ctx.fillRect(-1.5, -4, 3, 8);
      ctx.fillRect(1.5, -1, 3, 2);
      ctx.restore();
    });
  }
  function drawRobotBox(ctx, v, x, y, degrees, color, dashed) {
    const r = (ROBOT_M / 2) * v.s;
    ctx.save();
    ctx.translate(v.X(x), v.Y(y));
    ctx.rotate((-degrees * Math.PI) / 180);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.strokeRect(-r, -r, 2 * r, 2 * r);
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.restore();
  }
  function drawPathLine(ctx, v, data, col, opts) {
    const o = opts || {};
    const pts = G.PathGeom.sample(data, 0.01);
    ctx.strokeStyle = o.color || col.ink;
    ctx.lineWidth = o.width || 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(v.X(p.x), v.Y(p.y)) : ctx.moveTo(v.X(p.x), v.Y(p.y))));
    ctx.stroke();
    if (o.simple) return;
    const start = G.PathGeom.pointAt(data, 0);
    const lastPos = G.PathGeom.lastPos(data);
    const end = G.PathGeom.pointAt(data, lastPos);
    drawRobotBox(ctx, v, start.x, start.y, G.PathGeom.rotationAt(data, 0), col.ok, false);
    drawRobotBox(ctx, v, end.x, end.y, G.PathGeom.rotationAt(data, lastPos), col.err, false);
    (Array.isArray(data.rotationTargets) ? data.rotationTargets : []).forEach((r) => {
      const p = G.PathGeom.pointAt(data, Number(r.waypointRelativePos) || 0);
      drawRobotBox(ctx, v, p.x, p.y, Number(r.rotationDegrees) || 0, col.muted, true);
    });
    (Array.isArray(data.eventMarkers) ? data.eventMarkers : []).forEach((m) => {
      const p = G.PathGeom.pointAt(data, Number(m.waypointRelativePos) || 0);
      ctx.save();
      ctx.translate(v.X(p.x), v.Y(p.y));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = col.muted;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
      ctx.fillStyle = col.muted;
      ctx.font = '600 10px ' + col.font;
      ctx.textAlign = 'left';
      ctx.fillText(String(m.name || 'Marker'), v.X(p.x) + 7, v.Y(p.y) + 14);
    });
    G.PathGeom.waypoints(data).forEach((w, i) => {
      ctx.fillStyle = col.panel;
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(v.X(w.anchor.x), v.Y(w.anchor.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col.ink;
      ctx.font = '700 10px ' + col.font;
      ctx.textAlign = 'center';
      ctx.fillText(String(i), v.X(w.anchor.x), v.Y(w.anchor.y) - 9);
    });
  }
  /** Where a drive action stops: its end spot, the next stop, or the end of the path. */
  function spotEnd(sp, spots, last) {
    if (sp.until === 'spot' && Number(sp.endPos) > Number(sp.pos)) return Math.min(last, Number(sp.endPos));
    if (sp.until !== 'pathEnd') return null;
    const stops = spots.filter((x) => x.kind === 'stop' && Number(x.pos) > Number(sp.pos) + 1e-6).map((x) => Number(x.pos));
    return stops.length ? Math.min(...stops) : last;
  }
  function drawSpots(ctx, v, data, spots, col, opts) {
    const o = opts || {};
    const last = G.PathGeom.lastPos(data);
    spots.forEach((sp) => {
      if (sp.kind !== 'drive') return;
      const end = spotEnd(sp, spots, last);
      if (end == null) return;
      const pts = G.PathGeom.sample(data, 0.01, Number(sp.pos), end);
      ctx.strokeStyle = 'rgba(54,120,220,0.35)';
      ctx.lineWidth = 11;
      ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(v.X(p.x), v.Y(p.y)) : ctx.moveTo(v.X(p.x), v.Y(p.y))));
      ctx.stroke();
      if (sp.until === 'spot' && !o.simple) {
        const e = G.PathGeom.pointAt(data, end);
        ctx.fillStyle = col.info;
        ctx.fillRect(v.X(e.x) - 5, v.Y(e.y) - 5, 10, 10);
      }
    });
    spots.slice().sort((a, b) => Number(a.pos) - Number(b.pos)).forEach((sp, n) => {
      const p = G.PathGeom.pointAt(data, Number(sp.pos) || 0);
      const x = v.X(p.x);
      const y = v.Y(p.y);
      const stop = sp.kind === 'stop';
      ctx.fillStyle = stop ? col.err : col.info;
      ctx.strokeStyle = o.selected === sp.id ? col.accent : col.panel;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (stop) {
        for (let k = 0; k < 8; k++) {
          const a = Math.PI / 8 + (k * Math.PI) / 4;
          const px = x + Math.cos(a) * 9; const py = y + Math.sin(a) * 9;
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
      } else ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 10px ' + col.font;
      ctx.textAlign = 'center';
      ctx.fillText(String(n + 1), x, y + 3.5);
    });
  }

  /** Reads .path files into the robot file. A file with the same name replaces the old copy. */
  async function importPaths(fileList) {
    const files = Array.from(fileList || []).filter((f) => /\.(path|auto)$/i.test(f.name));
    if (!files.length) { toast('No .path or .auto files there. PathPlanner keeps them in src/main/deploy/pathplanner.'); return; }
    let added = 0;
    let updated = 0;
    const bad = [];
    for (const f of files) {
      try {
        const data = JSON.parse(await f.text());
        const when = new Date().toISOString();
        if (/\.auto$/i.test(f.name)) {
          if (!data || !data.command || typeof data.command.type !== 'string') throw new Error('not an auto');
          const name = f.name.replace(/\.auto$/i, '');
          const old = robot.ppAutos.find((a) => a.name === name);
          if (old) { old.data = data; old.imported = when; updated++; } else { robot.ppAutos.push({ id: G.uid('a'), name, data, imported: when }); added++; }
          continue;
        }
        if (!G.PathGeom.valid(data)) throw new Error('not a path');
        const name = f.name.replace(/\.path$/i, '');
        const old = robot.paths.find((p) => p.name === name);
        if (old) { old.data = data; old.imported = when; old.fromApp = false; updated++; } else {
          robot.paths.push({ id: G.uid('n'), name, data, imported: when, fromApp: false });
          added++;
        }
      } catch (e) { bad.push(f.name); }
    }
    robot.paths.sort((a, b) => a.name.localeCompare(b.name));
    robot.ppAutos.sort((a, b) => a.name.localeCompare(b.name));
    changed('rerender');
    regen();
    const said = [];
    if (added) said.push(`Added ${plural(added, 'file')}`);
    if (updated) said.push(`updated ${plural(updated, 'file')}`);
    if (bad.length) said.push(`couldn't read ${bad.join(', ')}`);
    toast(cap(said.join(', ') || 'Nothing changed') + '.');
  }

  function pathCard(p) {
    const lastPos = G.PathGeom.lastPos(p.data);
    const len = G.PathGeom.length(p.data);
    const goal = Number((p.data.goalEndState || {}).velocity) || 0;
    const secs = G.PathGeom.trajectory(p.data, 0, lastPos, 0, goal).time;
    const used = robot.autos.routines.filter((rt) => rt.steps.some((s) => s.type === 'path' && s.pathName === p.name)).map((rt) => rt.name || 'Unnamed');
    const cv = h('canvas', { class: 'path-thumb', role: 'img', 'aria-label': `Picture of the path ${p.name}` });
    const box = h('span', { class: 'path-thumb-box' }, cv);
    const draw = () => {
      const w = box.clientWidth;
      if (!w) return;
      const col = cssColors();
      const hh = Math.round(w * 0.5);
      const v = pathBox(p.data, w, hh, 1.2);
      const ctx = fitCanvas(cv, w, hh);
      drawBackdrop(ctx, v, col);
      drawPathLine(ctx, v, p.data, col, { width: 2.5 });
    };
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    ui.pathObservers.push(ro);
    setTimeout(draw, 0); // right after the page is on screen, even before the observer fires
    return h('article', { class: 'path-card' },
      h('button', { class: 'path-thumb-btn', type: 'button', 'aria-label': `Open ${p.name}`, onclick: () => select({ kind: 'path', id: p.id }) }, box),
      h('div', { class: 'path-card-body' },
        h('strong', null, p.name),
        h('span', { class: 'hint' }, `${lastPos + 1} waypoints · ${len.toFixed(1)} m · about ${secs.toFixed(1)} s`),
        h('span', { class: 'hint' }, used.length ? 'Used in ' + used.join(', ') : 'Not used in a routine yet'),
        p.fromApp && h('span', { class: 'chip' }, 'Made here, so it goes in the zip'),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn small', type: 'button', onclick: () => select({ kind: 'path', id: p.id }) }, p.fromApp ? 'Edit' : 'Open'),
          h('button', {
            class: 'btn small danger', type: 'button',
            onclick: () => { robot.paths = robot.paths.filter((x) => x !== p); changed('rerender'); regen(); toast(`Removed ${p.name}. Steps that follow it keep their actions.`); },
          }, 'Remove'))));
  }

  function pathsEditor() {
    const ppOn = !!robot.project.tunerSwerve && robot.autos.pathPlanner !== false;
    const fileIn = h('input', { type: 'file', accept: '.path,application/json', multiple: true, hidden: true, id: 'path-files', onchange: (e) => importPaths(e.target.files) });
    const dirIn = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, id: 'path-folder', onchange: (e) => importPaths(e.target.files) });
    fileIn.setAttribute('accept', '.path,.auto,application/json');
    const model = ui.model || G.buildModel(robot);
    return [
      head('Autonomous', 'Paths', 'Draw paths here or bring in the ones from PathPlanner. Then click along a path in a routine to stop there or run something while driving, and watch it in the simulator.'),
      !ppOn && note('Paths need the Tuner X swerve drive and PathPlanner (Robot settings and Auto settings).', true),
      sheet('Import from PathPlanner',
        h('p', null, 'PathPlanner saves paths in your robot project, in ', h('code', null, 'src/main/deploy/pathplanner/paths'), '. Pick the .path files or that whole folder.'),
        h('div', { class: 'add-row' },
          h('button', { class: 'btn primary small', type: 'button', onclick: () => fileIn.click() }, 'Import .path or .auto files'),
          h('button', { class: 'btn small', type: 'button', onclick: () => dirIn.click() }, 'Import a folder'),
          fileIn, dirIn),
        helpPara('paths-help', H.paths), note('Robot Code Builder never changes your .path files. Changed a path in PathPlanner? Import it again: the new copy replaces the old one and keeps the actions you added.')),
      sheet('Your paths',
        robot.paths.length ? h('div', { class: 'path-cards' }, robot.paths.map(pathCard)) : h('p', { class: 'empty' }, 'No paths yet. Import some above or draw one.'),
        h('div', { class: 'add-row' }, h('button', { class: 'btn add small', type: 'button', id: 'path-new', onclick: newPath }, '+ Draw a new path'))),
      sheet('PathPlanner autos',
        robot.ppAutos.length ? h('div', { class: 'pp-cards' }, robot.ppAutos.map((a) => ppAutoCard(a, model)))
          : h('p', { class: 'empty' }, 'Autos made in the PathPlanner app (.auto files, in src/main/deploy/pathplanner/autos) can be imported to watch them in the simulator.'),
        note('On the robot they show up in "Auto Chooser" next to your routines. Their named commands must match the list under Auto settings.')),
    ];
  }

  /** True when an action moves the robot, so it can't run while a path drives. */
  function drivesRobot(t, a) {
    return t.kind === 'vision' || (t.kind === 'combos' && !!a.combo && a.combo.steps.some((s) => s.type === 'action' && s.target.kind === 'vision'));
  }
  function spotTargets(sp, c) {
    return c.targets.filter((t) => t.actions.some((a) => a.pp && (sp.kind !== 'drive' || !drivesRobot(t, a))));
  }
  /** Points a spot at a valid action, keeping the one it has when it still fits. */
  function fixSpot(sp, c) {
    const targets = spotTargets(sp, c);
    const t = targets.find((x) => x.id === sp.target) || targets[0];
    const ok = (a) => a.pp && (sp.kind !== 'drive' || !drivesRobot(t, a));
    const a = t && (t.actions.find((x) => x.key === sp.action && ok(x)) || t.actions.find((x) => /^sp:/.test(x.key) && ok(x)) || t.actions.find(ok));
    sp.target = t ? t.id : '';
    sp.action = a ? a.key : '';
    if (sp.mode === 'finish' && !(a && a.finishes)) sp.mode = 'time';
    return { t, a };
  }
  function addSpot(st, info, c, pos) {
    const sp = G.newPathSpot('stop', { pos });
    fixSpot(sp, c);
    if (!sp.target) sp.do = 'wait';
    sp.endPos = info ? Math.min(info.last, +(pos + 0.5).toFixed(2)) : pos + 0.5;
    st.spots.push(sp);
    st.spots.sort((a, b) => Number(a.pos) - Number(b.pos));
    ui.lastSpot = sp.id;
    changed('rerender');
  }

  /** The field view of one path step: click the path to add an action, drag a marker to move it. */
  function pathView(st, info, c) {
    const data = info.data;
    const cv = h('canvas', {
      class: 'path-canvas', role: 'img',
      'aria-label': `The path ${info.name} with ${plural(st.spots.length, 'action')} along it. Click the path to add one, or use the Add button below.`,
    });
    const box = h('div', { class: 'path-view' }, cv);
    let v = null;
    let hover = null;
    let drag = null;
    const col0 = cssColors();
    const draw = () => {
      const w = box.clientWidth;
      if (!w) return;
      const col = cssColors();
      const hh = Math.round(Math.min(380, Math.max(200, w * 0.55)));
      v = pathBox(data, w, hh, 1.0);
      const ctx = fitCanvas(cv, w, hh);
      drawBackdrop(ctx, v, col);
      drawPathLine(ctx, v, data, col);
      drawSpots(ctx, v, data, st.spots, col, { selected: ui.lastSpot });
      if (hover && !drag) {
        ctx.fillStyle = col.accent;
        ctx.beginPath(); ctx.arc(v.X(hover.x), v.Y(hover.y), 5, 0, Math.PI * 2); ctx.fill();
        const label = `${hover.pos.toFixed(2)} · click to add`;
        ctx.font = '600 11px ' + col.font;
        const tw = ctx.measureText(label).width;
        const lx = Math.min(v.w - tw - 10, Math.max(4, v.X(hover.x) + 10));
        const ly = Math.max(16, v.Y(hover.y) - 10);
        ctx.fillStyle = col.panel;
        ctx.fillRect(lx - 4, ly - 12, tw + 8, 17);
        ctx.fillStyle = col.ink;
        ctx.textAlign = 'left';
        ctx.fillText(label, lx, ly);
      }
    };
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      return { px, py, x: px / v.s + v.x0, y: (v.h - py) / v.s + v.y0 };
    };
    const markerAt = (f) => {
      const hit = (pos) => { const p = G.PathGeom.pointAt(data, Number(pos) || 0); return Math.hypot(v.X(p.x) - f.px, v.Y(p.y) - f.py); };
      const ends = st.spots.filter((sp) => sp.kind === 'drive' && sp.until === 'spot' && Number(sp.endPos) > Number(sp.pos));
      const e = ends.find((sp) => hit(sp.endPos) < 9);
      if (e) return { sp: e, end: true };
      const m = st.spots.find((sp) => hit(sp.pos) < 11);
      return m ? { sp: m, end: false } : null;
    };
    const snap = (f) => {
      const n = G.PathGeom.nearest(data, f.x, f.y);
      if (!n) return null;
      const k = Math.round(n.pos);
      const a = G.PathGeom.pointAt(data, k);
      if (Math.hypot(v.X(a.x) - f.px, v.Y(a.y) - f.py) < 9) { n.pos = k; n.x = a.x; n.y = a.y; }
      n.pos = +n.pos.toFixed(2);
      return n;
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!v) return;
      const f = at(e);
      const m = markerAt(f);
      if (m) {
        drag = m;
        ui.lastSpot = m.sp.id;
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        e.preventDefault();
        return;
      }
      const n = snap(f);
      if (n && n.dist * v.s < 16) addSpot(st, info, c, n.pos);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!v) return;
      const f = at(e);
      if (drag) {
        const n = snap(f);
        if (!n) return;
        if (drag.end) drag.sp.endPos = Math.max(Number(drag.sp.pos) + 0.05, n.pos);
        else drag.sp.pos = n.pos;
        draw();
        return;
      }
      const n = snap(f);
      hover = n && n.dist * v.s < 16 ? n : null;
      cv.style.cursor = markerAt(f) ? 'grab' : hover ? 'copy' : 'default';
      draw();
    });
    const finish = () => {
      if (!drag) return;
      const sp = drag.sp;
      drag = null;
      if (sp.kind === 'drive' && Number(sp.endPos) <= Number(sp.pos)) sp.endPos = Math.min(info.last, +(Number(sp.pos) + 0.3).toFixed(2));
      st.spots.sort((a, b) => Number(a.pos) - Number(b.pos));
      changed('rerender');
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', finish);
    cv.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; draw(); } });
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    ui.pathObservers.push(ro);
    setTimeout(draw, 0); // right after the page is on screen, even before the observer fires
    void col0;
    return box;
  }

  /** The settings for one action along a path. */
  function spotRow(sp, n, st, info, c) {
    const id = (k) => `h-${sp.id}-${k}`;
    const last = info ? info.last : undefined;
    const { t: target, a: action } = fixSpot(sp, c);
    const targets = spotTargets(sp, c);
    const actions = target ? target.actions.filter((a) => a.pp && (sp.kind !== 'drive' || !drivesRobot(target, a))) : [];
    const kindSeg = h('div', { class: 'seg', role: 'radiogroup', id: id('kind'), 'aria-label': 'What the robot does' },
      [['stop', 'Stops here'], ['drive', 'Keeps driving']].map(([value, label], idx) => h('label', null,
        h('input', {
          type: 'radio', name: id('kind'), id: id('kind') + '-' + idx, checked: sp.kind === value,
          onchange: () => {
            sp.kind = value;
            if (value === 'drive') { sp.do = 'action'; fixSpot(sp, c); }
            changed('rerender');
          },
        }),
        h('span', null, label))));
    const fields = [
      h('span', { class: 'spot-badge ' + sp.kind, 'aria-hidden': 'true' }, String(n + 1)),
      mini(id('pos'), 'At spot', numIn(id('pos'), sp, 'pos', { step: 0.05, min: 0, max: last, rerender: true })),
      h('div', { class: 'mini' }, h('span', { class: 'mini-label' }, 'The robot'), kindSeg),
    ];
    const pickTarget = mini(id('tgt'), 'Runs on', selectIn(id('tgt'), sp, 'target', targets.map((t) => [t.id, t.label]), {
      after: () => { sp.action = ''; fixSpot(sp, c); },
    }));
    const pickAction = mini(id('act'), 'Action', selectIn(id('act'), sp, 'action', actions.map((a) => [a.key, a.label]), { after: () => fixSpot(sp, c) }));
    const secs = (label) => mini(id('sec'), label, numIn(id('sec'), sp, 'seconds', { unit: 's', step: 0.1, min: 0.1, max: 15 }));
    if (sp.kind === 'stop') {
      fields.push(mini(id('do'), 'And', selectIn(id('do'), sp, 'do', [['action', 'Runs an action'], ['wait', 'Waits'], ['until', 'Waits until…']], {
        after: () => {
          if (sp.do === 'until' && !c.conds.some((x) => x.key === sp.condition) && c.conds[0]) sp.condition = c.conds[0].key;
          if (sp.do === 'action') fixSpot(sp, c);
        },
      })));
      if (sp.do === 'wait') fields.push(secs('For'));
      else if (sp.do === 'until') {
        fields.push(mini(id('cond'), 'Until', selectIn(id('cond'), sp, 'condition', c.conds.map((x) => [x.key, x.label]))), secs('Give up after'));
      } else {
        const modes = [];
        if (action && action.finishes) modes.push(['finish', action.finishLabel || 'Until it finishes']);
        modes.push(['time', 'For a set time']);
        fields.push(pickTarget, pickAction, mini(id('mode'), 'How long', selectIn(id('mode'), sp, 'mode', modes)));
        if (sp.mode !== 'finish') fields.push(secs('For'));
      }
    } else {
      fields.push(pickTarget, pickAction, mini(id('until'), 'Until', selectIn(id('until'), sp, 'until', [
        ['spot', 'A later spot'], ['pathEnd', 'The robot stops'], ['time', 'A set time'], ['keep', 'Let it keep going'],
      ], { after: () => { if (sp.until === 'spot' && !(Number(sp.endPos) > Number(sp.pos))) sp.endPos = Math.min(last == null ? 99 : last, +(Number(sp.pos) + 0.5).toFixed(2)); } })));
      if (sp.until === 'spot') fields.push(mini(id('end'), 'Ends at spot', numIn(id('end'), sp, 'endPos', { step: 0.05, min: 0, max: last, rerender: true })));
      if (sp.until === 'time') fields.push(secs('For'));
    }
    fields.push(h('button', {
      class: 'icon-btn remove', type: 'button', 'aria-label': `Remove path action ${n + 1}`, title: 'Remove',
      onclick: () => { st.spots = st.spots.filter((x) => x !== sp); changed('rerender'); },
    }, '×'));
    return h('div', { class: 'spot-row' + (ui.lastSpot === sp.id ? ' current' : ''), onfocusin: () => { ui.lastSpot = sp.id; } }, fields);
  }

  /** Everything under a "Follow a path" step: the field view and the actions along the path. */
  function pathEditor(st, c) {
    if (!Array.isArray(st.spots)) st.spots = [];
    const name = String(st.pathName || '').trim().replace(/\.path$/i, '');
    const info = c.paths.find((p) => p.name === name);
    if (!info) {
      return h('div', { class: 'path-edit' },
        name && note(`To see "${name}" and add actions along it, import ${name}.path under Autonomous > Paths.`),
        h('div', { class: 'add-row' }, h('button', { class: 'btn small', type: 'button', onclick: () => select({ kind: 'paths' }) }, 'Go to Paths')),
        st.spots.length > 0 && note(`${plural(st.spots.length, 'action')} along this path will still be in the code.`));
    }
    const sorted = st.spots.slice().sort((a, b) => Number(a.pos) - Number(b.pos));
    return h('div', { class: 'path-edit' },
      pathView(st, info, c),
      h('p', { class: 'hint' }, 'Click the path to add an action at that spot. Drag a marker to move it. Spots count waypoints: 1.5 is halfway from waypoint 1 to 2.'),
      sorted.length ? h('div', { class: 'spots' }, sorted.map((sp, n) => spotRow(sp, n, st, info, c))) : null,
      h('div', { class: 'add-row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => select({ kind: 'path', id: (robot.paths.find((x) => x.name === info.name) || {}).id }) },
          info.fromApp ? 'Edit the path' : 'Open the path'),
        h('button', {
          class: 'btn add small', type: 'button', id: `e-${st.id}-addspot`,
          onclick: () => addSpot(st, info, c, sorted.length ? Math.min(info.last, +(Number(sorted[sorted.length - 1].pos) + 0.25).toFixed(2)) : +(info.last / 2).toFixed(2)),
        }, '+ Add an action along the path')));
  }


  /* ------------------------------------------------------------ path editor */

  function uniquePathName(base) {
    let name = base;
    for (let n = 2; robot.paths.some((p) => p.name === name); n++) name = `${base} ${n}`;
    return name;
  }
  function newPath() {
    const p = { id: G.uid('n'), name: uniquePathName('New Path'), data: G.PathGeom.blank(2.6, 6.0, 6.2, 6.0), fromApp: true, imported: null };
    robot.paths.push(p);
    robot.paths.sort((a, b) => a.name.localeCompare(b.name));
    changed();
    regen();
    select({ kind: 'path', id: p.id });
  }
  function duplicatePath(p) {
    const copy = { id: G.uid('n'), name: uniquePathName(p.name + ' copy'), data: G.PathGeom.complete(JSON.parse(JSON.stringify(p.data))), fromApp: true, imported: null };
    robot.paths.push(copy);
    robot.paths.sort((a, b) => a.name.localeCompare(b.name));
    changed();
    regen();
    select({ kind: 'path', id: copy.id });
    toast(`Made "${copy.name}". It goes in the zip.`);
  }
  function deletePath(p) {
    robot.paths = robot.paths.filter((x) => x !== p);
    ui.confirmDelete = null;
    changed();
    regen();
    select({ kind: 'paths' });
    toast(`Deleted ${p.name}. Routine steps that follow it keep their actions.`);
  }
  function renamePath(p, value) {
    const name = String(value || '').trim().replace(/\.path$/i, '');
    if (!name || /[\\/:*?"<>|]/.test(name)) { toast('Use a name without / \\ : * ? " < > |.'); renderEditor(); return; }
    if (name === p.name) return;
    if (robot.paths.some((x) => x !== p && x.name === name)) { toast('Another path already has that name.'); renderEditor(); return; }
    const old = p.name;
    p.name = name;
    robot.autos.routines.forEach((rt) => rt.steps.forEach((s) => { if (s.type === 'path' && s.pathName === old) s.pathName = name; }));
    robot.paths.sort((a, b) => a.name.localeCompare(b.name));
    changed('rerender');
    regen();
    const pp = robot.ppAutos.filter((a) => { let hit = false; G.walkPP(a.data.command, (c) => { if (c.type === 'path' && c.data && c.data.pathName === old) hit = true; }); return hit; });
    toast(pp.length ? `Renamed. PathPlanner autos (${pp.map((a) => a.name).join(', ')}) still use "${old}".` : `Renamed to "${name}". Routines that follow it were updated.`);
  }
  /** Moves the actions in routines that follow a path after its waypoints changed. */
  function remapSpots(name, f) {
    robot.autos.routines.forEach((rt) => rt.steps.forEach((s) => {
      if (s.type !== 'path' || s.pathName !== name) return;
      arr(s.spots).forEach((sp) => {
        sp.pos = +f(Number(sp.pos) || 0).toFixed(3);
        if (sp.endPos !== '' && sp.endPos != null && Number.isFinite(Number(sp.endPos))) sp.endPos = +f(Number(sp.endPos)).toFixed(3);
        if (sp.kind === 'drive' && sp.until === 'spot' && Number(sp.endPos) < Number(sp.pos)) { const t = sp.pos; sp.pos = sp.endPos; sp.endPos = t; }
      });
    }));
  }
  function pushUndo() {
    if (!ui.pathEdit) return;
    ui.pathEdit.undo.push(JSON.stringify(robot));
    if (ui.pathEdit.undo.length > 40) ui.pathEdit.undo.shift();
  }
  function undoPath() {
    const e = ui.pathEdit;
    if (!e || !e.undo.length) return;
    robot = migrate(JSON.parse(e.undo.pop()));
    changed('rerender');
    regen();
  }
  /** A change that moves waypoints around: actions along the path move with it, and it can be undone. */
  function reshape(p, op, message) {
    pushUndo();
    const f = op(p.data);
    if (f) remapSpots(p.name, f);
    changed('rerender');
    regen();
    if (message) toast(message);
  }
  function deleteWaypointAt(p, k) {
    if (p.data.waypoints.length <= 2) { toast('A path needs at least two waypoints.'); return; }
    ui.pathEdit.sel = null;
    reshape(p, (d) => G.PathGeom.deleteWaypoint(d, k));
  }

  /** Meters to pixels for the whole field. */
  function fieldBox(w, hgt) {
    const x0 = -0.3; const x1 = FIELD.l + 0.3; const y0 = -0.3; const y1 = FIELD.w + 0.3;
    const s = Math.min(w / (x1 - x0), hgt / (y1 - y0));
    const v = { s, x0: (x0 + x1) / 2 - w / 2 / s, y0: (y0 + y1) / 2 - hgt / 2 / s, w, h: hgt };
    v.X = (x) => (x - v.x0) * v.s;
    v.Y = (y) => v.h - (y - v.y0) * v.s;
    return v;
  }

  /** The big field for drawing a path: drag points and knobs, double-click to add waypoints. */
  function pathEditCanvas(p, E, editable) {
    const data = p.data;
    const raw = data.waypoints;
    const DEGR = Math.PI / 180;
    const KNOB = 0.75;
    const cv = h('canvas', {
      class: 'path-canvas big', id: 'pe-canvas', tabindex: '0', role: 'application',
      'aria-label': `Path editor for ${p.name}. Drag waypoints, the round curve handles and the knobs that turn the robot. Double-click to add a waypoint. Delete removes the picked waypoint.`,
    });
    const box = h('div', { class: 'path-view' }, cv);
    let v = null;
    let frozen = null;
    let drag = null;
    let hover = null;
    const r2 = (n) => Math.round(n * 100) / 100;
    const clampX = (x) => Math.min(FIELD.l, Math.max(0, r2(x)));
    const clampY = (y) => Math.min(FIELD.w, Math.max(0, r2(y)));
    const rot = (o) => Number((o || {}).rotation) || 0;
    const robots = () => {
      const lastPos = G.PathGeom.lastPos(data);
      const s0 = G.PathGeom.pointAt(data, 0);
      const e0 = G.PathGeom.pointAt(data, lastPos);
      const out = [{ kind: 'start', x: s0.x, y: s0.y, deg: rot(data.idealStartingState) }, { kind: 'end', x: e0.x, y: e0.y, deg: rot(data.goalEndState) }];
      arr(data.rotationTargets).forEach((r, i) => {
        const q = G.PathGeom.pointAt(data, Number(r.waypointRelativePos) || 0);
        out.push({ kind: 'target', i, x: q.x, y: q.y, deg: Number(r.rotationDegrees) || 0 });
      });
      return out;
    };
    const knobAt = (r) => ({ x: r.x + Math.cos(r.deg * DEGR) * KNOB, y: r.y + Math.sin(r.deg * DEGR) * KNOB });
    const setDeg = (r, deg) => {
      if (r.kind === 'start') data.idealStartingState.rotation = deg;
      else if (r.kind === 'end') data.goalEndState.rotation = deg;
      else data.rotationTargets[r.i].rotationDegrees = deg;
    };
    const draw = () => {
      const w = box.clientWidth;
      if (!w) return;
      const col = cssColors();
      const hh = Math.round(Math.min(660, Math.max(240, w * 0.5)));
      v = frozen || (E.fit ? pathBox(data, w, hh, 1.4) : fieldBox(w, hh));
      const ctx = fitCanvas(cv, w, hh);
      drawBackdrop(ctx, v, col);
      drawPathLine(ctx, v, data, col, { simple: true, width: 4 });
      if (editable) {
        raw.forEach((wp) => ['prevControl', 'nextControl'].forEach((side) => {
          const c = wp[side];
          if (!c) return;
          ctx.strokeStyle = col.lineStrong;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(v.X(wp.anchor.x), v.Y(wp.anchor.y)); ctx.lineTo(v.X(c.x), v.Y(c.y)); ctx.stroke();
          ctx.fillStyle = col.panel;
          ctx.strokeStyle = col.accent;
          ctx.beginPath(); ctx.arc(v.X(c.x), v.Y(c.y), 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }));
      }
      robots().forEach((r) => {
        const color = r.kind === 'start' ? col.ok : r.kind === 'end' ? col.err : col.muted;
        drawRobotBox(ctx, v, r.x, r.y, r.deg, color, r.kind === 'target');
        if (!editable) return;
        const k = knobAt(r);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(v.X(r.x), v.Y(r.y)); ctx.lineTo(v.X(k.x), v.Y(k.y)); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(v.X(k.x), v.Y(k.y), 6, 0, Math.PI * 2); ctx.fill();
      });
      raw.forEach((wp, k) => {
        const x = v.X(wp.anchor.x);
        const y = v.Y(wp.anchor.y);
        ctx.fillStyle = E.sel === k ? col.accent : col.panel;
        ctx.strokeStyle = col.ink;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = col.ink;
        ctx.font = '700 11px ' + col.font;
        ctx.textAlign = 'center';
        ctx.fillText(String(k), x, y - 11);
      });
      if (hover) {
        ctx.font = '600 11.5px ' + col.font;
        const tw = ctx.measureText(hover.text).width;
        const lx = Math.min(v.w - tw - 10, Math.max(4, hover.x + 12));
        const ly = Math.max(16, hover.y - 12);
        ctx.fillStyle = col.panel;
        ctx.fillRect(lx - 4, ly - 12, tw + 8, 17);
        ctx.fillStyle = col.ink;
        ctx.textAlign = 'left';
        ctx.fillText(hover.text, lx, ly);
      }
    };
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      return { px, py, x: px / v.s + v.x0, y: (v.h - py) / v.s + v.y0 };
    };
    const hitTest = (f) => {
      const d = (x, y) => Math.hypot(v.X(x) - f.px, v.Y(y) - f.py);
      if (editable) {
        for (const r of robots()) { const k = knobAt(r); if (d(k.x, k.y) < 9) return { type: 'knob', r }; }
        for (let k = 0; k < raw.length; k++) {
          for (const side of ['prevControl', 'nextControl']) {
            const c = raw[k][side];
            if (c && d(c.x, c.y) < 8) return { type: 'control', k, side };
          }
        }
      }
      for (let k = 0; k < raw.length; k++) if (d(raw[k].anchor.x, raw[k].anchor.y) < 10) return { type: 'anchor', k };
      if (editable) {
        const targets = arr(data.rotationTargets);
        for (let i = 0; i < targets.length; i++) {
          const q = G.PathGeom.pointAt(data, Number(targets[i].waypointRelativePos) || 0);
          if (d(q.x, q.y) < 10) return { type: 'target', i };
        }
      }
      const n = G.PathGeom.nearest(data, f.x, f.y);
      if (n && n.dist * v.s < 12) return { type: 'path', pos: n.pos };
      return null;
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!v) return;
      const f = at(e);
      const hit = hitTest(f);
      if (!hit) { if (E.sel != null) { E.sel = null; draw(); } return; }
      if (hit.type === 'anchor') E.sel = hit.k;
      if (!editable || hit.type === 'path') { draw(); return; }
      drag = Object.assign({ moved: false, start: f }, hit);
      frozen = v;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!v) return;
      const f = at(e);
      if (!drag) {
        const hit = hitTest(f);
        cv.style.cursor = hit ? (hit.type === 'path' ? 'copy' : 'grab') : editable ? 'crosshair' : 'default';
        let text = null;
        if (editable && hit && hit.type === 'path') text = `${hit.pos.toFixed(2)} · double-click to add a waypoint here`;
        else if (editable && !hit) text = `${r2(f.x).toFixed(2)}, ${r2(f.y).toFixed(2)} m · double-click to add a waypoint at the end`;
        else if (hit && hit.type === 'knob') text = 'Drag to turn the robot (hold Shift for 15° steps)';
        hover = text ? { x: f.px, y: f.py, text } : null;
        draw();
        return;
      }
      if (!drag.moved) {
        if (Math.hypot(f.px - drag.start.px, f.py - drag.start.py) < 3) return;
        drag.moved = true;
        hover = null;
        pushUndo();
      }
      if (drag.type === 'anchor') {
        const wp = raw[drag.k];
        const x = clampX(f.x);
        const y = clampY(f.y);
        const dx = x - wp.anchor.x;
        const dy = y - wp.anchor.y;
        wp.anchor = { x, y };
        ['prevControl', 'nextControl'].forEach((s) => { if (wp[s]) wp[s] = { x: r2(wp[s].x + dx), y: r2(wp[s].y + dy) }; });
      } else if (drag.type === 'control') {
        const wp = raw[drag.k];
        const a = wp.anchor;
        wp[drag.side] = { x: r2(f.x), y: r2(f.y) };
        // Keep the curve smooth: the other handle stays in line, at its own length.
        const other = drag.side === 'prevControl' ? 'nextControl' : 'prevControl';
        const dx = a.x - f.x;
        const dy = a.y - f.y;
        const dl = Math.hypot(dx, dy);
        if (wp[other] && dl > 1e-6) {
          const len = Math.hypot(wp[other].x - a.x, wp[other].y - a.y);
          wp[other] = { x: r2(a.x + (dx / dl) * len), y: r2(a.y + (dy / dl) * len) };
        }
      } else if (drag.type === 'knob') {
        let deg = Math.atan2(f.y - drag.r.y, f.x - drag.r.x) / DEGR;
        deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
        if (deg <= -180) deg += 360;
        setDeg(drag.r, deg);
      } else if (drag.type === 'target') {
        const n = G.PathGeom.nearest(data, f.x, f.y);
        if (n) data.rotationTargets[drag.i].waypointRelativePos = +n.pos.toFixed(2);
      }
      G.PathGeom.touch(data);
      draw();
    });
    const finish = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      frozen = null;
      if (moved) {
        arr(data.rotationTargets).sort((a, b) => a.waypointRelativePos - b.waypointRelativePos);
        changed('rerender');
        regen();
      } else draw();
    };
    cv.addEventListener('pointerup', finish);
    cv.addEventListener('pointercancel', finish);
    cv.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; draw(); } });
    cv.addEventListener('dblclick', (e) => {
      if (!editable || !v) return;
      const f = at(e);
      const hit = hitTest(f);
      if (hit && hit.type !== 'path') return;
      if (hit) {
        pushUndo();
        const fm = G.PathGeom.insertWaypoint(data, hit.pos);
        if (!fm) { ui.pathEdit.undo.pop(); toast('That is too close to a waypoint.'); return; }
        remapSpots(p.name, fm);
        E.sel = Math.floor(hit.pos) + 1;
      } else {
        pushUndo();
        if (!G.PathGeom.appendWaypoint(data, clampX(f.x), clampY(f.y))) { ui.pathEdit.undo.pop(); return; }
        E.sel = raw.length - 1;
      }
      changed('rerender');
      regen();
    });
    cv.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && editable && E.sel != null) { e.preventDefault(); deleteWaypointAt(p, E.sel); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoPath(); }
    });
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    ui.pathObservers.push(ro);
    setTimeout(draw, 0); // right after the page is on screen, even before the observer fires
    return box;
  }

  /** The page for one path: draw it, set its rotations and speed, see where it is used. */
  function pathEditorPage(p) {
    const data = p.data;
    if (!ui.pathEdit || ui.pathEdit.id !== p.id) ui.pathEdit = { id: p.id, sel: null, undo: [], fit: false };
    const E = ui.pathEdit;
    const editable = !!p.fromApp;
    if (editable) G.PathGeom.complete(data);
    const raw = data.waypoints;
    if (E.sel != null && E.sel >= raw.length) E.sel = null;
    const lastPos = G.PathGeom.lastPos(data);
    const len = G.PathGeom.length(data);
    const secs = G.PathGeom.trajectory(data, 0, lastPos, 0, Number((data.goalEndState || {}).velocity) || 0).time;
    const used = robot.autos.routines.filter((rt) => rt.steps.some((s) => s.type === 'path' && s.pathName === p.name));
    const usedPP = robot.ppAutos.filter((a) => { let hit = false; G.walkPP(a.data.command, (c) => { if (c.type === 'path' && c.data && c.data.pathName === p.name) hit = true; }); return hit; });
    const confirming = ui.confirmDelete === p.id;
    const id = (k) => 'pe-' + k;
    const viewSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'View' },
      [[false, 'Whole field'], [true, 'Fit the path']].map(([fit, label], idx) => h('label', null,
        h('input', { type: 'radio', name: 'pe-view', id: 'pe-view-' + idx, checked: E.fit === fit, onchange: () => { E.fit = fit; renderEditor(); } }),
        h('span', null, label))));
    const wpRows = raw.map((wp, k) => {
      const coord = (axis) => h('input', {
        type: 'number', step: 0.05, min: 0, max: axis === 'x' ? FIELD.l : FIELD.w, id: id(`w${k}-${axis}`), value: wp.anchor[axis], disabled: !editable,
        'aria-label': `Waypoint ${k} ${axis.toUpperCase()} in meters`,
        onchange: (e) => {
          const val = parseFloat(e.target.value);
          if (!Number.isFinite(val)) return;
          pushUndo();
          const delta = val - wp.anchor[axis];
          wp.anchor = Object.assign({}, wp.anchor, { [axis]: val });
          ['prevControl', 'nextControl'].forEach((s) => { if (wp[s]) wp[s] = Object.assign({}, wp[s], { [axis]: +(wp[s][axis] + delta).toFixed(3) }); });
          G.PathGeom.touch(data);
          changed('rerender');
          regen();
        },
      });
      return h('div', { class: 'wp-row' + (E.sel === k ? ' current' : '') },
        h('button', { class: 'spot-badge wp', type: 'button', 'aria-label': `Pick waypoint ${k}`, onclick: () => { E.sel = k; renderEditor(); } }, String(k)),
        h('div', { class: 'with-unit' }, coord('x'), h('span', { class: 'unit', 'aria-hidden': 'true' }, 'x m')),
        h('div', { class: 'with-unit' }, coord('y'), h('span', { class: 'unit', 'aria-hidden': 'true' }, 'y m')),
        editable ? h('button', {
          class: 'icon-btn remove', type: 'button', 'aria-label': `Remove waypoint ${k}`, title: 'Remove', disabled: raw.length <= 2,
          onclick: () => deleteWaypointAt(p, k),
        }, '×') : h('span'));
    });
    const targets = arr(data.rotationTargets);
    const targetRows = targets.map((r, i) => h('div', { class: 'wp-row' },
      h('span', { class: 'spot-badge target', 'aria-hidden': 'true' }, String(i + 1)),
      numIn(id(`t${i}-pos`), r, 'waypointRelativePos', { step: 0.05, min: 0, max: lastPos, rerender: true, aria: `Rotation target ${i + 1} spot` }),
      numIn(id(`t${i}-deg`), r, 'rotationDegrees', { unit: '°', step: 5, rerender: true, aria: `Rotation target ${i + 1} degrees` }),
      editable ? h('button', {
        class: 'icon-btn remove', type: 'button', 'aria-label': `Remove rotation target ${i + 1}`, title: 'Remove',
        onclick: () => { pushUndo(); targets.splice(i, 1); changed('rerender'); regen(); },
      }, '×') : h('span')));
    const g = data.globalConstraints || {};
    const custom = () => { data.useDefaultConstraints = false; };
    // Imported paths are read-only here: a disabled fieldset turns off every field inside it.
    const lock = (...kids) => h('fieldset', { class: 'pe-fieldset', disabled: !editable }, kids);
    return [
      h('div', { class: 'ed-head' },
        h('div', { class: 'ed-kicker' }, editable ? 'Path · made here' : 'Path · from PathPlanner'),
        h('div', { class: 'ed-title-row' },
          h('input', { class: 'name-input', id: id('name'), value: p.name, maxlength: 60, 'aria-label': 'Path name', disabled: !editable, onchange: (e) => renamePath(p, e.target.value) }),
          editable && h('button', {
            class: 'btn small ' + (confirming ? 'danger' : 'ghost'), type: 'button',
            onclick: () => { if (confirming) deletePath(p); else { ui.confirmDelete = p.id; renderEditor(); } },
          }, confirming ? 'Click again to delete' : 'Delete path')),
        h('p', { class: 'ed-blurb' }, `${lastPos + 1} waypoints · ${len.toFixed(1)} m · about ${secs.toFixed(1)} s with these speed limits.`)),
      !editable && h('div', { class: 'note warn' },
        h('p', null, 'This is your copy of a PathPlanner file, so it is read-only here. Change it in PathPlanner and import it again, or edit it here. Once you edit it here, it goes in the zip and replaces ', h('code', null, `${p.name}.path`), ' in your project when you copy the src folder.'),
        h('div', { class: 'row-btns' }, h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { p.fromApp = true; G.PathGeom.complete(data); changed('rerender'); regen(); toast(`You can edit ${p.name} here now. It goes in the zip.`); },
        }, 'Edit it here'))),
      h('div', { class: 'path-tools' },
        h('button', { class: 'btn small', type: 'button', disabled: !E.undo.length, onclick: undoPath }, 'Undo'),
        editable && h('button', { class: 'btn small', type: 'button', onclick: () => reshape(p, (d) => G.PathGeom.reversePath(d), 'Reversed. Actions along it moved with it.') }, 'Reverse'),
        editable && h('button', { class: 'btn small', type: 'button', onclick: () => reshape(p, (d) => { G.PathGeom.mirrorPath(d); return null; }, 'Mirrored top to bottom.') }, 'Mirror top to bottom'),
        h('button', { class: 'btn small', type: 'button', onclick: () => duplicatePath(p) }, 'Duplicate'),
        viewSeg,
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => select({ kind: 'paths' }) }, 'All paths')),
      pathEditCanvas(p, E, editable),
      editable && h('p', { class: 'hint' }, 'Double-click the field to add a waypoint at the end, or double-click the path to add one there. Drag waypoints, the curve handles and the knobs that turn the robot. Pick a waypoint and press Delete to remove it. Ctrl+Z undoes.'),
      h('div', { class: 'pe-grid' },
        sheet('Start and end', lock(
          grid(
            field(id('srot'), 'Start facing', numIn(id('srot'), data.idealStartingState || {}, 'rotation', { unit: '°', step: 5, rerender: true }), { hint: '0 faces the red wall' }),
            field(id('erot'), 'End facing', numIn(id('erot'), data.goalEndState || {}, 'rotation', { unit: '°', step: 5, rerender: true })),
            field(id('evel'), 'End speed', numIn(id('evel'), data.goalEndState || {}, 'velocity', { unit: 'm/s', step: 0.25, min: 0, rerender: true }), { hint: '0 stops at the end' })))),
        sheet('Speed limits', lock(
          grid(
            field(id('mv'), 'Top speed', numIn(id('mv'), g, 'maxVelocity', { unit: 'm/s', step: 0.25, min: 0.1, rerender: true, after: custom })),
            field(id('ma'), 'Acceleration', numIn(id('ma'), g, 'maxAcceleration', { unit: 'm/s²', step: 0.25, min: 0.1, rerender: true, after: custom })),
            field(id('mw'), 'Turn speed', numIn(id('mw'), g, 'maxAngularVelocity', { unit: '°/s', step: 30, min: 10, rerender: true, after: custom })),
            field(id('mwa'), 'Turn acceleration', numIn(id('mwa'), g, 'maxAngularAcceleration', { unit: '°/s²', step: 60, min: 10, rerender: true, after: custom })))),
          note('PathPlanner also checks these against the robot settings saved in the PathPlanner app.')),
        sheet('Waypoints',
          h('div', { class: 'wp-list' }, wpRows),
          editable && h('p', { class: 'hint' }, 'Changing waypoints moves actions placed along this path in your routines, so they stay on the same part of the field.')),
        sheet('Rotation targets',
          targets.length ? lock(h('div', { class: 'wp-list' }, targetRows)) : h('p', { class: 'empty' }, 'None. The robot turns smoothly from its start to its end rotation.'),
          editable && h('button', {
            class: 'btn add small', type: 'button', id: id('addrot'),
            onclick: () => {
              pushUndo();
              const pos = +(lastPos / 2).toFixed(2);
              targets.push({ waypointRelativePos: pos, rotationDegrees: Math.round(G.PathGeom.rotationAt(data, pos)) });
              data.rotationTargets = targets.sort((a, b) => a.waypointRelativePos - b.waypointRelativePos);
              changed('rerender');
              regen();
            },
          }, '+ Add rotation target')),
        sheet('Used in',
          used.length || usedPP.length
            ? h('div', { class: 'taken' }, used.map((rt) => h('button', { class: 'chip chip-btn', type: 'button', onclick: () => select({ kind: 'routine', id: rt.id }) }, rt.name || 'Unnamed')),
              usedPP.map((a) => h('span', { class: 'chip' }, 'PathPlanner: ' + a.name)))
            : h('p', { class: 'empty' }, 'Not used yet. Add a "Follow a path" step to a routine.'),
          editable && note(`It goes in the zip as src/main/deploy/pathplanner/paths/${p.name}.path.`))),
    ];
  }

  /** A PathPlanner auto as a short readable list. */
  function ppTree(cmd, named, pathNames) {
    const d = (cmd && cmd.data) || {};
    const kids = () => h('ol', { class: 'pp-tree' }, arr(d.commands).map((c) => ppTree(c, named, pathNames)));
    switch (cmd && cmd.type) {
      case 'path': return h('li', null, 'Drive ', h('strong', null, d.pathName || '?'), pathNames.has(d.pathName) ? null : h('span', { class: 'chip warn-chip' }, 'not imported'));
      case 'named': return h('li', null, 'Run ', h('strong', null, d.name || '?'), named.has(d.name) ? null : h('span', { class: 'chip warn-chip' }, 'not in the code'));
      case 'wait': return h('li', null, `Wait ${Number(d.waitTime) || 0} s`);
      case 'sequential': return h('li', null, 'In order:', kids());
      case 'parallel': return h('li', null, 'All at once, until all finish:', kids());
      case 'race': return h('li', null, 'All at once, until the first one finishes:', kids());
      case 'deadline': return h('li', null, 'All at once, until the first one in the list finishes:', kids());
      default: return h('li', null, String((cmd && cmd.type) || 'Unknown block'));
    }
  }
  function ppAutoCard(a, model) {
    const named = new Set(((model && model.autos && model.autos.named) || []).map((n) => n.name));
    const pathNames = new Set(robot.paths.map((p) => p.name));
    const top = a.data.command;
    const list = top && top.type === 'sequential' ? h('ol', { class: 'pp-tree' }, arr(top.data && top.data.commands).map((c) => ppTree(c, named, pathNames)))
      : h('ol', { class: 'pp-tree' }, ppTree(top, named, pathNames));
    return h('article', { class: 'pp-card' },
      h('div', { class: 'pp-card-head' }, h('strong', null, a.name), a.data.resetOdom ? h('span', { class: 'hint' }, 'Starts at its first path') : null),
      list,
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn small', type: 'button', onclick: () => { ui.simAuto = 'pp:' + a.id; select({ kind: 'simulator' }); } }, 'Watch it in the simulator'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => { robot.ppAutos = robot.ppAutos.filter((x) => x !== a); changed('rerender'); regen(); } }, 'Remove')));
  }

  /* ------------------------------------------------------------ combos */

  function addCombo() {
    const taken = new Set(robot.combos.map((x) => String(x.name).toLowerCase()));
    let name = 'New Combo';
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = 'New Combo ' + n;
    const cb = G.newCombo(name);
    robot.combos.push(cb);
    robot.example = false;
    regen();
    select({ kind: 'combo', id: cb.id });
    changed();
    const input = $('name-' + cb.id);
    if (input) { input.focus(); input.select(); }
  }

  function deleteCombo(cb) {
    const key = 'combo:' + cb.id;
    robot.combos = robot.combos.filter((x) => x !== cb);
    robot.bindings = robot.bindings.filter((b) => !(b.target === 'combos' && b.action === key));
    robot.vision.zones.forEach((z) => { if (z.runAction === key) { z.runTarget = ''; z.runAction = ''; } });
    robot.autos.routines.forEach((rt) => { rt.steps = rt.steps.filter((st) => !(st.target === 'combos' && st.action === key)); });
    ui.confirmDelete = null;
    regen();
    select(robot.combos[0] ? { kind: 'combo', id: robot.combos[0].id } : { kind: 'bindings' });
    changed();
    toast(`Deleted ${cb.name || 'the combo'}. Its buttons were removed too.`);
  }

  /** Adds a button binding for a combo on the first free button and opens the Buttons page. */
  function bindCombo(cb) {
    const ctl = robot.controllers[robot.controllers.length > 1 ? 1 : 0];
    if (!ctl) { toast('Add a controller first, under Controls.'); return; }
    const model = G.buildModel(robot);
    const used = new Set(robot.bindings.filter((b) => b.controllerId === ctl.id).map((b) => b.button));
    if (model.driveCtl && model.driveCtl.id === ctl.id) model.driveButtons.forEach((x) => used.add(x.button));
    const free = G.BUTTONS[ctl.type].find((x) => !used.has(x[0])) || G.BUTTONS[ctl.type][0];
    robot.bindings.push({ id: G.uid('b'), controllerId: ctl.id, button: free[0], when: 'pressed', target: 'combos', action: 'combo:' + cb.id });
    changed();
    regen();
    select({ kind: 'bindings' });
    toast(`Put ${cb.name || 'the combo'} on ${ctl.name || 'the controller'} ${free[1]}. Change the button here if you like.`);
  }

  function comboEditor(cb) {
    const model = G.buildModel(robot);
    const c = {
      targets: model.stepCtx.targets.filter((t) => t.actions.some((a) => a.pp)),
      conds: model.stepCtx.conditions,
      swerve: false,
      pp: false,
    };
    const id = (k) => `k-${cb.id}-${k}`;
    const addStep = (type, opts) => () => { cb.steps.push(G.newStep(type, opts ? opts() : {})); changed('rerender'); };
    const firstAction = () => {
      const t = c.targets[0];
      const a = t && t.actions.find((x) => x.pp);
      return { target: t ? t.id : '', action: a ? a.key : '', mode: a && a.finishes && /^sp:/.test(a.key) ? 'finish' : 'time' };
    };
    const key = 'combo:' + cb.id;
    const onButtons = model.bindings.filter((b) => b.target.id === 'combos' && b.action.key === key);
    return [
      itemHead('Combo', cb, 'Several actions in a row from one button. Each step waits for the one before it to finish.', () => deleteCombo(cb), 'combo'),
      sheet('Steps',
        listBlock({
          id: id('steps'), help: [H.combos, H.steps, H.mode].join(' '), items: cb.steps, noun: 'step', card: true, reorder: true,
          empty: 'No steps yet. Add the first one below.',
          row: (st, idx) => stepFields(st, idx, c),
        }),
        h('div', { class: 'add-row' },
          h('button', { class: 'btn add small', type: 'button', disabled: !c.targets.length, title: c.targets.length ? null : 'Add a subsystem first', onclick: addStep('action', firstAction) }, '+ Run an action'),
          h('button', { class: 'btn add small', type: 'button', onclick: addStep('wait') }, '+ Wait'),
          c.conds.length > 0 && h('button', { class: 'btn add small', type: 'button', onclick: addStep('until', () => ({ condition: c.conds[0].key })) }, '+ Wait until'))),
      sheet('Button',
        onButtons.length
          ? h('div', { class: 'taken' }, h('span', null, 'Runs from:'), onButtons.map((b) => h('span', { class: 'chip' }, `${b.ctl.label} ${b.buttonLabel} (${G.WHEN[b.when].label})`)))
          : note('Not on a button yet.'),
        h('button', { class: 'btn small', type: 'button', onclick: () => bindCombo(cb) }, onButtons.length ? 'Add another button' : 'Put it on a button')),
    ];
  }

  /* ------------------------------------------------------------ vision */

  function visionEditor() {
    const V = robot.vision;
    const swerve = !!robot.project.tunerSwerve;
    const id = (k) => 'vis-' + k;
    const parts = [head('Vision', 'AprilTags', 'Limelight cameras see AprilTags to keep the robot\'s position on the field accurate, aim at targets and line up for scoring.')];
    if (!swerve) parts.push(note('AprilTag vision needs the swerve drive from Phoenix Tuner X. Turn it on in Robot settings.', true));
    parts.push(sheet('Limelights',
      listBlock({
        id: id('cams'), help: H.cameras, items: V.cameras, noun: 'camera', card: true,
        empty: 'No cameras yet. Add your Limelight to turn vision on.',
        row: (cam) => [
          mini(`v-${cam.id}-name`, 'Name', textIn(`v-${cam.id}-name`, cam, 'name', { max: 40, placeholder: 'limelight-front' })),
          mini(`v-${cam.id}-mt2`, 'Mode', checkIn(`v-${cam.id}-mt2`, cam, 'megaTag2', 'MegaTag2')),
          mini(`v-${cam.id}-aim`, 'Aiming', checkIn(`v-${cam.id}-aim`, cam, 'aim', 'Use for aiming', {
            after: () => { if (cam.aim) V.cameras.forEach((o) => { if (o !== cam) o.aim = false; }); },
          })),
          mini(`v-${cam.id}-trust`, 'Trust', numIn(`v-${cam.id}-trust`, cam, 'trust', { unit: 'm', step: 0.1, min: 0.05 })),
          mini(`v-${cam.id}-max`, 'Max tag distance', numIn(`v-${cam.id}-max`, cam, 'maxDistance', { unit: 'm', step: 0.5, min: 0.5 })),
        ],
        add: () => {
          const n = V.cameras.length;
          const cam = G.newCamera(n ? 'limelight-' + ['front', 'back', 'left', 'right'][Math.min(n, 3)] : 'limelight');
          if (!n) cam.aim = true;
          V.cameras.push(cam);
        },
        addLabel: 'Add Limelight',
      }),
      note('On each Limelight\'s web page, pick an AprilTag pipeline and set where the camera sits on the robot (Robot Space). Before a match, the cameras also fix which way the robot faces.')));
    parts.push(sheet('Line-up spots',
      listBlock({
        id: id('spots'), help: H.spots, items: V.spots, noun: 'spot', card: true,
        empty: 'No spots yet. Add one to drive to a spot in front of a tag with one button.',
        row: (sp) => [
          mini(`o-${sp.id}-name`, 'Name', textIn(`o-${sp.id}-name`, sp, 'name', { max: 30 })),
          mini(`o-${sp.id}-tags`, 'Tag numbers', textIn(`o-${sp.id}-tags`, sp, 'tags', { placeholder: '6-11, 17-22', max: 60 })),
          mini(`o-${sp.id}-out`, 'Out from the tag', numIn(`o-${sp.id}-out`, sp, 'distance', { unit: 'm', step: 0.05, min: 0 })),
          mini(`o-${sp.id}-left`, 'Left (+) or right (-)', numIn(`o-${sp.id}-left`, sp, 'sideways', { unit: 'm', step: 0.05 })),
        ],
        add: () => V.spots.push(G.newSpot('Spot ' + (V.spots.length + 1))),
        addLabel: 'Add spot',
      }),
      note('Each spot becomes an action for buttons, combos and autos. Test them slowly first.')));

    const model = G.buildModel(robot);
    const zoneTargets = model.subsystems.concat(model.lights, model.combos.actions.length ? [model.combos] : []);
    const zoneActions = (t) => {
      if (!t) return [];
      const T = G.TABLE_TARGETS[t.preset];
      const list = t.kind === 'subsystem' && T ? [['value', `${T.zoneLabel} (${T.unit})`]] : [];
      t.actions.forEach((a) => { if (!a.key.startsWith('sysid:')) list.push([a.key, a.label]); });
      return list;
    };
    parts.push(sheet('Zones',
      listBlock({
        id: id('zones'), help: H.zones, items: V.zones, noun: 'zone', card: true,
        empty: 'No zones yet. Add one to slow down, light up or run something near some tags.',
        row: (z) => {
          const t = zoneTargets.find((x) => x.id === z.runTarget);
          const T = t && G.TABLE_TARGETS[t.preset];
          const zid = (k) => `z-${z.id}-${k}`;
          const ledRule = robot.lights.some((l) => l.rules.some((r) => r.when === 'zone:' + z.id));
          return [
            mini(zid('name'), 'Name', textIn(zid('name'), z, 'name', { max: 30 })),
            mini(zid('tags'), 'Tag numbers', textIn(zid('tags'), z, 'tags', { placeholder: '6-11, 17-22', max: 60 })),
            mini(zid('dist'), 'Within', numIn(zid('dist'), z, 'distance', { unit: 'm', step: 0.1, min: 0.1 })),
            mini(zid('slow'), 'Drive speed inside', numIn(zid('slow'), z, 'slowPct', { unit: '%', step: 5, min: 5, max: 95 })),
            mini(zid('tgt'), 'While inside, run', selectIn(zid('tgt'), z, 'runTarget', [['', 'Nothing']].concat(zoneTargets.map((x) => [x.id, x.label])), {
              after: () => { const opts = zoneActions(zoneTargets.find((x) => x.id === z.runTarget)); z.runAction = opts[0] ? opts[0][0] : ''; },
            })),
            t && mini(zid('act'), 'Action', selectIn(zid('act'), z, 'runAction', zoneActions(t))),
            t && T && z.runAction === 'value' && mini(zid('val'), T.unit === '%' ? 'Power' : cap(T.what),
              numIn(zid('val'), z, 'runValue', { unit: T.unit, step: T.unit === 'RPM' ? 100 : 1 })),
            robot.lights.length > 0 && mini(zid('led'), 'LEDs', h('button', { class: 'btn small', type: 'button', id: zid('led'), onclick: () => zoneLeds(z) },
              ledRule ? 'Edit the LED rule' : 'Light up inside')),
          ];
        },
        onRemove: (z) => {
          const key = 'zone:' + z.id;
          robot.lights.forEach((l) => { l.rules = l.rules.filter((r) => r.when !== key); });
          robot.rumbles = robot.rumbles.filter((x) => x.when !== key);
          dropStepsFor(z.id);
        },
        add: () => V.zones.push(Object.assign(G.newZone('Zone ' + (V.zones.length + 1)), { slowPct: 50 })),
        addLabel: 'Add zone',
      }),
      note('Zones use the robot\'s field position, so they work even when the tag is out of view. Actions run in teleop only, while the robot is inside.')));

    const tableTargets = model.subsystems.filter((s) => G.TABLE_TARGETS[s.preset]);
    parts.push(sheet('Distance tables',
      listBlock({
        id: id('tables'), help: H.tables, items: V.tables, noun: 'table', card: true,
        empty: tableTargets.length ? 'No tables yet. Add one to set a speed, angle or height from the distance to a tag.'
          : 'Add a shooter, elevator, arm or roller first. A table sets one of those.',
        row: (tb) => {
          const sub = tableTargets.find((s) => s.id === tb.target);
          const T = sub && G.TABLE_TARGETS[sub.preset];
          const tid = (k) => `d-${tb.id}-${k}`;
          return [
            mini(tid('name'), 'Name', textIn(tid('name'), tb, 'name', { max: 30 })),
            mini(tid('tags'), 'Tag numbers', textIn(tid('tags'), tb, 'tags', { placeholder: '9, 10', max: 60 })),
            mini(tid('tgt'), 'Sets', selectIn(tid('tgt'), tb, 'target', tableTargets.map((s) => [s.id, `${s.label} ${G.TABLE_TARGETS[s.preset].what}`]))),
            pointsEditor(tb, T ? T.unit : ''),
          ];
        },
        onRemove: (tb) => dropAction('table:' + tb.id),
        add: () => { const t = tableTargets[0]; V.tables.push(G.newTable('Table ' + (V.tables.length + 1), t ? t.id : '')); },
        addDisabled: !tableTargets.length,
        addLabel: 'Add distance table',
      }),
      note('Each table becomes an action like "Shooter: Table 1 (by distance)" for buttons, combos, autos and zones. The dashboard shows its current value under Vision/.')));

    parts.push(sheet('Aiming and lining up',
      grid(
        field(id('aimp'), 'Aim kP', numIn(id('aimp'), V, 'aimP', { step: 0.5, min: 0 }), { hint: 'rad/s per radian off center' }),
        field(id('aimt'), 'Counts as aimed within', numIn(id('aimt'), V, 'aimTolerance', { unit: '°', step: 0.5, min: 0.1 })),
        field(id('alp'), 'Line-up kP', numIn(id('alp'), V, 'alignP', { step: 0.5, min: 0 }), { hint: 'm/s per meter away' }),
        field(id('als'), 'Line-up top speed', numIn(id('als'), V, 'alignMaxSpeed', { unit: 'm/s', step: 0.25, min: 0.1 })),
        field(id('alh'), 'Heading kP', numIn(id('alh'), V, 'headingP', { step: 0.5, min: 0 }), { hint: 'rad/s per radian off' }),
        field(id('alt'), 'Counts as there within', numIn(id('alt'), V, 'alignTolerance', { unit: 'm', step: 0.01, min: 0.005 })),
        field(id('ala'), 'and within', numIn(id('ala'), V, 'alignAngleTolerance', { unit: '°', step: 0.5, min: 0.1 }))),
      note('The driver\'s aim button is set under Controls → Controllers and driving.')));
    return parts;
  }

  /* ------------------------------------------------------------ driver cheat sheet */

  const CHEAT_LEFT = [['leftTrigger', 345, 112], ['leftBumper', 345, 138], ['back', 413, 188], ['leftStick', 372, 196],
    ['povUp', 400, 236], ['povLeft', 386, 250], ['povRight', 414, 250], ['povDown', 400, 264]];
  const CHEAT_RIGHT = [['rightTrigger', 535, 112], ['rightBumper', 535, 138], ['y', 510, 178], ['start', 467, 188],
    ['x', 493, 195], ['b', 527, 195], ['a', 510, 212], ['rightStick', 480, 250]];
  const PS_KEYS = { leftTrigger: 'L2', leftBumper: 'L1', leftStick: 'L3', rightTrigger: 'R2', rightBumper: 'R1',
    y: 'triangle', x: 'square', b: 'circle', a: 'cross', start: 'options', rightStick: 'R3' };

  /** What each button on a controller does: button key -> list of lines. */
  function cheatEntries(model, ctl) {
    const map = new Map();
    const put = (k, text) => { if (!map.has(k)) map.set(k, []); map.get(k).push(text); };
    const verb = { held: 'hold', pressed: 'press', toggle: 'toggle', released: 'let go' };
    model.bindings.filter((b) => b.ctl.id === ctl.id).forEach((b) => put(b.button, `${b.target.label}: ${b.action.label} (${verb[b.when]})`));
    if (model.driveCtl && model.driveCtl.id === ctl.id) {
      const d = model.drive;
      if (d.resetButton !== 'none') put(d.resetButton, 'Reset field heading (press)');
      if (d.brakeButton !== 'none') put(d.brakeButton, 'Lock wheels in an X (hold)');
      if (d.slowButton !== 'none') put(d.slowButton, `Slow mode (hold)`);
      if (d.aimButton && d.aimButton !== 'none') put(d.aimButton, 'Aim at AprilTag (hold)');
    }
    return map;
  }

  function cheatSvg(model, ctl) {
    const ink = '#16202a';
    const muted = '#5d6873';
    const faint = '#b9c2cb';
    const accent = '#c94a0c';
    const shell = '#e9edf1';
    const font = "font-family=\"Barlow, 'Segoe UI', Arial, sans-serif\"";
    const t = (x, y, s, size, weight, fill, anchor) =>
      `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor || 'start'}" ${font}>${esc(s)}</text>`;
    const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const entries = cheatEntries(model, ctl);
    const drives = model.driveCtl && model.driveCtl.id === ctl.id;
    const btnName = (k) => (G.BUTTONS[ctl.type].find((b) => b[0] === k) || [k, k])[1];
    let out = '';
    let height;
    out += t(24, 36, ctl.label, 22, 700, ink);
    out += t(24, 58, `${G.CONTROLLER_TYPES[ctl.type].label} · USB port ${ctl.port}`, 13, 400, muted);

    if (ctl.type === 'joystick') {
      const keys = G.BUTTONS.joystick.map((b) => b[0]);
      const half = Math.ceil(keys.length / 2);
      let y0 = 96;
      if (drives) {
        out += t(24, 92, 'Stick: push to drive, twist to turn', 14, 700, accent);
        y0 = 124;
      }
      keys.forEach((k, idx) => {
        const col = idx < half ? 0 : 1;
        const row = idx < half ? idx : idx - half;
        const x = 24 + col * 430;
        const y = y0 + row * 40;
        const lines = entries.get(k) || [];
        out += t(x, y, btnName(k), 14, 700, lines.length ? ink : faint);
        out += t(x, y + 17, lines.length ? clip(lines.join(' · '), 58) : 'not used', 12, 400, lines.length ? muted : faint);
      });
      height = y0 + half * 40 + 10;
    } else {
      const keyFor = (xk) => {
        if (ctl.type === 'xbox') return xk;
        if (xk === 'back') return ctl.type === 'ps4' ? 'share' : 'create';
        return PS_KEYS[xk] || xk;
      };
      // the controller
      out += `<rect x="318" y="150" width="244" height="132" rx="64" fill="${shell}" stroke="${faint}" stroke-width="2"/>`;
      out += `<ellipse cx="352" cy="270" rx="42" ry="60" fill="${shell}" stroke="${faint}" stroke-width="2"/>`;
      out += `<ellipse cx="528" cy="270" rx="42" ry="60" fill="${shell}" stroke="${faint}" stroke-width="2"/>`;
      out += `<rect x="325" y="160" width="230" height="100" rx="48" fill="${shell}"/>`;
      out += `<rect x="322" y="104" width="46" height="16" rx="7" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<rect x="512" y="104" width="46" height="16" rx="7" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<rect x="322" y="131" width="46" height="13" rx="6" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<rect x="512" y="131" width="46" height="13" rx="6" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<circle cx="372" cy="196" r="16" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<circle cx="480" cy="250" r="16" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<path d="M393 229h14v14h14v14h-14v14h-14v-14h-14v-14h14z" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      [['y', 510, 178], ['x', 493, 195], ['b', 527, 195], ['a', 510, 212]].forEach(([k, x, y]) => {
        out += `<circle cx="${x}" cy="${y}" r="8.5" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
        if (ctl.type === 'xbox') out += t(x, y + 4, k.toUpperCase(), 10, 700, muted, 'middle');
      });
      out += `<rect x="405" y="183" width="16" height="10" rx="5" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      out += `<rect x="459" y="183" width="16" height="10" rx="5" fill="#fff" stroke="${faint}" stroke-width="2"/>`;
      if (ctl.type !== 'xbox') out += `<rect x="410" y="152" width="60" height="26" rx="6" fill="#fff" stroke="${faint}" stroke-width="2"/>`;

      const rows = (slots, side) => slots.forEach(([xk, bx, by], idx) => {
        const k = keyFor(xk);
        const y = 96 + idx * 46;
        const lines = (entries.get(k) || []).slice();
        if (drives && xk === 'leftStick') lines.unshift('Move: drive');
        if (drives && xk === 'rightStick') lines.unshift('Move: turn');
        const used = lines.length > 0;
        let name = btnName(k);
        if (xk === 'leftStick') name = 'Left stick';
        if (xk === 'rightStick') name = 'Right stick';
        const left = side === 'left';
        const tx = left ? 262 : 618;
        const anchor = left ? 'end' : 'start';
        out += `<polyline points="${left ? 268 : 612},${y - 5} ${left ? 290 : 590},${y - 5} ${bx},${by}" fill="none" stroke="${used ? accent : faint}" stroke-width="${used ? 1.5 : 1}"/>`;
        out += `<circle cx="${bx}" cy="${by}" r="3" fill="${used ? accent : faint}"/>`;
        out += t(tx, y, name, 14, 700, used ? ink : faint, anchor);
        if (!used) out += t(tx, y + 16, 'not used', 12, 400, faint, anchor);
        lines.slice(0, 2).forEach((line, n) => {
          const extra = n === 1 && lines.length > 2 ? ` (+${lines.length - 2} more)` : '';
          out += t(tx, y + 16 + n * 14, clip(line, 40 - extra.length) + extra, 12, 400, muted, anchor);
        });
      });
      rows(CHEAT_LEFT, 'left');
      rows(CHEAT_RIGHT, 'right');
      height = 96 + 8 * 46;
      const extras = ctl.type === 'xbox' ? [] : ['PS', 'touchpad'];
      const extraLines = extras.filter((k) => entries.has(k)).map((k) => `${btnName(k)}: ${entries.get(k).join(' · ')}`);
      if (extraLines.length) {
        extraLines.forEach((line, n) => { out += t(24, height + 6 + n * 18, clip(line, 110), 12, 400, muted); });
        height += extraLines.length * 18 + 6;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 880 ${height}" width="880" height="${height}" role="img" aria-label="${esc(ctl.label)} button map">` +
      `<rect width="880" height="${height}" fill="#ffffff"/>${out}</svg>`;
  }

  function cheatSheetEditor() {
    const model = G.buildModel(robot);
    const parts = [head('Controls', 'Driver cheat sheet', 'What every button does, one picture per controller. Download them to print for drive team practice.')];
    if (!model.controllers.length) {
      parts.push(note('Add a controller under Controllers and driving first.', true));
      return parts;
    }
    model.controllers.forEach((ctl) => {
      const svg = cheatSvg(model, ctl);
      const paper = h('div', { class: 'cheat-paper' });
      paper.innerHTML = svg;
      const file = `${baseName()}-${slug(ctl.label) || 'controller'}-buttons.svg`;
      parts.push(sheet(ctl.label,
        h('div', { class: 'cheat-scroll' }, paper),
        h('div', { class: 'confirm-row' },
          h('button', { class: 'btn small', type: 'button', onclick: () => saveFile(file, svg) }, 'Download picture (.svg)'),
          h('span', { class: 'hint' }, 'Open the file in a browser to print it.'))));
    });
    return parts;
  }

  /* ------------------------------------------------------------ lights */

  function colorSelect(id, obj, key, aria) {
    const col = G.LED_COLORS.find((c) => c[0] === obj[key]) || G.LED_COLORS[8];
    return h('div', { class: 'color-pick' },
      h('span', { class: 'swatch', style: `background: rgb(${col[2].join(' ')})`, 'aria-hidden': 'true' }),
      selectIn(id, obj, key, G.LED_COLORS.filter((c) => c[0] !== 'OFF').map((c) => [c[0], c[1]]), { aria }));
  }
  function patternFields(prefix, obj, label) {
    const needsColor = obj.pattern === 'solid' || obj.pattern === 'strobe' || obj.pattern === 'alliance';
    return [
      mini(prefix + '-pat', label || 'Show', selectIn(prefix + '-pat', obj, 'pattern', Object.keys(G.LED_PATTERNS).map((k) => [k, G.LED_PATTERNS[k]]))),
      needsColor ? mini(prefix + '-col', obj.pattern === 'alliance' ? 'Before the alliance is known' : 'Color', colorSelect(prefix + '-col', obj, 'color')) : null,
    ];
  }

  function lightEditor(l) {
    const model = G.buildModel(robot);
    const id = (k) => `l-${l.id}-${k}`;
    const blurbs = {
      candle: 'A CTRE CANdle on the CAN bus. It runs the animations itself, so the roboRIO stays free.',
      blinkin: 'A REV Blinkin on a PWM port. It picks from its own built-in patterns.',
      strip: 'An addressable LED strip (WS2812B style) plugged straight into a roboRIO PWM port.',
    };
    const parts = [itemHead(G.LIGHT_TYPES[l.type].label, l, blurbs[l.type], () => deleteLight(l), 'light')];
    if (l.type === 'candle') {
      parts.push(sheet('Hardware', grid(
        field(id('can'), 'CAN ID', numIn(id('can'), l, 'canId', { step: 1, min: 0, max: 62 }), { help: H.canId }),
        field(id('len'), 'LEDs on the strip', numIn(id('len'), l, 'stripLength', { step: 1, min: 0, max: 392 }), { help: H.stripLen }),
        field(id('onb'), 'CANdle LEDs', checkIn(id('onb'), l, 'includeOnboard', 'Light the 8 on the CANdle too'), { help: H.onboard }),
        field(id('type'), 'Strip type', selectIn(id('type'), l, 'stripType', G.CANDLE_STRIP_TYPES.map((x) => [x, x])), { help: H.stripType }),
        field(id('bri'), 'Brightness', numIn(id('bri'), l, 'brightness', { unit: '%', step: 5, min: 0, max: 100 }), { help: H.brightness }))));
    } else if (l.type === 'blinkin') {
      parts.push(sheet('Hardware',
        grid(field(id('pwm'), 'PWM port', numIn(id('pwm'), l, 'pwmPort', { step: 1, min: 0, max: 9 }), { help: H.pwm })),
        note('The Blinkin can\'t change while the robot is disabled, because the roboRIO turns PWM off. Set its no-signal pattern with the buttons on the Blinkin. It can only flash red, blue, gold or white.')));
    } else {
      parts.push(sheet('Hardware', grid(
        field(id('pwm'), 'PWM port', numIn(id('pwm'), l, 'pwmPort', { step: 1, min: 0, max: 9 }), { help: H.pwm }),
        field(id('len'), 'LEDs on the strip', numIn(id('len'), l, 'stripLength', { step: 1, min: 1, max: 5460 }), { help: H.stripCount }),
        field(id('type'), 'Color order', selectIn(id('type'), l, 'stripType', G.STRIP_ORDERS.map((x) => [x, x])), { help: H.stripType }),
        field(id('bri'), 'Brightness', numIn(id('bri'), l, 'brightness', { unit: '%', step: 5, min: 0, max: 100 }), { help: H.brightness }))));
    }
    const conds = model.conditions.map((c) => [c.key, c.label]);
    parts.push(sheet('Status',
      listBlock({
        id: id('rules'), title: 'Rules, top one first', help: H.rules, items: l.rules, noun: 'rule', card: true, reorder: true,
        empty: 'No rules. The lights always show the "Otherwise" pattern.',
        row: (r) => [mini(`u-${r.id}-when`, 'When', selectIn(`u-${r.id}-when`, r, 'when', conds)), patternFields(`u-${r.id}`, r)],
        add: () => l.rules.push({ id: G.uid('u'), when: conds[0][0], pattern: 'solid', color: 'GREEN' }),
        addLabel: 'Add rule',
      }),
      h('div', { class: 'card-row otherwise' }, h('div', { class: 'card-fields' }, h('div', { class: 'mini' }, h('span', { class: 'mini-label' }, 'Otherwise'), h('span', { class: 'mini-static' }, 'Nothing above is true')), patternFields(id('else'), l.otherwise)))));
    parts.push(sheet('Signals',
      listBlock({
        id: id('sig'), title: 'Button signals', help: H.signals, items: l.signals, noun: 'signal', card: true,
        empty: 'No signals yet.',
        row: (sg) => [mini(`g-${sg.id}-name`, 'Name', textIn(`g-${sg.id}-name`, sg, 'name', { max: 40 })), patternFields(`g-${sg.id}`, sg)],
        add: () => l.signals.push({ id: G.uid('g'), name: 'New Signal', pattern: 'strobe', color: 'PURPLE' }),
        addLabel: 'Add signal',
      })));
    return parts;
  }

  function deleteLight(l) {
    robot.lights = robot.lights.filter((x) => x !== l);
    robot.bindings = robot.bindings.filter((b) => b.target !== l.id);
    dropStepsFor(l.id);
    ui.confirmDelete = null;
    regen();
    select(robot.lights[0] ? { kind: 'light', id: robot.lights[0].id } : { kind: 'add-light' });
    changed();
    toast(`Deleted ${l.name || 'the lights'}.`);
  }

  function addLightEditor() {
    return [
      head('Lights', 'Add lights', 'Pick what your LEDs are plugged into.'),
      h('div', { class: 'cards' }, Object.keys(G.LIGHT_TYPES).map((k) => h('button', {
        class: 'card', type: 'button', id: 'addl-' + k,
        onclick: () => {
          const taken = new Set(robot.lights.map((x) => x.name.toLowerCase()));
          let name = 'LEDs';
          for (let n = 2; taken.has(name.toLowerCase()); n++) name = 'LEDs ' + n;
          const l = G.newLight(k, { name, canId: k === 'candle' ? nextCanId() : undefined });
          if (k !== 'candle') l.pwmPort = nextPort('pwm');
          robot.lights.push(l);
          robot.example = false;
          regen();
          select({ kind: 'light', id: l.id });
          changed();
        },
      }, h('b', null, G.LIGHT_TYPES[k].label), h('span', null, G.LIGHT_TYPES[k].blurb)))),
    ];
  }

  /* ------------------------------------------------------------ wiring sheet */

  function wiringText(model) {
    const lines = ['Bus   ID  Part of             Device'];
    G.wiringRows(model).forEach((d) => lines.push(`${d.bus.toUpperCase().padEnd(5)} ${String(d.id).padStart(2)}  ${d.owner.slice(0, 18).padEnd(18)}  ${d.what}`));
    if (robot.project.tunerSwerve && String(robot.project.swerveIds || '').trim()) lines.push(`CAN   ${robot.project.swerveIds}  Swerve drive (Tuner X)`);
    return lines.join('\n');
  }
  function wiringEditor() {
    const model = ui.model || G.buildModel(robot);
    const rows = G.wiringRows(model);
    const keyOf = (d) => d.bus + ':' + d.id;
    const counts = new Map();
    rows.forEach((d) => counts.set(keyOf(d), (counts.get(keyOf(d)) || 0) + 1));
    const p = robot.project;
    return [
      head('Robot', 'Wiring sheet', 'Every CAN ID and port in one list. Use it when wiring the robot or checking IDs in the pit.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'wiring' },
        h('thead', null, h('tr', null, h('th', null, 'Port'), h('th', null, 'Device'), h('th', null, 'Part of'))),
        h('tbody', null,
          rows.map((d) => h('tr', { class: counts.get(keyOf(d)) > 1 ? 'bad' : null },
            h('td', null, tag(d.bus, d.id)), h('td', null, d.what), h('td', null, d.owner))),
          p.tunerSwerve && String(p.swerveIds || '').trim() && h('tr', null, h('td', null, h('span', { class: 'tag can' }, h('span', { class: 'bus' }, 'CAN'), p.swerveIds)), h('td', null, 'Swerve drive'), h('td', null, 'Tuner X'))))),
      rows.length ? null : note('Nothing to wire yet. Add a subsystem to start.'),
      h('div', { class: 'confirm-row' },
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => {
            const text = wiringText(model);
            navigator.clipboard.writeText(text).then(() => toast('Copied the wiring list')).catch(() => toast("Couldn't copy here. The list is also in README.txt in the zip."));
          },
        }, 'Copy as text'),
        h('span', { class: 'hint' }, 'The same list is in README.txt in the code download.')),
    ];
  }

  /* ------------------------------------------------------------ output pane */

  const KW = new Set(('abstract boolean break case catch class continue default do double else enum extends final finally ' +
    'for if implements import instanceof int interface long new package private protected public return static super ' +
    'switch this throw throws try var void while true false null').split(' '));
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

  function highlightJava(src) {
    let inBlock = false;
    return src.split('\n').map((line) => {
      let out = '';
      let i = 0;
      while (i < line.length) {
        if (inBlock) {
          const end = line.indexOf('*/', i);
          if (end < 0) { out += span('c', line.slice(i)); i = line.length; } else { out += span('c', line.slice(i, end + 2)); i = end + 2; inBlock = false; }
          continue;
        }
        const rest = line.slice(i);
        let m;
        if (rest.startsWith('//')) { out += span('c', rest); break; }
        if (rest.startsWith('/*')) {
          const end = rest.indexOf('*/', 2);
          if (end < 0) { out += span('c', rest); inBlock = true; break; }
          out += span('c', rest.slice(0, end + 2)); i += end + 2; continue;
        }
        if ((m = /^"(?:\\.|[^"\\])*"/.exec(rest))) { out += span('s', m[0]); i += m[0].length; continue; }
        if ((m = /^@[A-Za-z]\w*/.exec(rest))) { out += span('a', m[0]); i += m[0].length; continue; }
        if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
          const w = m[0];
          if (KW.has(w)) out += span('k', w);
          else if (/^k[A-Z0-9]/.test(w) || (/^[A-Z][A-Z0-9_]+$/.test(w))) out += span('q', w);
          else if (/^[A-Z]/.test(w)) out += span('t', w);
          else out += esc(w);
          i += w.length; continue;
        }
        if ((m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[dDfFlL]?/.exec(rest))) { out += span('n', m[0]); i += m[0].length; continue; }
        out += esc(line[i]); i++;
      }
      return '<span class="ln">' + out + '</span>';
    }).join('');
  }
  function plainLines(src) {
    return src.split(/\r?\n/).map((l) => '<span class="ln">' + esc(l) + '</span>').join('');
  }

  function renderOutput() {
    const files = ui.files;
    const file = files.find((f) => f.name === ui.file) || files.find((f) => f.name === fileFor(ui.sel)) || files[0];
    if (file) ui.file = file.name;
    const tabs = $('tabs');
    tabs.replaceChildren(...files.map((f) => h('button', {
      class: 'tab', role: 'tab', type: 'button', id: 'tab-' + f.name, 'aria-selected': f === file ? 'true' : 'false',
      onclick: () => { ui.file = f.name; renderOutput(); saveUi(); },
    }, f.name)));
    const activeTab = file && $('tab-' + file.name);
    if (activeTab) {
      const box = tabs.getBoundingClientRect();
      const r = activeTab.getBoundingClientRect();
      if (r.left < box.left || r.right > box.right) tabs.scrollLeft += r.left - box.left - 24;
    }
    const code = $('code');
    const inner = $('code-inner');
    if (ui.error) {
      code.classList.add('plain');
      inner.innerHTML = plainLines("Something went wrong while writing the code:\n" + String(ui.error && ui.error.message || ui.error));
    } else if (file) {
      const java = file.name.endsWith('.java');
      code.classList.toggle('plain', !java);
      inner.innerHTML = java ? highlightJava(file.content) : plainLines(file.content);
    } else inner.innerHTML = '';
    if (ui.lastFile !== ui.file) { code.scrollTop = 0; ui.lastFile = ui.file; }
    renderChecks();
  }

  function renderChecks() {
    const issues = (ui.model && ui.model.issues) || [];
    const errors = issues.filter((x) => x.level === 'error').length;
    const warns = issues.filter((x) => x.level === 'warn').length;
    const notes = issues.length - errors - warns;
    const st = $('status');
    let text;
    if (ui.error) text = "Couldn't write the code";
    else if (errors) text = plural(errors, 'problem') + (warns ? ' · ' + plural(warns, 'warning') : '');
    else if (warns) text = plural(warns, 'warning');
    else text = 'No problems' + (notes ? ' · ' + plural(notes, 'note') : '');
    st.className = 'status ' + (ui.error || errors ? 'error' : warns ? 'warn' : 'ok');
    st.textContent = text;
    st.setAttribute('aria-expanded', String(ui.checksOpen && issues.length > 0));
    const box = $('checks');
    box.hidden = !ui.checksOpen || !issues.length;
    const order = { error: 0, warn: 1, info: 2 };
    box.replaceChildren(...issues.slice().sort((a, b) => order[a.level] - order[b.level]).map((x) => h('button', {
      class: 'check-item', type: 'button', onclick: () => { if (x.target) select(x.target.kind === 'controls' ? { kind: x.text.includes('button') ? 'bindings' : 'controllers' } : x.target); },
    }, h('span', { class: 'lv ' + x.level }, x.level === 'error' ? 'Problem' : x.level === 'warn' ? 'Check' : 'Note'), h('span', null, x.text))));
  }

  /* ------------------------------------------------------------ files: save, open, download, copy */

  const downloadsReady = (window.claude && typeof window.claude.use === 'function')
    ? Promise.resolve(window.claude.use('downloads')).catch(() => null)
    : Promise.resolve(null);

  async function saveFile(filename, data) {
    const dl = await downloadsReady;
    if (dl) {
      try {
        await dl.save({ filename, data });
        toast('Saved ' + filename);
        return true;
      } catch (err) {
        const code = err && err.code;
        if (code === 'declined') toast('Download canceled.');
        else if (code === 'rate_limited') toast('Another download is waiting for an answer. Finish that one first.');
        else toast("Downloads aren't available here. Use Copy file on each file instead.");
        return false;
      }
    }
    if (!window.claude) {
      // Opened as a plain web page (a saved copy, GitHub Pages...): use a normal download link.
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Saved ' + filename);
      return true;
    }
    toast("Downloads aren't available in this view. Use Copy file on each file instead.");
    return false;
  }

  function robotJson() {
    const copy = JSON.parse(JSON.stringify(robot));
    delete copy.example;
    copy.savedAt = new Date().toISOString();
    return JSON.stringify(copy, null, 2);
  }
  function baseName() { return slug(robot.project.robotName) || 'robot'; }

  async function saveRobotFile() {
    await saveFile(baseName() + '.robot.json', robotJson());
  }

  async function downloadZip() {
    if (typeof window.JSZip === 'undefined') {
      toast("The zip tool didn't load. Check the internet connection, or use Copy file.");
      return;
    }
    regen();
    const zip = new window.JSZip();
    ui.files.forEach((f) => zip.file(f.path, f.content));
    zip.file(baseName() + '.robot.json', robotJson());
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const ok = await saveFile(baseName() + '-code.zip', blob);
    const errors = (ui.model.issues || []).filter((x) => x.level === 'error').length;
    if (ok && errors) setTimeout(() => toast(`Fix the ${plural(errors, 'problem')} listed above the code before deploying.`), 1800);
  }

  async function copyCurrentFile() {
    const f = ui.files.find((x) => x.name === ui.file);
    if (!f) return;
    try {
      await navigator.clipboard.writeText(f.content);
      toast('Copied ' + f.name);
    } catch (err) {
      const range = document.createRange();
      range.selectNodeContents($('code-inner'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      toast('Press Ctrl+C (or Cmd+C) to copy the selected code.');
    }
  }

  async function openRobotFile(file) {
    try {
      const text = await file.text();
      const data = migrate(JSON.parse(text));
      data.example = false;
      robot = data;
      ui.sel = robot.subsystems[0] ? { kind: 'subsystem', id: robot.subsystems[0].id } : { kind: 'robot' };
      ui.help.clear();
      regen();
      select(ui.sel);
      renderTop();
      save();
      toast('Opened ' + (robot.project.robotName || file.name));
    } catch (err) {
      toast(err instanceof SyntaxError ? "That file isn't a robot file. Pick a .robot.json file saved from this app." : err.message);
    }
  }

  function startNewRobot() {
    robot = G.newRobot();
    robot.example = false;
    ui.confirmReset = false;
    $('new-pop').hidden = true;
    regen();
    select({ kind: 'robot' });
    renderTop();
    save();
    toast('Started a new robot. Name it, then add subsystems with +.');
    const n = $('p-name');
    if (n) { n.focus(); n.select(); }
  }
  function loadExample() {
    robot = migrate(G.exampleRobot());
    robot.example = true;
    ui.confirmReset = false;
    regen();
    select({ kind: 'subsystem', id: robot.subsystems[0].id });
    renderTop();
    save();
  }

  /* ------------------------------------------------------------ boot */

  function wire() {
    const pop = $('new-pop');
    $('btn-new').addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) $('new-yes').focus(); });
    $('new-yes').addEventListener('click', startNewRobot);
    $('new-save').addEventListener('click', saveRobotFile);
    $('new-no').addEventListener('click', () => { pop.hidden = true; });
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { pop.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
    $('btn-open').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) openRobotFile(f);
      e.target.value = '';
    });
    $('btn-save').addEventListener('click', saveRobotFile);
    $('btn-zip').addEventListener('click', downloadZip);
    $('btn-zip2').addEventListener('click', downloadZip);
    $('btn-copy').addEventListener('click', copyCurrentFile);
    $('status').addEventListener('click', () => { ui.checksOpen = !ui.checksOpen; renderChecks(); });
    downloadsReady.then((dl) => {
      if (!dl && window.claude) {
        ['btn-zip', 'btn-zip2', 'btn-save'].forEach((id) => { $(id).title = "Downloads aren't available in this view"; });
      }
    });
  }

  function boot(data) {
    const fromHot = data && data.robot;
    let saved = fromHot || readStore(KEY_ROBOT);
    try { robot = saved ? migrate(saved) : null; } catch (e) { robot = null; }
    if (!robot) {
      robot = migrate(G.exampleRobot());
      robot.example = true;
      ui.sel = { kind: 'subsystem', id: robot.subsystems[0].id };
    } else {
      const savedUi = (data && data.ui) || readStore(KEY_UI);
      if (savedUi && savedUi.sel) ui.sel = savedUi.sel;
      if (savedUi && savedUi.file) ui.file = savedUi.file;
    }
    saved = null;
    wire();
    regen();
    const f = fileFor(ui.sel);
    if (f) ui.file = f;
    renderTop();
    renderRail();
    renderEditor(true);
    renderOutput();
  }

  try {
    if (window.claude && window.claude.hot && typeof window.claude.hot.snapshot === 'function') {
      window.claude.hot.snapshot(() => ({ robot, ui: { sel: ui.sel, file: ui.file } }));
    }
  } catch (e) { /* hot reload is optional */ }
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot((hot && hot.data) || {});
})();
