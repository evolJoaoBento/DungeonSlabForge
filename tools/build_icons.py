"""Draw the Symbiote's icons.

Two are wanted, and they are not two sizes of one picture. The 64x64 sits beside
the Symbiote in the game's library, in colour, and says what the tool makes: a
dungeon seen from above, in the same stone and flagstone the panel paints a read
map in. The 24x24 is a notification badge, which is drawn as a monochrome mask —
colour in it is thrown away — so it is one white shape on nothing, and it has to
read at a size where a wall is two pixels.

That difference is why they are drawn from separate plans rather than one
scaled: at 24 pixels the flagstones, the door and the second room are all noise,
and what survives is a single room's outline.

    python tools/build_icons.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / "assets"

# The panel's own colours, so the icon and the thing it opens agree.
VOID = (11, 12, 15, 255)
FLOOR = (201, 185, 141, 255)
FLOOR_DARK = (176, 160, 120, 255)
WALL = (107, 114, 128, 255)
WALL_LIT = (139, 146, 160, 255)
DOOR = (180, 83, 9, 255)

# A hall, a corridor and a chamber, on a 16x16 grid: the smallest arrangement
# that reads as a dungeon rather than as a box. Each is (x, y, width, height).
HALL = (2, 1, 7, 5)
CHAMBER = (9, 9, 5, 5)
CORRIDOR = [(4, 6, 2, 3), (6, 7, 3, 2)]
FLAGSTONES = [(2, 1), (4, 2), (8, 1), (3, 4), (7, 5), (10, 10), (13, 13), (11, 12)]
DOORS = [(4, 6, 2, 1), (9, 9, 1, 1)]

# The badge's own plan, on a 12x12 grid: one room, one doorway, nothing else.
BADGE_ROOM = (2, 2, 8, 8)
# In the wall, not inside the room: the room's own cells are already empty, so a
# gap placed there is a gap in nothing.
BADGE_DOOR = (5, 10, 2, 1)


def blocks(pen, step, rects, fill):
    for x, y, w, h in rects:
        pen.rectangle([x * step, y * step, (x + w) * step - 1, (y + h) * step - 1], fill=fill)


def draw_colour(size: int, grid: int = 16) -> Image.Image:
    """The library icon: a lit dungeon on the panel's own near-black."""
    step = size // grid
    image = Image.new("RGBA", (size, size), VOID)
    pen = ImageDraw.Draw(image)

    rooms = [HALL, CHAMBER, *CORRIDOR]
    # Walls are a ring around everything the dungeon occupies, so they go down
    # first and the floor is cut back out of them.
    blocks(pen, step, [(x - 1, y - 1, w + 2, h + 2) for x, y, w, h in rooms], WALL)
    # The top edge catches the light, which is what stops a grey ring reading as
    # a smudge at small sizes.
    blocks(pen, step, [(x - 1, y - 1, w + 2, 1) for x, y, w, h in rooms], WALL_LIT)
    blocks(pen, step, rooms, FLOOR)
    blocks(pen, step, [(x, y, 1, 1) for x, y in FLAGSTONES], FLOOR_DARK)
    blocks(pen, step, DOORS, DOOR)
    return image


def draw_badge(size: int, grid: int = 12) -> Image.Image:
    """The notification icon: a room's wall, white on nothing, with a doorway.

    Filled solid it would be a blob, so it is the wall alone — the outline is
    the part that still says "room" when it is eleven pixels across.
    """
    step = size // grid
    image = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    pen = ImageDraw.Draw(image)
    x, y, w, h = BADGE_ROOM
    blocks(pen, step, [(x - 1, y - 1, w + 2, h + 2)], (255, 255, 255, 255))
    blocks(pen, step, [(x, y, w, h)], (255, 255, 255, 0))
    # A gap in the wall, which is what a door is when there is no room for one.
    blocks(pen, step, [BADGE_DOOR], (255, 255, 255, 0))
    return image


def a_font(size: int, bold: bool = False):
    """Whatever this machine has that is close enough, or nothing."""
    for name in (["seguisb.ttf", "segoeuib.ttf"] if bold else ["segoeui.ttf"]) + [
        "arialbd.ttf" if bold else "arial.ttf",
        "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_logo(width: int = 1280, height: int = 720) -> Image.Image:
    """The listing's banner: mod.io wants 16:9, and no smaller than 512x288.

    Drawn at the largest size it makes thumbnails from, so every one of them is
    a reduction rather than an enlargement. The dungeon sits to the right at a
    size where its doors and flagstones still tell, and the name to the left,
    because a listing is read at a fifth of this and the name has to survive it.
    """
    image = Image.new("RGBA", (width, height), VOID)
    pen = ImageDraw.Draw(image)

    # The same dungeon, drawn big enough to be scenery rather than an icon.
    plan = draw_colour(576, grid=16).resize((576, 576), Image.NEAREST)
    image.alpha_composite(plan, (width - 576 - 48, (height - 576) // 2))

    # It fades into the background rather than stopping at an edge, so the
    # picture reads as one thing at thumbnail size.
    fade = Image.new("RGBA", (200, height), (0, 0, 0, 0))
    for x in range(200):
        ImageDraw.Draw(fade).line(
            [(x, 0), (x, height)], fill=VOID[:3] + (int(255 * (1 - x / 200)),)
        )
    image.alpha_composite(fade, (width - 576 - 48, 0))

    pen.text((72, 250), "Dungeon", font=a_font(96, bold=True), fill=(231, 233, 238, 255))
    pen.text((72, 350), "SlabForge", font=a_font(96, bold=True), fill=(217, 154, 58, 255))
    pen.text(
        (76, 470),
        "Top-down maps into TaleSpire slabs,\nwithout leaving the game.",
        font=a_font(34),
        fill=(152, 160, 174, 255),
        spacing=10,
    )
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, image in [
        ("icon-64.png", draw_colour(64)),
        ("icon-24.png", draw_badge(24)),
        ("logo-1280x720.png", draw_logo()),
    ]:
        image.save(OUT / name)
        print(f"wrote {OUT / name}  {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()
