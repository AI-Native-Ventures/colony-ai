//! Pipeline stage of one WhatsApp contact (the Outreach desk). Pure rules, no I/O.
//!
//! The relay is the source of truth: it gathers the facts about a contact and calls
//! [`derive_stage`]; the apps only draw what comes back. Order of precedence:
//!
//! 1. Opted out: `stopped` (STOP, "Stop messages", unsubscribe ...) or `no_thanks` (a
//!    "No thanks" / "Not interested" answer). Both already block sending; only the label differs.
//! 2. `not_on_whatsapp`: the latest send failed with a Meta "undeliverable" code.
//! 3. A manual stage set by a person, unless a newer fact implies a later stage.
//! 4. Derived, latest first: `client`, `quote_sent`, `call_booked`, `no_thanks` (lead lost),
//!    `wants_call`, `replied`, `contacted`, else `none`.
//!
//! A manual stage is never moved backwards automatically: a fact overrides it only when it is
//! strictly later on the ladder AND newer than the manual change.

use chrono::{DateTime, Utc};

/// Opt-out reason stored for STOP-like answers. Rows written before the desk hold the older text
/// `asked to stop`, which also reads as this.
pub const OPT_OUT_REASON_STOP: &str = "stop";
/// Opt-out reason stored for "No thanks" / "Not interested" answers.
pub const OPT_OUT_REASON_NO_THANKS: &str = "no_thanks";

/// Meta error codes that mean the recipient cannot receive on WhatsApp.
///
/// `131026` "Message undeliverable" (Cloud API error codes page): the recipient phone number is
/// not a WhatsApp phone number, or has not accepted the new Terms of Service, or uses an old
/// WhatsApp version. Meta documents no code that names "not on WhatsApp" alone, so this is the
/// closest signal and the only one used.
pub const NOT_ON_WHATSAPP_CODES: &[&str] = &["131026"];

/// `true` when a stored Meta error code means the number is not reachable on WhatsApp.
pub fn is_not_on_whatsapp_code(code: &str) -> bool {
    NOT_ON_WHATSAPP_CODES.contains(&code.trim())
}

/// Why a contact opted out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptOutKind {
    /// Asked to stop all messages.
    Stop,
    /// Said "No thanks" / "Not interested".
    NoThanks,
}

impl OptOutKind {
    /// Read the stored `opt_out_reason`. Anything but `no_thanks` (including old rows and a
    /// missing reason) reads as `Stop`.
    pub fn from_reason(reason: Option<&str>) -> Self {
        if reason.is_some_and(|r| r.trim() == OPT_OUT_REASON_NO_THANKS) {
            Self::NoThanks
        } else {
            Self::Stop
        }
    }

    /// The reason text to store.
    pub const fn reason(self) -> &'static str {
        match self {
            Self::Stop => OPT_OUT_REASON_STOP,
            Self::NoThanks => OPT_OUT_REASON_NO_THANKS,
        }
    }
}

/// Where a business stands in the outreach pipeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum WhatsappStage {
    /// Not in the pipeline.
    None,
    /// An opener was sent.
    Contacted,
    /// They answered.
    Replied,
    /// They asked for a call.
    WantsCall,
    /// A call is booked.
    CallBooked,
    /// A quote was sent.
    QuoteSent,
    /// They are a client.
    Client,
    /// They said no thanks.
    NoThanks,
    /// They asked to stop.
    Stopped,
    /// The number is not on WhatsApp.
    NotOnWhatsapp,
}

