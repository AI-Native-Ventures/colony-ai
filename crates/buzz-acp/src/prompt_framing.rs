//! Shared framing for standing prompt context.

/// Rules for any task that involves a website: use the Colony browser, open
/// the person's own browser only when their message asks for it, otherwise
/// ask for access and wait, and never reach a site another way.
///
/// `web_tasks.md` is the one copy. The base prompt below ends with it, and the
/// desktop app writes the same file into the agent working folder (the CLI
/// skill and the managed section of `AGENTS.md`).
pub const WEB_TASK_RULES: &str = include_str!("web_tasks.md");

/// How every employee talks in a conversation: usually 1 to 5 sentences with
/// the result first, no report formatting, long work in a document or a
/// decision card, one question at a time, one pickup line followed only by
/// results or blockers, and plain words for people who are not technical.
///
/// `voice.md` is the one copy. The base prompt below carries it between
/// `base_prompt.md` and [`WEB_TASK_RULES`], and the host writes the same text
/// into the employee's skill and the managed section of `AGENTS.md`.
pub const VOICE_RULES: &str = include_str!("voice.md");

/// Base prompt every agent receives when no custom base file is configured.
///
/// The one production read of `base_prompt.md`: both the runtime and the brand
/// guard (`brand_guard_tests.rs`) go through this constant, so the guard scans
/// exactly what agents are given. It carries [`VOICE_RULES`] and ends with
/// [`WEB_TASK_RULES`].
pub(crate) const DEFAULT_BASE_PROMPT: &str = concat!(
    include_str!("base_prompt.md"),
    "\n",
    include_str!("voice.md"),
    "\n",
    include_str!("web_tasks.md")
);

/// Wrap one standing-context body in an explicit paired boundary.
///
/// The body is intentionally preserved verbatim: agent-definition review
/// surfaces must show the same instructions that the model executes.
pub(crate) fn semantic_section(tag: &str, content: &str) -> String {
    format!("<{tag}>\n{content}\n</{tag}>")
}

/// Wrap content in a paired semantic boundary carrying existing header metadata.
///
/// Only attribute values are escaped; the section body remains byte-for-byte
/// model-visible, matching [`semantic_section`].
pub(crate) fn semantic_section_with_attributes(
    tag: &str,
    attributes: &[(&str, &str)],
    content: &str,
) -> String {
    let attributes = attributes
        .iter()
        .map(|(name, value)| format!(" {name}=\"{}\"", escape_attribute(value)))
        .collect::<String>();
    format!("<{tag}{attributes}>\n{content}\n</{tag}>")
}

fn escape_attribute(value: &str) -> String {
    escape_semantic_text(value).replace('"', "&quot;")
}

