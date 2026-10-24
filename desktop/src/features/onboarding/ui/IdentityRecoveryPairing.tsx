import * as React from "react";
import { listen } from "@tauri-apps/api/event";
import { cancelPairing, confirmPairingSas } from "@/shared/api/tauri";
import { startIdentityRecoveryPairing } from "@/shared/api/tauriPairing";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { StyledQrCode } from "@/shared/ui/styled-qr-code";
import { FirstRunButton, FirstRunError } from "./firstRunControls";
import { AlertIcon, CheckIcon, ShieldCheckIcon } from "./firstRunIcons";
import "./firstRun.css";

export type RecoveryPairingStep =
  | "loading"
  | "qr"
  | "sas"
  | "receiving"
  | "done"
  | "error";

// Refresh before the pairing relay's two-minute connection cap so Desktop never
// leaves a code on screen after its publishing channel has closed.
const QR_REFRESH_MS = 90_000;

function recoveryErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("sas-confirm") ||
    normalized.includes("relay connection closed") ||
    normalized.includes("websocket") ||
    normalized.includes("expired") ||
    normalized.includes("timed out")
  ) {
    return "This pairing code expired or lost its connection. Create a new code and try again.";
  }
  return message;
}

export function IdentityRecoveryPairing({
  onRecovered,
  onStepChange,
}: {
  onRecovered: () => Promise<void>;
  onStepChange?: (step: RecoveryPairingStep) => void;
}) {
  const [step, setStep] = React.useState<RecoveryPairingStep>("loading");
  const [qrUri, setQrUri] = React.useState<string | null>(null);
  const [sas, setSas] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const active = React.useRef(true);
  const copyTimer = React.useRef<number | null>(null);

  React.useEffect(() => {
    onStepChange?.(step);
  }, [onStepChange, step]);

  const start = React.useCallback(async () => {
    active.current = true;
    setStep("loading");
    setError(null);
    setSas(null);
    setQrUri(null);
    setCopied(false);
    try {
      setQrUri(await startIdentityRecoveryPairing());
      setStep("qr");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not start recovery.",
      );
      setStep("error");
    }
  }, []);

  React.useEffect(() => {
    void start();
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    listen<{ sas: string }>("pairing-sas-received", ({ payload }) => {
      if (!disposed && active.current) {
        setSas(payload.sas);
        setStep("sas");
      }
    }).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    listen("pairing-complete", () => {
      if (!disposed && active.current) {
        active.current = false;
        setStep("done");
        void onRecovered();
      }
    }).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    listen<{ message: string }>("pairing-error", ({ payload }) => {
      if (!disposed && active.current) {
        active.current = false;
        setError(recoveryErrorMessage(payload.message));
        setStep("error");
      }
    }).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    listen<{ reason: string }>("pairing-aborted", ({ payload }) => {
      if (!disposed && active.current) {
        active.current = false;
        setError(`Recovery stopped: ${payload.reason}`);
        setStep("error");
      }
    }).then((unlisten) => (disposed ? unlisten() : unlisteners.push(unlisten)));
    return () => {
      disposed = true;
      active.current = false;
      for (const unlisten of unlisteners) unlisten();
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      void cancelPairing();
    };
  }, [onRecovered, start]);

  React.useEffect(() => {
    if (step !== "qr") return;
    const timer = window.setTimeout(() => void start(), QR_REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [start, step]);

  async function copyPairingCode() {
    if (!qrUri) return;
    try {
      await writeTextToClipboard(qrUri);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Could not copy the pairing code. Try again.");
    }
  }

  async function deny() {
    active.current = false;
    await cancelPairing().catch(() => {});
    setError("The codes didn't match. Pairing was canceled.");
    setStep("error");
  }

  async function confirm() {
    setStep("receiving");
    try {
      await confirmPairingSas();
    } catch (cause) {
      if (!active.current) return;
      setError(
        recoveryErrorMessage(
          cause instanceof Error
            ? cause.message
            : "Could not confirm recovery.",
        ),
      );
      setStep("error");
    }
  }

  // A short, readable stand-in for the long pairing link: its last characters.
  const shortCode = qrUri
    ? qrUri
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(-8)
        .toUpperCase()
        .replace(/(.{4})(.{4})/, "$1 $2")
    : "";
  const waiting = step === "qr" && qrUri;

  return (
    <div className="c3fr-pairing" data-testid="identity-recovery-pairing">
      {step === "sas" && sas ? (
        <div className="c3fr-pairing-sas">
          <span aria-hidden="true" className="c3fr-pairing-sas-icon">
            <ShieldCheckIcon size={26} />
          </span>
          <p className="c3fr-pairing-sas-title">
            Does this code match your phone?
          </p>
          <p
            className="c3fr-pairing-sas-code"
            data-testid="identity-recovery-sas"
          >
            {sas.slice(0, 3)} {sas.slice(3)}
          </p>
          <p className="c3fr-note">
            This gives this desktop permanent access to your Colony identity.
            Only continue if you trust it.
          </p>
          <div className="c3fr-actions">
            <FirstRunButton
              data-testid="confirm-identity-recovery-sas"
              kind="primary"
              onClick={() => void confirm()}
              size="small"
            >
              <CheckIcon size={16} strokeWidth={2.6} />
              Codes match
            </FirstRunButton>
            <FirstRunButton
              data-testid="deny-identity-recovery-sas"
              onClick={() => void deny()}
              size="small"
            >
              Cancel
            </FirstRunButton>
          </div>
        </div>
      ) : step === "done" ? (
        <div className="c3fr-pairing-state" role="status">
          <span
            aria-hidden="true"
            className="c3fr-pairing-sas-icon"
            data-tone="ok"
          >
            <CheckIcon size={22} strokeWidth={3} />
          </span>
          <p className="c3fr-pairing-sas-title">Identity received securely</p>
        </div>
      ) : step === "error" ? (
        <div className="c3fr-pairing-state">
          <span
            aria-hidden="true"
            className="c3fr-pairing-sas-icon"
            data-tone="bad"
          >
            <AlertIcon size={22} />
          </span>
          <FirstRunError>{error}</FirstRunError>
          <FirstRunButton onClick={() => void start()} size="small">
            Try again
          </FirstRunButton>
        </div>
      ) : (
        <>
          <div className="c3fr-pairing-code-row">
            <div
              className="c3fr-pairing-qr"
              data-testid="identity-recovery-qr-container"
            >
              {step === "qr" && qrUri ? (
                <StyledQrCode
                  animate
                  centerImageSrc="/app-icon@2x.png"
                  data-testid="identity-recovery-qr"
                  size={134}
                  title="Desktop identity recovery QR code"
                  value={qrUri}
                />
              ) : (
                <span className="c3fr-pairing-qr-wait">
                  {step === "receiving"
                    ? "Receiving identity…"
                    : "Starting pairing…"}
                </span>
              )}
            </div>
            <div className="c3fr-pairing-code">
              <span className="c3fr-eyebrow c3fr-eyebrow-muted">
                Pairing code
              </span>
              <span className="c3fr-pairing-code-text">{shortCode || "…"}</span>
              <FirstRunButton
                data-testid="copy-identity-recovery-code"
                disabled={step === "loading"}
                onClick={() => void copyPairingCode()}
                size="small"
              >
                {step === "loading"
                  ? "Generating pairing code…"
                  : copied
                    ? "Copied"
                    : "Copy pairing code"}
              </FirstRunButton>
            </div>
          </div>
          <div className="c3fr-banner c3fr-banner-left" role="status">
            <span aria-hidden="true" className="c3fr-banner-dot c3fr-live" />
            {step === "receiving"
              ? "Receiving identity from your phone…"
              : "Waiting for your phone to scan…"}
          </div>
          <ol className="c3fr-pairing-steps">
            <li>Open Colony on your phone.</li>
            <li>Go to Settings, then pair a device.</li>
            <li>Scan the code and check the codes match.</li>
          </ol>
          {waiting && error ? <FirstRunError>{error}</FirstRunError> : null}
        </>
      )}
    </div>
  );
}
