---
name: teach
description: >
  Build and run a stateful teaching workspace for a topic over multiple Pi
  sessions. Use when Dave asks to learn something, be taught a concept, build a
  course, create lessons, curate learning resources, or track learning progress.
compatibility: >
  Designed for Pi. Writes only inside a confirmed teaching workspace. Uses
  Context7 or web research tools when available for source-grounded teaching;
  falls back to Dave-provided resources or clearly marked gaps.
license: MIT (adapted from Matt Pocock's teach skill; see ATTRIBUTION.md)
metadata:
  source: "Adapted from Matt Pocock's MIT-licensed teach skill."
---

# Teach

Use this skill when Dave wants to learn a topic across one or more sessions.
The output is not just an explanation in chat. The output is a small teaching
workspace containing a mission, trusted resources, reusable reference documents,
short lessons, and learning records.

Supplemental formats are part of this skill:

- [MISSION-FORMAT.md](MISSION-FORMAT.md): mission file structure and rules.
- [RESOURCES-FORMAT.md](RESOURCES-FORMAT.md): trusted source and community list.
- [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md): canonical language for the topic.
- [LEARNING-RECORD-FORMAT.md](LEARNING-RECORD-FORMAT.md): durable learning records.
- [ATTRIBUTION.md](ATTRIBUTION.md): upstream attribution and license notice.

## Non-negotiables

- Do not treat parametric memory as a trusted source. Ground teaching in curated
  resources whenever factual accuracy matters.
- Do not create or mutate teaching files until the teaching workspace is clear.
- Do not assume the current code repository is the teaching workspace unless it
  already contains teaching-state files or Dave explicitly says to use it.
- One workspace has one mission. Separate unrelated topics need separate
  workspaces.
- Lessons should be short, beautiful, source-grounded, and useful later.
- Record learning only when there is evidence of understanding, not merely
  because material was covered.
- Prefer durable storage strength over short-term fluency.
- Use optional tools with fallback: if research, browser-opening, or structured
  question tools are unavailable, continue in normal chat and note the gap.

## Teaching workspace

A teaching workspace is a directory with learning-state files. It may be the
current directory only when that is intentional.

A workspace can contain:

- `MISSION.md`: why Dave is learning this and what success looks like. Use
  [MISSION-FORMAT.md](MISSION-FORMAT.md).
- `RESOURCES.md`: trusted sources and communities. Use
  [RESOURCES-FORMAT.md](RESOURCES-FORMAT.md).
- `GLOSSARY.md`: canonical topic language. Use
  [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md).
- `lessons/*.html`: short self-contained HTML lessons. The filename pattern is
  `0001-<dash-case-name>.html`, incrementing each time.
- `reference/*.html`: cheat sheets, algorithms, syntax cards, pose guides,
  flowcharts, or other quick-reference documents.
- `assets/*`: shared lesson components such as stylesheets, diagrams, quiz
  widgets, or simulators.
- `learning-records/*.md`: durable evidence of understanding. Use
  [LEARNING-RECORD-FORMAT.md](LEARNING-RECORD-FORMAT.md).
- `NOTES.md`: teaching preferences and working notes.

Recommended new-workspace location:

```text
~/tools/learning/<topic-slug>
```

If Dave gives a different path, use that path.

## 1. Recover or create the workspace

At the start of a teaching session:

1. Inspect the current directory for `MISSION.md`, `RESOURCES.md`, `GLOSSARY.md`,
   `lessons/`, `reference/`, `learning-records/`, or `NOTES.md`.
2. If teaching-state files exist, treat the directory as the workspace and read
   the relevant files before teaching.
3. If no teaching-state files exist, ask Dave where the workspace should live.
   Recommend `~/tools/learning/<topic-slug>` unless he already named a path.
4. Create directories lazily. Do not create `learning-records/`, `reference/`,
   or `assets/` until needed.
5. If a lesson will be written and `assets/course.css` does not exist, create a
   simple shared stylesheet and link the lesson to it.

Good setup question:

```text
What should this teaching workspace be called, and what real-world outcome are
we aiming for?
```

Use a structured-question tool such as `ask_user_question` only when choices are
clear, and fall back to normal chat when it is unavailable.

## 2. Establish the mission

Every teaching decision should trace back to `MISSION.md`.

If `MISSION.md` is missing or vague, interview Dave before writing lessons.
Push for a concrete outcome, not an abstract interest.

Good mission:

```text
Ship a small Rust CLI my team can use for log triage.
```

Weak mission:

```text
Learn Rust.
```

Write or revise `MISSION.md` using [MISSION-FORMAT.md](MISSION-FORMAT.md).
Confirm with Dave before changing an existing mission. If the mission shifts
because of learning, update `MISSION.md` and add a learning record explaining the
shift.

## 3. Curate resources before teaching facts

Use `RESOURCES.md` to keep teaching grounded.

Preferred source order:

1. Official documentation, standards, primary sources, peer-reviewed work, or
   recognized experts.
2. For libraries, frameworks, SDKs, APIs, cloud services, and CLI tools, use
   Context7 first when available.
3. For current or non-library topics, use web research tools when available.
4. If research tools are unavailable, ask Dave for trusted resources or mark a
   `## Gaps` section in `RESOURCES.md`.

Every resource entry needs a short annotation: what it covers and when to use
it. Do not keep mediocre links just to pad the list.

Lessons should cite resources with links. If a claim matters and no source is
available, say so instead of pretending certainty.

## 4. Find the zone of proximal development

Teach the next thing Dave can almost do, not the easiest thing and not the whole
field.

Before choosing a lesson topic, read:

- `MISSION.md` for the target outcome;
- `learning-records/` for demonstrated understanding;
- `GLOSSARY.md` for accepted language;
- `NOTES.md` for preferences;
- relevant `RESOURCES.md` entries.

If Dave names a specific topic, fit it to the mission and current level. If he
asks generally what to learn next, choose the lesson that gives the smallest
useful win toward the mission.

## 5. Design short lessons

A lesson is the primary teaching unit. It is a single HTML file in `lessons/`.
It should teach one tightly scoped thing and include one tangible win.

A good lesson:

- is completable quickly;
- stays within working-memory limits;
- is tied to the mission;
- cites trusted resources;
- uses the workspace glossary;
- includes retrieval practice or a small task;
- gives immediate feedback where possible;
- links to related lessons and reference documents;
- reminds Dave to ask follow-up questions.

Prefer static HTML with linked local assets. Avoid external JavaScript unless it
is clearly justified. If a quiz is included, keep answer choices similar in word
count and length so formatting does not reveal the answer.

Filename pattern:

```text
lessons/0001-<dash-case-name>.html
```

Scan existing lessons for the highest number and increment it.

Open the lesson when supported, passing paths as literal argv arguments instead
of interpolating raw paths into a shell command:

- macOS: `open -- "$lesson_path"`
- Linux: `xdg-open -- "$lesson_path"`
- Windows PowerShell: `Start-Process -LiteralPath $lessonPath`

If opening fails, report the absolute path.

## 6. Use assets by default

`assets/` holds reusable lesson components: shared stylesheets, quiz widgets,
diagram helpers, simulators, or data files.

Reuse is the default. Before writing a lesson, inspect `assets/` and link what
already exists. When a new reusable element is needed, put it in `assets/`
instead of duplicating it inline.

The first reusable asset should usually be:

```text
assets/course.css
```

This skill ships a starter stylesheet at `assets/course.css`. When accessible,
copy or adapt it into the teaching workspace instead of inventing a new visual
system from scratch.

Lessons should look like one coherent course, not unrelated one-offs.

## 7. Create reference documents

Reference documents are the compressed essence of lessons. They are designed for
quick review after the lesson is over.

Use `reference/*.html` for:

- syntax cards;
- algorithms and flowcharts;
- checklists;
- pose or exercise guides;
- command references;
- concept maps.

Use `GLOSSARY.md` for topic language, not broad exposition. Add a glossary term
only after Dave can use it correctly.

## 8. Record learning carefully

Learning records are not session logs. They capture decision-grade learning:
prior knowledge, demonstrated understanding, corrected misconceptions, and
mission changes.

Create `learning-records/0001-<slug>.md`, incrementing the number each time. Use
[LEARNING-RECORD-FORMAT.md](LEARNING-RECORD-FORMAT.md).

Write a learning record when:

- Dave demonstrates genuine understanding of a non-trivial concept;
- Dave discloses prior knowledge and its depth matters;
- a misconception is corrected;
- the mission changes because of learning.

Do not write a learning record for material merely covered in a lesson.

## 9. Handle knowledge, skills, and wisdom differently

Use this teaching model:

- **Knowledge**: source-grounded explanations that reduce difficulty while Dave
  is acquiring the concept.
- **Skills**: practice, retrieval, interleaving, and feedback loops that add
  desirable difficulty and build storage strength.
- **Wisdom**: real-world feedback from practitioners, communities, classes, or
  work contexts.

When Dave asks a question that needs wisdom, answer what you can, then help find
a high-signal community or practitioner feedback path. Respect it if Dave does
not want community suggestions; record that preference in `RESOURCES.md` or
`NOTES.md`.

## 10. Keep notes

Use `NOTES.md` for teaching preferences and working notes, for example:

- preferred lesson length;
- preferred examples;
- topics Dave dislikes;
- accessibility or printing preferences;
- community preferences;
- schedule or spacing constraints.

Do not hide important learning evidence in `NOTES.md`. Promote it to a learning
record when it meets the bar.

## 11. Close each session clearly

At the end of a teaching session, report:

- workspace path;
- lesson or reference files created or updated;
- resources added;
- learning records written;
- suggested next lesson;
- any resource gaps.

If no files were written, say why.
