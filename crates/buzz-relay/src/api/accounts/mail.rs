//! Resend API client for account and operator email codes.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::Serialize;
use thiserror::Error;
use zeroize::Zeroizing;

/// Mail delivery failures that can be retried without exposing provider details.
#[derive(Debug, Error)]
pub enum MailDeliveryError {
    /// Mail settings were not configured for this relay.
    #[error("account mail delivery is not configured")]
    Unconfigured,
    /// The request failed or the provider rejected it.
    #[error("account mail provider unavailable")]
    Provider,
}

/// The code purpose determines the plain-text Resend template.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CodeMailKind {
    /// Verify a new Colony account email address.
    VerifyEmail,
    /// Reset an existing Colony account password.
    PasswordReset,
    /// Establish an allowlisted deployment-operator admin session.
    AdminEmailLogin,
}

impl CodeMailKind {
    pub(crate) fn from_account_purpose(purpose: &str) -> Self {
        match purpose {
            "reset_password" => Self::PasswordReset,
            _ => Self::VerifyEmail,
        }
    }

    fn subject(self) -> &'static str {
        match self {
            Self::VerifyEmail => "Your verification code",
            Self::PasswordReset => "Your password reset code",
            Self::AdminEmailLogin => "Your Colony admin sign-in code",
        }
    }

    fn text(self, code: &str) -> Zeroizing<String> {
        match self {
            Self::VerifyEmail | Self::PasswordReset => Zeroizing::new(format!(
                "Your verification code is {code}. It expires in 15 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
            Self::AdminEmailLogin => Zeroizing::new(format!(
                "Your Colony admin sign-in code is {code}. It expires in 10 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
        }
    }
}

/// Shared outbound code-mail seam. Account flows and the admin email session
/// both use this interface, so one Resend implementation owns delivery.
pub(crate) trait CodeMailer: Send + Sync {
    /// Deliver one short-lived code without logging its recipient or value.
    fn send_code<'a>(
        &'a self,
        config: &'a crate::config::AccountConfig,
        recipient: &'a str,
        kind: CodeMailKind,
        code: &'a Zeroizing<String>,
    ) -> Pin<Box<dyn Future<Output = Result<(), MailDeliveryError>> + Send + 'a>>;
}

/// The production Resend delivery implementation.
pub(crate) struct ResendCodeMailer {
    client: reqwest::Client,
}

impl ResendCodeMailer {
    pub(crate) fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }
}

impl CodeMailer for ResendCodeMailer {
    fn send_code<'a>(
        &'a self,
        config: &'a crate::config::AccountConfig,
        recipient: &'a str,
        kind: CodeMailKind,
        code: &'a Zeroizing<String>,
    ) -> Pin<Box<dyn Future<Output = Result<(), MailDeliveryError>> + Send + 'a>> {
        Box::pin(send_resend(&self.client, config, recipient, kind, code))
    }
}

#[derive(Serialize)]
struct ResendEmail<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'static str,
    text: &'a str,
}

/// Send one code through Resend without logging its API token or payload.
async fn send_resend(
    client: &reqwest::Client,
    config: &crate::config::AccountConfig,
    recipient: &str,
    kind: CodeMailKind,
    code: &Zeroizing<String>,
) -> Result<(), MailDeliveryError> {
    let api_key = config
        .resend_api_key()
        .ok_or(MailDeliveryError::Unconfigured)?;
    let from = config.mail_from().ok_or(MailDeliveryError::Unconfigured)?;
    let text = kind.text(code.as_str());
    let body = ResendEmail {
        from,
        to: [recipient],
        subject: kind.subject(),
        text: text.as_str(),
    };
    let response = client
        .post("https://api.resend.com/emails")
        .timeout(Duration::from_secs(8))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|_| MailDeliveryError::Provider)?;
    if !response.status().is_success() {
        return Err(MailDeliveryError::Provider);
    }
    Ok(())
}