impl WhatsappStage {
    /// Wire name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Contacted => "contacted",
            Self::Replied => "replied",
            Self::WantsCall => "wants_call",
            Self::CallBooked => "call_booked",
            Self::QuoteSent => "quote_sent",
            Self::Client => "client",
            Self::NoThanks => "no_thanks",
            Self::Stopped => "stopped",
            Self::NotOnWhatsapp => "not_on_whatsapp",
        }
    }

    /// A stage a person may set by hand. `stopped` and `not_on_whatsapp` are facts, `none`
    /// is the absence of a stage.
    pub fn parse_manual(value: &str) -> Option<Self> {
        match value.trim() {
            "contacted" => Some(Self::Contacted),
            "replied" => Some(Self::Replied),
            "wants_call" => Some(Self::WantsCall),
            "call_booked" => Some(Self::CallBooked),
            "quote_sent" => Some(Self::QuoteSent),
            "client" => Some(Self::Client),
            "no_thanks" => Some(Self::NoThanks),
            _ => None,
        }
    }

    /// Position on the ladder a fact must climb to override a manual stage. `no_thanks` sits
    /// level with `replied`: a newer positive tap or record progress revives it, a plain reply
    /// or another send does not.
    const fn rank(self) -> u8 {
        match self {
            Self::None => 0,
            Self::Contacted => 1,
            Self::Replied | Self::NoThanks => 2,
            Self::WantsCall => 3,
            Self::CallBooked => 4,
            Self::QuoteSent => 5,
            Self::Client => 6,
            Self::Stopped | Self::NotOnWhatsapp => u8::MAX,
        }
    }
}

/// A fact that implies a stage, and when it happened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fact {
    /// When the fact happened. `None` means unknown, which never overrides a manual stage.
    pub at: Option<DateTime<Utc>>,
}

impl Fact {
    /// A fact that happened at `at`.
    pub fn at(at: DateTime<Utc>) -> Self {
        Self { at: Some(at) }
    }
}

/// A stage set by a person.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManualStage {
    /// The stage.
    pub stage: WhatsappStage,
    /// Hex pubkey of who set it.
    pub set_by: String,
    /// When it was set.
    pub at: DateTime<Utc>,
}

/// Everything the relay knows about one contact that bears on its stage.
#[derive(Clone, Debug, Default)]
pub struct StageInputs {
    /// The contact opted out, why, and when.
    pub opt_out: Option<(OptOutKind, DateTime<Utc>)>,
    /// The latest send failed with a not-on-WhatsApp code.
    pub not_on_whatsapp: Option<Fact>,
    /// The stage a person set.
    pub manual: Option<ManualStage>,
    /// Customer record is a client, or the linked lead is won.
    pub client: Option<Fact>,
    /// Customer record has a QuoteDrafted or QuoteAccepted entry.
    pub quote_sent: Option<Fact>,
    /// Customer record has a CallBooked entry.
    pub call_booked: Option<Fact>,
    /// The linked lead is lost.
    pub lost: Option<Fact>,
    /// Latest tap on the template's first quick-reply button.
    pub wants_call: Option<Fact>,
    /// Latest inbound message.
    pub replied: Option<Fact>,
    /// Latest outbound message that reached Meta.
    pub contacted: Option<Fact>,
}

/// Who decided the stage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StageSetBy {
    /// Computed from WhatsApp events and records.
    Auto,
    /// A person set it (hex pubkey).
    Manual(String),
}

impl StageSetBy {
    /// Wire value: `auto` or the hex pubkey.
    pub fn as_wire(&self) -> &str {
        match self {
            Self::Auto => "auto",
            Self::Manual(pubkey) => pubkey,
        }
    }
}

/// The stage of one contact.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StageResult {
    /// The stage.
    pub stage: WhatsappStage,
    /// Who decided it.
    pub set_by: StageSetBy,
    /// When it last changed, if known.
    pub changed_at: Option<DateTime<Utc>>,
}

/// The automatic stage from facts alone (rule 4), with the fact that implies it.
fn derive_auto(inputs: &StageInputs) -> Option<(WhatsappStage, Fact)> {
    [
        (WhatsappStage::Client, inputs.client),
        (WhatsappStage::QuoteSent, inputs.quote_sent),
        (WhatsappStage::CallBooked, inputs.call_booked),
        (WhatsappStage::NoThanks, inputs.lost),
        (WhatsappStage::WantsCall, inputs.wants_call),
        (WhatsappStage::Replied, inputs.replied),
        (WhatsappStage::Contacted, inputs.contacted),
    ]
    .into_iter()
    .find_map(|(stage, fact)| fact.map(|fact| (stage, fact)))
}

