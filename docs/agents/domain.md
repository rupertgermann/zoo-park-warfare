# Domain docs

Layout: single-context.

- `GLOSSARY.md` at the repo root defines the game's terms (factions, phases, KO, boss, bot chat, ...).
- `docs/adr/NNNN-short-title.md` records architecture decisions, numbered in order.

Both are created lazily. Neither exists until the first term or decision is recorded.

## Rules for consumers

- Read `GLOSSARY.md` before naming anything in code, issues or specs, and use its terms.
- If a term you need is missing or ambiguous, add or sharpen it (see the `domain-modeling` skill) rather than inventing a synonym.
- Before changing an area, read the ADRs that cover it. Do not silently contradict an ADR. Write a new one that supersedes it.
