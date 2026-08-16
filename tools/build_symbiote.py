"""Build the TaleSpire Symbiote from the same sources as the web page.

A Symbiote's own files are served over ``talespire://symbiote/``, a scheme of
TaleSpire's making. Nothing says that ES modules load over it, or that fetching
a file next to the page works — and if either does not, the whole app dies at
load with nothing to show for it. So the Symbiote gets a build rather than a
copy: every module is folded into one classic script, and the data the page
would fetch is written into it.

That is not just caution. The result can be opened straight off disk over
``file://``, which forbids both, so the thing that proves the bundle stands on
its own is a browser you already have.

    python tools/build_symbiote.py

Writes symbiote/DungeonSlabForge/, ready to copy into TaleSpire's Symbiotes
directory.
"""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS = ROOT / "js"
ASSETS = ROOT / "assets"
OUT = ROOT / "symbiote" / "DungeonSlabForge"

ENTRY = "app"

MANIFEST = {
    "manifestVersion": 1,
    "name": "DungeonSlabForge",
    "entryPoint": "/index.html",
    "version": "0.1.0",
    "summary": "Turn a battlemap image into TaleSpire slabs, without leaving the game.",
    "descriptionFilePath": "/description.md",
    # The library shows the first beside the Symbiote; the second is drawn as a
    # monochrome mask, so it is a shape rather than a picture.
    "icons": {"64x64": "/icon-64.png", "notification": "/icon-24.png"},
    "license": "MIT",
    "about": {
        "website": "https://github.com/evolJoaoBento/DungeonSlabForge",
        "authors": ["João Bento"],
    },
    # TS existing is not the same as TS being callable: the connection to the
    # game is announced by a hasInitialized event, and the event only arrives
    # if the manifest subscribes to it. Without this the asset list comes back
    # empty and the palette has nothing in it.
    "api": {
        "version": "0.1",
        "initTimeout": 30,
        "subscriptions": {"symbiote": {"onStateChangeEvent": "onSymbioteStateChange"}},
    },
    "environment": {
        "webViewBackgroundColor": "#0b0c0f",
        # A link would otherwise replace the app with whatever it points at.
        "loadTargetBehavior": "popup",
    },
}

STATIC_IMPORT = re.compile(
    r'^import\s+(?:\*\s+as\s+(?P<ns>[\w$]+)|\{(?P<names>[^}]*)\})'
    r'\s+from\s+"\./(?P<module>[\w.-]+)\.js";?[ \t]*$',
    re.M,
)
DYNAMIC_IMPORT = re.compile(
    r'import\(\s*(?:/\*.*?\*/\s*)?"\./(?P<module>[\w.-]+)\.js"\s*\)'
)
EXPORT_AT_LINE_START = re.compile(r"^export\s+", re.M)
DECLARED = re.compile(
    r"^export\s+(?:async\s+)?(?P<keyword>function|class|const|let|var)\s+", re.M
)


def split_top_level(text: str) -> list[str]:
    """Split on commas that are not inside brackets, quotes or a template."""
    parts: list[str] = []
    depth = 0
    quote: str | None = None
    start = 0
    index = 0
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(text[start:index])
            start = index + 1
        index += 1
    parts.append(text[start:])
    return parts


def statement_end(text: str, start: int) -> int:
    """Where the declaration beginning at ``start`` finishes."""
    depth = 0
    quote: str | None = None
    index = start
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == ";" and depth == 0:
            return index
        elif char == "\n" and depth == 0:
            return index
        index += 1
    return len(text)


def exported_names(source: str) -> list[str]:
    """Every name the module exports, in the order they are declared."""
    names: list[str] = []
    for match in DECLARED.finditer(source):
        after = match.end()
        if match.group("keyword") in ("function", "class"):
            identifier = re.match(r"[\w$]+", source[after:])
            if identifier:
                names.append(identifier.group())
            continue
        # const and friends can declare several names in one statement.
        body = source[after : statement_end(source, after)]
        for part in split_top_level(body):
            identifier = re.match(r"\s*([\w$]+)\s*(?:=|$)", part)
            if identifier:
                names.append(identifier.group(1))
    # Keep the first mention of each; a split can find a name twice.
    seen: dict[str, None] = {}
    for name in names:
        seen.setdefault(name, None)
    return list(seen)


def imports_of(source: str) -> list[str]:
    found = [m.group("module") for m in STATIC_IMPORT.finditer(source)]
    found += [m.group("module") for m in DYNAMIC_IMPORT.finditer(source)]
    return found


