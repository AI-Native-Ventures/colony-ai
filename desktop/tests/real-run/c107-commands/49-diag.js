const tabs = await S.page.evaluate(() => window.colonyBrowserHost?.listTabs?.() ?? []);
const overlay = await S.page.getByTestId("work-area-panel").getByText("This page could not be opened").isVisible().catch(() => false);
return { overlay, tabs: tabs.map(t => ({ url: t.url, error: t.error, loading: t.loading, title: t.title })) };
