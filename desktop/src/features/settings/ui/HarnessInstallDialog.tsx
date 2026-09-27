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
        className="flex w-[33.75rem] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-xl border border-[#eae7eb] bg-[#fffefd] p-0 text-[#282532] shadow-[0_24px_80px_#30203824] dark:border-[#3c3544] dark:bg-[#26232d] dark:text-[#e6e1ec]"
        data-testid={`harness-install-${isInstalling ? "progress" : "confirmation"}-${runtime.id}`}
      >
        <div className="flex items-center justify-between border-b border-[#eae7eb] px-[25px] py-[22px] dark:border-[#3c3544]">
          <AlertDialogHeader className="space-y-0">
            <AlertDialogTitle className="text-base font-semibold tracking-normal">
              {isInstalling ? "Installing" : "Install"}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <Button
            aria-label="Close"
            data-testid={`harness-install-close-${runtime.id}`}
            onClick={() => onOpenChange(false)}
            size="icon"
            variant="ghost"
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        {isInstalling ? (
          <div className="px-[25px] pt-[64px] pb-[25px]">
            <div className="flex flex-col items-center text-center">
              <span aria-hidden="true" className="mb-[25px]">
                <span className="block size-6 animate-spin rounded-full border-2 border-[#eae7eb] border-b-[#2655a0] dark:border-[#3c3544] dark:border-b-[#a9bee8]" />
              </span>
              <AlertDialogDescription className="text-base font-semibold leading-6 text-[#282532] dark:text-[#e6e1ec]">
                Installing {runtime.label}…
              </AlertDialogDescription>
              <p className="mt-2 text-sm leading-5 text-[#79747f] dark:text-[#a9a1b4]">
                You can keep working while the installer runs.
              </p>
            </div>
            <progress
              aria-label={`${runtime.label} installation progress`}
              className="mt-[55px] h-1 w-full accent-[#2655a0]"
            />
            <details className="mt-5 text-sm">
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
            <div className="px-[25px] py-[25px]">
              <AlertDialogDescription className="text-sm leading-[21px] text-[#79747f] dark:text-[#a9a1b4]">
                Install {runtime.label} on this device. Colony will show the
                package source and version before running the installer.
              </AlertDialogDescription>
              <dl className="mt-3 text-sm">
                <div className="space-y-1 border-b border-[#eae7eb] py-[18px] dark:border-[#3c3544]">
                  <dt className="font-semibold leading-[21px]">Source</dt>
                  <dd className="text-xs leading-[18px] text-[#79747f] dark:text-[#a9a1b4]">
                    Official package registry
                  </dd>
                </div>
                <div className="space-y-1 py-[18px]">
                  <dt className="font-semibold leading-[21px]">Version</dt>
                  <dd className="text-xs leading-[18px] text-[#79747f] dark:text-[#a9a1b4]">
                    Latest supported version from runtime
                  </dd>
                </div>
              </dl>
              <div className="my-[18px] space-y-1 rounded-[7px] border border-[#dce5ef] bg-[#f1f6fc] px-[18px] py-[15px] text-xs leading-[18px] text-[#48637f] dark:border-[#43516a] dark:bg-[#293445] dark:text-[#b4c6e0]">
                <p className="font-semibold">Authentication is separate</p>
                <p>After installation, sign in with a supported provider.</p>
              </div>
            </div>
            <AlertDialogFooter className="flex-row justify-end gap-2 border-t border-[#eae7eb] px-[25px] py-[18px] dark:border-[#3c3544]">
              <AlertDialogCancel
                className="h-9 rounded-md border-[#eae7eb] bg-transparent px-[13px] text-xs font-semibold text-[#282532] hover:bg-[#f4f0f7] dark:border-[#3c3544] dark:text-[#e6e1ec] dark:hover:bg-[#3a3243]"
                data-testid={`harness-install-cancel-${runtime.id}`}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                className="h-9 rounded-md bg-[#2655a0] px-[13px] text-xs font-semibold text-white hover:bg-[#2655a0] dark:bg-[#a9bee8] dark:text-[#202a3b] dark:hover:bg-[#a9bee8]"
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
