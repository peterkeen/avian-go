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
| `wiki.php?sci=` | Wikipedia's REST API, called directly |
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
  apt.js               # collage, atlas, modal, and the API adapter
  styles.css
  dims.json            # illustration dimensions, keyed by species slug
  masks.json           # alpha bitmasks for collage nesting + hit-testing
  assets/illustrations # 666 kachō-e PNGs (~419MB)
```

`assets/illustrations` is most of the repo. Species without a bundled
illustration fall back to BirdNET-Go's image proxy.

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
another host, set `window.BNG_API_BASE` before `apt.js` loads — that host will
need to allow the origin in its CORS config.

## License

CC-BY-NC-SA-4.0

Illustrations and original front-end are teddy's; see
[AvianVisitors](https://github.com/Twarner491/AvianVisitors) 
