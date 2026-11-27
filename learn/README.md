# Learn: building and understanding Maastricht Blox

This folder is for the weeks when the agent credits are gone, and for every week really. The point: keep
making progress on the project and on your own skills without a subscription standing between you and the work.

| File | What it is |
|---|---|
| [ai-dilemma.md](ai-dilemma.md) | The problem (productivity stops when credits stop) and the plan that answers it |
| [curriculum.md](curriculum.md) | Ten tracks through the whole system, each taught from real files in this repo, with exercises and check questions |
| [case-studies.md](case-studies.md) | Real bugs from this project, how they were found and fixed. The best teachers we have |
| [credits-out.md](credits-out.md) | What to do on a no-credits day, and the spec template that makes the next agent session fast |
| [tutor-prompt.md](tutor-prompt.md) | A prompt for a separate tutor chat (ChatGPT or any other) connected to this repo |
| [`tools/map.mjs`](tools/map.mjs) | Prints a map of any folder: every file, its size and what its header comment says it does |
| [`tools/quiz.mjs`](tools/quiz.mjs) | Asks you a random check question from the curriculum |
| [`tools/links.mjs`](tools/links.mjs) | Makes these docs clickable: every repo path in backticks links to the file, a function named next to its file links to its line. Re-run after code moves |

## Quick start (PowerShell, from the repo root)

```powershell
node learn/tools/map.mjs viewer/src/render      # what lives in a folder, one line per file
node learn/tools/quiz.mjs                        # one random question; Enter shows the answer
node learn/tools/links.mjs                       # refresh the links to the code (after code moved)
node learn/tools/quiz.mjs rendering              # only questions from one track
```

## The loop that teaches

1. **Read** one file the curriculum points to. Every file in this repo starts with a comment saying what it does and why.
2. **Predict** what a change will do before you make it. Write the prediction down.
3. **Change** one number or one line. Run the tests or look at the game.
4. **Compare** the result with your prediction. The gap is the lesson.
5. **Undo** when you are done: `git restore <file>` puts the file back exactly as it was.

Keep a short journal (a file outside the repo, or a notebook): date, what you studied, what surprised you.
