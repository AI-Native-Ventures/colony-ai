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
