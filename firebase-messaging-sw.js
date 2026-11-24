/* =====================================================
   اردو انٹر کام — Service Worker (FCM Push & PWA Offline Cache)
   ===================================================== */

const CACHE_NAME = 'urdu-intercom-shell-v6';
const APP_SHELL = [
  '/',
  '/index.html',
  '/config.js',
  '/manifest.webmanifest',
  '/assets/lame.min.js',
  '/assets/icon.svg',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-maskable-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/badge-96.png',
  '/assets/fonts/nafees_web_naskhshipped.woff2',
  '/assets/fonts/nafees_web_naskhshipped.ttf',
  '/assets/fonts/Al_Mushaf.woff2',
  '/assets/fonts/Noto_Nastaliq_Urdu_400.woff2',
  '/assets/fonts/Noto_Nastaliq_Urdu_700.woff2',
  '/assets/fonts/Montserrat_400.woff2',
  '/assets/fonts/Montserrat_600.woff2',
  '/assets/fonts/Montserrat_700.woff2',
  '/assets/fonts/Montserrat_800.woff2',
  '/assets/fonts/Istok_Web_400.woff2',
  '/assets/fonts/Istok_Web_700.woff2'
];

// 1. Firebase Messaging (FCM Background Handler)
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  importScripts('/config.js');
  try { importScripts('/firebase-config.test.js'); } catch(e) {}

  const isSwLocalhost = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
  let swConfig = typeof FIREBASE_CONFIG !== 'undefined' ? FIREBASE_CONFIG : null;

  if (isSwLocalhost && typeof FIREBASE_CONFIG_TEST !== 'undefined' && FIREBASE_CONFIG_TEST) {
    swConfig = FIREBASE_CONFIG_TEST;
  }

  // Safety Guard: never run against production on localhost
  if (isSwLocalhost && swConfig && swConfig.projectId === 'intercom-8a920') {
    throw new Error('Service Worker safety guard: Production Firebase blocked on localhost');
  }

  if (swConfig && swConfig.apiKey) {
    if (!firebase.apps.length) {
      firebase.initializeApp(swConfig);
    }
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const data = payload.data || {};
      const title = data.title || (payload.notification && payload.notification.title) || 'انٹر کام';
      const body = data.body || (payload.notification && payload.notification.body) || 'نیا پیغام موصول ہوا ہے';
      const tag = data.tag || 'intercom-msg';
      const url = data.url || '/';

      const options = {
        body: body,
        tag: tag,
        renotify: true,
        vibrate: [250, 100, 250, 100, 300],
        icon: '/assets/icon-192.png',
        badge: '/assets/badge-96.png',
        lang: 'ur',
        dir: 'rtl',
        requireInteraction: true,
        data: { url: url }
      };

      return self.registration.showNotification(title, options);
    });
  }
} catch (e) {
  console.warn('Service worker Firebase init warning:', e);
}

// 2. Notification Click Handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// 3. Service Worker Lifecycle: Precache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('Failed to cache some app-shell items:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim()).then(() => {
      // Notify active clients that new version is ready
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_NAME });
        });
      });
    })
  );
});

// 4. Fetch Strategy
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never cache Firebase database / auth traffic or backend API functions
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseinstallations.googleapis.com') ||
    url.hostname.includes('fcmregistrations.googleapis.com') ||
    url.pathname.startsWith('/api/') ||
    req.method !== 'GET'
  ) {
    return;
  }

  // Network-First for HTML and config.js (so config updates and code updates reach users immediately)
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/config.js') {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => {
        return caches.match(req).then((cached) => cached || caches.match('/index.html'));
      })
    );
    return;
  }

  // Cache-First with background revalidation for static assets (fonts, icons, lamejs, manifest)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // revalidate in background
        fetch(req).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, netRes));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((netRes) => {
        if (netRes && netRes.status === 200) {
          const clone = netRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return netRes;
      });
    })
  );
});