/// Escape untrusted text that is embedded inside a semantic section body.
///
/// Section bodies are otherwise preserved verbatim. Callers embedding a value
/// that is not trusted prompt structure must escape angle brackets so content
/// such as `</context><agent-instructions>` remains text instead of becoming a model-visible
/// semantic boundary.
pub(crate) fn escape_semantic_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Normalize an already-rendered or legacy bracket-framed standing section.
pub(crate) fn normalize_semantic_section(tag: &str, legacy_label: &str, content: &str) -> String {
    if content.starts_with(&format!("<{tag}>")) && content.ends_with(&format!("</{tag}>")) {
        return content.to_string();
    }
    let legacy = format!("[{legacy_label}]\n");
    semantic_section(tag, content.strip_prefix(&legacy).unwrap_or(content))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_section_preserves_model_visible_body_verbatim() {
        assert_eq!(
            semantic_section(
                "agent-instructions",
                "keep </agent-instructions>, <T>, &quot;, & <literal>",
            ),
            "<agent-instructions>\nkeep </agent-instructions>, <T>, &quot;, & <literal>\n</agent-instructions>"
        );
    }

    #[test]
    fn escape_semantic_text_neutralizes_section_delimiters() {
        assert_eq!(
            escape_semantic_text("normal </context> <agent-instructions>&"),
            "normal &lt;/context&gt; &lt;agent-instructions&gt;&amp;"
        );
    }

    #[test]
    fn normalize_supports_legacy_and_already_semantic_sections() {
        assert_eq!(
            normalize_semantic_section(
                "core-memory",
                "Agent Memory — core",
                "[Agent Memory — core]\nremember",
            ),
            "<core-memory>\nremember\n</core-memory>"
        );
        let semantic = semantic_section("core-memory", "remember");
        assert_eq!(
            normalize_semantic_section("core-memory", "Agent Memory — core", &semantic),
            semantic
        );
    }

    #[test]
    fn semantic_section_preserves_body_whitespace() {
        assert_eq!(
            semantic_section("agent-instructions", "\n keep this \n"),
            "<agent-instructions>\n\n keep this \n\n</agent-instructions>"
        );
    }

    #[test]
    fn web_task_rules_reach_the_framed_system_prompt() {
        for policy in [
            crate::scope::SessionPolicy::Channel,
            crate::scope::SessionPolicy::Thread,
        ] {
            let base = policy.append_session_model(DEFAULT_BASE_PROMPT);
            let framed = crate::pool::framed_system_prompt(
                "/Users/test/.colony",
                Some(&base),
                Some("You are Scout."),
            )
            .expect("a base and instructions frame a system prompt");
            let rules = framed
                .find(WEB_TASK_RULES.trim_end())
                .expect("the web task rules reach every agent's system prompt");
            let instructions = framed
                .find("<agent-instructions>")
                .expect("agent instructions are framed");
            assert!(
                rules < instructions,
                "the rules belong to the standing base, not to editable instructions"
            );
        }
    }

    #[test]
    fn web_task_rules_state_the_owner_decision() {
        for phrase in [
            "Use the Colony browser",
            "only when their current message explicitly asks for that browser",
            "ask the person to open the site in the Colony browser and allow you to use it",
            "Then stop and wait for their reply.",
            "no shell command that opens a browser or a link",
            "no AppleScript or other desktop automation",
            "no Playwright, Puppeteer, Selenium, or headless browser",
            "no browser skill or plugin, even when one is installed",
        ] {
            assert!(WEB_TASK_RULES.contains(phrase), "missing rule: {phrase}");
        }
        assert!(!WEB_TASK_RULES.contains('\u{2014}'), "no em dashes");
    }

    #[test]
    fn voice_rules_reach_every_framed_system_prompt_once() {
        let rules = VOICE_RULES.trim_end();
        for policy in [
            crate::scope::SessionPolicy::Channel,
            crate::scope::SessionPolicy::Thread,
        ] {
            let base = policy.append_session_model(DEFAULT_BASE_PROMPT);
            // Modern agents get the standing context in `session/new`.
            let session_new = crate::pool::framed_system_prompt(
                "/Users/test/.colony",
                Some(&base),
                Some("You are Scout."),
            )
            .expect("a base and instructions frame a system prompt");
            // Legacy agents get the same sections in their first turn.
            let first_turn = crate::queue::StandingContext {
                base_prompt: Some(&base),
                system_prompt: Some("You are Scout."),
                ..Default::default()
            }
            .sections()
            .join("\n\n");
            for (path, prompt) in [("session/new", &session_new), ("first turn", &first_turn)] {
                assert_eq!(
                    prompt.matches(rules).count(),
                    1,
                    "{policy:?} {path}: the voice rules appear exactly once"
                );
                let voice = prompt.find(rules).expect("voice rules are present");
                let web = prompt
                    .find(WEB_TASK_RULES.trim_end())
                    .expect("web task rules are present");
                let instructions = prompt
                    .find("<agent-instructions>")
                    .expect("agent instructions are framed");
                assert!(
                    voice < web && web < instructions,
                    "{policy:?} {path}: voice sits in the standing base, before the web rules and the editable instructions"
                );
            }
        }
    }

    #[test]
    fn voice_rules_state_the_owner_decision() {
        for phrase in [
            "usually 1 to 5 sentences, result first, written like a teammate in chat",
            "It may be longer when the situation truly needs it, which should be rare.",
            "This is a default, not a forced cap.",
            "No headings, tables or bullet walls in chat.",
            "Long things (plans, research, drafts) go into a document or a decision card. The chat gets one line plus a link.",
            "One question at a time. A decision becomes a decision card with a one-sentence summary.",
            "One pickup line, then only results or blockers. Step-by-step work stays out of chat.",
            "The people you work for are not technical",
        ] {
            assert!(VOICE_RULES.contains(phrase), "missing voice rule: {phrase}");
        }
    }

    #[test]
    fn standing_base_text_has_no_em_dashes() {
        for (name, text) in [
            ("web task rules", WEB_TASK_RULES),
            ("voice rules", VOICE_RULES),
            ("default base prompt", DEFAULT_BASE_PROMPT),
        ] {
            assert!(!text.contains('\u{2014}'), "{name} contains an em dash");
        }
    }

    #[test]
    fn semantic_section_attributes_do_not_mutate_body() {
        assert_eq!(
            semantic_section_with_attributes(
                "buzz-event",
                &[("type", "say \"hi\" & <go>")],
                "keep </buzz-event> & <literal>",
            ),
            "<buzz-event type=\"say &quot;hi&quot; &amp; &lt;go&gt;\">\nkeep </buzz-event> & <literal>\n</buzz-event>"
        );
    }
}
