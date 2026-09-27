import { AccountSettingsHeader } from "./AccountSettingsHeader";
import { SignOutSection } from "./SignOutSection";

export function AccountSecuritySettingsPanel({
  onClose,
  onOpenDraftRecovery,
}: {
  onClose: () => void;
  onOpenDraftRecovery?: () => void;
}) {
  return (
    <section className="min-w-0" data-testid="settings-account-security">
      <AccountSettingsHeader
        onBackToToday={onClose}
        title="Sign-in & devices"
      />

      <div className="w20-account-security-details">
        <h2 className="w20-account-card-title">This device</h2>
        <div className="w20-account-security-row">
          <div className="min-w-0">
            <p className="text-sm font-medium">This device</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Signed in · This device
            </p>
          </div>
          <SignOutSection
            onOpenDraftRecovery={onOpenDraftRecovery}
            variant="device"
          />
        </div>
        <SignOutSection
          onOpenDraftRecovery={onOpenDraftRecovery}
          variant="local-data"
        />
      </div>
    </section>
  );
}
