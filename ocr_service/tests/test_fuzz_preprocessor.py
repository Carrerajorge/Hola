from __future__ import annotations

import numpy as np
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp

from iliagpt_ocr.adapters.preprocessing.opencv_pipeline import OpenCvPreprocessor


@given(
    img=hnp.arrays(
        dtype=np.uint8,
        shape=st.tuples(st.integers(50, 200), st.integers(50, 200), st.just(3)),
        elements=st.integers(0, 255),
    )
)
@settings(max_examples=25, deadline=None)
def test_preprocessor_fuzz_does_not_crash(img: np.ndarray):
    pre = OpenCvPreprocessor(enable_deskew=True, enable_denoise=True, enable_region_detect=True)
    out = pre.process(img, dpi=300)
    assert out.ndim == 3
    assert out.shape[2] == 3

