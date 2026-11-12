// Generates Java for a set of test robots so they can be compiled with javac.
// Usage: node tools/test.js <outDir>
// (Run with WPILib's VS Code: ELECTRON_RUN_AS_NODE=1 Code.exe tools/test.js <outDir>)
'use strict';
const fs = require('fs');
const path = require('path');
const G = require('../src/gen.js');

const outDir = process.argv[2];
const isMain = require.main === module;
if (isMain && !outDir) { console.error('usage: test.js <outDir>'); process.exit(1); }

const sub = (preset, name, motor, canId, extra) => Object.assign(G.newSubsystem(preset, { name, motor, canId }), extra || {});
const ctl = G.newController;
const bind = (c, button, when, target, action) => ({ id: G.uid('b'), controllerId: c.id, button, when, target: target.id, action });
const st = (type, extra) => Object.assign(G.newStep(type), extra || {});

function allCtre() {
  const r = G.newRobot();
  r.project.robotName = 'All CTRE';
  r.project.teamNumber = '9999';
  r.project.ctreBus = 'canivore';
  r.project.phoenixPro = true;
  r.project.swerveIds = '1-12';
  r.drive.sysId = true;
  const ps5 = ctl('Operator', 'ps5', 1);
  r.controllers.push(ps5);
  const roller = sub('roller', 'Indexer', 'krakenX44', 20, {
    sensor: { type: 'canrange', dio: 0, activeLow: true, canId: 40, distance: 0.08 },
    followers: [{ id: 'f1', canId: 21, opposite: false }, { id: 'f2', canId: 22, opposite: true }],
  });
  const fly = sub('flywheel', 'Shooter', 'krakenX60', 23, { followers: [{ id: 'f3', canId: 24, opposite: true }], gearRatio: 0.8 });
  const elev = sub('elevator', 'Elevator', 'falcon500', 25, { profile: false, limitSwitch: { enabled: true, dio: 3, normallyOpen: false } });
  const armC = sub('arm', 'Wrist', 'krakenX60', 26, { encoder: 'cancoder', cancoderId: 41, encoderOffset: 0.123, encoderInverted: true });
  const armD = sub('arm', 'Pivot', 'krakenX60', 27, { encoder: 'throughboreDio', encoderDio: 4 });
  const armB = sub('arm', 'Hood', 'krakenX44', 28, { encoder: 'builtin', startAngle: 15, profile: false });
  const climb = sub('climber', 'Climber', 'falcon500', 29);
  r.subsystems = [roller, fly, elev, armC, armD, armB, climb];
  const light = G.newLight('blinkin', { name: 'Status Lights' });
  light.pwmPort = 1;
  light.rules = [
    { id: 'u1', when: 'auto', pattern: 'rainbow', color: 'RED' },
    { id: 'u2', when: 'atspeed:' + fly.id, pattern: 'strobe', color: 'GREEN' },
    { id: 'u3', when: 'piece:' + roller.id, pattern: 'solid', color: 'ORANGE' },
  ];
  light.otherwise = { pattern: 'off', color: 'WHITE' };
  r.lights = [light];
  const d = r.controllers[0];
  r.bindings = [
    bind(ps5, 'cross', 'held', roller, 'act:' + roller.actions[0].id),
    bind(ps5, 'R2', 'toggle', fly, 'speed:' + fly.speeds[0].id),
    bind(ps5, 'L2', 'pressed', fly, 'stop'),
    bind(ps5, 'triangle', 'pressed', elev, 'sp:' + elev.setpoints[2].id),
    bind(ps5, 'circle', 'released', armC, 'sp:' + armC.setpoints[1].id),
    bind(ps5, 'povLeft', 'held', armD, 'jogDown'),
    bind(ps5, 'options', 'pressed', armD, 'zero'),
    bind(ps5, 'create', 'pressed', armB, 'zero'),
    bind(ps5, 'touchpad', 'pressed', elev, 'zero'),
    bind(d, 'a', 'held', climb, 'act:' + climb.actions[0].id),
    bind(d, 'b', 'pressed', climb, 'zero'),
    bind(d, 'y', 'held', light, 'signal:' + light.signals[0].id),
  ];
  // Autos: every step type and action mode, with PathPlanner on.
  const two = G.newRoutine('Two Piece');
  two.steps = [
    st('path', { pathName: 'Start to Reef', resetPose: true }),
    st('action', { target: elev.id, action: 'sp:' + elev.setpoints[2].id, mode: 'finish' }),
    st('action', { target: roller.id, action: 'act:' + roller.actions[1].id, mode: 'time', seconds: 0.4 }),
    st('action', { target: fly.id, action: 'speed:' + fly.speeds[0].id, mode: 'background' }),
    st('until', { condition: 'atspeed:' + fly.id, seconds: 2 }),
    st('until', { condition: 'piece:' + roller.id, seconds: 1.5 }),
    st('until', { condition: 'attarget:' + armC.id, seconds: 1 }),
    st('wait', { seconds: 0.3 }),
    st('drive', { direction: 'left', speed: 1, seconds: 1 }),
    st('path', { pathName: 'Reef to Station.path', resetPose: false }),
    st('action', { target: roller.id, action: 'act:' + roller.actions[0].id, mode: 'finish' }),
    st('action', { target: light.id, action: 'signal:' + light.signals[0].id, mode: 'time', seconds: 1 }),
    st('action', { target: armB.id, action: 'zero', mode: 'finish' }),
  ];
  const empty = G.newRoutine('Empty');
  const bad = G.newRoutine('Bad Steps');
  bad.resetHeading = false;
  bad.steps = [
    st('path', { pathName: '   ' }),
    st('action', { target: 'gone', action: 'x' }),
    st('action', { target: fly.id, action: 'speed:' + fly.speeds[1].id, mode: 'finish' }),
    st('until', { condition: 'piece:nope' }),
    { id: 'zz', type: 'teleport' },
  ];
  r.autos.routines = [two, empty, bad];
  r.autos.defaultAuto = two.id;
  r.autos.translationP = 8.5;

  // Pneumatics on a CTRE PCM, two Limelights, combos, and every testing tool.
  Object.assign(r.project, { liveTuning: true, sysId: true, simulation: true, pneumaticsModule: 'ctrepcm', pneumaticsCanId: 15 });
  const claw = sub('piston', 'Claw', null, 0, { solenoid: 'double', forwardChannel: 0, reverseChannel: 1, startState: 'extended', extendName: 'Open', retractName: 'Close' });
  const pusher = sub('piston', 'Pusher', null, 0, { solenoid: 'single', channel: 2 });
  r.subsystems.push(claw, pusher);
  const front = G.newCamera('limelight-front');
  front.aim = true;
  const back = G.newCamera('limelight-back');
  back.megaTag2 = false;
  back.trust = 1.2;
  const reefLeft = Object.assign(G.newSpot('Reef Left'), { tags: '6-11, 17-22', distance: 0.45, sideways: 0.17 });
  const station = Object.assign(G.newSpot('Station'), { tags: '1, 2, 12, 13' });
  const nowhere = Object.assign(G.newSpot('Nowhere'), { tags: '' });
  r.vision.cameras = [front, back];
  r.vision.spots = [reefLeft, station, nowhere];
  r.drive.aimButton = 'leftTrigger';
  const scoreReef = G.newCombo('Score Reef');
  scoreReef.steps = [
    st('action', { target: 'vision', action: 'spot:' + reefLeft.id, mode: 'finish' }),
    st('action', { target: claw.id, action: 'extend', mode: 'finish' }),
    st('until', { condition: 'vision:aimed', seconds: 1 }),
    st('until', { condition: 'extended:' + claw.id, seconds: 1 }),
    st('wait', { seconds: 0.2 }),
    st('action', { target: claw.id, action: 'toggle', mode: 'time', seconds: 0.2 }),
    st('action', { target: 'vision', action: 'aim', mode: 'finish' }),
    st('drive', { direction: 'forward' }),
  ];
  r.combos = [scoreReef];
  r.bindings.push(
    bind(ps5, 'L1', 'pressed', { id: 'combos' }, 'combo:' + scoreReef.id),
    bind(d, 'rightStick', 'held', { id: 'vision' }, 'aim'),
    bind(ps5, 'R1', 'held', elev, 'sysid:QuasistaticForward'),
    bind(ps5, 'povRight', 'held', fly, 'sysid:DynamicReverse'),
    bind(ps5, 'povUp', 'pressed', pusher, 'extend'));
  two.steps.push(
    st('action', { target: 'combos', action: 'combo:' + scoreReef.id, mode: 'finish' }),
    st('action', { target: 'vision', action: 'spot:' + station.id, mode: 'finish' }),
    st('until', { condition: 'vision:target', seconds: 1 }));
  light.rules.push(
    { id: 'u4', when: 'vision:target', pattern: 'solid', color: 'GREEN' },
    { id: 'u5', when: 'extended:' + claw.id, pattern: 'solid', color: 'BLUE' });

  // AprilTag zones and distance tables on CTRE mechanisms, plus broken ones that get skipped.
  const nearReef = Object.assign(G.newZone('Near Reef Zone'), { tags: '6-11', distance: 1.2, slowPct: 35 });
  const shotZone = Object.assign(G.newZone('Shot Zone'), { tags: '10', distance: 3, runTarget: fly.id, runAction: 'value', runValue: 3200 });
  const liftZone = Object.assign(G.newZone('Lift'), { tags: '7', distance: 1, runTarget: elev.id, runAction: 'value', runValue: 12 });
  const feedZone = Object.assign(G.newZone('Feed'), { tags: '1, 2', distance: 1.5, slowPct: 60, runTarget: roller.id, runAction: 'value', runValue: -40 });
  const signalZone = Object.assign(G.newZone('Signal'), { tags: '12', distance: 1, runTarget: light.id, runAction: 'signal:' + light.signals[0].id });
  const comboZone = Object.assign(G.newZone('Zone'), { tags: '13', distance: 1, runTarget: 'combos', runAction: 'combo:' + scoreReef.id });
  const brokenZone = Object.assign(G.newZone('Broken'), { tags: '', distance: 1 });
  const ghostZone = Object.assign(G.newZone('Ghost'), { tags: '3', runTarget: 'gone', runAction: 'x' });
  const shotTable = Object.assign(G.newTable('Shot Speed Table', fly.id), { tags: '4, 7' });
  shotTable.points = [{ id: 'p1', distance: 3, value: 3800 }, { id: 'p2', distance: 1, value: 2500 }, { id: 'p3', distance: 2, value: 3000 }];
  const hoodTable = Object.assign(G.newTable('Hood Angle', armB.id), { tags: '4 7' });
  hoodTable.points[0].value = 20;
  hoodTable.points[1].value = 45;
  const elevTable = Object.assign(G.newTable('Lift Height', elev.id), { tags: '7' });
  const rollTable = Object.assign(G.newTable('Feed Rate', roller.id), { tags: '1' });
  const badTable = Object.assign(G.newTable('No Target', climb.id), { tags: '1' });
  const emptyTable = Object.assign(G.newTable('Empty', fly.id), { tags: '1' });
  emptyTable.points = [];
  r.vision.zones = [nearReef, shotZone, liftZone, feedZone, signalZone, comboZone, brokenZone, ghostZone];
  r.vision.tables = [shotTable, hoodTable, elevTable, rollTable, badTable, emptyTable];
  r.bindings.push(bind(ps5, 'R3', 'held', fly, 'table:' + shotTable.id), bind(ps5, 'L3', 'held', armB, 'table:' + hoodTable.id));
  scoreReef.steps.push(st('action', { target: roller.id, action: 'table:' + rollTable.id, mode: 'time', seconds: 0.5 }));
  two.steps.push(
    st('action', { target: elev.id, action: 'table:' + elevTable.id, mode: 'background' }),
    st('until', { condition: 'zone:' + nearReef.id, seconds: 2 }));
  light.rules.push({ id: 'u6', when: 'zone:' + nearReef.id, pattern: 'strobe', color: 'YELLOW' });
  // PathPlanner paths with actions along them: every kind of spot, plus broken ones.
  const reef = Object.assign(G.examplePath(), {
    rotationTargets: [{ waypointRelativePos: 0.5, rotationDegrees: 90 }, { waypointRelativePos: 1.5, rotationDegrees: -170 }],
    constraintZones: [{ name: 'Slow', minWaypointRelativePos: 0.8, maxWaypointRelativePos: 1.4, constraints: { maxVelocity: 1, maxAcceleration: 2, maxAngularVelocity: 360, maxAngularAcceleration: 720, nominalVoltage: 12, unlimited: false } }],
    pointTowardsZones: [{ name: 'Look', fieldPosition: { x: 4.6, y: 4.0 }, rotationOffset: 0, minWaypointRelativePos: 1.6, maxWaypointRelativePos: 1.9 }],
    eventMarkers: [{ name: 'From PathPlanner', waypointRelativePos: 0.9, endWaypointRelativePos: 1.7, command: { type: 'named', data: { name: 'Indexer Run In' } } }],
  });
  r.paths = [{ id: 'n1', name: 'Start to Reef', data: reef }, { id: 'n2', name: 'Broken', data: { waypoints: [] } }];
  const sp = G.newPathSpot;
  two.steps[0].spots = [
    sp('drive', { pos: 0.1, target: roller.id, action: 'act:' + roller.actions[0].id, until: 'spot', endPos: 0.6 }),
    sp('drive', { pos: 0.3, target: fly.id, action: 'speed:' + fly.speeds[0].id, until: 'keep' }),
    sp('drive', { pos: 0.4, target: light.id, action: 'signal:' + light.signals[0].id, until: 'time', seconds: 0.7 }),
    sp('stop', { pos: 0.5, target: elev.id, action: 'sp:' + elev.setpoints[1].id, mode: 'finish' }),
    sp('stop', { pos: 0.5, do: 'wait', seconds: 0.25 }),
    sp('drive', { pos: 0.6, target: armB.id, action: 'table:' + hoodTable.id, until: 'spot', endPos: 1.5 }),
    sp('stop', { pos: 1, do: 'until', condition: 'atspeed:' + fly.id, seconds: 1.5 }),
    sp('stop', { pos: 1.25, target: 'combos', action: 'combo:' + scoreReef.id, mode: 'finish' }),
    sp('drive', { pos: 1.3, target: claw.id, action: 'toggle', until: 'pathEnd' }),
    sp('stop', { pos: 2, target: roller.id, action: 'act:' + roller.actions[1].id, mode: 'finish' }),
    sp('stop', { pos: 0, target: pusher.id, action: 'extend', mode: 'finish' }),
    sp('drive', { pos: 0.7, target: 'vision', action: 'aim', until: 'pathEnd' }),
    sp('drive', { pos: 1.8, target: fly.id, action: 'stop', until: 'spot', endPos: 1.1 }),
    sp('stop', { pos: 2.5, do: 'wait' }),
    sp('stop', { pos: 'x', do: 'wait' }),
  ];
  two.steps.find((x) => x.pathName === 'Reef to Station.path').spots = [sp('stop', { pos: 1, do: 'wait', seconds: 0.5 })];
  r.rumbles = [
    G.newRumble(ps5.id, 'atspeed:' + fly.id),
    Object.assign(G.newRumble(d.id, 'zone:' + nearReef.id), { seconds: 1, strength: 100 }),
    G.newRumble(d.id, 'disabled'),
    G.newRumble('nope', 'auto'),
  ];
  return r;
}

