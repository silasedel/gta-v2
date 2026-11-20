#!/usr/bin/env python3
"""Contact sheet for Nico's part of intro v2: each storyboard panel's description next to the shots that answer it.

    python3 tools/v2/story/intro2_sheet.py [--out docs/v2/shots/intro2/sheet_nico.jpg]

Shots come from tools/v2/story/intro2_play.mjs --shots and tools/v2/story/intro2_camp_shots.mjs.
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

DIR = 'docs/v2/shots/intro2'

PANELS = [
    ('4  Switch to Nico', 'Nico with his associates on the Keys coast; a small plane and a motorboat.',
     ['intro2.switchNico.dock.png', 'intro2.switchNico.dock_b.png']),
    ('8  Smuggling run', 'White center-console boat across turquoise water, a low single-engine plane ahead.',
     ['intro2.smuggling_0_follow.png', 'intro2.smuggling_1_away.png']),
    ('9  Collect packages', 'Wrapped bales floating in the sea; the radio call: an associate taken by a gang.',
     ['intro2.packages_0_collect.png', 'intro2.packages.radio.png']),
    ('10 Swamp infiltration', 'Dense swamp, moss-hung cypress / oak, tall grass, stilted shack, porch, warm lamp, armed men.',
     ['intro2.swamp.arrival.png', 'camp_porch.png']),
    ('11 Rescue', 'Firefight across the camp: muzzle flashes, rusty barrels, a weathered red / grey shack; the associate tied up.',
     ['camp_fight_1.png', 'camp_inside.png']),
    ('12 Seaplane escape', 'White and red floatplane takes off from the water, spray, palms / stilt houses; fly home.',
     ['camp_dock.png', 'intro2.seaplane.liftoff.png']),
    ('   Job done, home', 'Paid on the dock at sunset; night at Nico\'s house, free roam.',
     ['intro2.seaplane.paid.png', 'intro2.home.night.png']),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(DIR, 'sheet_nico.jpg'))
    a = ap.parse_args()
    tw, th = 560, 315
    pad = 12
    text_w = 420
    rows = len(PANELS)
    W = text_w + 2 * (tw + pad) + pad
    H = rows * (th + pad) + pad
    sheet = Image.new('RGB', (W, H), (18, 18, 20))
    d = ImageDraw.Draw(sheet)
    try:
        big = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 26)
        small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 18)
    except OSError:
        big = small = ImageFont.load_default()
    for r, (title, desc, files) in enumerate(PANELS):
        y = pad + r * (th + pad)
        d.text((pad, y + 6), title, fill=(255, 210, 120), font=big)
        # wrap the description
        words, line, ly = desc.split(), '', y + 48
        for w in words:
            if d.textlength(line + ' ' + w, font=small) > text_w - 2 * pad:
                d.text((pad, ly), line, fill=(220, 220, 220), font=small)
                line, ly = w, ly + 24
            else:
                line = (line + ' ' + w).strip()
        d.text((pad, ly), line, fill=(220, 220, 220), font=small)
        for k, f in enumerate(files):
            x = text_w + pad + k * (tw + pad)
            p = os.path.join(DIR, f)
            if os.path.exists(p):
                im = Image.open(p).convert('RGB').resize((tw, th))
                sheet.paste(im, (x, y))
            else:
                d.rectangle([x, y, x + tw, y + th], outline=(90, 90, 90))
                d.text((x + 10, y + 10), 'missing: ' + f, fill=(200, 80, 80), font=small)
    sheet.save(a.out, quality=88)
    print(a.out)


if __name__ == '__main__':
    main()
