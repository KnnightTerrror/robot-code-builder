// Runs the in-app simulator without a page and checks that mechanisms, buttons, autos and
// AprilTag features behave. Usage: node tools/simtest.js
'use strict';
const path = require('path');
const G = require(path.join(__dirname, '..', 'src', 'gen.js'));
const S = require(path.join(__dirname, '..', 'src', 'sim.js'));

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!ok) failed++;
}
const f = (v, d) => Number(v).toFixed(d == null ? 2 : d);

function press(sim, ctl, button, seconds) {
  sim.input.set(ctl, button, 'test', true);
  sim.run(seconds == null ? 0.1 : seconds);
  sim.input.set(ctl, button, 'test', false);
  sim.step();
}

// ---------------------------------------------------------------- example robot
{
  const robot = JSON.parse(JSON.stringify(G.exampleRobot()));
  const sim = S.create(robot);
  const M = sim.model;
  const operator = M.controllers[1];
  const driver = M.controllers[0];
  const elev = M.subsystems.find((s) => s.preset === 'elevator');
  const arm = M.subsystems.find((s) => s.preset === 'arm');
  const intake = M.subsystems.find((s) => s.preset === 'roller');
  const E = sim.mechs.get(elev.id);
  const A = sim.mechs.get(arm.id);
  const I = sim.mechs.get(intake.id);
  const leds = sim.lights.get(M.lights[0].id);

  sim.run(0.5);
  check('disabled: LEDs show the disabled rule (rainbow)', leds.pattern === 'rainbow', leds.pattern);
  check('disabled: elevator stays at the bottom', Math.abs(E.position) < 0.01, f(E.position));
  const armStart = A.position;
  sim.run(1);
  check('disabled: arm falls a bit or holds (brake mode)', Number.isFinite(A.position), `${f(armStart)} -> ${f(A.position)}`);

  sim.setMode('teleop');
  sim.run(0.5);
  check('teleop: elevator hold command runs', sim.sched.running.some((c) => c.name === elev.label + ': Hold'));
  // Operator Y: elevator High (46 in)
  press(sim, operator, 'y');
  sim.run(2.5);
  check('elevator reaches High (46 in) within 2.6 s', Math.abs(E.position - 46) <= 0.5, `${f(E.position)} in, target ${f(E.target)}`);
  // Operator X: arm Score (35 deg)
  press(sim, operator, 'x');
  sim.run(2);
  check('arm reaches Score (35 deg) within 2 s', Math.abs(A.position - 35) <= 2, `${f(A.position)} deg`);
  sim.run(2);
  check('arm holds Score against gravity', Math.abs(A.position - 35) <= 2, `${f(A.position)} deg`);
  // Operator A: elevator Stow and arm Stow
  press(sim, operator, 'a');
  sim.run(3);
  check('A runs two actions: elevator Stow', Math.abs(E.position - 0) <= 0.5, f(E.position));
  check('A runs two actions: arm Stow (90)', Math.abs(A.position - 90) <= 2, f(A.position));

  // Intake: hold right trigger, piece arrives, command ends by itself (stop on piece), rumble fires
  sim.input.set(operator, 'rightTrigger', 'test', true);
  sim.run(0.3);
  check('intake runs while the trigger is held', I.out > 0.5, `out ${f(I.out)}`);
  sim.run(0.5);
  check('intake picks up a game piece', I.hasPiece);
  check('Run In stopped by itself once loaded', I.out === 0, `out ${f(I.out)}`);
  check('driver controller rumbles when the intake gets a piece', sim.input.rumbleOf(driver) > 0, String(sim.input.rumbleOf(driver)));
  sim.input.set(operator, 'rightTrigger', 'test', false);
  sim.run(0.6);
  check('rumble stops after its time', sim.input.rumbleOf(driver) === 0);
  check('LEDs green with a game piece', leds.pattern === 'solid' && leds.color === 'GREEN', `${leds.pattern} ${leds.color}`);
  // Left trigger: Run Out ejects
  sim.input.set(operator, 'leftTrigger', 'test', true);
  sim.run(0.5);
  sim.input.set(operator, 'leftTrigger', 'test', false);
  sim.step();
  check('Run Out lets go of the piece', !I.hasPiece);

  // Driving: W forward for 1 s on blue = +x
  const D = sim.drive;
  D.place(7, 4, 0);
  const x0 = D.x;
  sim.input.setAxes(driver, 'test', { lx: 0, ly: -1, rx: 0, ry: 0 });
  sim.run(1);
  sim.input.setAxes(driver, 'test', { lx: 0, ly: 0, rx: 0, ry: 0 });
  check('W drives toward the red wall on blue (about 3.4 m in 1 s)', Math.abs(D.x - x0 - 3.375) < 0.1, `${f(x0)} -> ${f(D.x)}`);
  // Slow mode (right bumper)
  D.place(7, 4, 0);
  sim.input.set(driver, 'rightBumper', 'test', true);
  sim.input.setAxes(driver, 'test', { lx: 0, ly: -1, rx: 0, ry: 0 });
  sim.run(1);
  const slowSpeed = Math.hypot(D.vx, D.vy);
  sim.input.set(driver, 'rightBumper', 'test', false);
  sim.input.setAxes(driver, 'test', { lx: 0, ly: 0, rx: 0, ry: 0 });
  check('slow mode drives at 40%', Math.abs(slowSpeed - 0.4 * 4.5) < 0.1, `${f(slowSpeed)} m/s`);

  // Zone "Close to Tag": near tag 26 (4.022, 4.035, facing 180) -> slow 50% and LEDs yellow
  sim.run(0.5);
  D.place(3.3, 4.035, 0);
  sim.run(0.1);
  const z = M.vision.zones[0];
  check('robot 0.72 m from tag 26 is in the zone', sim.vision.inZone(z), f(sim.vision.distanceTo(z.ids)));
  check('slow zone scales the drive to 50%', Math.abs(sim.speedScale() - 0.5) < 1e-6, f(sim.speedScale()));
  check('LEDs yellow in the zone', leds.color === 'YELLOW', `${leds.pattern} ${leds.color}`);
  D.place(4.022 - 1.25, 4.035, 0);
  sim.run(0.1);
  check('slow zone eases in 0.25 m outside: 75%', Math.abs(sim.speedScale() - 0.75) < 0.02, f(sim.speedScale()));
  // Vision: facing tag 26 from the blue side? The tag faces 180 (toward blue wall), robot faces 0 -> sees it
  check('camera sees tag 26', sim.vision.hasTarget() && sim.vision.primary.tag.id === 26, sim.vision.primary ? String(sim.vision.primary.tag.id) : 'none');
  // Aim: turn the robot 20 deg off and hold the aim trigger
  D.place(2.5, 4.4, 20 * Math.PI / 180);
  sim.run(0.1);
  const tx0 = sim.vision.tx();
  sim.input.set(driver, 'leftTrigger', 'test', true);
  sim.run(1.5);
  sim.input.set(driver, 'leftTrigger', 'test', false);
  sim.step();
  check('aim button turns to face the tag', sim.vision.isAimed(), `tx ${f(tx0)} -> ${f(sim.vision.tx())}`);
  // Spot: driver A drives to 0.8 m in front of the nearest tag
  D.place(2.0, 3.0, 0);
  sim.input.set(driver, 'a', 'test', true);
  sim.run(4);
  sim.input.set(driver, 'a', 'test', false);
  sim.step();
  const spot = sim.vision.nearestSpot(M.vision.spots[0].ids, 0.8, 0);
  check('A lines up 0.8 m in front of the nearest tag', Math.hypot(spot.x - D.x, spot.y - D.y) < 0.06, `tag ${spot.tag}, off by ${f(Math.hypot(spot.x - D.x, spot.y - D.y), 3)} m`);

  // Distance table: arm by distance on operator left bumper
  D.place(4.022 - 2, 4.035, 0);
  sim.input.set(operator, 'leftBumper', 'test', true);
  sim.run(2);
  const want = sim.vision.tableValue(M.vision.tables[0]);
  check('distance table: 2 m from a tag asks for 32.5 deg', Math.abs(want - 32.5) < 0.2, f(want));
  check('arm follows the distance table', Math.abs(A.position - want) <= 2, `${f(A.position)} deg`);
  sim.input.set(operator, 'leftBumper', 'test', false);
  sim.step();

  // Combo: operator right bumper -> Score High
  press(sim, operator, 'rightBumper');
  sim.run(0.5);
  check('combo: elevator heads to High first', E.target === 46, f(E.target));
  sim.run(6);
  check('combo finishes and sends both back to Stow', E.target === 0 && Math.abs(A.target - 90) < 1e-9, `elev ${f(E.target)} arm ${f(A.target)}`);

  // Disable cancels everything except LED status and idle
  sim.setMode('disabled');
  sim.step();
  check('disable leaves only commands that run while disabled', sim.sched.running.every((c) => c.disabledOk), sim.sched.running.map((c) => c.name).join(', '));

  // Auto: Score and Leave
  sim.drive.home();
  sim.selectAuto(M.autos.routines.find((r) => r.label === 'Score and Leave').id);
  const ax0 = sim.drive.x;
  sim.setMode('auto');
  sim.run(1);
  check('auto: elevator heads to High', E.target === 46);
  sim.run(6);
  check('auto finishes', !sim.autoCmd, sim.log.slice(-3).map((x) => x.text).join(' | '));
  check('auto drives backward 1.5 m/s for 1.5 s', ax0 - sim.drive.x > 1.8, `${f(ax0)} -> ${f(sim.drive.x)}`);
  check('auto left the elevator going to Stow in the background', E.target === 0);
}

