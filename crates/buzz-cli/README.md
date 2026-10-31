# Buzz CLI

Agent-first command-line interface for Buzz relay. JSON in, JSON out.

## Install

```bash
cargo install --path crates/buzz-cli
```

## Authentication

| Env Var | Mode | Use Case |
|---------|------|----------|
| `BUZZ_PRIVATE_KEY` | NIP-98 Schnorr signature | Agents with a keypair |

```bash
# Private key identity (NIP-98 signed requests)
export BUZZ_PRIVATE_KEY="nsec1..."
buzz channels list
```

## Usage

All output is JSON on stdout. Errors are JSON on stderr. Exit codes: 0=ok, 1=user error, 2=network, 3=auth, 4=other, 5=write conflict.

```bash
# Set relay URL (defaults to http://localhost:3000)
export BUZZ_RELAY_URL="https://relay.example.com"

# Messages
buzz messages send --channel <uuid> --content "Hello"
buzz messages send --channel <uuid> --content "Reply" --reply-to <event-id> --broadcast
buzz messages send --channel <uuid> --content - < message.md   # read body from stdin
buzz messages get --channel <uuid> --limit 20
buzz messages thread --channel <uuid> --event <event-id>
buzz messages thread --link 'buzz://message?channel=<uuid>&id=<event-id>&thread=<root-id>'
buzz messages search --query "architecture"
buzz messages search --author <pubkey|npub|name> --since <unix-ts>
buzz messages edit --event <event-id> --content "Updated text"
buzz messages delete --event <event-id>

# Diffs
buzz messages send-diff --channel <uuid> --diff - --repo https://github.com/org/repo --commit abc123 < diff.patch

# Channels
buzz channels list
buzz channels create --name "my-channel" --type stream --visibility open
buzz channels join --channel <uuid>
buzz channels topic --channel <uuid> --topic "New topic"

# Reactions
buzz reactions add --event <event-id> --emoji "👍"
buzz reactions get --event <event-id>

# GIFs (requires relay to advertise buzz-gif / KLIPY)
buzz gifs search                              # trending GIFs
buzz gifs search --query "celebration"        # search GIFs
buzz gifs share --slug <slug>                 # report selection to provider Recents
# Paste the `cdn_url` from a search result directly into messages send --content

# Custom emoji in messages
# buzz messages send scans outgoing content for :shortcode: patterns and
# automatically attaches NIP-30 ["emoji", shortcode, url] tags from the
# workspace palette — identical to the desktop composer behavior.

# Users & Presence
buzz users get                          # your own profile
buzz users get --pubkey <hex>           # single user
buzz users get --pubkey <hex> --pubkey <hex>  # batch (max 200)
buzz users get --name Honey --owner me  # exact-name lookup in your managed agents
buzz users set-presence --status online
buzz users set-status --text "heads down on the CLI" --emoji "🚀"
buzz users set-status --clear                 # remove your status

# DMs
buzz dms open --pubkey <hex>
buzz dms list

# Workflows
buzz workflows list --channel <uuid>
buzz workflows trigger --workflow <uuid>
buzz workflows approve --token <uuid>
buzz workflows approve --token <uuid> --approved false --note "needs revision"

# Employee duties and lessons
buzz duties propose --channel <uuid> --thread-root <event-id> --proposal <json-or-path>
buzz duties list --employee <pubkey>
buzz duties get --duty <uuid> --runs <limit>
buzz duties update --duty <uuid> --proposal <json-or-path>
buzz duties pause --duty <uuid>
buzz duties resume --duty <uuid>
buzz duties delete --duty <uuid>
buzz lessons create --employee <pubkey> --record <json-or-path>
buzz lessons list --employee <pubkey>
buzz lessons get --lesson <uuid>
buzz lessons update --lesson <uuid> --record <json-or-path>
buzz lessons approve --lesson <uuid> --confidence <low|moderate|high>
buzz lessons deprecate --lesson <uuid>
buzz lessons restore --lesson <uuid>

# Co-founder mode and function slots (changes are owner or admin only)
buzz cofounder get
buzz cofounder set --enabled true --money best-option --approve-every-hire true
buzz functions list
buzz functions get customer_success
buzz functions assign sales --lead <pubkey>
buzz functions cover operations
buzz functions clear finance
buzz functions hire-slot <hire-uuid> finance

# Access list and capability gaps (grant, revoke, approve, decline, done are owner or admin only)
buzz access list
buzz access revoke whatsapp --reason "paused outreach"
buzz access gap propose --gap gap.json
buzz access gap list
buzz access gap complete <gap-uuid>
buzz asks propose-hire --channel <uuid> --thread-root <event> --proposal hire.json --function finance

# Co-founder onboarding: business brief and onboarding progress (Scout proposes, owner decides)
buzz brief get
buzz brief propose --what-you-sell "Websites" --who-buys "Guesthouses" --how-you-talk "Friendly and short" --source "Your website"
buzz brief confirm
buzz onboarding get
buzz onboarding start
buzz onboarding ask --step money --text "How should I spend money?"
buzz onboarding propose-map --first sales --sales agent:<pubkey> --operations scout --customer-success empty --finance empty --brand empty
buzz onboarding answer --step money
buzz onboarding approve-map

# Discovery (counts against the company's monthly limit; exit 2 at the limit)
buzz discovery search --query guesthouses --location "Melville, Johannesburg" --limit 10 [--pages 2] [--country za] [--industry "Tourism and Hospitality" --vertical "Guesthouses and inns"] [--save]

# Leads (prospects found in Discovery)
buzz leads list --stage in_conversation --query cape
buzz leads get --lead <uuid|buzz://lead/uuid>
buzz leads note --lead <uuid> --content "Spoke to the owner, wants a quote" [--kind contact]
buzz leads stage --lead <uuid> --stage lost --reason "Budget"
buzz leads qualify --lead <uuid> --qualification qualified
buzz leads save --lead <uuid> [--unsave]

# WhatsApp outreach (official Cloud API; the relay is the only sender)
buzz whatsapp status
buzz whatsapp templates [--refresh]
buzz whatsapp batch create --template intro_offer --params-file rows.json [--material <url>] [--note "..."]
buzz whatsapp batch list [--state pending]
buzz whatsapp batch show --batch <uuid>
buzz whatsapp batch approve --batch <uuid> [--drop 3] [--edit-file edits.json]   # owner or admin
buzz whatsapp batch reject --batch <uuid>                                          # owner or admin
buzz whatsapp stage +27821234567 call_booked                                    # contacted|replied|wants_call|call_booked|quote_sent|client|no_thanks
buzz whatsapp rename +27821234567 "Plane Tree Hotel"                              # or --clear
buzz whatsapp send --contact +27821234567 --text "Thanks, here is the quote"      # inside the 24 hour window
buzz whatsapp send --contact +27821234567 --template intro_offer --param Thabo
buzz whatsapp inbox | contacts | thread --contact +27821234567
buzz whatsapp cap [45]                                                              # show or set (owner or admin)

# Forum
buzz messages vote --event <event-id> --direction up

# Canvas
buzz canvas get --channel <uuid>
buzz canvas set --channel <uuid> --content "# Welcome"

# Agent Memory (NIP-AE)
buzz mem ls
buzz mem get <slug>
buzz mem set <slug> "my-value"
buzz mem patch <slug> --base-hash <hex> < diff.patch  # or --no-base-hash
buzz mem rm <slug>

# Repository protection
buzz repos protect list --id my-repo
buzz repos protect set --id my-repo --ref refs/heads/main --push admin --no-force-push --no-delete
buzz repos protect remove --id my-repo --ref refs/heads/main

# Pipe to jq
buzz channels list | jq '.[].name'
```

