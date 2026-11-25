# Colony cloud agents: Fly app and image

Each cloud agent runs on its own Fly Machine inside one Fly app, `colony-agents`.
The relay creates, starts, stops and destroys those machines through the Fly
Machines API (spec: `docs/superpowers/specs/2026-11-25-cloud-agents-design.md`).
This page covers the one-time setup, how the image is built and rolled, and the
kill switch. Nothing here is automatic: the owner or the coordinator runs each
step, and production stays locked until the owner unlocks it.

## What a machine gets

- Image: `Dockerfile.colony-agent` (Sprig stages: `buzz-acp`, `buzz-agent`,
  `buzz-dev-mcp`, `rg`, the `colony` CLI, git signing helpers, plus `jq`).
  No Claude Code, Codex, OpenCode or plan sign-ins.
- Config: only `COLONY_CLOUD_BOOT_URL` and a single-use `COLONY_CLOUD_BOOT_TOKEN`
  (expires after 300 s). The harness redeems the token at startup and receives
  its key, relay URL and AI session from the relay. No secret is ever written
  into the machine config.
- Volume: one Fly volume per agent mounted at `/data` (`/data/home`,
  `/data/workspace`, the wake ledger). Restart policy `no`; the harness exits
  after 10 idle minutes and the machine stops.
- Network: the app is on its own isolated network. Machines reach the relay only
  through its public `https://` and `wss://` address, never a private network.

## One-time setup (owner)

Prerequisite: the Fly invoice is paid. An overdue invoice blocks every create.

1. Create the app on an isolated network (not the relay's network):

   ```sh
   fly apps create colony-agents --network colony-agents-isolated
   ```

2. Create a token scoped to that app only. Deploy-scoped tokens for the relay
   apps must not be reused here:

   ```sh
   fly tokens create deploy --app colony-agents --name colony-cloud-agents
   ```

3. Store the token in two places (never in the repo, a workflow input or a PR):
   - GitHub repository secret `COLONY_CLOUD_FLY_API_TOKEN`, so
     `.github/workflows/colony-agent-image.yml` can push images.
   - Relay Fly secret `COLONY_CLOUD_FLY_API_TOKEN`, so the relay can drive the
     Machines API. A machine-management token is a different thing from a
     registry push token; if Fly refuses one for the other job, create two
     tokens and use the matching one in each place.

4. Optional repository variable `COLONY_CLOUD_FLY_APP` (defaults to
   `colony-agents`).

## Relay secrets and settings

Set these on the relay app (canary first). All are read by the relay at start.

| Name | Purpose | Default |
|---|---|---|
| `COLONY_CLOUD_AGENTS` | `off`, `allowlist` or `on` | `off` |
| `COLONY_CLOUD_AGENTS_ALLOWLIST` | verified account emails, at most 64 | empty |
| `COLONY_CLOUD_FLY_API_TOKEN` | Machines API token for the agent app | none |
| `COLONY_CLOUD_FLY_APP` | agent Fly app | `colony-agents` |
| `COLONY_CLOUD_FLY_REGION` | machine region | `iad` |
| `COLONY_CLOUD_AGENT_IMAGE` | digest-pinned image, `...@sha256:...` | none |
| `COLONY_CLOUD_MACHINE_MEMORY_MB` | machine memory | `1024` |
| `COLONY_CLOUD_VOLUME_GB` | volume size | `1` |
| `COLONY_CLOUD_AGENTS_MAX_PER_ACCOUNT` | cloud agents per account | `2` |
| `COLONY_CLOUD_AGENTS_MAX_MACHINES` | machines across all accounts | `100` |
| `COLONY_CLOUD_DEFAULT_MODEL` | cloud model, must be in `COLONY_CREDITS_ALLOWED_MODELS` | none |

The image must be pinned by digest. A tag is refused, so a push to the registry
can never change what a running relay starts.

## Building and rolling the image

The workflow builds `linux/amd64` (Fly shared-cpu-1x), runs
`scripts/test-colony-agent-image.sh`, and then:

- On pull requests it stops after the smoke test. It never pushes.
- On a merge to `develop` that touches the agent crates or the Dockerfile it
  pushes `registry.fly.io/colony-agents:sha-<7>` and prints the digest-pinned
  reference in the job summary. If the repository secret is missing it says so
  in the summary and still passes.

Rolling a new image is a relay setting change, never a push side effect:

1. Copy the `registry.fly.io/colony-agents@sha256:...` line from the job summary.
2. Set it as `COLONY_CLOUD_AGENT_IMAGE` on the relay (canary first).
3. Running machines keep their image. Each machine takes the new digest the next
   time it is started after a sleep. Volumes are untouched.

To test the image locally without the relay (needs Docker, builds Rust, so it
is slow):

```sh
scripts/test-colony-agent-image.sh
```

## Kill switch and cost guard

- Set `COLONY_CLOUD_AGENTS=off` on the relay. The relay's reconcile pass stops
  every started machine. Volumes stay, so agents wake again when the flag is
  turned back on.
- Lower `COLONY_CLOUD_AGENTS_MAX_MACHINES` to stop new wakes beyond a count.
- Emergency, bypassing the relay: `fly machines list --app colony-agents` and
  `fly machines stop <id> --app colony-agents`. Do not destroy machines by hand
  unless you also delete the matching agent rows, or the relay will recreate them.

## Known gap in v1

The image has no headless browser. The Colony Agent reaches the web with shell
`curl`. A browser is a follow-up and is listed as not verified on the proof page.
