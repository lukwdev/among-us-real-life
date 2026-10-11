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
