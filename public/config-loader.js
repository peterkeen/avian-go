// Load an optional, deployment-local config.js before the application starts.
// A missing file is expected and silently falls back to apt.js defaults.
window.__AVIAN_CONFIG_READY = fetch('./config.js', { cache: 'no-store' })
  .then(function (response) {
    if (!response.ok) return;
    return response.text().then(function (source) {
      if (source) (0, eval)(source + '\n//# sourceURL=config.js');
    });
  })
  .catch(function () {});