`protect set` replaces every existing rule for the exact ref pattern. Any
constraint omitted from the command is removed. `protect list` reports malformed
stored rules in `validation_error` so an owner can remove and repair them.

## Commands

`buzz --help` prints this whole surface as an indented tree — every group with
its subcommands and their descriptions — so there is no need to run `--help`
once per group to find a command. `buzz -h` keeps the short group-level
summary, and `buzz <group> <subcommand> --help` has the flags and examples.
The table below mirrors that tree for readers who are not at a terminal.

| Group | Subcommand | Description |
|-------|-----------|-------------|
| `messages` | `send` | Send a message to a channel |
| | `send-diff` | Send a code diff with metadata |
| | `edit` | Edit a message you sent |
| | `delete` | Delete a message |
| | `get` | List messages in a channel |
| | `thread` | Get a message thread |
| | `search` | Full-text search, filterable by author |
| | `vote` | Vote on a forum post |
| `channels` | `list` | List channels |
| | `get` | Get channel details |
| | `create` | Create a channel |
| | `update` | Update channel name/description |
| | `topic` | Set channel topic |
| | `purpose` | Set channel purpose |
| | `join` | Join a channel |
| | `leave` | Leave a channel |
| | `archive` | Archive a channel |
| | `unarchive` | Unarchive a channel |
| | `delete` | Delete a channel |
| | `members` | List channel members |
| | `add-member` | Add a member |
| | `remove-member` | Remove a member |
| `canvas` | `get` | Get channel canvas |
| | `set` | Set channel canvas |
| `reactions` | `add` | React to a message |
| | `remove` | Remove a reaction |
| | `get` | List reactions |
| `gifs` | `search` | Search or browse trending GIFs (requires relay buzz-gif support) |
| | `share` | Report a selected GIF to the provider's Recents |
| `dms` | `list` | List DM conversations |
| | `open` | Open a DM (1–8 pubkeys) |
| | `add-member` | Add member to DM group |
| `users` | `get` | Get user profile(s) |
| | `set-profile` | Update your profile |
| | `presence` | Get presence status |
| | `set-presence` | Set presence status |
| | `set-status` | Set or clear your NIP-38 profile status |
| `workflows` | `list` | List workflows |
| | `get` | Get workflow definition |
| | `create` | Create a workflow |
| | `update` | Update a workflow |
| | `delete` | Delete a workflow |
| | `trigger` | Trigger a workflow |
| | `runs` | Get workflow run history |
| | `approve` | Approve/deny a workflow step |
| `duties` | `propose` | Propose a duty in an existing conversation thread |
| | `list` | List employee duty heads |
| | `get` | Get a duty and its workflow run history |
| | `update` | Update a duty schedule, channel or instructions |
| | `pause` / `resume` | Pause or resume a duty schedule |
| | `delete` | Delete a duty and retain its run history |
| `lessons` | `create` | Propose a structured lesson with evidence references |
| | `list` | List employee lessons |
| | `get` | Get a lesson and its evidence |
| | `update` | Edit a lesson and return it to candidate state |
| | `approve` | Approve a lesson and record confidence |
| | `deprecate` / `restore` | Deprecate a lesson or restore it as a candidate |
| `cofounder` | `get` | Print co-founder settings, or the defaults when none are saved |
| | `set` | Change co-founder settings (owner or admin only) |
| `functions` | `list` / `get` | Read the five function slots, empty when nobody covers one |
| | `assign` / `cover` / `clear` | Set a lead, let Scout cover, or empty a slot (owner or admin only) |
| | `hire-slot` | Record which slot an open hire proposal is for |
| `access` | `list` | List every tool and account agents can use; revoked ones show as revoked |
| | `grant` / `revoke` | Add or revoke an access entry (owner or admin only) |
| | `gap propose` / `list` / `show` / `complete` | Record a capability gap, follow it, finish the setup after the owner said done |
| | `gap approve` / `decline` / `done` | Approve the cost, decline, or mark the human step done (owner or admin only) |
| `brief` | `get` | Print the business brief and any proposal waiting for the owner |
| | `propose` | Offer a brief or a revision (Scout, only while co-founder mode is on) |
| | `confirm` / `edit` / `discard` | Confirm, rewrite or drop the proposal (owner or admin only) |
| `onboarding` | `get` | Print onboarding steps, the open question and the proposed map |
| | `start` / `ask` / `withdraw` / `propose-map` / `complete` | Scout runs onboarding, one question at a time (only while co-founder mode is on) |
| | `answer` / `approve-map` / `reject-map` | The owner answers and decides (owner or admin only) |
| `feed` | `get` | Get your activity feed |
| `social` | `publish` | Publish a NIP-01 note |
| | `set-contacts` | Set NIP-02 contact list |
| | `event` | Get a Nostr event |
| | `notes` | Get notes for a user |
| | `contacts` | Get NIP-02 contact list |
| `repos` | `create` | Announce a git repository (NIP-34) |
| | `get` | Get a repository announcement |
| | `list` | List repository announcements |
| | `default-branch get/set` | Read or select an existing default branch (requires relay support) |
| | `protect list` | List branch and tag protection rules |
| | `protect set` | Create or replace a protection rule |
| | `protect remove` | Remove a protection rule |
| `upload` | `file` | Upload a file to the Blossom store |
| `pack` | `validate` | Validate a persona pack (local, no relay) |
| | `inspect` | Inspect a persona pack (local, no relay) |
| `mem` | `ls` | List non-tombstoned memories |
| | `get` | Print memory value to stdout |
| | `hash` | Print SHA-256 hex of memory value |
| | `set` | Write a memory value (use `-` for stdin) |
| | `patch` | Apply unified diff to memory value |
| | `rm` | Publish a tombstone to delete memory |

