# Planogram Studio: developer handoff

A clickable prototype of a planogram editor for the Salesbox SFA product (FMCG distribution). Merchandisers draw store fixtures to scale, place SKUs on the shelves, and export the layout as JSON. Field reps can later compare the real shelf against it.

## What's in this folder

| File | What it is |
|---|---|
| `README.md` | This document: features, data model, rules, open questions |
| `planogram.schema.json` | JSON Schema of the export file (v1) |
| `sample-planogram.json` | A real export of the demo layout: 5 fixtures, 41 placements, 273 facings |
| `source/Main.dc.html` | Prototype source. All logic is in the `class Component` script at the bottom of the file |

The prototype runs inside the Claude Design canvas runtime (`<x-dc>` templates, `{{holes}}`, `<sc-for>`, `<sc-if>`). It won't run on its own. Treat it as a reference implementation: the geometry, snapping and compliance logic in the script is plain JavaScript and can be ported as-is. Ask Mukhtar for the live prototype link to click through it.

## Features to rebuild

**Fixtures (shelf types).** Six types, each with its own default size and look:

| type | Name | Default W×H cm | Shelves | Special behaviour |
|---|---|---|---|---|
| `gantry` | Tobacco gantry | 120×190 | 8 | 6 cm pusher lanes, header sign |
| `cabinet` | Tobacco cabinet | 90×70 | 3 | 6 cm lanes, optional "doors closed" overlay |
| `gondola` | Gondola shelf | 100×200 | 5 | Free placement, side uprights |
| `cooler` | Beverage cooler | 70×200 | 4 | Glass door overlay, lightbox header |
| `impulse` | Checkout rack | 45×140 | 5 | Wire shelves |
| `pegboard` | Pegboard · hooks | 60×150 | 4 rails | `hanging: true`, so products hang below rails |

Editable per fixture: name, width, height, depth, base, header, board thickness and lane width. You can add or remove shelves, set each shelf's height, space them evenly, duplicate the fixture, delete it, or clear all its SKUs. Shelves and fixtures can also be moved by dragging.

**SKUs.** A library with category filter and search. Drag a SKU onto a shelf, or click it to append it to the selected shelf. Each placement has facings, a pack size override and an x position. Each SKU has one front photo, and each placement has its own photo framing (fit, zoom, offset), which can be copied to all placements of that SKU.

**Canvas.** Drawn to scale (zoom = px per cm). Drag a pack to move it between shelves or fixtures. The side handle changes facings and the corner handle resizes the pack. Shelf labels show height and clearance.

**Summary and checks.** Fixture count, SKUs placed, facings, shelf fill %, share of shelf by category (linear cm), and a compliance list (rules below).

**Export/Import.** JSON v1 in the format in `planogram.schema.json`.

## Data model

```
Planogram { name, fixtures[], skus[], placements[] }
Fixture   { id, type, x, width, height, depth, base, header, boardThickness, laneWidth, hanging, doorsClosed, shelves[] }
Shelf     { id, y }                      // y = height of board bottom from floor; sorted bottom→top
Sku       { id, code, name, category, width, height, photo }
Placement { id, fixtureId, shelfId, skuId, x, facings, packWidth, packHeight, photoFraming }
```

Everything is in centimetres. Every fixture stands on the same floor line (bottom = 0).

## Geometry rules (from `source/Main.dc.html`)

- **Facing pitch:** if `laneWidth > 0`, `pitch = ceil(packWidth / laneWidth) × laneWidth`, otherwise `pitch = packWidth`. The pack is drawn centred in its pitch.
- **Occupied width** = `pitch × facings`.
- **Vertical position:**
  - Standing shelf: pack bottom = `shelf.y + boardThickness`.
  - Hook rail: pack top = `rail.y`, so pack bottom = `rail.y − packHeight`.
- **Clearance** of a shelf = next shelf's `y` (or `height − header` for the top shelf) − (`y + boardThickness`).
- **Drop snapping** (function `place()`):
  - Target fixture = the one under the pointer.
  - Standing shelf = the highest board top that is below the pack's centre.
  - Hook rail = the rail nearest the pack's top.
  - x is snapped to whole lanes (or 0.5 cm without lanes) and clamped inside the fixture.
- **Fill %** per shelf = min(width, Σ occupied) / width, averaged over shelves.

## Compliance checks

A placement is flagged when any of these is true:

1. Standing shelf: `packHeight > clearance` (too tall for the shelf).
2. Hook rail: pack bottom is below the next rail's top, or below the fixture base.
3. `x + occupiedWidth > fixture.width` (runs past the edge).
4. It overlaps the next placement on the same shelf.

## Not in the prototype yet (suggested backlog)

1. Persistence: a backend store, planogram per store or store format, and versioning.
2. Linking `sku.code` to the Salesbox SKU catalogue, so pack sizes and photos come from master data.
3. Photo storage as uploaded files instead of `data:` URLs (these make exports heavy).
4. Mobile view for field reps: show the planogram, take a shelf photo, mark compliance.
5. Undo/redo, multi-select, keyboard nudging, copying a planogram between stores.
6. Print/PDF output per fixture with a facings list.

## Open questions for product

- Are planograms assigned per store, per store cluster/format, or per client (distributor)?
- Do tobacco displays need to be closed by default in some markets?
- Which KPIs should SFA report: share of shelf, OOS, facings compliance?
