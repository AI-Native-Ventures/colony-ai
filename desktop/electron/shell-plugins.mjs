import { createElectronDialogs } from "./dialogs.mjs";
import { createNativeNotificationHandler } from "./notifications.mjs";

/*
 * React call sites -> Tauri command or event (verified against @tauri-apps/api 2.11.1):
 * - app/useCloseWindowShortcut.ts:49, features/huddle/components/HuddleBar.tsx:348,525 -> plugin:window|close
 * - app/useTauriWindowDrag.ts:22, shared/ui/StartupWindowDragRegion.tsx:38 -> plugin:window|start_dragging
 * - shared/lib/useIsFullscreen.ts:21,28 -> plugin:window|is_fullscreen and tauri://resize
 * - shared/theme/ThemeProvider.tsx:605-606 -> tauri://theme-changed
 * - features/notifications/lib/desktop.ts:333,340 -> plugin:window|set_badge_count; :335,338 -> |set_badge_label; :355 -> |request_user_attention
 * - features/notifications/lib/desktop.ts:399,407-409 -> plugin:window|unminimize, |show, and |set_focus
 * - app/useWebviewZoomShortcuts.ts:104,112 -> plugin:webview|set_webview_zoom
 * - features/settings/ui/SettingsView.tsx:165, hooks/useSendFeedback.ts:16 -> plugin:app|version
 * - features/onboarding/ui/KeyringLockedScreen.tsx:80, RecoveryScreen.tsx:35, settings/hooks/use-updater.ts:121 -> plugin:process|restart
 * - settings/hooks/use-updater.ts:159 -> plugin:updater|check; communities/communityStorage.ts:25,28 -> plugin:path|resolve_directory
 * - features/huddle/components/MicControls.tsx:304, messages/lib/useLinkEditor.tsx:231, shared/ui/markdown/ExternalLinkAnchor.tsx:74 -> plugin:opener|open_url
 * - features/onboarding/ui/JoinPolicyNotice.tsx:80,94, SetupStep.tsx:312,896, profile/ui/NostrBindConsentDialog.tsx:127,138 -> plugin:opener|open_url
 * - features/agents/ui/AgentCardMintDialog.tsx:247, settings/SidebarUpdateCard.tsx:106, UpdateIndicator.tsx:88, UpdateChecker.tsx:97 -> plugin:opener|open_url
 * - features/settings/ui/HarnessCatalogDialog.tsx:512, HarnessesSettingsPanel.tsx:54, HarnessRow.tsx:139,146 -> plugin:opener|open_url
 * - features/notifications/lib/desktop.ts:158 -> plugin:notification|is_permission_granted; :181,186 -> window.Notification.requestPermission, no IPC command
 * - features/huddle/lib/huddleWindow.ts:14 reads the current window label from renderer metadata, with no invoke.
 * - plugin:app|name is supported for the Tauri app API but has no current desktop/src call site.
 */

const WINDOW_COMMAND_PREFIX = "plugin:window|";
const WEBVIEW_COMMAND_PREFIX = "plugin:webview|";
const APP_COMMAND_PREFIX = "plugin:app|";
const EXTERNAL_URL_PROTOCOLS = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "x-apple.systempreferences:",
  "ms-settings:",
]);

function currentTheme(nativeTheme) {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}

async function readScaleFactor(window) {
  const value = await window.webContents.executeJavaScript(
    "window.devicePixelRatio",
  );
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Electron did not return a valid window scale factor");
  }
  return value;
}

async function readInnerSize(window) {
  const bounds = window.getContentBounds();
  const scaleFactor = await readScaleFactor(window);
  return {
    width: Math.round(bounds.width * scaleFactor),
    height: Math.round(bounds.height * scaleFactor),
  };
}

