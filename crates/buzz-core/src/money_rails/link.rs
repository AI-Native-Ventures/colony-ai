//! The payment link card and its state machine (kind 30680 head, 47070 actions).
//!
//! Every rule of spec section 7 lives here as a pure function, so it can be tested without a
//! database: who may do what, the atomic approve that re-checks every fact against the head,
//! the void on edit, and the only ways a card can reach Paid. The relay supplies the facts
//! (invoice, connection, caller) and stores what comes back.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::business_records::InvoiceStatus;

use super::connection::ConnectionStatus;
use super::notice::{Mismatch, VerifiedBy};
use super::{
    card_ref, clean_text, mask_recipient, normalize_whatsapp, sha256_hex, valid_currency,
    valid_email, ActorRole, MoneyError, RecipientChannel, Route, BROWSER_GRANT_SECS,
    DEFAULT_EXPIRES_DAYS, MAX_AMOUNT_MINOR, MAX_EXPIRES_DAYS, MAX_MESSAGE_CHARS,
    MAX_SHORT_TEXT_CHARS, MONEY_RAILS_SCHEMA_VERSION,
};

/// Seconds in a day.
const DAY_SECS: i64 = 86_400;

/// Where a card is in its life (spec section 7).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkState {
    /// Saved but not ready; `waiting_for` says why.
    Draft,
    /// Waiting for the owner.
    NeedsYou,
    /// Approved; the link is being created and sent.
    CreatingLink,
    /// The link exists and the message went out.
    Sent,
    /// Something says it was paid; not confirmed, or confirmed and being recorded.
    PaymentReported,
    /// Verified and recorded as payment evidence.
    Paid,
    /// The link expired unpaid.
    Expired,
    /// Cancelled or rejected.
    Cancelled,
    /// Something failed; `failure` says what.
    Failed,
}

impl LinkState {
    /// The wire name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::NeedsYou => "needs_you",
            Self::CreatingLink => "creating_link",
            Self::Sent => "sent",
            Self::PaymentReported => "payment_reported",
            Self::Paid => "paid",
            Self::Expired => "expired",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }

    /// True when no command or job moves the card any more.
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Paid | Self::Expired | Self::Cancelled)
    }
}

/// The owner's approval of the exact facts on the card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Approval {
    /// Who approved.
    pub approved_by: String,
    /// When, Unix seconds.
    pub approved_at: i64,
    /// SHA-256 of the canonical facts.
    pub digest: String,
    /// The head the approver saw.
    pub head_event_id: String,
}

/// The one-time permission for the browser Create step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BrowserGrant {
    /// The only host the Create step may run on.
    pub host: String,
    /// Start, Unix seconds.
    pub from: i64,
    /// End, Unix seconds.
    pub until: i64,
    /// Set when the step check let one Create through.
    #[serde(default)]
    pub used_at: Option<i64>,
}

/// The created payment link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CreatedLink {
    /// URL the client pays at.
    pub url: String,
    /// The provider's reference.
    #[serde(default)]
    pub provider_reference: Option<String>,
    /// When it was created.
    pub created_at: i64,
    /// Amount the link showed the payer, in minor units.
    pub shown_amount_minor: i64,
    /// Currency the link showed the payer.
    pub shown_currency: String,
    /// When Colony checked it.
    pub checked_at: i64,
}

/// Where delivery of the message is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    /// Waiting to be sent.
    Pending,
    /// Sent by Colony.
    Sent,
    /// The owner sent it by hand.
    Manual,
    /// The send failed.
    Failed,
}

/// Delivery of the approved message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Delivery {
    /// Channel.
    pub channel: RecipientChannel,
    /// State.
    pub state: DeliveryState,
    /// When it was sent.
    #[serde(default)]
    pub sent_at: Option<i64>,
}

/// Whether a payment is confirmed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentState {
    /// Reported, not confirmed. "Payment reported, check".
    Reported,
    /// Confirmed. Evidence is being or has been recorded.
    Verified,
}

/// What produced the payment information.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaymentSource {
    /// A signed notice.
    Hmac,
    /// An API lookup.
    Lookup,
    /// The owner ticked "I can see this payment".
    OwnerTick,
    /// Scout or the owner reported it from a dashboard, Gmail or a client message.
    Report,
    /// An unconfirmed notice.
    Notice,
}

/// Payment information on a card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PaymentInfo {
    /// Confirmed or not.
    pub state: PaymentState,
    /// Where it came from.
    pub source: PaymentSource,
    /// Provider reference.
    #[serde(default)]
    pub reference: Option<String>,
    /// Amount in minor units.
    #[serde(default)]
    pub amount_minor: Option<i64>,
    /// Currency.
    #[serde(default)]
    pub currency: Option<String>,
    /// When, Unix seconds.
    pub at: i64,
    /// The stored notice behind it.
    #[serde(default)]
    pub notice_id: Option<Uuid>,
    /// Stable id of the payment evidence.
    #[serde(default)]
    pub payment_id: Option<Uuid>,
    /// The payment evidence event, once written.
    #[serde(default)]
    pub evidence_event_id: Option<String>,
    /// What differs from the card, if anything.
    #[serde(default)]
    pub mismatch: Option<Mismatch>,
}

/// Why a card failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Failure {
    /// Stable code.
    pub code: String,
    /// Plain words for the owner. Never a secret.
    pub reason: String,
    /// Whether "Try again" is offered.
    pub retryable: bool,
    /// When, Unix seconds.
    pub at: i64,
}

/// Relay-authored payment link card head (kind 30680).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkHead {
    /// Schema version.
    pub schema_version: u8,
    /// Card id.
    pub link_id: Uuid,
    /// Short reference, for example `PL-7F3K9Q`.
    pub card_ref: String,
    /// Bumped on every change.
    pub version: u32,
    /// State.
    pub state: LinkState,
    /// Customer record party id.
    pub party_id: String,
    /// Client id of the invoice.
    pub client_id: Uuid,
    /// Invoice id.
    pub invoice_id: Uuid,
    /// Invoice number for display.
    pub invoice_number: String,
    /// Customer name for display.
    pub customer_name: String,
    /// Amount in minor units.
    pub amount_minor: i64,
    /// Currency.
    pub currency: String,
    /// What the payment is for.
    pub purpose: String,
    /// The connection.
    pub connection_id: Uuid,
    /// Provider label for display.
    pub provider_label: String,
    /// Route.
    pub route: Route,
    /// Opaque id of the private recipient row.
    pub recipient_ref: Uuid,
    /// Where the message goes.
    pub recipient_channel: RecipientChannel,
    /// Recipient's name.
    pub recipient_name: String,
    /// Masked address for display.
    pub recipient_display: String,
    /// The exact message, with `{link}` once.
    pub message: String,
    /// SHA-256 of the message.
    pub message_hash: String,
    /// Link life in days.
    pub expires_in_days: u32,
    /// When the link expires, set at approval.
    #[serde(default)]
    pub expires_at: Option<i64>,
    /// Why the card is a draft.
    #[serde(default)]
    pub waiting_for: Option<String>,
    /// Who drafted it.
    pub drafted_by: String,
    /// When.
    pub drafted_at: i64,
    /// The approval, while valid.
    #[serde(default)]
    pub approval: Option<Approval>,
    /// True after an edit voided an approval.
    #[serde(default)]
    pub approval_voided: bool,
    /// The browser Create permission.
    #[serde(default)]
    pub browser_grant: Option<BrowserGrant>,
    /// The created link.
    #[serde(default)]
    pub link: Option<CreatedLink>,
    /// Delivery.
    #[serde(default)]
    pub delivery: Option<Delivery>,
    /// Payment information.
    #[serde(default)]
    pub payment: Option<PaymentInfo>,
    /// Failure.
    #[serde(default)]
    pub failure: Option<Failure>,
    /// Why it was cancelled or rejected.
    #[serde(default)]
    pub cancel_reason: Option<String>,
    /// Last change, Unix seconds.
    pub updated_at: i64,
    /// Event that produced this head.
    pub source_event_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DigestFacts<'a> {
    link_id: Uuid,
    invoice_id: Uuid,
    amount_minor: i64,
    currency: &'a str,
    connection_id: Uuid,
    recipient_ref: Uuid,
    message_hash: &'a str,
    expires_in_days: u32,
}

/// SHA-256 of the canonical facts an approval covers (struct field order, no spaces).
pub fn approval_digest(head: &LinkHead) -> String {
    let facts = DigestFacts {
        link_id: head.link_id,
        invoice_id: head.invoice_id,
        amount_minor: head.amount_minor,
        currency: &head.currency,
        connection_id: head.connection_id,
        recipient_ref: head.recipient_ref,
        message_hash: &head.message_hash,
        expires_in_days: head.expires_in_days,
    };
    sha256_hex(&serde_json::to_vec(&facts).unwrap_or_default())
}

impl LinkHead {
    /// True while the stored approval still matches the facts on the card. The recipe runner,
    /// the sender and the browser step check all require this.
    pub fn approval_is_valid(&self) -> bool {
        self.approval
            .as_ref()
            .is_some_and(|approval| approval.digest == approval_digest(self))
    }

    /// True once a link exists.
    pub fn link_exists(&self) -> bool {
        self.link.is_some()
    }

    fn touch(&mut self, now: i64, source_event_id: &str) {
        self.version = self.version.saturating_add(1);
        self.updated_at = now;
        self.source_event_id = source_event_id.to_owned();
    }

    fn void_approval(&mut self) {
        if self.approval.is_some() {
            self.approval_voided = true;
        }
        self.approval = None;
        self.browser_grant = None;
    }
}

