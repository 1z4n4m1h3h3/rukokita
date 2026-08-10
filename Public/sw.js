const CACHE_NAME = 'adequa-pwa-v8';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/dashboard.html',
    '/theme.css',
    '/theme-manager.js',
    '/style.css',
    '/login-style.css',
    '/script.js',
    '/login.js',
    '/ADEQUA-LOGO.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
    'https://cdn.jsdelivr.net/npm/remixicon/fonts/remixicon.css'
];

// Install Event: Cache Asset Utama
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Opened cache');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

// Activate Event: Hapus Cache Lama
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

// Fetch Event: Network First strategy untuk API, Cache First untuk Static Assets
self.addEventListener('fetch', (event) => {
    const isApiCall = event.request.url.includes('/api/') || event.request.url.includes('/login') || event.request.url.includes('/logout');

    if (isApiCall) {
        // Network First untuk request API dan Auth
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(event.request);
            })
        );
    } else {
        // Stale-While-Revalidate untuk static assets
        event.respondWith(
            caches.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    caches.open(CACHE_NAME).then((cache) => {
                        // Cek skema sebelum menyimpan cache, pastikan itu GET (jangan cache POST)
                        if (event.request.method === 'GET' && networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                    });
                    return networkResponse;
                });
                return cachedResponse || fetchPromise;
            })
        );
    }
});
