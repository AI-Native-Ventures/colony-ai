/** One-time notice about the move of the agents' folder, stored by the backend. */
export type NestMigrationNotice = {
  key: string;
  message: string;
  acknowledged: boolean;
};

export type NestMigrationNoticeDeps = {
  /** The notice the person has not seen yet, or null. */
  fetchNotice: () => Promise<NestMigrationNotice | null>;
  /** Mark the stored notice as seen. */
  acknowledge: () => Promise<unknown>;
  /** Show the plain-language message. */
  show: (message: string) => void;
  /** True once the caller went away (unmount) and nothing more should happen. */
  isCancelled: () => boolean;
};

/**
 * Show the backend's pending notice once. It is acknowledged only after it has
 * been shown, so a message that could not be shown comes back next launch. Every
 * failure is swallowed: this notice must never get in the way of the app.
 *
 * Returns true when a notice was shown and acknowledged.
 */
export async function surfaceNestMigrationNotice(
  deps: NestMigrationNoticeDeps,
): Promise<boolean> {
  try {
    const notice = await deps.fetchNotice();
    if (!notice || notice.acknowledged || deps.isCancelled()) {
      return false;
    }
    deps.show(notice.message);
    await deps.acknowledge();
    return true;
  } catch {
    return false;
  }
}