/// Compute the stage of one contact.
pub fn derive_stage(inputs: &StageInputs) -> StageResult {
    let auto = |stage, changed_at| StageResult {
        stage,
        set_by: StageSetBy::Auto,
        changed_at,
    };
    if let Some((kind, at)) = inputs.opt_out {
        return auto(
            match kind {
                OptOutKind::Stop => WhatsappStage::Stopped,
                OptOutKind::NoThanks => WhatsappStage::NoThanks,
            },
            Some(at),
        );
    }
    if let Some(fact) = inputs.not_on_whatsapp {
        return auto(WhatsappStage::NotOnWhatsapp, fact.at);
    }
    let derived = derive_auto(inputs);
    let Some(manual) = &inputs.manual else {
        return match derived {
            Some((stage, fact)) => auto(stage, fact.at),
            None => auto(WhatsappStage::None, None),
        };
    };
    if let Some((stage, fact)) = derived {
        let later = stage.rank() != manual.stage.rank();
        let newer = fact.at.is_some_and(|at| at > manual.at);
        if later && newer {
            return auto(stage, fact.at);
        }
    }
    StageResult {
        stage: manual.stage,
        set_by: StageSetBy::Manual(manual.set_by.clone()),
        changed_at: Some(manual.at),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, day, 9, 0, 0)
            .single()
            .expect("time")
    }

    fn manual(stage: WhatsappStage, day: u32) -> Option<ManualStage> {
        Some(ManualStage {
            stage,
            set_by: "ab".repeat(32),
            at: t(day),
        })
    }

    #[test]
    fn nothing_known_is_not_in_the_pipeline() {
        let result = derive_stage(&StageInputs::default());
        assert_eq!(result.stage, WhatsappStage::None);
        assert_eq!(result.set_by, StageSetBy::Auto);
    }

    #[test]
    fn derived_stage_is_the_latest_fact_first() {
        let mut i = StageInputs {
            contacted: Some(Fact::at(t(1))),
            ..Default::default()
        };
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Contacted);
        i.replied = Some(Fact::at(t(2)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Replied);
        i.wants_call = Some(Fact::at(t(3)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::WantsCall);
        i.lost = Some(Fact::at(t(3)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::NoThanks);
        i.call_booked = Some(Fact::at(t(4)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::CallBooked);
        i.quote_sent = Some(Fact::at(t(5)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::QuoteSent);
        i.client = Some(Fact::at(t(6)));
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Client);
    }

    #[test]
    fn no_thanks_and_stopped_are_told_apart_by_the_reason() {
        // GUARD: both opt out; the stage label comes from the stored reason.
        let no_thanks = StageInputs {
            opt_out: Some((OptOutKind::from_reason(Some("no_thanks")), t(2))),
            replied: Some(Fact::at(t(2))),
            ..Default::default()
        };
        assert_eq!(derive_stage(&no_thanks).stage, WhatsappStage::NoThanks);
        let stopped = StageInputs {
            opt_out: Some((OptOutKind::from_reason(Some("stop")), t(2))),
            ..Default::default()
        };
        assert_eq!(derive_stage(&stopped).stage, WhatsappStage::Stopped);
        // Rows written before the desk, and rows with no reason, read as stopped.
        for old in [Some("asked to stop"), None, Some("")] {
            assert_eq!(OptOutKind::from_reason(old), OptOutKind::Stop);
        }
    }

    #[test]
    fn an_opt_out_beats_everything_else() {
        let i = StageInputs {
            opt_out: Some((OptOutKind::Stop, t(7))),
            not_on_whatsapp: Some(Fact::at(t(8))),
            manual: manual(WhatsappStage::Client, 9),
            client: Some(Fact::at(t(9))),
            ..Default::default()
        };
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Stopped);
    }

    #[test]
    fn not_on_whatsapp_beats_a_manual_stage_and_the_derived_ones() {
        let i = StageInputs {
            not_on_whatsapp: Some(Fact::at(t(8))),
            manual: manual(WhatsappStage::Contacted, 9),
            contacted: Some(Fact::at(t(1))),
            ..Default::default()
        };
        assert_eq!(derive_stage(&i).stage, WhatsappStage::NotOnWhatsapp);
    }

    #[test]
    fn manual_stage_wins_over_an_older_or_equal_fact() {
        // GUARD: stage precedence. A card the owner moved stays put until a newer event arrives.
        let mut i = StageInputs {
            manual: manual(WhatsappStage::CallBooked, 5),
            wants_call: Some(Fact::at(t(3))),
            replied: Some(Fact::at(t(3))),
            ..Default::default()
        };
        let r = derive_stage(&i);
        assert_eq!(r.stage, WhatsappStage::CallBooked);
        assert_eq!(r.set_by, StageSetBy::Manual("ab".repeat(32)));
        assert_eq!(r.changed_at, Some(t(5)));
        // Same instant is not newer.
        i.manual = manual(WhatsappStage::Contacted, 3);
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Contacted);
    }

    #[test]
    fn a_newer_fact_that_implies_a_later_stage_overrides_a_manual_one() {
        let i = StageInputs {
            manual: manual(WhatsappStage::Contacted, 3),
            wants_call: Some(Fact::at(t(5))),
            replied: Some(Fact::at(t(5))),
            ..Default::default()
        };
        let r = derive_stage(&i);
        assert_eq!(r.stage, WhatsappStage::WantsCall);
        assert_eq!(r.set_by, StageSetBy::Auto);
        assert_eq!(r.changed_at, Some(t(5)));
    }

    #[test]
    fn a_manual_stage_never_moves_backwards_automatically() {
        for (manual_stage, fact_inputs) in [
            (
                WhatsappStage::WantsCall,
                StageInputs {
                    replied: Some(Fact::at(t(9))),
                    contacted: Some(Fact::at(t(9))),
                    ..Default::default()
                },
            ),
            (
                WhatsappStage::Client,
                StageInputs {
                    quote_sent: Some(Fact::at(t(9))),
                    ..Default::default()
                },
            ),
            (
                WhatsappStage::Replied,
                StageInputs {
                    contacted: Some(Fact::at(t(9))),
                    ..Default::default()
                },
            ),
        ] {
            let i = StageInputs {
                manual: manual(manual_stage, 2),
                ..fact_inputs
            };
            assert_eq!(derive_stage(&i).stage, manual_stage, "{manual_stage:?}");
        }
    }

    #[test]
    fn a_fact_with_no_time_never_overrides_a_manual_stage() {
        let i = StageInputs {
            manual: manual(WhatsappStage::Contacted, 2),
            client: Some(Fact { at: None }),
            ..Default::default()
        };
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Contacted);
        // Without a manual stage it still reads as client.
        let i = StageInputs {
            client: Some(Fact { at: None }),
            ..Default::default()
        };
        assert_eq!(derive_stage(&i).stage, WhatsappStage::Client);
    }

    #[test]
    fn a_manual_no_thanks_is_revived_only_by_a_positive_signal() {
        let base = StageInputs {
            manual: manual(WhatsappStage::NoThanks, 2),
            ..Default::default()
        };
        let plain_reply = StageInputs {
            replied: Some(Fact::at(t(5))),
            contacted: Some(Fact::at(t(5))),
            ..base.clone()
        };
        assert_eq!(derive_stage(&plain_reply).stage, WhatsappStage::NoThanks);
        let tap = StageInputs {
            wants_call: Some(Fact::at(t(5))),
            ..base
        };
        assert_eq!(derive_stage(&tap).stage, WhatsappStage::WantsCall);
    }

    #[test]
    fn only_deskable_stages_can_be_set_by_hand() {
        for ok in [
            "contacted",
            "replied",
            "wants_call",
            "call_booked",
            "quote_sent",
            "client",
            "no_thanks",
        ] {
            let stage = WhatsappStage::parse_manual(ok).expect(ok);
            assert_eq!(stage.as_str(), ok);
        }
        for bad in ["stopped", "not_on_whatsapp", "none", "", "Client", "won"] {
            assert_eq!(WhatsappStage::parse_manual(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_the_documented_meta_code_means_not_on_whatsapp() {
        assert!(is_not_on_whatsapp_code("131026"));
        assert!(is_not_on_whatsapp_code(" 131026 "));
        for other in ["131049", "131048", "130472", "190", "", "1310260"] {
            assert!(!is_not_on_whatsapp_code(other), "{other}");
        }
    }
}
