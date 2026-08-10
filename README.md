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

A fourth view: a numbered field guide over the illustration set. All 330
species hold a permanent number. Ones this station has heard are *registered*
and show their plate, typing, stats, rarity and a description; the rest stay
silhouetted at `???`, drawn from `masks.json` so a full-roster list costs zero
requests against the 419MB illustration directory — and never reveals art for a
bird you haven't found. A locked entry can be unlocked by hand, which shows
everything the database knows but deliberately no detection history, and never
counts toward the registered tally. Entries deep-link as `#birdex/<slug>`.

Search matches name, scientific name, family, type and `#number`. Locked
entries match too and show their names for the duration of the query, so a bird
you know exists is findable — the plate still stays hidden.

### Typing

Every species carries one **guild** (how it makes a living) and any number of
**traits** (how it nests, forages, behaves), both derived from taxonomic family
in `tools/types.json`. Family is a global signal, so a European or Australian
bird added later types correctly without touching the table. Species-level
overrides handle what family can't predict — kestrels nest in cavities though
no other falcon here does; five of twenty-one ducks use tree holes rather than
the ground.

A few birds also carry a hand-awarded **element**, each with its own note
explaining why that one earned it. They stay scarce on purpose — 15 of 330.
Black-backed Woodpecker is fire-type because it moves into stands of freshly
burned pine within a year of a burn.

`tools/audit-types.py` cross-checks every entry's badges against its own
description and reports mismatches. It found the ducks, the kestrel, and that
`colonial` was wrong for most of Icteridae. Expect roughly two thirds false
positives — "the Carolina Colony", "may imitate the call", "nocturnal migrants",
and birds that are brood-parasite *victims* all match naive patterns — so it
reports and never edits.

### Data

Reference data is built offline and committed, so the deployed page makes **no
third-party calls at all** — the detail modal reads its description from here
too, rather than calling Wikipedia from every visitor's browser.

| field | source |
| --- | --- |
| Avibase ID → species deep link | Wikidata `P2026` (97.9%) |
| IUCN Red List category | Wikidata `P141` (96.4%) |
| family | Wikidata `P171*` → `P225` (100%) |
| eBird code | Wikidata `P3444` (99.4%) |
| common name + description | Wikipedia extracts (100%, median ~186 words) |

Two files, split by load cost and sharing a content stamp: `birdex.json` (~78KB
— metadata, typing and the type vocabulary) loads eagerly because the list and
every outbound link need it, and `birdex-text.json` (~395KB — descriptions
only) is fetched the first time something displays prose. If the stamps ever
disagree — a stale cached half — the text side is discarded rather than
rendered against the wrong roster, and entries fall back to an explicit "no
description available".

The roster is 330, not 333: the illustration set files three species under both
their old and new genus (`regulus-calendula` *and* `corthylio-calendula` are one
Ruby-crowned Kinglet). Those are merged via `aliases.merge`, so BirdNET-Go
reporting either name registers the same entry rather than stranding a twin that
can never be found. The build **fails** if two entries share an Avibase ID or
eBird code without a merge declared — which is how all three were caught.

Avibase is never fetched. It sits behind a Cloudflare managed challenge that
403s everything including `/robots.txt`, so the identifiers come from Wikidata
and we only link out.

```sh
python3 tools/build-birdex.py                # fetch only what's new
python3 tools/build-birdex.py --report       # list incomplete entries
python3 tools/build-birdex.py --refresh SLUG # refetch one species
python3 tools/audit-types.py                 # badges vs. descriptions
```

To add a bird, append a scientific name to `tools/roster-extra.txt` and rebuild;
only the new names are fetched and existing dex numbers never change. A full
rebuild is 1 Wikidata query, 17 batched Wikipedia calls, and a targeted top-up
pass for species whose lead section is too thin to read as an entry (that pass
can't be batched — the API forces `exlimit=1` for article bodies).

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
  apiUrl: ""                      // same-origin; omit /api/v2
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
