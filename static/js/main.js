// Simple Meet: Real-time location sharing application - Frontend Logic
// Copyright (C) 2025  SimpleMeet
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

// Frontend logic
console.log("Initializing main.js");

// --- Configuration ---
const SERVER_URL = window.location.origin; // Assumes backend is served from the same origin
const UPDATE_INTERVAL_MS = 5000; // Increased from 3000ms for better battery life
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

// --- State ---
let socket = null;
let map = null;
let userMarker = null;
let otherUserMarkers = {}; // { sid: marker }
let shareCode = null;
let userColor = '#808080'; // Default color
let username = null; // Store own username
let locationWatchId = null;
let lastPosition = null;
let isIntentionalDisconnect = false; // Flag for intentional disconnect
let reconnectAttempts = 0;
let lastLocationUpdate = 0; // Timestamp of last location update
let rateLimitDelay = 0; // Rate limiting for location updates

// --- UI Elements ---
const initialOptionsDiv = document.getElementById('initial-options');
const sharingInfoDiv = document.getElementById('sharing-info');
const createShareBtn = document.getElementById('create-share-btn');
const joinShareBtn = document.getElementById('join-share-btn');
const shareCodeInput = document.getElementById('share-code-input');
const shareCodeDisplay = document.getElementById('share-code-display');
const mapDiv = document.getElementById('map');
const controlsDiv = document.getElementById('controls');
const statusElement = document.getElementById('status'); 
const shareInfoDiv = document.getElementById('share-info');
const leaveShareBtn = document.getElementById('leave-share-btn');
const userListContainer = document.getElementById('user-list-container');
const userListElement = document.getElementById('user-list');
const copyShareBtn = document.getElementById('copy-share-btn'); // Get copy button

// --- Initialization ---
function initializeMap() {
    console.log("Initializing Leaflet map.");
    // Set default view with max zoom (19)
    map = L.map('map').setView([51.505, -0.09], 19);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    // Attempt to get initial location to center the map
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const { latitude, longitude } = position.coords;
            console.log(`Got initial position: ${latitude}, ${longitude}`);
            // Center map on initial position with max zoom
            map.setView([latitude, longitude], 19);
        },
        (error) => {
            console.warn(`Error getting initial location: ${error.message}`);
            // Keep default view if location fails
        },
        { enableHighAccuracy: true }
    );
}

