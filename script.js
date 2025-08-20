let peer = null;
let connection = null;
let localStream = null;
let isTransmitting = false;
let audioContext = null;
let analyser = null;
let microphone = null;
let myPhoneNumber = null;
let friends = [];
let activeCall = null;
let map = null;
let myMarker = null;
let friendMarker = null;
let myLocation = null;
let friendLocation = null;

const statusDiv = document.getElementById('status');
const myPhoneInput = document.getElementById('my-phone');
const myNumberDisplay = document.getElementById('my-number-display');
const friendPhoneInput = document.getElementById('friend-phone');
const friendNameInput = document.getElementById('friend-name');
const friendsList = document.getElementById('friends-list');
const pttButton = document.getElementById('ptt-button');
const audioStatus = document.getElementById('audio-status');
const mapSection = document.getElementById('map-section');
const controlsSection = document.getElementById('controls-section');

// Phone number utilities
function formatPhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return `+1 (${cleaned.slice(1,4)}) ${cleaned.slice(4,7)}-${cleaned.slice(7)}`;
    } else if (cleaned.length === 10) {
        return `+1 (${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
    }
    return phone;
}

function phoneToId(phone) {
    return phone.replace(/\D/g, '');
}

// Local storage functions
function saveToStorage() {
    localStorage.setItem('wheru-phone', myPhoneNumber || '');
    localStorage.setItem('wheru-friends', JSON.stringify(friends));
}

function loadFromStorage() {
    const savedPhone = localStorage.getItem('wheru-phone');
    const savedFriends = localStorage.getItem('wheru-friends');
    
    console.log('Loading from storage:', { savedPhone, savedFriends });
    
    if (savedPhone && savedPhone !== '') {
        myPhoneNumber = savedPhone;
        myPhoneInput.value = savedPhone;
        myNumberDisplay.textContent = savedPhone;
        myNumberDisplay.style.display = 'block';
        myPhoneInput.style.display = 'none';
        
        const peerId = phoneToId(savedPhone);
        initializePeerWithId(peerId);
    }
    
    if (savedFriends && savedFriends !== '[]') {
        try {
            friends = JSON.parse(savedFriends);
            console.log('Loaded friends:', friends);
        } catch (error) {
            console.error('Error parsing friends from storage:', error);
            friends = [];
        }
    }
}

function setMyNumber() {
    const phone = myPhoneInput.value.trim();
    if (!phone) {
        alert('Please enter a phone number');
        return;
    }
    
    myPhoneNumber = formatPhoneNumber(phone);
    myNumberDisplay.textContent = myPhoneNumber;
    myNumberDisplay.style.display = 'block';
    myPhoneInput.style.display = 'none';
    
    const peerId = phoneToId(myPhoneNumber);
    initializePeerWithId(peerId);
    
    saveToStorage();
}

function addFriend() {
    const phone = friendPhoneInput.value.trim();
    const name = friendNameInput.value.trim();
    
    if (!phone || !name) {
        alert('Please enter both phone number and name');
        return;
    }
    
    const formattedPhone = formatPhoneNumber(phone);
    const friendId = phoneToId(formattedPhone);
    
    if (friends.find(f => f.id === friendId)) {
        alert('This contact is already added');
        return;
    }
    
    friends.push({
        id: friendId,
        name: name,
        phone: formattedPhone
    });
    
    friendPhoneInput.value = '';
    friendNameInput.value = '';
    
    renderFriendsList();
    saveToStorage();
}

function renderFriendsList() {
    if (friends.length === 0) {
        friendsList.innerHTML = '<div class="empty-friends">No contacts added yet</div>';
        return;
    }
    
    friendsList.innerHTML = friends.map(friend => `
        <div class="friend-item">
            <div class="friend-info">
                <div class="friend-name">${friend.name}</div>
                <div class="friend-phone">${friend.phone}</div>
            </div>
            <div class="friend-actions">
                <button class="connect-btn" onclick="connectToFriend('${friend.id}', '${friend.name}')">Connect</button>
                <button class="delete-btn" onclick="deleteFriend('${friend.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

function deleteFriend(friendId) {
    if (confirm('Remove this contact?')) {
        friends = friends.filter(f => f.id !== friendId);
        renderFriendsList();
        saveToStorage();
    }
}

function updateStatus(message, className) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${className}`;
    console.log(`Status: ${message}`);
}

function initializePeerWithId(peerId) {
    if (peer) {
        peer.destroy();
    }
    
    peer = new Peer(peerId, {
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        }
    });
    
    peer.on('open', (id) => {
        updateStatus(`Ready! Your number: ${myPhoneNumber}`, 'waiting');
        console.log(`Peer initialized with ID: ${id}`);
    });
    
    peer.on('connection', (conn) => {
        console.log(`Incoming connection from: ${conn.peer}`);
        const friend = friends.find(f => f.id === conn.peer);
        if (friend) {
            handleConnection(conn, friend.name);
        } else {
            const unknownPhone = conn.peer.replace(/(\d{3})(\d{3})(\d{4})/, '+1 ($1) $2-$3');
            if (confirm(`Incoming call from ${unknownPhone}. Accept?`)) {
                handleConnection(conn, unknownPhone);
            } else {
                conn.close();
            }
        }
    });
    
    peer.on('call', (call) => {
        console.log(`Incoming call from: ${call.peer}`);
        setupMicrophone().then(() => {
            call.answer(localStream);
            setupCallHandlers(call);
        }).catch(err => {
            console.error('Failed to answer call:', err);
        });
    });
    
    peer.on('error', (error) => {
        console.error('Peer error:', error);
        if (error.type === 'unavailable-id') {
            updateStatus('Phone number already in use!', 'disconnected');
        } else {
            updateStatus(`Error: ${error.message}`, 'disconnected');
        }
    });
}

function handleConnection(conn, friendName) {
    connection = conn;
    
    conn.on('open', () => {
        updateStatus(`Connected to ${friendName}`, 'connected');
        pttButton.disabled = false;
        audioStatus.textContent = 'PTT ready - hold button to talk';
        
        showMap(friendName);
        
        if (myLocation) {
            conn.send({ 
                type: 'location', 
                location: myLocation 
            });
        }
    });
    
    conn.on('data', (data) => {
        if (data.type === 'ptt-start') {
            audioStatus.textContent = `${friendName} is transmitting...`;
        } else if (data.type === 'ptt-stop') {
            audioStatus.textContent = 'PTT ready - hold button to talk';
        } else if (data.type === 'location') {
            friendLocation = data.location;
            console.log('Received friend location:', friendLocation);
            if (map) {
                updateMapMarkers();
            }
        }
    });
    
    conn.on('close', () => {
        updateStatus(`Ready! Your number: ${myPhoneNumber}`, 'waiting');
        pttButton.disabled = true;
        audioStatus.textContent = 'Connect to a friend to enable PTT';
        closeMap();
        connection = null;
        friendLocation = null;
    });
}

function connectToFriend(friendId, friendName) {
    if (!peer) {
        alert('Please set your phone number first');
        return;
    }
    
    console.log(`Connecting to: ${friendName} (${friendId})`);
    updateStatus(`Calling ${friendName}...`, 'waiting');
    
    const conn = peer.connect(friendId);
    handleConnection(conn, friendName);
}

function requestLocationPermission() {
    console.log('Requesting location permission...');
    getCurrentLocation().then(location => {
        myLocation = location;
        alert('Location access enabled! You can now share your location when connected.');
        console.log('Location permission granted:', location);
    }).catch(error => {
        console.error('Location permission denied:', error);
        alert('Location access required for location sharing features.');
    });
}

function initializeMap() {
    // Wait for DOM elements to be ready
    setTimeout(() => {
        if (map) {
            map.remove();
            map = null;
        }
        
        const mapContainer = document.getElementById('map');
        if (!mapContainer) {
            console.error('Map container not found');
            return;
        }
        
        console.log('Initializing map...');
        console.log('Map container dimensions:', mapContainer.offsetWidth, mapContainer.offsetHeight);
        
        try {
            map = L.map('map', {
                center: [37.7749, -122.4194],
                zoom: 13,
                zoomControl: true
            });
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);
            
            console.log('Map tiles loaded');
            
            // Force map to resize after a short delay
            setTimeout(() => {
                if (map) {
                    map.invalidateSize();
                    console.log('Map resized and markers will be added');
                    updateMapMarkers();
                }
            }, 500);
            
        } catch (error) {
            console.error('Error initializing map:', error);
        }
    }, 100);
}

function getCurrentLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }
        
        console.log('Requesting location permission...');
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const location = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                console.log('Location obtained:', location);
                resolve(location);
            },
            (error) => {
                console.error('Location error:', error);
                alert('Location access denied. Using default location for demo.');
                resolve({ lat: 37.7749, lng: -122.4194 });
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    });
}

function updateMapMarkers() {
    if (!map) {
        console.log('Map not ready for markers');
        return;
    }
    
    console.log('Updating map markers...');
    
    if (myMarker) {
        map.removeLayer(myMarker);
    }
    if (friendMarker) {
        map.removeLayer(friendMarker);
    }
    
    if (myLocation) {
        myMarker = L.marker([myLocation.lat, myLocation.lng])
            .addTo(map)
            .bindPopup('You are here')
            .setIcon(L.divIcon({
                className: 'custom-marker',
                html: '<div style="width: 30px; height: 30px; background: #10b981; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">ME</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }));
        console.log('Added my location marker');
    }
    
    if (friendLocation) {
        friendMarker = L.marker([friendLocation.lat, friendLocation.lng])
            .addTo(map)
            .bindPopup('Friend location')
            .setIcon(L.divIcon({
                className: 'custom-marker',
                html: '<div style="width: 30px; height: 30px; background: #4facfe; border: 2px solid white; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">👤</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15]
            }));
        console.log('Added friend location marker');
    }
    
    if (myLocation && friendLocation) {
        const group = L.featureGroup([myMarker, friendMarker]);
        map.fitBounds(group.getBounds().pad(0.1));
    } else if (myLocation) {
        map.setView([myLocation.lat, myLocation.lng], 15);
    }
}

async function showMap(friendName) {
    console.log('showMap called for:', friendName);
    
    if (!myLocation) {
        try {
            myLocation = await getCurrentLocation();
            console.log('My location obtained:', myLocation);
        } catch (error) {
            console.error('Failed to get location:', error);
        }
    }
    
    mapSection.style.display = 'block';
    controlsSection.style.display = 'block';
    
    console.log('Map section is now visible');
    initializeMap();
}

function closeMap() {
    mapSection.style.display = 'none';
    controlsSection.style.display = 'none';
    
    if (map) {
        map.remove();
        map = null;
    }
}

async function setupMicrophone() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 44100
            }
        });
        
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        microphone = audioContext.createMediaStreamSource(localStream);
        microphone.connect(analyser);
        
        analyser.fftSize = 256;
        
        console.log('Microphone setup successful');
        return localStream;
    } catch (error) {
        console.error('Microphone error:', error);
        alert('Microphone access required for PTT functionality');
        throw error;
    }
}

function setupCallHandlers(call) {
    activeCall = call;
    
    call.on('stream', (remoteStream) => {
        console.log('Received remote audio stream');
        const audio = new Audio();
        audio.srcObject = remoteStream;
        audio.play().catch(e => console.error('Audio play error:', e));
    });
    
    call.on('close', () => {
        console.log('Call ended');
        activeCall = null;
    });
    
    call.on('error', (error) => {
        console.error('Call error:', error);
        activeCall = null;
    });
}

async function startTransmission() {
    if (isTransmitting || !connection) return;
    
    try {
        if (!localStream) {
            await setupMicrophone();
        }
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        isTransmitting = true;
        pttButton.classList.add('transmitting');
        pttButton.textContent = 'TRANSMITTING...';
        audioStatus.textContent = 'You are transmitting';
        
        connection.send({ type: 'ptt-start' });
        
        const call = peer.call(connection.peer, localStream);
        setupCallHandlers(call);
        
        setTimeout(() => {
            if (isTransmitting) {
                console.log('Auto-stopping transmission after 30 seconds');
                stopTransmission();
            }
        }, 30000);
        
        console.log('Started transmission');
        
    } catch (error) {
        console.error('Transmission error:', error);
        stopTransmission();
    }
}

function stopTransmission() {
    if (!isTransmitting) return;
    
    isTransmitting = false;
    pttButton.classList.remove('transmitting');
    pttButton.textContent = 'Hold to Talk';
    audioStatus.textContent = 'PTT ready - hold button to talk';
    
    if (connection) {
        connection.send({ type: 'ptt-stop' });
    }
    
    console.log('Stopped transmission');
}

function disconnect() {
    console.log('Initiating disconnect...');
    
    if (isTransmitting) {
        stopTransmission();
    }
    
    if (activeCall) {
        try {
            activeCall.close();
            console.log('Active call closed');
        } catch (error) {
            console.error('Error closing call:', error);
        }
        activeCall = null;
    }
    
    if (connection) {
        try {
            connection.send({ type: 'disconnect' });
            connection.close();
            console.log('Data connection closed');
        } catch (error) {
            console.error('Error closing connection:', error);
        }
        connection = null;
    }
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
            console.log('Stopped audio track');
        });
        localStream = null;
    }
    
    if (microphone) {
        try {
            microphone.disconnect();
        } catch (error) {
            console.error('Error disconnecting microphone:', error);
        }
        microphone = null;
    }
    
    if (audioContext && audioContext.state !== 'closed') {
        try {
            audioContext.suspend();
        } catch (error) {
            console.error('Error suspending audio context:', error);
        }
    }
    
    closeMap();
    
    pttButton.disabled = true;
    audioStatus.textContent = 'Connect to a friend to enable PTT';
    updateStatus(`Ready! Your number: ${myPhoneNumber}`, 'waiting');
    
    friendLocation = null;
    
    console.log('Disconnect complete');
}

// PTT Button Events
document.addEventListener('DOMContentLoaded', function() {
    if (pttButton) {
        pttButton.addEventListener('mousedown', startTransmission);
        pttButton.addEventListener('mouseup', stopTransmission);
        pttButton.addEventListener('mouseleave', stopTransmission);
        
        pttButton.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startTransmission();
        });
        pttButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            stopTransmission();
        });
        pttButton.addEventListener('touchcancel', stopTransmission);
        pttButton.addEventListener('contextmenu', (e) => e.preventDefault());
    }
});

function lockOrientation() {
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
    }
}

window.addEventListener('orientationchange', () => {
    setTimeout(lockOrientation, 100);
});

window.addEventListener('load', () => {
    loadFromStorage();
    lockOrientation();
    renderFriendsList();
    
    if (myPhoneNumber) {
        updateStatus(`Ready! Your number: ${myPhoneNumber}`, 'waiting');
    } else {
        updateStatus('Enter your phone number to get started', 'waiting');
    }
});

window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (peer) {
        peer.destroy();
    }
});