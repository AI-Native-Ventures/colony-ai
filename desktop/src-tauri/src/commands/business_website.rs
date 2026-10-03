//! Business metadata uses the native, DNS-pinned preview transport.
use super::*;

/// Read public website context and sanitize its logo before returning to the renderer.
#[tauri::command]
pub async fn read_business_website(href: String) -> Result<LinkPreviewMetadata, String> {
    tokio::time::timeout(Duration::from_secs(30), read_website(href))
        .await
        .map_err(|_| "Website analysis timed out".to_string())?
}

async fn read_website(href: String) -> Result<LinkPreviewMetadata, String> {
    let mut url = Url::parse(href.trim()).map_err(|_| "Invalid website URL".to_string())?;
    validate_public_https_url(&url).await?;
    for redirect in 0..=MAX_REDIRECTS {
        let response = send_pinned_request(&url, "text/html,application/xhtml+xml").await?;
        if response.status().is_redirection() {
            if redirect == MAX_REDIRECTS {
                return Err("Too many website redirects".to_string());
            }
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "Invalid website redirect".to_string())?;
            url = url
                .join(location)
                .map_err(|_| "Invalid website redirect".to_string())?;
            validate_public_https_url(&url).await?;
            continue;
        }
        if !response.status().is_success() || !is_html_response(&response) {
            return Err("Website did not return HTML".to_string());
        }
        let bytes = read_limited_bytes(response, MAX_PREVIEW_FETCH_BYTES).await?;
        let html = String::from_utf8_lossy(&bytes);
        let mut metadata = extract_business_metadata(&html)
            .ok_or_else(|| "Website has no readable business context".to_string())?;
        for icon in business_icons(&html, &url) {
            if let Ok(Ok((data, _))) =
                tokio::time::timeout(Duration::from_secs(3), fetch_sanitized_image(icon, true))
                    .await
            {
                metadata.favicon_data_url = Some(data);
                break;
            }
        }
        return Ok(metadata);
    }
    Err("Website could not be read".to_string())
}

fn extract_business_metadata(html: &str) -> Option<LinkPreviewMetadata> {
    let mut metadata = extract_link_preview_metadata(html)?;
    metadata.description = extract_meta_content(html, "name", "description")
        .and_then(|value| normalize_metadata_description(&value))
        .or_else(|| {
            extract_meta_content(html, "property", "og:description")
                .and_then(|value| normalize_metadata_description(&value))
        })
        .or_else(|| first_paragraph(html));
    Some(metadata)
}

fn first_paragraph(html: &str) -> Option<String> {
    // Skip non-visible blocks before choosing an actual paragraph. Regex work is
    // bounded by the transport's 256 KiB cap, with no backtracking engine.
    let hidden = regex::Regex::new(
        r"(?is)<(script|style|template)\b[^>]*>.*?</(?:script|style|template)\s*>",
    )
    .ok()?;
    let visible = hidden.replace_all(html, "");
    let paragraphs = regex::Regex::new(r"(?is)<p(?:\s[^>]*)?>(.*?)</p\s*>").ok()?;
    let tags = regex::Regex::new(r"<[^>]*>").ok()?;
    let description = paragraphs.captures_iter(&visible).find_map(|capture| {
        let text = tags.replace_all(capture.get(1)?.as_str(), " ");
        normalize_metadata_description(&text)
    });
    description
}

fn business_icons(html: &str, page: &Url) -> Vec<Url> {
    let mut touch = None;
    let mut icon = None;
    let lower = html.to_ascii_lowercase();
    let mut offset = 0;
    while let Some(start) = lower[offset..].find("<link") {
        let start = offset + start;
        let Some(end) = lower[start..].find('>') else {
            break;
        };
        offset = start + end + 1;
        let tag = &html[start..offset];
        let Some(rel) = attr_value(tag, "rel") else {
            continue;
        };
        let Some(href) = attr_value(tag, "href") else {
            continue;
        };
        let Ok(url) = page.join(href.trim()) else {
            continue;
        };
        if rel
            .split_ascii_whitespace()
            .any(|token| token.eq_ignore_ascii_case("apple-touch-icon"))
        {
            touch.get_or_insert(url);
        } else if rel
            .split_ascii_whitespace()
            .any(|token| token.eq_ignore_ascii_case("icon"))
        {
            icon.get_or_insert(url);
        }
    }
    [
        touch,
        icon,
        extract_image_url(html, page),
        page.join("/favicon.ico").ok(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_business_fixture_with_meta_priority_and_touch_icon() {
        let html = include_str!("fixtures/business-website.html");
        let metadata = extract_business_metadata(html).unwrap();
        assert_eq!(metadata.title, "Colony & Company");
        assert_eq!(
            metadata.description.as_deref(),
            Some("A team for your business.")
        );
        let icons = business_icons(html, &Url::parse("https://example.com/about").unwrap());
        assert_eq!(
            icons.iter().map(Url::as_str).collect::<Vec<_>>(),
            vec![
                "https://example.com/touch.png",
                "https://example.com/icon.ico",
                "https://example.com/share.png",
                "https://example.com/favicon.ico"
            ]
        );
    }
    #[test]
    fn description_falls_back_to_og_then_first_visible_paragraph() {
        let metadata = extract_business_metadata(
            "<title>Studio</title><meta property='og:description' content='Design studio'>",
        )
        .unwrap();
        assert_eq!(metadata.description.as_deref(), Some("Design studio"));
        let metadata = extract_business_metadata("<title>Studio</title><script><p>Hidden</p></script><p> </p><p>We <b>build</b> &amp; grow.</p>").unwrap();
        assert_eq!(metadata.description.as_deref(), Some("We build & grow."));
        assert!(extract_business_metadata("<p>No title</p>").is_none());
    }
    #[tokio::test]
    async fn rejects_non_public_targets_without_a_network_fetch() {
        for href in [
            "https://127.0.0.1",
            "https://[::1]",
            "https://169.254.169.254",
            "https://10.0.0.1",
            "http://example.com",
            "https://example.com:8443",
            "https://user:pass@example.com",
        ] {
            assert!(
                read_business_website(href.to_string()).await.is_err(),
                "{href}"
            );
        }
    }
}
