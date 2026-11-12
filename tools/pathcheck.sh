#!/usr/bin/env bash
# Runs the generated PathSteps.java with the real PathPlannerLib and WPILib command scheduler in
# simulated time (tools/pathcheck/PathStepsCheck.java).
# Usage: tools/pathcheck.sh <folder made by tools/test.js> <scratch folder>
set -u
GEN="$1"
WORK="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
M=/c/Users/Public/wpilib/2026/maven
C=~/.gradle/caches/modules-2/files-2.1
JDK=/c/Users/Public/wpilib/2026/jdk/bin
W=2026.2.1

CP=""
add() { [ -f "$1" ] || { echo "missing jar: $1"; exit 2; }; CP="$CP;$(cygpath -m "$1")"; }
for lib in wpilibj wpilibNewCommands wpimath wpiutil wpiunits ntcore hal wpinet cscore cameraserver apriltag; do
  add "$M/edu/wpi/first/$lib/$lib-java/$W/$lib-java-$W.jar"
done
add "$M/edu/wpi/first/epilogue/epilogue-runtime-java/$W/epilogue-runtime-java-$W.jar"
while IFS= read -r j; do add "$j"; done < <(find "$M/org/ejml" "$M/com/fasterxml" "$M/us" -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' 2>/dev/null)
add "$(ls $C/com.pathplanner.lib/PathplannerLib-java/2026.1.2/*/PathplannerLib-java-2026.1.2.jar)"
CP="${CP#;}"

# Desktop native libraries for HAL, NetworkTables and math
NAT="$WORK/natives"
mkdir -p "$NAT"
for z in hal ntcore wpimath wpinet wpiutil; do
  unzip -o -q -j "$M/edu/wpi/first/$z/$z-cpp/$W/$z-cpp-$W-windowsx86-64.zip" 'windows/x86-64/shared/*.dll' -d "$NAT"
done

RUN="$WORK/run"
rm -rf "$RUN"
mkdir -p "$RUN/classes" "$RUN/src/main/deploy/pathplanner/paths"
cp "$GEN/allCtre/src/main/java/frc/robot/PathSteps.java" "$RUN/"
cp "$HERE/pathcheck/PathStepsCheck.java" "$RUN/"
# The example path exactly as the zip writes it, and one drawn and edited with the app's path tools.
cp "$GEN/visionRev/src/main/deploy/pathplanner/paths/Grab.path" "$RUN/src/main/deploy/pathplanner/paths/Check.path" || exit 1
ELECTRON_RUN_AS_NODE=1 /c/Users/Public/wpilib/2026/vscode/Code.exe -e "
const G = require(process.argv[1]); const P = G.PathGeom; const d = P.blank(2.6, 6, 6.2, 6);
P.insertWaypoint(d, 0.5); P.appendWaypoint(d, 8.5, 2.5); P.appendWaypoint(d, 10, 3.2);
P.mirrorPath(d); P.reversePath(d); d.rotationTargets.push({ waypointRelativePos: 1.5, rotationDegrees: 120 });
require('fs').writeFileSync(process.argv[2], JSON.stringify(P.complete(d), null, 2));
" "$(cygpath -w "$HERE/../src/gen.js")" "$(cygpath -w "$RUN/src/main/deploy/pathplanner/paths/Edited.path")" || exit 1
"$JDK/javac" -encoding UTF-8 -d "$(cygpath -m "$RUN/classes")" -cp "$CP" "$(cygpath -m "$RUN/PathSteps.java")" "$(cygpath -m "$RUN/PathStepsCheck.java")" || exit 1
cd "$RUN"
PATH="$NAT:$PATH" "$JDK/java" -Djava.library.path="$(cygpath -w "$NAT")" -cp "$(cygpath -m "$RUN/classes");$CP" frc.robot.PathStepsCheck 2>&1 | grep -vE "^\s*at |Warning at|HAL Extensions|NT: Listening|^\*\*\*\*\*"