// ---------------------------------------------------------------- CTRE robot: flywheel, tables, zones
{
  const T = require(path.join(__dirname, 'test.js'));
  const robot = JSON.parse(JSON.stringify(T.robots.allCtre));
  // The test robot sets its gear ratio after the kV estimate; redo it so the speeds come out right.
  robot.subsystems.forEach((s) => { if (s.preset === 'flywheel') { s.gains.ctre.kV = G.estimateKV(s, 'ctre'); s.gains.rev.kV = G.estimateKV(s, 'rev'); } });
  const sim = S.create(robot);
  const M = sim.model;
  const ps5 = M.controllers.find((c) => c.type === 'ps5');
  const fly = M.subsystems.find((s) => s.preset === 'flywheel');
  const F = sim.mechs.get(fly.id);
  sim.setMode('teleop');
  sim.step();
  press(sim, ps5, 'R2');
  sim.run(2);
  check('flywheel (toggle) reaches Close Shot speed', F.atSpeed(), `${f(F.rpm, 0)} / ${f(F.targetRpm, 0)} RPM`);
  press(sim, ps5, 'R2');
  sim.run(0.2);
  check('toggle again stops it', F.targetRpm === 0);
  // Shot zone: within 3 m of tag 10 -> flywheel 3200 RPM (teleop only)
  sim.drive.place(12.519 + 2, 4.035, Math.PI);
  sim.run(2);
  check('zone runs the flywheel at its set speed', F.targetRpm === 3200 && F.atSpeed(), `${f(F.rpm, 0)} / ${f(F.targetRpm, 0)}`);
  sim.drive.place(8, 2, 0);
  sim.run(0.2);
  check('leaving the zone stops it', F.targetRpm === 0);
  // Table on R3 (held): tags 4, 7; 2 m -> 3000
  sim.drive.place(11.312 - 2, 4.035, 0);
  sim.input.set(ps5, 'R3', 'test', true);
  sim.run(2);
  check('table drives the flywheel to 3000 RPM at 2 m', Math.abs(F.targetRpm - 3000) < 1 && F.atSpeed(), `${f(F.targetRpm, 0)} target, ${f(F.rpm, 0)} RPM`);
  sim.input.set(ps5, 'R3', 'test', false);
  sim.step();
  // Wrist (CANcoder arm) and absolute sync button
  const wrist = M.subsystems.find((s) => s.label === 'Wrist');
  const W = sim.mechs.get(wrist.id);
  press(sim, ps5, 'circle');
  sim.run(0.1);
  check('released binding (circle) waits for the release', W.target === Number(wrist.src.setpoints[1].value), f(W.target));
  sim.run(3);
  check('Talon arm with Motion Magic reaches its setpoint', W.atTarget(), `${f(W.position)} vs ${f(W.target)}`);
  // Elevator without a profile (PositionVoltage)
  const elev = M.subsystems.find((s) => s.preset === 'elevator');
  const E = sim.mechs.get(elev.id);
  press(sim, ps5, 'triangle');
  sim.run(4);
  check('Talon elevator without a profile reaches High', Math.abs(E.position - E.target) <= 1.0, `${f(E.position)} vs ${f(E.target)}`);
  // SysId quasistatic on R1 runs a voltage ramp
  sim.input.set(ps5, 'R1', 'test', true);
  sim.run(1);
  check('SysId quasistatic ramps the voltage', E.req.type === 'voltage' && E.req.volts > 0.8, E.req.type + ' ' + f(E.req.volts));
  sim.input.set(ps5, 'R1', 'test', false);
  sim.step();
  check('SysId ends by holding where it is', E.req.type === 'position');
  // Auto with a path step, a drive step and background actions
  sim.setMode('disabled');
  sim.selectAuto(M.autos.routines[0].id);
  sim.setMode('auto');
  sim.run(30);
  check('an imported path is driven, one that was not imported is skipped',
    sim.log.some((x) => x.text.includes('Skipped the path "Reef to Station"')) && !sim.log.some((x) => x.text.includes('Skipped the path "Start to Reef"')),
    sim.log.slice(-4).map((x) => x.text).join(' | '));
  check('no simulator errors', !sim.error, sim.error && sim.error.stack);
}