/** Swerve with REV mechanisms: every zone and table method on SPARKs, and zones with no slow button. */
function visionRev() {
  const r = G.newRobot();
  r.project.robotName = 'Vision REV';
  r.drive.slowButton = 'none';
  const d = r.controllers[0];
  const roller = sub('roller', 'Intake', 'neo550', 30, { sensor: { type: 'dio', dio: 1, activeLow: true, canId: 0, distance: 0.1 } });
  const fly = sub('flywheel', 'Shooter', 'neoVortex', 31);
  const elev = sub('elevator', 'Elevator', 'neo', 33);
  const arm = sub('arm', 'Arm', 'neo', 35, { encoder: 'throughboreSpark' });
  r.subsystems = [roller, fly, elev, arm];
  const leds = G.newLight('candle', { name: 'LEDs', canId: 9 });
  r.lights = [leds];
  r.vision.cameras = [G.newCamera('limelight')];
  const slow = Object.assign(G.newZone('Slow'), { tags: '1-32', distance: 0.8, slowPct: 40 });
  const spin = Object.assign(G.newZone('Spin Up'), { tags: '9, 10', distance: 4, runTarget: fly.id, runAction: 'speed:' + fly.speeds[0].id });
  const armZone = Object.assign(G.newZone('Arm Up'), { tags: '9', distance: 2, runTarget: arm.id, runAction: 'value', runValue: 60 });
  const numZone = Object.assign(G.newZone('123'), { tags: '1', distance: 2, runTarget: roller.id, runAction: 'value', runValue: 75 });
  const elevZone = Object.assign(G.newZone('Elevator'), { tags: '2', distance: 2, runTarget: elev.id, runAction: 'value', runValue: 20 });
  r.vision.zones = [slow, spin, armZone, numZone, elevZone];
  const tables = [
    Object.assign(G.newTable('Shooter RPM', fly.id), { tags: '9-10' }),
    Object.assign(G.newTable('Arm Angle', arm.id), { tags: '9' }),
    Object.assign(G.newTable('Elevator Height', elev.id), { tags: '9' }),
    Object.assign(G.newTable('Intake', roller.id), { tags: '9' }),
  ];
  r.vision.tables = tables;
  leds.rules = [{ id: 'q1', when: 'zone:' + slow.id, pattern: 'solid', color: 'RED' }];
  r.rumbles = [G.newRumble(d.id, 'piece:' + roller.id)];
  r.bindings = [
    bind(d, 'rightTrigger', 'held', fly, 'table:' + tables[0].id),
    bind(d, 'x', 'held', arm, 'table:' + tables[1].id),
    bind(d, 'y', 'toggle', elev, 'table:' + tables[2].id),
    bind(d, 'b', 'held', roller, 'table:' + tables[3].id),
  ];
  const auto = G.newRoutine('Table Shot');
  auto.steps = [
    st('action', { target: fly.id, action: 'table:' + tables[0].id, mode: 'background' }),
    st('until', { condition: 'zone:' + spin.id, seconds: 1 }),
    st('action', { target: arm.id, action: 'table:' + tables[1].id, mode: 'time', seconds: 1 }),
  ];
  // A REV robot with a path action on each kind of mechanism.
  r.paths = [{ id: 'p1', name: 'Grab', data: G.examplePath(), fromApp: true }];
  const grab = G.newRoutine('Grab and Shoot');
  grab.steps = [Object.assign(G.newStep('path', { pathName: 'Grab', firstPath: true }), {
    spots: [
      G.newPathSpot('drive', { pos: 0.5, target: roller.id, action: 'table:' + tables[3].id, until: 'pathEnd' }),
      G.newPathSpot('drive', { pos: 0.2, target: arm.id, action: 'sp:' + arm.setpoints[1].id, until: 'keep' }),
      G.newPathSpot('stop', { pos: 1.5, target: fly.id, action: 'speed:' + fly.speeds[0].id, mode: 'time', seconds: 0.8 }),
    ],
  })];
  r.autos.routines = [auto, grab];
  return r;
}

