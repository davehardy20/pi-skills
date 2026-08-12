# Attribution

This Pi skill is adapted from Matt Pocock's `code-review` skill in
[Skills For Real Engineers](https://github.com/mattpocock/skills).

Local source used for the adaptation:
`/Users/dave/tools/matt_pocock_skills/skills/skills/engineering/code-review/SKILL.md`
at commit `d044e8441ec5676f48ceda6f2c557e864b01e41c`.

Upstream license notice:

```text
MIT License

Copyright (c) 2026 Matt Pocock

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
```

The local version adapts the source by:

- replacing the generic specification axis with Seeds-backed Intent review;
- treating Seeds as strictly read-only evidence and prohibiting review
  write-back;
- returning findings directly to the parent agent for remediation;
- scoping child reviews to the active child rather than every planned task;
- reviewing worktree and untracked changes in addition to committed changes;
- detecting the default branch instead of assuming a fixed branch name;
- using structured actionable findings and Pi orchestration conventions.