def read(module: str) -> str:
    return (JS / f"{module}.js").read_text(encoding="utf-8")


def order_modules(entry: str) -> list[str]:
    """Every module the entry needs, each one before whatever needs it."""
    ordered: list[str] = []
    visiting: set[str] = set()

    def visit(module: str) -> None:
        if module in ordered:
            return
        if module in visiting:
            raise SystemExit(f"{module}.js is part of an import cycle.")
        visiting.add(module)
        for needed in imports_of(read(module)):
            visit(needed)
        visiting.discard(module)
        ordered.append(module)

    visit(entry)
    return ordered


def rewrite(source: str) -> str:
    """A module's body as plain script: no import statements, no export keyword."""

    def as_local(match: re.Match[str]) -> str:
        module = match.group("module")
        if match.group("ns"):
            return f'const {match.group("ns")} = __module.{module};'
        return f'const {{{match.group("names")}}} = __module.{module};'

    source = STATIC_IMPORT.sub(as_local, source)
    source = DYNAMIC_IMPORT.sub(r"Promise.resolve(__module.\g<module>)", source)
    return EXPORT_AT_LINE_START.sub("", source)


def indent(text: str) -> str:
    return "\n".join(("  " + line if line.strip() else line) for line in text.split("\n"))


def bundle() -> str:
    modules = order_modules(ENTRY)
    themes = json.loads((JS / "themes.json").read_text(encoding="utf-8"))

    pieces = [
        "/* Generated by tools/build_symbiote.py — edit js/ and rebuild. */",
        '"use strict";',
        "window.SLABFORGE_SYMBIOTE = true;",
        f"window.SLABFORGE_THEMES = {json.dumps(themes, separators=(',', ':'))};",
        "var __module = {};",
    ]
    for module in modules:
        source = read(module)
        body = rewrite(source)
        if module == ENTRY:
            pieces.append(f"(function () {{\n{indent(body)}\n}})();")
            continue
        names = exported_names(source)
        returned = ", ".join(names)
        pieces.append(
            f"__module.{module} = (function () {{\n{indent(body)}\n"
            f"  return {{ {returned} }};\n}})();"
        )
    return "\n\n".join(pieces) + "\n"


def page() -> str:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = html.replace('href="./css/style.css"', 'href="style.css"')
    html = html.replace('<script type="module" src="./js/app.js"></script>',
                        '<script src="app.js"></script>')
    if 'src="app.js"' not in html:
        raise SystemExit("index.html no longer loads ./js/app.js the expected way.")
    return html


def harness(html: str) -> str:
    """The built page with a stand-in for TaleSpire in front of it.

    Written one directory up rather than beside the real one: everything in the
    Symbiote's own folder is published with it, and a page that loads a mock of
    the game is scaffolding, not something to ship. From up here it reaches the
    same built files, and the folder below stays exactly what a player installs.
    """
    return (
        html.replace('href="style.css"', 'href="DungeonSlabForge/style.css"')
        .replace(
            '<script src="app.js"></script>',
            '<script src="/tools/mock_talespire.js"></script>\n'
            '<script src="DungeonSlabForge/app.js"></script>',
        )
    )


def main() -> None:
    for module in order_modules(ENTRY):
        source = read(module)
        if module != ENTRY and not exported_names(source):
            raise SystemExit(f"{module}.js exports nothing the bundler could find.")

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    script = bundle()
    html = page()
    (OUT / "app.js").write_text(script, encoding="utf-8")
    (OUT / "index.html").write_text(html, encoding="utf-8")
    shutil.copy(ROOT / "css" / "style.css", OUT / "style.css")
    (OUT / "manifest.json").write_text(
        json.dumps(MANIFEST, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    # What the library shows about the Symbiote before anyone installs it.
    for name in ("description.md", "icon-64.png", "icon-24.png"):
        source = ASSETS / name
        if not source.exists():
            raise SystemExit(f"{source} is missing; run tools/build_icons.py.")
        shutil.copy(source, OUT / name)

    # Scaffolding, so it goes outside the folder that gets published.
    (OUT.parent / "harness.html").write_text(harness(html), encoding="utf-8")

    print(f"wrote {OUT}")
    print(f"  app.js      {len(script) / 1024:.0f} KB, {len(order_modules(ENTRY))} modules")
    print("  index.html, style.css, manifest.json")
    print("  description.md, icon-64.png, icon-24.png")
    print(f"  {OUT.parent / 'harness.html'} — the same page with a stand-in for TaleSpire")


if __name__ == "__main__":
    main()