function allRev() {
  const r = G.newRobot();
  r.project.robotName = 'All REV';
  r.project.tunerSwerve = false;
  r.controllers = [ctl('Gunner', 'joystick', 0), ctl('Driver', 'ps4', 2)];
  const roller = sub('roller', 'Floor Intake', 'neo550', 30);
  roller.actions.push(G.newAction('Spit Fast!', -100, false));
  const fly = sub('flywheel', 'Shooter', 'neoVortex', 31, { vortexController: 'sparkmax', followers: [{ id: 'g1', canId: 32, opposite: true }] });
  const elev = sub('elevator', 'Lift', 'neo', 33, { followers: [{ id: 'g2', canId: 34, opposite: true }], limitSwitch: { enabled: true, dio: 5, normallyOpen: true }, travelMultiplier: 2 });
  const armFlex = sub('arm', 'Arm', 'neoVortex', 35, { encoder: 'throughboreSpark', encoderOffset: 0.61 });
  const armMax = sub('arm', 'Wrist', 'neo', 36, { encoder: 'throughboreSpark' });
  const armCc = sub('arm', 'Pivot', 'neo', 37, { encoder: 'cancoder', cancoderId: 42 });
  const armDio = sub('arm', 'Hood', 'neo550', 38, { encoder: 'throughboreDio', encoderDio: 6, profile: false });
  const armBuilt = sub('arm', 'Flipper', 'neo', 39, { encoder: 'builtin' });
  const climb = sub('climber', 'Climber', 'neo550', 43, { softLimits: { enabled: true, min: -5, max: 80 } });
  r.subsystems = [roller, fly, elev, armFlex, armMax, armCc, armDio, armBuilt, climb];
  const strip = G.newLight('strip', { name: 'Underglow' });
  strip.stripType = 'RGB';
  strip.rules = [{ id: 'v1', when: 'moving:' + elev.id, pattern: 'strobe', color: 'BLUE' }, { id: 'v2', when: 'teleop', pattern: 'alliance', color: 'PINK' }];
  r.lights = [strip];
  const [gunner, driver] = r.controllers;
  r.bindings = [
    bind(gunner, 'button1', 'held', roller, 'act:' + roller.actions[2].id),
    bind(gunner, 'button7', 'pressed', elev, 'sp:' + elev.setpoints[1].id),
    bind(gunner, 'povUp', 'held', armFlex, 'jogUp'),
    bind(gunner, 'button11', 'pressed', armCc, 'zero'),
    bind(driver, 'square', 'pressed', armBuilt, 'zero'),
    bind(driver, 'share', 'pressed', fly, 'speed:' + fly.speeds[1].id),
    bind(driver, 'PS', 'held', strip, 'signal:' + strip.signals[0].id),
  ];
  // Autos without a swerve drive: drive and path steps get skipped with a warning.
  const shoot = G.newRoutine('Shoot Preload');
  shoot.steps = [
    st('action', { target: fly.id, action: 'speed:' + fly.speeds[0].id, mode: 'background' }),
    st('until', { condition: 'atspeed:' + fly.id, seconds: 2 }),
    st('action', { target: roller.id, action: 'act:' + roller.actions[0].id, mode: 'time', seconds: 1 }),
    st('action', { target: fly.id, action: 'stop', mode: 'finish' }),
    st('action', { target: elev.id, action: 'zero', mode: 'finish' }),
    st('until', { condition: 'attarget:' + elev.id, seconds: 1 }),
    st('drive', { direction: 'forward' }),
    st('path', { pathName: 'X' }),
  ];
  r.autos.routines = [shoot];

  // REV Pneumatic Hub with an analog pressure sensor, tuning and SysId on SPARKs, and a camera
  // that gets left out because there is no swerve drive.
  Object.assign(r.project, { liveTuning: true, sysId: true, pneumaticsModule: 'revph', pneumaticsCanId: 3, compressor: 'analog', minPsi: 90, maxPsi: 115 });
  const hatch = sub('piston', 'Hatch', null, 0, { solenoid: 'single', channel: 5, startState: 'extended' });
  r.subsystems.push(hatch);
  r.vision.cameras = [G.newCamera('limelight')];
  const feed = G.newCombo('Feed Shot');
  feed.steps = [
    st('action', { target: fly.id, action: 'speed:' + fly.speeds[0].id, mode: 'background' }),
    st('until', { condition: 'atspeed:' + fly.id, seconds: 2 }),
    st('action', { target: hatch.id, action: 'retract', mode: 'finish' }),
    st('action', { target: roller.id, action: 'act:' + roller.actions[0].id, mode: 'time', seconds: 0.5 }),
    st('path', { pathName: 'X' }),
  ];
  r.combos = [feed];
  r.bindings.push(
    bind(gunner, 'button2', 'pressed', { id: 'combos' }, 'combo:' + feed.id),
    bind(driver, 'L1', 'held', armFlex, 'sysid:QuasistaticReverse'));
  shoot.steps.push(st('action', { target: 'combos', action: 'combo:' + feed.id, mode: 'finish' }));
  return r;
}

