# Third-party notices

Novel Studio desktop packages may include these fixed local runtimes:

- `@agentclientprotocol/codex-acp` 1.6.2, Copyright 2025 JetBrains s.r.o., Apache License 2.0.
- `@openai/codex` CLI 0.159.2 and its matching platform package (independent updates may select a newer official version), Apache License 2.0.
- `tar` 7.5.22, ISC license, used to extract independently updated Codex component packages. Its license is included with the packaged dependency.
- `@anthropic-ai/claude-agent-sdk` 0.3.310, Copyright Anthropic. Governed by the license and README shipped in that dependency. Used for the Claude Code executor; the user's external official Claude Code CLI manages authentication. Novel Studio does not redistribute or modify the user's CLI installation.

The complete `codex-acp` license is copied beside the packaged adapter. Source and license metadata remain available from the corresponding npm packages and upstream repositories.

## Reader public Fanqie glyph mapping

The glyph order in `reader-service/fanqie-public-source.json` is adapted from
`xjz6626/fanqie-tui/internal/fanqie/decode.go`, originally documented by the
fanqienovel-decryptor project. Upstream: https://github.com/xjz6626/fanqie-tui.
No Go binary, Java runtime, or upstream executable code is bundled.

MIT License

Copyright (c) 2026 fanqie-tui contributors

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
