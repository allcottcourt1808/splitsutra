# 13 — Should we use GitHub Spec Kit?

**Question raised during planning.** Short answer: **partially — adopt the constitution
idea now, and optionally the `/tasks` → `/implement` loop for the two hardest phases. Do
not restart planning inside it.**

---

## What Spec Kit is

[github/spec-kit](https://github.com/github/spec-kit) is an open-source toolkit for
**spec-driven development** with coding agents. You install a `specify` CLI (via `uv`,
so it needs Python), initialise it into a repo, and it adds a `.specify/` directory of
templates and scripts plus a set of slash commands your agent can run.

The workflow is roughly:

```
constitution  →  specify  →  plan  →  tasks  →  implement
   (rules)      (the what)  (the how)  (the list)  (the code)
```

Each step writes markdown into a per-feature folder (`specs/001-some-feature/`) —
`spec.md`, `plan.md`, `tasks.md`, and supporting files — and the agent works from those
rather than from a chat prompt.

> ⚠️ Spec Kit is young and its command naming has changed across releases (commands were
> renamed to a `speckit.*` namespace at one point). **Check the README for the version you
> actually install** rather than trusting any tutorial, including this paragraph.

---

## Why it's a reasonable fit here

- The workflow it enforces is exactly what we just did by hand: requirements → design →
  task list → code.
- **The constitution concept is genuinely valuable.** A short, stable set of enforceable
  principles that an agent re-checks against each phase is worth more than another
  thousand lines of design docs, because it survives context loss between sessions.
- `/tasks` produces granular, dependency-ordered task lists with parallelisation markers —
  finer-grained than the phase checklists here.
- It keeps a solo developer honest across a long project, which is precisely the failure
  mode of a side project.

## Why not to restart planning in it

- **We already have ~80% of what it would generate**, hand-tailored to this problem. Its
  templates are deliberately generic; they would not produce
  [04-split-engine.md](04-split-engine.md) or the threat table in
  [05-security-rules.md](05-security-rules.md).
- **Structural mismatch.** Spec Kit organises around _per-feature_ specs on feature
  branches. Our hardest documents are cross-cutting — architecture, data model, split
  engine, security rules — and don't belong to any one feature.
- **Another prerequisite.** It needs Python and `uv`. You don't have Node installed yet;
  adding a second toolchain before the first line of code is friction with no payoff.
- **Process overhead pays off with scale.** It shines on teams and long-lived codebases.
  For one developer on a ~21-day build with the design already written, the ceremony costs
  more than it returns.

---

## Recommendation

### ✅ Adopt now — the constitution

Already done: [../CONSTITUTION.md](../CONSTITUTION.md). Twelve articles encoding the
non-negotiables (integers for money, core purity, rules-are-the-boundary, one
implementation of the math). This is the highest-value idea in Spec Kit and it costs
nothing to use standalone.

Use it like this: at the start of each phase, re-read it; at the end, check the diff
against it. It's short enough to actually do.

### 🤔 Optional — Spec Kit proper for Phases 06 and 07

These are the two phases where a mis-step is expensive and the task graph is genuinely
intricate. If you want the tighter loop, initialise Spec Kit **after** Phase 01, and write
per-feature specs for just those phases:

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init --here
```

Point its constitution step at the existing `CONSTITUTION.md` and its plan step at
`docs/04-split-engine.md`, rather than regenerating them.

### ❌ Skip — regenerating the planning we just did

`docs/00`–`docs/12` and `checklists/00`–`12` already serve the spec, plan, and tasks roles.
Re-deriving them through generic templates would lose specificity.

---

## The lightweight alternative, if you want more structure without the tool

You get most of the benefit from three habits:

1. **Re-read `CONSTITUTION.md` at the start of every phase.** Twelve articles, two minutes.
2. **One PR per phase**, with the phase checklist pasted into the PR description as the
   acceptance criteria.
3. **Write the acceptance-criteria IDs into test names** (`AC-D2.3`, `T5`), so the
   requirements doc and the test suite stay mechanically linked. This is the single
   highest-leverage habit on the list, and it's free.

My honest view: for this project, those three habits capture nearly all of Spec Kit's
value. Reach for the full toolkit if you find yourself losing the thread between sessions
— that's the problem it actually solves.

---

## If you want to adopt it fully anyway

That's a perfectly defensible choice, especially if you expect to build this over months
in short sessions. Say the word and I'll:

- restructure `docs/` and `checklists/` into Spec Kit's `specs/NNN-feature/` layout
- port `CONSTITUTION.md` into `.specify/memory/constitution.md`
- add `uv` + Python to [../checklists/phase-00-prerequisites.md](../checklists/phase-00-prerequisites.md)
- regenerate the phase checklists as Spec Kit `tasks.md` files

Roughly half a day of restructuring, and no work is lost.