/// The commands on a card (kind 47070). The relay's own transitions are [`SystemOp`] and are
/// never accepted from a member.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkOp {
    /// Create the card.
    Draft,
    /// Change the card.
    Edit,
    /// Move a complete draft to the owner.
    Submit,
    /// Approve the exact facts.
    Approve,
    /// Reject with a reason.
    Reject,
    /// Cancel.
    Cancel,
    /// Browser route: record the link Scout created and read back.
    RecordCreated,
    /// Report a payment for the owner to check.
    ReportPayment,
    /// The owner ticks "I can see this payment".
    ConfirmPayment,
    /// Back from a report to sent.
    DismissReport,
    /// Try a failed card again.
    Retry,
    /// The owner sent the link by hand.
    MarkSent,
}

/// Where a recipient is given.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RecipientInput {
    /// Channel.
    pub channel: RecipientChannel,
    /// Number or email address.
    pub address: String,
    /// Name.
    pub name: String,
}

/// The facts the owner saw when approving. All must equal the head.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalFacts {
    /// Invoice.
    pub invoice_id: Uuid,
    /// Amount in minor units.
    pub amount_minor: i64,
    /// Currency.
    pub currency: String,
    /// Connection.
    pub connection_id: Uuid,
    /// Recipient reference.
    pub recipient_ref: Uuid,
    /// The exact message.
    pub message: String,
    /// Link life in days.
    pub expires_in_days: u32,
}

/// Who reported a payment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportSource {
    /// Seen in the provider's dashboard.
    Dashboard,
    /// Seen in an email.
    Gmail,
    /// The client said so.
    ClientMessage,
}

/// A card command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkAction {
    /// Schema version.
    pub schema_version: u8,
    /// Operation.
    pub op: LinkOp,
    /// Card id.
    pub link_id: Uuid,
    /// The head the caller saw. Required for every op except `draft`.
    #[serde(default)]
    pub expected_head_event_id: Option<String>,
    /// Customer record party id (draft).
    #[serde(default)]
    pub party_id: Option<String>,
    /// Invoice (draft, edit).
    #[serde(default)]
    pub invoice_id: Option<Uuid>,
    /// Amount (draft, edit; report_payment).
    #[serde(default)]
    pub amount_minor: Option<i64>,
    /// Currency (draft, edit; report_payment).
    #[serde(default)]
    pub currency: Option<String>,
    /// What it is for (draft, edit).
    #[serde(default)]
    pub purpose: Option<String>,
    /// Connection (draft, edit).
    #[serde(default)]
    pub connection_id: Option<Uuid>,
    /// Recipient (draft, edit).
    #[serde(default)]
    pub recipient: Option<RecipientInput>,
    /// Message (draft, edit).
    #[serde(default)]
    pub message: Option<String>,
    /// Link life in days (draft, edit).
    #[serde(default)]
    pub expires_in_days: Option<u32>,
    /// The facts being approved (approve).
    #[serde(default)]
    pub facts: Option<ApprovalFacts>,
    /// Reason (reject, cancel).
    #[serde(default)]
    pub reason: Option<String>,
    /// Note (report_payment, confirm_payment, dismiss_report, mark_sent).
    #[serde(default)]
    pub note: Option<String>,
    /// Created link URL (record_created).
    #[serde(default)]
    pub url: Option<String>,
    /// Provider reference (record_created, report_payment, confirm_payment).
    #[serde(default)]
    pub provider_reference: Option<String>,
    /// Amount the link showed the payer (record_created).
    #[serde(default)]
    pub shown_amount_minor: Option<i64>,
    /// Currency the link showed the payer (record_created).
    #[serde(default)]
    pub shown_currency: Option<String>,
    /// Where a payment was seen (report_payment).
    #[serde(default)]
    pub source: Option<ReportSource>,
}

impl LinkAction {
    /// The d-tag every command on this card carries.
    pub fn d_tag(&self) -> String {
        super::link_d_tag(self.link_id)
    }

    /// Static checks that need no state.
    pub fn validate(&self) -> Result<(), MoneyError> {
        if self.schema_version != MONEY_RAILS_SCHEMA_VERSION {
            return Err(MoneyError::invalid(
                "schema_version",
                "unsupported schema version",
            ));
        }
        if self.op != LinkOp::Draft && self.expected_head_event_id.is_none() {
            return Err(MoneyError::invalid(
                "expected_head_required",
                "name the head you saw (expectedHeadEventId)",
            ));
        }
        if let Some(expected) = &self.expected_head_event_id {
            if !crate::company_records::is_hex_id(expected) {
                return Err(MoneyError::invalid(
                    "expected_head_required",
                    "expectedHeadEventId must be a 64 character hex id",
                ));
            }
        }
        for text in [&self.reason, &self.note].into_iter().flatten() {
            if !clean_text(text, 300) {
                return Err(MoneyError::invalid(
                    "money_invalid_input",
                    "a reason or note must be 1 to 300 characters",
                ));
            }
        }
        Ok(())
    }
}

/// The caller.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkActor {
    /// Pubkey, lower case hex.
    pub pubkey: String,
    /// Role.
    pub role: ActorRole,
}

/// Facts about the invoice, read by the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceFacts {
    /// Status of the invoice head.
    pub status: InvoiceStatus,
    /// Currency of the invoice.
    pub currency: String,
    /// Gross total in minor units.
    pub total_minor: i64,
    /// Outstanding balance in minor units.
    pub outstanding_minor: i64,
    /// Number for display.
    pub number: String,
    /// Client id.
    pub client_id: Uuid,
    /// Customer name for display.
    pub customer_name: String,
}

/// Facts about the connection, read by the relay.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionFacts {
    /// Connection id.
    pub connection_id: Uuid,
    /// Label for display.
    pub label: String,
    /// Route.
    pub route: Route,
    /// Health.
    pub status: ConnectionStatus,
    /// An approved create_link recipe exists (API route).
    pub has_create_recipe: bool,
    /// The dashboard host the browser grant is for (browser route).
    pub browser_host: Option<String>,
}

/// Everything the relay knows when a command arrives.
#[derive(Debug, Clone)]
pub struct LinkContext {
    /// Relay time, Unix seconds.
    pub now: i64,
    /// The caller.
    pub actor: LinkActor,
    /// The invoice the card hangs off, as it is now.
    pub invoice: Option<InvoiceFacts>,
    /// The connection the card names (or would use), as it is now.
    pub connection: Option<ConnectionFacts>,
    /// The id of the action event, recorded on the new head.
    pub action_event_id: String,
    /// A fresh id for the private recipient row, used when the recipient is new or changed.
    pub new_recipient_ref: Uuid,
}

/// A side effect the relay must carry out with the head change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkEffect {
    /// Store or replace the private recipient row.
    PutRecipient {
        /// Reference the head names.
        recipient_ref: Uuid,
        /// Channel.
        channel: RecipientChannel,
        /// Full normalised address.
        address: String,
        /// Name.
        name: String,
    },
    /// Queue the API create job.
    QueueCreate,
    /// Queue the delivery job.
    QueueSend,
    /// Stop any queued job for this card.
    CancelJobs,
    /// Wake Scout to work the provider's site.
    WakeBrowser,
    /// Queue the payment evidence write.
    WriteEvidence {
        /// How it was verified.
        source: PaymentSource,
        /// Provider reference.
        reference: Option<String>,
        /// Amount (always the card amount).
        amount_minor: i64,
        /// Currency (always the card currency).
        currency: String,
        /// When the payment happened.
        at: i64,
        /// The notice behind it, if any.
        notice_id: Option<Uuid>,
    },
}

/// A head and the effects to carry out with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkOutcome {
    /// The new head.
    pub head: LinkHead,
    /// Effects, in order.
    pub effects: Vec<LinkEffect>,
}

/// The result of a command or system transition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkChange {
    /// Nothing to store.
    Unchanged(&'static str),
    /// Store this.
    Changed(Box<LinkOutcome>),
}

fn need<T>(value: Option<T>, name: &str) -> Result<T, MoneyError> {
    value.ok_or_else(|| MoneyError::invalid("money_invalid_input", format!("{name} is required")))
}

fn changed(head: LinkHead, effects: Vec<LinkEffect>) -> Result<LinkChange, MoneyError> {
    Ok(LinkChange::Changed(Box::new(LinkOutcome { head, effects })))
}

fn message_ok(message: &str) -> bool {
    !message.is_empty()
        && message.chars().count() <= MAX_MESSAGE_CHARS
        && !message.chars().any(|c| c.is_control() && c != '\n')
        && message.matches("{link}").count() == 1
}

fn party_id_ok(party_id: &str) -> bool {
    !party_id.is_empty()
        && party_id.len() <= 128
        && party_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
}

/// Checks the fields every draft and edit must satisfy.
fn check_fields(head: &LinkHead) -> Result<(), MoneyError> {
    if head.amount_minor <= 0 || head.amount_minor > MAX_AMOUNT_MINOR {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "amount must be more than zero",
        ));
    }
    if !valid_currency(&head.currency) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "currency must be a three letter code such as ZAR",
        ));
    }
    if !clean_text(&head.purpose, MAX_SHORT_TEXT_CHARS) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "say what the payment is for, up to 200 characters",
        ));
    }
    if !message_ok(&head.message) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "the message must contain {link} exactly once and be up to 1000 characters",
        ));
    }
    if !(1..=MAX_EXPIRES_DAYS).contains(&head.expires_in_days) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "the link life must be 1 to 90 days",
        ));
    }
    if !clean_text(&head.recipient_name, 100) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "the recipient needs a name, up to 100 characters",
        ));
    }
    if !party_id_ok(&head.party_id) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "partyId is not valid",
        ));
    }
    Ok(())
}

