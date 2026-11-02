# Scout Claude Design spike

Date: 2026-11-02

## Verdict

**CONDITIONAL YES.** Colony's managed Claude launch uses an ACP adapter that loads Claude Code user, project, and local settings. That adapter preserves MCP servers sent by ACP and merges Colony's private-folder deny rules into its own tool policy. Anthropic's current documentation says Claude.ai connectors are fetched in Agent SDK sessions when the active Claude Code authentication is a Claude subscription login. This is enough to establish a supported source path for Claude Design tools if those tools are available to the same account and enabled for Claude Code.

The exact `claude-artifacts` and DesignSync tools were not observed from a logged-in account. The safe harness deliberately had no account credentials and no network access, so those tool names remain unverified.

## Launch trace

- Desktop starts the configured ACP harness with no extra command-line flags. For a Claude runtime it sets `BUZZ_ACP_AGENT_COMMAND` to the resolved `claude-agent-acp` executable and `BUZZ_ACP_AGENT_ARGS` to an empty string. When `claude` is found, it also sets `CLAUDE_CODE_EXECUTABLE` to that path. See [runtime.rs](../desktop/src-tauri/src/managed_agents/runtime.rs#L375) and [runtime.rs](../desktop/src-tauri/src/managed_agents/runtime.rs#L619).
- The runtime catalog recognizes `claude-agent-acp` and `claude-code-acp`, uses `claude` as the underlying CLI, and does not configure a separate MCP command for Claude. See [catalog.rs](../desktop/src-tauri/src/managed_agents/discovery/catalog.rs#L50).
- In this environment the resolved adapter is `@agentclientprotocol/claude-agent-acp` 0.74.0, installed as a Node script, and its dependency is `@anthropic-ai/claude-agent-sdk` 0.3.257. The resolved Claude Code CLI is 2.1.316. The adapter receives no launch flags in Colony's managed path.
- The adapter's SDK options use `settingSources: ["user", "project", "local"]`. Its MCP map merges servers configured by the user with servers sent in ACP `session/new`. It does not set `strictMCPConfig`. The same source version preserves ACP `disallowedTools` and appends its own restrictions.
- `buzz-acp` sends Colony MCP servers in `session/new`. The scoped Colony browser server is added when the managed browser runtime is available. The Claude runtime has no global `buzz-dev-mcp` command today, so the claim here is limited to servers that Colony actually passes into the session. See [pool.rs](../crates/buzz-acp/src/pool.rs#L1556) and [acp.rs](../crates/buzz-acp/src/acp.rs#L797).
- Colony does not select Claude OAuth or API-key mode in the launch builder. The child inherits the desktop process environment and home directory; the adapter passes that environment to the Claude Agent SDK. The active auth method is therefore resolved by Claude Code from the user's normal environment and settings.
- Colony sends its private-folder deny rules through `_meta.claudeCode.options.disallowedTools`. The adapter merges those rules with its own deny rules. See [acp.rs](../crates/buzz-acp/src/acp.rs#L825) and [private_folders.rs](../crates/buzz-acp/src/private_folders.rs#L70).

## Safe adapter harness

Ran [scout-claude-agent-acp-tools.mjs](../scripts/spikes/scout-claude-agent-acp-tools.mjs) against the installed adapter. It launches the real adapter with no args, completes ACP `initialize` and `session/new`, supplies a harmless local MCP fixture, and prompts the agent to list its tools.

Observed:

```text
Adapter: 0.74.0
ACP initialize/session/new: completed
Session MCP tools/list: colony_probe
Tool listing prompt: no model response; network is intentionally denied
Auth: dummy API key, disposable HOME, outbound network denied
Owner Claude files and Keychain: sandbox denied access
```

The fixture proves the adapter starts and connects to an ACP-provided MCP server. It does not prove the signed-in account's Claude Design tools are visible. The harness did not copy or read owner credentials, `.claude` files, Keychain entries, or Colony application data. It made no Anthropic API request, spent nothing, and published nothing.

## What the owner would need for a live check

On the owner's own machine, use a fresh managed Claude session after Claude Code is signed in to the intended Claude subscription account. The account must expose Claude Design's tools to Claude Code, either through its claude.ai connectors or the user's Claude Code MCP settings. An active API key, API key helper, or third-party provider route does not establish the claude.ai connector path. The owner can then ask Scout to list the available tool names without asking it to call one.

Anthropic's current [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp#use-mcp-servers-from-claudeai) states that claude.ai connectors are fetched for subscription-authenticated Agent SDK sessions. Its current [legal and compliance documentation](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) also says products that run Claude Code require the relevant Commercial Terms and that third-party Agent SDK integrations should use API keys unless approved. This spike does not establish whether Colony's distribution or this use has that approval. No login flow or credential handling is added here.

## Not verified

- Whether the owner's current account exposes `claude-artifacts` or DesignSync to Claude Code.
- Whether a live, logged-in Colony session receives those exact tools.
- Any published artifact, external message, deployment, or product adoption.

## Owner addition: OpenDesign and Open CoDesign

### OpenDesign

Reviewed `nexu-io/open-design` at commit `5a0c47777975ddb91d09c1c16b423a3ef74bf572` (0.25.1). Its Apache-2.0 license permits bundling if Colony carries the license and required attribution, and marks modified files. See the [source](https://github.com/nexu-io/open-design/tree/5a0c47777975ddb91d09c1c16b423a3ef74bf572), [agent adapter contract](https://github.com/nexu-io/open-design/blob/5a0c47777975ddb91d09c1c16b423a3ef74bf572/docs/agent-adapters.md), and [license](https://github.com/nexu-io/open-design/blob/5a0c47777975ddb91d09c1c16b423a3ef74bf572/LICENSE).

- **Runtime fit:** Its native definitions include Claude Code, Codex CLI, OpenCode, and a BYOK OpenCode profile. The BYOK profile is configured inside OpenDesign. Colony's `buzz-agent` / `colony-credits` provider uses a relay-issued, owner-authorized session and is not a native OpenDesign adapter. A compatible endpoint and explicit credential bridge would be required; that path was not tested.
- **Output and review:** The daemon and web Studio keep project files and a live browser preview together. It produces HTML/CSS/JS/JSX and other project artifacts, with HTML, PDF, PPTX, ZIP, Markdown, and HyperFrames MP4 export paths. It imports a Claude Design export ZIP into a project. The import is a file handoff, not live access to Claude Design tools. Owner review could happen in the local Studio or by rendering its HTML/PDF inside Colony; there is no Colony approval action in the current integration.
- **Start and isolation:** The daemon can run as a local child/sidecar and exposes a stdio MCP server for project-file operations. `OD_DATA_DIR` can isolate its daemon-owned data. Colony has no existing launcher or review UI for it, so this would be a new managed sidecar integration, not a tool added to the current ACP session.
- **Permission boundary:** OpenDesign delegates the model/tool loop to the selected agent CLI. Its adapter documentation describes Claude's `bypassPermissions`, capability-gated OpenCode permission bypass, and Codex `workspace-write` with network access. A project working directory is not a uniform filesystem sandbox, and OpenDesign does not own a Colony-style per-path Read/Write/Edit deny list. Its default headless launch therefore cannot be treated as preserving Colony's private-folder rules. A managed integration would first need a contained workspace/process policy and an owner-visible review surface.
- **Throwaway runtime evidence:** Installed the daemon's workspace dependencies with scripts disabled, built the required workspace dependencies, then built the daemon. Ran it from the `/private/tmp` clone with Node 24.15.0, a disposable HOME and `OD_DATA_DIR`, telemetry explicitly false, and outbound networking denied. It listened on `127.0.0.1:17561`; the only socket owned by the process was that loopback listener. Telemetry logged an effective sink of `none`. After 36 seconds idle, the daemon used 63,264 KB RSS (about 62 MiB, 0.6% CPU in that sample); the initialized data directory was 9,348 KB (about 9.1 MiB). This excludes the web UI, any agent CLI, and model generation. The daemon seeded 478 bundled plugin records. No model ran, no account was used, and the process was stopped with Ctrl-C.

### Open CoDesign, comparison only

Reviewed `OpenCoworkAI/open-codesign` at commit `5daa34e6c07103f45a40201a4ffefb5c3855562b` (0.2.0), licensed MIT. Its Electron app is a local design workspace; its current CLI supports help, doctor, workspace inspection, HTML export, and development UI/session diagnostics. The CLI explicitly reports `designRun: false` and `mcpServer: false`; `run`, MCP transport, and non-HTML exports are unsupported there. See the [README](https://github.com/OpenCoworkAI/open-codesign/blob/5daa34e6c07103f45a40201a4ffefb5c3855562b/README.md), [CLI arguments](https://github.com/OpenCoworkAI/open-codesign/blob/5daa34e6c07103f45a40201a4ffefb5c3855562b/apps/cli/src/arguments.ts), and [MIT license](https://github.com/OpenCoworkAI/open-codesign/blob/5daa34e6c07103f45a40201a4ffefb5c3855562b/LICENSE).

Ran its CLI from the `/private/tmp` clone with Node 24, disposable HOME and XDG config, no credentials, telemetry opt-out flags, and outbound networking denied. `doctor` passed with an empty, valid config and reported no model configured, zero credentials, HTML export available, and design-run/MCP unavailable. Exporting a throwaway HTML source succeeded and warned that remote assets were not verified. No Electron model session was opened and no model ran. This makes it unsuitable as a managed Colony agent engine in its current CLI shape.

### Recommendation

Use Claude Design for Claude agents when the owner's account and Anthropic's applicable terms make those tools available. Keep the shared 1440px/390px render, screenshot, compare, and repair loop for every runtime. OpenDesign is the stronger candidate for non-Claude agents and as a Claude Design fallback because it already drives Claude Code, Codex, and OpenCode and can import Claude Design ZIPs. Do not launch it under Colony's managed-agent authority yet: first build an isolated sidecar/workspace policy that preserves Colony's private-folder boundaries, then present its board in Colony and require owner approval before implementation or publication. Do not use one engine for all runtimes. Open CoDesign remains a comparison, not a managed-agent recommendation.
