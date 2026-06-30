---
name: humanizer
description: |
  Remove signs of AI-generated writing from text and make it sound natural and
  human-written. Use when editing text for AI tells such as promotional language,
  vague attribution, em dash overuse, rule-of-three, AI vocabulary, or chatbot tone.
compatibility: Designed for Pi. No external dependencies.
metadata:
  source-version: "2.1.1"
---

# Humanizer: Remove AI Writing Patterns

Use this skill to rewrite AI-sounding text so it sounds natural, specific, and
human while preserving the author's meaning and intended voice.

## Required reference

Before rewriting, read [`PATTERNS.md`](PATTERNS.md) and apply it as an exhaustive
checklist. Do not finish until the text has been checked against every pattern
group, including personality/soul, content patterns, language and grammar,
style, communication artifacts, filler, hedging, and generic conclusions.

The reference is based on
[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
maintained by WikiProject AI Cleanup.

## Process

1. Read the input text carefully and identify its purpose, audience, and voice.
2. Read [`PATTERNS.md`](PATTERNS.md).
3. Check the text against every pattern group in `PATTERNS.md`.
4. Rewrite each problematic section so it sounds human, concrete, and natural.
5. Preserve the core meaning, factual claims, constraints, and appropriate tone.
6. Add voice where the text is technically clean but sterile.
7. Read the result aloud mentally and fix flat rhythm, vague claims, and pasted
   chatbot artifacts.

## Completion criterion

The rewrite is done only when:

- every pattern group in `PATTERNS.md` has been considered;
- obvious AI tells have been removed or intentionally preserved for context;
- the text uses specific details over vague claims;
- sentence rhythm varies naturally;
- the result still matches the intended voice, audience, and meaning.

## Output format

Provide:

1. The rewritten text.
2. A brief summary of the most important changes, when helpful.
