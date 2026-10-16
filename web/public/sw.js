const CACHE_NAME = 'among-us-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/app-icon.svg',
  '/favicon.svg',
  '/site.webmanifest',
  '/sounds/start.mp3',
  '/sounds/meeting.mp3',
  '/sounds/vote-result.mp3',
  '/sounds/sabotage.mp3',
  '/sounds/sussy-boy.mp3',
  '/sounds/you-win.mp3',
  '/sounds/you-lose.mp3',
  '/images/emergency-meeting.jpg',
  '/images/kill.png',
  '/images/kill-cooldown.png',
  '/images/report.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('Pre-caching assets partially failed, continuing...', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Do not intercept socket.io, API calls, or non-same-origin requests
  if (url.origin !== self.location.origin || url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) {
    return;
  }

  // Navigation requests: Network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html') || caches.match('/'))
    );
    return;
  }

  // Static assets (images, audio, svg, css, js): Cache-first with background network update
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background for next time
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        }
        return networkResponse;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.warn('Received an invalid push notification payload.', error);
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Among Us in Real Life', {
    body: payload.body || 'A meeting needs your attention.',
    icon: '/images/emergency-meeting.jpg',
    tag: payload.tag || 'among-us-notification',
    data: { url: payload.url || '/' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || '/', self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : `${self.location.origin}/`;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((windowClient) => windowClient.url.startsWith(self.location.origin));
    if (client) {
      return client.navigate(targetUrl).then(() => client.focus());
    }
    return self.clients.openWindow(targetUrl);
  }));
});