/// Checks the card against the invoice. `for_approval` demands an issued invoice.
fn check_invoice(
    head: &LinkHead,
    invoice: Option<&InvoiceFacts>,
    for_approval: bool,
) -> Result<(), MoneyError> {
    let invoice = invoice.ok_or_else(|| {
        MoneyError::conflict(
            "no_issued_invoice",
            "the invoice for this card was not found",
        )
    })?;
    if invoice.status == InvoiceStatus::Void {
        return Err(MoneyError::conflict(
            "invoice_void",
            "the invoice was voided, so it cannot take a payment link",
        ));
    }
    if for_approval && invoice.status != InvoiceStatus::Issued {
        return Err(MoneyError::conflict(
            "no_issued_invoice",
            "issue the invoice first: a payment is recorded against an issued invoice",
        ));
    }
    if invoice.currency != head.currency {
        return Err(MoneyError::invalid(
            "currency_mismatch",
            "the card currency must match the invoice currency",
        ));
    }
    let cap = if invoice.status == InvoiceStatus::Issued {
        invoice.outstanding_minor
    } else {
        invoice.total_minor
    };
    if head.amount_minor > cap {
        return Err(MoneyError::invalid(
            "amount_exceeds_outstanding",
            "the amount is more than the invoice still has to collect",
        ));
    }
    Ok(())
}

fn check_connection(
    head: &LinkHead,
    connection: Option<&ConnectionFacts>,
    for_approval: bool,
) -> Result<(), MoneyError> {
    let connection = connection.ok_or_else(|| {
        MoneyError::conflict("connection_missing", "the payment provider was not found")
    })?;
    if connection.connection_id != head.connection_id {
        return Err(MoneyError::conflict(
            "connection_missing",
            "the payment provider on the card is not the one that was loaded",
        ));
    }
    if connection.status != ConnectionStatus::Connected {
        return Err(MoneyError::conflict(
            "connection_not_ready",
            "the payment provider is not connected",
        ));
    }
    if for_approval {
        match connection.route {
            Route::Api if !connection.has_create_recipe => {
                return Err(MoneyError::conflict(
                    "recipe_missing",
                    "approve a create link recipe for this provider first",
                ))
            }
            Route::Browser if connection.browser_host.is_none() => {
                return Err(MoneyError::conflict(
                    "browser_host_missing",
                    "this provider has no dashboard host for the browser route",
                ))
            }
            _ => {}
        }
    }
    Ok(())
}

fn may_edit_own(actor: &LinkActor, head: &LinkHead) -> bool {
    actor.role.is_owner_admin()
        || (actor.role == ActorRole::OwnedAgent
            && head.drafted_by == actor.pubkey
            && head.approval.is_none()
            && matches!(head.state, LinkState::Draft | LinkState::NeedsYou))
}

fn recipient_effect(
    input: &RecipientInput,
    recipient_ref: Uuid,
) -> Result<(LinkEffect, String), MoneyError> {
    let address = match input.channel {
        RecipientChannel::Whatsapp => normalize_whatsapp(&input.address).ok_or_else(|| {
            MoneyError::invalid(
                "money_invalid_input",
                "the WhatsApp number must have 6 to 15 digits",
            )
        })?,
        RecipientChannel::Email => {
            if !valid_email(&input.address) {
                return Err(MoneyError::invalid(
                    "money_invalid_input",
                    "the email address is not valid",
                ));
            }
            input.address.trim().to_owned()
        }
    };
    let display = mask_recipient(input.channel, &address);
    Ok((
        LinkEffect::PutRecipient {
            recipient_ref,
            channel: input.channel,
            address,
            name: input.name.clone(),
        },
        display,
    ))
}

fn fail_head(head: &mut LinkHead, code: &str, reason: &str, retryable: bool, now: i64) {
    head.state = LinkState::Failed;
    head.failure = Some(Failure {
        code: code.to_owned(),
        reason: reason.to_owned(),
        retryable,
        at: now,
    });
}

/// Applies a member command. `current` is `None` only for `draft`.
pub fn apply_link_action(
    current: Option<&LinkHead>,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    action.validate()?;
    if !ctx.actor.role.may_prepare() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner, an admin or their agent can work on payment link cards",
        ));
    }
    if action.op == LinkOp::Draft {
        return match current {
            None => draft(action, ctx),
            Some(_) => Err(MoneyError::conflict(
                "card_exists",
                "a card with this id already exists",
            )),
        };
    }
    let current = current.ok_or_else(|| {
        MoneyError::conflict("card_missing", "there is no payment link card with this id")
    })?;
    match action.op {
        LinkOp::Draft => draft(action, ctx),
        LinkOp::Edit => edit(current, action, ctx),
        LinkOp::Submit => submit(current, ctx),
        LinkOp::Approve => approve(current, action, ctx),
        LinkOp::Reject => reject(current, action, ctx),
        LinkOp::Cancel => cancel(current, action, ctx),
        LinkOp::RecordCreated => record_created(current, action, ctx),
        LinkOp::ReportPayment => report_payment(current, action, ctx),
        LinkOp::ConfirmPayment => confirm_payment(current, action, ctx),
        LinkOp::DismissReport => dismiss_report(current, ctx),
        LinkOp::Retry => retry(current, ctx),
        LinkOp::MarkSent => mark_sent(current, ctx),
    }
}

fn draft(action: &LinkAction, ctx: &LinkContext) -> Result<LinkChange, MoneyError> {
    let invoice_id = need(action.invoice_id, "invoiceId")?;
    let recipient = need(action.recipient.as_ref(), "recipient")?;
    let invoice = ctx.invoice.as_ref().ok_or_else(|| {
        MoneyError::conflict(
            "no_issued_invoice",
            "the invoice for this card was not found",
        )
    })?;
    let connection = ctx.connection.as_ref().ok_or_else(|| {
        MoneyError::conflict(
            "connection_missing",
            "connect a payment provider first, or name one",
        )
    })?;
    let (put_recipient, recipient_display) = recipient_effect(recipient, ctx.new_recipient_ref)?;
    let message = need(action.message.clone(), "message")?;
    let mut head = LinkHead {
        schema_version: MONEY_RAILS_SCHEMA_VERSION,
        link_id: action.link_id,
        card_ref: card_ref(action.link_id),
        version: 1,
        state: LinkState::NeedsYou,
        party_id: need(action.party_id.clone(), "partyId")?,
        client_id: invoice.client_id,
        invoice_id,
        invoice_number: invoice.number.clone(),
        customer_name: invoice.customer_name.clone(),
        amount_minor: need(action.amount_minor, "amountMinor")?,
        currency: need(action.currency.clone(), "currency")?,
        purpose: need(action.purpose.clone(), "purpose")?,
        connection_id: connection.connection_id,
        provider_label: connection.label.clone(),
        route: connection.route,
        recipient_ref: ctx.new_recipient_ref,
        recipient_channel: recipient.channel,
        recipient_name: recipient.name.clone(),
        recipient_display,
        message_hash: sha256_hex(message.as_bytes()),
        message,
        expires_in_days: action.expires_in_days.unwrap_or(DEFAULT_EXPIRES_DAYS),
        expires_at: None,
        waiting_for: None,
        drafted_by: ctx.actor.pubkey.clone(),
        drafted_at: ctx.now,
        approval: None,
        approval_voided: false,
        browser_grant: None,
        link: None,
        delivery: None,
        payment: None,
        failure: None,
        cancel_reason: None,
        updated_at: ctx.now,
        source_event_id: ctx.action_event_id.clone(),
    };
    check_fields(&head)?;
    check_invoice(&head, Some(invoice), false)?;
    check_connection(&head, Some(connection), false)?;
    if invoice.status != InvoiceStatus::Issued {
        head.state = LinkState::Draft;
        head.waiting_for = Some("invoice_issue".to_owned());
    }
    changed(head, vec![put_recipient])
}

fn edit(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    let editable = match current.state {
        LinkState::Draft | LinkState::NeedsYou => true,
        LinkState::CreatingLink | LinkState::Failed => !current.link_exists(),
        _ => false,
    };
    if !editable {
        return Err(MoneyError::conflict(
            "card_locked",
            "the link already exists or the card is finished: cancel it and draft a new card",
        ));
    }
    if !may_edit_own(&ctx.actor, current) {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can change a card after it was approved or drafted by someone else",
        ));
    }
    let mut head = current.clone();
    let mut effects = Vec::new();
    if let Some(invoice_id) = action.invoice_id {
        head.invoice_id = invoice_id;
    }
    if let Some(party_id) = &action.party_id {
        head.party_id = party_id.clone();
    }
    if let Some(amount) = action.amount_minor {
        head.amount_minor = amount;
    }
    if let Some(currency) = &action.currency {
        head.currency = currency.clone();
    }
    if let Some(purpose) = &action.purpose {
        head.purpose = purpose.clone();
    }
    if let Some(days) = action.expires_in_days {
        head.expires_in_days = days;
    }
    if let Some(message) = &action.message {
        head.message = message.clone();
        head.message_hash = sha256_hex(message.as_bytes());
    }
    if let Some(connection_id) = action.connection_id {
        head.connection_id = connection_id;
        if let Some(connection) = ctx.connection.as_ref() {
            head.provider_label = connection.label.clone();
            head.route = connection.route;
        }
    }
    if let Some(recipient) = &action.recipient {
        let (effect, display) = recipient_effect(recipient, ctx.new_recipient_ref)?;
        head.recipient_ref = ctx.new_recipient_ref;
        head.recipient_channel = recipient.channel;
        head.recipient_name = recipient.name.clone();
        head.recipient_display = display;
        effects.push(effect);
    }
    check_fields(&head)?;
    if let Some(invoice) = ctx.invoice.as_ref() {
        head.client_id = invoice.client_id;
        head.invoice_number = invoice.number.clone();
        head.customer_name = invoice.customer_name.clone();
    }
    check_invoice(&head, ctx.invoice.as_ref(), false)?;
    check_connection(&head, ctx.connection.as_ref(), false)?;
    // An edit after approval voids the approval: the card goes back to the owner.
    if head.approval.is_some() || head.state == LinkState::CreatingLink {
        head.void_approval();
        head.state = LinkState::NeedsYou;
        head.expires_at = None;
        effects.push(LinkEffect::CancelJobs);
    } else if head.state == LinkState::Failed {
        head.state = LinkState::NeedsYou;
    }
    head.failure = None;
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, effects)
}

