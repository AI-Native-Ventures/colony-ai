import * as React from "react";

import { signOut } from "@/shared/api/tauriIdentity";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";

export function SignOutSection() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isPending, setIsPending] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSignOut() {
    setIsPending(true);
    setError(null);
    try {
      await signOut();
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Sign-out could not be completed.",
      );
      setIsPending(false);
    }
  }

  return (
    <>
      <SettingsOptionGroup title="Sign out">
        <SettingsOptionRow>
          <div className="min-w-0">
            <p className="text-sm font-medium">Sign out of this device</p>
            <p className="text-xs text-muted-foreground">
              This device can only sign out while removing its local Colony
              data.
            </p>
          </div>
          <Button disabled size="sm" variant="outline">
            Unavailable
          </Button>
        </SettingsOptionRow>
        <SettingsOptionRow>
          <div className="min-w-0">
            <p className="text-sm font-medium">Sign out & remove local data</p>
            <p className="text-xs text-muted-foreground">
              Clear local identity and app data on this device. Your business
              content stays on its relay.
            </p>
          </div>
          <Button
            data-testid="signout-open-dialog"
            onClick={() => setIsOpen(true)}
            size="sm"
            variant="destructive"
          >
            Continue
          </Button>
        </SettingsOptionRow>
      </SettingsOptionGroup>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isPending) {
            setIsOpen(false);
            setConfirmed(false);
            setError(null);
          }
        }}
        open={isOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out & remove local data?</AlertDialogTitle>
            <AlertDialogDescription>
              Colony clears this device and restarts into setup. Your business
              and conversations stored on the relay remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            Local drafts, cached conversations, downloaded files and device
            settings will be removed.
          </p>
          <label
            className="flex items-start gap-2.5 text-sm"
            htmlFor="signout-local-data-confirm"
          >
            <Checkbox
              checked={confirmed}
              disabled={isPending}
              id="signout-local-data-confirm"
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <span>I have saved anything I need from this device.</span>
          </label>
          {error ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/35 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              <AlertCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{error}</span>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              Stay signed in
            </AlertDialogCancel>
            <Button
              data-testid="signout-confirm"
              disabled={!confirmed || isPending}
              onClick={() => void handleSignOut()}
              type="button"
              variant="destructive"
            >
              {isPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="mr-2 size-4 animate-spin"
                />
              ) : null}
              {isPending ? "Signing out" : "Sign out & remove data"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
