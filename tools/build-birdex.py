#!/usr/bin/env python3
"""Build public/birdex.json - the offline reference database behind the Birdex view.

Cross-correlates four sources into one committed file so the running site makes
no third-party calls:

  bundled art   public/dims.json          which species have illustrations
  roster-extra  tools/roster-extra.txt    hand-added species
  Wikidata      query.wikidata.org        Avibase ID, IUCN category, family, eBird code
  Wikipedia     en.wikipedia.org/w/api    common name + intro paragraph

Avibase itself is never fetched. It sits behind a Cloudflare managed challenge
(every path 403s, including /robots.txt), so we take its species identifiers
from Wikidata property P2026 and deep-link rather than scrape.

Incremental by default: only species missing from the committed birdex.json are
fetched, so adding one bird costs one small query per source rather than a full
rebuild. Dex numbers are frozen on first assignment and never reused.

  python3 tools/build-birdex.py                 # fetch only what's new
  python3 tools/build-birdex.py --refresh-all   # refetch everything
  python3 tools/build-birdex.py --refresh SLUG  # refetch one (repeatable)
  python3 tools/build-birdex.py --report        # print gaps, fetch nothing
  python3 tools/build-birdex.py --from-api URL  # fold in a live BirdNET-Go life list
"""

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
TOOLS = ROOT / "tools"

DIMS = PUBLIC / "dims.json"
OUT = PUBLIC / "birdex.json"
OUT_TEXT = PUBLIC / "birdex-text.json"
ROSTER_EXTRA = TOOLS / "roster-extra.txt"
ALIASES = TOOLS / "aliases.json"
OVERRIDES = TOOLS / "overrides.json"
TYPES = TOOLS / "types.json"

# Wikimedia and Wikidata both ask for a descriptive agent that identifies the
# tool and gives them somewhere to complain to. Keep it honest.
UA = "avian-go-birdex/1.0 (https://birdnet.keen.land/avian; build script, run manually)"

WD_ENDPOINT = "https://query.wikidata.org/sparql"
WP_ENDPOINT = "https://en.wikipedia.org/w/api.php"

# Wikidata batch size. A full 333-species VALUES clause is fine over POST but
# blows the URI limit over GET, so we always POST; the chunking is only to keep
# any single query well inside the public endpoint's 60s timeout.
WD_CHUNK = 200
# prop=extracts caps at 20 titles per request for non-bot clients.
WP_CHUNK = 20
# Courtesy pause between Wikipedia calls. 17 requests at this rate is a rounding
# error to them, and it keeps us well clear of any rate limiter.
WP_PAUSE = 0.5

# Blurb length. A single lead paragraph is often a one-liner for the less
# written-up species, so take up to two and aim for roughly a screenful.
BLURB_WORDS = 250          # target
BLURB_HARD = 330           # past this, trim the tail paragraph by sentences
BLURB_MAX_PARAS = 6
# Lead sections vary wildly - "Common raven" opens with 265 words, "Hermit
# thrush" with 11. Anything still this thin after the batched pass gets a
# second, targeted request that reaches into the article body. That pass can't
# be batched: dropping exintro makes it a whole-article extract and the API
# silently forces exlimit to 1, so it's one request per species and therefore
# only worth spending on the entries the lead section failed to cover.
BLURB_TOPUP_BELOW = 120

IUCN_CODES = {
    "least concern": "LC",
    "near threatened": "NT",
    "vulnerable": "VU",
    "endangered": "EN",
    "critically endangered": "CR",
    "extinct in the wild": "EW",
    "extinct": "EX",
    "data deficient": "DD",
    "not evaluated": "NE",
}

# Coverage floors, deliberately below present-day coverage so ordinary roster
# growth doesn't trip them. The assertion that actually bites is the
# no-regression check against the previous build.
FLOORS = {"avibase": 0.90, "iucn": 0.90, "blurb": 0.95}
# How far coverage may slip against the previous build before it's a failure.
# Non-zero because adding a genuinely obscure species can legitimately dilute a
# ratio by a fraction of a point.
REGRESSION_TOLERANCE = 0.02


