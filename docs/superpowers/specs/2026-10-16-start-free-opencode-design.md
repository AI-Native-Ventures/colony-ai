# Start free: local OpenCode with the free DeepSeek model

Date: 16 Oct 2026. Status: design approved by the owner, spec awaiting review.

## Goal

A brand-new Colony user with no AI subscription, no OpenRouter account and no
API key can finish onboarding and get working agents for $0, in one click.
Colony pays for no tokens.

## Owner decisions (16 Oct 2026)

1. Build it. Each customer runs their own local copy of OpenCode on their own
   device. Colony never calls OpenCode's API itself.
2. "Start free" is the first Connect option and is selected by default. The
   existing paths move under "Use your own AI".
3. When OpenCode ends the free offer, Colony stops and tells the user. No
   silent switch to another model.

## Verified facts this design rests on

Checked on 16 Oct 2026 on the owner's Mac in an isolated temporary HOME:

- OpenCode 1.18.25 with no account and no key answered through
  `opencode run -m opencode/deepseek-v4.1-flash-free` and through
  `opencode acp` (`initialize`, `session/new`, `session/prompt`), which is the
  mode Colony uses for OpenCode today.
- A direct request to `https://opencode.ai/zen/v1/chat/completions` is refused
  with HTTP 403 `FreeTierError`: "OpenCode's free tier can only be used from
  within OpenCode."
- OpenCode's docs say this model keeps no data and is not trained on, and
  that it is free "for a limited time". The earlier `deepseek-v4-flash-free`
  was removed on 21 Aug 2026 without visible notice.
- Free context is capped at 200K tokens. No free rate limit is published.
- OpenCode CLI release v1.19.2 (16 Oct 2026) publishes per-platform archives
  with SHA256 digests on GitHub (`anomalyco/opencode`), 46 to 62 MB each.

## What the user sees

1. **Connect step.** Two choices:
   - **Start free** (selected, top). Copy: "Free AI on your computer. No
     account, no card." Fine print: "Runs through OpenCode on your computer.
     Chats aren't stored or used for training. Free while OpenCode offers
     it."
   - **Use your own AI**. Opens today's two routes unchanged: Claude Code or
     Codex subscription, and Colony Agent with OpenRouter.
2. **Continue on Start free.** "Setting up free AI..." with live progress
   while Colony downloads OpenCode, then the existing connection test, then
   Welcome exactly as today.
3. **Setup fails.** Download or checksum failure shows the reason, a Retry
   button and "Use your own AI". Nothing half-installed is left behind.
4. **Offer ended at onboarding.** If the free model is no longer offered, the
   test result says so and the screen reads "OpenCode's free AI has ended.
   Connect your own AI to continue." with "Use your own AI".
5. **Offer ends later.** The next agent turn that hits the missing model posts
   one note in the channel: "Free AI has ended. Connect your own AI in
   Settings." The agent's status shows the same text. No retry loop, no
   automatic model switch.

## Architecture

Four units, each testable on its own.

### 1. Managed OpenCode installer (Rust, native host)

New module next to `desktop/src-tauri/src/commands/agent_discovery/managed_node.rs`
and built the same way:

- Pinned `MANAGED_OPENCODE_VERSION = "v1.19.2"` and a per-platform artifact
  table `{platform, filename, sha256}` for darwin-arm64, darwin-x64,
  linux-x64, linux-arm64, windows-x64 and windows-arm64. x64 uses the
  `-baseline` archive so CPUs without AVX2 work. Digests come from the GitHub
  release.
- Downloads `https://github.com/anomalyco/opencode/releases/download/<version>/<filename>`
  with an 80 MB cap, verifies SHA256 before extracting, extracts with the
  existing path-traversal checks into a temp directory, then renames into
  `<data_dir>/Colony/runtimes/opencode/<version>/<platform>/`. Sets the
  executable bit on Unix.
- Idempotent: an existing verified install is reused. Any failure removes the
  temp directory and returns a typed error (`download_failed`,
  `checksum_mismatch`, `extract_failed`, `unsupported_platform`).
- Streams progress through the existing `acp-install-output` events.
- Never runs OpenCode's install script, never edits shell profiles, never
  touches the user's own OpenCode install.

### 2. OpenCode becomes a known runtime

