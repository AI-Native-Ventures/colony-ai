//! Strict passive SVG subset. No scripts, styles, external references or entities.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use quick_xml::{events::Event, Reader};

pub(super) fn sanitize_svg(bytes: &[u8]) -> Result<String, String> {
    let rejected = || "Website icon uses unsupported SVG content".to_string();
    if bytes.len() > 64 * 1024 {
        return Err(rejected());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| rejected())?;
    let mut reader = Reader::from_str(text);
    let local_url = regex::Regex::new(r"^url\(#[A-Za-z0-9_-]+\)$").map_err(|_| rejected())?;
    let mut depth = 0usize;
    let mut roots = 0usize;
    let mut events = 0usize;
    loop {
        let event = reader.read_event().map_err(|_| rejected())?;
        events += 1;
        if events > 10_000 {
            return Err(rejected());
        }
        match event {
            Event::Start(ref tag) | Event::Empty(ref tag) => {
                let empty = matches!(event, Event::Empty(_));
                let name = tag.name();
                let name = std::str::from_utf8(name.as_ref()).map_err(|_| rejected())?;
                if depth == 0 {
                    roots += 1;
                    if name != "svg" || roots != 1 {
                        return Err(rejected());
                    }
                }
                if !matches!(
                    name,
                    "svg"
                        | "g"
                        | "defs"
                        | "path"
                        | "rect"
                        | "circle"
                        | "ellipse"
                        | "line"
                        | "polyline"
                        | "polygon"
                        | "linearGradient"
                        | "radialGradient"
                        | "stop"
                        | "mask"
                        | "clipPath"
                ) {
                    return Err(rejected());
                }
                for attribute in tag.attributes() {
                    let attribute = attribute.map_err(|_| rejected())?;
                    let key =
                        std::str::from_utf8(attribute.key.as_ref()).map_err(|_| rejected())?;
                    if !matches!(
                        key,
                        "xmlns"
                            | "viewBox"
                            | "width"
                            | "height"
                            | "x"
                            | "y"
                            | "x1"
                            | "x2"
                            | "y1"
                            | "y2"
                            | "cx"
                            | "cy"
                            | "r"
                            | "rx"
                            | "ry"
                            | "d"
                            | "points"
                            | "fill"
                            | "stroke"
                            | "stroke-width"
                            | "stroke-linecap"
                            | "stroke-linejoin"
                            | "fill-rule"
                            | "clip-rule"
                            | "opacity"
                            | "fill-opacity"
                            | "stroke-opacity"
                            | "transform"
                            | "id"
                            | "offset"
                            | "stop-color"
                            | "stop-opacity"
                            | "gradientUnits"
                            | "gradientTransform"
                            | "mask"
                            | "maskUnits"
                            | "clip-path"
                            | "clipPathUnits"
                    ) {
                        return Err(rejected());
                    }
                    let value = attribute
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| rejected())?;
                    if key == "xmlns" && value != "http://www.w3.org/2000/svg" {
                        return Err(rejected());
                    }
                    let lower = value.to_ascii_lowercase();
                    if lower.contains("url") && !local_url.is_match(&value) {
                        return Err(rejected());
                    }
                    if value.contains(['<', '>', '\\']) || (key != "xmlns" && value.contains(':')) {
                        return Err(rejected());
                    }
                }
                if !empty {
                    depth += 1;
                }
                if depth > 128 {
                    return Err(rejected());
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1).ok_or_else(rejected)?;
            }
            Event::Text(text) => {
                if !text.decode().map_err(|_| rejected())?.trim().is_empty() {
                    return Err(rejected());
                }
            }
            Event::Comment(_) | Event::Decl(_) => {}
            Event::Eof => break,
            _ => return Err(rejected()),
        }
    }
    if roots != 1 || depth != 0 {
        return Err(rejected());
    }
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permits_passive_shapes_and_local_masks() {
        assert!(sanitize_svg(br##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><mask id="eye"><circle r="11" fill="#000"/></mask></defs><g mask="url(#eye)"><path d="M0 0 L2 2" fill="hsl(258 90% 66%)"/></g></svg>"##).is_ok());
    }
    #[test]
    fn rejects_active_content_external_fetches_entities_and_malformed_xml() {
        for text in [
            "<svg><script/></svg>",
            "<svg onload='alert(1)'/>",
            "<svg><image href='https://127.0.0.1/'/></svg>",
            "<svg><path fill='url(https://example.com)'/></svg>",
            "<!DOCTYPE svg [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><svg/>",
            "<svg><g></svg>",
            "<svg/><svg/>",
            "<svg><foreignObject/></svg>",
            "<svg><style/></svg>",
        ] {
            assert!(sanitize_svg(text.as_bytes()).is_err(), "{text}");
        }
    }
}