function connectWebSocket() {
    console.log(`Connecting WebSocket to ${SERVER_URL}`);
    socket = io.connect(SERVER_URL);

    // --- Socket Event Handlers ---
    socket.on('connect', () => {
        console.log('Connected to server with SID:', socket.id);
        // Update status ONLY if not already in a share (e.g., on initial load/reconnect)
        if (!shareCode) {
            statusElement.textContent = 'Connected. Create or join a share.';
        }
    });

    socket.on('disconnect', (reason) => {
        console.warn('Disconnected from server.');
        if (!isIntentionalDisconnect) { // If disconnect was unexpected
            alert('Lost connection to the server.');
            resetUIOnDisconnect(); // Reset UI to initial state
        }
        // Always reset the flag after handling disconnect
        isIntentionalDisconnect = false;
    });

    socket.on('connect_error', (error) => {
        console.error('Connection Error:', error);
        alert('Failed to connect to the server. Please try refreshing the page.');
    });

    socket.on('share_created', (data) => {
        shareCode = data.share_code;
        userColor = data.color; // Store assigned color
        username = data.username; // Store assigned username
        console.log(`Share created successfully! Code: ${shareCode}`);
        shareCodeDisplay.textContent = `Share Code: ${shareCode}`;
        initialOptionsDiv.style.display = 'none';
        sharingInfoDiv.style.display = 'flex';
        mapDiv.style.display = 'block'; // Ensure map is visible
        userListContainer.style.display = 'block'; // Show user list
        statusElement.textContent = `Created share ${shareCode} as ${username}. Your color: ${userColor}`; // Show username & color
        // Backend automatically joins us, start sending location
        startLocationUpdates();
    });

    socket.on('joined_share', (data) => {
        shareCode = data.share_code;
        userColor = data.color; // Store assigned color
        username = data.username; // Store assigned username
        console.log(`Joined share ${shareCode} successfully! Your color: ${userColor}`);
        shareCodeDisplay.textContent = `Share Code: ${shareCode}`;
        initialOptionsDiv.style.display = 'none';
        sharingInfoDiv.style.display = 'flex';
        mapDiv.style.display = 'block'; // Ensure map is visible
        userListContainer.style.display = 'block'; // Show user list
        statusElement.textContent = `Joined share ${shareCode} as ${username}. Your color: ${userColor}`; // Show username & color
        startLocationUpdates();
        // Existing users will be sent via 'existing_users' event
    });

    socket.on('join_error', (data) => {
        console.error(`Error joining share: ${data.message}`);
        alert(`Error joining share: ${data.message}`);
        // Re-enable join button?
        joinShareBtn.disabled = false;
    });

    socket.on('user_list_update', (data) => {
        console.log('Received user list update:', data.users);
        const users = data.users; // Access the users array from the data object
        // Clear existing markers except potentially our own if updates started quickly
        Object.keys(otherUserMarkers).forEach(sid => removeMarker(sid));
        updateUserList(users); // Update the list display

        users.forEach(user => {
            // Don't re-add self if already added by early location update
            if (user.sid !== socket.id) {
                updateMarker(user.sid, {
                    lat: user.lat,
                    lon: user.lon,
                    color: user.color // Ensure color is passed
                    // heading: user.heading
                });
            }
        });
    });

    socket.on('user_joined', (user) => {
        // We now rely on 'user_list_update' for the list itself,
        // but we still need this to add the marker for the new user.
        console.log('User joined (for marker):', user); // Log joined user data
        console.log(`Processing joined user marker: SID=${user.sid}, Color=${user.color}, Lat=${user.lat}, Lon=${user.lon}`); // Log details
        updateMarker(user.sid, {
            lat: user.lat,
            lon: user.lon,
            color: user.color // Ensure color is passed
            // heading: user.heading
        });
    });

    socket.on('user_left', (data) => {
        console.log(`User ${data.sid} left.`);
        removeMarker(data.sid);
    });

    socket.on('location_broadcast', (data) => {
        // console.log('Received location broadcast:', data);
        updateMarker(data.sid, data); // Update marker for other users
    });
}

// --- UI Update Functions ---
function updateStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    } else {
        console.warn("Attempted to update status, but statusElement is null.");
    }
}