## Architecture

```
buzz <group> <subcommand> [flags]
    │
    ├─ main.rs ──▶ commands/*.rs ──▶ client.rs ──▶ Buzz Relay REST API
    │  (clap)       (handlers)       (reqwest)
    │
    ├─ validate.rs   (UUID, hex, content size, percent-encode)
    └─ error.rs      (CliError → JSON stderr + exit code)

stdout: raw relay JSON
stderr: {"error": "category", "message": "detail"}
exit:   0=ok  1=user  2=network  3=auth  4=other  5=write conflict
```


### Default branch

After deploying relay support, select an existing published branch without
renaming or deleting any branch:

```bash
buzz repos default-branch get --owner <owner-hex> --id my-repo
buzz repos default-branch set --owner <owner-hex> --id my-repo --branch main
# For an explicitly reviewed version, use the manifest digest returned by get:
buzz repos default-branch set --owner <owner-hex> --id my-repo --branch main \
  --expected-manifest <manifest-digest>
```

`--owner` defaults to the signing identity, not an agent's attested human owner.
`set` without `--expected-manifest` reads the current version first. Success
returns `branch`, `head`, `manifest` and `changed`; `get` omits `changed`.
A stale version returns conflict (exit 5). Ambiguous write failures return
`delivery_unknown` with `retryable:false` and the original digest: **read before
retrying**, and do not blindly re-run against a newly fetched version.

The signer must be a current channel member and a repository manager, directly
or through an unrestricted, valid NIP-OA owner attestation; permission to push is
not permission to change the default. See the
[protocol and authorization contract](../../docs/git-on-object-storage.md#default-branch-management).
