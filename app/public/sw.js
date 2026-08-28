/**
 * Service worker for the app shell.
 *
 * Scope is deliberately narrow: cache the built shell so the app opens in a
 * dead spot, and stay out of the way of everything else.
 *
 * Supabase requests are never cached or intercepted. A cached API response is
 * worse than no response — a promoter would see yesterday's sales and believe
 * them. Writes are the write queue's job, not this file's; the two must not
 * both try to own retrying, or a queued sale replays twice.
 */

const VERSION = 'v1';
const SHELL_CACHE = `datracker-shell-${VERSION}`;

/**
 * Precached at install so a cold start with no signal still boots. Hashed asset
 * filenames change every build, so they are cached on first use instead of
 * being listed here.
 */
const SHELL = ['.', 'index.html', 'manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 cannot fail the whole install and leave the
      // app with no service worker at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GETs are cacheable, and only from this origin. Anything else —
  // Supabase reads, every write — goes straight to the network untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A navigation must always try the network first, so a deployed update is
  // picked up rather than being pinned to a stale shell forever.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? caches.match('index.html').then((fallback) => fallback ?? Response.error());
        }),
    );
    return;
  }

  // Build assets carry a content hash in the filename, so a cache hit is always
  // the right bytes and never stale.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
