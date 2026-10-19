# Maastricht Blox docs

These docs explain how the code works, for someone reading it for the first time. Each page is
short and points at the real files. `CONTRACT.md` (repo root) is the binding spec; these pages
explain it and show where it is implemented.

## Reading order

| # | Page | Read it to learn |
|---|---|---|
| 0 | [guide/00-workstation-setup.md](guide/00-workstation-setup.md) | set up the GPU workstation: Unity headless compile/test/build/screenshot, real data |
| 1 | [ARCHITECTURE.md](ARCHITECTURE.md) | the big picture: components, data flow and why each design decision was taken |
| 2 | [guide/01-coordinates-and-rotation.md](guide/01-coordinates-and-rotation.md) | RD → grid → Unity/three.js, the **facing rule**, `footprint_cell`, shared test vectors |
| 3 | [guide/02-pipeline.md](guide/02-pipeline.md) | Python pipeline stages, and how voxels become bricks |
| 4 | [guide/03-chunk-format.md](guide/03-chunk-format.md) | the `.bxc` file byte by byte, with a real hexdump |
| 5 | [guide/04-facades-and-pieces.md](guide/04-facades-and-pieces.md) | the facade grammar, detail pieces 38-47, how to add a new piece end to end |
| 6 | [guide/05-movers-and-models.md](guide/05-movers-and-models.md) | brick models, `PathMover`, poses, walk cycle, live bus path, walk mode |
| 7 | [guide/06-viewer.md](guide/06-viewer.md) | three.js browser viewer: module map, run, where to change the look |
| 8 | [guide/07-unity.md](guide/07-unity.md) | Unity 6 URP project: assemblies, mesher, rendering, editor menus |
| 9 | [guide/08-live-proxy.md](guide/08-live-proxy.md) | the live-data proxy (OVapi, Buienradar, RWS) |

## Status and history

- [STATUS.md](STATUS.md): what is built, what is verified, test counts, next steps on a PC.
- [DEVLOG.md](DEVLOG.md): dated log of what was built and the decisions taken. New work is appended there.
- [DATA_SOURCES.md](DATA_SOURCES.md): endpoints, licences and gotchas for every data source.
- `../PLAN.md`: outline, tools and phases.

## One-command checks

```bash
scripts/check.sh      # all suites: pipeline, proxy, dotnet (core + look), viewer
scripts/shots.sh      # rebuild models + look-test scene, take viewer screenshots into build/shots/
scripts/unity.sh all  # (workstation) Unity compile + tests + player build + screenshot; Windows: scripts\unity.ps1
```

## Keeping the docs current

When you change a subsystem, update its guide page, add a dated entry to `DEVLOG.md`, and
refresh `STATUS.md` if test counts or the verified/unverified picture changed.
