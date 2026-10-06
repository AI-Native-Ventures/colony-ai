# OpenClaw behavior reference

P2 inspected these MIT-licensed files at commit
67fd7e910b89bac2d2e238ec700c7bc263b1afb1:

- https://github.com/openclaw/openclaw/blob/67fd7e910b89bac2d2e238ec700c7bc263b1afb1/extensions/openai/token-sharing.ts
- https://github.com/openclaw/openclaw/blob/67fd7e910b89bac2d2e238ec700c7bc263b1afb1/extensions/codex/src/app-server/inference-proxy.ts

They establish that OpenClaw uses a local placeholder credential, resolves the
real OAuth grant in its host relay, and adds a temporary preview header on
initial requests and refresh retries. Colony's implementation is independently
written from public protocol documentation. No source was copied or translated.
This notice credits the behavioral reference and retains its MIT notice.

MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