fn submit(current: &LinkHead, ctx: &LinkContext) -> Result<LinkChange, MoneyError> {
    if current.state != LinkState::Draft {
        return Err(MoneyError::conflict(
            "card_locked",
            "only a draft can be sent to the owner",
        ));
    }
    if !may_edit_own(&ctx.actor, current) {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the drafter or the owner can send this draft on",
        ));
    }
    check_invoice(current, ctx.invoice.as_ref(), true)?;
    check_connection(current, ctx.connection.as_ref(), false)?;
    let mut head = current.clone();
    head.state = LinkState::NeedsYou;
    head.waiting_for = None;
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, Vec::new())
}

fn approve(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can approve a payment link",
        ));
    }
    if current.state != LinkState::NeedsYou {
        return Err(MoneyError::conflict(
            "card_not_waiting",
            "this card is not waiting for approval",
        ));
    }
    let facts = need(action.facts.as_ref(), "facts")?;
    let head_id = need(action.expected_head_event_id.clone(), "expectedHeadEventId")?;
    // The atomic re-check: every fact the owner saw must still be on the card.
    let same = facts.invoice_id == current.invoice_id
        && facts.currency == current.currency
        && facts.connection_id == current.connection_id
        && facts.recipient_ref == current.recipient_ref
        && facts.message == current.message
        && facts.expires_in_days == current.expires_in_days;
    if !same {
        return Err(MoneyError::conflict(
            "approval_facts_changed",
            "the card changed after you looked at it; review it again",
        ));
    }
    check_fields(current)?;
    check_invoice(current, ctx.invoice.as_ref(), true)?;
    check_connection(current, ctx.connection.as_ref(), true)?;
    let mut head = current.clone();
    head.approval = Some(Approval {
        approved_by: ctx.actor.pubkey.clone(),
        approved_at: ctx.now,
        digest: approval_digest(current),
        head_event_id: head_id,
    });
    head.approval_voided = false;
    head.state = LinkState::CreatingLink;
    head.failure = None;
    head.expires_at = Some(ctx.now + i64::from(head.expires_in_days) * DAY_SECS);
    let mut effects = Vec::new();
    match head.route {
        Route::Api => effects.push(LinkEffect::QueueCreate),
        Route::Browser => {
            let host = ctx
                .connection
                .as_ref()
                .and_then(|connection| connection.browser_host.clone())
                .unwrap_or_default();
            head.browser_grant = Some(BrowserGrant {
                host,
                from: ctx.now,
                until: ctx.now + BROWSER_GRANT_SECS,
                used_at: None,
            });
            effects.push(LinkEffect::WakeBrowser);
        }
    }
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, effects)
}

fn reject(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can reject a card",
        ));
    }
    if !matches!(current.state, LinkState::Draft | LinkState::NeedsYou) {
        return Err(MoneyError::conflict(
            "card_not_waiting",
            "only a card that is waiting for approval can be rejected",
        ));
    }
    let reason = need(action.reason.clone(), "reason")?;
    let mut head = current.clone();
    head.state = LinkState::Cancelled;
    head.cancel_reason = Some(reason);
    head.approval = None;
    head.browser_grant = None;
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, vec![LinkEffect::CancelJobs])
}

fn cancel(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if current.state.is_terminal() {
        return Ok(LinkChange::Unchanged("card is already finished"));
    }
    if !may_edit_own(&ctx.actor, current) {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can cancel a card after it was approved",
        ));
    }
    let mut head = current.clone();
    head.state = LinkState::Cancelled;
    head.cancel_reason = Some(
        action
            .reason
            .clone()
            .unwrap_or_else(|| "Cancelled".to_owned()),
    );
    head.browser_grant = None;
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, vec![LinkEffect::CancelJobs])
}

fn link_checked(
    head: &mut LinkHead,
    url: String,
    provider_reference: Option<String>,
    shown_amount_minor: i64,
    shown_currency: &str,
    now: i64,
) -> Vec<LinkEffect> {
    // A mismatch stops the flow and goes back to the owner (spec 6.4, review focus 2).
    let mismatch = if shown_amount_minor != head.amount_minor {
        Some((
            "amount_mismatch",
            "The link shows a different amount than the card.",
        ))
    } else if shown_currency != head.currency {
        Some((
            "currency_shown_mismatch",
            "The link shows a different currency than the card.",
        ))
    } else {
        None
    };
    if let Some((code, reason)) = mismatch {
        head.void_approval();
        head.state = LinkState::NeedsYou;
        head.expires_at = None;
        head.failure = Some(Failure {
            code: code.to_owned(),
            reason: format!("{reason} Nothing was sent. Check the provider and approve again."),
            retryable: false,
            at: now,
        });
        return vec![LinkEffect::CancelJobs];
    }
    head.link = Some(CreatedLink {
        url,
        provider_reference,
        created_at: now,
        shown_amount_minor,
        shown_currency: shown_currency.to_owned(),
        checked_at: now,
    });
    head.delivery = Some(Delivery {
        channel: head.recipient_channel,
        state: DeliveryState::Pending,
        sent_at: None,
    });
    head.failure = None;
    vec![LinkEffect::QueueSend]
}

fn https_url(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|parsed| {
        parsed.scheme() == "https"
            && parsed.host_str().is_some()
            && parsed.username().is_empty()
            && parsed.password().is_none()
    }) && url.len() <= 2_048
}

fn record_created(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if current.state != LinkState::CreatingLink
        || current.route != Route::Browser
        || current.link_exists()
        || !current.approval_is_valid()
    {
        return Err(MoneyError::conflict(
            "card_not_creating",
            "this card is not waiting for a link from the browser",
        ));
    }
    let url = need(action.url.clone(), "url")?;
    if !https_url(&url) {
        return Err(MoneyError::invalid(
            "money_invalid_input",
            "the link must be a plain https URL",
        ));
    }
    let shown_amount = need(action.shown_amount_minor, "shownAmountMinor")?;
    let shown_currency = need(action.shown_currency.clone(), "shownCurrency")?;
    let mut head = current.clone();
    let grant_live = head
        .browser_grant
        .as_ref()
        .is_some_and(|grant| ctx.now < grant.until);
    if !grant_live {
        fail_head(
            &mut head,
            "browser_grant_expired",
            "The 15 minute window for the browser step ran out. Try again when you are at your Mac.",
            true,
            ctx.now,
        );
        head.touch(ctx.now, &ctx.action_event_id);
        return changed(head, vec![LinkEffect::CancelJobs]);
    }
    let effects = link_checked(
        &mut head,
        url,
        action.provider_reference.clone(),
        shown_amount,
        &shown_currency,
        ctx.now,
    );
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, effects)
}

fn report_payment(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if current.state == LinkState::PaymentReported {
        return Ok(LinkChange::Unchanged("a payment is already reported"));
    }
    if current.state != LinkState::Sent {
        return Err(MoneyError::conflict(
            "card_not_sent",
            "a payment can be reported once the link was sent",
        ));
    }
    need(action.source, "source")?;
    let mismatch = if action
        .amount_minor
        .is_some_and(|amount| amount != current.amount_minor)
    {
        Some(Mismatch::Amount)
    } else if action
        .currency
        .as_deref()
        .is_some_and(|currency| currency != current.currency)
    {
        Some(Mismatch::Currency)
    } else {
        None
    };
    let mut head = current.clone();
    head.state = LinkState::PaymentReported;
    head.payment = Some(PaymentInfo {
        state: PaymentState::Reported,
        source: PaymentSource::Report,
        reference: action.provider_reference.clone(),
        amount_minor: action.amount_minor,
        currency: action.currency.clone(),
        at: ctx.now,
        notice_id: None,
        payment_id: None,
        evidence_event_id: None,
        mismatch,
    });
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, Vec::new())
}

fn confirm_payment(
    current: &LinkHead,
    action: &LinkAction,
    ctx: &LinkContext,
) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can confirm a payment",
        ));
    }
    if current.state == LinkState::Paid
        || current
            .payment
            .as_ref()
            .is_some_and(|payment| payment.state == PaymentState::Verified)
    {
        return Ok(LinkChange::Unchanged("this payment is already confirmed"));
    }
    if !current.link_exists() || matches!(current.state, LinkState::Draft | LinkState::NeedsYou) {
        return Err(MoneyError::conflict(
            "card_not_sent",
            "a payment can be confirmed once the link has gone out",
        ));
    }
    let mut head = current.clone();
    head.state = LinkState::PaymentReported;
    head.failure = None;
    head.payment = Some(PaymentInfo {
        state: PaymentState::Verified,
        source: PaymentSource::OwnerTick,
        reference: action.provider_reference.clone().or_else(|| {
            head.link
                .as_ref()
                .and_then(|link| link.provider_reference.clone())
        }),
        amount_minor: Some(head.amount_minor),
        currency: Some(head.currency.clone()),
        at: ctx.now,
        notice_id: None,
        payment_id: None,
        evidence_event_id: None,
        mismatch: None,
    });
    let effect = LinkEffect::WriteEvidence {
        source: PaymentSource::OwnerTick,
        reference: head.payment.as_ref().and_then(|p| p.reference.clone()),
        amount_minor: head.amount_minor,
        currency: head.currency.clone(),
        at: ctx.now,
        notice_id: None,
    };
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, vec![effect])
}

