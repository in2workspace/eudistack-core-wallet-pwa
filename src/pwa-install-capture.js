// Captures the PWA install prompt before Angular bootstraps (race condition fix):
// PwaInstallService picks it up from window.__pwaInstallPrompt.
// Global script of angular.json, not inline in index.html, so the CSP needs no
// 'unsafe-inline' in script-src and the bundle gets a hashed name and SRI (EUD-332).
window.__pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
});
