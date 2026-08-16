"""Rebuild the bundled asset catalog from an installed copy of TaleSpire.

The page ships a catalog so it works the moment it loads, rather than asking
everyone to go hunting for index.json before they can do anything. That file is
generated, not hand-written, and this is what generates it: run it after a
TaleSpire update and commit the result.

Only what the page uses is kept. The search ranking needs the name and the
tags, the tie-break needs the footprint, and the layout needs the height —
everything else in a pack index is for the game, not for us.

    python tools/build_catalog.py                     # find TaleSpire itself
    python tools/build_catalog.py "D:\\...\\Taleweaver"  # or say where it is
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "js" / "catalog.json"

CANDIDATES = (
    r"C:\Program Files (x86)\Steam\steamapps\common\TaleSpire",
    r"C:\Program Files\Steam\steamapps\common\TaleSpire",
    r"D:\SteamLibrary\steamapps\common\TaleSpire",
    r"E:\SteamLibrary\steamapps\common\TaleSpire",
)

KINDS = ("Tiles", "Props")


def parse_arguments(argv: list[str]) -> tuple[str | None, set[str]]:
    """The path to look in, and the packs to leave out of what is found."""
    where: str | None = None
    skip: set[str] = set()
    rest = list(argv)
    while rest:
        argument = rest.pop(0)
        if argument == "--skip":
            if not rest:
                raise SystemExit("--skip needs the name of a pack.")
            skip.add(rest.pop(0).strip().lower())
        elif where is None:
            where = argument
        else:
            raise SystemExit(f"Did not expect {argument!r}.")
    return where, skip


def find_taleweaver(argument: str | None) -> Path:
    if argument:
        given = Path(argument)
        return given if given.name == "Taleweaver" else given / "Taleweaver"
    for candidate in CANDIDATES:
        weaver = Path(candidate) / "Taleweaver"
        if weaver.is_dir():
            return weaver
    raise SystemExit(
        "Could not find TaleSpire. Pass the path to its Taleweaver folder."
    )


def read_pack(index: Path) -> tuple[str, list[dict]]:
    data = json.loads(index.read_text(encoding="utf-8"))
    # Each pack drops a readable marker beside its index; the folder itself is
    # a uuid, which tells nobody anything.
    marker = next(iter(sorted(index.parent.glob("*.packName"))), None)
    pack = marker.stem if marker else data.get("Name", index.parent.name)

    assets = []
    for kind in KINDS:
        for raw in data.get(kind, ()):
            if raw.get("IsDeprecated"):
                continue
            extent = raw.get("ColliderBoundsBound", {}).get("m_Extent", {})
            # A pack index is Unity data, where y is up; the slab format puts
            # the vertical axis on z. The swap happens here, once.
            assets.append(
                {
                    "id": raw["Id"],
                    "name": raw["Name"],
                    "kind": kind,
                    "pack": pack,
                    "tags": sorted(t.lower() for t in raw.get("Tags", ())),
                    "footprint": [
                        round(extent.get("x", 0.5) * 2, 2),
                        round(extent.get("z", 0.5) * 2, 2),
                    ],
                    "height": round(extent.get("y", 0.5) * 2, 2),
                }
            )
    return pack, assets


def main() -> None:
    where, skip = parse_arguments(sys.argv[1:])
    weaver = find_taleweaver(where)
    everything: list[dict] = []
    for index in sorted(weaver.glob("*/index.json")):
        pack, assets = read_pack(index)
        if pack.lower() in skip:
            print(f"  {pack:24} {len(assets):5} assets  (left out)")
            continue
        print(f"  {pack:24} {len(assets):5} assets")
        everything.extend(assets)

    if not everything:
        raise SystemExit(f"No pack indexes under {weaver}.")

    everything.sort(key=lambda a: (a["name"].lower(), a["id"]))
    text = json.dumps(everything, separators=(",", ":"))
    OUT.write_text(text, encoding="utf-8")
    print(
        f"\nwrote {OUT} — {len(everything)} assets, {len(text) / 1e6:.2f} MB "
        f"({len(gzip.compress(text.encode())) / 1e6:.2f} MB over the wire)"
    )


if __name__ == "__main__":
    main()
