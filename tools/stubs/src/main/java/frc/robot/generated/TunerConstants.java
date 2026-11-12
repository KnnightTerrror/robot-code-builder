package frc.robot.generated;

import static edu.wpi.first.units.Units.*;

import com.ctre.phoenix6.hardware.CANcoder;
import com.ctre.phoenix6.hardware.TalonFX;
import com.ctre.phoenix6.swerve.SwerveDrivetrain;
import com.ctre.phoenix6.swerve.SwerveDrivetrainConstants;
import com.ctre.phoenix6.swerve.SwerveModuleConstants;
import edu.wpi.first.units.measure.LinearVelocity;
import frc.robot.subsystems.CommandSwerveDrivetrain;

/**
 * Compile-test stand-in for the TunerConstants file Phoenix Tuner X generates.
 * Same shape as the real one (no real robot values), so code that uses it is
 * checked against the real Phoenix 6 SwerveDrivetrain class.
 */
public class TunerConstants {
    public static final LinearVelocity kSpeedAt12Volts = MetersPerSecond.of(4.73);
    public static final SwerveDrivetrainConstants DrivetrainConstants = new SwerveDrivetrainConstants();

    public static CommandSwerveDrivetrain createDrivetrain() {
        return new CommandSwerveDrivetrain(DrivetrainConstants);
    }

    /** Like the generated class: a swerve drive with Talon FX drive and steer motors and CANcoders. */
    public static class TunerSwerveDrivetrain extends SwerveDrivetrain<TalonFX, TalonFX, CANcoder> {
        public TunerSwerveDrivetrain(
                SwerveDrivetrainConstants drivetrainConstants, SwerveModuleConstants<?, ?, ?>... modules) {
            super(TalonFX::new, TalonFX::new, CANcoder::new, drivetrainConstants, modules);
        }
    }
}
