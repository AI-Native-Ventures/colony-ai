//! Read account credits and open a server-priced PayFast checkout.

use crate::client::BuzzClient;
use crate::error::CliError;
use crate::CreditsCmd;

pub async fn dispatch(command: CreditsCmd, client: &BuzzClient) -> Result<(), CliError> {
    match command {
        CreditsCmd::Balance => print_body(client.get_authed("/api/payments/balance").await?),
        CreditsCmd::Usage => print_body(client.get_authed("/api/payments/usage").await?),
        CreditsCmd::History => print_body(client.get_authed("/api/payments/history").await?),
        CreditsCmd::Packs => print_body(client.get_public("/api/payments/packs").await?),
        CreditsCmd::Pay {
            pack_id,
            email,
            idempotency_key,
        } => {
            let idempotency_key =
                idempotency_key.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let idempotency_key = uuid::Uuid::parse_str(&idempotency_key)
                .map_err(|_| CliError::Usage("idempotency key must be a UUID".into()))?
                .to_string();
            let body = serde_json::json!({
                "packId": pack_id,
                "email": email,
                "idempotencyKey": idempotency_key,
            });
            let response = match client
                .post_json_once_authed("/api/payments/checkout", &body)
                .await
            {
                Ok(response) => response,
                Err(CliError::DeliveryUnknown(_)) => {
                    return Err(CliError::DeliveryUnknown(format!(
                        "checkout outcome is unknown; retry with --idempotency-key {idempotency_key}"
                    )))
                }
                Err(error) => return Err(error),
            };
            let checkout_url = checkout_url(&response);
            if checkout_url.is_none() && payment_status(&response).as_deref() != Some("paid") {
                return Err(CliError::Other(format!(
                    "relay response carries no authorizationUrl: {response}"
                )));
            }
            println!("{response}");
            Ok(())
        }
        CreditsCmd::Verify { reference } => {
            let path = format!("/api/payments/intents/{reference}");
            print_body(client.get_authed(&path).await?)
        }
    }
}

fn payment_status(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("status")?
        .as_str()
        .map(str::to_owned)
}

fn print_body(body: String) -> Result<(), CliError> {
    println!("{body}");
    Ok(())
}

fn checkout_url(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()?
        .get("authorizationUrl")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checkout_response_keeps_the_post_form_fields() {
        let body = r#"{"authorizationUrl":"https://sandbox.payfast.co.za/eng/process","authorizationMethod":"POST","authorizationFields":[{"name":"signature","value":"abc"}]}"#;
        assert_eq!(
            checkout_url(body).as_deref(),
            Some("https://sandbox.payfast.co.za/eng/process")
        );
        assert!(body.contains("\"authorizationMethod\":\"POST\""));
        assert_eq!(payment_status(body), None);
    }

    #[test]
    fn paid_idempotent_checkout_needs_no_second_form() {
        assert_eq!(
            payment_status(r#"{"status":"paid"}"#).as_deref(),
            Some("paid")
        );
    }
}