function oddNames() {
  const r = G.newRobot();
  r.project.robotName = 'Odd "Names" \\ Test';
  r.project.swerveIds = '';
  const a = sub('roller', 'Robot', 'krakenX60', 1);
  const b = sub('roller', 'intake', 'neo', 2);
  const c = sub('roller', 'Intake', 'neo', 3);
  const dd = sub('elevator', '2nd Stage', 'krakenX60', 4);
  dd.setpoints = [G.newSetpoint('goTo', 1), G.newSetpoint('goTo', 2), G.newSetpoint('', 3), G.newSetpoint('L2', 4)];
  const e = sub('flywheel', 'class', 'krakenX60', 5);
  e.speeds = [G.newSpeed('Stop', 100), G.newSpeed('spin up', 200)];
  const f = sub('climber', '', 'neo', 6);
  f.actions = [G.newAction('periodic', 50), G.newAction('stop', -50), G.newAction('new', 10)];
  r.subsystems = [a, b, c, dd, e, f];
  const l1 = G.newLight('candle', { name: 'LEDs', canId: 7 });
  l1.includeOnboard = false;
  l1.stripLength = 0;
  const l2 = G.newLight('candle', { name: 'leds', canId: 8 });
  l2.signals = [{ id: 's1', name: 'showOff', pattern: 'off', color: 'OFF' }, { id: 's2', name: 'Run', pattern: 'alliance', color: 'CYAN' }];
  l2.rules = [];
  r.lights = [l1, l2];
  r.controllers.push(ctl('driver', 'xbox', 1), ctl('Drive', 'xbox', 1));
  const d = r.controllers[0];
  r.bindings = [
    bind(d, 'x', 'pressed', a, 'stop'),
    bind(d, 'leftBumper', 'pressed', dd, 'sp:' + dd.setpoints[0].id),
    bind(d, 'a', 'pressed', dd, 'sp:' + dd.setpoints[1].id),
    bind(d, 'a', 'pressed', dd, 'sp:' + dd.setpoints[1].id),
    bind(d, 'b', 'pressed', e, 'speed:' + e.speeds[0].id),
    bind(d, 'y', 'pressed', f, 'act:' + f.actions[1].id),
    bind(d, 'back', 'pressed', l2, 'signal:s1'),
    { id: 'broken', controllerId: 'nope', button: 'a', when: 'held', target: 'gone', action: 'x' },
  ];
  // Odd routine names, PathPlanner off, and a default auto that was deleted.
  const names = ['class', 'Leave Zone', 'Leave Zone', '123 Go', 'getSelected', '"Quoted" \\ name'];
  r.autos.routines = names.map((n) => G.newRoutine(n));
  r.autos.routines[0].steps = [st('wait', { seconds: 1 })];
  r.autos.routines[1].steps = [st('drive', { direction: 'backward', speed: 9, seconds: 99 })];
  r.autos.defaultAuto = 'deleted-id';
  r.autos.pathPlanner = false;
  // Odd combo names, broken steps, and simulation turned off.
  r.project.simulation = false;
  const c1 = G.newCombo('class');
  c1.steps = [st('action', { target: 'gone', action: 'x' }), st('drive', {})];
  r.combos = [c1, G.newCombo('Same'), G.newCombo('Same'), G.newCombo('123')];
  return r;
}

function emptySwerve() { return G.newRobot(); }
function bare() { const r = G.newRobot(); r.project.tunerSwerve = false; r.controllers = []; return r; }

const robots = { example: G.exampleRobot(), allCtre: allCtre(), allRev: allRev(), visionRev: visionRev(), oddNames: oddNames(), emptySwerve: emptySwerve(), bare: bare() };

const stubDir = path.join(__dirname, 'stubs');
function copyDir(from, to) {
  fs.readdirSync(from, { withFileTypes: true }).forEach((ent) => {
    const a = path.join(from, ent.name); const b = path.join(to, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copyDir(a, b); } else fs.copyFileSync(a, b);
  });
}

module.exports = { robots };

if (isMain) Object.entries(robots).forEach(([name, robot]) => {
  // Round-trip through JSON, like saving and opening a robot file.
  const saved = JSON.parse(JSON.stringify(robot));
  const { files, model } = G.generate(saved);
  const dir = path.join(outDir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  files.forEach((f) => {
    const p = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  });
  if (model.project.tunerSwerve) copyDir(stubDir, dir);
  console.log(`== ${name}: ${files.length} files, ${model.issues.length} checks`);
  model.issues.forEach((x) => console.log(`   [${x.level}] ${x.text}`));
});
