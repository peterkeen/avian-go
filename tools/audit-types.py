#!/usr/bin/env python3
"""Cross-check each Birdex entry's badges against its own description.

The typing in tools/types.json is derived from taxonomic family, which is right
for the family and wrong for the exceptions - kestrels nest in cavities though
no other falcon here does, five of twenty-one ducks use tree holes rather than
the ground. Those exceptions are already written down, in the Wikipedia text
sitting in birdex-text.json, so this greps one against the other.

Reports, never edits. Roughly two thirds of the hits are false positives and
the interesting part is reading them: "the Carolina Colony", "may imitate the
call", "nocturnal migrants", and birds that are brood-parasite *victims* all
match naive patterns. Confirmed findings go into types.json by hand.

    python3 tools/audit-types.py
    python3 tools/audit-types.py --trait cavity-nester
"""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "public" / "birdex.json"
TEXT = ROOT / "public" / "birdex-text.json"

# Deliberately trait-only. Diet words ("seeds", "insects", "fish") appear in
# almost every description regardless of what the bird mainly eats, so auditing
# guilds this way produces noise rather than findings.
SIGNALS = {
    "burrow": r"\bburrow",
    "cavity-nester": r"tree (?:cavity|cavities|hole)|nests? in (?:a )?(?:tree )?(?:cavit|hole)"
                     r"|nest ?box|excavat\w+ (?:a |its )?(?:nest|cavit|hole)",
    "ground-nester": r"nests? on the ground|ground[- ]nest|nest is a scrape|in a scrape",
    "nocturnal": r"\bnocturnal\b|hunts? at night|active at night",
    "colonial": r"\bcolon(?:y|ies|ial)\b|nests? in colonies",
    "cacher": r"\bcach(?:e|es|ed|ing)\b|stores? (?:food|seeds|acorns)|hoard",
    "mimic": r"\bmimic\w*\b|imitat\w+ (?:the )?(?:calls?|songs?|sounds?)",
    "brood-parasite": r"brood parasit|lays? its eggs in (?:the )?nests? of",
    "ground-dweller": r"forages? on the ground|\bterrestrial\b|runs? (?:along|across|on) the ground"
                      r"|scratch\w*(?: (?:in|through|at))? (?:the )?leaf litter",
}

# A badge these phrases would contradict outright.
CONTRADICTIONS = {
    "nocturnal": r"\bdiurnal\b|active (?:by day|during the day)|hunts? (?:by day|during the day)",
}


def context(text, match, pad=60):
    return text[max(0, match.start() - pad):match.end() + pad].replace("\n", " ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--trait", help="only audit this one trait")
    args = ap.parse_args()

    species = json.loads(META.read_text())["species"]
    blurbs = json.loads(TEXT.read_text())["blurbs"]
    signals = {args.trait: SIGNALS[args.trait]} if args.trait else SIGNALS

    misses, contras = [], []
    for slug, rec in species.items():
        text = blurbs.get(slug, "")
        low = text.lower()
        have = set((rec.get("types") or {}).get("traits", []))
        for trait, pattern in signals.items():
            if trait in have:
                continue
            hit = re.search(pattern, low)
            if hit:
                misses.append((trait, rec["n"], slug, rec["com"], context(text, hit)))
        for trait, pattern in CONTRADICTIONS.items():
            if trait not in have:
                continue
            hit = re.search(pattern, low)
            if hit:
                contras.append((trait, rec["n"], slug, rec["com"], context(text, hit)))

    print("=== badge contradicted by its own description (%d) ===" % len(contras))
    for trait, n, slug, com, ctx in sorted(contras):
        print("  #%-4s %-28s [%s]\n       …%s…" % (n, com, trait, ctx))

    print("\n=== trait implied by the description but not assigned (%d) ===" % len(misses))
    for trait, n, slug, com, ctx in sorted(misses):
        print("  [%-14s] #%-4s %-28s (%s)\n       …%s…" % (trait, n, com, slug, ctx))

    print("\n%d to review. Expect most to be false positives - read before acting."
          % (len(misses) + len(contras)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
