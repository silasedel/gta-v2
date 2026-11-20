# Target | game side-by-side for the front door view.
#   python3 tools/v2/keys/frontdoor/sheet.py <set>  -> docs/v2/shots/house_front_nov19/<set>_sheet.jpg
import os
import sys

from PIL import Image, ImageDraw

SET = sys.argv[1]
OUT = "docs/v2/shots/house_front_nov19/"
TARGET = "docs/v2/plan/nico_house/front_door_south_view_TARGET.webp"
H = 640

target = Image.open(TARGET).convert("RGB")
target = target.resize((int(target.width * H / target.height), H))
game = Image.open(OUT + f"{SET}_door.png").convert("RGB")
game = game.resize((int(game.width * H / game.height), H))

sheet = Image.new("RGB", (target.width + game.width + 10, H), "white")
sheet.paste(target, (0, 0))
sheet.paste(game, (target.width + 10, 0))
draw = ImageDraw.Draw(sheet)
draw.rectangle([0, 0, 220, 20], fill=(0, 0, 0))
draw.text((6, 4), "TARGET", fill=(255, 255, 0))
draw.rectangle([target.width + 10, 0, target.width + 230, 20], fill=(0, 0, 0))
draw.text((target.width + 16, 4), f"game {SET}", fill=(255, 255, 0))

top = OUT + f"{SET}_top.png"
if os.path.isfile(top):
    t = Image.open(top).convert("RGB")
    t = t.resize((int(t.width * H / t.height), H))
    full = Image.new("RGB", (sheet.width, H * 2 + 10), "white")
    full.paste(sheet, (0, 0))
    full.paste(t, (0, H + 10))
    sheet = full

sheet.save(OUT + f"{SET}_sheet.jpg", quality=86)
print("sheet", OUT + f"{SET}_sheet.jpg")
