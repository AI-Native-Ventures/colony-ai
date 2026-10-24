import * as React from "react";

import { nsecToNpub } from "@/shared/lib/nostrUtils";
import {
  classifyKeyImportInput,
  isPlausibleNcryptsec,
  keyImportSubmitEnabled,
} from "../lib/keyImportInput";
import {
  AccountHelpChip,
  FirstRunError,
  FirstRunLink,
} from "./firstRunControls";
import { FirstRunFrame, type FirstRunStory } from "./FirstRunFrame";
import {
  AlertIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileIcon,
  KeyIcon,
  PhoneIcon,
} from "./firstRunIcons";
import { IdentityRecoveryPairing } from "./IdentityRecoveryPairing";

const KEY_FILE_MAX_BYTES = 1024;

type KeySource = "key" | "file";

const STORY: FirstRunStory = {
  heading: "Your people, your agents, your projects, all in one place.",
  body: "Your identity in Colony is a private key. Bring one you already have, or let Colony make a new one on this device.",
  status: "Here to help",
  tone: "help",
  pose: "hello",
  footer: <AccountHelpChip label="How your sign-in stays safe" />,
};

function OptionHead({
  icon,
  id,
  title,
  tone = "light",
}: {
  icon: React.ReactNode;
  id: string;
  title: string;
  tone?: "light" | "dark";
}) {
  return (
    <div className="c3fr-option-head">
      <span aria-hidden="true" className="c3fr-option-icon" data-tone={tone}>
        {icon}
      </span>
      <h3 id={id}>{title}</h3>
    </div>
  );
}

