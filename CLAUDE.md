# Maastricht Blox: working rules

## Workflow (the owner's process; follow it for every piece of work)
1. **Outline** what we're doing, **identify tools**, **make a plan** in phases (ideally 3).
   The living plan is `PLAN.md`; keep its phase status current.
2. **Document everything** as we build: `docs/guide/*` for how things work, `docs/DEVLOG.md`
   for dated decisions. Update `README.md` and this file often (new commands, rules, status).
3. **Systematize and automate**: if a step is repeated, script it (`scripts/`), and wire
   checks into CI (`.github/workflows/ci.yml`).
4. **Ensure quality**: `scripts/check.sh` must pass before every push; for look changes run
   `scripts/shots.sh`, review the screenshots and show them to the owner. On the GPU workstation
   also run `scripts/unity.ps1 all` (or `unity.sh`) for Unity compile/tests/screenshot.
5. Communication: concise, high-signal, direct pushback over validation.
6. **Approval first:** never commit, push or deploy without the owner's explicit approval.

## Rules

- `CONTRACT.md` + `contract/*.json` are the interface between components. Read them first.
  Never change them silently: if a change is required, bump `contractVersion` and update every component.
- Launch target is the web build: `viewer/` → `scripts/site.ps1|sh` → `scripts/publish.ps1|sh` (GitHub Pages
  repo `Tadiwa-M/Maastricht_larper`, one force-pushed commit per release). Never commit site builds,
  world data or the owner's photos to this repo.
- Map reports: fix with an entry in `corrections/corrections.json` when possible (data, reviewable), code
  only when a whole class of problem needs it. Live data and reports go through `relay/` (Cloudflare Worker).
- Layout: `pipeline/` (Python data → chunks), `viewer/` (three.js game), `relay/` (Worker), `proxy/` (Python live-data server),
  `unity/` (Unity 6 URP project; runtime code under `unity/Assets/Blox/`), `docs/`.
- Unity assemblies: `Blox.Data` (pure C#, no UnityEngine, testable with dotnet), `Blox.Meshing`,
  `Blox.Rendering`, `Blox.Live`, `Blox.Gameplay`. Data/gameplay must not depend on Rendering.
- No hand-edited Unity YAML (scenes/prefabs/assets). Build scenes and settings from code
  (editor menu scripts under `unity/Assets/Blox/Editor/`).
- Python: 3.11+, managed with `uv`, `pytest`, type hints, no notebooks in the main path.
- Style: original brick style. Never use the LEGO name, logo or minifigure shape.
- Clean modular code; small files; tests for every format reader/writer.
- Rotations: place pieces by **facing** (N/E/S/W; a piece's front faces +j at rot 0) through each
  language's rotation helper; never hand-roll rot math. All helpers pass `contract/test_vectors/rotation.json`.
- Buildings off the grid by > 3° are islands (CONTRACT 5.1): own rotated grid, `.bxi` files, one rigid
  transform each. Inside an island everything (facing, facades) works exactly as on the world grid.
- Moving things (buses, boats, characters) are brick models (`contract/models/`) driven by a
  `PathMover` producing a `Pose`; never bake them into chunks.
- Docs are part of the work: after each change, update the matching guide in `docs/guide/` and
  append a dated entry to `docs/DEVLOG.md` (what changed, why, open decisions).
