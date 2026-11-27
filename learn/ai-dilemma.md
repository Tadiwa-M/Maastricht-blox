# The AI dilemma

## The problem

AI agents multiply what you can build. When the credits run out, building stops. Studying doesn't, but adding features
to Maastricht Blox does. A bigger subscription only moves the wall further away; it doesn't remove it.

## What it is not

It is not "stop using agents". They are the right tool for large implementation work, and they built most of this repo.
The goal is to be **more capable of directing them, and more capable without them**, at the same time.

> Two developers can both ship something impressive with an agent. The one who also understands the system, can debug it
> and can keep going without the agent is in the stronger position. Be that one.

## The plan

### 1. Two working modes

| Mode A: credits available | Mode B: credits out |
|---|---|
| Large features, refactors, multi-file debugging, new systems | Reading and tracing systems ([curriculum.md](curriculum.md)) |
| Unity automation, performance work, ports between engines | Playing, testing, finding and writing down bugs |
| Anything that touches many files at once | Tuning numbers by hand (looks, feel, colours: they live in data) |
| | Writing specs for the next Mode A session ([credits-out.md](credits-out.md)) |

Mode B must never feel like waiting for Mode A. A day of Mode B that ends with three sharp specs makes the next Mode A
day several times more productive.

### 2. Spend credits well

- **Small models for small jobs.** Running scripts or reading a log doesn't need the strongest model.
- **Tight prompts.** Say exactly what to do, what not to touch, and "stop and report after each step".
- **One builder per codebase at a time.** Two agents editing the same branch causes conflicts and lost work.
- **Run cheap commands yourself.** Pasting a 40-line log costs nothing; an agent exploring to find it costs a lot.
- **The repo is the memory.** [`PLAN.md`](../PLAN.md), [`docs/DEVLOG.md`](../docs/DEVLOG.md), [`docs/guide/`](../docs/guide/) mean a fresh session doesn't re-learn everything.

### 3. A fallback stack (in order)

1. **Your own hands** for small changes. The look, feel and game numbers are data; you can tune them without writing code.
2. **A second chat assistant** (ChatGPT or similar) as tutor and reviewer: explanations, code review, planning. Not as a
   second builder on the same branch.
3. **A hosted open-weight model through a pay-per-use API**, with an open coding tool (Aider, for example). Cheaper per
   task than a bigger subscription; still paid.
4. **Local models**: a learning experiment, not a replacement (see below).

### 4. Hardware reality (local models)

- The laptop (Samsung Galaxy Book 360, 2023) has integrated graphics. Expect small quantised models (3B to 8B) to run,
  slowly. Good for explaining code and small utilities; not for multi-file work on a project this size.
- Very large open models (Kimi K3 class) need datacenter hardware. Use them hosted, if at all.
- Worth doing once as an exercise: install Ollama, run a small model, give it one real task from this repo, and note
  exactly where it breaks. You learn what agents actually do from watching a weak one fail.

### 5. Rules

1. Never let an agent be the only thing between you and understanding a system. After every agent session: what changed,
   which files, how is it tested, where would you start debugging it?
2. Judge results by looking at them (the picture, the game, the test output), never by an agent's summary or a log line.
3. Approve before commit. Read the diff.
4. Encouragement is nice; critique teaches. Ask any assistant, this one included, to grade you harshly.
