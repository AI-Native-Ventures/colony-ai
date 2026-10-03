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
    validate_metadata_url(&url).await?;
    for redirect in 0..=MAX_REDIRECTS {
        let response = send_metadata_request(&url, "text/html,application/xhtml+xml").await?;
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
            validate_metadata_url(&url).await?;
            continue;
        }
        if !response.status().is_success() || !is_html_response(&response) {
            return Err("Website did not return HTML".to_string());
        }
        let bytes = read_bytes_prefix(response, MAX_PREVIEW_FETCH_BYTES).await?;
        let html = String::from_utf8_lossy(&bytes);
        let mut metadata = extract_business_metadata(&html)
            .ok_or_else(|| "Website has no readable business context".to_string())?;
        for icon in business_icons(&html, &url) {
            if let Ok(Ok((data, _))) = tokio::time::timeout(
                Duration::from_secs(3),
                fetch_sanitized_image_using(
                    icon,
                    true,
                    true,
                    |url| async move { validate_metadata_url(&url).await },
                    |url, accept| async move { send_metadata_request(&url, accept).await },
                ),
            )
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
    let mut candidates = Vec::new();
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
        let touch = rel
            .split_ascii_whitespace()
            .any(|t| t.eq_ignore_ascii_case("apple-touch-icon"));
        let icon = rel
            .split_ascii_whitespace()
            .any(|t| t.eq_ignore_ascii_case("icon"));
        if !touch && !icon {
            continue;
        }
        let svg = attr_value(tag, "type").is_some_and(|t| t.eq_ignore_ascii_case("image/svg+xml"))
            || url.path().to_ascii_lowercase().ends_with(".svg");
        let size = attr_value(tag, "sizes")
            .unwrap_or_default()
            .split_ascii_whitespace()
            .filter_map(|s| {
                let (w, h) = s.split_once('x')?;
                Some(
                    w.parse::<u32>()
                        .ok()?
                        .saturating_mul(h.parse::<u32>().ok()?),
                )
            })
            .max()
            .unwrap_or(0);
        candidates.push((
            if touch {
                0
            } else if svg {
                2
            } else {
                1
            },
            std::cmp::Reverse(size),
            url,
        ));
    }
    if let Ok(url) = page.join("/favicon.ico") {
        candidates.push((3, std::cmp::Reverse(0), url));
    }
    candidates.sort_by_key(|(kind, size, _)| (*kind, *size));
    let mut icons = Vec::new();
    for (_, _, url) in candidates {
        if !icons.contains(&url) {
            icons.push(url);
        }
        if icons.len() == 4 {
            break;
        }
    }
    icons
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
    async fn fixture_server() -> std::net::SocketAddr {
        use axum::{body::Body, http::Response, routing::get, Router};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new().route("/{path}", get(|axum::extract::Path(path): axum::extract::Path<String>| async move {
            match path.as_str() {
                "private" => Response::builder().status(302).header("location", "https://169.254.169.254/metadata").body(Body::empty()).unwrap(),
                "one" | "two" | "three" | "four" => {
                    let next = match path.as_str() { "one" => "two", "two" => "three", "three" => "four", _ => "ok" };
                    Response::builder().status(302).header("location", format!("https://fixture.example/{next}")).body(Body::empty()).unwrap()
                }
                "large" => Response::builder().header("content-type", "text/html").body(Body::from(format!("<title>Large home page</title><meta name='description' content='Head remains readable'>{}", "x".repeat(MAX_PREVIEW_FETCH_BYTES*2)))).unwrap(),
                "plain" => Response::builder().header("content-type", "text/plain").body(Body::from("<title>Not HTML</title>")).unwrap(),
                "favicon.ico" => Response::builder().status(404).body(Body::empty()).unwrap(),
                _ => Response::builder().header("content-type", "text/html").body(Body::from("<title>Studio</title><meta name='description' content='A business'>")).unwrap(),
            }
        }));
        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        address
    }

    #[tokio::test]
    async fn command_guards_bind_production_validation_with_exact_failures() {
        let address = fixture_server().await;
        for (href, expected) in [
            (
                "https://127.0.0.1/ok",
                "link preview host resolved to a private or reserved address",
            ),
            (
                "https://[::1]/ok",
                "link preview host resolved to a private or reserved address",
            ),
            (
                "https://169.254.169.254/ok",
                "link preview host resolved to a private or reserved address",
            ),
            (
                "https://10.0.0.1/ok",
                "link preview host resolved to a private or reserved address",
            ),
            (
                "http://fixture.example/ok",
                "link previews require an HTTPS URL without credentials",
            ),
            (
                "https://fixture.example:8443/ok",
                "link previews require the default HTTPS port",
            ),
            (
                "https://user:pass@fixture.example/ok",
                "link previews require an HTTPS URL without credentials",
            ),
            (
                "https://fixture.example/private",
                "link preview host resolved to a private or reserved address",
            ),
            ("https://fixture.example/one", "Too many website redirects"),
            (
                "https://fixture.example/plain",
                "Website did not return HTML",
            ),
        ] {
            let result = METADATA_TEST_SERVER
                .scope(address, read_business_website(href.to_string()))
                .await;
            assert_eq!(result, Err(expected.to_string()), "{href}");
        }
        let result = METADATA_TEST_SERVER
            .scope(
                address,
                read_business_website("https://fixture.example/large".to_string()),
            )
            .await
            .unwrap();
        assert_eq!(result.title, "Large home page");
        assert_eq!(result.description.as_deref(), Some("Head remains readable"));
    }

    #[tokio::test]
    async fn command_rejects_private_dns_results_before_any_fetch() {
        assert_eq!(
            read_business_website("https://localhost/ok".to_string()).await,
            Err("link preview host resolved to a private or reserved address".to_string())
        );
    }

    #[test]
    fn icons_use_all_candidates_in_size_order_without_social_hero_images() {
        let page = Url::parse("https://fixture.example/about").unwrap();
        let icons = business_icons("<meta property='og:image' content='/hero.png'><link rel='icon' href='/small.png' sizes='16x16'><link rel='icon' href='/large.png' sizes='256x256'><link rel='icon' href='/vector.svg' type='image/svg+xml'>", &page);
        assert_eq!(
            icons.iter().map(Url::as_str).collect::<Vec<_>>(),
            vec![
                "https://fixture.example/large.png",
                "https://fixture.example/small.png",
                "https://fixture.example/vector.svg",
                "https://fixture.example/favicon.ico"
            ]
        );
        assert_eq!(
            business_icons("<meta property='og:image' content='/hero.png'>", &page),
            vec![page.join("/favicon.ico").unwrap()]
        );
        assert_eq!(business_icons("<link rel='icon' href='/a.png'><link rel='icon' href='/b.png'><link rel='icon' href='/c.png'><link rel='icon' href='/d.png'><link rel='icon' href='/e.png'>", &page).len(), 4);
    }

    #[tokio::test]
    async fn native_command_consumes_early_hints_before_final_html() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            socket.read(&mut request).await.unwrap();
            let body = "<title>Final response</title><meta name='description' content='After early hints'>";
            socket.write_all(format!("HTTP/1.1 103 Early Hints\r\nLink: </style.css>; rel=preload\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        });
        let result = METADATA_TEST_SERVER
            .scope(
                address,
                read_business_website("https://early-hints.example/page".to_string()),
            )
            .await
            .unwrap();
        assert_eq!(result.description.as_deref(), Some("After early hints"));
    }
}

#[cfg(test)]
#[tokio::test]
async fn launch_websites_return_descriptions_through_the_real_native_command() {
    // Explicit launch acceptance gate requested by the owner. These are public,
    // credential-free sites; native execution runs in CI, never on the owner's Mac.
    for href in ["https://colony.ainative.ventures/", "https://colony.global"] {
        let result = read_business_website(href.to_string())
            .await
            .unwrap_or_else(|error| panic!("native website acceptance failed for {href}: {error}"));
        assert!(
            result
                .description
                .as_deref()
                .is_some_and(|text| !text.is_empty()),
            "{href}"
        );
        assert!(result
            .favicon_data_url
            .as_ref()
            .is_none_or(|data| data.len() <= 100 * 1024));
    }
}