# ---------------------------------------------------------------- helpers

def slugify(sci):
    """Mirror of slugify() in public/apt.js - the art filenames depend on it."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", sci.lower()))


def unslugify(slug):
    parts = slug.split("-")
    return " ".join([parts[0].capitalize()] + parts[1:])


def _no_dupes(pairs):
    """json.load silently keeps the LAST of a repeated key, which in a
    hand-edited table means a second entry for a species quietly deletes the
    first one's fields. Refuse instead."""
    seen = {}
    for k, v in pairs:
        if k in seen:
            raise ValueError("duplicate key %r" % k)
        seen[k] = v
    return seen


def load_json(path, default):
    if not path.exists():
        return default
    with path.open() as fh:
        try:
            return json.load(fh, object_pairs_hook=_no_dupes)
        except ValueError as exc:
            raise SystemExit("%s: %s" % (path.name, exc))


def post_form(url, fields):
    body = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"User-Agent": UA, "Accept": "application/sparql-results+json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.load(resp)


def get_query(url, fields):
    req = urllib.request.Request(
        url + "?" + urllib.parse.urlencode(fields), headers={"User-Agent": UA}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def chunked(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------- roster

def read_roster_extra():
    if not ROSTER_EXTRA.exists():
        return []
    names = []
    for line in ROSTER_EXTRA.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.append(line)
    return names


def read_api_lifelist(base):
    """Fold in whatever the live station has actually heard."""
    base = base.rstrip("/")
    url = base + "/api/v2/analytics/species/summary"
    try:
        rows = get_query(url, {})
    except Exception as exc:                                  # noqa: BLE001
        print("  ! --from-api failed (%s); continuing without it" % exc)
        return []
    if isinstance(rows, dict):
        rows = rows.get("species") or rows.get("data") or []
    names = []
    for r in rows:
        sci = r.get("scientific_name") or r.get("sci") or r.get("species")
        if sci:
            names.append(sci)
    print("  + %d species from the live life list" % len(names))
    return names


def build_roster(from_api, merges):
    """slug -> {sci, art} for every species the Birdex should know about."""
    dims = load_json(DIMS, {})
    art_slugs = sorted({k[:-2] if k.endswith("-2") else k for k in dims})

    roster = {}
    for slug in art_slugs:
        # The illustration set files a few species under both their old and
        # new genus ("regulus-calendula" and "corthylio-calendula" are one
        # bird). Keeping both would inflate the roster, split the art, and
        # strand whichever one BirdNET-Go doesn't report as a twin that can
        # never be registered.
        if slug in merges:
            continue
        roster[slug] = {"sci": unslugify(slug), "art": True}

    extra = read_roster_extra()
    if from_api:
        extra += read_api_lifelist(from_api)
    for sci in extra:
        slug = slugify(sci)
        slug = merges.get(slug, slug)
        if slug in roster:
            continue
        roster[slug] = {"sci": sci, "art": False}
    return roster


def assign_numbers(roster, existing):
    """Frozen numbering. Existing slugs keep their number; new ones append.

    The initial roster is numbered alphabetically by scientific name (close
    enough to taxonomic that families cluster). Anything added later takes the
    next free number, because renumbering would silently rewrite every dex
    number a user has already seen.
    """
    numbers = {slug: rec["n"] for slug, rec in existing.items() if "n" in rec}
    if not numbers:
        for i, slug in enumerate(sorted(roster, key=lambda s: roster[s]["sci"]), start=1):
            numbers[slug] = i
        return numbers

    nxt = max(numbers.values()) + 1
    for slug in sorted(roster, key=lambda s: roster[s]["sci"]):
        if slug not in numbers:
            numbers[slug] = nxt
            nxt += 1
    return numbers


# ---------------------------------------------------------------- wikidata

WD_QUERY = """SELECT ?sci ?itemLabel ?avibase ?iucnLabel ?family ?ebird WHERE {
  VALUES ?sci { %s }
  { ?item wdt:P225 ?sci } UNION { ?item wdt:P1420 ?sci }
  OPTIONAL { ?item wdt:P2026 ?avibase }
  OPTIONAL { ?item wdt:P141 ?iucn }
  OPTIONAL { ?item wdt:P171* ?fam . ?fam wdt:P105 wd:Q35409 . ?fam wdt:P225 ?family }
  OPTIONAL { ?item wdt:P3444 ?ebird }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}"""
# Family comes from the family item's taxon name (P225), not ?familyLabel. The
# label service silently emits a raw Q-id for any item lacking an English label,
# which shipped 'Q25439' in place of 'Picidae' for every woodpecker. Taxa always
# carry P225.
# Note: taxonomic ORDER is deliberately not queried. `?o wdt:P105 wd:Q36602`
# matches both the real order and Saurischia - Wikidata ranks both as orders -
# which yields two rows per species and corrupts roughly half of them on a
# last-write-wins merge. Family has no such twin.


def fetch_wikidata(names):
    """{query name -> {avibase, iucn, family, ebird, label}}"""
    out = {}
    if not names:
        return out
    for batch in chunked(sorted(names), WD_CHUNK):
        values = " ".join('"%s"' % n.replace('"', '') for n in batch)
        data = post_form(WD_ENDPOINT, {"query": WD_QUERY % values, "format": "json"})
        for row in data["results"]["bindings"]:
            sci = row["sci"]["value"]
            rec = out.setdefault(sci, {})
            # First non-null wins. Defensive even though the order twin is gone:
            # a taxon with two family assertions would otherwise flap between
            # runs and produce a spurious diff.
            for key, col in (("avibase", "avibase"), ("family", "family"),
                             ("ebird", "ebird"), ("label", "itemLabel")):
                if col not in row or rec.get(key):
                    continue
                val = row[col]["value"]
                # The label service falls back to the bare Q-id when an item has
                # no English label. Never let that reach the output.
                if re.fullmatch(r"Q\d+", val):
                    continue
                rec[key] = val
            if "iucnLabel" in row and not rec.get("iucn"):
                raw = row["iucnLabel"]["value"].lower()
                rec["iucn"] = IUCN_CODES.get(raw, raw)
        print("  wikidata: %d/%d resolved" % (len(out), len(names)))
    return out


# ---------------------------------------------------------------- wikipedia

# Abbreviated binomials ("A. b.", "N. n.") - subspecies list entries that the
# plaintext extract puts on their own lines. They end in a period, so the
# heading test alone lets them through as stray one-line paragraphs.
_ABBREV_BINOMIAL = re.compile(r"^[A-Z]\.(\s+[a-z]\.)*\s*$")


def _is_noise(line):
    """Body extracts carry section titles as bare lines ('Taxonomy') and cut
    into subspecies lists mid-way. Neither is prose; drop both rather than
    splice them into the blurb."""
    if _ABBREV_BINOMIAL.match(line):
        return True
    if len(line.split()) < 4:
        return True
    return len(line.split()) <= 6 and not line.rstrip().endswith((".", "!", "?", '"'))


# A subspecies list item: an abbreviated trinomial ("Q. q. stonei") inside a
# short line. Prose mentions the same abbreviation inside full sentences, so
# length is what separates "the purple grackle (Q. q. stonei) (Chapman, 1935)"
# from "the nominate subspecies (M. m. melodia) weighs about 22 g on average".
_TRINOMIAL = re.compile(r"\b[A-Z]\.\s*[a-z]\.")
_LIST_ITEM_WORDS = 25


def _real_stop(text, i):
    """Is text[i] a sentence terminator, or the dot of an initial?

    'A. s. velox' contains two dots that end nothing. Wikipedia's extract API
    counts them as sentences, which is why exsentences=10 can return a blurb
    that stops mid-enumeration."""
    if text[i] != ".":
        return True
    j = i - 1
    if j >= 0 and text[j].isalpha() and (j == 0 or not text[j - 1].isalnum()):
        return False        # single letter standing alone -> an initial
    return True


def tidy_blurb(text):
    """Drop subspecies enumerations and any half-finished trailing sentence.

    Runs on the final text rather than on the raw extract, so it applies to
    blurbs carried forward from a previous build as well as freshly fetched
    ones - no refetch needed to repair them."""
    if not text:
        return text
    paras = []
    for p in text.split("\n\n"):
        p = p.strip()
        if not p:
            continue
        if _TRINOMIAL.search(p) and len(p.split()) < _LIST_ITEM_WORDS:
            continue        # a taxonomy list item, not prose
        paras.append(p)
    # A lead-in whose list we just removed ("...assign it these nine subspecies:")
    while paras and paras[-1].rstrip().endswith(":"):
        paras.pop()
    # Cut any remaining tail back to the last dot that actually ends a sentence.
    while paras:
        last = paras[-1]
        if last.rstrip().endswith((".", "!", "?", '"')) and _real_stop(last.rstrip(), len(last.rstrip()) - 1):
            break
        cut = None
        for m in re.finditer(r"[.!?](?=\s|$)", last):
            if _real_stop(last, m.start()):
                cut = m.end()
        if cut:
            paras[-1] = last[:cut]
            break
        paras.pop()         # nothing salvageable in this paragraph
    return "\n\n".join(paras)


def blurb_text(text):
    """One or two paragraphs, ~250 words, always ending on a whole sentence."""
    paras = [p.strip() for p in text.split("\n") if p.strip() and not _is_noise(p.strip())]
    if not paras:
        return ""

    kept, words = [], 0
    for p in paras:
        if kept and (words >= BLURB_WORDS or len(kept) >= BLURB_MAX_PARAS):
            break
        kept.append(p)
        words += len(p.split())

    # Only the tail paragraph gets trimmed, and only if the whole thing runs
    # long - cutting a short lead paragraph is what made these read as stubs.
    if words > BLURB_HARD:
        head = sum(len(p.split()) for p in kept[:-1])
        budget = max(50, BLURB_WORDS - head)
        acc, n = [], 0
        for sentence in re.split(r"(?<=[.!?]) +", kept[-1]):
            if acc and n + len(sentence.split()) > budget:
                break
            acc.append(sentence)
            n += len(sentence.split())
        kept[-1] = " ".join(acc)

    return "\n\n".join(kept)


def fetch_wikipedia(names):
    """{query name -> {com, blurb}}, following redirects to the common-name page."""
    out = {}
    if not names:
        return out
    batches = list(chunked(sorted(names), WP_CHUNK))
    for i, batch in enumerate(batches, start=1):
        data = get_query(WP_ENDPOINT, {
            "action": "query", "format": "json",
            "prop": "extracts", "exintro": "1", "explaintext": "1", "exlimit": "max",
            "redirects": "1", "titles": "|".join(batch),
        })
        query = data.get("query", {})
        # titles -> resolved page titles, via normalization then redirect
        route = {}
        for norm in query.get("normalized", []):
            route[norm["from"]] = norm["to"]
        redirects = {r["from"]: r["to"] for r in query.get("redirects", [])}
        pages = {p["title"]: p for p in query.get("pages", {}).values()}

        for name in batch:
            title = redirects.get(route.get(name, name), route.get(name, name))
            page = pages.get(title)
            if not page or not page.get("extract"):
                continue
            out[name] = {"com": page["title"], "blurb": blurb_text(page["extract"])}
        print("  wikipedia: batch %d/%d (%d extracts)" % (i, len(batches), len(out)))
        if i < len(batches):
            time.sleep(WP_PAUSE)
    return out


def fetch_wikipedia_topup(names):
    """Reach into the article body for species whose lead section is a stub.

    One request per name - unavoidable, see BLURB_TOPUP_BELOW - so this is
    deliberately scoped to the thin entries only, and paced. Ten sentences of
    body runs ~200 words in ~1.3KB, which is why it asks for exsentences
    rather than pulling whole articles.
    """
    out = {}
    for i, name in enumerate(sorted(names), start=1):
        try:
            data = get_query(WP_ENDPOINT, {
                "action": "query", "format": "json", "prop": "extracts",
                "explaintext": "1", "exsentences": "10", "exsectionformat": "plain",
                "redirects": "1", "titles": name,
            })
        except Exception:                                     # noqa: BLE001
            continue
        for page in data.get("query", {}).get("pages", {}).values():
            if page.get("extract"):
                out[name] = {"com": page["title"], "blurb": blurb_text(page["extract"])}
        if i % 25 == 0 or i == len(names):
            print("    top-up %d/%d" % (i, len(names)))
        time.sleep(WP_PAUSE)
    return out


# ---------------------------------------------------------------- merge

# Hyphenated group names that birders capitalise on both sides
# ("Western Screech-Owl"), unlike ordinary hyphenated modifiers, which stay
# lowercase after the hyphen ("Yellow-rumped Warbler").
HYPHEN_GROUPS = {
    "jay", "owl", "pewee", "petrel", "heron", "dove", "hawk", "goose",
    "duck", "quail", "woodpecker", "sparrow", "warbler", "thrush", "finch",
}


def titlecase_common(name):
    """Wikipedia article titles are sentence case ('Blue jay') and sometimes
    disambiguated ('Merlin (bird)'). Species common names read better in title
    case, which is also what BirdNET-Go reports.

    Only the first letter of each space-separated word is touched - the rest of
    the word keeps Wikipedia's casing, so 'Yellow-rumped warbler' becomes
    'Yellow-rumped Warbler' rather than 'Yellow-Rumped Warbler'.
    """
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
    small = {"of", "the", "and", "in", "on", "de", "van", "von", "a"}
    out = []
    for i, w in enumerate(name.split()):
        if i and w.lower() in small:
            out.append(w.lower())
            continue
        w = w[:1].upper() + w[1:]
        if "-" in w:
            head, _, tail = w.partition("-")
            if tail.lower() in HYPHEN_GROUPS:
                w = head + "-" + tail[:1].upper() + tail[1:]
        out.append(w)
    return " ".join(out)


def merge(roster, numbers, existing, wd, wp, lookup, overrides, refresh):
    """Apply source precedence and produce the final species map."""
    species = {}
    conflicts = []
    for slug in sorted(roster, key=lambda s: numbers[s]):
        base = roster[slug]
        prev = existing.get(slug, {})
        query_name = lookup.get(slug, base["sci"])
        ov = overrides.get(slug, {})

        w = wd.get(query_name, {})
        p = wp.get(query_name, {})
        stale = slug not in refresh and slug in existing

        def pick(field, *candidates):
            # A refreshed or new slug takes the freshly fetched value; an
            # untouched one keeps what's already committed, so an incremental
            # build never blanks a field just because we didn't ask about it.
            if ov.get(field):
                return ov[field]
            if stale:
                return prev.get(field)
            for c in candidates:
                if c:
                    return c
            return None

        wp_com = titlecase_common(p["com"]) if p.get("com") else None
        wd_com = titlecase_common(w["label"]) if w.get("label") else None
        # A Wikidata label that's just the binomial back at us is not a common
        # name; don't let it beat a missing Wikipedia title into the output.
        if wd_com and wd_com.lower() == query_name.lower():
            wd_com = None
        if wp_com and wd_com and wp_com.lower() != wd_com.lower():
            conflicts.append("%s: wikipedia=%r wikidata=%r" % (slug, wp_com, wd_com))

        rec = {
            "n": numbers[slug],
            "sci": base["sci"],
            "com": pick("com", wp_com, wd_com) or base["sci"],
            "family": pick("family", w.get("family")),
            "iucn": pick("iucn", w.get("iucn")),
            "avibase": pick("avibase", w.get("avibase")),
            "ebird": pick("ebird", w.get("ebird")),
            # tidy_blurb runs here rather than in blurb_text so it also repairs
            # text carried forward from an earlier build.
            "blurb": tidy_blurb(pick("blurb", p.get("blurb"))),
            "art": base["art"],
        }
        species[slug] = {k: v for k, v in rec.items() if v not in (None, "")}
    return species, conflicts


# ---------------------------------------------------------------- checks

def apply_types(species, types):
    """Attach guild / traits / element from the curated tables.

    Guild and traits come from taxonomic family, so this stays correct for
    birds well outside the bundled roster's range. Elements are hand-awarded
    per species and carry their own note.
    """
    fam_table = types.get("family", {})
    # Underscore keys are inline documentation, not species.
    per_species = {k: v for k, v in types.get("species", {}).items() if not k.startswith("_")}
    vocab = {axis: set(types.get(axis, {})) for axis in ("guild", "trait", "element")}
    problems, untyped = [], []

    for slug, rec in species.items():
        fam = rec.get("family")
        base = fam_table.get(fam)
        if not base:
            untyped.append((slug, fam))
            continue
        entry = {"guild": base["guild"], "traits": list(base.get("traits", []))}

        ov = per_species.get(slug, {})
        if ov.get("guild"):
            entry["guild"] = ov["guild"]
        for t in ov.get("add_traits", []):
            if t not in entry["traits"]:
                entry["traits"].append(t)
        for t in ov.get("drop_traits", []):
            if t in entry["traits"]:
                entry["traits"].remove(t)
        if ov.get("element"):
            entry["element"] = ov["element"]
            if ov.get("note"):
                entry["note"] = ov["note"]

        if entry["guild"] not in vocab["guild"]:
            problems.append("%s: unknown guild %r" % (slug, entry["guild"]))
        for t in entry["traits"]:
            if t not in vocab["trait"]:
                problems.append("%s: unknown trait %r" % (slug, t))
        if entry.get("element") and entry["element"] not in vocab["element"]:
            problems.append("%s: unknown element %r" % (slug, entry["element"]))
        rec["types"] = entry

    # A species override naming a slug that doesn't exist is a silent no-op -
    # exactly the kind of typo that hides for months.
    for slug in per_species:
        if slug not in species:
            problems.append("types.json species override for unknown slug %r" % slug)
    for slug, fam in untyped:
        problems.append("no type mapping for family %r (%s)" % (fam, slug))
    return problems


def coverage(species, field):
    if not species:
        return 0.0
    return sum(1 for r in species.values() if r.get(field)) / len(species)


def check(species, previous, merges):
    """Ratios and deltas, never absolute counts.

    Absolute thresholds are a photograph of one roster: '>= 320 with an Avibase
    ID' stays green while coverage rots if you add 60 obscure species, and goes
    red on a healthy roster that shrank. Fractions plus a no-regression check
    against the previous build survive the roster changing size.
    """
    problems = []

    for slug, rec in previous.items():
        if slug not in species:
            if slug in merges:
                continue        # intentionally folded into its canonical entry
            problems.append("dropped entry: %s (#%s)" % (slug, rec.get("n")))
        elif species[slug]["n"] != rec.get("n"):
            problems.append("renumbered: %s #%s -> #%s"
                            % (slug, rec.get("n"), species[slug]["n"]))

    # Two entries sharing a species identifier means the roster is carrying the
    # same bird twice under different genus names. Left alone, one of the pair
    # can never be registered - BirdNET-Go only ever reports one of the names.
    for field in ("avibase", "ebird"):
        seen = {}
        for slug, r in species.items():
            if r.get(field):
                seen.setdefault(r[field], []).append(slug)
        for val, slugs in sorted(seen.items()):
            if len(slugs) > 1:
                problems.append(
                    "same %s (%s) on %d entries: %s - add a merge to tools/aliases.json"
                    % (field, val, len(slugs), ", ".join(sorted(slugs))))

    bad = [s for s, r in species.items() if r.get("family") == "Saurischia"]
    if bad:
        problems.append("family=Saurischia on %d entries (P171* regression): %s"
                        % (len(bad), ", ".join(sorted(bad)[:5])))

    for field, floor in FLOORS.items():
        now = coverage(species, field)
        if now < floor:
            problems.append("%s coverage %.1f%% below floor %.0f%%"
                            % (field, now * 100, floor * 100))
        if previous:
            was = coverage(previous, field)
            if now < was - REGRESSION_TOLERANCE:
                problems.append("%s coverage regressed %.1f%% -> %.1f%%"
                                % (field, was * 100, now * 100))
    return problems


def report(species):
    rows = []
    for slug, r in sorted(species.items(), key=lambda kv: kv[1]["n"]):
        missing = [f for f in ("avibase", "iucn", "family", "blurb") if not r.get(f)]
        if not r.get("art"):
            missing.append("art")
        if missing:
            rows.append("  #%-4s %-32s %s" % (r["n"], slug, ", ".join("no " + m for m in missing)))
    print("\n%d of %d entries incomplete:" % (len(rows), len(species)))
    print("\n".join(rows) if rows else "  (none)")
    for field in ("avibase", "iucn", "family", "blurb"):
        print("  %-8s %5.1f%%" % (field, coverage(species, field) * 100))


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="append", default=[], metavar="SLUG")
    ap.add_argument("--refresh-all", action="store_true")
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--from-api", metavar="URL")
    args = ap.parse_args()

    aliases = load_json(ALIASES, {"lookup": {}, "slug": {}, "merge": {}})
    lookup = aliases.get("lookup", {})
    merges = aliases.get("merge", {})
    overrides = load_json(OVERRIDES, {})
    prior = load_json(OUT, {})
    existing = prior.get("species", {})
    # Re-attach the descriptions from their own file before anything reads
    # prior state. merge()'s `stale` branch carries untouched fields forward
    # from `existing`, so without this an incremental build would treat every
    # already-committed blurb as absent and blank the lot.
    prior_blurbs = load_json(OUT_TEXT, {}).get("blurbs", {})
    for slug, rec in existing.items():
        if slug in prior_blurbs:
            rec["blurb"] = prior_blurbs[slug]

    print("roster:")
    roster = build_roster(args.from_api, merges)
    print("  %d species (%d with bundled art)"
          % (len(roster), sum(1 for r in roster.values() if r["art"])))

    numbers = assign_numbers(roster, existing)

    if args.report:
        report(existing or {})
        return 0

    if args.refresh_all:
        refresh = set(roster)
    else:
        refresh = {s for s in roster if s not in existing} | set(args.refresh)

    print("fetching %d species (%d already committed):" % (len(refresh), len(roster) - len(refresh)))
    query_names = {lookup.get(s, roster[s]["sci"]) for s in refresh}
    wd = fetch_wikidata(query_names)
    wp = fetch_wikipedia(query_names)

    # Second pass, only where the lead section came back too thin to read as a
    # dex entry. Counted out loud before it runs - this is the expensive half.
    thin = sorted([n for n in query_names if n not in wp]
                  + [n for n, v in wp.items()
                     if len(v.get("blurb", "").split()) < BLURB_TOPUP_BELOW])
    if thin:
        print("  %d entries under %d words; fetching article bodies "
              "(1 request each, ~%.0fs)" % (len(thin), BLURB_TOPUP_BELOW, len(thin) * WP_PAUSE))
        for name, v in fetch_wikipedia_topup(thin).items():
            rec = wp.setdefault(name, {})
            # Only accept the body version if it actually beat the lead.
            if len(v.get("blurb", "").split()) > len(rec.get("blurb", "").split()):
                rec["blurb"] = v["blurb"]
            if v.get("com") and not rec.get("com"):
                rec["com"] = v["com"]

    unresolved = sorted(n for n in query_names if n not in wd and n not in wp)
    if unresolved:
        print("  ! %d unresolved by either source: %s"
              % (len(unresolved), ", ".join(unresolved[:8])))
        print("    add a tools/aliases.json lookup entry or a tools/overrides.json record")

    species, conflicts = merge(roster, numbers, existing, wd, wp, lookup, overrides, refresh)

    types = load_json(TYPES, {})
    type_problems = apply_types(species, types)

    problems = check(species, existing, merges) + type_problems
    if conflicts:
        print("\n%d common-name conflicts (wikipedia won):" % len(conflicts))
        print("\n".join("  " + c for c in conflicts[:15]))

    print("\ncoverage:")
    for field in ("avibase", "iucn", "family", "blurb", "ebird"):
        print("  %-8s %5.1f%%" % (field, coverage(species, field) * 100))

    if problems:
        print("\nFAILED:")
        print("\n".join("  " + p for p in problems))
        return 1

    # The runtime map is the hand-written slug aliases plus every merge, so a
    # station reporting either name of a merged pair registers the same entry.
    runtime_aliases = dict(aliases.get("slug", {}))
    runtime_aliases.update(merges)

    # Split by load cost, not by topic. Descriptions are ~88% of the bytes but
    # are only needed once something actually displays prose, whereas the
    # metadata drives the whole list and every outbound link and therefore has
    # to be cheap enough to sit on the load path.
    blurbs = {slug: r["blurb"] for slug, r in species.items() if r.get("blurb")}
    meta = {slug: {k: v for k, v in r.items() if k != "blurb"}
            for slug, r in species.items()}

    # Shared stamp so the runtime can detect a stale half. Content-derived
    # rather than a timestamp, so an unchanged rebuild stays byte-identical.
    stamp = hashlib.sha256(
        json.dumps([meta, blurbs, runtime_aliases], sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:12]

    # Never ship halves that disagree about which species exist. The runtime
    # degrades gracefully when a blurb is missing, but that's a safety net for
    # cache skew - it shouldn't be papering over a broken build.
    missing = sorted(set(meta) - set(blurbs))
    if missing:
        print("\nnote: %d entries have no description: %s"
              % (len(missing), ", ".join(missing[:6])))
    orphans = sorted(set(blurbs) - set(meta))
    if orphans:
        print("\nFAILED:\n  %d descriptions with no metadata entry: %s"
              % (len(orphans), ", ".join(orphans[:6])))
        return 1

    # The type vocabulary ships with the metadata: labels and hover flavor are
    # a couple of KB and every badge needs them.
    vocab = {axis: types.get(axis, {}) for axis in ("guild", "trait", "element")}
    OUT.write_text(json.dumps(
        {"version": 1, "stamp": stamp, "species": meta,
         "aliases": runtime_aliases, "vocab": vocab},
        ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    OUT_TEXT.write_text(json.dumps(
        {"version": 1, "stamp": stamp, "blurbs": blurbs},
        ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    print("\nwrote %s (%d species, %.0f KB)  +  %s (%d blurbs, %.0f KB)"
          % (OUT.relative_to(ROOT), len(meta), OUT.stat().st_size / 1024,
             OUT_TEXT.relative_to(ROOT), len(blurbs), OUT_TEXT.stat().st_size / 1024))
    print("stamp %s (both files; a mismatch at runtime means a stale cache)" % stamp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
