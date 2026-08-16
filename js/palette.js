/**
 * Choosing what each label is built from.
 *
 * A theme names its tiles in words — "stone dungeon tile" — and the catalog
 * ranks a few thousand assets against that. It is a good first guess and a poor
 * last word: the ranking cannot know that this dungeon wants flagstones, and a
 * name in a list tells nobody what a piece looks like.
 *
 * So the picks are shown as a grid of the game's own icons, and changing one
 * opens a search over every asset in the packs, ranked the same way the theme
 * was. Inside TaleSpire the icons are real; on the web there is no art to draw,
 * so a card falls back to its name and footprint.
 *
 * A choice made here is remembered per theme, because a palette worth building
 * by hand is worth having again on the next map.
 */

const SHOWN = 120;

export function makePalette({ into, picker, onChange, thumbnail }) {
  let theme = null;
  let saved = {};
  let openLabel = null;

  const $ = (selector) => picker.querySelector(selector);
  const searchBox = $(".picker-search");
  const kindBox = $(".picker-kind");
  const results = $(".picker-results");
  const title = $(".picker-title");
  const count = $(".picker-count");

  /** An asset as a card: the game's icon if there is one, its name if not. */
  function card(asset, { chosen = false, onPick = null } = {}) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `asset-card${chosen ? " chosen" : ""}`;
    element.title = `${asset.name} — ${asset.footprint[0]}×${asset.footprint[1]}, ${asset.pack}`;

    const art = document.createElement("span");
    art.className = "asset-art";
    element.appendChild(art);

    const name = document.createElement("span");
    name.className = "asset-name";
    name.textContent = asset.name;
    element.appendChild(name);

    if (onPick) element.onclick = () => onPick(asset);

    // The icon arrives later, and a card that never gets one keeps its initial.
    art.textContent = asset.name.slice(0, 1).toUpperCase();
    Promise.resolve(thumbnail(asset)).then((node) => {
      if (!node) return;
      art.textContent = "";
      art.appendChild(node);
    });
    return element;
  }

  function draw() {
    into.replaceChildren();
    if (!theme) return;
    for (const [label, asset] of Object.entries(theme.assets)) {
      const row = document.createElement("div");
      row.className = `label-slot${openLabel === label ? " open" : ""}`;

      const heading = document.createElement("b");
      heading.textContent = label;
      row.appendChild(heading);
      row.appendChild(card(asset, { onPick: () => open(label) }));

      into.appendChild(row);
    }
  }

  function open(label) {
    openLabel = label;
    title.textContent = label;
    // Seeded with the words the theme itself asked for. Its own shortlist is a
    // filter, not a ranking — for a label pinned to one name that is a picker
    // with one thing in it — whereas the same words put through the ranking are
    // the hundred pieces the automatic pick chose between, best first. Showing
    // them in the box also says plainly what the theme asked for.
    const query = theme.queries[label] || {};
    searchBox.value = query.search || query.name || label.replace(/_/g, " ");
    kindBox.value = query.kind || "";
    picker.hidden = false;
    fill();
    draw();
    searchBox.focus();
    picker.scrollIntoView({ block: "nearest" });
  }

  function close() {
    openLabel = null;
    picker.hidden = true;
    draw();
  }

  /** What the search shows: the whole catalog, ranked, always. */
  function fill() {
    if (!openLabel || !theme) return;
    const typed = searchBox.value.trim();
    const kind = kindBox.value || null;
    let found = theme.catalog.search(typed, { kind, limit: SHOWN });
    if (!found.length) {
      // Words that match nothing would otherwise leave an empty box with no
      // way back to the pieces this label could actually use.
      found = theme.alternativesFor(openLabel).filter((a) => !kind || a.kind === kind);
    }

    const total = found.length;
    found = found.slice(0, SHOWN);
    count.textContent =
      total > SHOWN ? `${SHOWN} of ${total} — keep typing to narrow it` : `${total} found`;

    const chosen = theme.assets[openLabel];
    results.replaceChildren(
      ...found.map((asset) =>
        card(asset, {
          chosen: chosen && asset.id === chosen.id,
          onPick: (picked) => choose(openLabel, picked),
        })
      )
    );
  }

  function choose(label, asset) {
    theme = theme.withOverride(label, asset.id);
    saved[theme.name] = { ...(saved[theme.name] || {}), [label]: asset.id };
    onChange(theme, saved);
    fill();
    draw();
  }

  searchBox.addEventListener("input", () => {
    clearTimeout(searchBox.timer);
    searchBox.timer = setTimeout(fill, 120);
  });
  kindBox.addEventListener("change", fill);
  $(".picker-close").addEventListener("click", close);
  $(".picker-reset").addEventListener("click", () => {
    if (!openLabel) return;
    const wasSaved = saved[theme.name];
    if (wasSaved) delete wasSaved[openLabel];
    onChange(null, saved); // asks for the theme to be resolved afresh
  });

  return {
    /** Show a theme, applying whatever was chosen for it before. */
    show(next, remembered) {
      saved = remembered;
      theme = next;
      const mine = saved[next.name] || {};
      for (const [label, id] of Object.entries(mine)) {
        if (!next.assets[label]) continue;
        try {
          theme = theme.withOverride(label, id);
        } catch {
          // The pack that had it is no longer ticked; the automatic pick stands.
          delete mine[label];
        }
      }
      close();
      draw();
      return theme;
    },
  };
}
