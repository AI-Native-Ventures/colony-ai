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
