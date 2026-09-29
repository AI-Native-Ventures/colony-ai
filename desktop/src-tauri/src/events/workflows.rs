use nostr::{EventBuilder, EventId, Kind};

use super::{check_content, tag};

/// Kind 30620 — replaceable workflow definition.
///
/// The `d` tag carries the workflow id; `h` tag carries the channel id; the
/// content is the YAML definition. Same (pubkey, d) replaces the prior version.
pub fn build_workflow_definition(
    workflow_id: &str,
    channel_id: &str,
    yaml_definition: &str,
    expected_revision: Option<&str>,
) -> Result<EventBuilder, String> {
    check_content(yaml_definition)?;
    let mut tags = vec![tag(vec!["d", workflow_id])?, tag(vec!["h", channel_id])?];
    if let Some(revision) = expected_revision {
        EventId::from_hex(revision).map_err(|_| "invalid workflow revision".to_string())?;
        tags.push(tag(vec!["expected-revision", revision])?);
    }
    Ok(EventBuilder::new(Kind::Custom(30620), yaml_definition.to_string()).tags(tags))
}

/// Kind 30623: save an unpublished workflow draft without changing its active version.
pub fn build_workflow_draft(
    workflow_id: &str,
    channel_id: &str,
    yaml_definition: &str,
    expected_revision: Option<&str>,
) -> Result<EventBuilder, String> {
    check_content(yaml_definition)?;
    let mut tags = vec![tag(vec!["d", workflow_id])?, tag(vec!["h", channel_id])?];
    if let Some(revision) = expected_revision {
        EventId::from_hex(revision).map_err(|_| "invalid workflow draft revision".to_string())?;
        tags.push(tag(vec!["expected-revision", revision])?);
    }
    Ok(EventBuilder::new(Kind::Custom(30623), yaml_definition.to_string()).tags(tags))
}

/// Kind 46021: change the lifecycle status while retaining the active definition.
pub fn build_workflow_status(
    workflow_id: &str,
    channel_id: &str,
    status: &str,
) -> Result<EventBuilder, String> {
    if !matches!(status, "active" | "paused") {
        return Err("workflow status must be active or paused".to_string());
    }
    let content = serde_json::json!({ "status": status }).to_string();
    let tags = vec![
        tag(vec!["workflow", workflow_id])?,
        tag(vec!["h", channel_id])?,
    ];
    Ok(EventBuilder::new(Kind::Custom(46021), content).tags(tags))
}

/// Kind 5 — NIP-09 deletion targeting a kind:30620 workflow definition.
pub fn build_workflow_delete(
    workflow_id: &str,
    owner_pubkey_hex: &str,
) -> Result<EventBuilder, String> {
    let coord = format!("30620:{owner_pubkey_hex}:{workflow_id}");
    let tags = vec![tag(vec!["a", &coord])?];
    Ok(EventBuilder::new(Kind::Custom(5), "").tags(tags))
}

/// Kind 46020 — trigger a workflow run by id.
pub fn build_workflow_trigger(workflow_id: &str) -> Result<EventBuilder, String> {
    let tags = vec![tag(vec!["d", workflow_id])?];
    Ok(EventBuilder::new(Kind::Custom(46020), "").tags(tags))
}

/// Kind 46030 — grant an approval token (with optional note).
pub fn build_approval_grant(token: &str, note: Option<&str>) -> Result<EventBuilder, String> {
    let tags = vec![tag(vec!["d", token])?];
    Ok(EventBuilder::new(Kind::Custom(46030), note.unwrap_or("")).tags(tags))
}

/// Kind 46031 — deny an approval token (with optional note).
pub fn build_approval_deny(token: &str, note: Option<&str>) -> Result<EventBuilder, String> {
    let tags = vec![tag(vec!["d", token])?];
    Ok(EventBuilder::new(Kind::Custom(46031), note.unwrap_or("")).tags(tags))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    const WORKFLOW_ID: &str = "22222222-2222-2222-2222-222222222222";
    const CHANNEL_ID: &str = "11111111-1111-1111-1111-111111111111";

    #[test]
    fn draft_builder_keeps_its_own_revision_fence() {
        let revision = "ab".repeat(32);
        let event = build_workflow_draft(
            WORKFLOW_ID,
            CHANNEL_ID,
            "name: Draft\ntrigger:\n  on: manual\nsteps:\n  - id: a\n    action: delay\n    duration: 1m\n",
            Some(&revision),
        )
        .expect("build draft")
        .sign_with_keys(&Keys::generate())
        .expect("sign draft");

        assert_eq!(event.kind, Kind::Custom(30623));
        assert_eq!(tag_value(&event, "d"), Some(WORKFLOW_ID.to_string()));
        assert_eq!(tag_value(&event, "h"), Some(CHANNEL_ID.to_string()));
        assert_eq!(tag_value(&event, "expected-revision"), Some(revision));
    }

    #[test]
    fn lifecycle_event_names_workflow_channel_and_status() {
        let event = build_workflow_status(WORKFLOW_ID, CHANNEL_ID, "paused")
            .expect("build status")
            .sign_with_keys(&Keys::generate())
            .expect("sign status");

        assert_eq!(event.kind, Kind::Custom(46021));
        assert_eq!(tag_value(&event, "workflow"), Some(WORKFLOW_ID.to_string()));
        assert_eq!(tag_value(&event, "h"), Some(CHANNEL_ID.to_string()));
        assert_eq!(event.content, "{\"status\":\"paused\"}");
        assert!(build_workflow_status(WORKFLOW_ID, CHANNEL_ID, "deleted").is_err());
    }

    #[test]
    fn approval_decisions_use_the_relay_token_reference_tag() {
        let token_hash = "ab".repeat(32);
        for (builder, kind, note) in [
            (
                build_approval_grant(&token_hash, Some("Approved")),
                46030,
                "Approved",
            ),
            (
                build_approval_deny(&token_hash, Some("Needs changes")),
                46031,
                "Needs changes",
            ),
        ] {
            let event = builder
                .expect("build approval decision")
                .sign_with_keys(&Keys::generate())
                .expect("sign approval decision");
            assert_eq!(event.kind, Kind::Custom(kind));
            assert_eq!(tag_value(&event, "d"), Some(token_hash.clone()));
            assert_eq!(tag_value(&event, "t"), None);
            assert_eq!(event.content, note);
        }
    }

    fn tag_value(event: &nostr::Event, name: &str) -> Option<String> {
        event.tags.iter().find_map(|tag| {
            let value = tag.as_slice();
            (value.len() >= 2 && value[0] == name).then(|| value[1].clone())
        })
    }
}
