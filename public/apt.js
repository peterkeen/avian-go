(function () {
  function start() {
  // config-loader.js resolves this entry point only after optional config.js
  // has loaded (or cleanly 404ed), so startup never races deployment settings.
  var RAW_CONFIG = window.AVIAN_CONFIG || {};
  var VIEW_KEYS = ['collage', 'stats', 'atlas', 'birdex'];
  var DEFAULT_CONFIG = {
    views: { collage: true, stats: true, atlas: true, birdex: true },
    defaultTimePeriod: '24H',
    timePeriodPickerVisible: true,
    siteName: 'your birds',
    apiUrl: '',
    birdex: { elementalWhimsy: true }
  };
  var PERIOD_HOURS = { '1H': 1, '12H': 12, '24H': 24, '7D': 168, 'ALL': 1000000 };
  var CONFIG = {
    views: {},
    defaultTimePeriod: String(RAW_CONFIG.defaultTimePeriod || DEFAULT_CONFIG.defaultTimePeriod).toUpperCase(),
    timePeriodPickerVisible: RAW_CONFIG.timePeriodPickerVisible !== false,
    siteName: typeof RAW_CONFIG.siteName === 'string' && RAW_CONFIG.siteName.trim()
      ? RAW_CONFIG.siteName.trim() : DEFAULT_CONFIG.siteName,
    apiUrl: typeof RAW_CONFIG.apiUrl === 'string' ? RAW_CONFIG.apiUrl.trim().replace(/\/$/, '') : ''
  };
  // elementalWhimsy covers the hand-awarded fire/ice/ghost badges - the
  // subjective half of the typing - so a deployment that wants a straight
  // field guide can drop them and keep the ecological guild/trait ones. It's
  // applied by stripping the tags as birdex.json loads rather than by
  // filtering at each render, so the badges, the table and the search index
  // all agree without having to remember the setting.
  var rawBirdex = RAW_CONFIG.birdex || {};
  CONFIG.birdex = { elementalWhimsy: rawBirdex.elementalWhimsy !== false };

  var configuredViews = RAW_CONFIG.enabledViews || RAW_CONFIG.views;
  VIEW_KEYS.forEach(function (key) {
    CONFIG.views[key] = !configuredViews || configuredViews[key] !== false;
  });
  if (!VIEW_KEYS.some(function (key) { return CONFIG.views[key]; })) CONFIG.views.collage = true;
  if (!PERIOD_HOURS[CONFIG.defaultTimePeriod]) CONFIG.defaultTimePeriod = DEFAULT_CONFIG.defaultTimePeriod;

  // Apply deployment-level presentation settings before wiring controls.
  document.title = CONFIG.siteName;
  document.querySelectorAll('[data-site-name]').forEach(function (el) { el.textContent = CONFIG.siteName; });
  var PLACEHOLDER = [{ "sci": "Calypte anna", "com": "Anna's Hummingbird", "featured": true }, { "sci": "Passer domesticus", "com": "House Sparrow" }, { "sci": "Haemorhous mexicanus", "com": "House Finch" }, { "sci": "Turdus migratorius", "com": "American Robin" }, { "sci": "Zenaida macroura", "com": "Mourning Dove" }, { "sci": "Spinus psaltria", "com": "Lesser Goldfinch" }, { "sci": "Zonotrichia leucophrys", "com": "White-crowned Sparrow" }, { "sci": "Aphelocoma californica", "com": "California Scrub-Jay" }, { "sci": "Mimus polyglottos", "com": "Northern Mockingbird" }, { "sci": "Sayornis nigricans", "com": "Black Phoebe" }, { "sci": "Larus occidentalis", "com": "Western Gull" }, { "sci": "Corvus brachyrhynchos", "com": "American Crow" }];
  // Bumped whenever the offline sketch build changes, so the browser
  // doesn't keep a stale cache after we regenerate the sketches.
  var SKETCH_VERSION = 'r12'; // r12: 84 eastern NA birds (PR #23) refined + re-cut. r11: full library restyle: every species
  // re-rendered (perched + flight) with clean cutouts.
  // Cache-bust for /api/img - bump whenever a bird gets re-rendered via
  // /api/regen or whenever you need every CF DC to drop its cached copy.
  // Cloudflare keys on the full URL incl. query, so bumping this is
  // equivalent to a global cache purge for /api/img. (caches.default
  // .delete() in the worker only affects ONE colo at a time, so a
  // versioned URL is the only reliable way to invalidate everywhere.)
  var IMG_VERSION = 'r12'; // r12: 84 eastern NA birds (PR #23) refined + re-cut. r11: full library restyle: every species re-rendered
  // with clean cutouts, so drop every cached copy.

  // ---- Sliding pill helper ----
  // Each segmented control has a single .seg-pill element that we move via
  // transform/width to whichever button currently has aria-current="true".
  // This gives an iOS-style smooth slide instead of a hard snap.
  function syncPill(container) {
    var pill = container.querySelector('.seg-pill');
    var active = container.querySelector('button[aria-current="true"]');
    if (!pill || !active) return;
    // offsetLeft is relative to the container (we set position:relative on it).
    pill.style.width = active.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }

  // Clicking the open space of a segmented toggle (not a specific option)
  // advances to the next available option, cycling. Clicking an option
  // still jumps straight to it - we just synthesize a click on the next
  // button so its existing handler runs.
  function wireToggleAdvance(container) {
    if (!container || container.__advanceWired) return;
    container.__advanceWired = true;
    container.addEventListener('click', function (ev) {
      if (ev.target.closest('button')) return;   // a specific option was clicked
      var btns = [].slice.call(container.querySelectorAll('button')).filter(function (b) {
        return !b.disabled && b.getAttribute('data-unavailable') !== 'true';
      });
      if (btns.length < 2) return;
      var cur = -1;
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].getAttribute('aria-current') === 'true') { cur = i; break; }
      }
      btns[(cur + 1) % btns.length].click();
    });
  }

  // ---- Slider ----
  var views = document.getElementById('views');
  var slider = document.getElementById('slider');
  var winPick = document.getElementById('winPick');
  var enabledViews = [];
  VIEW_KEYS.forEach(function (key, sourceIndex) {
    var view = document.getElementById('v' + sourceIndex);
    var button = slider.querySelector('button[data-view="' + key + '"]');
    if (!CONFIG.views[key]) {
      // Keep the DOM available because shared routing/detail code references
      // these nodes, but take the view out of layout and navigation.
      if (view) view.hidden = true;
      if (button) button.remove();
      return;
    }
    if (view) {
      view.hidden = false;
      view.dataset.viewIndex = enabledViews.length;
      enabledViews.push({ key: key, sourceIndex: sourceIndex, el: view, button: button });
    }
  });
  var btns = enabledViews.map(function (v, i) {
    if (v.button) {
      v.button.dataset.i = i;
      v.button.setAttribute('aria-current', i === 0 ? 'true' : 'false');
    }
    return v.button;
  }).filter(Boolean);
  if (!CONFIG.timePeriodPickerVisible) winPick.hidden = true;
  function viewEnabled(key) { return !!CONFIG.views[key]; }
  function viewIndex(key) {
    for (var i = 0; i < enabledViews.length; i++) if (enabledViews[i].key === key) return i;
    return -1;
  }
  function goView(key) {
    var i = viewIndex(key);
    if (i < 0) i = 0;
    go(i);
  }
  function currentViewKey() {
    return enabledViews[currentView] ? enabledViews[currentView].key : enabledViews[0].key;
  }

  // Each view's title text. The shared static-head shows one of these
  // based on the current view; identical adjacent values mean the title
  // stays put with no fade (collage and stats both say Heard Recently).
  var VIEW_TITLES = {
    collage: 'Heard Recently', stats: 'Heard Recently',
    atlas: 'Avian Visitors', birdex: 'The Birdex'
  };
  var staticHead = document.querySelector('.static-head');
  var staticTitle = document.getElementById('staticTitle');
  function setTitleForView(i) {
    var next = VIEW_TITLES[enabledViews[i] ? enabledViews[i].key : 'collage'];
    if (!staticTitle || staticTitle.textContent === next) return;
    // Fade out -> swap text -> fade in. The opacity transition is 240ms;
    // we swap at ~half that so the eye doesn't catch the text change.
    staticHead.classList.add('swap-out');
    setTimeout(function () {
      staticTitle.textContent = next;
      // Force reflow before removing class so the transition restarts.
      void staticHead.offsetWidth;
      staticHead.classList.remove('swap-out');
    }, 220);
  }

  // The views slide horizontally over SLIDE_MS (see .views transition). For
  // stats + atlas we hold the load-in hidden until the slide has essentially
  // settled, so you watch the content populate *in* the view rather than it
  // finishing mid-slide. The lead is a touch under SLIDE_MS so the cascade
  // begins just as the view arrives - no dead pause, still snappy. Collage's
  // bloom reads fine mid-slide, so it starts immediately (no lead). Stats
  // reads as starting a hair slower than atlas, so it gets a shorter lead.
  var SLIDE_MS = 480;
  var SWITCH_LEAD = SLIDE_MS - 100;   // atlas
  var STATS_LEAD = SLIDE_MS - 200;    // stats - begin a touch sooner
  var currentView = 0;                // first enabled view shows first
  function go(i) {
    i = Math.max(0, Math.min(enabledViews.length - 1, i));
    // Only a genuine view *switch* replays the entrance. go() also fires when
    // a card is expanded while already on the atlas; that must not retrigger
    // the load-in.
    var switching = (i !== currentView);
    currentView = i;
    views.style.transform = 'translateX(-' + (i * 100) + '%)';
    btns.forEach(function (b, j) { b.setAttribute('aria-current', j === i ? 'true' : 'false'); });
    syncPill(slider);
    setTitleForView(i);
    if (!switching) return;
    var key = enabledViews[i].key;
    if (key === 'collage') playCollageEntrance();
    else if (key === 'stats') playStatsEntrance(STATS_LEAD);
    else if (key === 'atlas') playAtlasEntrance(SWITCH_LEAD);
    else if (key === 'birdex') playBirdexEntrance(SWITCH_LEAD);
  }
  btns.forEach(function (b) { b.addEventListener('click', function () { go(+b.dataset.i); }); });

  // ---- Window picker ----
  // Persist selections across reloads so a returning visitor lands on the
  // same view they left. Keys are namespaced so a future schema change
  // can be invalidated by bumping the prefix.
  function readLS(k, fallback) { try { return localStorage.getItem(k) || fallback; } catch (e) { return fallback; } }
  function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  // ---- Single-audio coordinator ----
  // Only one source plays at a time across the whole app: atlas-card
  // playback, modal recording playback, and the live stream each call
  // audioClaim(theirStopFn) the moment they start, which stops whatever
  // else was playing, and audioRelease(theirStopFn) when they stop on
  // their own. Keeps "start a new one -> the old one pauses" true even
  // across those three independent players.
  var __audioActiveStop = null;
  function audioClaim(stopSelf) {
    if (__audioActiveStop && __audioActiveStop !== stopSelf) {
      var prev = __audioActiveStop;
      __audioActiveStop = null;
      try { prev(); } catch (e) { }
    }
    __audioActiveStop = stopSelf;
  }
  function audioRelease(stopSelf) {
    if (__audioActiveStop === stopSelf) __audioActiveStop = null;
  }

  // ---- Theme (light / charcoal dark) ----
  // A per-device preference (localStorage), applied as data-theme on
  // <html>. An inline script in index.html sets it before first paint to
  // avoid a flash; this keeps it in sync and powers the Settings switcher.
  function applyTheme(name) {
    var t = name === 'dark' ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    writeLS('bird:theme', t);
  }
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  applyTheme(readLS('bird:theme', 'light'));
  var winBtns = [].slice.call(winPick.querySelectorAll('button'));
  var defaultHours = PERIOD_HOURS[CONFIG.defaultTimePeriod];
  var currentHours = CONFIG.timePeriodPickerVisible
    ? (+readLS('bird:window', String(defaultHours)) || defaultHours)
    : defaultHours;
  winBtns.forEach(function (b) {
    b.setAttribute('aria-current', (+b.dataset.h === currentHours) ? 'true' : 'false');
  });
  winBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      winBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      currentHours = +b.dataset.h;
      writeLS('bird:window', String(currentHours));
      syncPill(winPick);
      // Actual data refresh is wired below via refreshRecent().
    });
  });

  // Initial pill placement (after layout settles) + on resize.
  // Atlas sort segmented control - same pill-on-recess pattern.
  var atlasSortEl = document.getElementById('atlasSort');
  var atlasSortBtns = viewEnabled('atlas') && atlasSortEl
    ? [].slice.call(atlasSortEl.querySelectorAll('button')) : [];
  window.__atlasSort = readLS('bird:atlasSort', 'count');
  atlasSortBtns.forEach(function (b) {
    b.setAttribute('aria-current', (b.dataset.sort === window.__atlasSort) ? 'true' : 'false');
  });
  atlasSortBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      atlasSortBtns.forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      window.__atlasSort = b.dataset.sort;
      writeLS('bird:atlasSort', window.__atlasSort);
      syncPill(atlasSortEl);
      // Re-render the atlas with new sort, replaying the row-by-row
      // cascade so a filter change reads as a fresh stack load-in.
      renderAtlas(true);
    });
  });

  // Open-space click advances these segmented toggles to the next option.
  wireToggleAdvance(slider);
  if (CONFIG.timePeriodPickerVisible) wireToggleAdvance(winPick);
  if (viewEnabled('atlas')) {
    wireToggleAdvance(atlasSortEl);
    wireToggleAdvance(document.getElementById('modalPoseToggle'));
  }
  function syncAllPills() {
    syncPill(slider);
    if (CONFIG.timePeriodPickerVisible) syncPill(winPick);
    if (viewEnabled('atlas') && atlasSortEl) syncPill(atlasSortEl);
  }
  // The buttons size from text content; wait for fonts so width is correct.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncAllPills);
  }
  // Also sync after layout is definitely done.
  requestAnimationFrame(function () { requestAnimationFrame(syncAllPills); });
  var pillTimer;
  window.addEventListener('resize', function () {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(syncAllPills, 80);
  });

  // ---- Raster-bitmask collage with bird-shaped nesting ----
  // Each species ships a low-res binary alpha mask (cutout_masks.ts) that
  // matches the bird's actual outline. The layout maintains an occupancy
  // grid at viewport resolution; for each tile we spiral outward from the
  // cluster centre and pick the closest position where the tile's mask
  // doesn't overlap any already-placed mask. Result: birds nest into each
  // other's concavities (wing arc cradles tail, etc.) with a small visual
  // gap baked into the mask via Python-side dilation. No bbox overlap, no
  // rectangles touching - actual polygon-aware packing.

  var collage = document.getElementById('collage');
  // DIMS[slug]=[w,h] (aspect) and MASKS[slug]={w,h,bits} (1-bit silhouette)
  // are built offline by scripts/build_masks.py and fetched from dims.json /
  // masks.json at load. They live in their own files (one key per line) so a
  // species-add is a clean diff and two contributors' additions don't collide,
  // instead of rewriting one ~800KB line and conflicting on every merge.
  var DIMS = {}, MASKS = {}, tablesReady = false;
  (function loadTables() {
    // DIMS/MASKS belong to the collage and Birdex. If both views are disabled,
    // skip their round trips entirely.
    if (!viewEnabled('collage') && !viewEnabled('birdex')) return;
    var q = '?v=' + SKETCH_VERSION;
    Promise.all([
      fetch('./dims.json' + q).then(function (r) { return r.json(); }),
      fetch('./masks.json' + q).then(function (r) { return r.json(); })
    ]).then(function (t) {
      DIMS = t[0]; MASKS = t[1]; tablesReady = true;
      if (viewEnabled('collage')) try { renderCollageFromData(); } catch (e) { }
      if (viewEnabled('birdex')) try { renderBirdex(); } catch (e) { }
    }).catch(function (e) {
      // Leave tablesReady false so renderCollage keeps waiting rather than
      // packing with no silhouettes. The empty-nest state still renders.
      if (window.console) console.error('collage: dims/masks failed to load', e);
    });
  })();

  // Tunables - Galliformes-poster-inspired. Raster-mask nesting.
  //
  // Layout discipline: tile areas are NORMALISED against a viewport
  // budget (sum of areas ≈ packingBudgetFrac × vpArea) rather than
  // each tile being clamped to a per-tile maxArea. The old per-tile
  // cap made every loud bird look identical (Anna n=398, Crow n=31
  // and Phoebe n=26 all hit ceiling and rendered the same size) AND
  // it allowed total area to overflow narrow viewports so birds got
  // dropped off-screen. Normalising fixes both - relative size
  // tracks the relative call ratio, and total area can never exceed
  // what the iterative shrink loop is willing to scale into the
  // viewport.
  function tuning(n) {
    return {
      // Soft area budget the whole cluster aims to fill, as a
      // fraction of viewport area. Lower = sparser collage with more
      // breathing room (and more headroom for packing efficiency).
      // Steps down as species count grows so a busy plate doesn't
      // try to claim the entire viewport.
      packingBudgetFrac: n <= 4 ? 0.46 :
        n <= 12 ? 0.40 :
          n <= 24 ? 0.34 :
            0.28,
      // Count -> area exponent. ~0.65 keeps the visual hierarchy
      // legible (n=400 reads ~5× bigger than n=30) without the
      // loudest bird drowning everything else.
      countExp: 0.65,
      // Floor: every species in the dataset must be visible, even
      // n=1. Tracks species count so a tiny rare bird stays
      // recognisable on a crowded plate.
      minTileAreaFrac: n <= 8 ? 0.0100 :
        n <= 20 ? 0.0075 :
          0.0055,
      // Wider clusters for landscape viewports, more so as n grows.
      ellipseAspectBias: 2.1,
    };
  }
  var GRID_STRIDE = 4; // viewport px per occupancy cell; smaller = slower
  var COLLAGE_PAD = 3; // breathing room (grid cells) around each bird;
  // eased on narrow screens where birds are smaller.
  var FLY_PROB = 0.15; // chance a bird shows in its flight pose (rare); perched
  // otherwise. Rolled once per window appearance.
  var collagePose = {}; // sci -> 1 perched | 2 flight, persisted across polls;
  // cleared when a bird leaves the window so it rerolls.

  // Decode and cache each mask once. Sparse cell-list form (only "on"
  // cells) makes collision tests linear in opaque area, not total area.
  var maskCache = {};
  function loadMask(slug) {
    if (maskCache[slug]) return maskCache[slug];
    var rec = MASKS[slug];
    if (!rec) return null;
    var bytes = atob(rec.bits);
    var w = rec.w, h = rec.h;
    var cells = [];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        var b = bytes.charCodeAt(i >> 3);
        if ((b >> (7 - (i & 7))) & 1) cells.push([x, y]);
      }
    }
    return (maskCache[slug] = { w: w, h: h, cells: cells });
  }

  function slugify(sci) {
    return sci.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
  function aspect(sci) {
    var d = DIMS[slugify(sci)];
    return d ? d[0] / d[1] : 1.4;
  }

  // Mask-aware nester. tiles: { fullW, fullH, mask, data }. Returns the
  // same tiles with .x, .y assigned (top-left in viewport coords).
  function maskPack(tiles, W, H, xBias, yBias, pad) {
    var GW = Math.ceil(W / GRID_STRIDE) + 2;
    var GH = Math.ceil(H / GRID_STRIDE) + 2;
    var grid = new Uint8Array(GW * GH);

    function cellRange(tile, tx, ty, c) {
      // For mask cell (c[0], c[1]), return [gx0, gy0, gx1, gy1] (inclusive)
      // in grid coords, clamped to the grid.
      var sx = tile.fullW / tile.mask.w;
      var sy = tile.fullH / tile.mask.h;
      var x0 = (tx + c[0] * sx) / GRID_STRIDE | 0;
      var y0 = (ty + c[1] * sy) / GRID_STRIDE | 0;
      var x1 = (tx + (c[0] + 1) * sx) / GRID_STRIDE | 0;
      var y1 = (ty + (c[1] + 1) * sy) / GRID_STRIDE | 0;
      if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
      if (x1 >= GW) x1 = GW - 1; if (y1 >= GH) y1 = GH - 1;
      return [x0, y0, x1, y1];
    }
    function collides(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        for (var gy = r[1]; gy <= r[3]; gy++) {
          var off = gy * GW;
          for (var gx = r[0]; gx <= r[2]; gx++) {
            if (grid[off + gx]) return true;
          }
        }
      }
      return false;
    }
    function stamp(tile, tx, ty) {
      var cells = tile.mask.cells;
      for (var i = 0; i < cells.length; i++) {
        var r = cellRange(tile, tx, ty, cells[i]);
        // Dilate the stamped footprint by `pad` cells so the next bird can't
        // pack right up against this one - a uniform gap around every
        // silhouette. collides() stays unpadded, so the gap is added once.
        var gy0 = r[1] - pad, gy1 = r[3] + pad;
        var gx0 = r[0] - pad, gx1 = r[2] + pad;
        if (gy0 < 0) gy0 = 0; if (gx0 < 0) gx0 = 0;
        if (gy1 >= GH) gy1 = GH - 1; if (gx1 >= GW) gx1 = GW - 1;
        for (var gy = gy0; gy <= gy1; gy++) {
          var off = gy * GW;
          for (var gx = gx0; gx <= gx1; gx++) grid[off + gx] = 1;
        }
      }
    }
    function offGrid(tile, tx, ty) {
      // True if the rendered tile bbox extends past the viewport.
      return tx < 0 || ty < 0 || tx + tile.fullW > W || ty + tile.fullH > H;
    }

    var cx = W / 2, cy = H / 2;
    // Largest first so the cluster grows around the anchor.
    tiles.sort(function (a, b) { return (b.fullW * b.fullH) - (a.fullW * a.fullH); });
    var placed = [];
    // Seeded PRNG keeps the layout stable across resizes.
    var seed = 0x9E3779B9;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var tx, ty;
      if (i === 0) {
        tx = cx - t.fullW / 2;
        ty = cy - t.fullH / 2;
        t.x = tx; t.y = ty;
        stamp(t, tx, ty);
        placed.push(t);
        continue;
      }
      // Spiral outward. Stop the first ring that yields any non-colliding
      // position - that ring is the tightest possible distance from
      // centre. Within the ring, pick the position closest to the centre
      // of mass of already-placed tiles (so cluster grows organically,
      // not in fixed directions).
      var comX = 0, comY = 0, comW = 0;
      placed.forEach(function (p) {
        var a = p.fullW * p.fullH;
        comX += (p.x + p.fullW / 2) * a;
        comY += (p.y + p.fullH / 2) * a;
        comW += a;
      });
      comX /= comW; comY /= comW;

      var best = null, bestCost = Infinity;
      var step = Math.max(GRID_STRIDE, Math.min(t.fullW, t.fullH) * 0.05);
      var maxR = Math.max(W, H);
      var foundRing = -1;
      var phase = rand() * Math.PI * 2;
      for (var r = 0; r <= maxR; r += step) {
        if (foundRing >= 0 && r > foundRing + step * 2) break;
        var samples = Math.max(36, Math.floor(r / 1.6));
        for (var k = 0; k < samples; k++) {
          var theta = phase + (k / samples) * Math.PI * 2;
          // Elliptical ring - stretched per axis: xBias>yBias gives a wide
          // (landscape) cluster, yBias>xBias a tall (portrait) one.
          var px = cx + r * xBias * Math.cos(theta) - t.fullW / 2;
          var py = cy + r * yBias * Math.sin(theta) - t.fullH / 2;
          if (offGrid(t, px, py)) continue;
          if (collides(t, px, py)) continue;
          // Distance to existing cluster centre of mass + small noise.
          var dxx = (px + t.fullW / 2 - comX);
          var dyy = (py + t.fullH / 2 - comY);
          var cost = Math.hypot(dxx / xBias, dyy / yBias) + rand() * step * 0.5;
          if (cost < bestCost) { bestCost = cost; best = { x: px, y: py }; }
        }
        if (best && foundRing < 0) foundRing = r;
      }
      if (best) {
        t.x = best.x; t.y = best.y;
        stamp(t, best.x, best.y);
        placed.push(t);
      } else {
        // Couldn't fit anywhere - hide off-screen rather than overlap.
        t.x = -99999; t.y = -99999;
        placed.push(t);
      }
    }
    return placed;
  }

  function renderCollage(items, animate) {
    if (!viewEnabled('collage')) return;
    collage.innerHTML = '';
    // Drop the previous render's hit-test tiles up front so a click or hover on
    // the empty-nest state (or a collage that hasn't laid out yet) resolves to
    // nothing, not to a stale bird from the last populated render. The populated
    // path repopulates collagePlaced once the new tiles are placed.
    collagePlaced = [];
    collageHovered = null;
    if (!items.length) {
      // No birds heard yet: show an empty nest where the collage would be, with
      // the status line beneath it. The frame (shoot.py) overrides the .empty
      // text for the e-ink panel; the nest illustration is shared by both.
      collage.innerHTML = '<div class="empty-nest">' +
        '<img class="nest-img" src="nest.webp" alt="an empty nest" decoding="async">' +
        '<p class="empty">no birds heard in this window.</p></div>';
      // Bloom the nest in on the same cues as the collage (first load, window
      // change, view switch); a silent poll/resize renders without animate. The
      // class self-clears after the worst case so a throttled tab still ends
      // with the nest visible, mirroring the tile entrance's safety net.
      if (animate) {
        var enest = collage.firstChild;
        enest.classList.add('entering');
        clearTimeout(collageEntranceT);
        collageEntranceT = setTimeout(function () { enest.classList.remove('entering'); }, 900);
      }
      return;
    }
    // Silhouettes (DIMS/MASKS) load async from dims.json/masks.json; until
    // they arrive we cannot pack. Defer and retry, like the !W/!H case below.
    // (The empty-nest path above needs no silhouettes and already returned.)
    if (!tablesReady) { setTimeout(function () { renderCollage(items, animate); }, 80); return; }
    var W = collage.clientWidth, H = collage.clientHeight;
    if (!W || !H) { setTimeout(function () { renderCollage(items, animate); }, 80); return; }

    // Tuning depends on bird count - same viewport, very different
    // pack densities for 6 vs 48 birds.
    var T = tuning(items.length);
    var vpArea = W * H;
    var budget = vpArea * T.packingBudgetFrac;
    var minArea = vpArea * T.minTileAreaFrac;

    // Step 1: build tiles + assign each a count-weighted SCORE (not a
    // final area yet). area-from-count uses a sub-linear exponent so
    // a 400-detection bird is visibly larger than a 30-detection bird
    // without dwarfing it.
    var tiles = items.map(function (s) {
      var base = slugify(s.sci);
      // Pose: perched by default, rarely flight (FLY_PROB), and only if a
      // flight render exists. Flight uses the <slug>-2 mask/aspect/image so
      // the wings-spread silhouette nests correctly.
      var pose = collagePose[s.sci];
      if (pose === undefined) {
        pose = (DIMS[base + '-2'] && Math.random() < FLY_PROB) ? 2 : 1;
        collagePose[s.sci] = pose;
      }
      var slug = pose === 2 ? base + '-2' : base;
      var mask = loadMask(slug);
      if (!mask && pose === 2) { pose = 1; slug = base; mask = loadMask(slug); collagePose[s.sci] = 1; }
      if (!mask) return null;
      var d = DIMS[slug];
      var n = +s.n; if (!n || isNaN(n)) n = 1;
      return {
        mask: mask, data: s, pose: pose,
        ar: d ? d[0] / d[1] : 1.4,
        score: Math.pow(Math.max(1, n), T.countExp),
      };
    }).filter(Boolean);
    // Reroll on re-entry: forget pose choices for species no longer in window.
    var present = {}; items.forEach(function (s) { present[s.sci] = 1; });
    Object.keys(collagePose).forEach(function (k) { if (!present[k]) delete collagePose[k]; });

    // Step 2: normalise so sum(area) ≈ budget. Then floor each tile
    // at minArea so even a 1-call bird stays legible.
    var sumScore = tiles.reduce(function (a, t) { return a + t.score; }, 0) || 1;
    tiles.forEach(function (t) {
      t.area = Math.max(minArea, budget * t.score / sumScore);
    });
    // After flooring, total may exceed budget; squeeze the over-budget
    // remainder out of the LARGER tiles (the ones above minArea) so
    // the floor on rare birds stays intact.
    var sumA = tiles.reduce(function (a, t) { return a + t.area; }, 0);
    if (sumA > budget) {
      var fixedSum = tiles.filter(function (t) { return t.area <= minArea + 1e-9; })
        .reduce(function (a, t) { return a + t.area; }, 0);
      var flexSum = sumA - fixedSum;
      var flexBudget = Math.max(0, budget - fixedSum);
      var shrink = flexSum > 0 ? Math.min(1, flexBudget / flexSum) : 1;
      tiles.forEach(function (t) {
        if (t.area > minArea + 1e-9) t.area *= shrink;
      });
    }
    // Step 3: derive width/height from area + per-species aspect.
    tiles.forEach(function (t) {
      t.fullW = Math.sqrt(t.area * t.ar);
      t.fullH = t.fullW / t.ar;
    });

    // Width-responsive: wide screens get a horizontal ellipse at full padding;
    // narrow/portrait screens a vertical ellipse with slightly tighter padding.
    var narrow = W <= 700;
    var xBias = narrow ? 1 : T.ellipseAspectBias;
    var yBias = narrow ? 1.7 : 1;   // gentler than the desktop bias so the
    // portrait cluster stays a bit wider / less tall
    var pad = narrow ? Math.max(1, COLLAGE_PAD - 1) : COLLAGE_PAD;
    var placed = maskPack(tiles, W, H, xBias, yBias, pad);

    // Scale-to-fit: iterate shrink + repack until every tile lands on
    // screen. The old single-pass version dropped birds when one pass
    // wasn't enough (narrow viewports + many species). Capped at 10
    // iterations - by then the linear scale is ~0.5 of original, more
    // than enough headroom for any viewport.
    function clusterBounds(arr) {
      var L = Infinity, R = -Infinity, T2 = Infinity, B = -Infinity;
      arr.forEach(function (t) {
        if (t.x < -1000) return;
        if (t.x < L) L = t.x;
        if (t.x + t.fullW > R) R = t.x + t.fullW;
        if (t.y < T2) T2 = t.y;
        if (t.y + t.fullH > B) B = t.y + t.fullH;
      });
      return { L: L, R: R, T: T2, B: B };
    }
    var b = clusterBounds(placed);
    for (var iter = 0; iter < 10; iter++) {
      var missing = placed.some(function (t) { return t.x < -1000; });
      var overflow = b.L < 0 || b.T < 0 || b.R > W || b.B > H;
      if (!missing && !overflow) break;
      // Base 0.93 linear shrink (≈ 0.86 area). If overflow, take the
      // tighter of cluster-to-viewport ratios so we converge fast.
      var scale = 0.93;
      if (overflow) {
        var clW = b.R - b.L, clH = b.B - b.T;
        var sx = (W * 0.96) / Math.max(clW, W * 0.96);
        var sy = (H * 0.94) / Math.max(clH, H * 0.94);
        scale = Math.min(scale, sx, sy);
      }
      tiles.forEach(function (t) { t.fullW *= scale; t.fullH *= scale; });
      placed = maskPack(tiles, W, H, xBias, yBias, pad);
      b = clusterBounds(placed);
    }

    // Re-centre the cluster in the viewport so a small cluster doesn't
    // drift to one side from the spiral's center-of-mass bias.
    var dx = W / 2 - (b.L + b.R) / 2;
    var dy = H / 2 - (b.T + b.B) / 2;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      placed.forEach(function (t) { if (t.x > -1000) { t.x += dx; t.y += dy; } });
    }

    placed.forEach(function (r) {
      var s = r.data;
      // ?v=SKETCH_VERSION busts the browser/CDN cache when illustrations
      // are re-rendered; see illustrationSrc.
      var img = illustrationSrc(s.sci, 1);
      var btn = document.createElement('button');
      btn.className = 'gtile';
      btn.type = 'button';
      btn.setAttribute('data-sci', s.sci);
      btn.setAttribute('aria-label', s.com);
      // Fallback for keyboard / screen-reader users - the visible hover
      // pill below is the primary affordance for sighted mouse users.
      // "calls" (not "heard") because one bird can rack up dozens of
      // detections in a session; "heard" implies distinct individuals.
      var titleN = +s.n || 0;
      btn.title = (s.com || s.sci) + ' · ' + fmtN(titleN) + ' ' +
        (titleN === 1 ? 'call' : 'calls') + ' ' + windowLabel(currentHours);
      btn.style.left = r.x + 'px';
      btn.style.top = r.y + 'px';
      btn.style.width = r.fullW + 'px';
      btn.style.height = r.fullH + 'px';
      btn.innerHTML = '<img loading="lazy" decoding="async" src="' + img + '" alt="' + s.com + '">';
      r.el = btn;
      collage.appendChild(btn);
    });
    // Hover pill - created once per render so collage.innerHTML='' at
    // the top of this function doesn't strand a stale node. mousemove
    // populates its text from hit.data so the count is whatever the
    // current window's data says.
    var tip = document.createElement('div');
    tip.id = 'collageTip';
    tip.className = 'collage-tip';
    tip.setAttribute('aria-hidden', 'true');
    collage.appendChild(tip);
    // Stash the placed tiles so the alpha-mask hit-tester (below) can
    // resolve which silhouette the cursor is actually over.
    collagePlaced = placed.filter(function (t) { return t.x > -1000; });

    // Bloom the birds in from the centre outward, but only when asked
    // (first load, window change, view switch) - never on the silent 30s
    // poll or a resize, which render without the animate flag.
    if (animate) playCollageEntrance();
  }

  // Staggered centre-out entrance: each tile fades + scales in, delayed by
  // its distance from the collage centre, so the flock blooms from the
  // middle out. Re-applied with a reflow reset so it can replay on demand
  // (e.g. switching back to the collage view).
  var collageEntranceT = null;
  function playCollageEntrance() {
    var tiles = [].slice.call(collage.querySelectorAll('.gtile'));
    if (!tiles.length) return;
    var cx = collage.clientWidth / 2, cy = collage.clientHeight / 2;
    var maxD = 1;
    var info = tiles.map(function (t) {
      var d = Math.hypot((t.offsetLeft + t.offsetWidth / 2) - cx,
        (t.offsetTop + t.offsetHeight / 2) - cy);
      if (d > maxD) maxD = d;
      return { el: t, d: d };
    });
    var SPREAD = 520;   // ms from the centre bird to the outermost
    info.forEach(function (o) {
      o.el.classList.remove('entering');
      o.el.style.animationDelay = ((o.d / maxD) * SPREAD).toFixed(0) + 'ms';
    });
    void collage.offsetWidth;   // commit the reset so the animation replays
    info.forEach(function (o) { o.el.classList.add('entering'); });
    // Safety net: the keyframe starts the tiles hidden (backwards fill), so
    // if the animation never advances (a backgrounded/throttled tab where
    // CSS animation time is frozen), strip the class after the bloom's
    // worst-case duration so the birds always end visible. A no-op when the
    // animation ran normally - it's already at the base (visible) state.
    clearTimeout(collageEntranceT);
    collageEntranceT = setTimeout(function () {
      info.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = ''; });
    }, SPREAD + 520);
  }

  // Atlas entrance: cards rise + fade in row by row, top to bottom. Cards
  // sharing an offsetTop are one row, so they appear together; each row
  // down adds a small delay (capped so a long lifelist doesn't crawl).
  var atlasEntranceT = null;
  // lead: ms to hold every card hidden before the cascade starts. On a view
  // switch this is set to ~the view-slide duration so the row-by-row load-in
  // begins as the view settles (not while it's still sliding in). The cards'
  // `backwards` fill keeps them hidden during the lead, so there's no flash.
  // In-place re-renders (sort change) pass no lead - they fire immediately.
  function playAtlasEntrance(lead) {
    lead = lead || 0;
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;
    var cards = [].slice.call(grid.querySelectorAll('.bird-card'));
    if (!cards.length) return;
    var uniqTops = cards.map(function (c) { return c.offsetTop; })
      .sort(function (a, b) { return a - b; })
      .filter(function (v, i, a) { return i === 0 || v !== a[i - 1]; });
    var rowOf = {}; uniqTops.forEach(function (t, i) { rowOf[t] = i; });
    // Each row trails the one above by PER_ROW ms. At 90ms against the 480ms
    // card animation the rows clearly cascade top-to-bottom (a row starts when
    // the one above is ~1/5 in) instead of reading as one simultaneous fade.
    // MAX_ROW caps the stagger so a long lifelist's off-screen rows don't crawl.
    var PER_ROW = 90, MAX_ROW = 10;
    cards.forEach(function (c) {
      c.classList.remove('entering');
      c.style.animationDelay = (lead + Math.min(rowOf[c.offsetTop] || 0, MAX_ROW) * PER_ROW) + 'ms';
    });
    void grid.offsetWidth;
    cards.forEach(function (c) { c.classList.add('entering'); });
    clearTimeout(atlasEntranceT);
    atlasEntranceT = setTimeout(function () {
      cards.forEach(function (c) { c.classList.remove('entering'); c.style.animationDelay = ''; });
    }, lead + MAX_ROW * PER_ROW + 540);
  }

  // Stats entrance: timeline columns fade in left -> right (by their x
  // position), with the side panel fading in just behind. Opacity only.
  var statsEntranceT = null;
  // lead: see playAtlasEntrance. On a view switch the whole graph is held
  // hidden until the slide settles, then populates left-to-right; in-place
  // re-renders (window-picker change) pass no lead and animate immediately.
  function playStatsEntrance(lead) {
    lead = lead || 0;
    var plot = document.querySelector('.stats-tl-plot');
    if (!plot) return;
    var SPREAD = 460;
    // The whole graph populates left-to-right: columns, gridlines and
    // x-ticks stagger by their x%; the y-axis leads (delay 0) and the side
    // panel trails. animationDelay carries the per-element offset.
    var items = [].slice.call(plot.querySelectorAll('.stats-tl-col, .stats-tl-gridline, .stats-tl-xtick'))
      .map(function (el) { return { el: el, d: ((parseFloat(el.style.left) || 0) / 100) * SPREAD }; });
    var yaxis = document.querySelector('.stats-tl-yaxis');
    if (yaxis) items.push({ el: yaxis, d: 0 });
    // Side panel loads in tandem: section headers + captions lead, then
    // their rows populate top-to-bottom over the same window as the graph.
    var side = document.querySelector('.stats-side');
    if (side) {
      [].slice.call(side.querySelectorAll('h3, small')).forEach(function (el) { items.push({ el: el, d: 40 }); });
      var rows = [].slice.call(side.querySelectorAll('li'));
      rows.forEach(function (el, i) { items.push({ el: el, d: 80 + (i / Math.max(1, rows.length - 1)) * SPREAD }); });
    }
    items.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = Math.round(lead + o.d) + 'ms'; });
    void plot.offsetWidth;
    items.forEach(function (o) { o.el.classList.add('entering'); });
    clearTimeout(statsEntranceT);
    statsEntranceT = setTimeout(function () {
      items.forEach(function (o) { o.el.classList.remove('entering'); o.el.style.animationDelay = ''; });
    }, lead + SPREAD + 560);
  }

  // ---- Alpha-mask hover/click hit-testing ----
  // The .gtile buttons are rectangles and their bounding boxes overlap
  // (tight nesting). A plain :hover would light up whichever rectangle
  // is on top - often not the bird under the cursor. So we hit-test
  // the cursor against each tile's binary alpha mask and only the
  // genuinely-hit silhouette gets .is-hover / receives the click.
  var collagePlaced = [];
  var collageHovered = null;
  function maskHitTest(clientX, clientY) {
    var box = collage.getBoundingClientRect();
    var px = clientX - box.left, py = clientY - box.top;
    // Iterate topmost-first (later in DOM = painted on top).
    for (var i = collagePlaced.length - 1; i >= 0; i--) {
      var t = collagePlaced[i];
      if (px < t.x || py < t.y || px > t.x + t.fullW || py > t.y + t.fullH) continue;
      var mx = ((px - t.x) / t.fullW * t.mask.w) | 0;
      var my = ((py - t.y) / t.fullH * t.mask.h) | 0;
      // Build a fast lookup set once per mask.
      if (!t.mask._set) {
        var set = {};
        var cells = t.mask.cells;
        for (var c = 0; c < cells.length; c++) set[cells[c][0] + '|' + cells[c][1]] = 1;
        t.mask._set = set;
      }
      if (t.mask._set[mx + '|' + my]) return t;
    }
    return null;
  }
  collage.addEventListener('mousemove', function (ev) {
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (hit === collageHovered) return;
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = hit;
    if (hit && hit.el) hit.el.classList.add('is-hover');
    collage.style.cursor = hit ? 'pointer' : 'default';
    var tip = document.getElementById('collageTip');
    if (tip) {
      if (hit) {
        var s = hit.data;
        var n = +s.n || 0;
        var noun = (n === 1) ? 'call' : 'calls';
        tip.innerHTML = '<span class="ct-name">' + (s.com || s.sci) + '</span>'
          + '<span class="ct-w"> - </span>'
          + '<span class="ct-n">' + fmtN(n) + '</span>'
          + '<span class="ct-w"> ' + noun + ' ' + windowLabel(currentHours) + '</span>';
        tip.setAttribute('aria-hidden', 'false');
      } else {
        tip.setAttribute('aria-hidden', 'true');
      }
    }
  });
  collage.addEventListener('mouseleave', function () {
    if (collageHovered && collageHovered.el) collageHovered.el.classList.remove('is-hover');
    collageHovered = null;
    var tip = document.getElementById('collageTip');
    if (tip) tip.setAttribute('aria-hidden', 'true');
  });
  collage.addEventListener('click', function (ev) {
    if (!viewEnabled('atlas')) return;
    var hit = maskHitTest(ev.clientX, ev.clientY);
    if (!hit) return;
    // Only set the hash - syncRouter does the go(2), so it can first record
    // that we came from the collage and return here when the card closes.
    location.hash = '#sci=' + encodeURIComponent(hit.data.sci);
  });

  // Debug hook - call __layout({ slugs, weights, n }) from devtools to
  // re-render the collage with a custom item set. Lets us prove the
  // nester handles 6/12/24/48 birds and varied size hierarchies without
  // touching the source.
  window.__layout = function (opts) {
    opts = opts || {};
    var allSlugs = Object.keys({ "acanthis-flammea": [560, 372], "accipiter-cooperii": [558, 560], "accipiter-gentilis": [558, 560], "accipiter-striatus": [375, 560], "actitis-macularius": [560, 409], "aechmophorus-occidentalis": [525, 560], "aegolius-acadicus": [560, 558], "aeronautes-saxatalis": [560, 439], "agelaius-phoeniceus": [276, 560], "aix-sponsa": [560, 378], "ammodramus-savannarum": [560, 436], "amphispiza-bilineata": [560, 559], "anas-crecca": [560, 288], "anas-platyrhynchos": [558, 560], "anser-albifrons": [560, 439], "anthus-rubescens": [375, 560], "aphelocoma-californica": [560, 373], "aphelocoma-woodhouseii": [468, 560], "aquila-chrysaetos": [437, 560], "archilochus-alexandri": [560, 344], "ardea-alba": [560, 465], "ardea-herodias": [560, 373], "artemisiospiza-belli": [560, 435], "asio-flammeus": [560, 560], "asio-otus": [404, 560], "athene-cunicularia": [560, 373], "aythya-affinis": [560, 372], "aythya-americana": [560, 553], "aythya-collaris": [560, 373], "aythya-valisineria": [560, 373], "baeolophus-inornatus": [560, 311], "bombycilla-cedrorum": [339, 560], "bombycilla-garrulus": [560, 559], "branta-canadensis": [560, 559], "bubo-virginianus": [373, 560], "bubulcus-ibis": [267, 560], "bucephala-albeola": [560, 408], "bucephala-clangula": [560, 242], "buteo-jamaicensis": [560, 374], "buteo-lagopus": [560, 244], "buteo-lineatus": [463, 560], "buteo-regalis": [408, 560], "buteo-swainsoni": [560, 408], "butorides-virescens": [555, 560], "calamospiza-melanocorys": [560, 374], "calidris-alba": [560, 371], "calidris-alpina": [560, 374], "callipepla-californica": [560, 372], "calothorax-lucifer": [465, 560], "calypte-anna": [560, 344], "calypte-costae": [560, 409], "cardellina-pusilla": [560, 281], "cardellina-rubrifrons": [527, 560], "cathartes-aura": [376, 560], "catharus-guttatus": [560, 333], "catharus-ustulatus": [560, 408], "catherpes-mexicanus": [320, 560], "certhia-americana": [201, 560], "chaetura-vauxi": [560, 374], "charadrius-vociferus": [560, 408], "chondestes-grammacus": [560, 559], "chordeiles-minor": [560, 319], "cinclus-mexicanus": [560, 465], "circus-hudsonius": [372, 560], "cistothorus-palustris": [437, 560], "coccothraustes-vespertinus": [560, 466], "colaptes-auratus": [560, 560], "columba-livia": [560, 327], "columbina-passerina": [560, 559], "contopus-sordidulus": [560, 502], "coragyps-atratus": [560, 557], "corvus-brachyrhynchos": [560, 503], "corvus-corax": [343, 560], "cyanocitta-stelleri": [363, 560], "cygnus-buccinator": [560, 370], "cypseloides-niger": [560, 356], "dryobates-nuttallii": [560, 321], "dryobates-pubescens": [560, 558], "dryobates-villosus": [268, 560], "dryocopus-pileatus": [492, 560], "egretta-caerulea": [560, 321], "egretta-thula": [560, 374], "elanus-leucurus": [560, 378], "empidonax-difficilis": [268, 560], "empidonax-hammondii": [558, 560], "empidonax-oberholseri": [495, 560], "empidonax-traillii": [371, 560], "empidonax-wrightii": [560, 527], "eremophila-alpestris": [560, 529], "euphagus-cyanocephalus": [560, 371], "falco-columbarius": [560, 408], "falco-mexicanus": [349, 560], "falco-peregrinus": [465, 560], "falco-sparverius": [560, 370], "gavia-immer": [560, 374], "geothlypis-tolmiei": [560, 406], "geothlypis-trichas": [560, 316], "glaucidium-gnoma": [560, 560], "gymnogyps-californianus": [466, 560], "haemorhous-mexicanus": [523, 560], "haemorhous-purpureus": [560, 387], "haliaeetus-leucocephalus": [560, 434], "himantopus-mexicanus": [458, 560], "hirundo-rustica": [560, 410], "hydroprogne-caspia": [560, 373], "icteria-virens": [560, 293], "icterus-bullockii": [560, 214], "icterus-cucullatus": [391, 560], "icterus-galbula": [560, 528], "icterus-parisorum": [560, 266], "ixoreus-naevius": [560, 558], "junco-hyemalis": [560, 320], "lanius-ludovicianus": [408, 560], "larus-californicus": [560, 437], "larus-delawarensis": [560, 376], "larus-glaucescens": [560, 374], "larus-heermanni": [560, 436], "larus-occidentalis": [560, 412], "leiothlypis-celata": [522, 560], "leiothlypis-lucidae": [351, 560], "leucophaeus-atricilla": [560, 373], "leucophaeus-pipixcan": [560, 560], "leucosticte-tephrocotis": [560, 465], "limosa-fedoa": [560, 556], "lophodytes-cucullatus": [560, 409], "loxia-curvirostra": [560, 319], "mareca-americana": [560, 375], "mareca-strepera": [560, 372], "megaceryle-alcyon": [560, 409], "megascops-kennicottii": [560, 374], "melanerpes-formicivorus": [351, 560], "melanerpes-lewis": [372, 560], "meleagris-gallopavo": [560, 373], "melospiza-georgiana": [320, 560], "melospiza-lincolnii": [560, 245], "melospiza-melodia": [560, 352], "melozone-aberti": [560, 268], "melozone-crissalis": [560, 538], "melozone-fusca": [560, 495], "mergus-merganser": [560, 374], "mimus-polyglottos": [560, 310], "mniotilta-varia": [560, 351], "molothrus-ater": [560, 505], "myadestes-townsendi": [560, 436], "myiarchus-cinerascens": [560, 532], "nucifraga-columbiana": [560, 373], "numenius-americanus": [558, 560], "nycticorax-nycticorax": [560, 465], "oreothlypis-ruficapilla": [372, 560], "pandion-haliaetus": [560, 371], "passer-domesticus": [560, 444], "passerculus-sandwichensis": [560, 542], "passerella-iliaca": [560, 350], "passerina-amoena": [560, 465], "passerina-cyanea": [560, 560], "patagioenas-fasciata": [560, 500], "pelecanus-erythrorhynchos": [560, 316], "pelecanus-occidentalis": [560, 406], "perisoreus-canadensis": [560, 349], "petrochelidon-pyrrhonota": [558, 560], "phainopepla-nitens": [560, 464], "phalacrocorax-auritus": [490, 560], "phalaenoptilus-nuttallii": [560, 373], "phasianus-colchicus": [560, 409], "pheucticus-melanocephalus": [559, 560], "pica-nuttalli": [560, 320], "picoides-arcticus": [374, 560], "pinicola-enucleator": [560, 372], "pipilo-chlorurus": [560, 318], "pipilo-erythrophthalmus": [352, 560], "pipilo-maculatus": [443, 560], "piranga-ludoviciana": [293, 560], "piranga-rubra": [560, 495], "plegadis-chihi": [560, 372], "podiceps-nigricollis": [560, 374], "podilymbus-podiceps": [560, 374], "poecile-gambeli": [560, 350], "poecile-rufescens": [560, 339], "polioptila-caerulea": [560, 557], "pooecetes-gramineus": [560, 436], "progne-subis": [313, 560], "psaltriparus-minimus": [560, 428], "quiscalus-mexicanus": [560, 269], "recurvirostra-americana": [268, 560], "regulus-calendula": [496, 560], "regulus-satrapa": [464, 560], "riparia-riparia": [560, 494], "rynchops-niger": [560, 374], "salpinctes-obsoletus": [560, 465], "sayornis-nigricans": [308, 560], "sayornis-saya": [463, 560], "selasphorus-platycercus": [560, 497], "selasphorus-rufus": [560, 436], "selasphorus-sasin": [434, 560], "setophaga-coronata": [461, 560], "setophaga-magnolia": [560, 268], "setophaga-nigrescens": [560, 350], "setophaga-occidentalis": [560, 367], "setophaga-palmarum": [438, 560], "setophaga-petechia": [560, 268], "setophaga-ruticilla": [560, 293], "setophaga-townsendi": [560, 416], "sialia-currucoides": [558, 560], "sialia-mexicana": [560, 371], "sitta-canadensis": [560, 379], "sitta-carolinensis": [436, 560], "sitta-pygmaea": [560, 407], "spatula-clypeata": [560, 408], "spatula-discors": [560, 493], "sphyrapicus-ruber": [560, 558], "sphyrapicus-thyroideus": [374, 560], "spinus-lawrencei": [560, 373], "spinus-pinus": [560, 516], "spinus-psaltria": [560, 548], "spinus-tristis": [536, 560], "spizella-atrogularis": [246, 560], "spizella-breweri": [560, 557], "spizella-passerina": [560, 320], "spizelloides-arborea": [560, 436], "stelgidopteryx-serripennis": [558, 560], "sterna-forsteri": [560, 373], "sterna-hirundo": [560, 411], "streptopelia-decaocto": [560, 393], "strix-occidentalis": [560, 553], "sturnella-neglecta": [320, 560], "sturnus-vulgaris": [560, 545], "tachycineta-bicolor": [375, 560], "tachycineta-thalassina": [560, 435], "thalasseus-elegans": [560, 407], "thryomanes-bewickii": [560, 263], "toxostoma-redivivum": [560, 298], "tringa-semipalmata": [560, 464], "troglodytes-aedon": [560, 494], "troglodytes-pacificus": [560, 407], "turdus-migratorius": [560, 402], "tyrannus-verticalis": [559, 560], "tyrannus-vociferans": [495, 560], "tyto-alba": [560, 464], "urile-penicillatus": [296, 560], "vireo-bellii": [560, 559], "vireo-cassinii": [560, 319], "vireo-gilvus": [464, 560], "vireo-huttoni": [410, 560], "xanthocephalus-xanthocephalus": [293, 560], "zenaida-asiatica": [560, 558], "zenaida-macroura": [522, 560], "zonotrichia-atricapilla": [560, 238], "zonotrichia-leucophrys": [560, 313], "zonotrichia-querula": [560, 294] });
    var slugs = opts.slugs || allSlugs.slice(0, opts.n || 12);
    var weights = opts.weights;
    var items = slugs.map(function (slug, i) {
      // Recover a sci name from the slug - capitalize first segment.
      var parts = slug.split('-');
      var sci = parts.slice(0, 2).map(function (p, j) { return j === 0 ? p[0].toUpperCase() + p.slice(1) : p; }).join(' ');
      var n;
      if (weights === 'uniform') n = 10;
      else if (weights === 'extreme') n = i === 0 ? 500 : 1;
      else if (Array.isArray(weights)) n = weights[i] || 1;
      else n = Math.pow(0.55, i) * 100; // default hierarchy
      return { sci: sci, com: sci, n: n };
    });
    renderCollage(items);
    return { rendered: items.length, mode: weights || 'hierarchy' };
  };

  // Collage renders whatever is in DATA.recent.species. When the picker
  // changes, refreshRecent() refetches and re-renders. Empty state shows
  // a "no detections in this window" message.
  function renderCollageFromData(animate) {
    if (!viewEnabled('collage')) return;
    var items = (DATA.recent && DATA.recent.species) || [];
    renderCollage(items, animate);
  }
  var rTimer;
  window.addEventListener('resize', function () {
    clearTimeout(rTimer);
    rTimer = setTimeout(function () {
      if (viewEnabled('collage')) renderCollageFromData();
      if (viewEnabled('stats')) drawHistograms();
    }, 120);
  });

  // ---- Stats / Atlas data ----
  function setRow(id, label, val) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '<span>' + label + '</span><span>' + (val == null || val === '' ? '-' : val) + '</span>';
  }
  function liRow(yr, label, ct, sci) {
    var attr = sci ? ' data-sci="' + sci.replace(/"/g, '&quot;') + '"' : '';
    return '<li' + attr + '><span class="yr">' + yr + '</span><span>' + label + '</span><span class="ct">' + (ct == null ? '-' : ct) + '</span></li>';
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtN(n) {
    if (n == null) return '-';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'k';
    return n.toLocaleString();
  }
  // Compact count for atlas cards (1K, 1.2K); the modal keeps the exact number.
  function fmtNK(n) {
    if (n == null) return '-';
    return n < 1000 ? n.toLocaleString() : +(n / 1000).toFixed(1) + 'K';
  }
  // Human label for the current time-window picker selection - replaces
  // a bare "window" with the span it actually covers. Thresholds match
  // the winPick buttons (1H / 12H / 24H / 7D / ALL).
  function windowLabel(h) {
    if (h <= 1) return 'this hour';
    if (h <= 12) return 'past 12h';
    if (h <= 24) return 'today';
    if (h <= 168) return 'this week';
    return 'all time';
  }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store', credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
  }

  // ==== birdnet-go API adapter ====
  // AvianVisitors was written against BirdNET-Pi's PHP facade over birds.db.
  // birdnet-go exposes a REST API instead, so this layer reshapes /api/v2
  // responses into the {sci, com, n, first_seen, last_seen} records the
  // renderers below already expect.
  //
  // API base. Same-origin by default; override with window.BNG_API_BASE
  // when the collage is served from a different host than birdnet-go.
  var API = (CONFIG.apiUrl || window.BNG_API_BASE || '') + '/api/v2';

  function apiUrl(path, params) {
    var url = API + path;
    var qs = Object.keys(params || {})
      .filter(function (k) { return params[k] !== undefined && params[k] !== null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
      .join('&');
    return qs ? url + '?' + qs : url;
  }

  // birdnet-go's analytics endpoints take YYYY-MM-DD, always in the
  // server's local timezone. Format from local parts (not toISOString,
  // which would shift to UTC and skip a day near midnight).
  function ymd(d) {
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }
  function daysAgoYmd(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return ymd(d);
  }
  // The window picker speaks hours; the analytics API speaks whole days.
  // Round up so a 1H window still asks for today, and clamp ALL (1e6 h)
  // to the project's start rather than requesting ~114 years of range.
  function windowStartYmd(hours) {
    if (hours >= 1000000) return '1970-01-01';
    return daysAgoYmd(Math.max(0, Math.ceil(hours / 24) - 1));
  }

  // /api/v2/analytics/species/summary -> the PHP `recent`/`lifelist` shape.
  // first_heard/last_heard arrive as RFC3339; the renderers parse
  // "YYYY-MM-DD HH:MM:SS", so normalize by dropping the zone and the T.
  function normalizeStamp(s) {
    if (!s) return '';
    return String(s).replace('T', ' ').replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, '');
  }
  function speciesRow(r) {
    return {
      sci: r.scientific_name,
      com: r.common_name || r.scientific_name,
      n: +r.count || 0,
      best_conf: +r.max_confidence || 0,
      first_seen: normalizeStamp(r.first_heard),
      last_seen: normalizeStamp(r.last_heard),
    };
  }
  function fetchSpeciesSummary(startDate) {
    return fetchJson(apiUrl('/analytics/species/summary', {
      start_date: startDate,
      end_date: ymd(new Date()),
    })).then(function (rows) {
      return { species: (rows || []).map(speciesRow) };
    });
  }

  // The analytics summary is day-granular, so 1H/12H/24H would all
  // collapse to "today". For those windows aggregate raw detections
  // instead, which carry a real timestamp.
  function aggregateDetections(rows, sinceMs) {
    var by = {};
    rows.forEach(function (d) {
      var t = Date.parse(d.date + 'T' + d.time);
      if (isNaN(t) || t < sinceMs) return;
      var k = d.scientificName;
      var e = by[k] || (by[k] = {
        sci: k, com: d.commonName || k, n: 0, best_conf: 0,
        first_seen: '', last_seen: '', _first: Infinity, _last: -Infinity,
      });
      e.n++;
      e.best_conf = Math.max(e.best_conf, +d.confidence || 0);
      if (t < e._first) { e._first = t; e.first_seen = d.date + ' ' + d.time; }
      if (t > e._last) { e._last = t; e.last_seen = d.date + ' ' + d.time; }
    });
    return Object.keys(by).map(function (k) {
      var e = by[k]; delete e._first; delete e._last; return e;
    });
  }

  // Sub-day windows can straddle midnight, so pull today and (when the
  // window reaches back past midnight) yesterday, then filter by cutoff.
  function fetchRecentWindow(hours) {
    var sinceMs = Date.now() - hours * 3600000;
    var days = [ymd(new Date())];
    if (new Date(sinceMs).getDate() !== new Date().getDate()) days.push(daysAgoYmd(1));
    return Promise.all(days.map(function (d) {
      return fetchJson(apiUrl('/detections', {
        queryType: 'day', date: d, numResults: 1000, sortBy: 'date_desc',
      })).catch(function () { return null; });
    })).then(function (pages) {
      var rows = pages.reduce(function (a, j) { return a.concat((j && j.data) || []); }, []);
      return { species: aggregateDetections(rows, sinceMs) };
    });
  }

  // One entry point for "the picked window", routing to whichever
  // endpoint has the granularity that window needs.
  function fetchWindow(hours) {
    return hours <= 24 ? fetchRecentWindow(hours) : fetchSpeciesSummary(windowStartYmd(hours));
  }

  // ---- Image + audio resolvers ----
  // cutout.php's lookup chain (bundled -> cached -> Wikipedia -> rembg)
  // can't run client-side. Bundled illustrations are served statically
  // from ./assets/; anything unbundled falls back to birdnet-go's media
  // proxy, which resolves via its own provider chain. onerror in the
  // markup handles the final 404.
  function illustrationSrc(sci, pose) {
    var n = +pose || 1;
    return './assets/illustrations/' + slugify(sci) + (n > 1 ? '-' + n : '') + '.png?v=' + SKETCH_VERSION;
  }
  function proxyImageSrc(sci) {
    return API + '/media/image/' + encodeURIComponent(sci);
  }
  // birdnet-go keys audio and spectrograms by numeric detection id, not
  // by filename the way BirdNET-Pi did. Every play path therefore goes
  // through a detection id resolved from the detections endpoint.
  function audioSrc(id) { return API + '/audio/' + encodeURIComponent(id); }

  // ---- Live data layer ----
  // All views read from this DATA object. Populated by fetchAll() on page
  // load and by refreshRecent() when the window picker changes.
  var STATS_DAYS = 30;
  var DATA = {
    stats: null,        // /dashboard/kpis + derived period counts
    lifelist: null,     // /analytics/species/summary over all time
    timeseries: null,   // /analytics/time/daily + /time/distribution/hourly
    firstseen: null,    // /analytics/species/detections/new
    recent: null,       // /analytics/species/summary over the picked window
  };

  // Derived chart arrays, backfilled so 30 buckets always exist.
  var STATS = {
    detPerDay: new Array(STATS_DAYS).fill(0), // [day] total detections
    specPerDay: new Array(STATS_DAYS).fill(0), // [day] unique species
    byHour: new Array(24).fill(0),         // [hour-of-day] detections
  };

  // Map sci -> all-time detection count, populated from lifelist for atlas.
  var speciesTotals = {};

  // Merge the two 30-day series into one continuous array of (days)
  // length ending today, zero-filling dates neither endpoint reported.
  // /analytics/time/daily gives {data:[{date, count}]} (detections) and
  // /analytics/species/diversity gives {data:[{date, unique_species}]}.
  function backfillDaily(ts, days) {
    var det = {}, spec = {};
    (((ts && ts.daily) || {}).data || []).forEach(function (r) { det[r.date] = +r.count || 0; });
    (((ts && ts.diversity) || {}).data || []).forEach(function (r) { spec[r.date] = +r.unique_species || 0; });
    var out = [];
    var today = new Date();
    for (var i = 0; i < days; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() - (days - 1 - i));
      var key = ymd(d);
      out.push({ detections: det[key] || 0, species: spec[key] || 0 });
    }
    return out;
  }

  function recomputeDerived() {
    var ts = DATA.timeseries || {};
    var ll = DATA.lifelist || { species: [] };
    var rows = backfillDaily(ts, STATS_DAYS);
    STATS.detPerDay = rows.map(function (r) { return r.detections; });
    STATS.specPerDay = rows.map(function (r) { return r.species; });
    // /analytics/time/distribution/hourly always returns all 24 hours.
    var byHour = new Array(24).fill(0);
    (ts.by_hour || []).forEach(function (r) { byHour[+r.hour] = +r.count || 0; });
    STATS.byHour = byHour;
    speciesTotals = {};
    (ll.species || []).forEach(function (s) { speciesTotals[s.sci] = +s.n; });
  }

  // Editorial detection timeline. One evenly-spaced column per species,
  // ordered oldest -> newest by last detection (x = time). Each species
  // owns a cell, so the black squares never overlap and a square fills
  // its column width - neighbours touch at the shared gridline. The
  // square's height up the column encodes detection count; a small
  // rotated label (common + scientific name) sits at the column's
  // bottom, and each column carries its own timestamp on the x-axis.
  function drawHistograms(animate) {
    if (!viewEnabled('stats')) return;
    var tl = document.getElementById('statsTimeline');
    if (!tl) return;
    var all = ((DATA.recent && DATA.recent.species) || []).slice();
    if (!all.length) {
      tl.innerHTML = '<div class="stats-tl-empty">no detections in this window</div>';
      return;
    }

    // Discrete columns. On a phone the columns are fixed-width and wider
    // (legible squares + labels for touch) and the plot grows past the
    // viewport to scroll horizontally - so we show ALL species rather than
    // trimming. On desktop, cap to whatever fits the available width.
    var isMobile = (window.innerWidth || 800) <= 700;
    var containerW = Math.max(140, (tl.clientWidth || window.innerWidth || 800) - 34);
    var MIN_COL = isMobile ? 52 : 22;
    var cap = isMobile ? all.length : Math.max(3, Math.floor(containerW / MIN_COL));
    var trimmed = all.length > cap;
    var species = all.slice();
    if (trimmed) {
      species.sort(function (a, b) { return (+b.n || 0) - (+a.n || 0); });
      species = species.slice(0, cap);
    }
    // X-axis is time: order the chosen columns oldest -> newest.
    function parseTs(s) { return s ? Date.parse(s.replace(' ', 'T')) : NaN; }
    species.sort(function (a, b) {
      var ta = parseTs(a.last_seen), tb = parseTs(b.last_seen);
      if (isNaN(ta)) return 1;
      if (isNaN(tb)) return -1;
      return ta - tb;
    });

    var C = species.length;
    var maxN = species.reduce(function (m, s) { return Math.max(m, +s.n || 0); }, 1);
    // Mobile: fixed wide columns -> plot can exceed the viewport and scroll.
    // Desktop: columns split the available width evenly.
    var colW = isMobile ? MIN_COL : (containerW / C);
    var plotW = isMobile ? Math.max(containerW, C * colW) : containerW;
    // Square fills its column so adjacent squares touch at the shared
    // gridline; capped so a few species don't render as giant blocks.
    var sq = Math.max(6, Math.min(colW, isMobile ? 60 : 48));
    var LABEL_GAP = 6;       // px between a square's top and its label
    var SPAN = 0.55;         // squares occupy the bottom this fraction of
    // the plot by count (y = quantity); the
    // rotated label floats just above each square.

    // Y-axis quantity ticks: 0..maxN, with maxN pinned on the top tick.
    var ticks = [];
    if (maxN <= 8) {
      for (var v = 0; v <= maxN; v++) ticks.push(v);
    } else {
      var divs = 4;
      for (var di = 0; di <= divs; di++) ticks.push(Math.round(maxN * di / divs));
      ticks[ticks.length - 1] = maxN;
    }
    var yaxis = ticks.map(function (v) {
      return '<span class="stats-tl-ytick" style="bottom:' + ((v / maxN) * SPAN * 100).toFixed(1) + '%">' + v + '</span>';
    }).join('');

    // One timestamp under each column - format follows the window length.
    function fmtTs(ms) {
      if (isNaN(ms)) return '';
      var d = new Date(ms);
      var p2 = function (n) { return n < 10 ? '0' + n : '' + n; };
      if (currentHours <= 36) return p2(d.getHours()) + ':' + p2(d.getMinutes());
      if (currentHours <= 75 * 24) return (d.getMonth() + 1) + '/' + d.getDate();
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    // Faint gridlines at every column boundary. Start at gi=1: the gi=0
    // line would sit on top of the y-axis rule (double line), so skip it.
    var gridlines = '';
    for (var gi = 1; gi <= C; gi++) {
      gridlines += '<i class="stats-tl-gridline" style="left:' + (gi / C * 100).toFixed(3) + '%"></i>';
    }

    var cols = '', xaxis = '';
    species.forEach(function (s, i) {
      var centerPct = (i + 0.5) / C * 100;
      var n = +s.n || 0;
      var bottomPct = (n / maxN) * SPAN * 100;   // square height = quantity
      cols += ''
        + '<div class="stats-tl-col" data-sci="' + s.sci + '" style="left:' + centerPct.toFixed(3) + '%;width:' + colW.toFixed(2) + 'px">'
        + '<div class="stats-tl-square" style="bottom:' + bottomPct.toFixed(1) + '%;width:' + sq.toFixed(1) + 'px;height:' + sq.toFixed(1) + 'px"></div>'
        + '<div class="stats-tl-label" style="bottom:calc(' + bottomPct.toFixed(1) + '% + ' + (sq + LABEL_GAP) + 'px)"><span class="com">' + (s.com || s.sci) + '</span><span class="sci">' + s.sci + '</span></div>'
        + '</div>';
      var lab = fmtTs(parseTs(s.last_seen));
      if (lab) xaxis += '<span class="stats-tl-xtick" style="left:' + centerPct.toFixed(3) + '%">' + lab + '</span>';
    });

    var note = trimmed
      ? '<div class="stats-tl-cap">' + C + ' most-heard of ' + all.length + '</div>'
      : '';
    tl.innerHTML =
      '<div class="stats-tl-yaxis">' + yaxis + '</div>'
      + '<div class="stats-tl-plot"' + (isMobile ? ' style="width:' + Math.round(plotW) + 'px"' : '') + '>'
      + gridlines + cols + xaxis
      + '</div>'
      + note;
    if (animate) playStatsEntrance();
  }

  // Cross-highlight between the timeline squares and the right-side
  // species lists. Delegated off the stats view so it survives the
  // periodic re-render of both halves.
  (function wireStatsHighlight() {
    var v1 = document.getElementById('v1');
    if (!v1) return;
    function setHi(sci, on) {
      if (!sci) return;
      var esc = sci.replace(/"/g, '\"');
      v1.querySelectorAll('.stats-tl-col[data-sci="' + esc + '"], .stats-side li[data-sci="' + esc + '"]')
        .forEach(function (el) { el.classList.toggle('sync-hi', on); });
    }
    v1.addEventListener('mouseover', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) setHi(el.getAttribute('data-sci'), true);
    });
    v1.addEventListener('mouseout', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-sci]');
      if (el) {
        // Only clear if we're actually leaving the element (not moving
        // to a child).
        var to = ev.relatedTarget;
        if (to && el.contains(to)) return;
        setHi(el.getAttribute('data-sci'), false);
      }
    });
  })();

  // The PHP facade returned pre-aggregated period counts in one call.
  // birdnet-go has no equivalent, so sum species-summary windows and
  // take lifetime species from /dashboard/kpis.
  function sumCounts(summary) {
    return ((summary && summary.species) || []).reduce(function (a, s) { return a + (+s.n || 0); }, 0);
  }
  function buildStats(kpis, lifelist, today, week, lastHour) {
    return {
      totals: { detections: sumCounts(lifelist), species: ((lifelist && lifelist.species) || []).length },
      today: {
        detections: (kpis && kpis.today_detections) || sumCounts(today),
        species: ((today && today.species) || []).length,
      },
      last_hour: { detections: lastHour || 0 },
      week: { detections: sumCounts(week), species: ((week && week.species) || []).length },
    };
  }

  // /analytics/species/detections/new -> the PHP `firstseen` shape.
  // Returns a bare array, newest-first, of
  // {scientific_name, common_name, first_heard_date, count_in_period}.
  function normalizeFirstSeen(rows) {
    return {
      species: (rows || []).map(function (r) {
        return {
          sci: r.scientific_name,
          com: r.common_name || r.scientific_name,
          first_seen: normalizeStamp(r.first_heard_date),
          total: +r.count_in_period || 0,
        };
      }),
    };
  }

  // "Last hour" reuses the sub-day window aggregator; sum its counts.
  function fetchLastHourCount() {
    return fetchRecentWindow(1).then(function (w) { return sumCounts(w); });
  }

  // ---- Side text lists ----
  function renderStatsLists() {
    if (!viewEnabled('stats')) return;
    var stats = DATA.stats || {};
    var recent = DATA.recent || { species: [] };
    var firstseen = DATA.firstseen || { species: [] };

    // By Period - derived in buildStats() from /dashboard/kpis plus the
    // summed species-summary windows.
    var last_hour = (stats.last_hour && stats.last_hour.detections) || 0;
    var today_det = (stats.today && stats.today.detections) || 0;
    var week_det = (stats.week && stats.week.detections) || 0;
    var all_det = (stats.totals && stats.totals.detections) || 0;
    document.getElementById('statsByPeriod').innerHTML =
      liRow('NOW', 'last hour', fmtN(last_hour))
      + liRow('TODAY', 'today', fmtN(today_det))
      + liRow('WEEK', 'last 7 days', fmtN(week_det))
      + liRow('ALL', 'all time', fmtN(all_det));

    // Top Species - top 5 species in the current window. The species
    // summary is not count-ordered, so re-sort by count here.
    var ranked = (recent.species || [])
      .slice()
      .sort(function (a, b) { return (+b.n) - (+a.n); })
      .slice(0, 5);
    document.getElementById('statsTopSpec').innerHTML = ranked.length
      ? ranked.map(function (s, i) { return liRow(pad(i + 1), s.com, fmtN(+s.n), s.sci); }).join('')
      : liRow('-', 'no detections in window', '');
    document.getElementById('statsTopSpecCap').textContent =
      'most-heard, ' + windowLabel(currentHours);

    // First Detections - newest additions to the life list, with a
    // "Xd ago" label computed from first_seen.
    var fs = (firstseen.species || []).slice(0, 5);
    var now = Date.now();
    document.getElementById('statsFirstSeen').innerHTML = fs.length
      ? fs.map(function (s) {
        var t = Date.parse((s.first_seen || '').replace(' ', 'T'));
        var label = '-';
        if (!isNaN(t)) {
          var daysAgo = Math.floor((now - t) / 86400000);
          label = daysAgo === 0 ? 'today' : daysAgo + 'd ago';
        }
        return liRow(label, s.com, '', s.sci);
      }).join('')
      : liRow('-', 'no detections yet', '');
  }

  // ---- Atlas: field-guide card grid ----
  function wikiUrl(sci) {
    return 'https://en.wikipedia.org/wiki/' + encodeURIComponent(sci.replace(/ /g, '_'));
  }
  // eBird's URL scheme is https://ebird.org/species/<code>, where <code> is a
  // stable 6-char taxonomy code. These used to live in a hand-written table of
  // a dozen species; they now come from birdex.json (Wikidata P3444, ~99% of
  // the roster), with two hand-set in tools/overrides.json where Wikidata
  // disagreed with the codes this site originally shipped.
  function ebirdUrl(sci) {
    var rec = BIRDEX && BIRDEX.species ? BIRDEX.species[birdexSlugFor(sci)] : null;
    var code = rec && rec.ebird;
    return code ? 'https://ebird.org/species/' + code : 'https://ebird.org/explore';
  }

  // Tiny inline icons - monochrome, ink-only, match the page palette.
  var ICON_PLAY = '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M3 2 L10 6 L3 10 Z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2" width="2.5" height="8"/><rect x="6.5" y="2" width="2.5" height="8"/></svg>';

  function renderAtlas(animate) {
    if (!viewEnabled('atlas')) return;
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;

    var lifelist = (DATA.lifelist && DATA.lifelist.species) || [];
    var recent = (DATA.recent && DATA.recent.species) || [];
    // Window count lookup: sci -> count in current window.
    var winBySci = {};
    recent.forEach(function (s) { winBySci[s.sci] = +s.n; });

    if (!lifelist.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No birds detected yet.</p>' +
        '<p class="hint">The atlas fills up as BirdNET-Go identifies new species.</p>' +
        '</div>';
      return;
    }

    // Time-window filter: when a windowed view is selected, only show
    // species heard in that window. ALL preserves the full lifelist.
    var isAllWindow = currentHours >= 1000000;
    var filtered = isAllWindow
      ? lifelist
      : lifelist.filter(function (s) { return (winBySci[s.sci] || 0) > 0; });
    if (!filtered.length) {
      grid.innerHTML = '<div class="atlas-empty">' +
        '<p>No detections in this window.</p>' +
        '<p class="hint">Try a longer time window.</p>' +
        '</div>';
      return;
    }

    // Sort by the atlas-sort segmented control (defaults to "count" =
    // most-heard all time).
    var sortMode = (window.__atlasSort) || 'count';
    var species = filtered.slice();
    if (sortMode === 'count') {
      species.sort(function (a, b) { return (+b.n) - (+a.n); });
    } else if (sortMode === 'recent') {
      species.sort(function (a, b) {
        return (b.last_seen || '').localeCompare(a.last_seen || '');
      });
    } else if (sortMode === 'alpha') {
      species.sort(function (a, b) {
        return (a.com || a.sci || '').localeCompare(b.com || b.sci || '');
      });
    }

    // A species is a "lifer" in the current view if its all-time first
    // detection falls inside the selected window - i.e. it was newly added
    // to the life list this 1h / 12h / 24h / 7d. Never shown for the ALL
    // window (every species would qualify against an open-ended span).
    var now = Date.now();
    var windowStartMs = now - currentHours * 3600000;
    grid.innerHTML = species.map(function (s) {
      var total = +s.n || 0;
      var win = winBySci[s.sci] || 0;
      var firstMs = Date.parse((s.first_seen || '').replace(' ', 'T'));
      var isLifer = !isAllWindow && !isNaN(firstMs) && firstMs >= windowStartMs;
      var sketchSrc = illustrationSrc(s.sci, 1);
      // The "all time" window makes the windowed count identical to the
      // all-time count - collapse to a single stat rather than print the
      // same number twice. Otherwise label the count with its span.
      var statRows = currentHours >= 1000000
        ? '<div><span class="n">' + fmtNK(total) + '</span><span class="lbl-inline">all time</span></div>'
        : '<div><span class="n">' + fmtNK(win) + '</span><span class="lbl-inline">' + windowLabel(currentHours) + '</span></div>'
        + '<div><span class="n">' + fmtNK(total) + '</span><span class="lbl-inline">all time</span></div>';
      return ''
        + '<article class="bird-card" data-sci="' + s.sci + '">'
        + (isLifer ? '<span class="lifer-badge" title="new to the life list in this window">lifer</span>' : '')
        + '<div class="stat">' + statRows + '</div>'
        + '<div class="img-wrap">'
        + '<img loading="lazy" decoding="async" src="' + sketchSrc + '" alt="' + s.com + '"'
        + ' onerror="this.onerror=null;this.src=\'' + proxyImageSrc(s.sci) + '\'">'
        + '</div>'
        + '<h3>' + s.com + '</h3>'
        + '<div class="sci">' + s.sci + '</div>'
        + '<div class="spectro-wrap" aria-hidden="true"></div>'
        + '<div class="actions">'
        + '<button type="button" class="chip play" data-action="play" aria-label="play recording">'
        + ICON_PLAY + '<span>play</span>'
        + '</button>'
        + '<a class="chip ext" href="' + wikiUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="Wikipedia">wiki</a>'
        + '<a class="chip ext" href="' + ebirdUrl(s.sci) + '" target="_blank" rel="noopener" aria-label="eBird">ebird</a>'
        + '</div>'
        + '</article>';
    }).join('');

    // Wire audio playback + spectrogram load.
    // - Only one card plays at a time. Clicking play on a different card
    //   stops the current one first.
    // - The spectrogram is lazily fetched on first play (saves a Pi hit
    //   for every card visible on initial render).
    // - If the recording endpoint 404s (no detection yet for this
    //   species), the button reverts and shows "no audio".
    var currentAudio = null;
    var currentBtn = null;
    function setBtnState(btn, state) {
      btn.setAttribute('data-state', state);
      if (state === 'playing') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PAUSE + '<span>stop</span>';
      } else if (state === 'loading') {
        btn.setAttribute('data-active', 'true');
        btn.innerHTML = ICON_PLAY + '<span>...</span>';
      } else if (state === 'missing') {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>no audio</span>';
        setTimeout(function () {
          if (btn.getAttribute('data-state') === 'missing') {
            btn.innerHTML = ICON_PLAY + '<span>play</span>';
            btn.setAttribute('data-state', 'idle');
          }
        }, 2200);
      } else {
        btn.setAttribute('data-active', 'false');
        btn.innerHTML = ICON_PLAY + '<span>play</span>';
      }
    }
    function clearProgressOn(card) {
      if (!card) return;
      var sw = card.querySelector('.spectro-wrap');
      if (sw) sw.style.setProperty('--prog', '0%');
      card.removeAttribute('data-playing');
    }
    function stopCurrent() {
      audioRelease(stopCurrent);
      if (currentAudio) {
        try { currentAudio.pause(); } catch (e) { }
        currentAudio = null;
      }
      if (currentBtn) {
        var card = currentBtn.closest('.bird-card');
        clearProgressOn(card);
        setBtnState(currentBtn, 'idle');
        currentBtn = null;
      }
    }
    grid.querySelectorAll('[data-action="play"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.bird-card');
        if (btn === currentBtn) { stopCurrent(); return; }
        stopCurrent();
        audioClaim(stopCurrent);   // stop any modal-recording / live-stream audio
        setBtnState(btn, 'loading');
        currentBtn = btn;

        // Atlas rows come from the analytics summary, which has counts but no
        // detection ids. Resolve the newest detection on first play, then cache
        // the full species response for the detail modal and later plays.
        var sci = card.dataset.sci;
        var loadSpecies = SPECIES_CACHE[sci]
          ? Promise.resolve(SPECIES_CACHE[sci])
          : fetchSpeciesDetail(sci).then(function (d) {
            SPECIES_CACHE[sci] = d; return d;
          });
        loadSpecies.then(function (d) {
          // The user may have stopped playback or the atlas may have rebuilt
          // while the request was in flight.
          if (currentBtn !== btn || !document.contains(card)) return;
          var first = (d.detections || [])[0];
          if (!first || first.id == null) {
            audioRelease(stopCurrent);
            setBtnState(btn, 'missing');
            clearProgressOn(card);
            currentBtn = null;
            return;
          }
          var aurl = audioSrc(first.id);

          // Render the spectrogram client-side from the recording's audio so
          // it matches the active theme. paintSpectrogram paints with the
          // --paper/--ink palette per data-theme (the same canvas the modal
          // recordings use), instead of a fixed-colour PNG that can't follow
          // light/dark mode. Decoded buffers are cached per URL.
          var spectroWrap = card.querySelector('.spectro-wrap');
          if (spectroWrap && !spectroWrap.firstChild) {
            var canvas = document.createElement('canvas');
            spectroWrap.appendChild(canvas);
            if (_decodedCache[aurl]) {
              paintSpectrogram(canvas, _decodedCache[aurl]);
            } else {
              var actx = getSpecCtx();
              if (actx) {
                fetch(aurl)
                  .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
                  .then(function (b) { return actx.decodeAudioData(b); })
                  .then(function (buf) {
                    _decodedCache[aurl] = buf;
                    // Guard on document containment, not spectroWrap.contains:
                    // a 30s refreshAll() poll can rebuild the atlas and detach
                    // this card mid-decode. The detached wrap still "contains"
                    // its canvas, but a detached node measures 0x0, which would
                    // trap paintSpectrogram in its size-retry loop forever.
                    if (document.contains(canvas)) paintSpectrogram(canvas, buf);
                  })
                  .catch(function () { if (spectroWrap.contains(canvas)) spectroWrap.removeChild(canvas); });
              } else {
                spectroWrap.removeChild(canvas);
              }
            }
          }

          // Start audio only after the detection id has been resolved.
          var audio = new Audio(aurl);
          audio.addEventListener('canplay', function () {
            if (currentBtn !== btn) return; // user clicked away
            setBtnState(btn, 'playing');
            card.setAttribute('data-playing', 'true');
            audio.play().catch(function () {
              if (currentBtn === btn) stopCurrent();
            });
          });
          // Progress bar on the spectrogram strip.
          audio.addEventListener('timeupdate', function () {
            if (currentBtn !== btn) return;
            var pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
            if (spectroWrap) spectroWrap.style.setProperty('--prog', pct.toFixed(1) + '%');
          });
          audio.addEventListener('ended', function () {
            if (currentBtn === btn) stopCurrent();
          });
          audio.addEventListener('error', function () {
            if (currentBtn === btn) {
              audioRelease(stopCurrent);
              setBtnState(btn, 'missing');
              clearProgressOn(card);
              currentAudio = null; currentBtn = null;
            }
          });
          currentAudio = audio;
          audio.load();
        }).catch(function () {
          if (currentBtn !== btn) return;
          audioRelease(stopCurrent);
          setBtnState(btn, 'missing');
          clearProgressOn(card);
          currentAudio = null; currentBtn = null;
        });
      });
    });

    // Spectrogram click = scrub to that position (if playing) or restart.
    grid.addEventListener('click', function (ev) {
      var sw = ev.target.closest && ev.target.closest('.spectro-wrap');
      if (!sw || !sw.firstChild) return;
      var card = sw.closest('.bird-card');
      var btn = card.querySelector('[data-action="play"]');
      // If this card is the active one, scrub.
      if (currentBtn === btn && currentAudio && currentAudio.duration) {
        var rect = sw.getBoundingClientRect();
        var pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        currentAudio.currentTime = pct * currentAudio.duration;
      } else {
        // Otherwise start playback from the top.
        btn.click();
      }
    });
    if (animate) playAtlasEntrance();
  }

  // ============ Birdex ============
  // A numbered field guide over the bundled illustration set. Every species
  // with art holds a permanent number; the ones this station has actually
  // heard are "registered" and show their plate, stats and blurb, while the
  // rest stay silhouetted at ??? until they turn up.
  //
  // Reference data (Avibase id, IUCN category, family, common name, blurb) is
  // baked into birdex.json by tools/build-birdex.py, so nothing on this path
  // touches a third-party service at runtime. Avibase in particular is never
  // fetched - it sits behind a Cloudflare challenge - we only deep-link it
  // using the identifiers Wikidata publishes for it.
  // Two files, split by load cost. birdex.json (~56KB) is the metadata that
  // drives the list and every outbound link, so it loads eagerly.
  // birdex-text.json (~390KB) is descriptions only, fetched the first time
  // something actually needs to show prose.
  //
  // They carry a matching content stamp. If the two ever disagree - a stale
  // cached half, a partial deploy - the text side is discarded rather than
  // rendered against the wrong roster, and entries fall back to "no
  // description" the same as if the file were missing entirely.
  var BIRDEX = null, birdexPromise = null;
  var BIRDEX_TEXT = null, birdexTextPromise = null;
  var birdexSel = null, birdexQuery = '';

  // Drop the elemental tags at the load boundary when they're switched off, so
  // nothing downstream has to know about the setting. Badges, the hover-free
  // table and the search index all read the same stripped data and can't
  // disagree about whether a bird is fire-type.
  function stripWhimsy(data) {
    if (CONFIG.birdex.elementalWhimsy || !data) return data;
    Object.keys(data.species || {}).forEach(function (slug) {
      var ty = data.species[slug].types;
      if (ty) { delete ty.element; delete ty.note; }
    });
    if (data.vocab) delete data.vocab.element;
    return data;
  }

  function loadBirdex() {
    if (!birdexPromise) {
      birdexPromise = fetch('./birdex.json?v=' + SKETCH_VERSION)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { BIRDEX = stripWhimsy(j); return BIRDEX; })
        .catch(function (e) { birdexPromise = null; throw e; });
    }
    return birdexPromise;
  }

  function loadBirdexText() {
    if (!birdexTextPromise) {
      birdexTextPromise = loadBirdex().then(function () {
        return fetch('./birdex-text.json?v=' + SKETCH_VERSION);
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (j.stamp && BIRDEX.stamp && j.stamp !== BIRDEX.stamp) {
          if (window.console) {
            console.warn('birdex: text/metadata stamp mismatch (' + j.stamp + ' vs ' +
              BIRDEX.stamp + ') - ignoring descriptions until caches agree');
          }
          BIRDEX_TEXT = { blurbs: {} };
        } else {
          BIRDEX_TEXT = j;
        }
        return BIRDEX_TEXT;
      }).catch(function (e) {
        // Resolve rather than reject: a missing description file must not take
        // an entry down with it. Null marks it as tried-and-unavailable so we
        // don't refetch on every selection.
        if (window.console) console.warn('birdex-text.json unavailable', e);
        BIRDEX_TEXT = { blurbs: {} };
        return BIRDEX_TEXT;
      });
    }
    return birdexTextPromise;
  }

  function blurbFor(slug) {
    return (BIRDEX_TEXT && BIRDEX_TEXT.blurbs && BIRDEX_TEXT.blurbs[slug]) || null;
  }

  // Trim to a character budget on a sentence boundary, keeping any paragraph
  // break that falls before the cut.
  function excerpt(text, maxChars) {
    if (!text || text.length <= maxChars) return text || '';
    var cut = text.lastIndexOf('. ', maxChars);
    if (cut > 140) return text.slice(0, cut + 1);
    return text.slice(0, maxChars).replace(/\s+\S*$/, '') + '…';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // BirdNET-Go reports whatever taxonomy its model was trained on, which
  // drifts from the names the art is filed under (Corthylio calendula vs
  // regulus-calendula). The alias map is built alongside birdex.json; without
  // it a species the station has genuinely heard would sit dark forever.
  function birdexSlugFor(sci) {
    var s = slugify(sci || '');
    return (BIRDEX && BIRDEX.aliases && BIRDEX.aliases[s]) || s;
  }

  // IUCN Red List categories are about global extinction risk, not abundance.
  // "Least concern" is the term of art but reads as a claim about how often
  // you'd see one - especially sitting next to the local rarity badge - so the
  // safe end of the scale is labelled plainly and the tip below says what the
  // scale actually measures. The threatened categories keep their real names;
  // those are worth stating exactly.
  var IUCN_LABELS = {
    LC: 'common', NT: 'near threatened', VU: 'vulnerable',
    EN: 'endangered', CR: 'critically endangered', EW: 'extinct in the wild',
    EX: 'extinct', DD: 'data deficient', NE: 'not evaluated',
  };
  var IUCN_FULL = {
    LC: 'Least Concern', NT: 'Near Threatened', VU: 'Vulnerable',
    EN: 'Endangered', CR: 'Critically Endangered', EW: 'Extinct in the Wild',
    EX: 'Extinct', DD: 'Data Deficient', NE: 'Not Evaluated',
  };
  // Every badge on an entry - status and typing alike - is described as a
  // {kind, cls, attr, label, desc} record, and both the chip row at the top and
  // the table under the plate render from those records. One list means a badge
  // can't appear in one place and not the other, and can't ship without a
  // description: the table would show an empty cell.
  function chipHtml(d) {
    var base = d.kind === 'type' ? 'bx-type' : 'bx-badge';
    return '<span class="' + base + (d.cls ? ' ' + d.cls : '') + '"' + (d.attr || '') + '>'
      + esc(d.label) + (d.desc ? '<span class="bx-tip">' + esc(d.desc) + '</span>' : '') + '</span>';
  }
  function chipRow(list) { return list.map(chipHtml).join(''); }

  function iucnDesc(code) {
    if (!code) return null;
    return {
      kind: 'badge', cls: '', attr: ' data-iucn="' + esc(code) + '"',
      label: IUCN_LABELS[code] || code,
      desc: 'IUCN Red List: ' + (IUCN_FULL[code] || code)
        + '. Global risk of extinction, not how often it turns up here.'
    };
  }

  // The bands rarityLabel() sorts into, stated in the units they're measured
  // in, plus this bird's actual rate - the tier alone doesn't say whether it
  // sits at the top or the bottom of its band.
  var RARITY_BANDS = {
    common: 'five or more a day',
    regular: 'between one and five a day',
    occasional: 'between one every five days and one a day',
    rare: 'fewer than one every five days',
  };
  function rarityDesc(label, perDay) {
    var rate = perDay >= 10 ? Math.round(perDay)
      : perDay >= 0.1 ? perDay.toFixed(1) : perDay.toFixed(2);
    return {
      kind: 'badge', cls: 'local', attr: ' data-rarity="' + esc(label) + '"',
      label: label + ' here',
      desc: 'Averages ' + rate + ' detections a day at this station since it was '
        + 'first heard' + (RARITY_BANDS[label] ? ' - ' + RARITY_BANDS[label] : '') + '.'
    };
  }
  function mutedDesc(label, desc) {
    return { kind: 'badge', cls: 'muted', attr: '', label: label, desc: desc };
  }
  function avibaseUrl(id) {
    return 'https://avibase.bsc-eoc.org/species.jsp?avibaseid=' + encodeURIComponent(id);
  }

  // Paint a 1-bit mask straight into ImageData, without going through
  // loadMask()'s decoded cell list. The collage only ever needs masks for
  // species it's drawing (a few dozen); the Birdex lists all 333 at once, and
  // caching a coordinate-pair array per species would cost tens of MB for
  // thumbnails that are 36px wide.
  function paintSilhouette(canvas, slug) {
    var rec = MASKS[slug];
    if (!rec) return false;
    var w = rec.w, h = rec.h;
    var bytes = atob(rec.bits);
    var ctx = canvas.getContext('2d');
    canvas.width = w; canvas.height = h;
    var img = ctx.createImageData(w, h);
    var px = img.data;
    // Silhouettes are drawn in the ink colour so they follow the active theme
    // the way every other mark on the page does.
    var ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ink);
    var r = m ? parseInt(m[1], 16) : 26, g = m ? parseInt(m[2], 16) : 22, b = m ? parseInt(m[3], 16) : 18;
    for (var i = 0, n = w * h; i < n; i++) {
      if ((bytes.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) {
        var o = i * 4;
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  // The roster is fixed at build time, but the station can hear something the
  // roster doesn't cover. Rather than drop it, those land after the numbered
  // entries as "unlisted" - visible, honestly labelled, and countable
  // separately so the completion figure stays true to the roster.
  function birdexRows() {
    var species = (BIRDEX && BIRDEX.species) || {};
    var life = (DATA.lifelist && DATA.lifelist.species) || [];
    var seen = {};
    life.forEach(function (s) { seen[birdexSlugFor(s.sci)] = s; });

    var rows = Object.keys(species).sort(function (a, b) {
      return species[a].n - species[b].n;
    }).map(function (slug) {
      return { slug: slug, rec: species[slug], life: seen[slug] || null, unlisted: false };
    });

    life.forEach(function (s) {
      var slug = birdexSlugFor(s.sci);
      if (species[slug]) return;
      rows.push({
        slug: slug, unlisted: true, life: s,
        rec: { sci: s.sci, com: s.com, art: !!DIMS[slug] },
      });
    });
    return rows;
  }

  // Entries the user chose to look up. Kept deliberately separate from
  // "registered": the tally counts birds the station actually heard, and
  // revealing one is a decision to peek, not a detection. Per-device, like the
  // other bird:* preferences.
  var birdexRevealed = (function () {
    try { return JSON.parse(readLS('bird:birdexRevealed', '[]')) || []; }
    catch (e) { return []; }
  })();
  function isRevealed(slug) { return birdexRevealed.indexOf(slug) >= 0; }
  function setRevealed(slug, on) {
    var i = birdexRevealed.indexOf(slug);
    if (on && i < 0) birdexRevealed.push(slug);
    else if (!on && i >= 0) birdexRevealed.splice(i, 1);
    writeLS('bird:birdexRevealed', JSON.stringify(birdexRevealed));
  }

  // Locked entries match on every field, same as registered ones - searching
  // for a bird you know exists shouldn't fail just because it hasn't turned up
  // yet. The list shows their names for the duration of the query (see
  // renderBirdex); the plate stays behind the silhouette until it's unlocked.
  // Everything on an entry that carries a label: name, taxonomy, typing,
  // conservation status and local rarity. Whether an entry is locked or
  // unlocked is a state of the dex rather than a property of the bird, so it
  // isn't searchable.
  function rowSearchText(row) {
    var rec = row.rec;
    var words = [rec.com || '', rec.sci || '', rec.family || '', typeWords(rec.types)];

    // Conservation status by code, by the label on the badge, and by the real
    // IUCN wording - "least concern" should find what the badge calls "common".
    if (rec.iucn) {
      words.push(rec.iucn, IUCN_LABELS[rec.iucn] || '', IUCN_FULL[rec.iucn] || '');
    }

    // Local rarity only exists for a bird that's actually been heard; it's
    // derived from this station's own detections, not from the database.
    if (row.life) words.push(rarityLabel(+row.life.n || 0, row.life.first_seen));
    return words.join(' ').toLowerCase();
  }

  function birdexMatches(row, q) {
    if (!q) return true;
    return rowSearchText(row).indexOf(q) >= 0
      || String(row.rec.n || '').indexOf(q.replace(/^#/, '')) === 0;
  }

  // Searchable text for a bird's typing: both the vocabulary key and the label
  // shown on the badge, since people will type what they can see ("terrestrial")
  // as readily as the underlying term ("ground-dweller").
  function typeWords(ty) {
    if (!ty) return '';
    // Labels come from typeList so search and badges stay in step; the raw
    // keys are added too, since people type "ground-dweller" as readily as
    // "Terrestrial". Elements are already gone from the data by this point if
    // they're switched off (see stripWhimsy).
    var words = [];
    typeList(ty).forEach(function (d) { words.push(d.label); });
    if (ty.guild) words.push(ty.guild);
    (ty.traits || []).forEach(function (t) { words.push(t); });
    if (ty.element) words.push(ty.element);
    return words.join(' ').toLowerCase();
  }

  function renderBirdex(animate, lead) {
    if (!viewEnabled('birdex')) return;
    var listEl = document.getElementById('birdexList');
    if (!listEl) return;
    if (!BIRDEX) {
      loadBirdex().then(function () { renderBirdex(animate, lead); }).catch(function (e) {
        listEl.innerHTML = '<p class="birdex-empty">Birdex data unavailable.</p>';
        if (window.console) console.warn('birdex.json failed to load', e);
      });
      return;
    }

    var rows = birdexRows();
    var listed = rows.filter(function (r) { return !r.unlisted; });
    var got = listed.filter(function (r) { return r.life; }).length;
    var extra = rows.length - listed.length;

    var seenEl = document.getElementById('birdexSeen');
    var totalEl = document.getElementById('birdexTotal');
    var meter = document.getElementById('birdexMeter');
    var noteEl = document.getElementById('birdexNote');
    if (seenEl) seenEl.textContent = got;
    if (totalEl) totalEl.textContent = listed.length;
    if (meter) meter.style.width = (listed.length ? (got / listed.length * 100) : 0).toFixed(1) + '%';
    if (noteEl) {
      noteEl.textContent = extra
        ? extra + ' heard but unlisted - add to tools/roster-extra.txt'
        : '';
    }

    var q = birdexQuery.trim().toLowerCase();
    var visible = rows.filter(function (r) { return birdexMatches(r, q); });
    if (!visible.length) {
      listEl.innerHTML = '<p class="birdex-empty">Nothing matches that.</p>';
      return;
    }

    listEl.innerHTML = visible.map(function (row) {
      var rec = row.rec, caught = !!row.life;
      var revealed = !caught && isRevealed(row.slug);
      var shown = caught || revealed;
      var num = row.unlisted ? '&mdash;' : ('#' + String(rec.n).padStart(3, '0'));
      // While a query is active a locked row shows its name, so a search can
      // actually find it - but only its name. The plate stays hidden behind
      // the silhouette, and the name reverts to ??? when the query clears.
      // Whether a real name is on screen, as opposed to the ??? placeholder.
      // Styling keys off this rather than off data-caught, because a row can
      // legitimately show its name while still being uncaught - revealed by
      // hand, or surfaced by an active search.
      var named = shown || !!q;
      var name = named ? esc(rec.com || rec.sci) : '???';
      var thumb = shown
        ? '<img loading="lazy" decoding="async" alt="" src="' +
            esc(rec.art !== false ? illustrationSrc(rec.sci, 1) : proxyImageSrc(rec.sci)) + '"' +
            (rec.art !== false ? ' onerror="this.onerror=null;this.src=\'' + esc(proxyImageSrc(rec.sci)) + '\'"' : '') + '>'
        : '<canvas class="bx-sil" data-slug="' + esc(row.slug) + '"></canvas>';
      return '<button type="button" class="birdex-row" data-slug="' + esc(row.slug) + '"'
        + ' data-caught="' + caught + '"'
        + (named ? ' data-named="true"' : '')
        + (revealed ? ' data-revealed="true"' : '')
        + (row.slug === birdexSel ? ' data-active="true"' : '')
        + '><span class="bx-n">' + num + '</span>'
        + '<span class="bx-thumb">' + thumb + '</span>'
        + '<span class="bx-name">' + name + '</span>'
        + (caught ? '<span class="bx-ct">' + fmtNK(+row.life.n || 0) + '</span>' : '')
        + '</button>';
    }).join('');

    // Silhouettes need MASKS, which loads async alongside DIMS. If it isn't
    // here yet, loadTables() re-renders us when it lands.
    if (tablesReady) {
      listEl.querySelectorAll('canvas.bx-sil').forEach(function (c) {
        if (!paintSilhouette(c, c.dataset.slug)) c.classList.add('no-mask');
      });
    }

    // SSE refreshes rebuild the list, but must not replace an open entry: its
    // Audio object would keep playing while the new button/spectrogram reset.
    var entryEl = document.getElementById('birdexEntry');
    if (birdexSel) {
      if (entryEl.dataset.slug !== birdexSel) renderBirdexEntry(birdexSel);
    } else if (!entryEl.dataset.ready) renderBirdexEntry(null);
    if (animate) playBirdexEntrance(lead);
  }

  // Row entrance: a short top-to-bottom cascade, capped so 333 rows don't
  // crawl. Same shape as playAtlasEntrance, keyed on index rather than
  // offsetTop because the list is a single column.
  var birdexEntranceT = null;
  function playBirdexEntrance(lead) {
    lead = lead || 0;
    var listEl = document.getElementById('birdexList');
    if (!listEl) return;
    var rows = [].slice.call(listEl.querySelectorAll('.birdex-row'));
    if (!rows.length) return;
    var PER_ROW = 22, MAX_ROW = 16;
    rows.forEach(function (r, i) {
      r.classList.remove('entering');
      r.style.animationDelay = (lead + Math.min(i, MAX_ROW) * PER_ROW) + 'ms';
    });
    void listEl.offsetWidth;
    rows.forEach(function (r) { r.classList.add('entering'); });
    clearTimeout(birdexEntranceT);
    birdexEntranceT = setTimeout(function () {
      rows.forEach(function (r) { r.classList.remove('entering'); r.style.animationDelay = ''; });
    }, lead + MAX_ROW * PER_ROW + 520);
  }

  // The pose control is the modal's, markup and all: a 30x26 button holding a
  // 13px glyph, with the label in a hover .tip. Text labels don't fit it - they
  // overflow the fixed box and collide, and the sliding pill sizes to the
  // button rather than the words.
  var ICON_PERCHED = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M3.5 6.5 C 4 4, 6 3, 8 4 C 10 3.6, 11.6 4.6, 12 6.5 L 11.5 8 C 11 9.6, 9.4 10.4, 8 10.4 C 6.4 10.4, 4.8 9.6, 4.2 8 Z"/>'
    + '<circle cx="10.6" cy="5.7" r=".4" fill="currentColor"/><path d="M12 6.2 L 13.6 5.8"/>'
    + '<path d="M7.5 10.4 L 7.2 12.2"/><path d="M8.6 10.4 L 8.9 12.2"/><path d="M2 12.6 H 13"/></svg>';
  var ICON_FLIGHT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M1.5 8 Q 4.5 4, 7.5 7.5 Q 11 4, 14.5 8"/><path d="M7.5 7.5 L 8 9.5"/>'
    + '<circle cx="8.5" cy="7.2" r=".4" fill="currentColor"/><path d="M8.6 7 L 10 6.6"/></svg>';

  // Detection counts span three orders of magnitude across a life list, so a
  // linear bar leaves nearly every species pinned at zero width. Log scaling
  // keeps the ordering honest while giving quiet birds a visible mark. Every
  // bar on the card must share a denominator family, or a "2 today" reads as
  // larger than "16 all time".
  function barFrac(v, max) {
    if (!(max > 0) || !(v > 0)) return 0;
    return Math.min(1, Math.log1p(v) / Math.log1p(max));
  }

  // Three visually distinct tiers, so the badges don't read as one flat row:
  // guild is solid (every bird has exactly one), traits are outlined (common,
  // several per bird), and an element is the only place colour appears on the
  // page at all - which is affordable precisely because it's rare.
  // The hover line comes from the shipped vocabulary; an element prefers its
  // per-species note, which says why *this* bird earned it.
  // One description of a bird's typing, rendered two ways. Keeping the list
  // here means the chips and the table can never drift apart, and the elements
  // opt-out only has to be honoured once.
  function typeList(ty) {
    if (!ty) return [];
    var V = (BIRDEX && BIRDEX.vocab) || {};
    var out = [];
    var g = (V.guild || {})[ty.guild];
    if (g) out.push({ kind: 'type', cls: 'guild', attr: ' data-guild="' + esc(ty.guild) + '"', label: g.label, desc: g.flavor });
    (ty.traits || []).forEach(function (t) {
      var d = (V.trait || {})[t];
      if (d) out.push({ kind: 'type', cls: 'trait', attr: '', label: d.label, desc: d.flavor });
    });
    if (ty.element) {
      var e = (V.element || {})[ty.element] || {};
      out.push({
        kind: 'type', cls: 'element', attr: ' data-element="' + esc(ty.element) + '"',
        // An element prefers its per-species note, which says why this
        // particular bird earned it rather than what the element means.
        label: e.label || ty.element, desc: ty.note || e.flavor
      });
    }
    return out;
  }

  // The chip rows at the top are the summary; this is every one of them spelled
  // out, status badges included. Nothing here depends on a pointer, which is
  // the point - an e-ink panel or a touch screen can't surface a tooltip at
  // all, so this is where the descriptions actually live.
  function badgeTable(list) {
    var items = list.filter(Boolean);
    if (!items.length) return '';
    return '<dl class="bx-badge-table">' + items.map(function (d) {
      return '<dt>' + chipHtml({ kind: d.kind, cls: d.cls, attr: d.attr, label: d.label })
        + '</dt><dd>' + esc(d.desc || '') + '</dd>';
    }).join('') + '</dl>';
  }

  function statBar(label, value, frac, hint) {
    return '<div class="bx-stat">'
      + '<span class="bx-stat-k">' + esc(label) + '</span>'
      + '<span class="bx-stat-bar"><i style="width:' +
          Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%"></i></span>'
      + '<span class="bx-stat-v">' + esc(value) + (hint ? '<em>' + esc(hint) + '</em>' : '') + '</span>'
      + '</div>';
  }

  // Descriptions arrive separately and may not arrive at all. Three states:
  // loading, present, and absent - the last one being a species that's in the
  // metadata but has no text, which is a legitimate outcome (a stale cached
  // half, or an entry the builder couldn't source prose for) and must read as
  // a deliberate blank rather than a stuck spinner.
  function fillBlurb(host, slug) {
    if (!host || !viewEnabled('birdex')) return;
    var ready = BIRDEX_TEXT;
    if (!ready) host.innerHTML = '<p class="bx-blurb-pending">Loading description…</p>';
    loadBirdexText().then(function () {
      // The panel may have been rebuilt for another species while we waited.
      if (!document.contains(host)) return;
      var blurb = blurbFor(slug);
      host.innerHTML = blurb
        ? blurb.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('')
        : '<p class="bx-blurb-pending">No description available for this species.</p>';
    });
  }

  function renderBirdexEntry(slug) {
    if (!viewEnabled('birdex')) return;
    var el = document.getElementById('birdexEntry');
    if (!el) return;
    el.dataset.ready = '1';
    el.dataset.slug = slug || '';
    if (!slug || !BIRDEX) {
      el.dataset.state = 'empty';
      el.innerHTML = '<p class="bx-hint">Pick an entry.</p>';
      return;
    }
    var rows = birdexRows();
    var row = rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) { el.dataset.state = 'empty'; el.innerHTML = '<p class="bx-hint">Pick an entry.</p>'; return; }

    var rec = row.rec, life = row.life, caught = !!life;
    var num = row.unlisted ? 'unlisted' : ('#' + String(rec.n).padStart(3, '0'));
    el.dataset.state = caught ? 'caught' : 'unseen';

    // Locked: silhouette, no name, and a way out. The reveal is opt-in per
    // entry rather than a global "show everything" switch, so the dex keeps
    // its shape - you're spending the surprise one bird at a time.
    if (!caught && !isRevealed(slug)) {
      el.dataset.state = 'unseen';
      el.innerHTML = ''
        + '<header class="bx-entry-head"><span class="bx-entry-n">' + num + '</span>'
        // No table on a locked entry: there'd be one row, and the prose below
        // already says the same thing at more length.
        + chipHtml(mutedDesc('not registered',
            'This station hasn\'t heard this species yet.')) + '</header>'
        + '<h2 class="bx-entry-name">???</h2>'
        + '<p class="bx-entry-sci">&mdash;</p>'
        + '<div class="bx-screen unseen"><canvas class="bx-sil-big" data-slug="' + esc(slug) + '"></canvas></div>'
        + '<p class="bx-hint">This one hasn\'t been heard here yet. Its entry fills in the '
        + 'first time BirdNET-Go picks it up.</p>'
        + '<div class="bx-unlock">'
        + '<button type="button" class="chip" id="bxReveal">unlock this entry</button>'
        + '<span class="bx-unlock-note">Shows the plate and description. Won\'t count as registered.</span>'
        + '</div>';
      var big = el.querySelector('canvas.bx-sil-big');
      if (big && tablesReady && !paintSilhouette(big, slug)) big.classList.add('no-mask');
      el.querySelector('#bxReveal').addEventListener('click', function () {
        setRevealed(slug, true);
        renderBirdex();          // the list row swaps its silhouette for the plate
        renderBirdexEntry(slug);
      });
      return;
    }

    // Revealed but not heard: everything the database knows, and nothing the
    // station would have supplied - no counts, no first/last heard, no call.
    // Showing zeroed stat bars here would imply a detection history of zero
    // rather than an absence of one.
    if (!caught) {
      var art = rec.art !== false;
      el.dataset.state = 'revealed';
      var statusList = [
        iucnDesc(rec.iucn),
        mutedDesc('unlocked', 'Opened by hand rather than heard here, so it has no '
          + 'recordings or detection history and doesn\'t count toward the registered total.')
      ].filter(Boolean);
      el.innerHTML = ''
        + '<header class="bx-entry-head"><span class="bx-entry-n">' + num + '</span>'
        + '<span class="bx-badges">'
        + '<span class="bx-badge-row">'
        + chipRow(statusList) + '</span>'
        + '<span class="bx-badge-row">' + chipRow(typeList(rec.types)) + '</span>'
        + '</span></header>'
        + '<h2 class="bx-entry-name">' + esc(rec.com || rec.sci) + '</h2>'
        + '<p class="bx-entry-sci">' + esc(rec.sci)
        + (rec.family ? ' <span class="bx-fam">' + esc(rec.family) + '</span>' : '') + '</p>'
        + '<div class="bx-screen"><img alt="' + esc(rec.com || rec.sci) + '" src="'
        + esc(art ? illustrationSrc(rec.sci, 1) : proxyImageSrc(rec.sci)) + '"'
        + (art ? ' onerror="this.onerror=null;this.src=\'' + esc(proxyImageSrc(rec.sci)) + '\'"' : '') + '></div>'
        + badgeTable(statusList.concat(typeList(rec.types)))
        + '<p class="bx-hint bx-not-heard">Not heard here yet &mdash; no recordings or detection '
        + 'history. Unlocked by hand.</p>'
        + '<div class="bx-blurb" id="bxBlurb"></div>'
        + '<div class="bx-actions">'
        + (rec.avibase ? '<a class="chip ext" target="_blank" rel="noopener" href="'
            + esc(avibaseUrl(rec.avibase)) + '">avibase</a>' : '')
        + '<a class="chip ext" target="_blank" rel="noopener" href="' + esc(wikiUrl(rec.sci)) + '">wiki</a>'
        + '<a class="chip ext" target="_blank" rel="noopener" href="' + esc(ebirdUrl(rec.sci)) + '">ebird</a>'
        + '<button type="button" class="chip" id="bxRelock">re-lock</button>'
        + '</div>';
      fillBlurb(el.querySelector('#bxBlurb'), slug);
      el.querySelector('#bxRelock').addEventListener('click', function () {
        setRevealed(slug, false);
        renderBirdex();
        renderBirdexEntry(slug);
      });
      return;
    }

    // Normalise the bars against the loudest species on the life list, so the
    // fill reads as "how big is this one relative to everything here" rather
    // than against an arbitrary constant.
    var all = (DATA.lifelist && DATA.lifelist.species) || [];
    var total = +life.n || 0;
    var maxTotal = all.reduce(function (m, s) { return Math.max(m, +s.n || 0); }, 1);
    var perDayOf = function (s) {
      var t = Date.parse((s.first_seen || '').replace(' ', 'T'));
      var days = isNaN(t) ? 1 : Math.max(1, Math.ceil((Date.now() - t) / 86400000));
      return (+s.n || 0) / days;
    };
    var perDay = perDayOf(life);
    var maxPerDay = all.reduce(function (m, s) { return Math.max(m, perDayOf(s)); }, 0.001);

    var winBySci = {};
    var maxWin = 0;
    ((DATA.recent && DATA.recent.species) || []).forEach(function (s) {
      winBySci[s.sci] = +s.n; maxWin = Math.max(maxWin, +s.n || 0);
    });
    var win = winBySci[life.sci] || 0;

    var local = rarityLabel(total, life.first_seen);
    var art = rec.art !== false;
    var statusList = [iucnDesc(rec.iucn), rarityDesc(local, perDay)].filter(Boolean);

    el.innerHTML = ''
      + '<header class="bx-entry-head">'
      + '<span class="bx-entry-n">' + num + '</span>'
      // One cluster, two rows: status above, typing below. Keeping them in a
      // single right-aligned block stops the card reading as two unrelated
      // badge strips separated by the name.
      + '<span class="bx-badges">'
      + '<span class="bx-badge-row">'
      // The global tier is near-constant (291 of 330 are least concern), so it
      // never stands alone - the local tier is what actually varies here.
      + chipRow(statusList) + '</span>'
      + '<span class="bx-badge-row">' + chipRow(typeList(rec.types)) + '</span>'
      + '</span></header>'
      + '<h2 class="bx-entry-name">' + esc(rec.com || life.com || rec.sci) + '</h2>'
      + '<p class="bx-entry-sci">' + esc(rec.sci)
      + (rec.family ? ' <span class="bx-fam">' + esc(rec.family) + '</span>' : '') + '</p>'
      + '<div class="bx-body">'
      + '<div class="bx-screen">'
      + '<img id="bxPlate" alt="' + esc(rec.com || rec.sci) + '" src="'
      + esc(art ? illustrationSrc(rec.sci, 1) : proxyImageSrc(rec.sci)) + '"'
      + (art ? ' onerror="this.onerror=null;this.src=\'' + esc(proxyImageSrc(rec.sci)) + '\'"' : '') + '>'
      + (art ? '<div class="pose-toggle" id="bxPose" role="tablist" aria-label="Pose">'
        + '<i class="seg-pill" aria-hidden="true"></i>'
        + '<button type="button" data-pose="1" aria-current="true" aria-label="perched">'
        + ICON_PERCHED + '<span class="tip">perched</span></button>'
        + '<button type="button" data-pose="2" aria-label="in flight">'
        + ICON_FLIGHT + '<span class="tip">in flight</span></button>'
        + '</div>' : '')
      + '</div>'
      + badgeTable(statusList.concat(typeList(rec.types)))
      + '<div class="bx-stats">'
      // Each bar is scaled against the same measure taken across the whole life
      // list, so bar lengths are comparable down the card and between species.
      + statBar('detections', fmtN(total), barFrac(total, maxTotal), 'all time')
      + statBar('per day', perDay.toFixed(perDay >= 10 ? 0 : 1),
                barFrac(perDay * 100, maxPerDay * 100), 'average')
      + statBar(windowLabel(currentHours), fmtN(win), barFrac(win, maxWin), 'this window')
      + '<div class="bx-when">'
      + '<div><span class="k">first heard</span><span class="v">' + esc(fmtDateLine(
          (life.first_seen || '').slice(0, 10), (life.first_seen || '').slice(11, 19)) || '-') + '</span></div>'
      + '<div><span class="k">last heard</span><span class="v">' + esc(fmtDateLine(
          (life.last_seen || '').slice(0, 10), (life.last_seen || '').slice(11, 19)) || '-') + '</span></div>'
      + '</div></div></div>'
      // Filled in by fillBlurb once birdex-text.json lands - which may be
      // never, if that file is missing or stamp-mismatched.
      + '<div class="bx-blurb" id="bxBlurb"></div>'
      + '<div class="bx-actions">'
      + '<button type="button" class="chip play" id="bxPlay" data-sci="' + esc(rec.sci) + '">'
      + ICON_PLAY + '<span>call</span></button>'
      + '<div class="bx-spectro" id="bxSpectro" aria-hidden="true"></div>'
      + (rec.avibase ? '<a class="chip ext" target="_blank" rel="noopener" href="'
          + esc(avibaseUrl(rec.avibase)) + '">avibase</a>' : '')
      + '<a class="chip ext" target="_blank" rel="noopener" href="' + esc(wikiUrl(rec.sci)) + '">wiki</a>'
      + '<a class="chip ext" target="_blank" rel="noopener" href="' + esc(ebirdUrl(rec.sci)) + '">ebird</a>'
      + '</div>';

    var pose = el.querySelector('#bxPose');
    if (pose) {
      var plate = el.querySelector('#bxPlate');
      pose.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          pose.querySelectorAll('button').forEach(function (x) {
            x.setAttribute('aria-current', x === b ? 'true' : 'false');
          });
          syncPill(pose);
          plate.src = illustrationSrc(rec.sci, +b.dataset.pose);
        });
      });
      // syncPill measures offsetWidth/offsetLeft, so it has to run after the
      // pane is laid out - on a narrow screen the entry is display:none until
      // birdexSelect reveals it, which would otherwise size the pill to 0.
      requestAnimationFrame(function () { syncPill(pose); });
    }
    fillBlurb(el.querySelector('#bxBlurb'), slug);
    wireBirdexPlay(el, rec.sci);
  }

  // Playback for the entry's call button. birdnet-go addresses clips by
  // detection id, so the newest detection is resolved first (through the same
  // cache the modal uses) and only then does audio start. Registered with the
  // page-wide audio coordinator so starting a call stops an atlas card or a
  // modal recording rather than layering over it.
  function wireBirdexPlay(root, sci) {
    var btn = root.querySelector('#bxPlay');
    var wrap = root.querySelector('#bxSpectro');
    if (!btn) return;
    var audio = null;
    function reset(label) {
      btn.setAttribute('data-active', 'false');
      btn.innerHTML = ICON_PLAY + '<span>' + (label || 'call') + '</span>';
      if (wrap) wrap.style.setProperty('--prog', '0%');
    }
    function stop() {
      audioRelease(stop);
      if (audio) { try { audio.pause(); } catch (e) { } audio = null; }
      reset();
    }
    btn.addEventListener('click', function () {
      if (audio) { stop(); return; }
      audioClaim(stop);
      btn.setAttribute('data-active', 'true');
      btn.innerHTML = ICON_PLAY + '<span>...</span>';
      var cached = SPECIES_CACHE[sci];
      (cached ? Promise.resolve(cached) : fetchSpeciesDetail(sci).then(function (d) {
        SPECIES_CACHE[sci] = d; return d;
      })).then(function (d) {
        var first = (d.detections || [])[0];
        if (!first) { reset('no audio'); setTimeout(reset, 2000); return; }
        var url = audioSrc(first.id);
        if (wrap && !wrap.firstChild) {
          var canvas = document.createElement('canvas');
          wrap.appendChild(canvas);
          var paint = function (buf) { if (document.contains(canvas)) paintSpectrogram(canvas, buf); };
          if (_decodedCache[url]) paint(_decodedCache[url]);
          else {
            var actx = getSpecCtx();
            if (actx) {
              fetch(url).then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer();
              }).then(function (b) { return actx.decodeAudioData(b); })
                .then(function (buf) { _decodedCache[url] = buf; paint(buf); })
                .catch(function () { if (wrap.contains(canvas)) wrap.removeChild(canvas); });
            } else { wrap.removeChild(canvas); }
          }
        }
        audio = new Audio(url);
        audio.addEventListener('canplay', function () {
          if (!audio) return;
          btn.innerHTML = ICON_PAUSE + '<span>stop</span>';
          audio.play();
        });
        audio.addEventListener('timeupdate', function () {
          if (!audio || !wrap) return;
          var pct = audio.duration ? (audio.currentTime / audio.duration * 100) : 0;
          wrap.style.setProperty('--prog', pct.toFixed(1) + '%');
        });
        audio.addEventListener('ended', stop);
        audio.addEventListener('error', function () {
          audio = null; audioRelease(stop); reset('no audio'); setTimeout(reset, 2000);
        });
        audio.load();
      }).catch(function () { audio = null; audioRelease(stop); reset('no audio'); setTimeout(reset, 2000); });
    });
  }

  function birdexSelect(slug) {
    birdexSel = slug;
    writeLS('bird:birdexSel', slug || '');
    var listEl = document.getElementById('birdexList');
    if (listEl) {
      listEl.querySelectorAll('.birdex-row[data-active="true"]').forEach(function (r) {
        r.removeAttribute('data-active');
      });
      var row = listEl.querySelector('.birdex-row[data-slug="' + (slug || '').replace(/"/g, '\\"') + '"]');
      if (row) {
        row.setAttribute('data-active', 'true');
        row.scrollIntoView({ block: 'nearest' });
      }
    }
    // Reveal the pane before rendering into it, so anything that measures
    // itself during render (the pose pill) sees real geometry.
    document.getElementById('v3').setAttribute('data-pane', slug ? 'entry' : 'list');
    renderBirdexEntry(slug);
  }

  function renderWindowDependent(animate) {
    // renderStatsLists runs BEFORE drawHistograms so the stats entrance
    // (fired at the end of drawHistograms) can stagger the side-panel rows
    // that were just built, in tandem with the graph populating.
    if (viewEnabled('collage')) renderCollageFromData(animate);
    if (viewEnabled('stats')) { renderStatsLists(); drawHistograms(animate); }
    if (viewEnabled('atlas')) renderAtlas(animate);
    // A deliberate window change updates the entry's window-specific stat.
    // Preserve scroll position while replacing the tall entry.
    if (viewEnabled('birdex') && birdexSel) {
      var pane = document.querySelector('.birdex-pane-entry');
      var top = pane ? pane.scrollTop : 0;
      renderBirdexEntry(birdexSel);
      if (pane) pane.scrollTop = top;
    }
  }
  function renderTimeIndependent(animate) {
    // Lists first, then the graph (see renderWindowDependent).
    if (viewEnabled('stats')) { renderStatsLists(); drawHistograms(animate); }
    if (viewEnabled('atlas')) renderAtlas(animate);
    if (viewEnabled('birdex')) renderBirdex(animate);
  }

  function refreshRecent(animate) {
    // Capture the window this fetch was issued for. If the user
    // changes the picker again before it resolves - or a slower poll
    // lands later - we discard the stale response so the collage
    // never reverts to a different window.
    var forHours = currentHours;
    return fetchWindow(forHours)
      .then(function (j) {
        if (forHours !== currentHours) return; // window changed mid-flight
        DATA.recent = j; renderWindowDependent(animate);
      })
      .catch(function (e) { console.warn('recent fetch failed', e); });
  }
  function refreshAll(animate) {
    var forHours = currentHours;
    var nul = function () { return null; };
    var today = ymd(new Date());
    return Promise.all([
      // Period counts. /dashboard/kpis supplies lifetime species + today's
      // detections; the hour/week/all-time totals it doesn't carry are
      // summed from the matching species-summary windows.
      fetchJson(apiUrl('/dashboard/kpis', {})).catch(nul),
      fetchSpeciesSummary('1970-01-01').catch(nul),
      Promise.all([
        fetchJson(apiUrl('/analytics/time/daily', {
          start_date: daysAgoYmd(STATS_DAYS - 1), end_date: today,
        })).catch(nul),
        fetchJson(apiUrl('/analytics/species/diversity', {
          start_date: daysAgoYmd(STATS_DAYS - 1), end_date: today,
        })).catch(nul),
        fetchJson(apiUrl('/analytics/time/distribution/hourly', {
          start_date: daysAgoYmd(29), end_date: today,
        })).catch(nul),
      ]).then(function (t) { return { daily: t[0], diversity: t[1], by_hour: t[2] }; }),
      fetchJson(apiUrl('/analytics/species/detections/new', {
        start_date: daysAgoYmd(365), end_date: today,
      })).catch(nul),
      fetchWindow(forHours).catch(nul),
      fetchSpeciesSummary(daysAgoYmd(0)).catch(nul),   // today
      fetchSpeciesSummary(daysAgoYmd(6)).catch(nul),   // last 7 days
      fetchLastHourCount().catch(function () { return 0; }),
    ]).then(function (parts) {
      DATA.stats = buildStats(parts[0], parts[1], parts[5], parts[6], parts[7]);
      DATA.lifelist = parts[1];
      DATA.timeseries = parts[2];
      DATA.firstseen = normalizeFirstSeen(parts[3]);
      // Only accept the recent slice if the window hasn't changed
      // since this poll started - otherwise keep what's there.
      if (forHours === currentHours && parts[4]) DATA.recent = parts[4];
      recomputeDerived();
      renderTimeIndependent(animate);
      if (viewEnabled('collage')) renderCollageFromData(animate);
    });
  }

  // Birdex reference data is view-owned. When the view is disabled, neither
  // birdex.json nor birdex-text.json is requested. Atlas links then use their
  // generic eBird fallback, and detail cards keep their explicit no-description
  // state rather than paying for disabled-view assets.
  if (viewEnabled('birdex')) {
    loadBirdex().then(function () {
      try { renderAtlas(); } catch (e) { }
      try { renderBirdex(); } catch (e) { }
    }).catch(function (e) {
      if (window.console) console.warn('birdex.json failed to load', e);
    });
  }

  // Kick off the initial fetch. Renders pull from DATA as soon as it
  // populates; until then the page sits with empty histograms + lists.
  // animate=true so the collage blooms in on first load.
  refreshAll(true);

  // Hook into the window picker so the data refetches on change. Pass
  // animate=true so the collage blooms (the silent poll passes nothing).
  winBtns.forEach(function (b) {
    b.addEventListener('click', function () { refreshRecent(true); });
  });

  // Initialise the first enabled view's title and position. This matters when
  // collage is disabled and a later view becomes the zero-index landing page.
  setTitleForView(0);
  views.style.transform = 'translateX(0)';

  // ---- Realtime updates (SSE) ----
  // BirdNET-Pi had no push channel, so the original polled every 30s.
  // birdnet-go streams detections over SSE, so subscribe instead and
  // refresh on a real event. A slow poll stays as the fallback for when
  // the stream is unavailable (proxy buffering, connection dropped), and
  // catches the periodic aggregates SSE doesn't cover.
  var POLL_MS = 5 * 60 * 1000;
  var pollTimer = null;
  var es = null;
  // Detections arrive in bursts; coalesce so one refresh covers a flurry.
  var refreshT = null;
  function refreshSoon() {
    if (refreshT) return;
    refreshT = setTimeout(function () { refreshT = null; refreshAll(); }, 2000);
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      refreshAll();
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function startStream() {
    if (es || !window.EventSource) return;
    es = new EventSource(API + '/detections/stream', { withCredentials: true });
    es.addEventListener('detection', refreshSoon);
    // EventSource reconnects on its own; just drop the handle so a later
    // visibilitychange can rebuild it if the browser gave up entirely.
    es.onerror = function () {
      if (es && es.readyState === EventSource.CLOSED) { es = null; }
    };
  }
  function stopStream() { if (es) { es.close(); es = null; } }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopPolling();
      stopStream();
    } else {
      // Force an immediate refresh on return so the user sees fresh
      // data right away, then resume the stream + fallback poll.
      refreshAll();
      startStream();
      startPolling();
    }
  });
  startStream();
  startPolling();


  // ---- Hash routing + atlas detail modal ----
  // When a collage tile or stats row is clicked it sets
  // location.hash = '#sci=<name>'. On arrival we switch to the atlas
  // view, highlight the matching card, AND open the detail modal with
  // expanded info (Wikipedia summary, taxonomy, all past recordings).
  function readHash() {
    var m = location.hash.match(/^#sci=([^&]+)/);
    if (!m) return null;
    return decodeURIComponent(m[1]);
  }
  // #birdex/<slug> deep-links a single entry. Slug rather than sci name so the
  // link survives the taxonomy drift the alias map exists to absorb.
  function readBirdexHash() {
    var m = location.hash.match(/^#birdex\/([a-z0-9-]+)/i);
    return m ? m[1].toLowerCase() : null;
  }
  function highlightAtlas(sci) {
    var grid = document.getElementById('atlasGrid');
    if (!grid) return;
    grid.querySelectorAll('.bird-card[data-active="true"]').forEach(function (c) {
      c.removeAttribute('data-active');
    });
    if (!sci) return;
    var attempts = 0;
    (function find() {
      var card = grid.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]');
      if (!card) {
        if (attempts++ < 10) return setTimeout(find, 80);
        return;
      }
      card.setAttribute('data-active', 'true');
      card.setAttribute('data-pulse', 'true');
      setTimeout(function () { card.removeAttribute('data-pulse'); }, 520);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })();
  }

  // The PHP facade's `species` action returned a summary plus every
  // detection in one shot. Here the summary comes from the already-loaded
  // lifelist and the detection list from /detections, reshaped to the
  // {d, t, conf, id} rows the modal renders. `id` replaces the old
  // `file` key, since birdnet-go addresses clips by detection id.
  function fetchSpeciesDetail(sci) {
    return fetchJson(apiUrl('/detections', {
      species: sci, queryType: 'species', numResults: 500, sortBy: 'date_desc',
    })).then(function (j) {
      var rows = (j && j.data) || [];
      var life = ((DATA.lifelist && DATA.lifelist.species) || [])
        .filter(function (s) { return s.sci === sci; })[0] || {};
      return {
        sci: sci,
        summary: {
          com: life.com || (rows[0] && rows[0].commonName) || sci,
          total: life.n || (j && j.total) || rows.length,
          first_seen: life.first_seen || '',
          last_seen: life.last_seen || '',
          best_conf: life.best_conf || 0,
        },
        detections: rows.map(function (d) {
          return { id: d.id, d: d.date, t: d.time, conf: d.confidence };
        }),
      };
    });
  }

  // Descriptions used to be fetched live from Wikipedia here. They now ship in
  // birdex.json (see tools/build-birdex.py), so the deployed page talks only to
  // its own BirdNET-Go - no third-party call from a visitor's browser at all.

  // ---- Detail modal ----
  // Caches per-sci species info so opening the same modal twice doesn't
  // re-fetch. Wikipedia + per-species endpoints are slow over the
  // tunnel; one fetch per session is plenty.
  var SPECIES_CACHE = {};
  var modalAudio = null;
  var modalRecBtn = null;
  function fmtRecTime(d, t) {
    // d="2026-05-15", t="20:25:29"
    if (!d) return '-';
    var date = new Date((d || '') + 'T' + (t || '00:00:00'));
    if (isNaN(date.getTime())) return d + ' ' + (t || '');
    var now = Date.now();
    var ago = Math.floor((now - date.getTime()) / 1000);
    if (ago < 60) return ago + 's ago';
    if (ago < 3600) return Math.floor(ago / 60) + 'm ago';
    if (ago < 86400) return Math.floor(ago / 3600) + 'h ago';
    return Math.floor(ago / 86400) + 'd ago';
  }
  function fmtDateLine(d, t) {
    if (!d) return '';
    try {
      var date = new Date(d + 'T' + (t || '00:00:00'));
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
        ' · ' + (t ? t.slice(0, 5) : '');
    } catch (e) { return d + ' ' + (t || ''); }
  }
  function rarityLabel(total, firstSeenIso) {
    if (!total) return '-';
    var days = 1;
    if (firstSeenIso) {
      var t = Date.parse((firstSeenIso || '').replace(' ', 'T'));
      if (!isNaN(t)) days = Math.max(1, Math.ceil((Date.now() - t) / 86400000));
    }
    var perDay = total / days;
    if (perDay >= 5) return 'common';
    if (perDay >= 1) return 'regular';
    if (perDay >= 0.2) return 'occasional';
    return 'rare';
  }
  // rAF-driven cursor smoothing. timeupdate fires ~4Hz which feels
  // janky; we sample audio.currentTime every animation frame and
  // interpolate to a 60Hz update so the playback knob glides.
  var modalCursorRaf = null;
  function startCursorLoop() {
    if (modalCursorRaf) return;
    var tick = function () {
      if (!modalAudio || !modalRecBtn) { modalCursorRaf = null; return; }
      var row = modalRecBtn.closest('.rec-row');
      if (row && modalAudio.duration) {
        var strip = row.querySelector('.rec-spectro');
        var played = strip && strip.querySelector('.rec-spectro-played');
        var cursor = strip && strip.querySelector('.rec-spectro-cursor');
        var pct = (modalAudio.currentTime / modalAudio.duration) * 100;
        if (played) played.style.width = pct.toFixed(3) + '%';
        if (cursor) cursor.style.left = pct.toFixed(3) + '%';
      }
      modalCursorRaf = requestAnimationFrame(tick);
    };
    modalCursorRaf = requestAnimationFrame(tick);
  }
  function stopCursorLoop() {
    if (modalCursorRaf) { cancelAnimationFrame(modalCursorRaf); modalCursorRaf = null; }
  }

  // Pause the currently-playing modal recording but KEEP the audio
  // element alive so the user can scrub (audio.currentTime is still
  // mutable on a paused element) and then resume from the same spot.
  // The cursor stays visible at its last position.
  function pauseModalAudio() {
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) { } }
    if (modalRecBtn) {
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
    }
  }
  // Hard-stop: pause + tear down the audio + clear cursor. Used when
  // switching rows or closing the modal.
  function stopModalAudio() {
    audioRelease(stopModalAudio);
    stopCursorLoop();
    if (modalAudio) { try { modalAudio.pause(); } catch (e) { } modalAudio = null; }
    if (modalRecBtn) {
      var prevRow = modalRecBtn.closest('.rec-row');
      if (prevRow) {
        var strip = prevRow.querySelector('.rec-spectro');
        if (strip) {
          strip.classList.remove('armed');
          var played = strip.querySelector('.rec-spectro-played');
          var cur = strip.querySelector('.rec-spectro-cursor');
          if (played) played.style.width = '0%';
          if (cur) cur.style.left = '0%';
        }
      }
      modalRecBtn.removeAttribute('data-active');
      modalRecBtn.innerHTML = ICON_PLAY;
      modalRecBtn = null;
    }
  }

  function sketchSrc(sci, pose) {
    return illustrationSrc(sci, pose);
  }
  function openDetailModal(sci) {
    if (!sci || !viewEnabled('atlas')) return;
    var modal = document.getElementById('detail-modal');
    var img = document.getElementById('modalImg');
    var poseToggle = document.getElementById('modalPoseToggle');
    var poseBtns = [].slice.call(poseToggle.querySelectorAll('button'));

    // Reset the toggle: assume nothing's available, set pose 1 (perched
    // cutout - every species has it) as the optimistic default. HEAD
    // probes below toggle each button on/off and pick the best default.
    poseToggle.removeAttribute('data-unavailable');
    poseBtns.forEach(function (b) {
      b.setAttribute('data-unavailable', 'true');
      b.setAttribute('aria-current', 'false');
    });
    var p1 = poseToggle.querySelector('button[data-pose="1"]');
    if (p1) {
      p1.removeAttribute('data-unavailable');
      p1.setAttribute('aria-current', 'true');
    }
    img.src = sketchSrc(sci, 1);
    img.alt = sci;

    // Probe each pose's image with HEAD. Build a list of available
    // poses, then pick the highest-numbered as the default (in-flight
    // > perched, etc.). When only one pose remains, hide the toggle
    // entirely - no choice means no UI.
    var probes = poseBtns.map(function (b) {
      var pose = +b.dataset.pose;
      return fetch(sketchSrc(sci, pose), { method: 'HEAD', cache: 'no-store' })
        .then(function (r) { return { pose: pose, btn: b, ok: r.ok }; })
        .catch(function () { return { pose: pose, btn: b, ok: false }; });
    });
    Promise.all(probes).then(function (results) {
      var available = results.filter(function (r) { return r.ok; });
      available.forEach(function (r) { r.btn.removeAttribute('data-unavailable'); });
      results.filter(function (r) { return !r.ok; }).forEach(function (r) {
        r.btn.setAttribute('data-unavailable', 'true');
      });
      // Default to the highest-numbered available pose (in-flight if
      // present, else fall back to perched).
      var pick = available.sort(function (a, b) { return b.pose - a.pose; })[0];
      if (pick) {
        poseBtns.forEach(function (b) {
          b.setAttribute('aria-current', b === pick.btn ? 'true' : 'false');
        });
        img.src = sketchSrc(sci, pick.pose);
      }
      // Single-option => hide the chrome.
      if (available.length <= 1) {
        poseToggle.setAttribute('data-unavailable', 'true');
      }
      // Slide the white pill to the active button.
      syncPill(poseToggle);
    });
    document.getElementById('modalSci').textContent = sci;
    document.getElementById('modalGenus').textContent = (sci.split(' ')[0] || '-');
    document.getElementById('modalCommon').textContent = '-';
    document.getElementById('modalAllTime').textContent = '-';
    document.getElementById('modalWindow').textContent = '-';
    // Window stat label tracks the picker; the whole stat is hidden for
    // the "all time" window since it would just echo the all-time count.
    var modalWinStat = document.getElementById('modalWindowStat');
    if (currentHours >= 1000000) {
      modalWinStat.style.display = 'none';
    } else {
      modalWinStat.style.display = '';
      document.getElementById('modalWindowLbl').textContent = windowLabel(currentHours);
    }
    document.getElementById('modalFirstSeen').textContent = '-';
    document.getElementById('modalRarity').textContent = '-';
    document.getElementById('modalRarity').classList.remove('rare');
    document.getElementById('modalDesc').textContent = 'Loading description...';
    document.getElementById('modalDesc').classList.add('placeholder');
    document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Loading recordings...</li>';
    document.getElementById('modalRecCount').textContent = '';
    document.getElementById('modalWiki').href = wikiUrl(sci);
    document.getElementById('modalEbird').href = ebirdUrl(sci);
    // FLIP-style morph: scale + translate the modal-card from the
    // clicked atlas card's position to its natural centered size, so
    // the card *expands* into the detail view instead of just fading
    // in. The outer modal MUST become visible (aria-hidden=false)
    // before we apply the initial transform - the browser skips
    // layout for opacity-0 trees, which would freeze the morph at the
    // starting frame.
    var sourceCard = atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    morphModalOpen(modal.querySelector('.modal-card'), sourceCard);

    // Species detail (lifelist row + every detection).
    var loadSpecies = SPECIES_CACHE[sci]
      ? Promise.resolve(SPECIES_CACHE[sci])
      : fetchSpeciesDetail(sci).then(function (j) {
        SPECIES_CACHE[sci] = j;
        return j;
      });
    loadSpecies.then(function (j) {
      // Capture the species this fetch was issued for. Opening a second bird
      // before /detections resolves would otherwise land the first response in
      // the second modal - name, counts, rarity and recordings all belonging
      // to the wrong bird. Same discipline as refreshRecent's window check.
      if ((document.getElementById('modalSci').textContent || '').trim() !== sci) return;
      var s = j.summary || {};
      document.getElementById('modalCommon').textContent = s.com || sci;
      document.getElementById('modalAllTime').textContent = (+s.total || 0).toLocaleString();
      var winRow = ((DATA.recent && DATA.recent.species) || []).filter(function (x) { return x.sci === sci; })[0];
      document.getElementById('modalWindow').textContent = (winRow ? +winRow.n : 0).toLocaleString();
      document.getElementById('modalFirstSeen').textContent = s.first_seen ? fmtRecTime(s.first_seen.split(' ')[0], s.first_seen.split(' ')[1]) : '-';
      var rar = rarityLabel(+s.total || 0, s.first_seen);
      var rarEl = document.getElementById('modalRarity');
      rarEl.textContent = rar;
      if (rar === 'rare') rarEl.classList.add('rare');
      var dets = j.detections || [];
      document.getElementById('modalRecCount').textContent = dets.length + ' captured';
      document.getElementById('modalRecordings').innerHTML = dets.length
        ? dets.map(function (d) {
          return '<li class="rec-row" data-id="' + (d.id || '') + '" data-date="' + (d.d || '') + '">'
            + '<button class="play" type="button" aria-label="play">' + ICON_PLAY + '</button>'
            + '<span class="when">' + fmtRecTime(d.d, d.t) + '<small>' + fmtDateLine(d.d, d.t) + '</small></span>'
            + '<span class="conf">' + ((+d.conf || 0) * 100).toFixed(0) + '%</span>'
            + '<div class="rec-spectro" aria-hidden="true">'
            + '<div class="rec-spectro-loading">loading spectrogram...</div>'
            + '<div class="rec-spectro-played"></div>'
            + '<div class="rec-spectro-cursor"></div>'
            + '<div class="rec-spectro-scrub" role="slider" aria-label="scrub" tabindex="0"></div>'
            + '</div>'
            + '</li>';
        }).join('')
        : '<li class="rec-empty">No recordings yet.</li>';
    }).catch(function () {
      if ((document.getElementById('modalSci').textContent || '').trim() !== sci) return;
      document.getElementById('modalRecordings').innerHTML = '<li class="rec-empty">Failed to load recordings.</li>';
    });

    // Description, straight from the offline database. This used to call
    // Wikipedia's REST summary endpoint per species on first open, which meant
    // a third-party request from every visitor's browser - and it returned the
    // article's lead section, which is strictly less text than birdex.json
    // already carries (11 words vs 186 for the hermit thrush). Species off the
    // roster simply have no description; add them to tools/roster-extra.txt.
    // Excerpted, not the whole thing: this is a card with the recordings list
    // below it, not a reading column, and a 300-word blurb would push the
    // recordings off the bottom. The full text lives in the Birdex entry.
    var descEl = document.getElementById('modalDesc');
    // #modalSci holds the open species (set below) - the same handle the
    // playback code reads. Guards against a second modal opening mid-fetch and
    // the first response landing in it.
    if (viewEnabled('birdex')) {
      loadBirdexText().then(function () {
        if ((document.getElementById('modalSci').textContent || '').trim() !== sci) return;
        var raw = blurbFor(birdexSlugFor(sci));
        var blurb = raw ? excerpt(raw, 620) : '';
        descEl.textContent = blurb || 'No description available.';
        descEl.classList.toggle('placeholder', !blurb);
      }).catch(function () {
        descEl.textContent = 'No description available.';
        descEl.classList.add('placeholder');
      });
    } else {
      descEl.textContent = 'No description available.';
      descEl.classList.add('placeholder');
    }
  }
  function closeDetailModal() {
    var modal = document.getElementById('detail-modal');
    stopModalAudio();
    // Reverse-morph back into the source atlas card so the modal
    // appears to *retract* to where it came from. Look the card up
    // fresh - the user may have switched the time window or sort
    // since opening the modal, so the source card may have moved.
    var sci = (document.getElementById('modalSci').textContent || '').trim();
    var sourceCard = sci && atlasGridEl
      ? atlasGridEl.querySelector('.bird-card[data-sci="' + sci.replace(/"/g, '\"') + '"]')
      : null;
    morphModalClose(modal.querySelector('.modal-card'), sourceCard, function () {
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    });
  }

  // Shared-element morph: the modal-card scales+translates from the
  // clicked atlas card's exact rect to its natural centred rect, so the
  // little card appears to expand into the big one (and retract on
  // close). Only the card transforms; the container's opacity does the
  // single fade for backdrop + card together - no double-fade, and the
  // transform is cleared only once hidden so there's no mid-close snap.
  var atlasGridEl = document.getElementById('atlasGrid');
  var modalCloseResetTimer = null;
  function morphTransform(modalCard, sourceCard) {
    if (!modalCard || !sourceCard) return null;
    var s = sourceCard.getBoundingClientRect();
    // Source off-screen (opened from stats mid-slide, or scrolled away)
    // -> skip the morph and just fade, rather than fly in from nowhere.
    if (!s.width || s.bottom < 0 || s.top > window.innerHeight ||
      s.right < 0 || s.left > window.innerWidth) return null;
    var m = modalCard.getBoundingClientRect();
    if (!m.width) return null;
    var scale = Math.max(0.1, s.width / m.width);
    var dx = (s.left + s.width / 2) - (m.left + m.width / 2);
    var dy = (s.top + s.height / 2) - (m.top + m.height / 2);
    return 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0) scale(' + scale.toFixed(4) + ')';
  }
  // Run cb once the transform transition finishes, with a timeout
  // fallback for environments where transitionend doesn't fire.
  function onceTransformEnd(el, cb, fallbackMs) {
    var fired = false;
    function handler(ev) {
      if (ev && ev.propertyName && ev.propertyName !== 'transform') return;
      if (fired) return;
      fired = true;
      el.removeEventListener('transitionend', handler);
      cb();
    }
    el.addEventListener('transitionend', handler);
    setTimeout(handler, fallbackMs);
  }
  function morphModalOpen(modalCard, sourceCard) {
    var modal = document.getElementById('detail-modal');
    if (!modalCard) { modal.classList.add('is-open'); return; }
    if (modalCloseResetTimer) {
      clearTimeout(modalCloseResetTimer);
      modalCloseResetTimer = null;
    }
    // Identity first so we can measure the card's natural rect, then jump
    // it (no transition) to the source card's position + scale.
    modalCard.classList.remove('is-morphing');
    modalCard.style.transform = '';
    void modalCard.offsetWidth;
    var start = morphTransform(modalCard, sourceCard);
    if (start) {
      modalCard.style.transform = start;
      void modalCard.offsetWidth;
    }
    // Next tick: fade the container in and glide the card to identity.
    // setTimeout (not rAF) - rAF can stall in non-painting/headless
    // contexts; the forced reflow above already commits the start
    // transform so the transition interpolates cleanly from it.
    setTimeout(function () {
      modal.classList.add('is-open');
      if (start) {
        modalCard.classList.add('is-morphing');
        modalCard.style.transform = 'translate3d(0,0,0) scale(1)';
      }
    }, 0);
    if (start) {
      onceTransformEnd(modalCard, function () {
        // A close took over (is-open gone); clearing now snaps the card to centre.
        if (!modal.classList.contains('is-open')) return;
        modalCard.classList.remove('is-morphing');
        modalCard.style.transform = '';
      }, 360);
    }
  }
  function morphModalClose(modalCard, sourceCard, done) {
    var modal = document.getElementById('detail-modal');
    // Fade the container out (backdrop + card) and retract the card to
    // the source rect at the same time.
    modal.classList.remove('is-open');
    var end = modalCard ? morphTransform(modalCard, sourceCard) : null;
    var finish = function () {
      if (done) done();
      if (modalCard) {
        if (modalCloseResetTimer) clearTimeout(modalCloseResetTimer);
        modalCloseResetTimer = setTimeout(function () {
          modalCard.classList.remove('is-morphing');
          modalCard.style.transform = '';
          modalCloseResetTimer = null;
        }, 240);
      }
    };
    if (modalCard && end) {
      modalCard.classList.add('is-morphing');
      void modalCard.offsetWidth;
      modalCard.style.transform = end;
      onceTransformEnd(modalCard, finish, 360);
    } else {
      // No morph -> let the container opacity fade run, then hide.
      setTimeout(finish, 280);
    }
  }

  // Pose toggle inside the modal - swaps the sketch between perched
  // (default) and in-flight alt pose. A short opacity transition makes
  // the swap feel intentional rather than a hard cut.
  document.getElementById('modalPoseToggle').addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('button');
    if (!btn || btn.getAttribute('data-unavailable') === 'true') return;
    var pose = +btn.dataset.pose;
    var toggle = document.getElementById('modalPoseToggle');
    [].slice.call(toggle.querySelectorAll('button')).forEach(function (b) {
      b.setAttribute('aria-current', b === btn ? 'true' : 'false');
    });
    syncPill(toggle);
    var img = document.getElementById('modalImg');
    var sci = document.getElementById('modalSci').textContent;
    img.classList.add('swapping');
    setTimeout(function () {
      img.src = sketchSrc(sci, pose);
      img.addEventListener('load', function once() {
        img.classList.remove('swapping');
        img.removeEventListener('load', once);
      });
    }, 180);
  });

  // Expose for debugging during dev - also lets the modal be opened
  // from outside the IIFE if needed.
  window.__openDetailModal = openDetailModal;
  window.__closeDetailModal = closeDetailModal;


  // #about - brief explainer popup; reached via /about (302 -> /#about)
  // or the masthead eyebrow. aria-hidden drives the CSS fade/slide.
  function openAbout() { document.getElementById('about-modal').setAttribute('aria-hidden', 'false'); }
  function closeAbout() { document.getElementById('about-modal').setAttribute('aria-hidden', 'true'); }

  // A detail card is always shown over the atlas, but you can open one from
  // any view (tapping a collage bird, a stats row, a timeline square). Closing
  // it should put you back where you started rather than stranding you on the
  // atlas. Null means no card is open; otherwise this stores the originating
  // view key so disabling/reordering views cannot send the user to the wrong one.
  var viewBeforeDetail = null;
  function syncRouter() {
    window.__lastHashchange = Date.now();
    var sci = readHash();
    var dex = readBirdexHash();
    if (location.hash === '#about') openAbout(); else closeAbout();
    if (dex && viewEnabled('birdex')) {
      // A Birdex deep link owns the view outright - it isn't an overlay, so it
      // never captures viewBeforeDetail and never opens the detail modal.
      highlightAtlas(null); closeDetailModal();
      goView('birdex');
      loadBirdex().then(function () { birdexSelect(dex); }).catch(function () { });
      return;
    }
    if (dex && !viewEnabled('birdex')) {
      history.replaceState(null, '', location.pathname + location.search);
      dex = null;
    }
    if (sci && viewEnabled('atlas')) {
      if (viewBeforeDetail === null) viewBeforeDetail = currentViewKey();
      goView('atlas');
      highlightAtlas(sci); openDetailModal(sci);
    } else if (sci && !viewEnabled('atlas')) {
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      var back = viewBeforeDetail;
      viewBeforeDetail = null;
      highlightAtlas(null); closeDetailModal();
      if (back !== null) goView(back);
    }
  }
  if (location.hash === '#about') openAbout();
  // Initial load with a #sci= hash: route through syncRouter so the card opens
  // over the atlas and closing it falls back to the collage.
  if (readHash() || readBirdexHash()) syncRouter();
  window.addEventListener('hashchange', syncRouter);

  // Modal interactions: backdrop / close button -> clear the hash.
  document.getElementById('detail-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
      document.getElementById('detail-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeDetailModal(); }
    }
  });

  // About popup: backdrop / close / explore button all carry data-close,
  // which clears the hash and routes through syncRouter -> closeAbout.
  // The masthead eyebrow opens it; Escape dismisses it.
  document.getElementById('about-modal').addEventListener('click', function (ev) {
    if (ev.target.dataset && ev.target.dataset.close === '1') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' &&
      document.getElementById('about-modal').getAttribute('aria-hidden') === 'false') {
      if (location.hash) { location.hash = ''; } else { closeAbout(); }
    }
  });
  document.getElementById('aboutLink').addEventListener('click', function () {
    location.hash = '#about';
  });

  // Shared decode context for spectrogram generation. Lives once for
  // the page; lazily created on first expand to avoid bootstrapping
  // WebAudio if no one ever opens a row.
  var _specAudioCtx = null;
  function getSpecCtx() {
    if (!_specAudioCtx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (C) _specAudioCtx = new C();
    }
    return _specAudioCtx;
  }

  // Cache decoded AudioBuffers per file so repeated expand/collapse on
  // the same row doesn't re-fetch + re-decode the mp3.
  var _decodedCache = {};

  // Minimal in-place Cooley-Tukey radix-2 FFT (n must be a power of 2).
  // Operates on parallel real/imag Float32Array buffers. ~30 lines and
  // fast enough for our ~1024-sample windows of 3-second clips.
  function _fft(real, imag) {
    var n = real.length;
    var j = 0;
    for (var i = 0; i < n - 1; i++) {
      if (i < j) {
        var tr = real[i]; real[i] = real[j]; real[j] = tr;
        var ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
      var k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (var stage = 2; stage <= n; stage *= 2) {
      var half = stage >> 1;
      var ang = -2 * Math.PI / stage;
      var wR = Math.cos(ang), wI = Math.sin(ang);
      for (var sBase = 0; sBase < n; sBase += stage) {
        var cR = 1, cI = 0;
        for (var sb = 0; sb < half; sb++) {
          var a = sBase + sb;
          var b = a + half;
          var trA = real[b] * cR - imag[b] * cI;
          var tiA = real[b] * cI + imag[b] * cR;
          real[b] = real[a] - trA;
          imag[b] = imag[a] - tiA;
          real[a] = real[a] + trA;
          imag[a] = imag[a] + tiA;
          var nR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR;
          cR = nR;
        }
      }
    }
  }

  // Paint an STFT spectrogram onto the strip's canvas. y-axis is the
  // bird audible band (~200 Hz - ~10 kHz) on a mildly compressed log
  // scale; x-axis is time across the whole clip; colour is dB
  // magnitude mapped to our warm ink palette over the dark paper-ink
  // ground.
  function paintSpectrogram(canvas, audioBuffer) {
    // Defer to the next animation frame so the canvas has been laid out
    // (the parent strip may still be mid-transition expanding from 0).
    // Without this, subsequent expansions paint onto a zero-sized canvas.
    requestAnimationFrame(function () {
      _paintSpectrogramNow(canvas, audioBuffer);
    });
  }
  function _paintSpectrogramNow(canvas, audioBuffer) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    // Read parent strip's box, not the canvas (canvas might be 0-sized
    // briefly during expansion). The strip's expanded height is 88px;
    // width is the row width.
    var strip = canvas.parentElement;
    var cssW = strip ? strip.clientWidth : (canvas.clientWidth || 600);
    var cssH = strip ? strip.clientHeight : (canvas.clientHeight || 88);
    if (cssW < 32 || cssH < 32) {
      // Strip still collapsing in. Retry a frame later.
      requestAnimationFrame(function () { _paintSpectrogramNow(canvas, audioBuffer); });
      return;
    }
    var W = Math.max(1, Math.floor(cssW * dpr));
    var H = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = W; canvas.height = H;

    var ctx = canvas.getContext('2d');
    var samples = audioBuffer.getChannelData(0);
    var sr = audioBuffer.sampleRate;
    var FFT_SIZE = 1024;
    var bins = FFT_SIZE >> 1;
    var nyquist = sr / 2;

    // Frequency-band mapping (Hz -> bin) for the bird-relevant band.
    // Most North American songbirds + corvids range 250 Hz - 8 kHz, but
    // hummingbirds, kinglets, and warblers reach 12 kHz. Push the cap
    // up so we don't miss the high-frequency tail.
    var fLo = 200, fHi = Math.min(12000, nyquist);
    var binLo = Math.max(1, Math.floor(fLo / nyquist * bins));
    var binHi = Math.min(bins - 1, Math.ceil(fHi / nyquist * bins));

    // Hann window
    var win = new Float32Array(FFT_SIZE);
    for (var i = 0; i < FFT_SIZE; i++) {
      win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
    }

    // Choose a hop that lays exactly W columns over the whole clip.
    var hop = Math.max(1, Math.floor((samples.length - FFT_SIZE) / Math.max(1, W - 1)));
    var real = new Float32Array(FFT_SIZE);
    var imag = new Float32Array(FFT_SIZE);

    var imgData = ctx.createImageData(W, H);
    var data = imgData.data;

    // Paper ground; ink intensifies where there's audio energy. Theme-
    // aware so dark mode gets a charcoal ground with a light trace instead
    // of a glaring light rectangle (matches --paper / --ink per theme).
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var BG_R = dark ? 23 : 245, BG_G = dark ? 24 : 240, BG_B = dark ? 28 : 230;
    var FG_R = dark ? 236 : 26, FG_G = dark ? 232 : 22, FG_B = dark ? 225 : 18;
    for (var p = 0; p < data.length; p += 4) {
      data[p] = BG_R; data[p + 1] = BG_G; data[p + 2] = BG_B; data[p + 3] = 255;
    }

    // Precompute row -> bin map (log-ish so low freqs get more space).
    var rowToBin = new Int32Array(H);
    for (var row = 0; row < H; row++) {
      var t = 1 - row / (H - 1); // 1 at top, 0 at bottom
      var bin = Math.round(binLo + (binHi - binLo) * Math.pow(t, 1.55));
      rowToBin[row] = Math.max(binLo, Math.min(binHi, bin));
    }

    for (var col = 0; col < W; col++) {
      var start = col * hop;
      if (start + FFT_SIZE > samples.length) break;
      for (var s = 0; s < FFT_SIZE; s++) {
        real[s] = samples[start + s] * win[s];
        imag[s] = 0;
      }
      _fft(real, imag);
      for (var row2 = 0; row2 < H; row2++) {
        var bin2 = rowToBin[row2];
        var re = real[bin2], im = imag[bin2];
        var mag = Math.sqrt(re * re + im * im);
        // log compress; -75 .. -10 dB -> 0 .. 1
        var db = 20 * Math.log10(mag + 1e-9);
        var v = (db + 75) / 65;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        // Ink-on-paper palette: low energy -> paper, high energy -> ink.
        // Smoothstep for a softer falloff between the two extremes.
        var e = v * v * (3 - 2 * v);
        var r = BG_R + Math.round((FG_R - BG_R) * e);
        var g = BG_G + Math.round((FG_G - BG_G) * e);
        var b = BG_B + Math.round((FG_B - BG_B) * e);
        var px = (row2 * W + col) * 4;
        data[px] = r; data[px + 1] = g; data[px + 2] = b; data[px + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    canvas.classList.add('ready');
  }

  // Lazy-add + paint the canvas-based spectrogram for a row's strip.
  // Decoded buffers are cached per file so re-expanding is instant.
  function ensureSpectroImage(row) {
    var file = row && row.dataset.id;
    if (!file) return;
    var strip = row.querySelector('.rec-spectro');
    if (!strip) return;
    var loadingEl = strip.querySelector('.rec-spectro-loading');
    var canvas = strip.querySelector('canvas');
    if (canvas && canvas.classList.contains('ready')) {
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }
    if (!canvas) {
      canvas = document.createElement('canvas');
      var played = strip.querySelector('.rec-spectro-played');
      strip.insertBefore(canvas, played);
    }
    if (loadingEl) {
      loadingEl.style.display = '';
      loadingEl.textContent = 'rendering spectrogram...';
    }

    function done() {
      if (loadingEl) loadingEl.style.display = 'none';
    }
    function fail(reason) {
      if (loadingEl) {
        loadingEl.style.display = '';
        loadingEl.textContent = reason || 'spectrogram unavailable';
      }
    }

    if (_decodedCache[file]) {
      paintSpectrogram(canvas, _decodedCache[file]);
      done();
      return;
    }
    var ctx = getSpecCtx();
    if (!ctx) { fail('WebAudio not available'); return; }
    fetch(audioSrc(file), { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { return ctx.decodeAudioData(buf); })
      .then(function (audioBuffer) {
        _decodedCache[file] = audioBuffer;
        paintSpectrogram(canvas, audioBuffer);
        done();
      })
      .catch(function (e) {
        fail('spectrogram failed: ' + (e && e.message ? e.message : ''));
      });
  }

  // Per-recording row interactions in the modal:
  //   - Clicking anywhere on the row toggles the spectrogram strip
  //     (independent of playback). Click again to collapse.
  //   - Clicking the play button toggles audio playback. Playback shows
  //     the moving cursor on whatever strip is already expanded; if the
  //     strip is collapsed, playing also expands it.
  //   - Clicking on the spectrogram itself scrubs (handled in the
  //     mousedown/touchstart wiring further down).
  document.getElementById('modalRecordings').addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    // Scrub-region clicks are handled by the mousedown wiring below.
    if (ev.target.closest('.rec-spectro-scrub')) return;

    var playBtn = ev.target.closest('.play');
    if (playBtn) {
      // Play / pause toggle. Three cases:
      //   (a) clicking the playing row's button -> pause (KEEP audio
      //       alive so the user can scrub then resume).
      //   (b) clicking a paused row's button (it's still modalRecBtn,
      //       audio still alive, just paused) -> resume from cursor.
      //   (c) clicking a different row's button -> stop the old, start
      //       the new.
      var prow = playBtn.closest('.rec-row');
      var pfile = prow && prow.dataset.id;
      if (!pfile) return;

      if (modalRecBtn === playBtn && modalAudio) {
        // Same row's button - toggle pause/resume.
        if (modalAudio.paused) {
          playBtn.setAttribute('data-active', 'true');
          playBtn.innerHTML = ICON_PAUSE;
          audioClaim(stopModalAudio);   // stop any card / live-stream audio
          modalAudio.play().catch(function () { });
        } else {
          pauseModalAudio();
        }
        return;
      }

      // Different row (or no current playback) - stop any current,
      // start fresh.
      stopModalAudio();
      audioClaim(stopModalAudio);   // stop any card / live-stream audio
      playBtn.setAttribute('data-active', 'true');
      playBtn.innerHTML = ICON_PAUSE;
      modalRecBtn = playBtn;
      prow.classList.add('expanded');
      ensureSpectroImage(prow);
      var strip = prow.querySelector('.rec-spectro');
      var audio = new Audio(audioSrc(pfile));
      modalAudio = audio;
      audio.addEventListener('loadedmetadata', function () {
        strip.classList.add('armed');
      });
      audio.addEventListener('playing', startCursorLoop);
      audio.addEventListener('pause', stopCursorLoop);
      audio.addEventListener('ended', function () {
        // Natural end: rewind cursor + keep audio so user can replay.
        stopCursorLoop();
        var p = strip.querySelector('.rec-spectro-played');
        var c = strip.querySelector('.rec-spectro-cursor');
        if (p) p.style.width = '0%';
        if (c) c.style.left = '0%';
        if (modalAudio) modalAudio.currentTime = 0;
        if (modalRecBtn) {
          modalRecBtn.removeAttribute('data-active');
          modalRecBtn.innerHTML = ICON_PLAY;
        }
      });
      audio.addEventListener('error', function () {
        stopModalAudio();
        playBtn.innerHTML = '<span style="font-size:8px">!</span>';
        setTimeout(function () { playBtn.innerHTML = ICON_PLAY; }, 1500);
      });
      audio.play().catch(function () { stopModalAudio(); });
      return;
    }

    // Row click anywhere else -> toggle strip open/closed.
    var row = ev.target.closest('.rec-row');
    if (!row) return;
    var willExpand = !row.classList.contains('expanded');
    if (willExpand) {
      row.classList.add('expanded');
      ensureSpectroImage(row);
    } else {
      // Collapsing the row where playback is happening also stops audio
      // (the cursor would just be hidden otherwise).
      if (modalRecBtn && modalRecBtn.closest('.rec-row') === row) stopModalAudio();
      row.classList.remove('expanded');
    }
  });

  // Scrub by clicking / dragging on the spectrogram strip.
  (function () {
    var dragRow = null;
    function seekFromEvent(row, clientX) {
      if (!modalAudio || !modalAudio.duration) return;
      var rowBtn = row.querySelector('.play');
      if (rowBtn !== modalRecBtn) return;
      var strip = row.querySelector('.rec-spectro');
      var rect = strip.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      modalAudio.currentTime = pct * modalAudio.duration;
      // Repaint cursor + played immediately so the user sees the scrub
      // even when audio is paused (rAF loop isn't running then).
      var pctStr = (pct * 100).toFixed(2) + '%';
      var played = strip.querySelector('.rec-spectro-played');
      var cur = strip.querySelector('.rec-spectro-cursor');
      if (played) played.style.width = pctStr;
      if (cur) cur.style.left = pctStr;
    }
    document.getElementById('modalRecordings').addEventListener('mousedown', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.clientX);
      ev.preventDefault();
    });
    document.addEventListener('mousemove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.clientX);
    });
    document.addEventListener('mouseup', function () { dragRow = null; });
    // Touch.
    document.getElementById('modalRecordings').addEventListener('touchstart', function (ev) {
      var s = ev.target.closest && ev.target.closest('.rec-spectro-scrub');
      if (!s) return;
      var row = s.closest('.rec-row');
      if (!row || !row.classList.contains('expanded')) return;
      dragRow = row;
      seekFromEvent(row, ev.touches[0].clientX);
      ev.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (ev) {
      if (!dragRow) return;
      seekFromEvent(dragRow, ev.touches[0].clientX);
    });
    document.addEventListener('touchend', function () { dragRow = null; });
  })();

  // Any element with data-sci is a "jump to that bird's atlas card"
  // affordance: atlas cards themselves, stats list rows (top species /
  // first detections), stats timeline squares, and any future surface
  // that wants to point at a bird. Action chips inside cards stop
  // propagation themselves.
  function jumpToSci(sci) {
    if (!sci || !viewEnabled('atlas')) return;
    if (location.hash !== '#sci=' + encodeURIComponent(sci)) {
      location.hash = '#sci=' + encodeURIComponent(sci);
    } else {
      // Same hash -> still re-highlight (the user clicked it again).
      goView(viewEnabled('atlas') ? 'atlas' : enabledViews[0].key);
      highlightAtlas(sci);
    }
  }
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var card = ev.target.closest('.bird-card');
    if (card) {
      if (ev.target.closest('.actions, .spectro-wrap')) return;
      return jumpToSci(card.dataset.sci);
    }
    var row = ev.target.closest('li[data-sci]');
    if (row) return jumpToSci(row.dataset.sci);
    var tlCol = ev.target.closest('.stats-tl-col[data-sci]');
    if (tlCol) return jumpToSci(tlCol.dataset.sci);
  });

  // ---- Birdex interactions ----
  // Selection routes through the hash rather than being applied directly, so
  // an entry is linkable and the browser's back button walks the entries the
  // same way it walks detail cards.
  (function wireBirdex() {
    if (!viewEnabled('birdex')) return;
    var v3 = document.getElementById('v3');
    if (!v3) return;
    var listEl = document.getElementById('birdexList');
    var search = document.getElementById('birdexSearch');

    listEl.addEventListener('click', function (ev) {
      var row = ev.target.closest && ev.target.closest('.birdex-row');
      if (!row) return;
      var slug = row.dataset.slug;
      // Re-clicking the open entry can't fire hashchange, so apply directly.
      if (location.hash.toLowerCase() === '#birdex/' + slug) birdexSelect(slug);
      else location.hash = '#birdex/' + slug;
    });

    if (search) {
      search.addEventListener('input', function () {
        birdexQuery = search.value || '';
        renderBirdex();
      });
    }

    var back = document.getElementById('birdexBack');
    if (back) {
      back.addEventListener('click', function () { v3.setAttribute('data-pane', 'list'); });
    }

    // Restore the last entry viewed - recorded now, drawn when renderBirdex
    // first runs, so this doesn't drag birdex.json onto the load path. The
    // pane deliberately stays on the list: on a narrow screen, landing inside
    // an entry you didn't just pick reads as being stuck, not as restored.
    var last = readLS('bird:birdexSel', '');
    if (last && !readBirdexHash()) birdexSel = last;
  })();

  // After the atlas re-renders (window change, fresh fetch), re-apply
  // any active hash so the highlight survives a rebuild.
  var _origRenderAtlas = renderAtlas;
  renderAtlas = function (animate) {
    _origRenderAtlas(animate);
    var s = readHash();
    if (s) highlightAtlas(s);
  };
  }
  var ready = window.__AVIAN_CONFIG_READY;
  if (ready && typeof ready.then === 'function') ready.then(start, start);
  else start();
})();
