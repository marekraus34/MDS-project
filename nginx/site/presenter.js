// presenter.js
// ============
// Presenter s podporou kamery/mikrofonu + WebRTC streaming

// === Globální proměnné ===
let localStream = null;
let pc = null;
let ws = null;
let isStreaming = false;
let presenterName = '';

const SIGNALING_URL = 'ws://localhost:3000';

// DOM elementy
const loginContainer = document.getElementById('loginContainer');
const presenterContainer = document.getElementById('presenterContainer');
const nameInput = document.getElementById('presenterName');
const codeInput = document.getElementById('presenterCode');
const joinBtn = document.getElementById('joinPresenterBtn');
const loginError = document.getElementById('presenterLoginError');
const localVideo = document.getElementById('localVideo');
const startStreamBtn = document.getElementById('startStreamBtn');
const stopStreamBtn = document.getElementById('stopStreamBtn');
const streamStatus = document.getElementById('streamStatus');
const mediaStatus = document.getElementById('mediaStatus');
const viewerCount = document.getElementById('viewerCount');
const cameraSelect = document.getElementById('cameraSelect');
const microphoneSelect = document.getElementById('microphoneSelect');

// === Načtení dostupných zařízení ===
async function loadMediaDevices() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        // Kamery
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        cameraSelect.innerHTML = '';
        videoDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Kamera ${index + 1}`;
            cameraSelect.appendChild(option);
        });

        // Mikrofony
        const audioDevices = devices.filter(device => device.kind === 'audioinput');
        microphoneSelect.innerHTML = '';
        audioDevices.forEach((device, index) => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.textContent = device.label || `Mikrofon ${index + 1}`;
            microphoneSelect.appendChild(option);
        });

        console.log('Nalezeno:', videoDevices.length, 'kamer a', audioDevices.length, 'mikrofonů');

    } catch (error) {
        console.error('Chyba při načítání zařízení:', error);
    }
}

// === Vyžádání oprávnění ke kameře a mikrofonu ===
async function requestMediaPermissions() {
    try {
        console.log('Vyžadování oprávnění ke kameře a mikrofonu...');
        
        const videoDeviceId = cameraSelect.value;
        const audioDeviceId = microphoneSelect.value;

        const constraints = {
            video: {
                deviceId: videoDeviceId ? { exact: videoDeviceId } : undefined,
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30 }
            },
            audio: {
                deviceId: audioDeviceId ? { exact: audioDeviceId } : undefined,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        // Zastavit předchozí stream pokud existuje
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        console.log('✅ Oprávnění uděleno!');
        
        // Zobrazit lokální video
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true; // Vždy ztlumit vlastní video
        }

        // Aktualizovat status
        if (mediaStatus) {
            const videoTrack = localStream.getVideoTracks()[0];
            const audioTrack = localStream.getAudioTracks()[0];
            mediaStatus.innerHTML = `
                ✅ Kamera: ${videoTrack.label}<br>
                ✅ Mikrofon: ${audioTrack.label}
            `;
            mediaStatus.style.color = '#28a745';
        }

        // Znovu načíst zařízení (nyní budou mít popisky)
        await loadMediaDevices();

        return true;

    } catch (error) {
        console.error('❌ Chyba při získávání média:', error);
        
        let errorMessage = 'Chyba: ';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += 'Přístup zamítnut. Povolte kameru a mikrofon v nastavení prohlížeče.';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage += 'Kamera nebo mikrofon nebyl nalezen.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage += 'Kamera/mikrofon je používán jinou aplikací.';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage += 'Vybrané zařízení nepodporuje požadované nastavení.';
        } else {
            errorMessage += error.message;
        }

        if (mediaStatus) {
            mediaStatus.innerHTML = '❌ ' + errorMessage;
            mediaStatus.style.color = '#dc3545';
        }
        
        alert(errorMessage);
        return false;
    }
}

// === LOGIN LOGIKA ===
joinBtn?.addEventListener('click', async function() {
    const name = nameInput.value.trim();
    const code = codeInput.value.trim();

    if (!name) {
        loginError.textContent = 'Zadej prosím jméno';
        return;
    }

    if (!code) {
        loginError.textContent = 'Zadej prosím kód místnosti';
        return;
    }

    // Demo kód check
    if (code !== 'mds2025') {
        loginError.textContent = 'Nesprávný kód místnosti';
        return;
    }

    presenterName = name;

    // Vyžádat oprávnění ke kameře a mikrofonu
    const permissionsGranted = await requestMediaPermissions();
    if (!permissionsGranted) {
        loginError.textContent = 'Bez oprávnění ke kameře/mikrofonu nelze pokračovat';
        return;
    }

    // Skrýt login, zobrazit presenter UI
    loginContainer.style.display = 'none';
    presenterContainer.style.display = 'block';

    console.log('Presenter přihlášen:', name);

    // Připojit k signaling serveru
    connectSignaling();
});

// === Změna kamery/mikrofonu ===
cameraSelect?.addEventListener('change', async function() {
    if (localStream) {
        await requestMediaPermissions();
    }
});

microphoneSelect?.addEventListener('change', async function() {
    if (localStream) {
        await requestMediaPermissions();
    }
});

// === STREAM OVLÁDÁNÍ ===
startStreamBtn?.addEventListener('click', async function() {
    if (!localStream) {
        alert('Nejprve musíte povolit kameru a mikrofon!');
        return;
    }

    if (isStreaming) {
        alert('Stream již běží!');
        return;
    }

    // Začít streamovat
    isStreaming = true;
    startStreamBtn.disabled = true;
    stopStreamBtn.disabled = false;
    streamStatus.textContent = '🔴 LIVE';
    streamStatus.style.color = '#dc3545';

    console.log('Stream zahájen');

    // Poslat offer všem viewerům přes signaling server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'start-stream',
            presenterName: presenterName
        }));
    }
});

stopStreamBtn?.addEventListener('click', function() {
    if (!isStreaming) {
        return;
    }

    // Zastavit stream
    isStreaming = false;
    startStreamBtn.disabled = false;
    stopStreamBtn.disabled = true;
    streamStatus.textContent = '⚪ Offline';
    streamStatus.style.color = '#6c757d';

    // Zavřít peer connection
    if (pc) {
        pc.close();
        pc = null;
    }

    console.log('Stream zastaven');

    // Notifikovat signaling server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'stop-stream'
        }));
    }
});

// === WEBRTC SIGNALING ===
function connectSignaling() {
    ws = new WebSocket(SIGNALING_URL);

    ws.onopen = () => {
        console.log('WS: připojeno k signaling serveru');
        ws.send(JSON.stringify({
            type: 'join',
            role: 'presenter',
            name: presenterName
        }));
    };

    ws.onmessage = async (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error('Nevalidní WS zpráva:', event.data);
            return;
        }

        console.log('WS zpráva:', msg.type);

        switch (msg.type) {
            case 'joined':
                console.log(`WS: joined as ${msg.role}`);
                break;

            case 'viewer-joined':
                console.log('Viewer se připojil, posílám offer...');
                await createAndSendOffer();
                break;

            case 'answer':
                if (msg.sdp && pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                    console.log('WebRTC: answer přijat od viewera');
                }
                break;

            case 'ice':
                if (msg.candidate && pc) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    } catch (e) {
                        console.error('Chyba při addIceCandidate:', e);
                    }
                }
                break;

            case 'viewer-count':
                if (viewerCount) {
                    viewerCount.textContent = msg.count;
                }
                break;

            default:
                console.log('WS: neznámý typ', msg);
        }
    };

    ws.onclose = () => {
        console.log('WS: odpojeno od signaling serveru');
    };

    ws.onerror = (err) => {
        console.error('WS chyba:', err);
    };
}

// === VYTVOŘENÍ WEBRTC OFFER ===
async function createAndSendOffer() {
    if (!localStream) {
        console.error('Nelze vytvořit offer - chybí local stream');
        return;
    }

    // Zavřít staré PC pokud existuje
    if (pc) {
        pc.close();
    }

    // Vytvořit nové peer connection
    pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    // Přidat local stream do peer connection
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
        console.log('Přidán track:', track.kind, track.label);
    });

    // ICE candidate handler
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice',
                role: 'presenter',
                candidate: event.candidate
            }));
        }
    };

    // Connection state handler
    pc.onconnectionstatechange = () => {
        console.log('WebRTC state:', pc.connectionState);
        
        if (pc.connectionState === 'connected') {
            streamStatus.textContent = '🔴 LIVE (připojeno)';
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            streamStatus.textContent = '🔴 LIVE (odpojeno)';
        }
    };

    try {
        // Vytvořit offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Poslat offer přes WebSocket
        ws.send(JSON.stringify({
            type: 'offer',
            sdp: pc.localDescription
        }));

        console.log('WebRTC: offer odeslán');

    } catch (error) {
        console.error('Chyba při vytváření offer:', error);
    }
}

// === INICIALIZACE ===
window.addEventListener('load', async () => {
    console.log('Presenter inicializován');
    
    // Načíst dostupná média zařízení (bez popisků před oprávněním)
    await loadMediaDevices();
});

// === CLEANUP ===
window.addEventListener('beforeunload', () => {
    // Zastavit stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Zavřít peer connection
    if (pc) {
        pc.close();
    }
    
    // Zavřít WebSocket
    if (ws) {
        ws.close();
    }
});
