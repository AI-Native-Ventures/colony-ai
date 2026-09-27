import * as React from "react";
import { X } from "lucide-react";

import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { SettingsAlertDialogContent } from "@/shared/ui/settings-alert-dialog-content";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";

export function HarnessInstallDialog({
  installOutputLine,
  onConfirm,
  onOpenChange,
  open,
  runtime,
  stage,
}: {
  installOutputLine: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  runtime: AcpRuntimeCatalogEntry;
  stage: "confirm" | "installing";
}) {
  const isInstalling = stage === "installing";

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <SettingsAlertDialogContent
        className="flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-[0.625rem] border border-[#eae7eb] bg-[#fffefd] p-0 text-[#282532] shadow-[0_24px_80px_#30203824] dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
        data-testid={`harness-install-${isInstalling ? "progress" : "confirmation"}-${runtime.id}`}
      >
        <div className="flex items-center justify-between border-b border-[#eae7eb] px-4 py-3 dark:border-[#3c3544]">
          <AlertDialogHeader className="space-y-0">
            <AlertDialogTitle className="text-sm font-semibold tracking-normal">
              {isInstalling ? `Installing ${runtime.label}…` : "Install"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          {isInstalling ? (
            <Button
              aria-label="Close installation details"
              data-testid={`harness-install-close-${runtime.id}`}
              onClick={() => onOpenChange(false)}
              size="icon"
              variant="ghost"
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>

        {isInstalling ? (
          <div className="space-y-3 px-4 py-4">
            <AlertDialogDescription className="text-xs leading-5 text-[#79747f] dark:text-[#a9a1b4]">
              You can keep working while the installer runs.
            </AlertDialogDescription>
            <progress
              aria-label={`${runtime.label} installation progress`}
              className="h-1.5 w-full accent-[#2655a0]"
            />
            <details className="text-xs">
              <summary className="cursor-pointer">Installation log</summary>
              {installOutputLine ? (
                <pre
                  aria-live="polite"
                  className="mt-2 whitespace-pre-wrap font-mono text-2xs text-[#79747f] dark:text-[#a9a1b4]"
                  data-testid={`harness-install-log-${runtime.id}`}
                >
                  {installOutputLine}
                </pre>
              ) : null}
            </details>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-4 py-4">
              <AlertDialogDescription className="text-xs leading-5 text-[#79747f] dark:text-[#a9a1b4]">
                Install {runtime.label} on this device. Colony will show the
                package source and version before running the installer.
              </AlertDialogDescription>
              <dl className="divide-y divide-[#eae7eb] text-xs dark:divide-[#3c3544]">
                <div className="space-y-1 py-2">
                  <dt className="font-semibold">Source</dt>
                  <dd className="text-[#79747f] dark:text-[#a9a1b4]">
                    Official package registry
                  </dd>
                </div>
                <div className="space-y-1 py-2">
                  <dt className="font-semibold">Version</dt>
                  <dd className="text-[#79747f] dark:text-[#a9a1b4]">
                    Latest supported version from runtime
                  </dd>
                </div>
              </dl>
              <div className="space-y-1 rounded-md border border-[#dce7f6] bg-[#f2f6fc] px-3 py-2 text-xs dark:border-[#394b68] dark:bg-[#253144]">
                <p className="font-semibold">Authentication is separate</p>
                <p className="text-[#5d6c84] dark:text-[#a9b8d0]">
                  After installation, sign in with a supported provider.
                </p>
              </div>
            </div>
            <AlertDialogFooter className="flex-row justify-end border-t border-[#eae7eb] px-4 py-3 dark:border-[#3c3544]">
              <AlertDialogCancel
                className="h-8 rounded-md border-[#eae7eb] bg-transparent px-3 text-xs font-semibold text-[#282532] hover:bg-[#f4f0f7] dark:border-[#3c3544] dark:text-[#e6e1ec] dark:hover:bg-[#3a3243]"
                data-testid={`harness-install-cancel-${runtime.id}`}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                className="h-8 rounded-md bg-[#2655a0] px-3 text-xs font-semibold text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
                data-testid={`harness-install-confirm-${runtime.id}`}
                onClick={onConfirm}
                type="button"
              >
                Continue
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </SettingsAlertDialogContent>
    </AlertDialog>
  );
}
