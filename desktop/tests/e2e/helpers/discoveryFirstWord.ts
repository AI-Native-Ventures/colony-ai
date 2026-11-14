import type { Page } from "@playwright/test";

type SearchStubWindow = Window & {
  __BUZZ_E2E_DISCOVERY_SEARCH__?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  __discoveryOtherWordCalls?: Array<Record<string, unknown>>;
};

/**
 * A campaign searches Maps with several plain words for its business type,
 * one after another (see `discoveryCampaignWords.ts`). The specs that stub
 * the relay's search are about paging, saving and resuming, so their Maps
 * lists businesses for the first word only and nothing for the type's other
 * words. Those other requests are kept in `__discoveryOtherWordCalls`.
 *
 * Call it after the spec has installed its own search stub. The default word
 * is the first search word of "Home furnishings retailers", the type the
 * specs reach by searching industries for "home decor".
 */
export async function answerFirstSearchWordOnly(
  page: Page,
  firstWord: RegExp = /home furnishings/i,
): Promise<void> {
  await page.addInitScript(
    ({ source, flags }) => {
      const w = window as SearchStubWindow;
      const stub = w.__BUZZ_E2E_DISCOVERY_SEARCH__;
      if (!stub) return;
      const first = new RegExp(source, flags);
      w.__discoveryOtherWordCalls = [];
      w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
        if (first.test(String(request.query ?? ""))) return stub(request);
        w.__discoveryOtherWordCalls?.push(request);
        return {
          provider: "outscraper",
          places: [],
          estimatedCostUsd: 0,
          nextSkip: null,
        };
      };
    },
    { source: firstWord.source, flags: firstWord.flags },
  );
}

/** The requests the stubbed Maps answered with nothing: the type's other words. */
export async function otherSearchWordCalls(
  page: Page,
): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () => (window as SearchStubWindow).__discoveryOtherWordCalls ?? [],
  );
}
