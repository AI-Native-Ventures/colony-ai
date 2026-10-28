//! One log line for every managed-inference request that ends at the gateway.
//!
//! Before this, most endings left nothing in the relay log: a transport error to
//! the provider, an unreadable answer, a missing cost, a refused reply shape and
//! the admission refusals all answered a status and said nothing. A first hello
//! that ended in "Usage is being recovered automatically" could not be traced to
//! its path from `fly logs`. The line carries a fixed word for the path, the
//! status the client was (or would have been) given, the model, and how long the
//! request took. It never carries a prompt, a reply, a key or a provider body.

use std::time::Duration;

use uuid::Uuid;

/// Why a managed-inference request ended. One fixed word per path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Outcome {
    /// Answered and settled.
    Ok,
    /// Another request of the same session, or too many for the account, is in flight.
    AdmissionBusy,
    AdmissionInsufficient,
    AdmissionDailyLimit,
    /// The same request id is still in flight.
    AdmissionPending,
    /// The same request id was already charged.
    AdmissionCompleted,
    /// Every model refused it clearly; nothing was generated and the hold is released.
    UpstreamRejected,
    /// A transport failure, a timeout or a 5xx: the provider may have generated,
    /// so the hold is left to the recovery worker.
    UpstreamUnclear,
    /// The provider answered with something that is not a completion.
    AnswerUnreadable,
    /// The answer had no usable cost, or one above the hold.
    CostUnusable,
    /// The answer's choices were refused by the response policy.
    ReplyRefused,
    DatabaseError,
}

impl Outcome {
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::AdmissionBusy => "admission_busy",
            Self::AdmissionInsufficient => "admission_insufficient",
            Self::AdmissionDailyLimit => "admission_daily_limit",
            Self::AdmissionPending => "admission_pending",
            Self::AdmissionCompleted => "admission_completed",
            Self::UpstreamRejected => "upstream_rejected",
            Self::UpstreamUnclear => "upstream_unclear",
            Self::AnswerUnreadable => "answer_unreadable",
            Self::CostUnusable => "cost_unusable",
            Self::ReplyRefused => "reply_refused",
            Self::DatabaseError => "database_error",
        }
    }
}

/// What a finished request records about itself. Nothing in it is content.
pub(super) struct Finished<'a> {
    pub outcome: Outcome,
    /// The status the client was given, or would have been given when the
    /// connection had already been answered `200` to keep it alive.
    pub status: u16,
    pub request_id: Uuid,
    pub primary_model: &'a str,
    /// The model that answered, when one did.
    pub answered_by: Option<&'a str>,
    pub elapsed: Duration,
    /// The answer went out as a kept-alive stream, so its wire status is `200`.
    pub streamed: bool,
}

pub(super) fn log(finished: Finished<'_>) {
    let Finished {
        outcome,
        status,
        request_id,
        primary_model,
        answered_by,
        elapsed,
        streamed,
    } = finished;
    let outcome = outcome.code();
    let answered_by = answered_by.unwrap_or("none");
    let elapsed_ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX);
    if outcome == Outcome::Ok.code() {
        tracing::info!(
            outcome,
            status,
            %request_id,
            primary_model,
            answered_by,
            elapsed_ms,
            streamed,
            "Colony gateway request finished"
        );
    } else {
        tracing::warn!(
            outcome,
            status,
            %request_id,
            primary_model,
            answered_by,
            elapsed_ms,
            streamed,
            "Colony gateway request finished"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Default)]
    struct LogBuffer(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn logged(outcome: Outcome, status: u16, answered_by: Option<&str>) -> String {
        let logs = LogBuffer::default();
        let sink = logs.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(move || sink.clone())
            .with_ansi(false)
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            log(Finished {
                outcome,
                status,
                request_id: Uuid::nil(),
                primary_model: "free/a",
                answered_by,
                elapsed: Duration::from_millis(61_234),
                streamed: true,
            });
        });
        let bytes = logs.0.lock().unwrap().clone();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    /// A field is quoted or not depending on the formatter.
    fn has(line: &str, field: &str, value: &str) -> bool {
        line.contains(&format!("{field}=\"{value}\"")) || line.contains(&format!("{field}={value}"))
    }

    #[test]
    fn every_ending_has_its_own_fixed_word() {
        let all = [
            Outcome::Ok,
            Outcome::AdmissionBusy,
            Outcome::AdmissionInsufficient,
            Outcome::AdmissionDailyLimit,
            Outcome::AdmissionPending,
            Outcome::AdmissionCompleted,
            Outcome::UpstreamRejected,
            Outcome::UpstreamUnclear,
            Outcome::AnswerUnreadable,
            Outcome::CostUnusable,
            Outcome::ReplyRefused,
            Outcome::DatabaseError,
        ];
        let words: std::collections::HashSet<_> = all.iter().map(|o| o.code()).collect();
        assert_eq!(words.len(), all.len(), "two endings share a word");
        for word in words {
            assert!(
                word.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{word}"
            );
        }
    }

    #[test]
    fn a_finished_request_logs_its_path_status_model_and_time() {
        let text = logged(Outcome::UpstreamUnclear, 409, None);
        let line = text.lines().next().unwrap_or_default();
        assert!(line.contains("WARN"), "a failure is a warning: {line}");
        assert!(line.contains("Colony gateway request finished"), "{line}");
        assert!(has(line, "outcome", "upstream_unclear"), "{line}");
        assert!(has(line, "status", "409"), "{line}");
        assert!(has(line, "primary_model", "free/a"), "{line}");
        assert!(has(line, "elapsed_ms", "61234"), "{line}");
        assert!(has(line, "streamed", "true"), "{line}");
        let text = logged(Outcome::Ok, 200, Some("free/b"));
        let line = text.lines().next().unwrap_or_default();
        assert!(line.contains("INFO"), "a success is info: {line}");
        assert!(has(line, "outcome", "ok"), "{line}");
        assert!(has(line, "answered_by", "free/b"), "{line}");
    }
}
