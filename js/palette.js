/**
 * Choosing what each label is built from.
 *
 * A theme names its tiles in words — "stone dungeon tile" — and the catalog
 * ranks a few thousand assets against that. It is a good first guess and a poor
 * last word: the ranking cannot know that this dungeon wants flagstones, and a
 * name in a list tells nobody what a piece looks like.
 *
 * So the picks are shown as the game's own icons, and changing one opens the
 * whole asset list — all of it, not a hundred of it — narrowed by the set a
 * piece belongs to, by how much floor it covers, and by whether it is a tile or
 * a prop. Inside TaleSpire the icons are real; on the web there is no art to
 * draw, so a card falls back to its name.
 *
 * A label may hold more than one piece. Given several it draws from them by
 * position, so a room stops reading as wallpaper — see pickVariant in
 * layout.js, which does the drawing. Clicking a piece in the picker adds it to
 * the label or takes it away again; taking the last one away is the same as
 * asking for the automatic pick back.
 *
 * What is chosen is remembered per theme, because a palette worth building by
 * hand is worth having again on the next map.
 */

/** How many cards are added at a time as the results are scrolled. Three
 *  thousand buttons built in one go would lock the panel for a second; built a
 *  screenful ahead, nobody ever waits. */
const CHUNK = 60;

/** How big an icon is cut, per place a card appears. An icon is a window onto
 *  an atlas at a fixed size — it cannot be asked to shrink afterwards — so the
 *  size has to be the one the box is actually going to be. These match the two
 *  heights in the stylesheet. */
const ICON = { slot: 40, picker: 56 };

