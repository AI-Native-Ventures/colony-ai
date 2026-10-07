# ChatGPT plan clean-room implementation

This implementation uses OpenAI's public protocol documentation, read on
6 October 2026:

- https://developers.openai.com/siwc/token-sharing-open-source
- Its sign-in, token-reference, profiles-and-sessions, errors-and-recovery,
  models-and-inference, preview-limitations and codex-app-server subpages
- https://developers.openai.com/siwc/ui-ux-guidelines
- https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
- https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites

The owner supplied two design pages and their correction. Their protocol
summaries were checked against the public docs. Implementation also follows
Colony's existing Electron IPC and OpenRouter OAuth conventions.

No file from openai/sign-in-with-chatgpt-devkit, @siwc/local, @siwc/react or the
Paste Perfect example was fetched or opened. No devkit code, package, font,
button artwork or asset is used. Links and example code in the requested public
cookbook were not followed or reused. No OpenClaw source has been used in P1.

P1 has no button or other visual asset. P3 will build plain React and CSS in
Colony's style and use the documented Continue with ChatGPT wording.

All operation is behind COLONY_CHATGPT_PLAN=1 with a build default of false.
The owner controls enablement after OpenAI responds and the owner agrees.

Credentials use a 0600 file inside a 0700 app-data folder on Unix. This avoids
Keychain and Electron safeStorage entirely, including automated runs. The file
is not encrypted at rest: another process acting as the same OS user can read
it. Windows inherits the private user-profile ACL and uses bounded icacls.exe
inspection to reject broad grants before credential reads or writes, since Unix
mode bits do not establish a Windows security boundary. The ACL inspection was
written from Microsoft's icacls, ACE Strings and SID Strings documentation.
Neither production nor tests use PowerShell for this inspection. Packaged ACL proof
belongs to the later platform harness and is not claimed by P1.

Windows ACL protocol references:

- https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls
- https://learn.microsoft.com/en-us/windows/win32/secauthz/ace-strings
- https://learn.microsoft.com/en-us/windows/win32/secauthz/sid-strings

P2's relay and launch configuration were written from the public protocol and
Codex configuration reference. The permitted MIT OpenClaw files were read for
behavior at commit 67fd7e910b89bac2d2e238ec700c7bc263b1afb1:
extensions/openai/token-sharing.ts and
extensions/codex/src/app-server/inference-proxy.ts. No source was copied or
translated. The preview compatibility header is a fact from that reference,
not a requirement established by OpenAI's public docs. Its value and omission
setting live in one policy module. Reference attribution and the MIT notice are
recorded in docs/third-party-notices/openclaw-chatgpt-reference.md.

The Apache-2.0 codex-acp README, package metadata and startup/initialization
sources were inspected at ca1d97173ad37b471d5a4e5847725a4657d34e29 to establish
the CODEX_CONFIG, MODEL_PROVIDER, CODEX_HOME and clientInfo seams. No adapter
source was copied or translated. Bundling and actual adapter execution have
separate proof gates. P2 adds no artwork, fonts or visible control.
