#!/usr/bin/env python3
"""Builds the Minecraft pixel font for the browser's game menu from a resource pack's font/ascii.png.

Usage: python3 make_font.py <pack folder> webcraft-web/src/mcfont.ttf   (needs: pip install fonttools pillow)

Every glyph pixel becomes a square (rows merged into runs), widths like Minecraft: up to the last used column plus
one pixel of space. German umlauts and ß are not in ascii.png (newer packs have them in accented.png, whose order
comes from Minecraft's font json): they are put together here (dots over a, o, u; ß drawn by hand).
"""
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

src = Path(sys.argv[1]) / 'assets/minecraft/textures/font/ascii.png'
out = sys.argv[2]
sheet = Image.open(src).convert('RGBA')
cell = sheet.width // 16          # 8 for 16x packs, 16 for 32x packs
k = cell // 8                     # pack pixels per Minecraft pixel
UNIT = 1024 // cell               # font units per pack pixel (one em = one cell = 8 Minecraft pixels)
BASE = 7 * k                      # rows above the baseline (Minecraft: 7 of 8)


def glyph_pixels(code):
    """Set pixels of one ascii.png cell as a set of (x, y), y = row from the top."""
    cx, cy = (code % 16) * cell, (code // 16) * cell
    return {(x, y) for y in range(cell) for x in range(cell) if sheet.getpixel((cx + x, cy + y))[3] > 127}


def scaled(rows):
    """Pixels from a drawing in Minecraft pixels ('X' set), row 0 = top of the cell."""
    return {(x * k + i, y * k + j) for y, row in enumerate(rows) for x, c in enumerate(row) if c == 'X'
            for i in range(k) for j in range(k)}


def with_dots(base, top):
    """An umlaut: the letter with two dots (Minecraft pixel columns 1 and 3) in Minecraft pixel row `top`."""
    px = set(glyph_pixels(ord(base)))
    for col in (1, 3):
        px |= {(col * k + i, top * k + j) for i in range(k) for j in range(k)}
    return px


SHARP_S = ['.XX..', 'X..X.', 'X.X..', 'X..X.', 'X...X', 'X...X', 'X.XX.']
glyphs = {chr(c): glyph_pixels(c) for c in range(33, 127)}
glyphs.update({'ä': with_dots('a', 0), 'ö': with_dots('o', 0), 'ü': with_dots('u', 0),
               'Ä': with_dots('A', -2), 'Ö': with_dots('O', -2), 'Ü': with_dots('U', -2), 'ß': scaled(SHARP_S)})

names, cmap, metrics, outlines = ['.notdef', 'space'], {32: 'space'}, {'.notdef': (512, 0), 'space': (4 * k * UNIT, 0)}, {}
for ch, px in glyphs.items():
    name = f'u{ord(ch):04X}'
    names.append(name)
    cmap[ord(ch)] = name
    width = (max(x for x, _ in px) + 1) if px else 0
    metrics[name] = ((width + k) * UNIT, 0)
    pen = TTGlyphPen(None)
    for y in sorted({y for _, y in px}):
        xs = sorted(x for x, yy in px if yy == y)
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            # one run of pixels as a clockwise rectangle
            x0, x1, y1, y0 = start * UNIT, (prev + 1) * UNIT, (BASE - y) * UNIT, (BASE - y - 1) * UNIT
            pen.moveTo((x0, y0)); pen.lineTo((x0, y1)); pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
            if x is not None:
                start = prev = x
    outlines[name] = pen.glyph()
empty = TTGlyphPen(None).glyph()
outlines['.notdef'] = outlines['space'] = empty

fb = FontBuilder(1024, isTTF=True)
fb.setupGlyphOrder(names)
fb.setupCharacterMap(cmap)
fb.setupGlyf(outlines)
fb.setupHorizontalMetrics(metrics)
fb.setupHorizontalHeader(ascent=1024, descent=-256)
fb.setupNameTable({'familyName': 'WebCraft Pixel', 'styleName': 'Regular'})
fb.setupOS2(sTypoAscender=1024, sTypoDescender=-256, usWinAscent=1024, usWinDescent=256)
fb.setupPost()
fb.save(out)
print(out, len(glyphs), 'glyphs')
