/**
 * A stand-in for TaleSpire, so the Symbiote can be driven in a browser.
 *
 * Everything the panel does inside the game happens through `TS`, and the game
 * is the one place it cannot be watched. This mimics the parts that matter,
 * including the two that caused real bugs:
 *
 *   - `TS` exists immediately but answers nothing until `hasInitialized` is
 *     announced, which is what made the asset list come back empty.
 *   - Failures are returned as `{ cause }`, not thrown.
 *   - Tiles and props come back keyed by id rather than listed, only the short
 *     first description carries a pack's name, and a piece's bounds are
 *     `{ width, height, depth }`, already halved. This stand-in once guessed
 *     all three wrong, and the panel passed here while showing no palette in
 *     the game — so these shapes are copied from what TaleSpire really said.
 *
 * Load it before app.js. Add `?noevent` to the URL to withhold the event and
 * check that probing for a working call gets there anyway.
 */

(function () {
  const withholdEvent = location.search.includes("noevent");
  let ready = false;
  let blob = "";
  let packs = null;

  window.__handed = [];
  const guard = (value) => (ready ? value : { cause: "notInitialized" });

  // Four quarters, so a window cut onto the wrong one is visible at a glance.
  const ATLAS =
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'>" +
        "<rect width='64' height='64' x='0' y='0' fill='#7f1d1d'/>" +
        "<rect width='64' height='64' x='64' y='0' fill='#14532d'/>" +
        "<rect width='64' height='64' x='0' y='64' fill='#1e3a8a'/>" +
        "<rect width='64' height='64' x='64' y='64' fill='#78350f'/></svg>"
    );

  const FRAGMENTS = [
    { id: "a", optionalName: "Medieval Fantasy" },
    { id: "b", optionalName: "Cyberpunk and Sci-fi" },
  ];

  async function buildPacks() {
    const raw = await (await fetch("/js/catalog.json")).json();
    const element = (bundleId) => (asset) => ({
      id: asset.id,
      name: asset.name,
      isDeprecated: false,
      groupTag: asset.tags[0] ? `Group ${asset.tags[0]}` : "",
      tags: asset.tags,
      assets: [{ bundleId, assetName: asset.id }],
      colliderBoundsBound: {
        center: { locId: 22, x: 0.5, y: asset.height / 2, z: 0.5 },
        width: asset.footprint[0] / 2,
        height: asset.height / 2,
        depth: asset.footprint[1] / 2,
      },
      // A stand-in atlas, so the code that cuts an icon out of one runs here
      // too. Without it every card falls back to a letter and a window sized
      // wrong for its box is something only the game ever shows.
      icon: {
        atlas: { path: ATLAS, resolution: { width: 128, height: 128 } },
        region: { x: 0.25, y: 0.5, width: 0.25, height: 0.25 },
      },
    });
    // A second pack, so the tick-list has something to choose between and the
    // sci-fi default can be seen doing its job.
    const other = raw.slice(0, 40).map((a) => ({ ...a, id: a.id.replace(/^./, "f") }));
    // Keyed by id, nameless, and with no id of its own: what the game returns.
    const byId = (list, bundleId) =>
      Object.fromEntries(list.map(element(bundleId)).map((e) => [e.id, e]));
    const pack = (bundleId, list) => ({
      optionalName: null,
      tiles: byId(list.filter((a) => a.kind === "Tiles"), bundleId),
      props: byId(list.filter((a) => a.kind === "Props"), bundleId),
      creatures: {},
      music: {},
    });
    return [pack("a", raw), pack("b", other)];
  }

  window.TS = {
    clients: { whoAmI: async () => guard({ id: "me" }) },
    contentPacks: {
      getContentPacks: async () => guard(FRAGMENTS),
      getMoreInfo: async () => {
        if (!ready) return { cause: "notInitialized" };
        packs = packs || (await buildPacks());
        return packs;
      },
      createThumbnailElementForBoardObject: async (element, size) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size || 64;
        const context = canvas.getContext("2d");
        let hue = 0;
        for (const character of element.id) hue = (hue * 31 + character.charCodeAt(0)) % 360;
        context.fillStyle = `hsl(${hue} 45% 35%)`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#fff";
        context.font = "16px sans-serif";
        context.textAlign = "center";
        context.fillText(element.name.slice(0, 2), canvas.width / 2, canvas.height / 2 + 6);
        return canvas;
      },
    },
    slabs: {
      getMaxSlabSizeInBytes: async () => 30720,
      sendSlabToHand: async (code) => {
        window.__handed.push(code);
      },
    },
    localStorage: {
      global: {
        getBlob: async () => blob,
        setBlob: async (text) => { blob = text; },
        deleteBlob: async () => { blob = ""; },
      },
    },
    debug: { log: console.log },
  };

  setTimeout(() => {
    ready = true;
    if (!withholdEvent && window.onSymbioteStateChange) {
      window.onSymbioteStateChange({ kind: "hasInitialized" });
    }
  }, 1200);
})();