// --- Geolocation & Updates ---
function startLocationUpdates() {
    console.log("Attempting to start location updates...");
    if (locationWatchId) {
        console.log("Clearing existing location watch ID:", locationWatchId);
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null; // Ensure it's reset
    }

    if ('geolocation' in navigator && 'watchPosition' in navigator.geolocation) {
        console.log("Geolocation API and watchPosition supported.");
        try {
            console.log("Calling navigator.geolocation.watchPosition...");
            locationWatchId = navigator.geolocation.watchPosition(
                (position) => {
                    console.log("watchPosition SUCCESS callback fired.", position);
                    lastPosition = position; // Store for potential later use
                    const { latitude, longitude, heading, speed } = position.coords;
                    console.log(`Location update: ${latitude}, ${longitude}, Heading: ${heading}`);

                    // Update our own marker immediately
                    if (socket && socket.id) {
                        console.log(`Updating own marker (${socket.id}) with color ${userColor}`);
                        updateMarker(socket.id, { lat: latitude, lon: longitude, heading: heading, color: userColor });
                    } else {
                        console.warn("Cannot update own marker: socket or socket.id is missing.");
                    }

                    // Send update to server
                    if (socket && socket.connected && shareCode) {
                        console.log("Emitting location_update to server.");
                        socket.emit('location_update', {
                            lat: latitude,
                            lon: longitude,
                            heading: heading, // Can be null if device doesn't support/provide it
                            // speed: speed // Could also send speed
                        });
                    } else {
                        console.warn("Cannot emit location_update: socket not connected or shareCode missing.");
                    }
                },
                (error) => {
                    console.error("watchPosition ERROR callback fired.");
                    console.error(`Geolocation Error: ${error.message} (Code: ${error.code})`, error);
                    // Handle errors like PERMISSION_DENIED (1), POSITION_UNAVAILABLE (2), TIMEOUT (3)
                    let alertMsg = `Geolocation error: ${error.message}`;
                    if (error.code === 1) {
                        alertMsg = "Location permission denied. Please enable location access in your browser settings and refresh the page to use this app.";
                        stopLocationUpdates(); // Stop trying if permission denied
                    }
                     else if (error.code === 2) {
                        alertMsg = "Location currently unavailable. Ensure location services are enabled on your device.";
                    }
                    else if (error.code === 3) {
                        alertMsg = "Timeout getting location. Trying again..."; // watchPosition should retry automatically
                    }
                    alert(alertMsg);
                },
                {
                    enableHighAccuracy: true, // Request high accuracy
                    maximumAge: 0, // Don't use cached position
                    timeout: 15000 // Increased timeout to 15 seconds
                }
            );
            console.log("watchPosition called. Watch ID:", locationWatchId);
        } catch (e) {
            console.error("Error calling watchPosition:", e);
            alert("An unexpected error occurred while trying to access your location.");
        }
    } else {
        console.error("Geolocation API or watchPosition not supported by this browser.");
        alert('Geolocation is not supported by your browser or device.');
    }
}

function stopLocationUpdates() {
    console.log("Stopping location updates.");
    if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
    }
}

// --- Map Marker Management ---

