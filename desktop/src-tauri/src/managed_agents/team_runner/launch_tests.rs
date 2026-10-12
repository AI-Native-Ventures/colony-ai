//! Start on launch and pause decisions (review focus 5).

use super::claim::{spawn_refusal, ClaimView, PAUSED_REFUSAL};
use super::companies::{self, CompaniesFile, COMPANIES_FILE};
use super::launch::{activation_plan, still_paused_message, ActivationPlan};
use super::{PauseReason, TeamCompany, TeamComputerInfo};

const RELAY: &str = "wss://lerato.colony.example";
const OWNER: &str = "1111111111111111111111111111111111111111111111111111111111111111";
const ME: &str = "3f6e2a1c-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER: &str = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

fn held_by(id: &str) -> ClaimView {
    ClaimView {
        holder: Some(TeamComputerInfo {
            computer_id: id.into(),
            computer_name: "Lerato's MacBook Air".into(),
            last_seen_at: 1_760_180_300,
        }),
        fetched_at: 1_760_180_301,
    }
}

#[test]
fn a_paused_team_stays_paused_after_a_restart() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join(COMPANIES_FILE);
    let mut file = CompaniesFile::default();
    file.replace(vec![TeamCompany {
        relay_url: RELAY.into(),
        owner_pubkey: OWNER.into(),
    }])
    .expect("valid");
    file.add_pause(RELAY, PauseReason::Person).expect("saved");
    companies::save(&path, &file).expect("save");

    // The computer restarts: the host reads everything back from disk.
    let reloaded = companies::load(&path).expect("load");
    let company = reloaded.find(RELAY).expect("saved");
    assert_eq!(
        activation_plan(&held_by(ME), ME, &company.pause_reasons, false),
        ActivationPlan::Paused { credits: false }
    );
    assert_eq!(
        spawn_refusal(company, Some(&held_by(ME)), Some(ME)).as_deref(),
        Some(PAUSED_REFUSAL),
        "no other start path can start it either"
    );
}

#[test]
fn activation_starts_the_team_only_on_its_own_computer() {
    assert_eq!(
        activation_plan(&held_by(ME), ME, &[], false),
        ActivationPlan::StartTeam
    );
    assert_eq!(
        activation_plan(&held_by(OTHER), ME, &[], false),
        ActivationPlan::Away
    );
    assert_eq!(
        activation_plan(&held_by(OTHER), ME, &[PauseReason::Person], false),
        ActivationPlan::Away,
        "another computer runs it, paused or not"
    );
    let released = ClaimView {
        holder: None,
        fetched_at: 1,
    };
    assert_eq!(
        activation_plan(&released, ME, &[], false),
        ActivationPlan::Retry
    );
}

#[test]
fn a_credits_pause_is_watched_instead_of_started() {
    assert_eq!(
        activation_plan(&held_by(ME), ME, &[PauseReason::Credits], false),
        ActivationPlan::Paused { credits: true }
    );
    assert_eq!(
        activation_plan(&held_by(ME), ME, &[], true),
        ActivationPlan::Paused { credits: true },
        "the credits seam can report a credits pause by itself"
    );
}

#[test]
fn resume_names_the_reason_that_still_holds_the_team() {
    assert_eq!(still_paused_message(&[]), None);
    assert_eq!(
        still_paused_message(&[PauseReason::Credits]).as_deref(),
        Some("Your team is still paused because your credits ran out. Add credits to continue.")
    );
    assert_eq!(
        still_paused_message(&[PauseReason::PlanLimit]).as_deref(),
        Some("Your team is still paused because your plan limit was reached.")
    );
}
