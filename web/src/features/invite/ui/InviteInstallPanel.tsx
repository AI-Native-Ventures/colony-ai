import {
  COLONY_DOWNLOAD_PAGE_URL,
  type ColonyDownloadPlatform,
  detectColonyDownloadPlatform,
  resolveColonyDownloadUrlForPlatform,
} from "@/shared/lib/colony-download";
import * as React from "react";

type CopyState = "idle" | "copied" | "failed";

const COPY_FEEDBACK_MS = 2500;

const PLATFORM_LABEL: Partial<
  Record<ColonyDownloadPlatform["operatingSystem"], string>
> = {
  macos: "Download Colony for Mac",
  windows: "Download Colony for Windows",
  linux: "Download Colony for Linux",
};

/** The platform-specific footnote shown under the download button. */
function platformNote(
  platform: ColonyDownloadPlatform | undefined,
): string | undefined {
  if (platform?.operatingSystem === "macos") {
    return "Colony for Mac needs a Mac with Apple Silicon (M1 or later).";
  }
  if (
    platform?.operatingSystem === "ios" ||
    platform?.operatingSystem === "android"
  ) {
    return "Colony runs on desktop for now. Open this page on your computer to install it.";
  }
  return undefined;
}

/**
 * Install guidance for a visitor who does not have Colony yet: the latest
 * desktop download for their OS, and the invite link to paste into the app once
 * it is installed.
 */
export function InviteInstallPanel({ inviteUrl }: { inviteUrl: string }) {
  const [platform, setPlatform] = React.useState<ColonyDownloadPlatform>();
  const [downloadUrl, setDownloadUrl] = React.useState(
    COLONY_DOWNLOAD_PAGE_URL,
  );
  const [copyState, setCopyState] = React.useState<CopyState>("idle");
  const linkInputRef = React.useRef<HTMLInputElement>(null);
  const copyTimerRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    detectColonyDownloadPlatform(navigator).then(async (detected) => {
      if (!active) return;
      setPlatform(detected);
      const url = await resolveColonyDownloadUrlForPlatform(detected);
      if (active) setDownloadUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const copyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyState("copied");
    } catch {
      // Clipboard access can be refused; leave the link selected to copy by hand.
      linkInputRef.current?.select();
      setCopyState("failed");
    }
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(
      () => setCopyState("idle"),
      COPY_FEEDBACK_MS,
    );
  };

  const note = platformNote(platform);

  return (
    <section
      aria-labelledby="invite-install-title"
      className="rounded-2xl border border-colony-line bg-colony-card px-6 py-6 text-left sm:px-8"
    >
      <h2
        className="text-base font-semibold tracking-tight"
        id="invite-install-title"
      >
        Don&apos;t have Colony yet?
      </h2>
      <p className="mt-1 text-sm leading-6 text-colony-muted">
        Install Colony, open it, choose Have an invite link? on the first screen
        and paste this link.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Invite link"
          className="h-10 w-full min-w-0 rounded-full sm:flex-1 border border-colony-line bg-colony-paper px-4 font-mono text-xs text-colony-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-colony-focus"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          ref={linkInputRef}
          value={inviteUrl}
        />
        <button
          className="h-10 shrink-0 rounded-full border border-colony-green px-5 text-sm font-medium text-colony-green hover:bg-colony-green hover:text-colony-green-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-colony-focus"
          onClick={() => void copyInviteLink()}
          type="button"
        >
          Copy link
        </button>
      </div>
      <p
        aria-live="polite"
        className="mt-2 min-h-5 text-xs text-colony-muted"
        role="status"
      >
        {copyState === "copied" ? "Invite link copied." : null}
        {copyState === "failed"
          ? "Could not copy automatically. The link is selected, copy it by hand."
          : null}
      </p>
      <a
        className="mt-3 inline-flex h-11 items-center justify-center rounded-full border border-colony-green bg-colony-green px-6 text-sm font-medium text-colony-green-ink no-underline hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-colony-focus"
        href={downloadUrl}
        rel="noreferrer"
        target="_blank"
      >
        {(platform && PLATFORM_LABEL[platform.operatingSystem]) ??
          "Download Colony"}
      </a>
      {note ? (
        <p className="mt-3 text-xs leading-5 text-colony-muted">{note}</p>
      ) : null}
      <p className="mt-3 text-xs leading-5 text-colony-muted">
        This first release is not code-signed yet, so your computer may ask you
        to confirm before it opens.{" "}
        <a
          className="underline underline-offset-4 hover:text-colony-ink focus-visible:text-colony-ink"
          href={COLONY_DOWNLOAD_PAGE_URL}
          rel="noreferrer"
          target="_blank"
        >
          See every download and the steps
        </a>
        .
      </p>
    </section>
  );
}
