#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地验证码识别服务:常驻进程,从 stdin 逐行读取图片路径,输出识别结果。

策略:对同一张图做多种 OpenCV 预处理,分别交给 ddddocr 主模型和 beta 模型识别,
对结果投票;优先取 4 位结果。依赖装在 ./pylibs(PYTHONPATH 注入)。
"""
import re
import sys

import cv2
import numpy as np
import ddddocr

_main = ddddocr.DdddOcr(show_ad=False)
try:
    _beta = ddddocr.DdddOcr(show_ad=False, beta=True)
except Exception:
    _beta = None


def _encode(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes() if ok else b""


def _variants(path: str):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return []
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    big = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    blur = cv2.GaussianBlur(big, (3, 3), 0)

    outs = [big]
    _, otsu = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    outs.append(otsu)
    outs.append(cv2.adaptiveThreshold(big, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      cv2.THRESH_BINARY, 15, 4))
    outs.append(cv2.adaptiveThreshold(big, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                      cv2.THRESH_BINARY_INV, 15, 5))
    outs.append(cv2.threshold(cv2.medianBlur(big, 3), 0, 255,
                              cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1])
    outs.append(cv2.bitwise_not(otsu))
    return [_encode(v) for v in outs if v is not None]


def _clean(text: str) -> str:
    text = "".join(re.findall(r"[A-Za-z0-9]", text or ""))
    return text if 3 <= len(text) <= 6 else ""


def recognize(path: str) -> str:
    votes = {}
    for buf in _variants(path):
        for ocr in [_main, _beta]:
            if ocr is None:
                continue
            try:
                text = _clean(ocr.classification(buf))
            except Exception:
                text = ""
            if text:
                votes[text] = votes.get(text, 0) + 1
    if not votes:
        return ""

    def score(item):
        text, count = item
        return (1 if len(text) == 4 else 0, count, len(text))

    return max(votes.items(), key=score)[0]


def main():
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        sys.stdout.write(recognize(path) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
