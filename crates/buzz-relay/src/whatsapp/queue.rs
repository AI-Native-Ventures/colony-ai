//! The approved WhatsApp queue seen by the industry of each lead, and choosing which waiting
//! messages leave it.
//!
//! Sending stays the owner's decision. Shrinking the queue is the safe direction, so everyone
//! who may prepare a batch (the owner, admins, their agents, Outreach members) may also take
//! waiting messages out again when the owner asks. Nothing in this module sends, approves or
//! puts a message back.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use buzz_core::business_records::{prospect_d_tag, ProspectHead};
use buzz_core::kind::KIND_PROSPECT_HEAD;
use buzz_core::tenant::CommunityId;
use buzz_db::whatsapp_queue::QueuedRow;

use super::desk::{d_tag_of, relay_heads};
use crate::state::AppState;

/// Most waiting rows one summary or removal reads. A larger queue is refused with
/// [`TOO_LARGE`] instead of being read in part, so a removal never acts on half a picture.
pub const MAX_QUEUE_ROWS: usize = 5000;
/// Most lead records read in one query.
const LEAD_HEADS_PER_QUERY: usize = 200;
/// Most industries one command names.
pub const MAX_LABELS: usize = 50;
/// Longest industry name a command may carry.
const MAX_LABEL_CHARS: usize = 120;
/// Most groups named in a one-line answer.
const MAX_GROUPS_DESCRIBED: usize = 12;
/// Name of the group of waiting messages whose contact has no lead record.
pub const NO_LEAD_LABEL: &str = "No lead record";
/// Refusal text for a queue past [`MAX_QUEUE_ROWS`].
pub const TOO_LARGE: &str =
    "the queue holds more than 5000 waiting messages; name one batch with batchId";

/// Industry and vertical of the lead behind a waiting message.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LeadLabels {
    /// Industry taxonomy label, for example "Furniture".
    pub industry: String,
    /// Vertical taxonomy label, for example "Furniture & Upholstery Repair Businesses".
    pub vertical: String,
}

/// A waiting message with the labels of its lead, when it has one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LabelledRow {
    /// The waiting message.
    pub row: QueuedRow,
    /// Labels of the linked lead. `None` when the contact has no readable lead record.
    pub labels: Option<LeadLabels>,
}

/// Why the queue could not be read.
#[derive(Debug)]
pub enum LoadError {
    /// More than [`MAX_QUEUE_ROWS`] messages wait.
    TooLarge,
    /// The database or a lead record could not be read.
    Internal(String),
}

/// Which waiting messages a removal names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selection {
    /// Keep these industries, take every other waiting message out.
    Keep(Vec<String>),
    /// Take these industries out, keep the rest.
    Remove(Vec<String>),
    /// Take every waiting message in scope out.
    All,
}

fn norm(label: &str) -> String {
    label.trim().to_lowercase()
}

impl Selection {
    /// Read the three selectors of a command. Exactly one of them must be given.
    pub fn parse(keep: &[String], remove: &[String], all: bool) -> Result<Self, String> {
        let given =
            usize::from(!keep.is_empty()) + usize::from(!remove.is_empty()) + usize::from(all);
        if given != 1 {
            return Err("give exactly one of keep, remove or all".to_owned());
        }
        if all {
            return Ok(Self::All);
        }
        let keep_mode = !keep.is_empty();
        let labels = if keep_mode { keep } else { remove };
        if labels.len() > MAX_LABELS {
            return Err(format!(
                "name at most {MAX_LABELS} industries in one command"
            ));
        }
        let mut cleaned = Vec::with_capacity(labels.len());
        for label in labels {
            let label = label.trim();
            if label.is_empty() || label.chars().count() > MAX_LABEL_CHARS {
                return Err(format!(
                    "each industry name must be 1 through {MAX_LABEL_CHARS} characters"
                ));
            }
            cleaned.push(label.to_owned());
        }
        Ok(if keep_mode {
            Self::Keep(cleaned)
        } else {
            Self::Remove(cleaned)
        })
    }
}

impl LabelledRow {
    /// Whether this message belongs to one of the wanted (already normalised) names. A name
    /// matches the industry or the vertical of the lead, whole and in any letter case.
    fn matches(&self, wanted: &HashSet<String>) -> bool {
        match &self.labels {
            Some(labels) => {
                wanted.contains(&norm(&labels.industry)) || wanted.contains(&norm(&labels.vertical))
            }
            None => wanted.contains(&norm(NO_LEAD_LABEL)),
        }
    }
}

