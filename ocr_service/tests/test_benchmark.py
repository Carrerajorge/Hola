from __future__ import annotations

import numpy as np

from iliagpt_ocr.adapters.preprocessing.opencv_pipeline import OpenCvPreprocessor


def test_benchmark_preprocessor(benchmark):
    img = np.full((600, 1800, 3), 255, dtype=np.uint8)
    img[220:320, 300:1500] = (0, 0, 0)
    pre = OpenCvPreprocessor(enable_deskew=True, enable_denoise=True, enable_region_detect=True)
    benchmark(pre.process, img, dpi=300)

