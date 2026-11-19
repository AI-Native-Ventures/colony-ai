//! Cross-language relay-to-desktop hire-head wire contract.

use std::collections::BTreeMap;

use buzz_core::company_records::HireHead;
use serde::Deserialize;

use super::relay_hire_head_content_and_tags;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HireHeadFixture {
    hire_heads: BTreeMap<String, HireHeadFixtureEvent>,
}

#[derive(Deserialize)]
struct HireHeadFixtureEvent {
    tags: Vec<Vec<String>>,
    content: serde_json::Value,
}

#[test]
fn relay_hire_heads_match_the_checked_in_desktop_contract() {
    let fixture: HireHeadFixture = serde_json::from_str(include_str!(
        "../../../../../test-fixtures/company-hire/prebuilt-head-finance-events.json"
    ))
    .expect("the checked-in hire-head fixture must deserialize");

    for (state, fixture_event) in fixture.hire_heads {
        let head: HireHead = serde_json::from_value(fixture_event.content.clone())
            .unwrap_or_else(|error| panic!("{state} head must use the relay type: {error}"));
        let d_tag = fixture_event
            .tags
            .iter()
            .find(|tag| tag.first().is_some_and(|kind| kind == "d"))
            .and_then(|tag| tag.get(1))
            .unwrap_or_else(|| panic!("{state} head must include a d tag"));
        let (content, tags) = relay_hire_head_content_and_tags(&head, d_tag)
            .unwrap_or_else(|error| panic!("{state} head must build: {error:?}"));

        assert_eq!(
            tags.iter()
                .map(|tag| tag.as_slice().to_vec())
                .collect::<Vec<_>>(),
            fixture_event.tags,
            "{state} tags must stay compatible with the desktop parser"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&content)
                .unwrap_or_else(|error| panic!("{state} content must be JSON: {error}")),
            fixture_event.content,
            "{state} content must stay compatible with the desktop parser"
        );
    }
}