/// Read the waiting messages (of one batch, or of all approved batches) with their lead labels.
pub async fn load(
    state: &Arc<AppState>,
    community: CommunityId,
    batch_id: Option<Uuid>,
) -> Result<Vec<LabelledRow>, LoadError> {
    let rows = state
        .db
        .whatsapp_list_queued_rows(community, batch_id, MAX_QUEUE_ROWS as i64 + 1)
        .await
        .map_err(|error| LoadError::Internal(format!("whatsapp queue query: {error}")))?;
    if rows.len() > MAX_QUEUE_ROWS {
        return Err(LoadError::TooLarge);
    }
    let mut by_d_tag: HashMap<String, String> = HashMap::new();
    for row in &rows {
        let Some(raw) = row.lead_id.as_deref() else {
            continue;
        };
        let Ok(lead) = Uuid::parse_str(raw) else {
            continue;
        };
        by_d_tag.insert(prospect_d_tag(*community.as_uuid(), lead), raw.to_owned());
    }
    let mut d_tags: Vec<String> = by_d_tag.keys().cloned().collect();
    d_tags.sort();
    let mut labels: HashMap<String, LeadLabels> = HashMap::new();
    for chunk in d_tags.chunks(LEAD_HEADS_PER_QUERY) {
        let heads = relay_heads(state, community, KIND_PROSPECT_HEAD, chunk.to_vec())
            .await
            .map_err(LoadError::Internal)?;
        for stored in heads {
            let (Some(d_tag), Ok(head)) = (
                d_tag_of(&stored),
                serde_json::from_str::<ProspectHead>(&stored.event.content),
            ) else {
                continue;
            };
            let Some(raw) = by_d_tag.get(&d_tag) else {
                continue;
            };
            let found = LeadLabels {
                industry: head.prospect.industry.trim().to_owned(),
                vertical: head.prospect.vertical.trim().to_owned(),
            };
            if found.industry.is_empty() && found.vertical.is_empty() {
                continue;
            }
            labels.insert(raw.clone(), found);
        }
    }
    Ok(rows
        .into_iter()
        .map(|row| {
            let found = row
                .lead_id
                .as_deref()
                .and_then(|lead| labels.get(lead))
                .cloned();
            LabelledRow { row, labels: found }
        })
        .collect())
}

/// The ids of the messages that leave the queue. `Err` lists the named industries that match
/// no waiting message: the whole command is then refused, because a mistyped name in a keep
/// list would otherwise empty the queue.
pub fn plan(rows: &[LabelledRow], selection: &Selection) -> Result<Vec<Uuid>, Vec<String>> {
    let (labels, keep) = match selection {
        Selection::All => return Ok(rows.iter().map(|row| row.row.message_id).collect()),
        Selection::Keep(labels) => (labels, true),
        Selection::Remove(labels) => (labels, false),
    };
    let mut wanted = HashSet::new();
    let mut unmatched = Vec::new();
    for label in labels {
        let one = HashSet::from([norm(label)]);
        if rows.iter().any(|row| row.matches(&one)) {
            wanted.extend(one);
        } else {
            unmatched.push(label.clone());
        }
    }
    if !unmatched.is_empty() {
        return Err(unmatched);
    }
    Ok(rows
        .iter()
        .filter(|row| row.matches(&wanted) != keep)
        .map(|row| row.row.message_id)
        .collect())
}

/// Waiting messages per industry and vertical, largest group first.
pub fn groups(rows: &[LabelledRow]) -> Vec<(Option<LeadLabels>, usize)> {
    let mut counts: BTreeMap<Option<LeadLabels>, usize> = BTreeMap::new();
    for row in rows {
        *counts.entry(row.labels.clone()).or_insert(0) += 1;
    }
    let mut out: Vec<(Option<LeadLabels>, usize)> = counts.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out
}

/// The `queue` read: how many messages wait, per industry and vertical.
pub fn summary_view(rows: &[LabelledRow]) -> Value {
    let groups: Vec<Value> = groups(rows)
        .into_iter()
        .map(|(labels, queued)| match labels {
            Some(labels) => json!({
                "industry": labels.industry,
                "vertical": labels.vertical,
                "queued": queued,
            }),
            None => json!({ "industry": NO_LEAD_LABEL, "vertical": "", "queued": queued }),
        })
        .collect();
    json!({ "queued": rows.len(), "groups": groups })
}

