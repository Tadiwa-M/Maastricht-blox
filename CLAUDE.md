# Maastricht Blox: working rules

- `CONTRACT.md` + `contract/*.json` are the interface between components. Read them first.
  Never change them silently: if a change is required, bump `contractVersion` and update every component.
- Layout: `pipeline/` (Python data → chunks), `proxy/` (Python live-data server),
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
- Moving things (buses, boats, characters) are brick models (`contract/models/`) driven by a
  `PathMover` producing a `Pose`; never bake them into chunks.
- Docs are part of the work: after each change, update the matching guide in `docs/guide/` and
  append a dated entry to `docs/DEVLOG.md` (what changed, why, open decisions).