/** Use a key or a locked backup file that you already have. */
function ImportCard({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: (nsec: string, password?: string) => Promise<void>;
}) {
  const [source, setSource] = React.useState<KeySource>("key");
  const [nsecInput, setNsecInput] = React.useState("");
  const [passphrase, setPassphrase] = React.useState("");
  const [fileName, setFileName] = React.useState("");
  const [revealed, setRevealed] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const trimmed = nsecInput.trim();
  const kind = classifyKeyImportInput(nsecInput);
  const encrypted = kind === "ncryptsec";
  const passwordStage = isPlausibleNcryptsec(nsecInput);
  const preview = React.useMemo(() => nsecToNpub(nsecInput), [nsecInput]);
  const valid = keyImportSubmitEnabled(nsecInput, passphrase);
  const busy = disabled || importing;
  const showWaiting =
    trimmed.length >= 5 && !passwordStage && preview === null && !error;

  // A stale password never rides along once the input stops being a backup.
  React.useEffect(() => {
    if (!passwordStage) setPassphrase("");
  }, [passwordStage]);

  const chooseSource = (next: KeySource) => {
    if (next === source || busy) return;
    setSource(next);
    setNsecInput("");
    setPassphrase("");
    setFileName("");
    setError(null);
    setRevealed(false);
  };

  const readFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > KEY_FILE_MAX_BYTES) {
      setError(
        "That file is too large to be a key backup or private key. Choose another file.",
      );
      return;
    }
    try {
      const text = await file.text();
      const firstLine =
        text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
      setNsecInput(firstLine.trim());
      setFileName(file.name);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't read that file.",
      );
    }
  };

  const submit = async () => {
    if (busy || inFlight.current) return;
    if (!valid) {
      setError(
        passwordStage
          ? "Enter the password for this key backup."
          : encrypted
            ? "That doesn't look like a complete ncryptsec backup."
            : "That doesn't look like a valid nsec. Paste an nsec1 key.",
      );
      return;
    }
    inFlight.current = true;
    setImporting(true);
    setError(null);
    try {
      await onImport(trimmed, passwordStage ? passphrase : undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Couldn't import this key.",
      );
    } finally {
      inFlight.current = false;
      setImporting(false);
    }
  };

  return (
    <section
      aria-labelledby="adv-import"
      className="c3fr-option"
      data-active="true"
      data-testid="advanced-import"
    >
      <OptionHead
        icon={<DownloadIcon size={22} />}
        id="adv-import"
        title="Use a sign-in I already have"
        tone="dark"
      />
      <div aria-label="Key source" className="c3fr-tabs" role="tablist">
        {(
          [
            ["key", "Private key"],
            ["file", "Backup file"],
          ] as const
        ).map(([id, label]) => (
          <button
            aria-selected={source === id}
            data-testid={`advanced-tab-${id}`}
            key={id}
            onClick={() => chooseSource(id)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <form
        className="c3fr-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        style={{ "--c3fr-gap": 16 } as React.CSSProperties}
      >
        {source === "key" ? (
          <div className="c3fr-field-group">
            <label className="c3fr-label" htmlFor="nostr-private-key">
              Private key
            </label>
            <div className="c3fr-input-wrap c3fr-input-compact">
              <input
                autoComplete="off"
                autoCorrect="off"
                data-testid="nostr-import-nsec-input"
                disabled={busy}
                id="nostr-private-key"
                onChange={(event) => {
                  setNsecInput(event.target.value);
                  setError(null);
                }}
                placeholder="nsec1…"
                spellCheck={false}
                type={revealed ? "text" : "password"}
                value={nsecInput}
              />
              <button
                aria-label={
                  revealed ? "Hide private key" : "Reveal private key"
                }
                className="c3fr-chip-button"
                data-testid="nostr-import-reveal-toggle"
                onClick={() => setRevealed((current) => !current)}
                type="button"
              >
                {revealed ? "Hide" : "Show"}
              </button>
            </div>
            {preview && !passwordStage ? (
              <p
                className="c3fr-ok-line"
                data-testid="nostr-import-npub-preview"
              >
                Nostr identity found
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <label
              className="c3fr-drop"
              data-dragging={dragging ? "true" : undefined}
              data-testid="nostr-import-backup-file-section"
              onDragEnter={(event) => {
                event.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                if (!busy) event.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) void readFile(event.dataTransfer.files);
              }}
            >
              <FileIcon size={24} />
              <span className="c3fr-drop-title">
                {fileName ? fileName : "Drop your backup file here"}
              </span>
              <span className="c3fr-drop-hint">
                {fileName
                  ? "or choose another file"
                  : "or choose a backup file"}
              </span>
              <input
                accept=".key,.ncryptsec,text/plain"
                aria-label="Choose a backup file"
                className="c3fr-sr-only"
                data-testid="nostr-import-file-input"
                disabled={busy}
                onChange={(event) => {
                  void readFile(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                ref={fileInput}
                type="file"
              />
            </label>
            <div className="c3fr-field-group">
              <label className="c3fr-label" htmlFor="nostr-import-passphrase">
                Backup password
              </label>
              <div className="c3fr-input-wrap c3fr-input-compact">
                <input
                  autoComplete="current-password"
                  autoCorrect="off"
                  data-testid="nostr-import-passphrase"
                  disabled={busy || !passwordStage}
                  id="nostr-import-passphrase"
                  onChange={(event) => {
                    setPassphrase(event.target.value);
                    setError(null);
                  }}
                  placeholder="Enter the password for this key backup."
                  spellCheck={false}
                  type={revealed ? "text" : "password"}
                  value={passphrase}
                />
                <button
                  aria-label={revealed ? "Hide password" : "Reveal password"}
                  className="c3fr-chip-button"
                  data-testid="nostr-import-passphrase-reveal-toggle"
                  onClick={() => setRevealed((current) => !current)}
                  type="button"
                >
                  {revealed ? "Hide" : "Show"}
                </button>
              </div>
              {!passwordStage && !error ? (
                <span className="c3fr-help c3fr-help-strong">
                  Waiting for a complete ncryptsec backup
                </span>
              ) : null}
            </div>
          </>
        )}
        {showWaiting && source === "key" ? (
          <span className="c3fr-help c3fr-help-strong">
            {encrypted
              ? "Waiting for a complete ncryptsec backup"
              : "Waiting for a valid nsec1 key"}
          </span>
        ) : null}
        {error ? <FirstRunError>{error}</FirstRunError> : null}
        <button
          className="c3fr-continue"
          data-testid="nostr-import-submit"
          disabled={!valid || busy}
          type="submit"
        >
          {importing ? "Importing…" : "Continue with this key"}
        </button>
      </form>
    </section>
  );
}

/** Create a key, use one you have, or recover with your phone, on one screen. */
export function AdvancedSignIn({
  error,
  hasSelectedIdentity,
  identityLost,
  isPending,
  onBack,
  onCreate,
  onImport,
  onRecovered,
  onStartNewIdentity,
}: {
  error: string | null;
  /** This computer already holds a sign-in: "Continue setup" instead of "Create". */
  hasSelectedIdentity: boolean;
  identityLost: boolean;
  isPending: boolean;
  onBack: () => void;
  onCreate: () => void;
  onImport: (nsec: string, password?: string) => Promise<void>;
  onRecovered: () => Promise<void>;
  /** The old key was lost: make a new identity and abandon it. */
  onStartNewIdentity?: () => void;
}) {
  const [technical, setTechnical] = React.useState(false);
  return (
    <FirstRunFrame
      layout="advanced"
      story={STORY}
      testId="machine-onboarding-gate"
      wide
    >
      <div className="c3fr-wide-top">
        <FirstRunLink
          className="c3fr-back-link"
          data-testid="account-auth-back-from-advanced"
          onClick={onBack}
        >
          <ChevronLeftIcon size={16} strokeWidth={2.4} />
          Back to account options
        </FirstRunLink>
      </div>
      <div className="c3fr-head">
        <h2 className="c3fr-title" tabIndex={-1}>
          Advanced sign-in options
        </h2>
        <p className="c3fr-lede c3fr-lede-wide">
          {identityLost
            ? "This computer lost its sign-in. Everything you send in Colony is signed with your key, so bring it back or start a new one."
            : "Everything you send in Colony is signed with your key. Choose how this device gets one."}
        </p>
      </div>
      {error ? (
        <div className="c3fr-wide-error">
          <FirstRunError>
            We couldn’t open your sign-in. Try again.
          </FirstRunError>
          <FirstRunLink
            aria-controls="machine-identity-technical-details"
            aria-expanded={technical}
            onClick={() => setTechnical((open) => !open)}
          >
            Technical details
          </FirstRunLink>
          {technical ? (
            <section
              aria-label="Technical details"
              className="c3fr-technical"
              id="machine-identity-technical-details"
            >
              {error}
            </section>
          ) : null}
        </div>
      ) : null}
      <div className="c3fr-options-grid">
        <div className="c3fr-options-col">
          <section aria-labelledby="adv-create" className="c3fr-option">
            <OptionHead
              icon={<KeyIcon size={22} />}
              id="adv-create"
              title="Create a Colony sign-in"
            />
            <p className="c3fr-option-copy">
              Colony makes a new identity key and keeps it protected by your
              system keychain. You can make a locked backup file afterwards.
            </p>
            <div className="c3fr-option-actions">
              <button
                className="c3fr-continue"
                data-kind="primary"
                data-testid="advanced-create"
                disabled={isPending}
                onClick={onCreate}
                type="button"
              >
                {isPending
                  ? "Loading your sign-in…"
                  : hasSelectedIdentity
                    ? "Continue setup"
                    : "Create my sign-in"}
              </button>
              {identityLost && onStartNewIdentity ? (
                <FirstRunLink
                  data-testid="advanced-start-new-identity"
                  disabled={isPending}
                  onClick={onStartNewIdentity}
                >
                  Start new identity
                </FirstRunLink>
              ) : null}
            </div>
          </section>
          <ImportCard disabled={isPending} onImport={onImport} />
        </div>
        <div className="c3fr-options-col">
          <section
            aria-labelledby="adv-phone"
            className="c3fr-option"
            data-testid="phone-recovery-dialog"
          >
            <OptionHead
              icon={<PhoneIcon size={22} />}
              id="adv-phone"
              title="Recover with your phone"
            />
            <p className="c3fr-option-copy">
              Already signed in on Colony for mobile? Scan this code from your
              phone and it sends your identity here securely.
            </p>
            <div data-testid="identity-recovery-stage">
              <IdentityRecoveryPairing onRecovered={onRecovered} />
            </div>
          </section>
          <aside aria-label="Keep your key safe" className="c3fr-warning">
            <AlertIcon size={22} strokeWidth={2.2} />
            <div>
              <strong>Keep your key safe.</strong>
              <span>
                Colony can’t recover your key if you lose it. Once you’re in,
                create a password-protected backup file and keep the password
                somewhere separate.
              </span>
            </div>
          </aside>
        </div>
      </div>
    </FirstRunFrame>
  );
}
