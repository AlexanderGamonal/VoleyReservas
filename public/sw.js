/**
 * VoleyReservas - Service Worker
 * Handles push notifications and offline caching
 */

const CACHE_NAME = 'voleyreservas-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/admin.html',
  '/css/styles.css',
  '/css/admin.css',
  '/js/app.js',
  '/js/admin.js',
  '/manifest.json',
  '/manifest-admin.json',
  '/img/icon-192.png',
  '/img/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Stale-while-revalidate para el shell estático de la app. La API nunca se
// cachea: los datos de reservas siempre deben venir de red.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

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

// Activate event: limpia versiones viejas del cache del shell
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});