// ---------------------------------------------------------------- REV robot
{
  const T = require(path.join(__dirname, 'test.js'));
  ['allRev', 'visionRev', 'oddNames', 'emptySwerve', 'bare'].forEach((name) => {
    const sim = S.create(JSON.parse(JSON.stringify(T.robots[name])));
    sim.setMode('teleop');
    // press every bound button for a moment
    sim.model.bindings.forEach((bd) => { sim.input.set(bd.ctl, bd.button, 'test', true); sim.run(0.3); sim.input.set(bd.ctl, bd.button, 'test', false); sim.run(0.3); });
    sim.setMode('auto');
    sim.run(5);
    sim.setMode('disabled');
    sim.run(0.5);
    check(`${name}: runs every button and auto without errors`, !sim.error, sim.error && sim.error.stack);
  });
  const sim = S.create(JSON.parse(JSON.stringify(T.robots.allRev)));
  const fly = sim.model.subsystems.find((s) => s.preset === 'flywheel');
  const F = sim.mechs.get(fly.id);
  const lift = sim.model.subsystems.find((s) => s.preset === 'elevator');
  const L = sim.mechs.get(lift.id);
  sim.setMode('teleop');
  const driver = sim.model.controllers[1];
  const gunner = sim.model.controllers[0];
  press(sim, driver, 'share');
  sim.run(3);
  check('SPARK flywheel holds its speed', F.atSpeed(), `${f(F.rpm, 0)} / ${f(F.targetRpm, 0)}`);
  press(sim, gunner, 'button7');
  sim.run(3);
  check('SPARK elevator with MAXMotion reaches its setpoint', L.atTarget(), `${f(L.position)} vs ${f(L.target)}`);
  const climb = sim.model.subsystems.find((s) => s.preset === 'climber');
  check('climber has soft limits', !!sim.mechs.get(climb.id).soft);
}

