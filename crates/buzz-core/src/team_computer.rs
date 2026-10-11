//! Typed team computer record (kinds 30658 and 47047).
//!
//! A company's employees run on exactly one computer. The relay keeps one
//! relay-signed head naming that computer. An owner or admin claims it from
//! the computer that will run the team, that computer heartbeats it, and the
//! holder releases it. Moving the team to another computer is a forced claim.

use serde::{Deserialize, Serialize};

use crate::company_records::{is_hex_id, CompanyRecordError};

/// The `d` coordinate of the single team computer head per company.
pub const TEAM_COMPUTER_D_TAG: &str = "team-computer";
/// Minimum seconds between two heartbeats from the holding computer.
pub const TEAM_COMPUTER_HEARTBEAT_MIN_SECS: i64 = 60;
/// Maximum characters in a computer's display name.
pub const MAX_COMPUTER_NAME_CHARS: usize = 80;

/// What a team computer action does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeamComputerActionKind {
    /// Take the team for this computer.
    Claim,
    /// Report that the holding computer is still running the team.
    Heartbeat,
    /// Give the team up from the holding computer.
    Release,
}

/// Owner- or admin-signed team computer action: the content of kind 47047.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TeamComputerAction {
    /// What the action does.
    pub action: TeamComputerActionKind,
    /// Lowercase hyphenated UUID v4 the host generated once per install.
    pub computer_id: String,
    /// Name people see, for example "Lerato's MacBook Air".
    pub computer_name: String,
    /// On a claim, take the team even though another computer holds it.
    #[serde(default)]
    pub force: bool,
}

/// Which computer runs the team: the content of head kind 30658.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TeamComputerHead {
    /// The holding computer's install id.
    pub computer_id: String,
    /// The holding computer's display name.
    pub computer_name: String,
    /// Person who claimed the team for this computer.
    pub claimed_by: String,
    /// Relay time of the claim, in Unix seconds.
    pub claimed_at: i64,
    /// Relay time of the latest claim or heartbeat, in Unix seconds.
    pub last_seen_at: i64,
    /// Relay time the holder released the team; absent while it is held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released_at: Option<i64>,
}

/// Why a team computer action was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TeamComputerRefusal {
    /// Another computer holds the team and the claim was not forced.
    HeldElsewhere {
        /// Name of the computer that holds the team.
        computer_name: String,
    },
    /// No computer holds the team.
    NoClaim,
    /// Only the holding computer may heartbeat or release.
    NotTheHolder,
    /// The previous heartbeat was less than a minute ago.
    HeartbeatTooSoon {
        /// Seconds until the next heartbeat is accepted.
        retry_after_secs: i64,
    },
}

/// Check an action's fields.
pub fn validate_team_computer_action(
    action: &TeamComputerAction,
) -> Result<(), CompanyRecordError> {
    let id = uuid::Uuid::parse_str(&action.computer_id)
        .map_err(|_| CompanyRecordError::Invalid("computerId must be a UUID v4"))?;
    if id.get_version_num() != 4 || id.to_string() != action.computer_id {
        return Err(CompanyRecordError::Invalid(
            "computerId must be a lowercase hyphenated UUID v4",
        ));
    }
    if action.computer_name.trim().is_empty()
        || action.computer_name.chars().count() > MAX_COMPUTER_NAME_CHARS
        || action.computer_name.chars().any(char::is_control)
    {
        return Err(CompanyRecordError::Invalid(
            "computerName must be 1 to 80 characters without control characters",
        ));
    }
    if action.force && action.action != TeamComputerActionKind::Claim {
        return Err(CompanyRecordError::Invalid(
            "force is only allowed on claim",
        ));
    }
    Ok(())
}

/// Check a stored head.
pub fn validate_team_computer_head(head: &TeamComputerHead) -> Result<(), CompanyRecordError> {
    validate_team_computer_action(&TeamComputerAction {
        action: TeamComputerActionKind::Claim,
        computer_id: head.computer_id.clone(),
        computer_name: head.computer_name.clone(),
        force: false,
    })?;
    if !is_hex_id(&head.claimed_by) {
        return Err(CompanyRecordError::Invalid(
            "claimedBy must be a 64-character lowercase hex public key",
        ));
    }
    if head.claimed_at <= 0
        || head.last_seen_at < head.claimed_at
        || head
            .released_at
            .is_some_and(|released| released < head.claimed_at)
    {
        return Err(CompanyRecordError::Invalid(
            "team computer times are out of order",
        ));
    }
    Ok(())
}