- Move `opencode` from `discovery/presets.rs` into the known runtimes in
  `discovery/catalog.rs` with command `opencode`, args `["acp"]`, auto install
  through unit 1, and no sign-in requirement.
- Default env for the runtime: `OPENCODE_CONFIG_CONTENT` with
  `{"autoupdate": false, "share": "disabled"}` so the pinned binary never
  replaces itself and nothing is shared. The model is not forced here, so a
  power user who picks OpenCode in Settings can still use their own provider.
- Discovery: add the managed OpenCode directory to the managed allow-list
  (`managed_agents/managed_node_paths.rs`) so a cold start finds it before any
  `opencode` on PATH.
- Start free saves the global agent config
  `{preferred_runtime: "opencode", provider: "opencode-free", model: "opencode/deepseek-v4.1-flash-free"}`.
  The model reaches the harness through the existing `BUZZ_ACP_MODEL` path
  (`session/set_model` or `session/set_config_option`).

### 3. Connection test and readiness

- `test_onboarding_connection` accepts `opencode` once it is a known runtime.
- `crates/buzz-acp/src/connection_test.rs`: when the desired model is not
  offered, return a structured `model_unavailable` code next to the existing
  message so the UI can show the "ended" state instead of a generic error.
- `agentReadiness.ts`: OpenCode counts as ready when installed and a recent
  verified connection receipt exists. No login status is needed.

### 4. Ended state at runtime

- Spike finding: OpenCode never errors on a missing model. It silently runs
  its default `opencode/big-pickle` (a model whose data may be used for
  training). So the guard lives in buzz-acp: with `BUZZ_ACP_REQUIRE_MODEL=1`
  (set by the desktop only for provider `opencode-free`), a session whose
  required model is missing or rejected fails with `free model ended: <id>`
  instead of falling back.
- `crates/buzz-acp/src/provider_failure.rs` maps that failure to the
  channel notice. Each refused turn posts the notice once and is not retried.
- `desktop/src/features/agents/lib/friendlyAgentLastError.ts` maps it to
  "Free AI has ended. Connect your own AI in Settings."

### Onboarding UI

`ConnectSetupStep.tsx` and `OnboardingConnectionContent.tsx` gain the top
level Start free / Use your own AI choice. The layout is the one the owner
approved in the question tool; visuals reuse the existing Connect step
components and tokens. Install progress reuses `useInstallOutputLine`.

## Testing

- **Spike first (gate for everything else):** a real Colony agent on
  `opencode acp` with the free model joins a channel, replies, and completes
  a task that uses tools (file read, `buzz` CLI). Capture permission requests
  and the exact error OpenCode returns for an unknown model. If tool use does
  not work, stop and report.
- **Rust unit tests:** artifact table covers every supported platform; a
  wrong digest is refused and leaves no files; traversal entries are refused;
  a second install is a no-op; the catalog entry carries the default env;
  `model_unavailable` is returned for a missing model.
- **buzz-acp unit test:** the captured OpenCode error classifies as
  `free_model_ended` and yields exactly one notice.
- **e2e (mock bridge, smoke and integration projects):** Start free is the
  default; install progress, then test, then Welcome; download failure shows
  Retry and Use your own AI; `model_unavailable` shows the ended screen;
  every existing subscription and OpenRouter flow still passes under Use
  your own AI.
- **Packaged gate:** fresh app profile, real download, real reply, agent
  completes a tool task. Windows and Linux are CI-only and reported as not
  verified on real machines.

## Rollout

Branch `feat/start-free-opencode` from `main` (1.0.8) so a 1.0.9 can ship
without the work only on develop. PR into develop, CI green, merge, then a
1.0.9 candidate and the packaged gate. Promotion to main only on the owner's
word.

## Not in scope

- Calling OpenCode's API from Colony, or imitating the OpenCode client.
- Switching to other free models, OpenCode Go, or any paid plan.
- Bundling OpenCode inside the Colony installer.
- Changes to Colony credits (still Coming soon) or BYOK in Settings.

## Risks

- OpenCode can end the offer or change its terms at any time. The ended
  state covers the user experience; nothing else depends on the offer.
- Speed: community reports 50 to 60 tokens/s at busy hours. Not verified.
- Tool use quality on DeepSeek V4.1 Flash for long agent tasks: the spike
  decides.