fn dismiss_report(current: &LinkHead, ctx: &LinkContext) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can dismiss a payment report",
        ));
    }
    let reported = current
        .payment
        .as_ref()
        .is_some_and(|payment| payment.state == PaymentState::Reported);
    if current.state != LinkState::PaymentReported || !reported {
        return Err(MoneyError::conflict(
            "card_not_reported",
            "there is no unconfirmed payment report on this card",
        ));
    }
    let mut head = current.clone();
    head.state = LinkState::Sent;
    head.payment = None;
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, Vec::new())
}

fn retry(current: &LinkHead, ctx: &LinkContext) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can try a card again",
        ));
    }
    let retryable = current
        .failure
        .as_ref()
        .is_some_and(|failure| failure.retryable);
    if current.state != LinkState::Failed || !retryable {
        return Err(MoneyError::conflict(
            "card_not_retryable",
            "this card cannot be tried again",
        ));
    }
    let mut head = current.clone();
    // Retry never skips the approval: it must still match the facts on the card.
    if !head.approval_is_valid() {
        head.void_approval();
        head.state = LinkState::NeedsYou;
        head.failure = None;
        head.touch(ctx.now, &ctx.action_event_id);
        return changed(head, vec![LinkEffect::CancelJobs]);
    }
    check_invoice(&head, ctx.invoice.as_ref(), true)?;
    check_connection(&head, ctx.connection.as_ref(), true)?;
    head.failure = None;
    head.state = LinkState::CreatingLink;
    let effect = if head.link_exists() {
        if let Some(delivery) = head.delivery.as_mut() {
            delivery.state = DeliveryState::Pending;
        }
        LinkEffect::QueueSend
    } else {
        match head.route {
            Route::Api => LinkEffect::QueueCreate,
            Route::Browser => {
                let host = ctx
                    .connection
                    .as_ref()
                    .and_then(|connection| connection.browser_host.clone())
                    .unwrap_or_default();
                head.browser_grant = Some(BrowserGrant {
                    host,
                    from: ctx.now,
                    until: ctx.now + BROWSER_GRANT_SECS,
                    used_at: None,
                });
                LinkEffect::WakeBrowser
            }
        }
    };
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, vec![effect])
}

fn mark_sent(current: &LinkHead, ctx: &LinkContext) -> Result<LinkChange, MoneyError> {
    if !ctx.actor.role.is_owner_admin() {
        return Err(MoneyError::forbidden(
            "money_forbidden",
            "only the owner or an admin can mark a link as sent",
        ));
    }
    if !matches!(current.state, LinkState::CreatingLink | LinkState::Failed)
        || !current.link_exists()
    {
        return Err(MoneyError::conflict(
            "card_not_sendable",
            "there is no created link waiting to be sent",
        ));
    }
    let mut head = current.clone();
    head.state = LinkState::Sent;
    head.failure = None;
    head.delivery = Some(Delivery {
        channel: head.recipient_channel,
        state: DeliveryState::Manual,
        sent_at: Some(ctx.now),
    });
    head.touch(ctx.now, &ctx.action_event_id);
    changed(head, vec![LinkEffect::CancelJobs])
}

/// A transition the relay makes on its own. Never accepted from a member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemOp {
    /// The API route created the link (or the browser route's link was recorded by the relay).
    LinkCreated {
        /// Link URL.
        url: String,
        /// Provider reference.
        provider_reference: Option<String>,
        /// Amount the provider reports for the link.
        shown_amount_minor: i64,
        /// Currency the provider reports for the link.
        shown_currency: String,
    },
    /// The message was sent.
    Delivered,
    /// The send failed.
    DeliveryFailed {
        /// Stable code.
        code: String,
        /// Plain words.
        reason: String,
        /// Whether Try again is offered.
        retryable: bool,
    },
    /// Anything else that failed.
    Fail {
        /// Stable code.
        code: String,
        /// Plain words.
        reason: String,
        /// Whether Try again is offered.
        retryable: bool,
    },
    /// The 15 minute browser window ran out.
    GrantExpired,
    /// The link's life ended.
    Expire,
    /// A notice was judged.
    Notice {
        /// The stored notice.
        notice_id: Uuid,
        /// `Some` when verified.
        verified_by: Option<VerifiedBy>,
        /// Provider reference read from the notice.
        reference: Option<String>,
        /// Amount read from the notice.
        amount_minor: Option<i64>,
        /// Currency read from the notice.
        currency: Option<String>,
        /// When the payment happened.
        at: i64,
        /// What differs from the card.
        mismatch: Option<Mismatch>,
    },
    /// Payment evidence was written.
    EvidenceRecorded {
        /// Evidence id.
        payment_id: Uuid,
        /// Evidence event id.
        evidence_event_id: String,
    },
    /// Payment evidence could not be written yet.
    EvidencePending {
        /// Plain words.
        reason: String,
    },
}

