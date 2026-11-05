"""Gait extraction (tools/gait.py) on a synthetic BVH with known motion."""

import math

import numpy as np
import pytest

from blox_pipeline.tools import gait

FPS = 120
THIGH, SHIN = 7.0, 7.0


def synthetic_bvh(swing_deg=30.0, frames=480, step_frames=60, speed_units=0.2) -> str:
    """A skeleton walking along +Z: thighs swing +-swing_deg in opposition (period 2 steps),
    knees and arms still. Hips height constant."""
    def joint(name, off, body="", channels="CHANNELS 3 Zrotation Yrotation Xrotation"):
        return f"JOINT {name}\n{{\nOFFSET {off}\n{channels}\n{body}}}\n"
    end = "End Site\n{\nOFFSET 0 0 1\n}\n"
    leg = lambda s, x: joint(f"{s}UpLeg", f"{x} 0 0", joint(f"{s}Leg", f"0 {-THIGH} 0", joint(f"{s}Foot", f"0 {-SHIN} 0", joint(f"{s}ToeBase", "0 -0.5 2", end))))  # noqa: E731
    arm = lambda s, x: joint(f"{s}Arm", f"{x} 0 0", joint(f"{s}ForeArm", "0 -5 0", joint(f"{s}Hand", "0 -4 0", end)))  # noqa: E731
    neck = joint("Neck", "0 10 0", arm("Left", 3) + arm("Right", -3))
    h = ("HIERARCHY\nROOT Hips\n{\nOFFSET 0 0 0\nCHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation\n"
         + leg("Left", 1.5) + leg("Right", -1.5) + neck + "}\n")
    order = ["LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
             "Neck", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"]
    rows = []
    for f in range(frames):
        a = swing_deg * math.sin(2 * math.pi * f / (2 * step_frames))
        vals = [0.0, 15.0, f * speed_units, 0.0, 0.0, 0.0]
        for j in order:
            x = -a if j == "LeftUpLeg" else a if j == "RightUpLeg" else 0.0  # -X rotation swings forward (+Z)
            vals += [0.0, 0.0, x]
        rows.append(" ".join(f"{v:.4f}" for v in vals))
    return h + f"MOTION\nFrames: {frames}\nFrame Time: {1 / FPS:.6f}\n" + "\n".join(rows) + "\n"


def test_parse_and_forward_kinematics():
    b = gait.parse_bvh(synthetic_bvh())
    assert b.joints[0].name == "Hips" and len(b.frames) == 480
    P = gait.world_positions(b)
    knee = b.index("LeftLeg")
    assert np.allclose(P[0, knee], [1.5, 15 - THIGH, 0.0], atol=1e-6)  # frame 0: no swing
    d = np.linalg.norm(P[:, b.index("LeftFoot")] - P[:, knee], axis=1)
    assert np.allclose(d, SHIN)  # bones keep their length


def test_angles_amplitude_sign_and_speed():
    b = gait.parse_bvh(synthetic_bvh(swing_deg=30))
    a = gait.gait_angles(b)
    mid = slice(60, 420)
    assert a["hip0"][mid].max() == pytest.approx(math.radians(30), abs=0.02)
    assert a["hip1"][mid].min() == pytest.approx(-math.radians(30), abs=0.02)
    assert np.abs(a["knee0"][mid]).max() < 1e-6  # straight legs
    assert a["_speed"][mid].mean() == pytest.approx(0.2 * FPS * gait.CMU_UNIT_M, rel=0.02)


def test_cycles_table_phase_and_stride():
    b = gait.parse_bvh(synthetic_bvh(frames=600))
    t = gait.cycle_table(gait.gait_angles(b), b.frame_time)
    assert t["cycles"] >= 3
    hip0 = t["curves"]["hip0"]
    assert hip0.index(max(hip0)) == pytest.approx(gait.SAMPLES // 4, abs=1)  # left thigh peaks at pi/2
    hip1 = t["curves"]["hip1"]
    assert abs(hip1.index(max(hip1)) - hip0.index(max(hip0))) == pytest.approx(gait.SAMPLES // 2, abs=1)
    legs = THIGH + SHIN
    assert t["stride"] == pytest.approx(0.2 * 60 / legs, rel=0.03)  # units per step / leg length


def test_build_writes_an_es_module(tmp_path):
    f = tmp_path / "w.bvh"
    f.write_text(synthetic_bvh(frames=600))
    out = tmp_path / "gait-data.js"
    assert gait.main([str(out), f"walk={f},{f}"]) == 0
    text = out.read_text()
    assert text.startswith("// Generated") and "export default {" in text and "mocap.cs.cmu.edu" in text
