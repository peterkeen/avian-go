// Copy this file to config.js and change only the settings you need.
// config.js is optional; when it is absent, these defaults are used.
window.AVIAN_CONFIG = {
  // Available view keys: collage, stats, atlas, birdex.
  // At least one view must remain enabled.
  enabledViews: {
    collage: true,
    stats: true,
    atlas: true,
    birdex: true
  },

  // Accepted values: "1H", "12H", "24H", "7D", "ALL".
  defaultTimePeriod: "24H",

  // Hide the picker while continuing to use defaultTimePeriod.
  timePeriodPickerVisible: true,

  // Used in the browser title, masthead link, and About dialog eyebrow.
  siteName: "your birds",

  // Empty means same-origin. For a separate BirdNET-Go host, use e.g.
  // "https://birdnet.example.com" (without /api/v2).
  apiUrl: "",

  birdex: {
    // Every bird carries an ecological guild and traits. A handful also carry
    // a hand-awarded elemental badge - fire, ice, ghost - which is subjective
    // and for fun. Set false for a straight field guide; the guild and trait
    // badges are unaffected.
    elementalWhimsy: true
  }
};
