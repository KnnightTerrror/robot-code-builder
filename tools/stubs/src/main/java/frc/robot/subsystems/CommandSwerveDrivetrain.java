package frc.robot.subsystems;

import com.ctre.phoenix6.swerve.SwerveDrivetrainConstants;
import com.ctre.phoenix6.swerve.SwerveModuleConstants;
import com.ctre.phoenix6.swerve.SwerveRequest;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Subsystem;
import edu.wpi.first.wpilibj2.command.sysid.SysIdRoutine;
import frc.robot.generated.TunerConstants.TunerSwerveDrivetrain;
import java.util.function.Supplier;

/**
 * Compile-test stand-in for the CommandSwerveDrivetrain that Phoenix Tuner X generates.
 * Like the real one, it extends TunerSwerveDrivetrain (so it has the real Phoenix 6
 * getState, resetPose, setControl and seedFieldCentric) and adds the same helper methods.
 */
public class CommandSwerveDrivetrain extends TunerSwerveDrivetrain implements Subsystem {
    public CommandSwerveDrivetrain(
            SwerveDrivetrainConstants drivetrainConstants, SwerveModuleConstants<?, ?, ?>... modules) {
        super(drivetrainConstants, modules);
    }

    public Command applyRequest(Supplier<SwerveRequest> request) {
        return run(() -> this.setControl(request.get()));
    }

    public Command sysIdQuasistatic(SysIdRoutine.Direction direction) {
        return run(() -> {});
    }

    public Command sysIdDynamic(SysIdRoutine.Direction direction) {
        return run(() -> {});
    }
}
