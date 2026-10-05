import type { Page } from "@playwright/test";

/**
 * The shipped mock bridge throws on every `terminal_*` command. This answers
 * them (and counts attach/detach/close/input) while everything else falls
 * through to the real mock bridge. Call it BEFORE `installMockBridge`.
 */
export type TerminalBackendState = {
  attaches: number;
  detaches: number;
  closes: number;
  inputs: string[];
};

export async function installTerminalBackend(page: Page) {
  await page.addInitScript(() => {
    const w = window as typeof window & {
      isTauri?: boolean;
      __TAURI_INTERNALS__?: Record<string, unknown>;
      __DOCK_TERM__?: unknown;
    };
    w.isTauri = true;
    const state = {
      attaches: 0,
      detaches: 0,
      closes: 0,
      inputs: [] as string[],
      columns: 80,
      screenLines: 24,
    };
    w.__DOCK_TERM__ = state;
    const internals: Record<string, unknown> = {};
    let inner: ((cmd: string, args: unknown, opts: unknown) => unknown) | null =
      null;
    Object.defineProperty(internals, "invoke", {
      configurable: true,
      get:
        () => (cmd: string, args: Record<string, unknown>, opts: unknown) => {
          switch (cmd) {
            case "terminal_attach":
              state.attaches += 1;
              return Promise.resolve({
                sessionId: `dock-session-${state.attaches}`,
                subscriptionId: `dock-sub-${state.attaches}`,
                viewport: {
                  generation: 1,
                  columns: state.columns,
                  screenLines: state.screenLines,
                },
              });
            case "terminal_resize":
              state.columns = args.columns as number;
              state.screenLines = args.rows as number;
              return Promise.resolve({
                generation: 1,
                columns: state.columns,
                screenLines: state.screenLines,
              });
            case "terminal_input":
              state.inputs.push(args.data as string);
              return Promise.resolve(null);
            case "terminal_detach":
              state.detaches += 1;
              return Promise.resolve(null);
            case "terminal_close":
              state.closes += 1;
              return Promise.resolve(null);
            case "terminal_scroll":
            case "terminal_viewport_ready":
            case "terminal_ack":
            case "terminal_focus":
              return Promise.resolve(null);
            default:
              if (!inner) throw new Error(`no mock bridge for ${cmd}`);
              return inner(cmd, args, opts);
          }
        },
      set: (fn: (cmd: string, args: unknown, opts: unknown) => unknown) => {
        inner = fn;
      },
    });
    w.__TAURI_INTERNALS__ = internals;
  });
}

export function readTerminalBackend(page: Page): Promise<TerminalBackendState> {
  return page.evaluate(
    () =>
      (window as typeof window & { __DOCK_TERM__: TerminalBackendState })
        .__DOCK_TERM__,
  );
}
