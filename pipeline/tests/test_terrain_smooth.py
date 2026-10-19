"""Terrain smoothing removes survey noise, keeps slopes and NaNs."""

from __future__ import annotations

import numpy as np

from blox_pipeline.voxelise.terrain_smooth import smooth_nan


def test_noise_removed_slope_kept() -> None:
    rng = np.random.default_rng(1)
    slope = np.linspace(45.0, 50.0, 200)[:, None] * np.ones((1, 200))
    noisy = (slope + rng.normal(0, 0.08, slope.shape)).astype(np.float32)
    out = smooth_nan(noisy, 4)
    inner = (slice(20, -20), slice(20, -20))
    assert np.abs(out[inner] - slope[inner]).max() < 0.06
    assert np.std(noisy[inner] - slope[inner]) > 3 * np.std(out[inner] - slope[inner])


def test_nans_preserved_and_ignored() -> None:
    a = np.full((50, 50), 10.0, np.float32)
    a[10:20, 10:20] = np.nan
    out = smooth_nan(a, 3)
    assert np.isnan(out[15, 15]) and np.allclose(out[~np.isnan(a)], 10.0)
