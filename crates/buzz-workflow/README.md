# Workflow schema

Workflow definitions are YAML Nostr events. The active definition is kind
`30620`; a separate kind `30623` stores an owner's unpublished draft. A run
copies the active definition JSON and its SHA-256 version into
`workflow_runs`, so publish, pause, and resume do not change the definition a
run is executing.

Draft events may contain incomplete builder state, including an empty step
list while a workflow is being assembled. Saving a draft only requires a YAML
object. Publishing parses the draft with the workflow schema and rejects any
definition that is not runnable. An incomplete draft never becomes active.

## Triggers

Supported triggers are `message_posted`, `reaction_added`, `diff_posted`,
`schedule`, `webhook`, and `manual`. Schedule definitions use UTC cron or an
interval for technical clients. The plain-language builder maps its schedule
choices to this engine representation and does not display cron.

## Steps

Each definition has between 1 and 100 ordered steps. Step IDs use letters,
digits, and underscores. The executor supports `send_message`, `send_dm`,
`set_channel_topic`, `add_reaction`, `call_webhook`, `request_approval`,
`ask_agent`, and `delay`; action support still depends on the relay feature
configuration.

An agent task names a channel member by pubkey. The relay posts a workflow
request in the channel, records the request thread and assignee, and waits for
that member's reply. `timeout_secs` is optional, defaults to 900 seconds, and
must be at most 3600 seconds. A timeout makes the run terminal with status
`timed_out`.

Approval `from` accepts `any`, a single 64-character pubkey, `owner_or_admin`,
or `channel_member`. Community owner/admin resolution uses the relay roster;
channel-member resolution uses the workflow channel's current membership.
Approval timeout defaults to 24 hours and is capped at 30 days. Grant and deny
events record the acting pubkey on the approval row.

Example:

```yaml
name: Prepare a weekly update
trigger:
  on: manual
steps:
  - id: prepare
    action: ask_agent
    agent_pubkey: 79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798
    instruction: Prepare a concise weekly update for the team.
    expected_result: A short update with completed work and open questions.
    timeout_secs: 900
  - id: review
    action: request_approval
    from: owner_or_admin
    message: Review the update before it is posted.
    timeout: 24h
```

## Preview and limitations

`executor::preview_workflow` validates and evaluates a definition without an
engine, database handle, or action sink. Its response is marked `preview: true`
and `side_effects: false`. Unknown condition inputs are returned as
`needs_input`; action calls are never made.

The current approval commands support grant and deny. A changes-requested
revision loop is not implemented. Social post scheduling has no backing API.
The builder must surface these as unavailable rather than simulate them.