// ---------------------------------------------------------------- PathPlanner path with actions (example robot)
['blue', 'red'].forEach((alliance) => {
  const robot = JSON.parse(JSON.stringify(G.exampleRobot()));
  const sim = S.create(robot);
  const M = sim.model;
  const demo = M.autos.routines.find((r) => r.label === 'Path Demo');
  const path = M.paths[0];
  const arm = M.subsystems.find((x) => x.preset === 'arm');
  const intake = M.subsystems.find((x) => x.preset === 'roller');
  const A = sim.mechs.get(arm.id);
  const I = sim.mechs.get(intake.id);
  const leds = sim.lights.get(M.lights[0].id);
  sim.setAlliance(alliance);
  sim.selectAuto(demo.id);
  const flip = (p) => (alliance === 'red' ? { x: 16.54 - p.x, y: 8.07 - p.y } : p);
  const start = flip(G.PathGeom.pointAt(path.data, 0));
  const mid = flip(G.PathGeom.pointAt(path.data, 1));
  const end = flip(G.PathGeom.pointAt(path.data, 2));
  sim.setMode('auto');
  sim.run(0.1);
  check(`${alliance}: Start here puts the robot at the path start`, Math.hypot(sim.drive.x - start.x, sim.drive.y - start.y) < 0.15, `${f(sim.drive.x)}, ${f(sim.drive.y)}`);
  let flashed = false;
  let stoppedAt = null;
  let stopTime = 0;
  let armMovedWhileStopped = false;
  let intakeOnDriving = false;
  for (let i = 0; i < 600 && sim.autoCmd; i++) {
    sim.step();
    if (leds.pattern === 'strobe' && sim.drive.path) flashed = true;
    const speed = Math.hypot(sim.drive.vx, sim.drive.vy);
    const atMid = Math.hypot(sim.drive.x - mid.x, sim.drive.y - mid.y) < 0.05;
    if (atMid && speed < 0.01) {
      stopTime += 0.02;
      stoppedAt = stoppedAt || { x: sim.drive.x, y: sim.drive.y };
      if (A.target === -20) armMovedWhileStopped = true;
    }
    if (sim.drive.path && sim.drive.pathPos > 1.25 && I.out > 0.5) intakeOnDriving = true;
  }
  check(`${alliance}: LEDs flash on the way (a timed action while driving)`, flashed);
  check(`${alliance}: the robot stops at waypoint 1 while the arm lowers`, !!stoppedAt && stopTime > 0.2 && armMovedWhileStopped, `stopped ${f(stopTime)} s`);
  check(`${alliance}: the arm reached Intake before the robot moved on`, Math.abs(A.position + 20) <= 2.5, f(A.position));
  check(`${alliance}: intake runs while driving after 1.2`, intakeOnDriving);
  check(`${alliance}: the robot ends at the end of the path`, Math.hypot(sim.drive.x - end.x, sim.drive.y - end.y) < 0.1, `${f(sim.drive.x)}, ${f(sim.drive.y)}`);
  const wantDeg = alliance === 'red' ? 135 : -45;
  const dDeg = (((sim.drive.th * 180) / Math.PI - wantDeg + 540) % 360) - 180;
  check(`${alliance}: and faces the path's end rotation`, Math.abs(dDeg) < 2, f((sim.drive.th * 180) / Math.PI, 1));
  check(`${alliance}: the auto finishes`, !sim.autoCmd && !sim.error, sim.error ? sim.error.stack : sim.log.slice(-3).map((x) => x.text).join(' | '));
});