export function makePalette({ into, picker, onChange, thumbnail }) {
  let theme = null;
  let saved = {};
  let openLabel = null;
  let found = [];
  let drawn = 0;

  const $ = (selector) => picker.querySelector(selector);
  const searchBox = $(".picker-search");
  const kindBox = $(".picker-kind");
  const groupBox = $(".picker-group");
  const sizeBox = $(".picker-size");
  const results = $(".picker-results");
  const title = $(".picker-title");
  const count = $(".picker-count");

  /** What a label draws from now, as ids. */
  const chosenIds = (label) => (theme.variants[label] || []).map((asset) => asset.id);

  /** An asset as a card: the game's icon if there is one, its name if not. */
  function card(asset, { chosen = false, onPick = null, onDrop = null, size = ICON.picker } = {}) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `asset-card${chosen ? " chosen" : ""}`;
    element.dataset.assetId = asset.id;
    element.title =
      `${asset.name} — ${asset.footprint[0]}×${asset.footprint[1]}` +
      `${asset.group ? `, ${asset.group}` : ""}, ${asset.pack}`;

    const art = document.createElement("span");
    art.className = "asset-art";
    // A card that never gets an icon keeps its initial.
    art.textContent = asset.name.slice(0, 1).toUpperCase();
    const icon = thumbnail(asset, size);
    if (icon) {
      art.textContent = "";
      art.appendChild(icon);
    }
    element.appendChild(art);

    const name = document.createElement("span");
    name.className = "asset-name";
    name.textContent = asset.name;
    element.appendChild(name);

    if (onPick) element.onclick = () => onPick(asset);
    if (onDrop) {
      // Its own button, so the card underneath still opens the picker.
      const drop = document.createElement("span");
      drop.className = "asset-drop";
      drop.textContent = "×";
      drop.title = `Stop using ${asset.name} here`;
      drop.onclick = (event) => {
        event.stopPropagation();
        onDrop(asset);
      };
      element.appendChild(drop);
    }
    return element;
  }

  /** The labels, each showing everything it draws from. */
  function draw() {
    into.replaceChildren();
    if (!theme) return;
    for (const label of Object.keys(theme.assets)) {
      const held = theme.variants[label] || [theme.assets[label]];
      const row = document.createElement("div");
      row.className = `label-slot${openLabel === label ? " open" : ""}`;

      const heading = document.createElement("b");
      heading.textContent = label;
      if (held.length > 1) {
        const many = document.createElement("small");
        many.textContent = ` ${held.length}`;
        heading.appendChild(many);
      }
      row.appendChild(heading);

      const shelf = document.createElement("div");
      shelf.className = "label-assets";
      for (const asset of held) {
        shelf.appendChild(
          card(asset, {
            size: ICON.slot,
            onPick: () => open(label),
            onDrop: held.length > 1 ? () => toggle(label, asset) : null,
          })
        );
      }

      const add = document.createElement("button");
      add.type = "button";
      add.className = "asset-card add";
      add.title = `Add another piece for ${label}`;
      add.textContent = "+";
      add.onclick = () => open(label);
      shelf.appendChild(add);

      row.appendChild(shelf);
      into.appendChild(row);
    }
  }

  /** The set and size lists, from whatever the ticked packs turned out to hold. */
  function fillFilters() {
    const groups = theme.catalog.groups;
    // The catalog shipped with the page does not carry the game's own sets, so
    // there is nothing to choose between and the control would only mislead.
    groupBox.hidden = !groups.length;
    groupBox.replaceChildren(option("", "Any set"), ...groups.map((g) => option(g, g)));
    sizeBox.replaceChildren(
      option("", "Any size"),
      ...theme.catalog.sizes.map((size) => option(size, size.replace("x", "×")))
    );
  }

  function option(value, text) {
    const element = document.createElement("option");
    element.value = value;
    element.textContent = text;
    return element;
  }

  function open(label) {
    openLabel = label;
    title.textContent = label;
    // Seeded with the words the theme itself asked for. Its own shortlist is a
    // filter, not a ranking — for a label pinned to one name that is a picker
    // with one thing in it — whereas the same words put through the ranking are
    // the pieces the automatic pick chose between, best first. Showing them in
    // the box also says plainly what the theme asked for.
    const query = theme.queries[label] || {};
    searchBox.value = query.search || query.name || label.replace(/_/g, " ");
    kindBox.value = query.kind || "";
    groupBox.value = "";
    sizeBox.value = "";
    picker.hidden = false;
    fill();
    draw();
    searchBox.focus();
    picker.scrollIntoView({ block: "nearest" });
  }

  function close() {
    openLabel = null;
    picker.hidden = true;
    found = [];
    drawn = 0;
    results.replaceChildren();
    draw();
  }

  /** What the search shows: the whole catalog, narrowed, ranked, all of it. */
  function fill() {
    if (!openLabel || !theme) return;
    found = theme.catalog.search(searchBox.value.trim(), {
      kind: kindBox.value || null,
      group: groupBox.value || null,
      size: sizeBox.value || null,
    });
    if (!found.length) {
      // Words that match nothing would otherwise leave an empty box with no way
      // back to the pieces this label could actually use.
      found = theme
        .alternativesFor(openLabel)
        .filter((asset) => !kindBox.value || asset.kind === kindBox.value);
    }
    count.textContent = `${found.length} found`;
    drawn = 0;
    results.replaceChildren();
    results.scrollTop = 0;
    more();
  }

  /**
   * Another chunk of cards, and enough of them to fill the box.
   *
   * Drawn on scrolling rather than watched for: a Symbiote runs in a webview
   * that is nobody's idea of a browser, and a scroll position is arithmetic
   * where an IntersectionObserver is a promise the host has to keep. The loop
   * matters as much as the handler — a wide panel shows four chunks at once,
   * and something that only ever draws one can never be scrolled to ask for
   * the second.
   */
  function more() {
    if (!openLabel) return;
    const chosen = new Set(chosenIds(openLabel));
    let guard = 0;
    do {
      const slice = found.slice(drawn, drawn + CHUNK);
      if (!slice.length) return;
      drawn += slice.length;
      results.append(
        ...slice.map((asset) =>
          card(asset, {
            chosen: chosen.has(asset.id),
            onPick: (picked) => toggle(openLabel, picked),
          })
        )
      );
    } while (drawn < found.length && results.scrollHeight <= results.clientHeight && ++guard < 50);
  }

  results.addEventListener("scroll", () => {
    if (drawn >= found.length) return;
    const left = results.scrollHeight - results.scrollTop - results.clientHeight;
    if (left < 200) more();
  });

  /**
   * Add a piece to a label, or take it away again.
   *
   * Taking the last one away is not an empty label — there is no such thing —
   * but a request for the automatic pick back, which is the only other answer
   * that means anything.
   */
  function toggle(label, asset) {
    const ids = chosenIds(label);
    const at = ids.indexOf(asset.id);
    const next = at === -1 ? [...ids, asset.id] : ids.filter((id) => id !== asset.id);

    if (!next.length) return automatic(label);
    theme = theme.withVariants(label, next);
    // Written back from the theme rather than from the click, so an id that no
    // longer names anything is not saved again.
    saved[theme.name] = { ...(saved[theme.name] || {}), [label]: chosenIds(label) };
    onChange(theme, saved);
    // Only the rings change, never the list: searching again would throw the
    // scroll back to the top, and picking four pieces for one label is exactly
    // when that happens four times.
    markChosen();
    draw();
  }

  /** Ring whatever the open label now draws from, wherever it is on screen. */
  function markChosen() {
    if (!openLabel) return;
    const chosen = new Set(chosenIds(openLabel));
    for (const element of results.children) {
      element.classList.toggle("chosen", chosen.has(element.dataset.assetId));
    }
  }

  /** Forget what was chosen for a label; the theme's own words decide again. */
  function automatic(label) {
    const mine = saved[theme.name];
    if (mine) delete mine[label];
    onChange(null, saved); // asks for the theme to be resolved afresh
  }

  const rerun = () => fill();
  searchBox.addEventListener("input", () => {
    clearTimeout(searchBox.timer);
    searchBox.timer = setTimeout(fill, 120);
  });
  kindBox.addEventListener("change", rerun);
  groupBox.addEventListener("change", rerun);
  sizeBox.addEventListener("change", rerun);
  $(".picker-close").addEventListener("click", close);
  $(".picker-reset").addEventListener("click", () => {
    if (openLabel) automatic(openLabel);
  });

  return {
    /** Show a theme, applying whatever was chosen for it before. */
    show(next, remembered) {
      saved = remembered;
      theme = next;
      const mine = saved[next.name] || {};
      for (const [label, held] of Object.entries(mine)) {
        if (!next.assets[label]) continue;
        // Palettes saved before a label could hold more than one piece named a
        // single id. Read either way round; it is written back as a list.
        const ids = Array.isArray(held) ? held : [held];
        try {
          theme = theme.withVariants(label, ids);
        } catch {
          // The pack that had them is no longer ticked; the automatic pick stands.
          delete mine[label];
        }
      }
      fillFilters();
      close(); // which draws the labels
      return theme;
    },
  };
}
