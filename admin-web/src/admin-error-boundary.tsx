import { Component, type ErrorInfo, type ReactNode } from "react";
import { signOutAdminSession } from "./api";

type AdminErrorBoundaryProps = { children: ReactNode };

type AdminErrorBoundaryState = {
  error: Error | null;
  copyStatus: "idle" | "copied" | "failed";
  signingOut: boolean;
  signOutFailed: boolean;
};

/**
 * Keeps an unexpected admin render failure recoverable instead of allowing React
 * to unmount the complete operator console.
 */
export class AdminErrorBoundary extends Component<
  AdminErrorBoundaryProps,
  AdminErrorBoundaryState
> {
  state: AdminErrorBoundaryState = {
    error: null,
    copyStatus: "idle",
    signingOut: false,
    signOutFailed: false,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<AdminErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The recovery card deliberately exposes only a local, copyable summary.
    // The server-side request tracing remains the source for sensitive details.
  }

  private diagnosticDetails() {
    const error = this.state.error;
    return [
      "Colony admin render error",
      `Path: ${window.location.pathname}`,
      `Message: ${error?.message || "Unknown render error"}`,
    ].join("\n");
  }

  private copyDetails = async () => {
    try {
      const details = this.diagnosticDetails();
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(details);
          this.setState({ copyStatus: "copied" });
          return;
        } catch {
          // A restrictive browser context can reject clipboard writes. Fall
          // through to the selection-based path before surfacing that failure.
        }
      }
      const textarea = document.createElement("textarea");
      textarea.value = details;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Clipboard copy was refused");
      this.setState({ copyStatus: "copied" });
    } catch {
      this.setState({ copyStatus: "failed" });
    }
  };

  private signOut = async () => {
    this.setState({ signingOut: true, signOutFailed: false });
    try {
      await signOutAdminSession();
      window.location.assign("/sign-in");
    } catch {
      this.setState({ signingOut: false, signOutFailed: true });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="ad-recovery-page">
        <section
          className="ad-recovery-card"
          aria-labelledby="ad-recovery-title"
          role="alert"
        >
          <span className="ad-brand-mark" aria-hidden="true">
            C
          </span>
          <p className="ad-eyebrow">Colony admin</p>
          <h1 id="ad-recovery-title">Something went wrong</h1>
          <p>
            The admin console could not render this page. You can copy the local
            details for the coordinator, or sign out and try again.
          </p>
          <div className="ad-recovery-actions">
            <button
              className="ad-recovery-copy"
              type="button"
              onClick={() => void this.copyDetails()}
            >
              Copy details
            </button>
            <button
              className="ad-recovery-sign-out"
              type="button"
              onClick={() => void this.signOut()}
              disabled={this.state.signingOut}
            >
              {this.state.signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
          <p className="ad-recovery-status" aria-live="polite">
            {this.state.copyStatus === "copied"
              ? "Details copied."
              : this.state.copyStatus === "failed"
                ? "Could not copy details. Please tell the coordinator the page could not render."
                : this.state.signOutFailed
                  ? "Could not sign out. Reload and try again."
                  : ""}
          </p>
        </section>
      </main>
    );
  }
}
