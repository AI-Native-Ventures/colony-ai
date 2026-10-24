import { RecoveryScreen } from "./RecoveryScreen";

export function ResetFailedScreen() {
  return (
    <RecoveryScreen
      testId="reset-failed"
      tone="need"
      title="Sign out could not complete"
      body="Colony was unable to fully clear your local data. Try relaunching. The reset will resume automatically. If this persists, contact support."
    />
  );
}
