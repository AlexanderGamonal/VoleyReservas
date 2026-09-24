/**
 * VoleyReservas - Service Worker
 * Handles push notifications and offline caching
 */

// Listen for push events
self.addEventListener('push', (event) => {
  let data = {
    title: '🏐 VoleyReservas',
    body: 'Nueva notificación',
    icon: '/img/icon-192.png',
    badge: '/img/badge-72.png',
    data: {}
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'default',
    requireInteraction: data.requireInteraction || true,
    data: data.data || {},
    actions: [
      { action: 'open', title: 'Ver reserva' },
      { action: 'dismiss', title: 'Ignorar' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const urlToOpen = event.notification.data?.url || '/admin.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If admin panel is already open, focus it
      for (const client of clientList) {
        if (client.url.includes('admin.html') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