/// Apply a validated action to the current head at relay time `now`.
pub fn apply_team_computer_action(
    current: Option<&TeamComputerHead>,
    action: &TeamComputerAction,
    actor_pubkey: &str,
    now: i64,
) -> Result<TeamComputerHead, TeamComputerRefusal> {
    let held = current.filter(|head| head.released_at.is_none());
    match action.action {
        TeamComputerActionKind::Claim => match held {
            Some(head) if head.computer_id != action.computer_id && !action.force => {
                Err(TeamComputerRefusal::HeldElsewhere {
                    computer_name: head.computer_name.clone(),
                })
            }
            Some(head) if head.computer_id == action.computer_id => Ok(TeamComputerHead {
                computer_id: head.computer_id.clone(),
                computer_name: action.computer_name.clone(),
                claimed_by: head.claimed_by.clone(),
                claimed_at: head.claimed_at,
                last_seen_at: now.max(head.last_seen_at),
                released_at: None,
            }),
            _ => Ok(TeamComputerHead {
                computer_id: action.computer_id.clone(),
                computer_name: action.computer_name.clone(),
                claimed_by: actor_pubkey.to_owned(),
                claimed_at: now,
                last_seen_at: now,
                released_at: None,
            }),
        },
        TeamComputerActionKind::Heartbeat => {
            let head = held.ok_or(TeamComputerRefusal::NoClaim)?;
            if head.computer_id != action.computer_id {
                return Err(TeamComputerRefusal::NotTheHolder);
            }
            let elapsed = now - head.last_seen_at;
            if elapsed < TEAM_COMPUTER_HEARTBEAT_MIN_SECS {
                return Err(TeamComputerRefusal::HeartbeatTooSoon {
                    retry_after_secs: TEAM_COMPUTER_HEARTBEAT_MIN_SECS - elapsed,
                });
            }
            Ok(TeamComputerHead {
                computer_name: action.computer_name.clone(),
                last_seen_at: now,
                ..head.clone()
            })
        }
        TeamComputerActionKind::Release => {
            let head = held.ok_or(TeamComputerRefusal::NoClaim)?;
            if head.computer_id != action.computer_id {
                return Err(TeamComputerRefusal::NotTheHolder);
            }
            let released_at = now.max(head.last_seen_at);
            Ok(TeamComputerHead {
                last_seen_at: released_at,
                released_at: Some(released_at),
                ..head.clone()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: &str = "3f6e0b8a-6c52-4b5f-9a0e-2d1c4b7e9f10";
    const DESKTOP: &str = "8b2d9c4e-1f3a-4e6b-8c7d-5a9e0f1b2c3d";
    const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
    const PARTNER: &str = "2222222222222222222222222222222222222222222222222222222222222222";

    fn action(kind: TeamComputerActionKind, computer_id: &str, force: bool) -> TeamComputerAction {
        let computer_name = if computer_id == LAPTOP {
            "Lerato's MacBook Air"
        } else {
            "Kagiso's laptop"
        };
        TeamComputerAction {
            action: kind,
            computer_id: computer_id.to_owned(),
            computer_name: computer_name.to_owned(),
            force,
        }
    }

    fn held_by_laptop(last_seen_at: i64) -> TeamComputerHead {
        TeamComputerHead {
            computer_id: LAPTOP.to_owned(),
            computer_name: "Lerato's MacBook Air".to_owned(),
            claimed_by: OWNER.to_owned(),
            claimed_at: 1_000,
            last_seen_at,
            released_at: None,
        }
    }

    #[test]
    fn first_claim_takes_a_free_team() {
        let head = apply_team_computer_action(
            None,
            &action(TeamComputerActionKind::Claim, LAPTOP, false),
            OWNER,
            1_000,
        )
        .expect("a free team can be claimed");
        assert_eq!(head, held_by_laptop(1_000));
    }

    #[test]
    fn a_second_computer_cannot_take_a_held_team_without_force() {
        let current = held_by_laptop(1_100);
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Claim, DESKTOP, false),
                PARTNER,
                1_200,
            ),
            Err(TeamComputerRefusal::HeldElsewhere {
                computer_name: "Lerato's MacBook Air".to_owned()
            })
        );
        let moved = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Claim, DESKTOP, true),
            PARTNER,
            1_200,
        )
        .expect("a forced claim moves the team");
        assert_eq!(moved.computer_id, DESKTOP);
        assert_eq!(moved.claimed_by, PARTNER);
        assert_eq!(
            (moved.claimed_at, moved.last_seen_at, moved.released_at),
            (1_200, 1_200, None)
        );
    }

    #[test]
    fn the_holder_can_claim_again_after_a_restart() {
        let current = held_by_laptop(1_100);
        let refreshed = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Claim, LAPTOP, false),
            OWNER,
            1_150,
        )
        .expect("the holder re-claims");
        assert_eq!(refreshed.claimed_at, 1_000);
        assert_eq!(refreshed.last_seen_at, 1_150);
        assert_eq!(refreshed.claimed_by, OWNER);
    }

    #[test]
    fn heartbeats_come_only_from_the_holder_and_at_most_once_a_minute() {
        let current = held_by_laptop(1_000);
        assert_eq!(
            apply_team_computer_action(
                None,
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NoClaim)
        );
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Heartbeat, DESKTOP, false),
                PARTNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NotTheHolder)
        );
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_030,
            ),
            Err(TeamComputerRefusal::HeartbeatTooSoon {
                retry_after_secs: 30
            })
        );
        let beat = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
            OWNER,
            1_060,
        )
        .expect("a heartbeat a minute later");
        assert_eq!(beat.last_seen_at, 1_060);
        assert_eq!(beat.claimed_by, OWNER);
    }

    #[test]
    fn a_release_frees_the_team_for_any_computer() {
        let current = held_by_laptop(1_000);
        assert_eq!(
            apply_team_computer_action(
                Some(&current),
                &action(TeamComputerActionKind::Release, DESKTOP, false),
                PARTNER,
                1_100,
            ),
            Err(TeamComputerRefusal::NotTheHolder)
        );
        let released = apply_team_computer_action(
            Some(&current),
            &action(TeamComputerActionKind::Release, LAPTOP, false),
            OWNER,
            1_100,
        )
        .expect("the holder releases");
        assert_eq!(released.released_at, Some(1_100));
        assert_eq!(
            apply_team_computer_action(
                Some(&released),
                &action(TeamComputerActionKind::Heartbeat, LAPTOP, false),
                OWNER,
                1_200,
            ),
            Err(TeamComputerRefusal::NoClaim)
        );
        let taken = apply_team_computer_action(
            Some(&released),
            &action(TeamComputerActionKind::Claim, DESKTOP, false),
            PARTNER,
            1_200,
        )
        .expect("a released team is free again");
        assert_eq!(
            (taken.computer_id.as_str(), taken.released_at),
            (DESKTOP, None)
        );
    }

    #[test]
    fn actions_and_heads_are_validated() {
        validate_team_computer_action(&action(TeamComputerActionKind::Claim, LAPTOP, false))
            .expect("a valid claim");
        let mut not_a_uuid = action(TeamComputerActionKind::Claim, LAPTOP, false);
        not_a_uuid.computer_id = "laptop-1".into();
        assert!(validate_team_computer_action(&not_a_uuid).is_err());
        let mut upper = action(TeamComputerActionKind::Claim, LAPTOP, false);
        upper.computer_id = LAPTOP.to_uppercase();
        assert!(validate_team_computer_action(&upper).is_err());
        let mut version_one = action(TeamComputerActionKind::Claim, LAPTOP, false);
        version_one.computer_id = "3f6e0b8a-6c52-1b5f-9a0e-2d1c4b7e9f10".into();
        assert!(validate_team_computer_action(&version_one).is_err());
        let mut nameless = action(TeamComputerActionKind::Claim, LAPTOP, false);
        nameless.computer_name = " ".into();
        assert!(validate_team_computer_action(&nameless).is_err());
        assert!(
            validate_team_computer_action(&action(TeamComputerActionKind::Heartbeat, LAPTOP, true))
                .is_err(),
            "force is only allowed on a claim"
        );
        validate_team_computer_head(&held_by_laptop(1_000)).expect("a valid head");
        assert!(
            validate_team_computer_head(&held_by_laptop(900)).is_err(),
            "last seen cannot be before the claim"
        );
    }

    #[test]
    fn json_uses_the_contract_names_and_omits_the_release_while_held() {
        assert_eq!(
            serde_json::to_value(held_by_laptop(1_000)).expect("serialize head"),
            serde_json::json!({
                "computerId": LAPTOP,
                "computerName": "Lerato's MacBook Air",
                "claimedBy": OWNER,
                "claimedAt": 1_000,
                "lastSeenAt": 1_000
            })
        );
        assert_eq!(
            serde_json::to_value(action(TeamComputerActionKind::Claim, LAPTOP, false))
                .expect("serialize action"),
            serde_json::json!({
                "action": "claim",
                "computerId": LAPTOP,
                "computerName": "Lerato's MacBook Air",
                "force": false
            })
        );
    }
}
