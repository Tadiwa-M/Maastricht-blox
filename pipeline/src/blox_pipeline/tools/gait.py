"""Gait curves from motion capture: BVH clips -> ``viewer/src/figure/gait-data.js``.

Real people don't walk in sine waves: the heel strikes, the knee flexes twice per step, the
arms counter-swing, the hips swing and drop, the shoulders twist against them. This tool reads
motion-capture clips (CMU Graphics Lab Motion Capture Database, BVH conversion by B. Hahne:
"free for use in research and commercial projects worldwide"), measures the joint angles of our
figure's rig (``viewer/src/figure/rig.js``) in the body's own frame, cuts the clip into stride
cycles, averages them and writes one small table per gait. The viewer plays the tables by stride
phase on our own brick-style figure; no model, skeleton or mesh is imported.

Usage: python -m blox_pipeline.tools.gait --default [out]   (fetch the standard clips, cached in
           data/raw/mocap, and write viewer/src/figure/gait-data.js)
       python -m blox_pipeline.tools.gait <out.js|json> walk=16_15.bvh,16_16.bvh jog=16_35.bvh run=16_55.bvh\n(several clips per gait: their stride cycles are averaged)

Angles follow the rig's conventions: a positive hip / shoulder angle swings the limb forward, a
negative knee bends the shin back, a positive elbow bends forward, positive lean tilts the chest
forward, positive abduction lifts the arm sideways. Left is index 0. The cycle runs over two
steps (phase 0..2pi); the left thigh is furthest forward at phase pi/2, as in the rig's sine walk.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SAMPLES = 32
# the clips behind viewer/src/figure/gait-data.js (CMU subject 16: one performer for walk and jog;
# subject 9 adds runs). Fetched from the archive.org mirror of the BVH conversion.
DEFAULT_CLIPS = {
    "walk": ["16_15", "16_16", "16_21", "16_22", "16_31", "16_32"],
    "jog": ["16_35", "16_36", "16_45", "16_46", "16_56"],
    "run": ["16_55", "09_01", "09_04"],
}
MIRROR = "https://archive.org/download/cmu-mocap-master/cmu-mocap-master.zip/cmu-mocap-master%2Fdata%2F{subject}%2F{clip}.bvh"
CMU_UNIT_M = 0.0564  # CMU skeleton units: (1 / 0.45) inch


@dataclass
class Joint:
    name: str
    offset: np.ndarray
    channels: list[str]
    parent: int
    children: list[int] = field(default_factory=list)


@dataclass
class Bvh:
    joints: list[Joint]
    frames: np.ndarray  # (n, channels)
    frame_time: float

    def index(self, name: str) -> int:
        for i, j in enumerate(self.joints):
            if j.name == name:
                return i
        raise KeyError(name)


def parse_bvh(text: str) -> Bvh:
    tok = text.split()
    joints: list[Joint] = []
    stack: list[int] = []
    i = 0
    while tok[i] != "MOTION":
        t = tok[i]
        if t in ("ROOT", "JOINT"):
            joints.append(Joint(tok[i + 1], np.zeros(3), [], stack[-1] if stack else -1))
            if stack:
                joints[stack[-1]].children.append(len(joints) - 1)
            i += 2
        elif t == "End":  # End Site: skip its block
            depth = 0
            i += 2
            while True:
                if tok[i] == "{":
                    depth += 1
                elif tok[i] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            i += 1
        elif t == "{":
            stack.append(len(joints) - 1)
            i += 1
        elif t == "}":
            stack.pop()
            i += 1
        elif t == "OFFSET":
            joints[stack[-1]].offset = np.array([float(x) for x in tok[i + 1:i + 4]])
            i += 4
        elif t == "CHANNELS":
            n = int(tok[i + 1])
            joints[stack[-1]].channels = tok[i + 2:i + 2 + n]
            i += 2 + n
        else:
            i += 1
    n_frames = int(tok[tok.index("Frames:") + 1])
    ft = float(tok[tok.index("Time:") + 1])
    start = tok.index("Time:") + 2
    vals = np.array([float(x) for x in tok[start:]], dtype=np.float64)
    width = sum(len(j.channels) for j in joints)
    return Bvh(joints, vals[: n_frames * width].reshape(n_frames, width), ft)


def _rot(axis: str, deg: np.ndarray) -> np.ndarray:
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    if axis == "X":
        m = [[o, z, z], [z, c, -s], [z, s, c]]
    elif axis == "Y":
        m = [[c, z, s], [z, o, z], [-s, z, c]]
    else:
        m = [[c, -s, z], [s, c, z], [z, z, o]]
    return np.moveaxis(np.array(m), [0, 1], [-2, -1])  # (n, 3, 3)


def world_positions(b: Bvh) -> np.ndarray:
    """(frames, joints, 3) joint positions (BVH units, Y up)."""
    n = len(b.frames)
    pos = np.zeros((n, len(b.joints), 3))
    rot = np.zeros((n, len(b.joints), 3, 3))
    col = 0
    for ji, j in enumerate(b.joints):
        r = np.broadcast_to(np.eye(3), (n, 3, 3)).copy()
        t = np.zeros((n, 3))
        for ch in j.channels:
            v = b.frames[:, col]
            col += 1
            if ch.endswith("position"):
                t[:, "XYZ".index(ch[0])] = v
            else:
                r = r @ _rot(ch[0], v)
        if j.parent < 0:
            pos[:, ji] = j.offset + t
            rot[:, ji] = r
        else:
            pr = rot[:, j.parent]
            pos[:, ji] = pos[:, j.parent] + pr @ j.offset
            rot[:, ji] = pr @ r
    return pos


def _ang(fwd: np.ndarray, down: np.ndarray) -> np.ndarray:
    return np.arctan2(fwd, down)


def gait_angles(b: Bvh) -> dict[str, np.ndarray]:
    """Per-frame rig angles in the body frame (heading from the root's travel direction)."""
    P = world_positions(b)
    J = {name: b.index(name) for name in (
        "Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot",
        "RightToeBase", "Neck", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand")}
    p = lambda k: P[:, J[k]]  # noqa: E731
    up = np.array([0.0, 1.0, 0.0])
    # heading: the hips' horizontal travel over +-0.25 s (straight-line clips)
    root = p("Hips")
    k = max(1, int(round(0.25 / b.frame_time)))
    vel = np.zeros_like(root)
    vel[k:-k] = root[2 * k:] - root[:-2 * k]
    vel[:k], vel[-k:] = vel[k], vel[-k - 1]
    fwd = vel * np.array([1, 0, 1])
    fwd /= np.linalg.norm(fwd, axis=1, keepdims=True) + 1e-9
    right = np.cross(fwd, up)
    comp = lambda v, axis: (v * axis).sum(axis=-1)  # noqa: E731
    out: dict[str, np.ndarray] = {}
    for side, s in (("Left", 0), ("Right", 1)):
        thigh = p(f"{side}Leg") - p(f"{side}UpLeg")
        shin = p(f"{side}Foot") - p(f"{side}Leg")
        foot = p(f"{side}ToeBase") - p(f"{side}Foot")
        a_th = _ang(comp(thigh, fwd), -comp(thigh, up))
        a_sh = _ang(comp(shin, fwd), -comp(shin, up))
        toe = b.joints[J[f"{side}ToeBase"]].offset
        rest = math.atan2(toe[1], math.hypot(toe[0], toe[2]))  # the skeleton's foot tilt at rest
        a_ft = np.arctan2(comp(foot, up), comp(foot, fwd)) - rest  # foot pitch, + = toes up
        out[f"hip{s}"] = a_th
        out[f"knee{s}"] = a_sh - a_th  # negative = bent back
        out[f"ankle{s}"] = a_ft - a_sh  # the rig rotates the shoe relative to the shin
        arm = p(f"{side}ForeArm") - p(f"{side}Arm")
        fore = p(f"{side}Hand") - p(f"{side}ForeArm")
        out[f"sh{s}"] = _ang(comp(arm, fwd), -comp(arm, up))
        outward = right if side == "Right" else -right
        out[f"abd{s}"] = _ang(comp(arm, outward), -comp(arm, up))
        cosel = np.einsum("ij,ij->i", arm, fore) / (np.linalg.norm(arm, axis=1) * np.linalg.norm(fore, axis=1) + 1e-9)
        out[f"elbow{s}"] = np.arccos(np.clip(cosel, -1, 1))
    spine = p("Neck") - p("Hips")
    out["lean"] = _ang(comp(spine, fwd), comp(spine, up))
    for s in (0, 1):  # the rig hangs the arms from the leaning chest: swing relative to the spine
        out[f"sh{s}"] = out[f"sh{s}"] + out["lean"]
    hipline = p("RightUpLeg") - p("LeftUpLeg")
    shline = p("RightArm") - p("LeftArm")
    yaw = lambda v: np.arctan2(comp(v, fwd), comp(v, right))  # noqa: E731  (+ = the right side ahead, as in the rig)
    out["pelvisYaw"] = yaw(hipline)
    out["chestYaw"] = yaw(shline)
    out["pelvisRoll"] = np.arctan2(comp(hipline, up), np.hypot(comp(hipline, fwd), comp(hipline, right)))
    leg = np.linalg.norm(p("LeftLeg") - p("LeftUpLeg"), axis=1) + np.linalg.norm(p("LeftFoot") - p("LeftLeg"), axis=1)
    out["bob"] = (root[:, 1] - root[:, 1].mean()) / leg.mean()  # in leg lengths
    out["_speed"] = np.linalg.norm(vel * np.array([1, 0, 1]), axis=1) / (2 * k * b.frame_time) * CMU_UNIT_M
    out["_leg_m"] = np.full(len(root), leg.mean() * CMU_UNIT_M)
    return out


def cycles(hip_left: np.ndarray, min_len: int = 30) -> list[tuple[int, int]]:
    """Stride cycles: from one maximum of the left thigh's forward swing to the next."""
    h = np.convolve(hip_left, np.ones(5) / 5, mode="same")
    peaks = [i for i in range(2, len(h) - 2) if h[i] == h[i - 2:i + 3].max() and h[i] > np.percentile(h, 70)]
    peaks = [q for k, q in enumerate(peaks) if k == 0 or q - peaks[k - 1] >= min_len]
    return list(zip(peaks[:-1], peaks[1:]))


def cycle_table(angles: dict[str, np.ndarray], frame_time: float, skip: int = 1) -> dict:
    """Average the full stride cycles (dropping the first `skip`: the start-up step) into SAMPLES
    samples per curve, phase-aligned so the left thigh peaks at pi/2."""
    cs = cycles(angles["hip0"])
    cs = cs[skip:] if len(cs) > skip + 1 else cs
    if not cs:
        raise ValueError("no full stride cycle found")
    keys = [k for k in angles if not k.startswith("_")]
    acc = {k: np.zeros(SAMPLES) for k in keys}
    for a, b in cs:
        u = np.linspace(a, b, SAMPLES, endpoint=False)
        for k in keys:
            acc[k] += np.interp(u, np.arange(len(angles[k])), np.unwrap(angles[k]) if "Yaw" in k else angles[k])
    shift = SAMPLES // 4  # peak (sample 0) -> phase pi/2
    curves = {k: np.roll(v / len(cs), shift) for k, v in acc.items()}
    for k in ("pelvisYaw", "chestYaw", "lean"):  # walking-direction offsets: keep only the swing / a mean tilt
        if "Yaw" in k:
            curves[k] -= curves[k].mean()
    speed = float(np.mean([angles["_speed"][a:b].mean() for a, b in cs]))
    period = float(np.mean([b - a for a, b in cs])) * frame_time
    leg = float(angles["_leg_m"][0])
    return {
        "speed": round(speed, 3),  # m/s of the performer
        "stride": round(speed * period / 2 / leg, 4),  # metres per step, in leg lengths
        "cycles": len(cs),
        "curves": {k: [round(float(x), 4) for x in v] for k, v in curves.items()},
    }


def merge_tables(tables: list[dict]) -> dict:
    """Average several clips' cycle tables, weighted by their cycle counts."""
    w = np.array([t["cycles"] for t in tables], dtype=float)
    keys = tables[0]["curves"].keys()
    curves = {k: (sum(np.array(t["curves"][k]) * wi for t, wi in zip(tables, w)) / w.sum()) for k in keys}
    return {
        "speed": round(float(sum(t["speed"] * wi for t, wi in zip(tables, w)) / w.sum()), 3),
        "stride": round(float(sum(t["stride"] * wi for t, wi in zip(tables, w)) / w.sum()), 4),
        "cycles": int(w.sum()),
        "curves": {k: [round(float(x), 4) for x in v] for k, v in curves.items()},
    }


def build(clips: dict[str, list[Path]]) -> dict:
    """clips: gait name -> BVH files (their stride cycles are averaged together)."""
    out = {"version": 1, "samples": SAMPLES,
           "source": "CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by B. Hahne",
           "acknowledgement": "The data used in this project was obtained from mocap.cs.cmu.edu. "
                              "The database was created with funding from NSF EIA-0196217.",
           "gaits": {}}
    for name, paths in clips.items():
        tables = []
        for path in paths:
            b = parse_bvh(path.read_text(encoding="utf-8"))
            try:
                tables.append(cycle_table(gait_angles(b), b.frame_time))
            except ValueError:
                print(f"{path.name}: no full stride cycle, skipped")
        out["gaits"][name] = {"clips": [p.stem for p in paths], **merge_tables(tables)}
    return out


def fetch_default(root: Path | None = None) -> dict[str, list[Path]]:
    """Download the DEFAULT_CLIPS (cached; never fetched twice)."""
    from ..sources import config
    from ..sources.http import download, expect_magic, make_session

    base = (root or config.data_dir()) / "mocap"
    sess = make_session()
    out: dict[str, list[Path]] = {}
    for gait, clips in DEFAULT_CLIPS.items():
        for clip in clips:
            url = MIRROR.format(subject=clip.split("_")[0].zfill(3), clip=clip)
            out.setdefault(gait, []).append(download(url, base / f"{clip}.bvh", session=sess, validate=expect_magic(b"HIERARCHY")))
    return out


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if args and args[0] == "--default":
        from ..sources import config

        target = args[1] if len(args) > 1 else str(config.repo_root() / "viewer" / "src" / "figure" / "gait-data.js")
        args = [target] + [f"{g}={','.join(str(p) for p in ps)}" for g, ps in fetch_default().items()]
    if len(args) < 2:
        print(__doc__)
        return 2
    clips = dict(a.split("=", 1) for a in args[1:])
    doc = build({k: [Path(x) for x in v.split(",")] for k, v in clips.items()})
    text = json.dumps(doc, separators=(",", ":"))
    if args[0].endswith(".js"):  # an ES module the viewer imports directly
        text = ("// Generated by pipeline/src/blox_pipeline/tools/gait.py from motion capture (CMU Graphics Lab\n"
                "// Motion Capture Database, mocap.cs.cmu.edu; BVH by B. Hahne). Do not edit by hand.\n"
                f"export default {text};\n")
    Path(args[0]).write_text(text, encoding="utf-8")
    for k, g in doc["gaits"].items():
        print(f"{k}: {','.join(g['clips'])} {g['speed']} m/s, stride {g['stride']} legs/step, {g['cycles']} cycles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
