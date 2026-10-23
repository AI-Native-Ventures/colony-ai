import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  LoaderCircle,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import {
  cancelPairing,
  confirmPairingSas,
  startPairing,
} from "@/shared/api/tauri";
import { StyledQrCode } from "@/shared/ui/styled-qr-code";
import { writeTextToClipboard } from "@/shared/lib/clipboard";

type PairingStep =
  | "idle"
  | "generating"
  | "qr"
  | "expired"
  | "sas"
  | "transferring"
  | "done"
  | "error";

const PAIRING_CODE_DIGIT_POSITIONS = [0, 1, 2, 3, 4, 5] as const;

function pairingErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (message.toLowerCase().includes("timeout waiting for eose")) {
    return "Pairing took too long. Try again.";
  }

  return message || "We couldn't start pairing. Try again.";
}

function isPairingSessionTimeout(message: string) {
  return message.toLowerCase().includes("session timed out");
}

function PairingStepIndicator({
  complete,
  current,
  label,
  testId,
}: {
  complete: boolean;
  current: boolean;
  label: string;
  testId: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="cs-pairing-index"
      data-completed={complete ? "true" : "false"}
      data-current={current ? "true" : undefined}
      data-testid={testId}
    >
      {complete ? <Check className="h-4 w-4" strokeWidth={3} /> : label}
    </span>
  );
}

function PairingSteps({ step }: { step: PairingStep }) {
  const hasScanned =
    step === "sas" || step === "transferring" || step === "done";
  const hasConfirmed = step === "transferring" || step === "done";
  const isPaired = step === "done";
  const currentStep = isPaired ? 0 : hasConfirmed ? 3 : hasScanned ? 2 : 1;

  return (
    <ol
      aria-label="Pairing steps"
      className="cs-pairing-steps"
      data-testid="mobile-pairing-steps"
    >
      <li aria-current={currentStep === 1 ? "step" : undefined}>
        <PairingStepIndicator
          complete={hasScanned}
          current={currentStep === 1}
          label="1"
          testId="mobile-pairing-scan-step-indicator"
        />
        <span>
          <strong>Scan QR code</strong>
          <span>
            Open Colony on your mobile device and scan the code shown here.
          </span>
        </span>
      </li>

      <li aria-current={currentStep === 2 ? "step" : undefined}>
        <PairingStepIndicator
          complete={hasConfirmed}
          current={currentStep === 2}
          label="2"
          testId="mobile-pairing-confirm-step-indicator"
        />
        <span>
          <strong>Confirm mobile code</strong>
          <span>
            Check that the six-digit code matches on both devices, then confirm
            it.
          </span>
        </span>
      </li>

      <li
        aria-current={currentStep === 3 ? "step" : undefined}
        data-testid="mobile-pairing-final-step"
      >
        <PairingStepIndicator
          complete={isPaired}
          current={currentStep === 3}
          label="3"
          testId="mobile-pairing-final-step-indicator"
        />
        <span aria-live="polite">
          <strong>{isPaired ? "Paired" : "Pair your mobile app"}</strong>
          <span>
            {isPaired
              ? "Your mobile app is now connected to this relay."
              : "Your mobile app will connect after you confirm the code."}
          </span>
        </span>
      </li>
    </ol>
  );
}