export function createShellPlugins({
  app,
  shell,
  clipboard,
  dialog,
  Notification,
  nativeTheme,
  getWindow,
  emit,
}) {
  // Notification permission checks stay on the host; requestPermission uses the renderer Notification API and issues no command.
  // Updater commands stay on the host because the existing Tauri updater owns native update checks and installs.
  // Path commands stay on the host because Tauri resolves the configured OS directories there.

  let attentionRequestId;

  function requireWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed?.()) {
      throw new Error("Electron window is unavailable");
    }
    return window;
  }

  function revealWindow() {
    const window = requireWindow();
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  const dialogs = createElectronDialogs({ dialog, getWindow });
  const showNativeNotification = createNativeNotificationHandler({
    Notification,
    revealWindow,
    emit,
  });

  const commands = new Map([
    [
      "plugin:window|scale_factor",
      async () => readScaleFactor(requireWindow()),
    ],
    ["plugin:window|inner_size", async () => readInnerSize(requireWindow())],
    ["plugin:window|is_fullscreen", () => requireWindow().isFullScreen()],
    [
      "plugin:window|set_fullscreen",
      ({ value }) => requireWindow().setFullScreen(Boolean(value)),
    ],
    ["plugin:window|is_focused", () => requireWindow().isFocused()],
    ["plugin:window|theme", () => currentTheme(nativeTheme)],
    [
      "plugin:window|set_title",
      ({ value }) => {
        requireWindow().setTitle(value);
      },
    ],
    [
      "plugin:window|show",
      () => {
        requireWindow().show();
      },
    ],
    [
      "plugin:window|hide",
      () => {
        requireWindow().hide();
      },
    ],
    [
      "plugin:window|minimize",
      () => {
        requireWindow().minimize();
      },
    ],
    [
      "plugin:window|unminimize",
      () => {
        requireWindow().restore();
      },
    ],
    [
      "plugin:window|set_focus",
      () => {
        requireWindow().focus();
      },
    ],
    [
      "plugin:window|close",
      () => {
        requireWindow().close();
      },
    ],
    // Electron's app-region CSS handles dragging, so this Tauri compatibility call is intentionally a no-op.
    ["plugin:window|start_dragging", () => undefined],
    [
      "plugin:window|set_badge_count",
      ({ value }) => {
        app.setBadgeCount?.(value ?? 0);
      },
    ],
    [
      "plugin:window|set_badge_label",
      ({ value }) => {
        app.dock?.setBadge(value ?? "");
      },
    ],
    [
      "plugin:window|request_user_attention",
      ({ value }) => {
        const kind = value?.type?.toLowerCase();
        if (app.dock?.bounce) {
          if (value == null) {
            if (attentionRequestId != null) {
              app.dock.cancelBounce?.(attentionRequestId);
              attentionRequestId = undefined;
            }
            return;
          }
          attentionRequestId = app.dock.bounce(
            kind === "critical" ? "critical" : "informational",
          );
          return;
        }
        requireWindow().flashFrame(value != null);
      },
    ],
    [
      "plugin:webview|set_webview_zoom",
      ({ value }) => {
        requireWindow().webContents.setZoomFactor(value);
      },
    ],
    ["plugin:app|version", () => app.getVersion()],
    ["plugin:app|name", () => app.getName()],
    [
      "plugin:process|restart",
      () => {
        app.relaunch();
        app.quit();
      },
    ],
    [
      "plugin:process|exit",
      ({ code }) => {
        app.exit(code ?? 0);
      },
    ],
    [
      "plugin:opener|open_url",
      async ({ url }) => {
        if (typeof url !== "string") throw new Error("Invalid external URL");
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          throw new Error("Invalid external URL");
        }
        if (!EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
          throw new Error("Unsupported external URL protocol");
        }
        await shell.openExternal(parsed.href);
      },
    ],
    [
      "copy_text_to_clipboard",
      ({ text, html }) => {
        if (typeof text !== "string")
          throw new Error("Clipboard text is required");
        if (typeof html === "string") clipboard.write({ text, html });
        else clipboard.writeText(text);
      },
    ],
    ["read_clipboard_text", () => clipboard.readText()],
    ["show_native_notification", showNativeNotification],
  ]);

  function handles(command) {
    return (
      command.startsWith(WINDOW_COMMAND_PREFIX) ||
      command.startsWith(WEBVIEW_COMMAND_PREFIX) ||
      command.startsWith(APP_COMMAND_PREFIX) ||
      command === "plugin:process|restart" ||
      command === "plugin:process|exit" ||
      command === "plugin:opener|open_url" ||
      command === "copy_text_to_clipboard" ||
      command === "read_clipboard_text" ||
      command === "show_native_notification" ||
      dialogs.handles(command)
    );
  }

  async function invoke(command, args = {}) {
    if (dialogs.handles(command)) {
      return (await dialogs.invoke(command, args ?? {})) ?? null;
    }
    const handler = commands.get(command);
    if (!handler) {
      throw new Error(`Unsupported shell command: ${command}`);
    }
    return (await handler(args ?? {})) ?? null;
  }

  function attachWindowEvents(window) {
    let disposed = false;
    let resizeGeneration = 0;

    const onResize = () => {
      const generation = ++resizeGeneration;
      // Keep only the newest async size read if Chromium is still resolving an earlier one.
      void readInnerSize(window).then((payload) => {
        if (!disposed && generation === resizeGeneration) {
          emit("tauri://resize", payload);
        }
      });
    };
    const onThemeUpdated = () => {
      if (!disposed) {
        emit("tauri://theme-changed", currentTheme(nativeTheme));
      }
    };

    window.on("resize", onResize);
    window.on("enter-full-screen", onResize);
    window.on("leave-full-screen", onResize);
    nativeTheme.on("updated", onThemeUpdated);

    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      resizeGeneration += 1;
      window.removeListener("resize", onResize);
      window.removeListener("enter-full-screen", onResize);
      window.removeListener("leave-full-screen", onResize);
      nativeTheme.removeListener("updated", onThemeUpdated);
    };
  }

  return { handles, invoke, attachWindowEvents };
}
