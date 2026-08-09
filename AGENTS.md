# pi-skills repo guidance

This repository packages local Pi skills.

## Workflow

- Use Seeds as the canonical work state for governed changes.
- Keep the submitted Seeds plan and child issues in sync with implementation status.
- Work on a feature branch for repository mutations when practical.
- Validate skill frontmatter, package JSON, and local links before closing work.

## Skill authoring

- Each skill lives in a directory containing `SKILL.md`.
- Required frontmatter: `name` and `description`.
- Keep skill names lowercase with hyphens.
- Prefer self-contained guidance.
- Do not leave links to source repositories unless the linked content is intentionally external documentation.
- If a skill mentions optional tools, include fallback behavior for sessions where the tool is unavailable.
- Avoid executable helpers unless the skill clearly needs them.

## Current package

- Package manifest: `package.json`
- Skill root: `skills/`
- Skills:
  - `skills/engineering/codex-pr-comment/SKILL.md`
  - `skills/engineering/opsec-framework-doc/SKILL.md`
  - `skills/engineering/post-merge/SKILL.md`
  - `skills/engineering/seeds-architecture-review/SKILL.md`
  - `skills/engineering/seeds-issue-audit/SKILL.md`
  - `skills/engineering/thermo-nuclear-code-quality-review/SKILL.md`
  - `skills/productivity/teach/SKILL.md`
  - `skills/writing/humanizer/SKILL.md`