function PairingCodeConfirmation({
  onConfirm,
  onDeny,
  sasCode,
}: {
  onConfirm: () => void;
  onDeny: () => void;
  sasCode: string;
}) {
  const formattedCode = `${sasCode.slice(0, 3)} ${sasCode.slice(3, 6)}`;

  return (
    <div
      className="cs-pairing-confirm"
      data-testid="mobile-pairing-code-confirmation"
    >
      <p className="cs-pairing-confirm-title" data-testid="pairing-sas-title">
        Confirm mobile code
      </p>
      <fieldset className="cs-pairing-code" data-testid="pairing-sas-code">
        <legend className="sr-only">Confirmation code {formattedCode}</legend>
        {PAIRING_CODE_DIGIT_POSITIONS.map((position) => (
          <span
            aria-hidden="true"
            data-gap={position === 3 ? "true" : undefined}
            data-testid={`pairing-sas-code-digit-${position + 1}`}
            key={position}
          >
            {sasCode[position] ?? ""}
          </span>
        ))}
      </fieldset>
      <div className="cs-pairing-actions" data-testid="pairing-sas-actions">
        <button
          className="cs-accent-button"
          data-testid="confirm-sas"
          onClick={onConfirm}
          type="button"
        >
          <Check className="h-4 w-4" strokeWidth={3} />
          Codes match
        </button>
        <button
          className="cs-button"
          data-testid="deny-sas"
          onClick={onDeny}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function MobilePairingCard({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const [step, setStep] = useState<PairingStep>("idle");
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [sasCode, setSasCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const pairingActiveRef = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const beginPairing = useCallback(() => {
    const requestId = ++requestIdRef.current;
    pairingActiveRef.current = true;
    setStep("generating");
    setQrUri(null);
    setSasCode(null);
    setError(null);

    startPairing().then(
      (uri) => {
        if (requestId === requestIdRef.current) {
          setQrUri(uri);
          setStep("qr");
        }
      },
      (err) => {
        if (requestId === requestIdRef.current) {
          pairingActiveRef.current = false;
          setError(pairingErrorMessage(err));
          setStep("error");
        }
      },
    );
  }, []);

  useEffect(() => {
    ++requestIdRef.current;
    pairingActiveRef.current = false;
    setStep("idle");
    setQrUri(null);
    setSasCode(null);
    setError(null);

    if (!currentPubkey) {
      return;
    }

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    listen<{ sas: string }>("pairing-sas-received", (event) => {
      if (!cancelled && pairingActiveRef.current) {
        setSasCode(event.payload.sas);
        setStep("sas");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen("pairing-complete", () => {
      if (!cancelled && pairingActiveRef.current) {
        pairingActiveRef.current = false;
        setStep("done");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ reason: string }>("pairing-aborted", (event) => {
      if (!cancelled && pairingActiveRef.current) {
        pairingActiveRef.current = false;
        setError(`Pairing stopped: ${event.payload.reason}`);
        setStep("error");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    listen<{ message: string }>("pairing-error", (event) => {
      if (!cancelled && pairingActiveRef.current) {
        pairingActiveRef.current = false;
        if (isPairingSessionTimeout(event.payload.message)) {
          setQrUri(null);
          setSasCode(null);
          setError(null);
          setStep("expired");
          return;
        }

        setError(pairingErrorMessage(event.payload.message));
        setStep("error");
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisteners.push(fn);
    });

    return () => {
      cancelled = true;
      ++requestIdRef.current;
      pairingActiveRef.current = false;
      for (const fn of unlisteners) fn();
      if (stepRef.current !== "idle" && stepRef.current !== "done") {
        cancelPairing().catch(() => {});
      }
    };
  }, [currentPubkey]);

  async function handleCopy() {
    if (!qrUri) return;
    await writeTextToClipboard(qrUri);
    toast.success("Copied to clipboard");
  }

  async function handleConfirmSas() {
    setStep("transferring");
    try {
      await confirmPairingSas();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "We couldn't send your identity. Try again.",
      );
      pairingActiveRef.current = false;
      setStep("error");
    }
  }

  function handleDenySas() {
    pairingActiveRef.current = false;
    cancelPairing().catch(() => {});
    setError("The codes didn't match. Pairing was canceled.");
    setStep("error");
  }

  const panelClass =
    step === "sas" || step === "transferring" || step === "done"
      ? "cs-pairing-panel"
      : "cs-pairing-panel cs-pairing-panel-qr";
  return (
    <div className="cs-led" data-testid="settings-mobile">
      <div className="cs-pairing-head">
        <h2 className="cs-section-title">Mobile</h2>
        <p>
          Connect the Colony mobile app to this relay by scanning a QR code. The
          connection is secured with end-to-end encryption and a verification
          code.
        </p>
      </div>

      <section className="cs-card cs-pairing" data-testid="mobile-pairing-card">
        {/* Persistent polite live region: the pairing steps swap the QR view
            for the inline code confirmation asynchronously, and a screen
            reader would otherwise get no signal that a code is now waiting.
            It stays mounted for every step so the announcement is reliable,
            and is visually hidden. */}
        <p aria-live="polite" className="sr-only" data-testid="pairing-status">
          {step === "sas" && sasCode
            ? `Verification code ${sasCode.slice(0, 3)} ${sasCode.slice(3, 6)} ready. Check that it matches on your mobile device, then confirm the codes match.`
            : step === "transferring"
              ? "Codes confirmed. Pairing your mobile device."
              : step === "done"
                ? "Your mobile app is now paired."
                : ""}
        </p>
        <div className="cs-pairing-layout" data-testid="mobile-pairing-layout">
          <div className="cs-pairing-side">
            <div
              className={panelClass}
              data-testid="mobile-pairing-qr-container"
            >
              {step === "sas" && sasCode ? (
                <PairingCodeConfirmation
                  onConfirm={() => void handleConfirmSas()}
                  onDeny={handleDenySas}
                  sasCode={sasCode}
                />
              ) : step === "transferring" ? (
                <div className="cs-pairing-state">
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    data-testid="pairing-transfer-spinner"
                  />
                  <p>Pairing mobile device...</p>
                </div>
              ) : step === "qr" && qrUri ? (
                <StyledQrCode
                  animate
                  centerImageSrc="/app-icon@2x.png"
                  data-testid="mobile-pairing-qr"
                  size={240}
                  title="Mobile pairing QR code"
                  value={qrUri}
                />
              ) : step === "expired" ? (
                <div className="cs-pairing-state">
                  <span className="cs-pairing-icon" data-tone="muted">
                    <RefreshCw className="h-5 w-5" />
                  </span>
                  <p>Pairing code expired.</p>
                  <button
                    className="cs-button"
                    data-testid="regenerate-pairing-button"
                    onClick={beginPairing}
                    type="button"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Generate new pairing code
                  </button>
                </div>
              ) : step === "error" ? (
                <div className="cs-pairing-state" role="alert">
                  <TriangleAlert className="h-6 w-6 text-destructive" />
                  <p data-tone="bad">{error ?? "Pairing session ended."}</p>
                  <button
                    className="cs-button"
                    data-testid="retry-pairing-button"
                    onClick={beginPairing}
                    type="button"
                  >
                    Try again
                  </button>
                </div>
              ) : step === "idle" ? (
                currentPubkey ? (
                  <div className="cs-pairing-state">
                    <span className="cs-pairing-icon">
                      <Smartphone className="h-5 w-5" />
                    </span>
                    <button
                      className="cs-primary"
                      data-testid="start-pairing-button"
                      onClick={beginPairing}
                      type="button"
                    >
                      Start pairing
                    </button>
                  </div>
                ) : (
                  <p className="cs-pairing-note">
                    Sign in to generate a mobile pairing code.
                  </p>
                )
              ) : step === "done" ? (
                <div className="cs-pairing-state" role="status">
                  <span className="cs-pairing-icon" data-tone="ok">
                    <Check className="h-5 w-5" strokeWidth={3} />
                  </span>
                  <strong>Paired</strong>
                  <p>Your mobile app is now paired.</p>
                </div>
              ) : (
                <div className="cs-pairing-state">
                  <LoaderCircle
                    aria-hidden="true"
                    className="h-6 w-6 animate-spin text-muted-foreground"
                    data-testid="pairing-loading-spinner"
                  />
                  <p>Starting pairing...</p>
                </div>
              )}
            </div>

            <div
              className="cs-pairing-copy"
              data-testid="mobile-pairing-copy-slot"
            >
              {step === "qr" && qrUri ? (
                <button
                  className="cs-text-button animate-in fade-in-0 zoom-in-95 origin-top duration-[250ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:animate-none"
                  data-testid="copy-pairing-code"
                  onClick={handleCopy}
                  type="button"
                >
                  <Copy className="h-4 w-4" />
                  Copy pairing code
                </button>
              ) : null}
            </div>
          </div>

          <PairingSteps step={step} />
        </div>
      </section>
    </div>
  );
}