// ---------------------------------------------------------------- PathPlanner autos (.auto files)
{
  const robot = JSON.parse(JSON.stringify(G.exampleRobot()));
  const named = (name) => ({ type: 'named', data: { name } });
  robot.ppAutos = [{
    id: 'a1', name: 'PP Grab',
    data: {
      version: '2025.0', resetOdom: true, folder: null, choreoAuto: false,
      command: {
        type: 'sequential', data: {
          commands: [
            { type: 'deadline', data: { commands: [{ type: 'path', data: { pathName: 'Example Path' } }, named('Intake Run In')] } },
            { type: 'parallel', data: { commands: [named('Elevator High'), { type: 'wait', data: { waitTime: 0.5 } }] } },
            named('Not Registered'),
            { type: 'race', data: { commands: [{ type: 'wait', data: { waitTime: 0.6 } }, named('Intake Run Out')] } },
          ],
        },
      },
    },
  }];
  const sim = S.create(robot);
  const M = sim.model;
  const E = sim.mechs.get(M.subsystems.find((x) => x.preset === 'elevator').id);
  const I = sim.mechs.get(M.subsystems.find((x) => x.preset === 'roller').id);
  const a = sim.autos.find((x) => x.pp);
  check('PathPlanner autos show up in the simulator', !!a && a.label === 'PP Grab');
  check('the model warns about a named command the code does not register', M.issues.some((x) => x.text.includes('"Not Registered"')));
  sim.drive.place(10, 2, 0);
  sim.selectAuto(a.id);
  sim.setMode('auto');
  sim.run(0.06);
  const start = G.PathGeom.pointAt(M.paths[0].data, 0);
  check('resetOdom puts the robot at the first path start', Math.hypot(sim.drive.x - start.x, sim.drive.y - start.y) < 0.1, `${f(sim.drive.x)}, ${f(sim.drive.y)}`);
  let intakeWhileDriving = false;
  let sawOut = false;
  for (let k = 0; k < 600 && sim.autoCmd; k++) {
    sim.step();
    if (sim.drive.path && I.out > 0.5) intakeWhileDriving = true;
    if (I.out < -0.3) sawOut = true;
  }
  const end = G.PathGeom.pointAt(M.paths[0].data, 2);
  check('a deadline group runs the intake while the path drives', intakeWhileDriving);
  check('the path ends at its last waypoint', Math.hypot(sim.drive.x - end.x, sim.drive.y - end.y) < 0.1, `${f(sim.drive.x)}, ${f(sim.drive.y)}`);
  check('the parallel group sends the elevator to High', E.target === 46, f(E.target));
  check('a race group runs Intake Run Out until the wait ends', sawOut && I.out === 0);
  check('the auto finishes without errors', !sim.autoCmd && !sim.error, sim.error ? sim.error.stack : sim.log.slice(-3).map((x) => x.text).join(' | '));
  check('the unregistered command is reported in the log', sim.log.some((x) => x.text.includes('"Not Registered", which the code')));
}

// ---------------------------------------------------------------- path editing keeps actions in place
{
  const P = G.PathGeom;
  const d = G.examplePath();
  const probe = [0.1, 0.45, 0.9, 1.3, 1.95];
  const before = probe.map((x) => P.pointAt(d, x));
  const fmap = P.insertWaypoint(d, 0.6);
  const moved = probe.map((x) => P.pointAt(d, fmap(x)));
  check('inserting a waypoint keeps every spot on the same field point', before.every((b, k) => Math.hypot(b.x - moved[k].x, b.y - moved[k].y) < 0.002));
  const L1 = P.length(d);
  P.reversePath(d);
  P.reversePath(d);
  check('reversing twice gives back the same path', Math.abs(P.length(d) - L1) < 1e-9 && Math.abs(d.waypoints[0].anchor.x - 3.4) < 1e-9);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll simulator checks passed');
process.exit(failed ? 1 : 0);