// Helper to create a custom colored + potentially rotated icon
function createColoredIcon(color, rotation = 0) {
    console.log(`Creating icon with color: ${color}, rotation: ${rotation}`); // Add log
    // Simple circle marker for now - could use custom SVG later
    const markerHtmlStyles = `
        background-color: ${color};
        width: 1.5rem;
        height: 1.5rem;
        display: block;
        left: -0.75rem;
        top: -0.75rem;
        position: relative;
        border-radius: 50%;
        border: 2px solid white;
        box-shadow: 0 0 5px rgba(0,0,0,0.5);
        transform: rotate(${rotation}deg);
        `; // Removed transition for direct setting

    // Include a simple triangle to show direction more clearly
    const directionPointerStyles = `
        width: 0;
        height: 0;
        border-left: 0.4rem solid transparent;
        border-right: 0.4rem solid transparent;
        border-bottom: 0.7rem solid ${color};
        position: absolute;
        top: -0.5rem; /* Position above the circle */
        left: 50%;
        transform: translateX(-50%);
        `;

    const icon = L.divIcon({
      className: "custom-div-icon", // Add class if needed for CSS targeting
      html: `<span style="${markerHtmlStyles}"><span style="${directionPointerStyles}"></span></span>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    return icon;
}

function updateMarker(sid, data) {
    if (!map) {
        console.warn("updateMarker called but map is not initialized yet.");
        return; // Map not ready
    }
    if (data.lat === null || data.lon === null) {
        console.log(`Skipping marker for ${sid} - no location data provided.`);
        return;
    }

    const latLng = [data.lat, data.lon];
    // Use assigned color or a bright fallback (e.g., blue)
    const color = data.color || '#4363D8';
    const heading = data.heading;
    const isCurrentUser = (socket && sid === socket.id);

    if (isCurrentUser) {
        console.log(`Updating CURRENT USER marker (${sid}) at [${latLng}], heading: ${heading}, color: ${color}`);
    } else {
        // Optional: Reduce logging noise for other users if needed
        // console.log(`Updating OTHER user marker (${sid}) at [${latLng}], heading: ${heading}, color: ${color}`);
    }

    let marker = isCurrentUser ? userMarker : otherUserMarkers[sid];
    let isNewMarker = false;

    if (marker) {
        console.log(`Marker exists for ${sid}. Updating position and icon.`);
        marker.setLatLng(latLng);
        // Update icon/rotation if needed
        const rotation = (heading !== null && heading !== undefined) ? heading : 0;
        marker.setIcon(createColoredIcon(color, rotation));
    } else {
        console.log(`Marker does NOT exist for ${sid}. Creating new marker.`);
        isNewMarker = true;
        const rotation = (heading !== null && heading !== undefined) ? heading : 0;
        marker = L.marker(latLng, {
             icon: createColoredIcon(color, rotation)
        }).addTo(map);

        // Add a popup or tooltip if desired
        marker.bindPopup(`User ${isCurrentUser ? '(You)' : sid.substring(0, 6)}`);

        if (isCurrentUser) {
            userMarker = marker;
            console.log(`Added marker for CURRENT USER (${sid}) at ${latLng}`);
        } else {
            otherUserMarkers[sid] = marker;
            console.log(`Added marker for OTHER user ${sid} at ${latLng}`);
        }
    }

    // Set view (pan + zoom) to current user's location on first update/marker creation
    if (isCurrentUser && isNewMarker) {
       console.log("Setting map view to current user's initial location.");
       // Use setView to center and zoom to max level (19)
       map.setView(latLng, 19);
    }
}

function removeMarker(sid) {
    if (!map) return;

    const marker = otherUserMarkers[sid];
    if (marker) {
        map.removeLayer(marker);
        delete otherUserMarkers[sid];
        console.log(`Removed marker for user ${sid}`);
    }
}

// --- Event Listeners ---
function createShare() {
    console.log('Create Share button clicked.');
    // Ensure connection exists before emitting
    if (!socket || !socket.connected) {
        console.warn('Socket not connected. Attempting to connect before creating share...');
        connectWebSocket(); // Attempt to connect
        // We might need a small delay or check connection status again, but
        // the emit check below should handle the case where connection fails quickly.
        // Alternatively, disable button until 'connect' event.
    }
    
    // Add a small delay to allow connection attempt, or rely on the check
    setTimeout(() => {
        if (socket && socket.connected) {
            console.log("DEBUG: Attempting to emit 'create_share'...");
            socket.emit('create_share');
        } else {
            alert('Not connected to the server. Please wait or refresh.');
        }
    }, 100); // Small delay (100ms) to allow socket connection to potentially establish
}

function joinShare() {
    const code = shareCodeInput.value.trim().toUpperCase();
    if (!code || code.length !== 7 || !code.includes('-')) {
        alert('Please enter a valid share code (e.g., ABC-123).');
        return;
    }
    console.log(`Join Share button clicked. Code: ${code}`);

    // Ensure connection exists before emitting
    if (!socket || !socket.connected) {
        console.warn('Socket not connected. Attempting to connect before joining share...');
        connectWebSocket(); // Attempt to connect
    }

    // Add a small delay or rely on the check
    setTimeout(() => {
        if (socket && socket.connected) {
            console.log("DEBUG: Attempting to emit 'join_share'...");
            socket.emit('join_share', { share_code: code });
        } else {
            alert('Not connected to the server. Please wait or refresh.');
        }
    }, 100); // Small delay
}

// --- Initial Setup ---
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    connectWebSocket();
    mapDiv.style.display = 'none'; // Hide map initially
});

// --- Share Management ---
function leaveShare() { 
    console.log('Leave Share button clicked.');
    if (!socket) {
        resetUIOnDisconnect(); // Reset UI even if socket is null, just in case
        return;
    }
    
    // --- Perform UI and State Reset FIRST ---
    console.log("Resetting UI and state before disconnecting.");
    stopLocationUpdates();
    if (userMarker && map) map.removeLayer(userMarker);
    Object.values(otherUserMarkers).forEach(marker => {
        if (map) map.removeLayer(marker);
    });
    userMarker = null;
    otherUserMarkers = {};
    const previousShareCode = shareCode;
    shareCode = null;
    userColor = '#808080';
    username = null;
    lastPosition = null;
    initialOptionsDiv.style.display = ''; // Remove inline display style
    sharingInfoDiv.style.display = 'none';
    mapDiv.style.display = 'none'; // Ensure map is hidden
    userListContainer.style.display = 'none';
    updateUserList([]);
    shareCodeInput.value = '';
    if (previousShareCode) {
        updateStatus(`Left share ${previousShareCode}. Create or join another.`);
     } else {
        updateStatus('Reset state. Create or join a share.');
    }
    // ----------------------------------------
    
    console.log(`Leaving share: ${previousShareCode}. Disconnecting socket.`);
    isIntentionalDisconnect = true; // Set flag BEFORE disconnect
    socket.disconnect();
    
    // DO NOT automatically reconnect here anymore
}

// Helper to reset UI specifically on unexpected disconnect (called from disconnect handler)
function resetUIOnDisconnect() {
    console.log("Resetting UI due to unexpected disconnect.");
    // Stop location updates
    stopLocationUpdates();

    // Clear map markers
    if (userMarker && map) map.removeLayer(userMarker);
    Object.values(otherUserMarkers).forEach(marker => {
        if (map) map.removeLayer(marker);
    });
    userMarker = null;
    otherUserMarkers = {};

    // Reset state variables
    shareCode = null;
    userColor = '#808080'; // Reset to default
    username = null;
    lastPosition = null;

    // Reset UI elements
    initialOptionsDiv.style.display = 'block';
    sharingInfoDiv.style.display = 'none';
    mapDiv.style.display = 'none';
    userListContainer.style.display = 'none';
    updateUserList([]); // Clear the user list UI
    shareCodeInput.value = ''; // Clear input field

    // Update status
    updateStatus('Disconnected. Please refresh or try again.');
}

// --- User List Management ---
function updateUserList(users) {
    if (!userListElement) return;
    console.log("Updating user list display with:", users);

    userListElement.innerHTML = ''; // Clear current list

    if (!users || users.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No other users in share.';
        li.style.fontStyle = 'italic';
        userListElement.appendChild(li);
        return;
    }

    users.sort((a, b) => (a.username || '').localeCompare(b.username || '')); // Sort alphabetically

    users.forEach(user => {
        const li = document.createElement('li');
        li.dataset.sid = user.sid; // Store sid for potential future use

        const iconSpan = document.createElement('span');
        iconSpan.className = 'user-color-icon';
        iconSpan.style.backgroundColor = user.color || '#808080'; // Use user's color

        const nameSpan = document.createElement('span');
        nameSpan.className = 'username';
        let displayName = user.username || `User ${user.sid.substring(0,4)}`;
        if (socket && user.sid === socket.id) {
            displayName += ' (You)';
            li.style.fontWeight = 'bold'; // Highlight self
        }
        nameSpan.textContent = displayName;
        nameSpan.title = displayName; // Show full name on hover if truncated

        li.appendChild(iconSpan);
        li.appendChild(nameSpan);
        userListElement.appendChild(li);
    });
}

// --- Event Listeners ---
createShareBtn.addEventListener('click', createShare);
joinShareBtn.addEventListener('click', joinShare);
leaveShareBtn.addEventListener('click', leaveShare);

// Add listener for the copy button
copyShareBtn.addEventListener('click', () => {
    if (shareCode && navigator.clipboard) {
        navigator.clipboard.writeText(shareCode).then(() => {
            // Provide user feedback
            const originalText = copyShareBtn.textContent;
            copyShareBtn.textContent = 'Copied!';
            copyShareBtn.disabled = true;
            setTimeout(() => {
                copyShareBtn.textContent = originalText;
                copyShareBtn.disabled = false;
            }, 1500); // Reset after 1.5 seconds
            console.log('Share code copied to clipboard:', shareCode);
        }).catch(err => {
            console.error('Failed to copy share code: ', err);
            alert('Failed to copy code. Please copy it manually.');
        });
    } else {
        console.error('Cannot copy: Share code is missing or clipboard API unavailable.');
    }
});
