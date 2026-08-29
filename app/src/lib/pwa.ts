/**
 * Service worker registration.
 *
 * Registered from a relative path so the scope follows wherever the build is
 * deployed. That is what let the app move from /DaTrack/next/ to the site root
 * without touching this file. Getting it wrong fails quietly: the app keeps
 * working online and simply never caches anything, which is exactly the failure
 * nobody notices until a dead spot.
 */

export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Only over HTTPS or localhost — a service worker is refused elsewhere, and
  // the resulting console error is noise rather than information.
  const secure = window.isSecureContext;
  if (!secure) return;

  window.addEventListener('load', () => {
    // The URL is resolved against the document, so the registration scope
    // follows wherever the build is deployed.
    const url = new URL('sw.js', document.baseURI).toString();
    void navigator.serviceWorker.register(url, { scope: './' }).catch(() => {
      // A failed registration must never break the app. Offline caching is an
      // enhancement; the write queue, which is the part that protects data,
      // does not depend on it.
    });
  });
}
