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
5. **Builds slabs** you click to copy and paste straight into TaleSpire.

The asset list ships with the page — 2875 assets from the packs TaleSpire
itself comes with, 130 KB compressed — so there is nothing to set up first.
`tools/build_catalog.py` regenerates it from an installed copy after a game
update.

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
of asset names, ids, tags and sizes taken from the packs the game ships with —
metadata only, no art, no meshes, nothing playable — included so the page works
without setup. If Bouncyrock would rather it were not here, say so and it goes.
