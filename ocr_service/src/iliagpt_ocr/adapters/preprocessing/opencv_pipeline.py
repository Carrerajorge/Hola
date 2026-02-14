from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


def _resize_long_side(image_bgr: np.ndarray, *, long_side_px: int) -> np.ndarray:
    h, w = image_bgr.shape[:2]
    long_side = max(h, w)
    if long_side == long_side_px:
        return image_bgr
    scale = float(long_side_px) / float(long_side)
    if scale <= 0:
        return image_bgr
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return cv2.resize(image_bgr, (new_w, new_h), interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)


def _estimate_skew_angle_deg(binary_inv: np.ndarray) -> float:
    # binary_inv: text pixels are white (255), background black (0)
    coords = cv2.findNonZero(binary_inv)
    if coords is None:
        return 0.0
    rect = cv2.minAreaRect(coords)
    angle = float(rect[-1])
    # OpenCV returns angles in [-90, 0)
    if angle < -45.0:
        angle = 90.0 + angle
    return angle


def _rotate(image_bgr: np.ndarray, angle_deg: float) -> np.ndarray:
    if abs(angle_deg) < 0.05:
        return image_bgr
    h, w = image_bgr.shape[:2]
    center = (w / 2.0, h / 2.0)
    m = cv2.getRotationMatrix2D(center, angle_deg, 1.0)
    return cv2.warpAffine(image_bgr, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _crop_to_text_region(binary: np.ndarray, image_bgr: np.ndarray) -> np.ndarray:
    # binary: white background (255), black text (0)
    inv = 255 - binary
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 5))
    dil = cv2.dilate(inv, kernel, iterations=2)
    contours, _ = cv2.findContours(dil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return image_bgr

    h, w = binary.shape[:2]
    min_area = int(0.001 * h * w)
    xs: list[int] = []
    ys: list[int] = []
    xe: list[int] = []
    ye: list[int] = []
    for c in contours:
        area = cv2.contourArea(c)
        if area < min_area:
            continue
        x, y, cw, ch = cv2.boundingRect(c)
        xs.append(x)
        ys.append(y)
        xe.append(x + cw)
        ye.append(y + ch)

    if not xs:
        return image_bgr

    x1 = max(0, min(xs) - 10)
    y1 = max(0, min(ys) - 10)
    x2 = min(w, max(xe) + 10)
    y2 = min(h, max(ye) + 10)
    if x2 <= x1 or y2 <= y1:
        return image_bgr
    return image_bgr[y1:y2, x1:x2]


@dataclass(frozen=True)
class OpenCvPreprocessor:
    enable_deskew: bool = True
    enable_denoise: bool = True
    enable_region_detect: bool = True

    def process(self, image_bgr: np.ndarray, *, dpi: int) -> np.ndarray:
        # 1) Normalize "effective DPI" with a pragmatic long-side target.
        #    300 DPI scans typically fall between 2000-3500px long side.
        long_side = max(image_bgr.shape[:2])
        target_long_side = 2500
        if long_side < 1200:
            image_bgr = _resize_long_side(image_bgr, long_side_px=target_long_side)
        elif long_side > 4000:
            image_bgr = _resize_long_side(image_bgr, long_side_px=3500)

        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

        if self.enable_denoise:
            # fastNlMeans is more robust than Gaussian blur for scan noise.
            gray = cv2.fastNlMeansDenoising(gray, h=12)

        # Adaptive threshold is robust for uneven lighting.
        binary = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            35,
            11,
        )

        if self.enable_deskew:
            binary_inv = 255 - binary
            angle = _estimate_skew_angle_deg(binary_inv)
            image_bgr = _rotate(image_bgr, angle)
            gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
            if self.enable_denoise:
                gray = cv2.fastNlMeansDenoising(gray, h=12)
            binary = cv2.adaptiveThreshold(
                gray,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                35,
                11,
            )

        if self.enable_region_detect:
            image_bgr = _crop_to_text_region(binary, image_bgr)

        return image_bgr

