# Candidate 1.0.6 resumed gate

This harness targets the supplied CI package, without changing product code. It requires local opt-in and explicit `AI_APP`, `AI_OUT`, `AI_STATE`, and `AI_PROGRESS`. Evidence lives outside Git. `AI_STATE` contains smoke passwords and invite codes and must stay private.

Full app launches use `ai-lib.mjs`: throwaway HOME, migration exactly 0, keychain and owner-data denial, and a synthetic denied-read probe inside the same sandbox before exec. Electron still reports the OS home as `/Users/mac`. Do not start downloads or write through Electron home/download paths.

`c106-session.mjs` starts and checks the FAKE provider before launching and keeps it alive until the session exits. It accepts a JSON-encoded JavaScript command or `FILE <trusted local script path>` on stdin. Scope exposes the guarded application, its main page, recorder, FAKE server, private state and shared helpers. `EXIT` writes evidence and closes the app and provider. Use `RESUME_PROFILE=A` for the recovered second account, `C` for the explicitly authorized clean first run; `RESUME_PHASE` names evidence. `RESUME_AGENT=1` sets only the browser-agent gate. Normal recovered provider port is 62448.

`RESUME_NEW=1` was used once with explicit coordinator authorization. That third business allowance is spent. Do not use it again. The session refuses a fresh run when state.C already records a business. Clean first-run connection was made through the actual Check key and Connect controls, with no skip or retry.

Scout measurements must target a fresh question's actual `message-thread-summary-surface` and `message-thread-panel`, and verify Scout authorship inside that thread. A thread summary is a sibling of its message row. When inspecting an existing CDP session with native browser tabs, select the page containing the app sidebar, not the first browser page.

Canvas save closes the editor before the refetch completes. `work-knowledge-page.mjs` polls actual saved text for 15 seconds. WK13 cannot claim absence from a Loading state: `work-knowledge-rows.mjs` now blocks that result and the focused regression test binds the actual row runner. Final runtime WK13 was re-read from a loaded empty Pinned section.

Visible-browser removal was observed only after producing and privately saving a usable invite. To reach the actual connection escape, the throwaway device's saved relay URL was temporarily replaced with closed loopback. The actual remove and confirmation controls cleared the device community. The same old browser business ID was probed empty before rejoining by invite; the new local community ID alone is not proof of profile deletion. This is synthetic connection-failure evidence, not production membership revocation.

Agent-browser prepared rows are imported from local worker commit f2e7e8e0c, branch feat/agent-browser-downloads. Default-off evidence includes a genuine FAKE model request with no browser tools, disabled broker and absent controls. Flag-on runtime exposed the context defect: WorkAreaLayout reconstructs channel context without threadRootId, disabling Allow agent even with a thread open. No product fix or arbitrary broker grant was made. Production denies private origins, and no packaged fixture grant seam is available, so downstream control rows are NOT OBSERVED.

`c106-native-migration.mjs` is an optional native-only driver. It launches the candidate's bundled colony-native-host, not Electron, on marked synthetic fixture HOMEs with the migration flag omitted. Its sandbox probe uses canonical private paths and refuses exec if denial is absent. It blocks outbound HTTP/HTTPS and captures bounded native output. Owner, held-back, crash and stale fixtures reuse the existing production migration checks. Full-app migration UI and restored agents remain NOT OBSERVED. An initial noncanonical probe refused launch before exec; the successful rerun supersedes its comparison failures.

`c106-naming.mjs` scans recorded actual view text and visible accessibility/title attributes. `c106-report.mjs` renders the final observed gate separately from interrupted historical attempts. Expected Buzz menu/title packaging and model-only internal identifiers are reported exceptions. The report lists all three smoke accounts and businesses without passwords or invite codes.

Run focused safety, browser-row, Work/Knowledge-row, agent-browser-preparation and migration-proof tests through heavy.sh. Do not build the package. No real model, browser login, keychain access, VoiceOver or live Codex round trip is part of this run.
