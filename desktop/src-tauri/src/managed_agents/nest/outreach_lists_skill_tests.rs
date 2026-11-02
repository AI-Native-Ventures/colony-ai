//! The owner points at lists, campaigns and templates in chat ("@Scout research these more",
//! "@Scout prepare WhatsApp messages for this list with that template"). The skill is what
//! tells Scout to open each link with its `get` command and to keep sending behind the owner's
//! approval. These tests go through the real writer ([`ensure_nest_at`]), so dropping the
//! section, a command or a rule fails here.

use super::*;

fn section() -> &'static str {
    let skill = COLONY_CLI_SKILL_MD;
    let start = skill
        .find("## Lists, campaigns and templates")
        .expect("the lists section exists");
    let rest = &skill[start..];
    let end = rest[3..].find("\n## ").map_or(rest.len(), |at| at + 3);
    &rest[..end]
}

#[test]
fn skill_teaches_every_list_campaign_and_template_command() {
    for command in [
        "colony lists get",
        "colony lists list",
        "colony lists create --name",
        "--from-campaign",
        "colony lists add|remove",
        "colony lists rename",
        "colony campaigns get",
        "colony campaigns list",
        "colony whatsapp templates get",
        "colony whatsapp batch create --list",
        "colony leads get --lead",
        "colony leads note --lead",
    ] {
        assert!(
            section().contains(command),
            "the skill is missing: {command}"
        );
    }
    assert_eq!(
        COLONY_CLI_SKILL_MD
            .matches("## Lists, campaigns and templates")
            .count(),
        1
    );
}

#[test]
fn skill_resolves_mentions_and_never_asks_for_ids() {
    let section = section();
    assert!(section.contains("never ask the person for an id or a link"));
    assert!(section.contains("`...://list/<id>`"));
    assert!(section.contains("`...://campaign/<id>`"));
    assert!(section.contains("`...://template/<name>?lang=en`"));
    assert!(section.contains("`...://lead/<id>`"));
    assert!(section.contains("\"these\", \"them\" or \"their records\" after a list chip"));
    assert!(section.contains("say exactly why in one line"));
}

#[test]
fn skill_names_templates_and_refuses_numbers() {
    let section = section();
    assert!(section.contains("A template is named, never numbered"));
    assert!(section.contains("there are no numbered templates"));
}

#[test]
fn skill_lets_scout_make_a_list_but_only_when_it_says_so() {
    let section = section();
    assert!(section.contains("You may create a list yourself when it makes the work clearer"));
    assert!(section.contains("Always say so in your reply and include the `reference` link"));
    assert!(section.contains("You cannot archive a list; only people do."));
}

#[test]
fn skill_keeps_sending_behind_the_owners_approval() {
    let section = section();
    assert!(section.contains("it waits for the owner or an admin to approve it"));
    assert!(section.contains("nothing is sent before then"));
    assert!(section.contains("never send, approve or retry a batch around the owner"));
    assert!(section.contains("skipped, and the command prints each one with the reason"));
}

#[test]
fn skill_teaches_research_then_write_back_to_the_records() {
    let section = section();
    assert!(section.contains("**Research and update records.**"));
    assert!(section.contains("`colony leads qualify`"));
    assert!(section.contains("never paste the research"));
}

#[test]
fn skill_section_keeps_the_brand_and_punctuation_rules() {
    let section = section();
    assert!(!section.to_ascii_lowercase().contains("buzz"));
    assert!(!section.contains('\u{2014}'), "no em dashes");
}

#[test]
fn skill_written_by_the_previous_release_is_regenerated_with_the_lists_section() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join(".colony");
    ensure_nest_at(&root).unwrap();

    // What the previous release left on disk: the skill without the section, at version 23.
    let skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::write(skill_dir.join("SKILL.md"), "# old skill without lists").unwrap();
    fs::write(skill_dir.join(".skill-version"), "23\n").unwrap();

    ensure_nest_at(&root).unwrap();

    let refreshed = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
    assert!(
        refreshed.contains("## Lists, campaigns and templates"),
        "adding the section must bump NEST_SKILL_VERSION so existing nests pick it up"
    );
}
