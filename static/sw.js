// SimpleMeet Service Worker - v1.0.0
const CACHE_NAME = 'simplemeet-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Assets to cache immediately (static assets)
const STATIC_CACHE_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/main.js',
    '/static/manifest.json',
    '/offline.html',
    // External CDN resources (cached for offline use)
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdn.socket.io/4.7.5/socket.io.min.js',
    // Icons
    '/static/icons/icon-192x192.png',
    '/static/icons/icon-512x512.png'
];

// Runtime cache strategies
const RUNTIME_CACHE_ROUTES = [
    {
        urlPattern: /^https:\/\/.*\.tile\.openstreetmap\.org\/.*/,
        handler: 'CacheFirst',
        options: {
            cacheName: 'osm-tiles',
            expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            },
        },
    },
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            console.log('Caching static assets...');
            
            // Cache static assets with error handling
            const cachePromises = STATIC_CACHE_ASSETS.map(async (url) => {
                try {
                    await cache.add(url);
                    console.log(`Cached: ${url}`);
                } catch (error) {
                    console.warn(`Failed to cache ${url}:`, error);
                }
            });
            
            await Promise.allSettled(cachePromises);
            
            // Skip waiting to activate immediately
            self.skipWaiting();
        })()
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    
    event.waitUntil(
        (async () => {
            // Clean up old caches
            const cacheNames = await caches.keys();
            const oldCaches = cacheNames.filter(name => 
                name.startsWith('simplemeet-') && name !== CACHE_NAME
            );
            
            await Promise.all(
                oldCaches.map(cacheName => {
                    console.log(`Deleting old cache: ${cacheName}`);
                    return caches.delete(cacheName);
                })
            );
            
            // Take control of all clients immediately
            self.clients.claim();
        })()
    );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip chrome extension requests
    if (url.protocol === 'chrome-extension:') {
        return;
    }
    
    // Handle navigation requests (HTML pages)
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigationRequest(request));
        return;
    }
    
    // Handle API requests (Socket.IO, etc.)
    if (url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/api/')) {
        event.respondWith(handleAPIRequest(request));
        return;
    }
    
    // Handle OpenStreetMap tiles
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(handleTileRequest(request));
        return;
    }
    
    // Handle static assets
    event.respondWith(handleStaticRequest(request));
});

// Navigation request handler (HTML pages)
async function handleNavigationRequest(request) {
    try {
        // Try network first for fresh content
        const networkResponse = await fetch(request);
        
        // Cache successful responses
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Network failed for navigation, trying cache...');
        
        // Try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Fallback to offline page
        return caches.match(OFFLINE_URL);
    }
}

// API request handler
async function handleAPIRequest(request) {
    try {
        // Always try network first for API requests
        return await fetch(request);
    } catch (error) {
        console.log('API request failed:', error);
        
        // Return a generic offline response for API requests
        return new Response(
            JSON.stringify({
                error: 'offline',
                message: 'You are currently offline. Please check your connection.'
            }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        );
    }
}

// Map tile request handler (cache first strategy)
async function handleTileRequest(request) {
    const cache = await caches.open('osm-tiles');
    
    try {
        // Try cache first
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            // Optionally update cache in background
            fetch(request).then(response => {
                if (response.ok) {
                    cache.put(request, response.clone());
                }
            }).catch(() => {
                // Ignore background update failures
            });
            
            return cachedResponse;
        }
        
        // Try network
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            // Cache the tile
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Tile request failed:', error);
        
        // Return a placeholder tile or cached version
        const cachedResponse = await cache.match(request);
        return cachedResponse || new Response('', { status: 404 });
    }
}

// Static asset request handler
async function handleStaticRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    
    try {
        // Try cache first for static assets
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Try network
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            // Cache static assets
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
    } catch (error) {
        console.log('Static request failed:', error);
        
        // Try cache again
        return cache.match(request) || new Response('', { status: 404 });
    }
}

// Background sync for location updates (if supported)
self.addEventListener('sync', (event) => {
    if (event.tag === 'location-sync') {
        console.log('Background sync: location-sync');
        event.waitUntil(
            // Handle background location sync if needed
            Promise.resolve()
        );
    }
});

// Push notification handling (for future features)
self.addEventListener('push', (event) => {
    console.log('Push message received:', event);
    
    const options = {
        body: 'New location update in your share!',
        icon: '/static/icons/icon-192x192.png',
        badge: '/static/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        tag: 'location-update',
        actions: [
            {
                action: 'view',
                title: 'View Location',
                icon: '/static/icons/icon-72x72.png'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification('SimpleMeet', options)
    );
});

// Notification click handling
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', event);
    
    event.notification.close();
    
    if (event.action === 'view') {
        // Open the app
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Message handling from main thread
self.addEventListener('message', (event) => {
    console.log('SW received message:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    // Send response back
    event.ports[0]?.postMessage({
        type: 'SW_RESPONSE',
        success: true
    });
});

// Handle unhandled promise rejections
self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection in SW:', event.reason);
    event.preventDefault();
});

console.log('SimpleMeet Service Worker loaded successfully!'); 