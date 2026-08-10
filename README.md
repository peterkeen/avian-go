# avian

A collage front-end for the backyard [BirdNET-Go](https://github.com/tphakala/birdnet-go)
listener, served at [birdnet.keen.land/avian](https://birdnet.keen.land/avian).

Every bird BirdNET-Go has identified gets a kachō-e illustration, packed into a
nesting collage sized by how often it was heard. Clicking one opens a detail
card with its recordings (spectrograms rendered in-browser from the audio), a
Wikipedia blurb, and its detection history.

This is a port of [AvianVisitors](https://github.com/Twarner491/AvianVisitors)
by [teddy](https://theodore.net), which was written against BirdNET-Pi. The
rendering, layout, and illustrations are all his; what changed is the data
layer.

## What the port changed

AvianVisitors talked to a small PHP facade over BirdNET-Pi's `birds.db`.
BirdNET-Go has no PHP layer, so `public/apt.js` now calls its REST API
directly. The adapter near the top of that file reshapes `/api/v2` responses
into the records the original renderers already expected.

| AvianVisitors (PHP) | BirdNET-Go |
| --- | --- |
| `birdnet-api.php?action=stats` | `/dashboard/kpis` + summed species-summary windows |
| `?action=lifelist` | `/analytics/species/summary` over all time |
| `?action=recent&hours=N` | `/analytics/species/summary`, or `/detections` for windows under a day |
| `?action=firstseen` | `/analytics/species/detections/new` |
| `?action=timeseries` | `/analytics/time/daily` + `/species/diversity` + `/time/distribution/hourly` |
| `?action=species&sci=` | `/detections?species=` |
| `cutout.php?sci=` | bundled PNG, falling back to `/media/image/:name` |
| `recording.php?file=` | `/audio/:id` |
| `wiki.php?sci=` | `birdex-text.json`, built offline (see The Birdex) |
| 30s polling loop | `/detections/stream` (SSE), with a slow poll as fallback |

Two differences worth knowing about:

- **Clips are addressed by detection id, not filename.** BirdNET-Go keys audio
  on the numeric detection id, so every play path resolves an id first.
- **Sub-day windows read raw detections.** The analytics endpoints are
  day-granular, which would collapse 1H/12H/24H into "today", so those windows
  aggregate `/detections` client-side instead.

Dropped along the way: the admin overlay, settings panel, and menu drawer. They
drove BirdNET-Pi's systemd units and config files, none of which exist here.
This is a read-only view.

## Layout

```
public/
  index.html
  apt.js               # collage, atlas, birdex, modal, and the API adapter
  styles.css
  dims.json            # illustration dimensions, keyed by species slug
  masks.json           # alpha bitmasks for collage nesting + hit-testing
  birdex.json          # species metadata + typing (see The Birdex)
  birdex-text.json     # species descriptions, loaded on first display
  config-loader.js     # loads optional deployment-local config.js
  config.example.js    # documented configuration template
  assets/illustrations # 666 kachō-e PNGs (~419MB)
tools/
  build-birdex.py      # builds both birdex files; run by hand, output committed
  audit-types.py       # cross-checks badges against descriptions; reports only
  types.json           # guild / trait / element tables, by family + overrides
  aliases.json         # taxonomy fixups (lookup, runtime slug map, merges)
  roster-extra.txt     # species to include that have no bundled art
  overrides.json       # hand-written fields that beat every fetched source
```

`assets/illustrations` is most of the repo. Species without a bundled
illustration fall back to BirdNET-Go's image proxy.

## The Birdex

A numbered field guide over the illustration set. All 330 species hold a
permanent number. Ones this station has heard are *registered* and show their
plate, typing, stats, rarity and a description; the rest stay silhouetted at
`???` until heard, or until unlocked by hand. Silhouettes are drawn from
`masks.json`, so listing the full roster costs no requests against the 419MB
illustration directory.

Search matches name, scientific name, family, type and `#number`. Entries
deep-link as `#birdex/<slug>`.

### Typing

Each species has one **guild** (how it feeds) and any number of **traits** (how
it nests, forages, behaves), mapped from taxonomic family in `tools/types.json`
with per-species overrides. Family is a global signal, so birds outside this
roster's range type correctly without touching the table.

For added whimsy, a few birds also carry a hand-awarded **element** — fire,
ice, ghost — each with its own note explaining why that one earned it. They're
scarce on purpose so as not to overwhelm; the Black-backed Woodpecker is
fire-type because it moves into stands of freshly burned pine within a year of
a burn. Set `birdex.elementalWhimsy` to `false` to leave them out.

`tools/audit-types.py` cross-checks every entry's badges against its own
description and reports mismatches.

### Data

Built offline and committed, so the page makes **no third-party calls at all**;
the detail modal reads its description from here too.

| field | source |
| --- | --- |
| Avibase ID → species deep link | Wikidata `P2026` (97.9%) |
| IUCN Red List category | Wikidata `P141` (96.4%) |
| family | Wikidata `P171*` → `P225` (100%) |
| eBird code | Wikidata `P3444` (99.4%) |
| common name + description | Wikipedia extracts (100%, median ~186 words) |

**Avibase is never fetched** — it sits behind a Cloudflare challenge that 403s
everything including `/robots.txt`, so identifiers come from Wikidata and we
only link out.

Two files share a content stamp: `birdex.json` (~78KB, metadata and typing)
loads eagerly; `birdex-text.json` (~395KB, descriptions) loads on first
display. A stamp mismatch discards the text side rather than rendering it
against the wrong roster.

The roster is 330, not 333 — three species are filed under both their old and
new genus and are merged, so either name registers the same entry. The build
fails on duplicate Avibase IDs or eBird codes without a declared merge, on
renumbering, and on coverage regressions.

```sh
python3 tools/build-birdex.py                # fetch only what's new
python3 tools/build-birdex.py --report       # list incomplete entries
python3 tools/build-birdex.py --refresh SLUG # refetch one species
python3 tools/audit-types.py                 # badges vs. descriptions
```

To add a bird, append a scientific name to `tools/roster-extra.txt` and
rebuild. Only new names are fetched; dex numbers never change.

## Customizing a deployment

`public/config.js` is optional. If it does not exist—or returns 404—the built-in
defaults are used. Copy `public/config.example.js` to `public/config.js` on the
served site and edit the values you need:

```js
window.AVIAN_CONFIG = {
  enabledViews: {
    collage: true,
    stats: true,
    atlas: true,
    birdex: false
  },
  defaultTimePeriod: "24H",       // 1H, 12H, 24H, 7D, or ALL
  timePeriodPickerVisible: true,
  siteName: "your birds",
  apiUrl: "",                     // same-origin; omit /api/v2
  birdex: {
    elementalWhimsy: true         // hand-awarded fire/ice/ghost badges
  }
};
```

Settings:

- **`enabledViews`** enables or disables `collage`, `stats`, `atlas`, and `birdex`.
  Missing keys default to `true`; if all four are disabled, collage is enabled
  as a safety fallback. Disabled views are removed from navigation. Their
  view-owned assets are not requested: disabling Birdex skips
  `birdex.json`/`birdex-text.json`, and disabling both Collage and Birdex skips
  `dims.json`/`masks.json`.
- **`defaultTimePeriod`** is the initial window when the visitor has no saved
  choice. If the picker is hidden, it is always the window used.
- **`timePeriodPickerVisible`** controls the top time-window picker.
- **`siteName`** replaces “your birds” in the browser title, masthead, and About
  dialog eyebrow.
- **`apiUrl`** is the BirdNET-Go origin, such as
  `https://birdnet.example.com`. Leave it empty for same-origin. Do not append
  `/api/v2`; the app adds it. A separate host must permit this page's origin in
  its CORS configuration.

`config.js` is ignored by Git and is not included in the published bundle.
Keep it beside the deployed static files so package upgrades can replace the
application without replacing local settings. The published bundle includes
`config.example.js` as a starting point. Because loading is optional, a missing
`config.js` produces one harmless 404 request during startup.

## Deploying

Pushing to `main` packs `public/` into a tarball and publishes it to Forgejo's
generic package registry. The homelab's static-route publisher picks it up from
there; see the `x-web` block on the `birdnet-go` service.

## Local development

Serve `public/` and point it at a BirdNET-Go instance:

```sh
cd public && python3 -m http.server 8000
```

The API base is same-origin by default. To develop against a BirdNET-Go on
another host, copy `config.example.js` to `config.js`, set `apiUrl`, and ensure
that host allows the development server's origin in its CORS configuration.

## License

CC-BY-NC-SA-4.0

Illustrations and original front-end are teddy's; see
[AvianVisitors](https://github.com/Twarner491/AvianVisitors) 

## Appendix: data sources

Everything in `public/birdex.json` and `public/birdex-text.json` is fetched at
build time by `tools/build-birdex.py` and committed. Nothing here is queried at
runtime — the served page talks only to your own BirdNET-Go.

| source | used for | licence |
| --- | --- | --- |
| [Wikidata](https://www.wikidata.org) | Avibase IDs (`P2026`), IUCN category (`P141`), family (`P171*` → `P225`), eBird codes (`P3444`) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [Wikipedia](https://en.wikipedia.org) (English) | common names and the species descriptions in `birdex-text.json`, via the MediaWiki extracts API | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [Avibase](https://avibase.bsc-eoc.org) | linked to only, never fetched — see below | n/a |
| [IUCN Red List](https://www.iucnredlist.org) | conservation categories, obtained via Wikidata rather than directly | n/a |
| [eBird / Clements](https://ebird.org) | species codes, obtained via Wikidata rather than directly | n/a |
| Guild, trait and element assignments | hand-written in `tools/types.json` | this repo's licence |

**Avibase is deliberately never fetched.** It sits behind a Cloudflare managed
challenge that returns 403 to any automated request, including `/robots.txt`.
Its species identifiers are published on Wikidata as `P2026`, so entries deep-link
to `avibase.bsc-eoc.org/species.jsp?avibaseid=…` without the build ever
contacting the host.

Wikimedia asks for a descriptive User-Agent and unhurried, serial requests; the
build sets one and batches 20 titles per call. A full rebuild is one Wikidata
query plus roughly 240 Wikipedia calls, run by hand and rarely.

### A note on the description text

`birdex-text.json` is derived from Wikipedia and therefore carries **CC BY-SA
4.0**, which requires attribution and share-alike. That is not the same licence
as this repository's CC-BY-NC-SA-4.0, and the two are not interchangeable —
share-alike forbids adding restrictions, and `NC` is one. Treat that file as
CC BY-SA 4.0 attributed to its Wikipedia contributors rather than as relicensed
under the repo terms. The metadata in `birdex.json` is unaffected: Wikidata is
CC0, and factual identifiers aren't copyrightable in the first place.
