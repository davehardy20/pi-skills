# Attribution

This Pi skill is adapted from Jaymin West's `seeds-issue-audit` skill in the
Warren project, at `.agents/skills/seeds-issue-audit/SKILL.md`.

Upstream source:
<https://github.com/jayminwest/warren/blob/main/.agents/skills/seeds-issue-audit/SKILL.md>

Upstream license notice:

```text
MIT License

Copyright (c) 2026 Jaymin West

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

- using Pi's safe Seeds, Git, and GitHub wrappers rather than raw commands;
- making report-only auditing the default and requiring explicit authorization
  before issue closure;
- treating plan outcomes and GitHub completion evidence more conservatively;
- enforcing PR-first closeout for `.seeds/` changes;
- replacing upstream task fan-out with read-only `orchestrate` workers.
