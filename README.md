# DungeonSlabForge

Turn a battlemap image into TaleSpire slabs, in your browser.

**[Open it →](https://evoljoaobento.github.io/DungeonSlabForge/)**

Everything runs in the tab. There is no server, so there is nowhere for your map
to be uploaded to — the picture, the reading and the slab codes never leave your
machine.

## What it does

1. **Takes a map image**, and optionally cuts the background out with a
   segmentation model that runs in WebAssembly.
2. **Finds the scale**, including where the grid starts — not every map is drawn
   with its first square flush against the corner.
3. **Reads the map** into floors, walls and water. Instant, free, no AI.
4. **Picks a palette**, with a swap for every label.
5. **Builds slabs** you click to copy and paste straight into TaleSpire — or, as
   a [Symbiote](#inside-talespire), takes straight into your hand in game.

The asset list ships with the page — 2025 fantasy assets, 90 KB compressed —
so there is nothing to set up first. It is the Medieval Fantasy pack only: a
dungeon has no use for a cyberpunk one, and leaving it in means a search for a
crate can answer with a sci-fi crate.

`tools/build_catalog.py` regenerates it from an installed copy after a game
update, and `--skip <pack>` is how a pack is left out:

```sh
python tools/build_catalog.py --skip cyberpunk_and_sci-fi
```

## Inside TaleSpire

The same thing runs as a Symbiote, in a panel in the game, so a map goes from
picture to placed without alt-tabbing.

Copy `symbiote/DungeonSlabForge` into TaleSpire's `Symbiotes` directory:

```
C:\Program Files (x86)\Steam\steamapps\common\TaleSpire\Symbiotes\DungeonSlabForge
```

Two things change when it runs there:

- **The asset list is yours.** Instead of the list shipped with the page, it
  reads every pack you actually own out of `TS.contentPacks`, so a slab can only
  name something you have. A tick-list appears for choosing between them, with
  sci-fi packs off to begin with.
- **A finished section goes into your hand**, not to the clipboard. Click it and
  place it. TaleSpire only allows that in GM mode, and says so if you are not.

TaleSpire cannot place tiles for you — the API deliberately has no way to write
to a board — so the last step is still yours. What goes is the copying, the
pasting and the window switch.

`symbiote/` is generated. Edit `js/` and rebuild:

```sh
python tools/build_symbiote.py
```

The build is not a copy. A Symbiote's files are served over
`talespire://symbiote/`, and nothing promises that ES modules load over that
scheme or that fetching a file next to the page works — so every module is
folded into one classic script and the theme data is written into it. Nothing is
fetched at startup. The upshot is that the build opens straight off disk over
`file://`, which forbids both, and that is how it is checked.

## How it reads a map

A wall on these maps is a band about a third of a cell wide drawn along the edge
of a floor. Read at cell resolution that band rounds up to a whole cell, which
costs the room a cell of floor and builds the wall twice as thick as it was
drawn — a corridor one cell wide becomes a corridor of solid wall.

So each cell is sampled on an 8×8 grid of its own, and walls come out on the
**boundaries between cells**, at half-cell positions, which the slab format
allows. Floors keep their cells.

Which tone is the wall is worked out per map rather than assumed: the wall is
whichever of the two lit tones lies closer to the backdrop, since a wall is
drawn around a floor and not the other way about.

## The slab format

The [published V2 spec](https://github.com/Bouncyrock/DumbSlabStats/blob/master/format.md)
contradicts itself on the field widths, so `js/slab.js` follows what a slab
TaleSpire accepts actually contains, read back out of one built by the reference
encoder:

| bits | field |
| --- | --- |
| 0–17 | x, in hundredths of a tile |
| 18–35 | **z**, the vertical axis |
| 36–53 | y |
| 54–58 | rotation, in fifteen-degree steps |

Note the order — the vertical axis sits in the middle, not at the end. The body
also ends with two zero bytes that the spec does not mention; without them a
reader comes up one placement short.

The encoder is checked against the reference decoder: the same placements go in
and come back out.

## What is not here

The AI annotation pass, which names doors and furniture the brightness pass
cannot see. That needs a model with a key, and a static page has nowhere safe to
keep one. It lives in the [desktop version](https://github.com/evolJoaoBento/slabforge),
which is the same reader with a local Claude gateway behind it.

## Running it locally

Any static server will do, because it is only static files:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000>. It needs a modern browser: `CompressionStream`
for gzip, and the File System Access parts for picking a folder.

## Support

If it saved you an evening of laying tiles by hand,
[buy me a coffee](https://buymeacoffee.com/joaobento).

## Licence

MIT, for the code.

TaleSpire and its asset packs belong to Bouncyrock. `js/catalog.json` is a list
of asset names, ids, tags and sizes taken from the Medieval Fantasy pack —
metadata only, no art, no meshes, nothing playable — included so the page works
without setup. If Bouncyrock would rather it were not here, say so and it goes.
