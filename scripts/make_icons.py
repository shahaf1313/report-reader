#!/usr/bin/env python3
"""Generate the app icons (PNG) with no third-party dependencies.

The mark: three rising bars on the banknote-teal ground, with a thin
guilloche ring behind them. Rendered with 4x supersampling for smooth edges.
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

BG = (15, 94, 87)
FG = (241, 245, 239)
RING = (40, 120, 111)
SS = 4


def shade(x: float, y: float, scale: float) -> tuple[int, int, int]:
    """Colour at normalised coords (0..1). `scale` shrinks the mark for maskable icons."""
    cx, cy = (x - 0.5) / scale + 0.5, (y - 0.5) / scale + 0.5
    # guilloche: two sets of thin concentric rings
    r1 = math.hypot(cx - 0.5, cy - 0.62)
    if 0.36 < r1 < 0.47 and (r1 * 90) % 1 < 0.22:
        base = RING
    else:
        base = BG
    # bars
    bars = [(0.24, 0.38, 0.58), (0.43, 0.57, 0.44), (0.62, 0.76, 0.28)]  # x0, x1, top
    for x0, x1, top in bars:
        if x0 <= cx <= x1 and top <= cy <= 0.74:
            return FG
    # baseline
    if 0.18 <= cx <= 0.82 and 0.775 <= cy <= 0.80:
        return FG
    return base


def render(size: int, scale: float = 1.0) -> bytes:
    rows = []
    n = size * SS
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = shade((px * SS + sx + 0.5) / n, (py * SS + sy + 0.5) / n, scale)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            row += bytes(v // (SS * SS) for v in acc)
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    out = Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for name, size, scale in [
        ("apple-touch-icon.png", 180, 1.0),
        ("icon-192.png", 192, 1.0),
        ("icon-512.png", 512, 1.0),
        ("icon-maskable-512.png", 512, 0.78),
    ]:
        (out / name).write_bytes(render(size, scale))
        print("wrote", out / name)


if __name__ == "__main__":
    main()
