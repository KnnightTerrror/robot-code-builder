#!/usr/bin/env bash
# Compiles every generated test robot against the real WPILib 2026, Phoenix 6 and REVLib jars
# that are installed on this computer.
# Usage: tools/compile.sh <folder made by tools/test.js>
set -u
GEN="$1"
M=/c/Users/Public/wpilib/2026/maven
C=~/.gradle/caches/modules-2/files-2.1
JAVAC=/c/Users/Public/wpilib/2026/jdk/bin/javac
W=2026.2.1

CP=""
add() { [ -f "$1" ] || { echo "missing jar: $1"; exit 2; }; CP="$CP;$(cygpath -m "$1")"; }
for lib in wpilibj wpilibNewCommands wpimath wpiutil wpiunits ntcore hal wpinet cscore cameraserver apriltag; do
  add "$M/edu/wpi/first/$lib/$lib-java/$W/$lib-java-$W.jar"
done
add "$M/edu/wpi/first/epilogue/epilogue-runtime-java/$W/epilogue-runtime-java-$W.jar"
while IFS= read -r j; do add "$j"; done < <(find "$M/org/ejml" "$M/com/fasterxml" "$M/us" -name '*.jar' ! -name '*-sources.jar' ! -name '*-javadoc.jar' 2>/dev/null)
add "$(ls $C/com.ctre.phoenix6/wpiapi-java/26.3.0/*/wpiapi-java-26.3.0.jar)"
add "$(ls $C/com.revrobotics.frc/REVLib-java/2026.0.5/*/REVLib-java-2026.0.5.jar)"
add "$(ls $C/com.pathplanner.lib/PathplannerLib-java/2026.1.2/*/PathplannerLib-java-2026.1.2.jar)"
CP="${CP#;}"

fail=0
for dir in "$GEN"/*/; do
  name=$(basename "$dir")
  out="$dir/classes"
  rm -rf "$out"; mkdir -p "$out"
  mapfile -t srcs < <(find "$dir/src" -name '*.java' -print0 | xargs -0 -n1 cygpath -m)
  log=$("$JAVAC" -encoding UTF-8 -Xlint:deprecation -Xlint:removal -Xlint:unchecked -d "$(cygpath -m "$out")" -cp "$CP" "${srcs[@]}" 2>&1)
  code=$?
  if [ $code -eq 0 ] && [ -z "$log" ]; then
    echo "PASS  $name (${#srcs[@]} files, no warnings)"
  elif [ $code -eq 0 ]; then
    echo "WARN  $name (${#srcs[@]} files)"; echo "$log" | head -40
  else
    echo "FAIL  $name"; echo "$log" | head -60; fail=1
  fi
done
exit $fail