/// Applies a relay transition. Idempotent: repeating one changes nothing.
pub fn apply_system(
    current: &LinkHead,
    op: &SystemOp,
    now: i64,
    source_event_id: &str,
) -> Result<LinkChange, MoneyError> {
    let mut head = current.clone();
    let mut effects = Vec::new();
    match op {
        SystemOp::LinkCreated {
            url,
            provider_reference,
            shown_amount_minor,
            shown_currency,
        } => {
            if current.state != LinkState::CreatingLink || current.link_exists() {
                return Ok(LinkChange::Unchanged("the link was already recorded"));
            }
            if !current.approval_is_valid() {
                return Err(MoneyError::conflict(
                    "approval_missing",
                    "the card has no valid approval, so no link is accepted",
                ));
            }
            effects = link_checked(
                &mut head,
                url.clone(),
                provider_reference.clone(),
                *shown_amount_minor,
                shown_currency,
                now,
            );
        }
        SystemOp::Delivered => {
            if current.state == LinkState::Sent {
                return Ok(LinkChange::Unchanged("already sent"));
            }
            if !matches!(current.state, LinkState::CreatingLink | LinkState::Failed)
                || !current.link_exists()
            {
                return Ok(LinkChange::Unchanged("nothing was waiting to be sent"));
            }
            head.state = LinkState::Sent;
            head.failure = None;
            head.delivery = Some(Delivery {
                channel: head.recipient_channel,
                state: DeliveryState::Sent,
                sent_at: Some(now),
            });
        }
        SystemOp::DeliveryFailed {
            code,
            reason,
            retryable,
        } => {
            if current.state != LinkState::CreatingLink || !current.link_exists() {
                return Ok(LinkChange::Unchanged("nothing was waiting to be sent"));
            }
            if let Some(delivery) = head.delivery.as_mut() {
                delivery.state = DeliveryState::Failed;
            }
            fail_head(&mut head, code, reason, *retryable, now);
        }
        SystemOp::Fail {
            code,
            reason,
            retryable,
        } => {
            if !matches!(current.state, LinkState::CreatingLink) {
                return Ok(LinkChange::Unchanged("the card is not being created"));
            }
            fail_head(&mut head, code, reason, *retryable, now);
        }
        SystemOp::GrantExpired => {
            let expired = current
                .browser_grant
                .as_ref()
                .is_some_and(|grant| now >= grant.until);
            if current.state != LinkState::CreatingLink || current.link_exists() || !expired {
                return Ok(LinkChange::Unchanged("the browser window is still open"));
            }
            fail_head(
                &mut head,
                "browser_grant_expired",
                "The 15 minute window for the browser step ran out. Try again when you are at your Mac.",
                true,
                now,
            );
            head.browser_grant = None;
        }
        SystemOp::Expire => {
            let due = current.expires_at.is_some_and(|at| now >= at);
            let confirmed = current
                .payment
                .as_ref()
                .is_some_and(|payment| payment.state == PaymentState::Verified);
            let live = matches!(current.state, LinkState::Sent | LinkState::PaymentReported);
            if !due || !live || confirmed {
                return Ok(LinkChange::Unchanged("the link is not due to expire"));
            }
            head.state = LinkState::Expired;
        }
        SystemOp::Notice {
            notice_id,
            verified_by,
            reference,
            amount_minor,
            currency,
            at,
            mismatch,
        } => {
            let counts = current.link_exists()
                && matches!(
                    current.state,
                    LinkState::CreatingLink
                        | LinkState::Sent
                        | LinkState::PaymentReported
                        | LinkState::Failed
                        | LinkState::Expired
                        | LinkState::Cancelled
                );
            if !counts {
                return Ok(LinkChange::Unchanged("the card cannot take a payment now"));
            }
            let already_confirmed = current
                .payment
                .as_ref()
                .is_some_and(|payment| payment.state == PaymentState::Verified);
            if already_confirmed {
                return Ok(LinkChange::Unchanged("this payment is already confirmed"));
            }
            match verified_by {
                Some(by) if mismatch.is_none() => {
                    let source = match by {
                        VerifiedBy::Hmac => PaymentSource::Hmac,
                        VerifiedBy::Lookup => PaymentSource::Lookup,
                    };
                    head.state = LinkState::PaymentReported;
                    head.failure = None;
                    head.payment = Some(PaymentInfo {
                        state: PaymentState::Verified,
                        source,
                        reference: reference.clone(),
                        amount_minor: Some(head.amount_minor),
                        currency: Some(head.currency.clone()),
                        at: *at,
                        notice_id: Some(*notice_id),
                        payment_id: None,
                        evidence_event_id: None,
                        mismatch: None,
                    });
                    effects.push(LinkEffect::WriteEvidence {
                        source,
                        reference: reference.clone(),
                        amount_minor: head.amount_minor,
                        currency: head.currency.clone(),
                        at: *at,
                        notice_id: Some(*notice_id),
                    });
                }
                _ => {
                    // Never Paid on an unverified or mismatching notice.
                    if current.state == LinkState::PaymentReported && current.payment.is_some() {
                        return Ok(LinkChange::Unchanged("a payment is already reported"));
                    }
                    head.state = LinkState::PaymentReported;
                    head.payment = Some(PaymentInfo {
                        state: PaymentState::Reported,
                        source: PaymentSource::Notice,
                        reference: reference.clone(),
                        amount_minor: *amount_minor,
                        currency: currency.clone(),
                        at: *at,
                        notice_id: Some(*notice_id),
                        payment_id: None,
                        evidence_event_id: None,
                        mismatch: *mismatch,
                    });
                }
            }
        }
        SystemOp::EvidenceRecorded {
            payment_id,
            evidence_event_id,
        } => {
            if current.state == LinkState::Paid {
                return Ok(LinkChange::Unchanged("already paid"));
            }
            let verified = current
                .payment
                .as_ref()
                .is_some_and(|payment| payment.state == PaymentState::Verified);
            if !verified {
                return Err(MoneyError::conflict(
                    "payment_not_verified",
                    "evidence is only recorded for a verified payment",
                ));
            }
            head.state = LinkState::Paid;
            head.failure = None;
            if let Some(payment) = head.payment.as_mut() {
                payment.payment_id = Some(*payment_id);
                payment.evidence_event_id = Some(evidence_event_id.clone());
            }
        }
        SystemOp::EvidencePending { reason } => {
            let verified = current
                .payment
                .as_ref()
                .is_some_and(|payment| payment.state == PaymentState::Verified);
            if current.state != LinkState::PaymentReported || !verified {
                return Ok(LinkChange::Unchanged(
                    "no payment is waiting to be recorded",
                ));
            }
            head.failure = Some(Failure {
                code: "evidence_pending".to_owned(),
                reason: reason.clone(),
                retryable: false,
                at: now,
            });
        }
    }
    head.touch(now, source_event_id);
    changed(head, effects)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eid(n: u64) -> String {
        format!("{n:064x}")
    }

    const OWNER: &str = "aa";
    const SCOUT: &str = "bb";

    fn invoice(status: InvoiceStatus) -> InvoiceFacts {
        InvoiceFacts {
            status,
            currency: "ZAR".to_owned(),
            total_minor: 1_000_000,
            outstanding_minor: if status == InvoiceStatus::Issued {
                1_000_000
            } else {
                0
            },
            number: "INV-0012".to_owned(),
            client_id: Uuid::from_u128(7),
            customer_name: "Plane Tree Cafe".to_owned(),
        }
    }

    fn connection(route: Route) -> ConnectionFacts {
        ConnectionFacts {
            connection_id: Uuid::from_u128(9),
            label: "Stripe".to_owned(),
            route,
            status: ConnectionStatus::Connected,
            has_create_recipe: true,
            browser_host: Some("dashboard.stripe.com".to_owned()),
        }
    }

    fn ctx(pubkey: &str, role: ActorRole, now: i64, route: Route) -> LinkContext {
        LinkContext {
            now,
            actor: LinkActor {
                pubkey: pubkey.to_owned(),
                role,
            },
            invoice: Some(invoice(InvoiceStatus::Issued)),
            connection: Some(connection(route)),
            action_event_id: format!("{now:064x}"),
            new_recipient_ref: Uuid::from_u128(u128::from(now as u64) + 1_000),
        }
    }

    fn action(op: LinkOp, head: Option<&LinkHead>) -> LinkAction {
        LinkAction {
            schema_version: MONEY_RAILS_SCHEMA_VERSION,
            op,
            link_id: head.map_or(Uuid::from_u128(1), |h| h.link_id),
            expected_head_event_id: head.map(|h| h.source_event_id.clone()),
            party_id: None,
            invoice_id: None,
            amount_minor: None,
            currency: None,
            purpose: None,
            connection_id: None,
            recipient: None,
            message: None,
            expires_in_days: None,
            facts: None,
            reason: None,
            note: None,
            url: None,
            provider_reference: None,
            shown_amount_minor: None,
            shown_currency: None,
            source: None,
        }
    }

    fn draft_action() -> LinkAction {
        let mut draft = action(LinkOp::Draft, None);
        draft.party_id = Some("party-1".to_owned());
        draft.invoice_id = Some(Uuid::from_u128(5));
        draft.amount_minor = Some(375_000);
        draft.currency = Some("ZAR".to_owned());
        draft.purpose = Some("Deposit for the shopfront refit".to_owned());
        draft.connection_id = Some(Uuid::from_u128(9));
        draft.recipient = Some(RecipientInput {
            channel: RecipientChannel::Whatsapp,
            address: "+27 82 123 4521".to_owned(),
            name: "Thandi".to_owned(),
        });
        draft.message = Some("Hi Thandi, here is your deposit link: {link}".to_owned());
        draft
    }

    fn head_of(change: LinkChange) -> LinkHead {
        match change {
            LinkChange::Changed(outcome) => outcome.head,
            LinkChange::Unchanged(why) => panic!("expected a change, got unchanged: {why}"),
        }
    }

    fn effects_of(change: &LinkChange) -> Vec<LinkEffect> {
        match change {
            LinkChange::Changed(outcome) => outcome.effects.clone(),
            LinkChange::Unchanged(_) => Vec::new(),
        }
    }

    fn drafted(route: Route) -> LinkHead {
        let change = apply_link_action(
            None,
            &draft_action(),
            &ctx(SCOUT, ActorRole::OwnedAgent, 100, route),
        )
        .expect("scout drafts");
        head_of(change)
    }

    fn approval_facts(head: &LinkHead) -> ApprovalFacts {
        ApprovalFacts {
            invoice_id: head.invoice_id,
            amount_minor: head.amount_minor,
            currency: head.currency.clone(),
            connection_id: head.connection_id,
            recipient_ref: head.recipient_ref,
            message: head.message.clone(),
            expires_in_days: head.expires_in_days,
        }
    }

    fn approved(route: Route) -> LinkHead {
        let head = drafted(route);
        let mut approve = action(LinkOp::Approve, Some(&head));
        approve.facts = Some(approval_facts(&head));
        head_of(
            apply_link_action(
                Some(&head),
                &approve,
                &ctx(OWNER, ActorRole::OwnerAdmin, 200, route),
            )
            .expect("owner approves"),
        )
    }

    #[test]
    fn scout_drafts_a_card_that_waits_for_the_owner_and_holds_no_address() {
        let head = drafted(Route::Api);
        assert_eq!(head.state, LinkState::NeedsYou);
        assert_eq!(head.recipient_display, "+27 82 *** 4521");
        let json = serde_json::to_string(&head).expect("head json");
        assert!(!json.contains("27821234521"), "{json}");
        assert!(head.approval.is_none());
        let change = apply_link_action(
            None,
            &draft_action(),
            &ctx(SCOUT, ActorRole::OwnedAgent, 100, Route::Api),
        )
        .expect("draft");
        assert!(matches!(
            effects_of(&change).first(),
            Some(LinkEffect::PutRecipient { address, .. }) if address == "27821234521"
        ));
    }

    #[test]
    fn a_draft_against_an_unissued_invoice_waits_and_cannot_be_approved() {
        let mut context = ctx(SCOUT, ActorRole::OwnedAgent, 100, Route::Api);
        context.invoice = Some(invoice(InvoiceStatus::Draft));
        let head = head_of(apply_link_action(None, &draft_action(), &context).expect("draft"));
        assert_eq!(head.state, LinkState::Draft);
        assert_eq!(head.waiting_for.as_deref(), Some("invoice_issue"));
        // Even if the owner tries to approve it straight away.
        let mut approve = action(LinkOp::Approve, Some(&head));
        approve.facts = Some(approval_facts(&head));
        let error = apply_link_action(
            Some(&head),
            &approve,
            &ctx(OWNER, ActorRole::OwnerAdmin, 150, Route::Api),
        )
        .expect_err("not waiting for approval");
        assert_eq!(error.code, "card_not_waiting");
    }

    #[test]
    fn amount_currency_and_message_are_checked_at_draft() {
        let bad = |change: &dyn Fn(&mut LinkAction)| {
            let mut draft = draft_action();
            change(&mut draft);
            apply_link_action(
                None,
                &draft,
                &ctx(SCOUT, ActorRole::OwnedAgent, 100, Route::Api),
            )
            .expect_err("rejected")
            .code
        };
        assert_eq!(
            bad(&|d| d.amount_minor = Some(2_000_000)),
            "amount_exceeds_outstanding"
        );
        assert_eq!(bad(&|d| d.amount_minor = Some(0)), "money_invalid_input");
        assert_eq!(
            bad(&|d| d.currency = Some("USD".to_owned())),
            "currency_mismatch"
        );
        assert_eq!(
            bad(&|d| d.message = Some("no link here".to_owned())),
            "money_invalid_input"
        );
        assert_eq!(
            bad(&|d| d.message = Some("{link} and {link}".to_owned())),
            "money_invalid_input"
        );
    }

    #[test]
    fn only_the_owner_can_approve_and_scout_never_can() {
        let head = drafted(Route::Api);
        let mut approve = action(LinkOp::Approve, Some(&head));
        approve.facts = Some(approval_facts(&head));
        for (pubkey, role) in [(SCOUT, ActorRole::OwnedAgent), ("cc", ActorRole::Other)] {
            let error =
                apply_link_action(Some(&head), &approve, &ctx(pubkey, role, 200, Route::Api))
                    .expect_err("must not approve");
            assert_eq!(error.kind, crate::money_rails::ErrorKind::Forbidden);
        }
    }

    #[test]
    fn approve_is_atomic_and_rechecks_every_fact_against_the_head() {
        let head = drafted(Route::Api);
        for tamper in 0..7 {
            let mut facts = approval_facts(&head);
            match tamper {
                0 => facts.amount_minor += 1,
                1 => facts.currency = "USD".to_owned(),
                2 => facts.recipient_ref = Uuid::from_u128(999),
                3 => facts.message = "Hi, pay here {link} please".to_owned(),
                4 => facts.connection_id = Uuid::from_u128(77),
                5 => facts.invoice_id = Uuid::from_u128(88),
                _ => facts.expires_in_days += 1,
            }
            let mut approve = action(LinkOp::Approve, Some(&head));
            approve.facts = Some(facts);
            let error = apply_link_action(
                Some(&head),
                &approve,
                &ctx(OWNER, ActorRole::OwnerAdmin, 200, Route::Api),
            )
            .expect_err("a changed fact must refuse the approval");
            assert_eq!(error.code, "approval_facts_changed", "tamper {tamper}");
        }
    }

    #[test]
    fn approve_moves_to_creating_link_with_a_valid_digest_and_queues_the_job() {
        let head = drafted(Route::Api);
        let mut approve = action(LinkOp::Approve, Some(&head));
        approve.facts = Some(approval_facts(&head));
        let change = apply_link_action(
            Some(&head),
            &approve,
            &ctx(OWNER, ActorRole::OwnerAdmin, 200, Route::Api),
        )
        .expect("approve");
        assert_eq!(effects_of(&change), vec![LinkEffect::QueueCreate]);
        let approved = head_of(change);
        assert_eq!(approved.state, LinkState::CreatingLink);
        assert!(approved.approval_is_valid());
        assert_eq!(approved.expires_at, Some(200 + 14 * 86_400));
        assert_eq!(
            approved.approval.as_ref().map(|a| a.approved_by.as_str()),
            Some(OWNER)
        );
    }

    #[test]
    fn approving_a_browser_card_opens_one_fifteen_minute_grant() {
        let head = approved(Route::Browser);
        let grant = head.browser_grant.expect("grant");
        assert_eq!(grant.host, "dashboard.stripe.com");
        assert_eq!(grant.until - grant.from, 15 * 60);
        assert!(grant.used_at.is_none());
    }

    #[test]
    fn editing_after_approval_voids_the_approval_and_the_digest_no_longer_matches() {
        let head = approved(Route::Api);
        assert!(head.approval_is_valid());
        let mut edit = action(LinkOp::Edit, Some(&head));
        edit.amount_minor = Some(400_000);
        let change = apply_link_action(
            Some(&head),
            &edit,
            &ctx(OWNER, ActorRole::OwnerAdmin, 300, Route::Api),
        )
        .expect("owner edits");
        assert!(effects_of(&change).contains(&LinkEffect::CancelJobs));
        let edited = head_of(change);
        assert_eq!(edited.state, LinkState::NeedsYou);
        assert!(edited.approval.is_none());
        assert!(edited.approval_voided);
        assert!(!edited.approval_is_valid());
        assert_eq!(edited.amount_minor, 400_000);

        // The old approval facts can no longer be replayed against the edited card.
        let mut stale = action(LinkOp::Approve, Some(&edited));
        stale.facts = Some(approval_facts(&head));
        let error = apply_link_action(
            Some(&edited),
            &stale,
            &ctx(OWNER, ActorRole::OwnerAdmin, 310, Route::Api),
        )
        .expect_err("approve after edit with the old facts");
        assert_eq!(error.code, "approval_facts_changed");
    }

    #[test]
    fn scout_cannot_edit_a_card_the_owner_approved() {
        let head = approved(Route::Api);
        let mut edit = action(LinkOp::Edit, Some(&head));
        edit.amount_minor = Some(1);
        let error = apply_link_action(
            Some(&head),
            &edit,
            &ctx(SCOUT, ActorRole::OwnedAgent, 300, Route::Api),
        )
        .expect_err("agent edit after approval");
        assert_eq!(error.kind, crate::money_rails::ErrorKind::Forbidden);
    }

    #[test]
    fn a_card_with_a_created_link_cannot_be_edited() {
        let head = approved(Route::Api);
        let created = head_of(
            apply_system(
                &head,
                &SystemOp::LinkCreated {
                    url: "https://buy.stripe.com/x".to_owned(),
                    provider_reference: Some("plink_1".to_owned()),
                    shown_amount_minor: 375_000,
                    shown_currency: "ZAR".to_owned(),
                },
                400,
                &eid(1),
            )
            .expect("link created"),
        );
        assert_eq!(created.state, LinkState::CreatingLink);
        let mut edit = action(LinkOp::Edit, Some(&created));
        edit.amount_minor = Some(1);
        let error = apply_link_action(
            Some(&created),
            &edit,
            &ctx(OWNER, ActorRole::OwnerAdmin, 500, Route::Api),
        )
        .expect_err("locked");
        assert_eq!(error.code, "card_locked");
    }

    #[test]
    fn a_link_with_another_amount_stops_the_flow_and_nothing_is_sent() {
        let head = approved(Route::Api);
        let change = apply_system(
            &head,
            &SystemOp::LinkCreated {
                url: "https://buy.stripe.com/x".to_owned(),
                provider_reference: Some("plink_1".to_owned()),
                shown_amount_minor: 37_500,
                shown_currency: "ZAR".to_owned(),
            },
            400,
            &eid(1),
        )
        .expect("mismatch is a result, not an error");
        assert!(!effects_of(&change).contains(&LinkEffect::QueueSend));
        let back = head_of(change);
        assert_eq!(back.state, LinkState::NeedsYou);
        assert!(back.approval.is_none());
        assert!(back.link.is_none());
        assert_eq!(
            back.failure.as_ref().map(|f| f.code.as_str()),
            Some("amount_mismatch")
        );

        let other_currency = apply_system(
            &head,
            &SystemOp::LinkCreated {
                url: "https://buy.stripe.com/x".to_owned(),
                provider_reference: None,
                shown_amount_minor: 375_000,
                shown_currency: "USD".to_owned(),
            },
            400,
            &eid(2),
        )
        .expect("currency mismatch");
        assert_eq!(
            head_of(other_currency).failure.map(|f| f.code),
            Some("currency_shown_mismatch".to_owned())
        );
    }

    #[test]
    fn the_browser_route_records_a_checked_link_only_inside_the_grant() {
        let head = approved(Route::Browser);
        let mut record = action(LinkOp::RecordCreated, Some(&head));
        record.url = Some("https://buy.stripe.com/test_x".to_owned());
        record.shown_amount_minor = Some(375_000);
        record.shown_currency = Some("ZAR".to_owned());
        let created = head_of(
            apply_link_action(
                Some(&head),
                &record,
                &ctx(SCOUT, ActorRole::OwnedAgent, 300, Route::Browser),
            )
            .expect("recorded"),
        );
        assert!(created.link_exists());
        assert_eq!(
            created.delivery.as_ref().map(|d| d.state),
            Some(DeliveryState::Pending)
        );

        // After the 15 minutes the window is gone: the card fails, retryable, nothing sent.
        let late = head_of(
            apply_link_action(
                Some(&head),
                &record,
                &ctx(SCOUT, ActorRole::OwnedAgent, 200 + 16 * 60, Route::Browser),
            )
            .expect("late record is recorded as a failure"),
        );
        assert_eq!(late.state, LinkState::Failed);
        assert_eq!(
            late.failure
                .as_ref()
                .map(|f| (f.code.as_str(), f.retryable)),
            Some(("browser_grant_expired", true))
        );

        // A plain http link is refused.
        let mut insecure = record.clone();
        insecure.url = Some("http://buy.stripe.com/x".to_owned());
        assert!(apply_link_action(
            Some(&head),
            &insecure,
            &ctx(SCOUT, ActorRole::OwnedAgent, 300, Route::Browser),
        )
        .is_err());
    }

    #[test]
    fn delivery_moves_a_created_card_to_sent_once() {
        let head = approved(Route::Api);
        let created = head_of(
            apply_system(
                &head,
                &SystemOp::LinkCreated {
                    url: "https://buy.stripe.com/x".to_owned(),
                    provider_reference: Some("plink_1".to_owned()),
                    shown_amount_minor: 375_000,
                    shown_currency: "ZAR".to_owned(),
                },
                400,
                &eid(1),
            )
            .expect("created"),
        );
        let sent =
            head_of(apply_system(&created, &SystemOp::Delivered, 410, &eid(2)).expect("sent"));
        assert_eq!(sent.state, LinkState::Sent);
        assert!(matches!(
            apply_system(&sent, &SystemOp::Delivered, 420, &eid(3)).expect("repeat"),
            LinkChange::Unchanged(_)
        ));
    }

    fn sent_card() -> LinkHead {
        let head = approved(Route::Api);
        let created = head_of(
            apply_system(
                &head,
                &SystemOp::LinkCreated {
                    url: "https://buy.stripe.com/x".to_owned(),
                    provider_reference: Some("plink_1".to_owned()),
                    shown_amount_minor: 375_000,
                    shown_currency: "ZAR".to_owned(),
                },
                400,
                &eid(1),
            )
            .expect("created"),
        );
        head_of(apply_system(&created, &SystemOp::Delivered, 410, &eid(2)).expect("sent"))
    }

    fn notice(verified_by: Option<VerifiedBy>, mismatch: Option<Mismatch>) -> SystemOp {
        SystemOp::Notice {
            notice_id: Uuid::from_u128(55),
            verified_by,
            reference: Some("plink_1".to_owned()),
            amount_minor: Some(375_000),
            currency: Some("ZAR".to_owned()),
            at: 500,
            mismatch,
        }
    }

    #[test]
    fn an_unverified_notice_reports_but_never_pays() {
        let sent = sent_card();
        let change = apply_system(&sent, &notice(None, None), 500, &eid(3)).expect("notice");
        assert!(effects_of(&change).is_empty(), "no evidence is written");
        let reported = head_of(change);
        assert_eq!(reported.state, LinkState::PaymentReported);
        assert_eq!(
            reported.payment.as_ref().map(|p| p.state),
            Some(PaymentState::Reported)
        );
        assert_ne!(reported.state, LinkState::Paid);
    }

    #[test]
    fn a_verified_notice_with_other_facts_is_still_only_a_report() {
        let sent = sent_card();
        let change = apply_system(
            &sent,
            &notice(Some(VerifiedBy::Hmac), Some(Mismatch::Amount)),
            500,
            &eid(3),
        )
        .expect("notice");
        assert!(effects_of(&change).is_empty());
        let reported = head_of(change);
        assert_eq!(reported.state, LinkState::PaymentReported);
        assert_eq!(
            reported.payment.as_ref().and_then(|p| p.mismatch),
            Some(Mismatch::Amount)
        );
    }

    #[test]
    fn a_verified_notice_records_evidence_before_the_card_is_paid() {
        let sent = sent_card();
        let change = apply_system(&sent, &notice(Some(VerifiedBy::Hmac), None), 500, &eid(3))
            .expect("verified");
        assert!(matches!(
            effects_of(&change).first(),
            Some(LinkEffect::WriteEvidence {
                amount_minor: 375_000,
                ..
            })
        ));
        let waiting = head_of(change);
        assert_eq!(waiting.state, LinkState::PaymentReported);
        assert_eq!(
            waiting.payment.as_ref().map(|p| p.state),
            Some(PaymentState::Verified)
        );
        let paid = head_of(
            apply_system(
                &waiting,
                &SystemOp::EvidenceRecorded {
                    payment_id: Uuid::from_u128(66),
                    evidence_event_id: "ev".to_owned(),
                },
                510,
                &eid(4),
            )
            .expect("evidence"),
        );
        assert_eq!(paid.state, LinkState::Paid);
        // A replay of the same notice, or a second one, changes nothing.
        assert!(matches!(
            apply_system(&paid, &notice(Some(VerifiedBy::Hmac), None), 520, &eid(5))
                .expect("replay"),
            LinkChange::Unchanged(_)
        ));
    }

    #[test]
    fn evidence_for_an_unverified_payment_is_refused() {
        let sent = sent_card();
        let reported =
            head_of(apply_system(&sent, &notice(None, None), 500, &eid(3)).expect("report"));
        let error = apply_system(
            &reported,
            &SystemOp::EvidenceRecorded {
                payment_id: Uuid::from_u128(66),
                evidence_event_id: "ev".to_owned(),
            },
            510,
            &eid(4),
        )
        .expect_err("not verified");
        assert_eq!(error.code, "payment_not_verified");
    }

    #[test]
    fn the_owner_tick_confirms_and_records_evidence() {
        let sent = sent_card();
        let mut confirm = action(LinkOp::ConfirmPayment, Some(&sent));
        confirm.note = Some("Seen in Stripe".to_owned());
        let denied = apply_link_action(
            Some(&sent),
            &confirm,
            &ctx(SCOUT, ActorRole::OwnedAgent, 600, Route::Api),
        )
        .expect_err("scout cannot tick");
        assert_eq!(denied.kind, crate::money_rails::ErrorKind::Forbidden);
        let change = apply_link_action(
            Some(&sent),
            &confirm,
            &ctx(OWNER, ActorRole::OwnerAdmin, 600, Route::Api),
        )
        .expect("owner ticks");
        assert!(matches!(
            effects_of(&change).first(),
            Some(LinkEffect::WriteEvidence {
                source: PaymentSource::OwnerTick,
                ..
            })
        ));
    }

    #[test]
    fn scout_can_report_a_payment_but_it_stays_a_report() {
        let sent = sent_card();
        let mut report = action(LinkOp::ReportPayment, Some(&sent));
        report.source = Some(ReportSource::Dashboard);
        report.note = Some("Saw it in the dashboard".to_owned());
        let reported = head_of(
            apply_link_action(
                Some(&sent),
                &report,
                &ctx(SCOUT, ActorRole::OwnedAgent, 600, Route::Api),
            )
            .expect("report"),
        );
        assert_eq!(reported.state, LinkState::PaymentReported);
        assert_eq!(
            reported.payment.as_ref().map(|p| p.state),
            Some(PaymentState::Reported)
        );
        // The owner can dismiss it.
        let dismissed = head_of(
            apply_link_action(
                Some(&reported),
                &action(LinkOp::DismissReport, Some(&reported)),
                &ctx(OWNER, ActorRole::OwnerAdmin, 610, Route::Api),
            )
            .expect("dismiss"),
        );
        assert_eq!(dismissed.state, LinkState::Sent);
        assert!(dismissed.payment.is_none());
    }

    #[test]
    fn expiry_moves_only_an_unconfirmed_sent_card() {
        let sent = sent_card();
        let expires_at = sent.expires_at.expect("expiry");
        assert!(matches!(
            apply_system(&sent, &SystemOp::Expire, expires_at - 1, &eid(9)).expect("early"),
            LinkChange::Unchanged(_)
        ));
        assert_eq!(
            head_of(apply_system(&sent, &SystemOp::Expire, expires_at, &eid(9)).expect("due"))
                .state,
            LinkState::Expired
        );
        // A confirmed payment waiting for its evidence never expires.
        let waiting = head_of(
            apply_system(&sent, &notice(Some(VerifiedBy::Hmac), None), 500, &eid(3))
                .expect("verified"),
        );
        assert!(matches!(
            apply_system(&waiting, &SystemOp::Expire, expires_at + 1, &eid(9)).expect("confirmed"),
            LinkChange::Unchanged(_)
        ));
    }

    #[test]
    fn a_failed_card_retries_only_by_the_owner_and_only_with_a_valid_approval() {
        let head = approved(Route::Api);
        let failed = head_of(
            apply_system(
                &head,
                &SystemOp::Fail {
                    code: "provider_unreachable".to_owned(),
                    reason: "The provider did not answer.".to_owned(),
                    retryable: true,
                },
                400,
                &eid(1),
            )
            .expect("fail"),
        );
        assert_eq!(failed.state, LinkState::Failed);
        let retry = action(LinkOp::Retry, Some(&failed));
        assert!(apply_link_action(
            Some(&failed),
            &retry,
            &ctx(SCOUT, ActorRole::OwnedAgent, 500, Route::Api),
        )
        .is_err());
        let change = apply_link_action(
            Some(&failed),
            &retry,
            &ctx(OWNER, ActorRole::OwnerAdmin, 500, Route::Api),
        )
        .expect("owner retries");
        assert_eq!(effects_of(&change), vec![LinkEffect::QueueCreate]);
        assert_eq!(head_of(change).state, LinkState::CreatingLink);

        // If the facts no longer match the approval, retry goes back to the owner instead.
        let mut tampered = failed.clone();
        tampered.amount_minor += 1;
        let back = head_of(
            apply_link_action(
                Some(&tampered),
                &action(LinkOp::Retry, Some(&tampered)),
                &ctx(OWNER, ActorRole::OwnerAdmin, 500, Route::Api),
            )
            .expect("retry with a stale approval"),
        );
        assert_eq!(back.state, LinkState::NeedsYou);
        assert!(back.approval.is_none());
    }

    #[test]
    fn reject_records_the_reason_and_cancel_is_limited() {
        let head = drafted(Route::Api);
        let mut reject = action(LinkOp::Reject, Some(&head));
        reject.reason = Some("Wrong amount, it is 50 percent".to_owned());
        let rejected = head_of(
            apply_link_action(
                Some(&head),
                &reject,
                &ctx(OWNER, ActorRole::OwnerAdmin, 200, Route::Api),
            )
            .expect("reject"),
        );
        assert_eq!(rejected.state, LinkState::Cancelled);
        assert_eq!(
            rejected.cancel_reason.as_deref(),
            Some("Wrong amount, it is 50 percent")
        );
        // Scout may cancel its own draft but not an approved card.
        let own = apply_link_action(
            Some(&head),
            &action(LinkOp::Cancel, Some(&head)),
            &ctx(SCOUT, ActorRole::OwnedAgent, 210, Route::Api),
        );
        assert!(own.is_ok());
        let approved = approved(Route::Api);
        assert!(apply_link_action(
            Some(&approved),
            &action(LinkOp::Cancel, Some(&approved)),
            &ctx(SCOUT, ActorRole::OwnedAgent, 210, Route::Api),
        )
        .is_err());
    }

    #[test]
    fn every_command_after_draft_names_the_head() {
        let head = drafted(Route::Api);
        let mut edit = action(LinkOp::Edit, Some(&head));
        edit.expected_head_event_id = None;
        let error = apply_link_action(
            Some(&head),
            &edit,
            &ctx(OWNER, ActorRole::OwnerAdmin, 200, Route::Api),
        )
        .expect_err("no head named");
        assert_eq!(error.code, "expected_head_required");
    }

    #[test]
    fn members_who_are_not_owner_admin_or_their_agent_can_do_nothing() {
        let error = apply_link_action(
            None,
            &draft_action(),
            &ctx("dd", ActorRole::Other, 100, Route::Api),
        )
        .expect_err("plain member");
        assert_eq!(error.kind, crate::money_rails::ErrorKind::Forbidden);
    }
}