/// One line that names the largest groups, for command answers and refusals.
pub fn describe(rows: &[LabelledRow]) -> String {
    let mut by_name: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        let name = match &row.labels {
            Some(labels) if !labels.vertical.is_empty() => labels.vertical.clone(),
            Some(labels) => labels.industry.clone(),
            None => NO_LEAD_LABEL.to_owned(),
        };
        *by_name.entry(name).or_insert(0) += 1;
    }
    if by_name.is_empty() {
        return "nothing is queued".to_owned();
    }
    let mut named: Vec<(String, usize)> = by_name.into_iter().collect();
    named.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let total = named.len();
    let mut parts: Vec<String> = named
        .into_iter()
        .take(MAX_GROUPS_DESCRIBED)
        .map(|(name, queued)| format!("{name} {queued}"))
        .collect();
    if total > MAX_GROUPS_DESCRIBED {
        parts.push(format!("and {} more", total - MAX_GROUPS_DESCRIBED));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(industry: &str, vertical: &str) -> LabelledRow {
        LabelledRow {
            row: QueuedRow {
                message_id: Uuid::new_v4(),
                wa_id: "27821230000".into(),
                batch_id: Uuid::nil(),
                lead_id: Some(Uuid::new_v4().to_string()),
            },
            labels: Some(LeadLabels {
                industry: industry.into(),
                vertical: vertical.into(),
            }),
        }
    }

    fn unlinked() -> LabelledRow {
        LabelledRow {
            row: QueuedRow {
                message_id: Uuid::new_v4(),
                wa_id: "27821230009".into(),
                batch_id: Uuid::nil(),
                lead_id: None,
            },
            labels: None,
        }
    }

    fn queue() -> Vec<LabelledRow> {
        vec![
            row("Furniture", "Furniture & Upholstery Repair Businesses"),
            row("Furniture", "Furniture & Upholstery Repair Businesses"),
            row("Repair & Personal Services", "Locksmith Businesses"),
            row("Home & Garden", "Locksmith Businesses"),
            row("Repair & Personal Services", "Laundry services"),
            unlinked(),
        ]
    }

    fn ids(rows: &[LabelledRow], picks: &[usize]) -> Vec<Uuid> {
        picks.iter().map(|at| rows[*at].row.message_id).collect()
    }

    fn labels(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_owned()).collect()
    }

    #[test]
    fn keep_takes_out_everything_else_and_matches_industry_or_vertical_in_any_case() {
        let rows = queue();
        let selection = Selection::Keep(labels(&["furniture", "LOCKSMITH businesses"]));
        // GUARD: `matches` compares the industry and the vertical. Furniture is named by its
        // industry, locksmiths by their vertical (which sits under two industries).
        assert_eq!(plan(&rows, &selection), Ok(ids(&rows, &[4, 5])));
    }

    #[test]
    fn remove_takes_out_only_the_named_industries() {
        let rows = queue();
        let selection = Selection::Remove(labels(&["Laundry services"]));
        assert_eq!(plan(&rows, &selection), Ok(ids(&rows, &[4])));
        let unlinked_only = Selection::Remove(labels(&[NO_LEAD_LABEL]));
        assert_eq!(plan(&rows, &unlinked_only), Ok(ids(&rows, &[5])));
    }

    #[test]
    fn a_name_that_matches_nothing_refuses_the_whole_command() {
        let rows = queue();
        // GUARD: the `unmatched` refusal in `plan`. Without it this keep list would match only
        // furniture and silently take the locksmiths out as well.
        let selection = Selection::Keep(labels(&["Furniture", "Locks"]));
        assert_eq!(plan(&rows, &selection), Err(labels(&["Locks"])));
        let missing = Selection::Remove(labels(&["Recruitment Agencies"]));
        assert_eq!(
            plan(&rows, &missing),
            Err(labels(&["Recruitment Agencies"]))
        );
    }

    #[test]
    fn all_takes_out_every_waiting_message_in_scope() {
        let rows = queue();
        assert_eq!(
            plan(&rows, &Selection::All),
            Ok(ids(&rows, &[0, 1, 2, 3, 4, 5]))
        );
        assert_eq!(plan(&[], &Selection::All), Ok(Vec::new()));
    }

    #[test]
    fn a_command_names_exactly_one_selector_with_clean_names() {
        let furniture = labels(&[" Furniture "]);
        assert_eq!(
            Selection::parse(&furniture, &[], false),
            Ok(Selection::Keep(labels(&["Furniture"])))
        );
        assert_eq!(
            Selection::parse(&[], &furniture, false),
            Ok(Selection::Remove(labels(&["Furniture"])))
        );
        assert_eq!(Selection::parse(&[], &[], true), Ok(Selection::All));
        assert!(Selection::parse(&[], &[], false).is_err());
        assert!(Selection::parse(&furniture, &furniture, false).is_err());
        assert!(Selection::parse(&furniture, &[], true).is_err());
        assert!(Selection::parse(&labels(&["  "]), &[], false).is_err());
        let too_many: Vec<String> = (0..=MAX_LABELS).map(|n| format!("industry {n}")).collect();
        assert!(Selection::parse(&too_many, &[], false).is_err());
    }

    #[test]
    fn the_summary_counts_each_group_largest_first() {
        let rows = queue();
        let view = summary_view(&rows);
        assert_eq!(view["queued"], 6);
        assert_eq!(view["groups"][0]["industry"], "Furniture");
        assert_eq!(view["groups"][0]["queued"], 2);
        let unlinked_group = view["groups"]
            .as_array()
            .expect("groups")
            .iter()
            .find(|group| group["industry"] == NO_LEAD_LABEL)
            .expect("the group without a lead record is listed");
        assert_eq!(unlinked_group["queued"], 1);
        assert_eq!(
            describe(&rows),
            "Furniture & Upholstery Repair Businesses 2, Locksmith Businesses 2, Laundry services 1, No lead record 1"
        );
        assert_eq!(describe(&[]), "nothing is queued");
    }
}
