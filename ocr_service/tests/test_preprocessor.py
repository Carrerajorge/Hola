from __future__ import annotations

import numpy as np

from iliagpt_ocr.adapters.preprocessing import opencv_pipeline as pp_mod
from iliagpt_ocr.adapters.preprocessing.opencv_pipeline import OpenCvPreprocessor


def test_preprocessor_returns_bgr_uint8():
    img = np.full((200, 600, 3), 255, dtype=np.uint8)
    img[80:120, 200:400] = (0, 0, 0)  # black bar

    pre = OpenCvPreprocessor(enable_deskew=True, enable_denoise=True, enable_region_detect=True)
    out = pre.process(img, dpi=300)
    assert out.dtype == np.uint8
    assert out.ndim == 3
    assert out.shape[2] == 3


def test_preprocessor_region_crop_reduces_blank_margins():
    img = np.full((400, 1200, 3), 255, dtype=np.uint8)
    img[160:240, 480:720] = (0, 0, 0)  # centered black block

    pre = OpenCvPreprocessor(enable_deskew=False, enable_denoise=False, enable_region_detect=True)
    out = pre.process(img, dpi=300)
    # Should crop in at least one dimension.
    assert out.shape[0] <= img.shape[0]
    assert out.shape[1] <= img.shape[1]
    assert (out.shape[0], out.shape[1]) != (img.shape[0], img.shape[1])


def test_preprocessor_handles_blank_image():
    img = np.full((300, 900, 3), 255, dtype=np.uint8)
    pre = OpenCvPreprocessor(enable_deskew=True, enable_denoise=True, enable_region_detect=True)
    out = pre.process(img, dpi=300)
    assert out.shape[2] == 3


def test_resize_long_side_is_noop_when_already_target():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    out = pp_mod._resize_long_side(img, long_side_px=200)
    assert out is img


def test_resize_long_side_is_noop_when_target_is_zero():
    img = np.zeros((100, 200, 3), dtype=np.uint8)
    out = pp_mod._resize_long_side(img, long_side_px=0)
    assert out is img


def test_preprocessor_downscales_very_large_images():
    img = np.full((5000, 800, 3), 255, dtype=np.uint8)
    pre = OpenCvPreprocessor(enable_deskew=False, enable_denoise=False, enable_region_detect=False)
    out = pre.process(img, dpi=300)
    assert max(out.shape[:2]) <= 3500
