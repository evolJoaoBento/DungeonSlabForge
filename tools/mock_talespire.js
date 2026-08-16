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

  async function buildPacks() {
    const raw = await (await fetch("/js/catalog.json")).json();
    const element = (asset) => ({
      id: asset.id,
      name: asset.name,
      isDeprecated: false,
      tags: asset.tags,
      colliderBoundsBound: {
        extent: {
          x: asset.footprint[0] / 2,
          y: asset.height / 2,
          z: asset.footprint[1] / 2,
        },
      },
    });
    // A second pack, so the tick-list has something to choose between and the
    // sci-fi default can be seen doing its job.
    const other = raw.slice(0, 40).map((a) => ({ ...a, id: a.id.replace(/^./, "f") }));
    const pack = (id, name, list) => ({
      id,
      optionalName: name,
      tiles: list.filter((a) => a.kind === "Tiles").map(element),
      props: list.filter((a) => a.kind === "Props").map(element),
    });
    return [pack("a", "Medieval Fantasy", raw), pack("b", "Cyberpunk and Sci-fi", other)];
  }

  window.TS = {
    clients: { whoAmI: async () => guard({ id: "me" }) },
    contentPacks: {
      getContentPacks: async () => guard([{ id: "a" }, { id: "b" }]),
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
