# DungeonSlabForge

This is a tool to convert top down dungeon maps into multiple slabs, to use as a
starting point for adapting maps into TaleSpire.

Works best on transparent PNGs, or on dark backgrounds using the background
remover.

## How it goes

1. **Give it a map.** Copy a picture and press Ctrl+V in the panel. TaleSpire
   keeps the focus when a file dialog opens, so pasting is the way in that never
   leaves the game.
2. **Set the scale.** It measures the grid itself and shows you where it thinks
   the squares are; nudge the pivot until the two line up.
3. **Read the map.** Instantly, and with no AI: floors keep their cells, walls
   are found on the boundaries between them.
4. **Choose the palette.** Every label starts on an automatic pick and every one
   can be changed, searching every tile and prop in the packs you own, with the
   game's own icons. Give a label several pieces and the map draws from all of
   them, so a floor stops repeating.
5. **Take the slabs.** The build is drawn out with a button standing on each
   section. Click one to take it in hand, then place it. Placing needs GM mode.

## Worth knowing

- Your map never leaves your machine. Everything runs in the panel.
- The asset list is read from the packs you actually own, so a slab can only
  ever name something you have.
- The background remover downloads a segmentation model the first time you use
  it. That is the only thing here that reaches the internet.
- What it makes is a starting point, not a finished board — it lays the floors,
  walls, doors and scatter, and the rest is yours.
