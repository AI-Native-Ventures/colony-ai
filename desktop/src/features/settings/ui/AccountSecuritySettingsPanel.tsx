import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { SignOutSection } from "./SignOutSection";
import { Button } from "@/shared/ui/button";
import { useIdentityQuery } from "@/shared/api/hooks";

export function AccountSecuritySettingsPanel({
  onClose,
  onOpenDraftRecovery,
}: {
  onClose?: () => void;
  onOpenDraftRecovery?: () => void;
}) {
  const identityQuery = useIdentityQuery();
  const identityName = identityQuery.data?.displayName ?? "This device";

  return (
    <section className="min-w-0" data-testid="settings-account-security">
      <SettingsSectionHeader
        title="Sign-in & devices"
        action={
          <Button
            className="h-8 px-3 text-xs"
            data-testid="settings-security-back-to-today"
            onClick={onClose}
            size="sm"
            variant="outline"
          >
            Back to Today
          </Button>
        }
      />

      <div className="space-y-6">
        <section className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-background/70">
          <h2 className="px-4 pt-4 text-sm font-semibold text-muted-foreground/70">
            Email &amp; password
          </h2>
          <div className="space-y-4 px-4 pb-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Sign in with your email and password. Recovery uses a verified
              email reset link.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-8 px-3 text-xs"
                data-testid="account-reset-password"
                disabled
                title="Password reset from settings is unavailable."
                variant="outline"
              >
                Reset password
              </Button>
              <Button
                className="h-8 px-3 text-xs"
                data-testid="account-change-email"
                disabled
                title="Changing a linked account email is unavailable."
                variant="outline"
              >
                Change email
              </Button>
            </div>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-background/70">
          <h2 className="px-4 pt-4 text-sm font-semibold text-muted-foreground/70">
            Signed-in devices
          </h2>
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{identityName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Signed in · This device
              </p>
            </div>
            <SignOutSection
              onOpenDraftRecovery={onOpenDraftRecovery}
              variant="device"
            />
          </div>
        </section>

        <SignOutSection
          onOpenDraftRecovery={onOpenDraftRecovery}
          variant="local-data"
        />
      </div>
    </section>
  );
}
