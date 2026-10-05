<!-- markdownlint-disable MD013 -->
<!-- Preserve upstream reference paragraph layout. -->

# Skill mechanics

The skill-specific branch of [`writing-for-agents`](SKILL.md): what changes when the document is a skill (frontmatter, the invocation choice, and router skills). Everything else about writing it is the universal reference in `SKILL.md`.

## Invocation

Two choices, trading the two loads:

- A **model-invoked** skill keeps its description in Pi's skill list, so the agent can discover it and load its `SKILL.md` with `read`. The user can also invoke `/skill:name`. A discoverable reference skill can be shared by several skills. Omit `disable-model-invocation` (or set it to `false`) and give the description distinct trigger branches.
- A **user-invoked** skill sets `disable-model-invocation: true`: Pi omits it from the model's skill list, and the user loads it with `/skill:name`. Its description is a brief human-facing summary. This removes automatic discovery, not file access: another skill can use an explicit relative path and `read` to load a required reference.

Pick model-invocation when the agent needs semantic discovery from the skill
list. A required dependency can use an explicit path and `read` without
automatic discovery. If the skill only fires by hand, make it user-invoked.

Shared reference can live in a discoverable skill or a plain Markdown file.
Use explicit relative links for required dependencies, and resolve them against
the referring skill directory. If a referenced guide is unavailable, report the
limitation and use the stated fallback rather than assuming it was loaded.

## Splitting by invocation

The invocation cut of splitting (the sequence cut lives in `SKILL.md`): split
off a model-invoked skill when a distinct leading word should trigger discovery
on its own. A dependency link alone does not require model invocation. You pay
context load for the new always-loaded description, so independent discovery
has to be worth it.

## Router skills

When user-invoked skills multiply past what you can remember, a **router skill**
can name the others and when to reach for each. For manual-only actions, offer
their `/skill:name` commands rather than silently running them. A router may
load shared references through explicit paths; discovery and permission to
perform an action are different concerns.
