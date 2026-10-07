import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { toast } from "sonner";

import { supportsNativeCapability } from "@/shared/api/nativeBridge";
import { invokeTauri } from "@/shared/api/tauriTransport";

import {
  type NestMigrationNotice,
  surfaceNestMigrationNotice,
} from "./nestMigrationNotice";

const MIGRATION_TOAST_KEY = "buzz-legacy-nest-migrated-notified";

/**
 * Surface nest-related backend events as toasts.
 *
 * - `repos-dir-error`: a configured `repos_dir` failed to validate or its
 *   symlink could not be applied (invalid path, downgrade refused, external
 *   target gone). Emitted by `apply_workspace` on both the validate-reject
 *   and the runtime symlink-failure paths, so a bad `repos_dir` is always
 *   visibly surfaced rather than silently logged to console.
 * - `legacy-nest-migrated`: the agent's knowledge was carried over from a
 *   legacy `~/.sprout` nest. Shown once per machine (deduped via
 *   localStorage); the backend re-emits each launch while `~/.sprout` exists,
 *   which also covers the event being emitted before this listener mounts.
 *
 * - `get_nest_migration_notice`: the agents' folder was moved to a new place, or
 *   left where it was because moving it was not safe. The move runs before the
 *   window exists, so the backend stores a plain-language message and this hook
 *   asks for it once the app has mounted, shows it, then acknowledges it so it
 *   is never shown twice.
 *
 * Mounted at the app root ahead of the community-init effect so the listener
 * is registered before the first `apply_workspace` call.
 */
export function useNestNotifications(): void {
  useEffect(() => {
    if (!supportsNativeCapability("workspace-events")) {
      return;
    }

    const unlistenReposError = listen<string>("repos-dir-error", (event) => {
      toast.error("Repos directory not applied", {
        description: event.payload,
      });
    });

    const unlistenMigrated = listen("legacy-nest-migrated", () => {
      if (localStorage.getItem(MIGRATION_TOAST_KEY) === "true") {
        return;
      }
      localStorage.setItem(MIGRATION_TOAST_KEY, "true");
      toast.success("Migrated notes from ~/.sprout", {
        description: "You can delete it to reclaim disk space.",
      });
    });

    let cancelled = false;
    void surfaceNestMigrationNotice({
      fetchNotice: () =>
        invokeTauri<NestMigrationNotice | null>("get_nest_migration_notice"),
      acknowledge: () => invokeTauri("acknowledge_nest_migration_notice"),
      show: (message) =>
        toast.info("About your agents' files", { description: message }),
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
      void unlistenReposError.then((fn) => fn());
      void unlistenMigrated.then((fn) => fn());
    };
  }, []);
}
