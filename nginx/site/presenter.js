// presenter.js
// ===========
// MediaStream API – kamera + mikrofon + náhled + mute
// + WebRTC odesílání streamu viewerovi přes signaling server

let localStream = null;
let currentAudioTrack = null;
let isMuted = false;

// WebRTC
let pc = null;
let ws = null;
const SIGNALING_URL = 'ws://localhost:3000';
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' }
];

// DOM prvky
const localVideo      = document.getElementById('localVideo');
const cameraSelect    = document.getElementById('cameraSelect');
const micSelect       = document.getElementById('micSelect');
const nameInput       = document.getElementById('presenterName');
const nameDisplay     = document.getElementById('presenterNameDisplay');
const statusLabel     = document.getElementById('presenterStatus');

const btnStartPreview = document.getElementById('btnStartPreview');
const btnStopPreview  = document.getElementById('btnStopPreview');
const btnMute         = document.getElementById('btnMute');

// === Helpery pro MediaStream ===
function stopLocalStream() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
        currentAudioTrack = null;
    }
}

// Načtení kamer/mikrofonů
async function initDevices() {
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            statusLabel.textContent = 'Prohlížeč nepodporuje MediaDevices.';
            return;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();

        cameraSelect.innerHTML = '<option value="">Výchozí</option>';
        micSelect.innerHTML    = '<option value="">Výchozí</option>';

        devices.forEach(device => {
            if (device.kind === 'videoinput') {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.textContent = device.label || `Kamera ${cameraSelect.length}`;
                cameraSelect.appendChild(opt);
            } else if (device.kind === 'audioinput') {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.textContent = device.label || `Mikrofon ${micSelect.length}`;
                micSelect.appendChild(opt);
            }
        });

        statusLabel.textContent = 'Zařízení načtena. Zadej jméno a spusť náhled.';
    } catch (err) {
        console.error('Chyba při enumerateDevices:', err);
        statusLabel.textContent = 'Nepodařilo se načíst zařízení.';
    }
}

// Spuštění náhledu
async function startPreview() {
    const name = (nameInput.value || '').trim();
    if (!name) {
        alert('Nejdřív zadej své jméno.');
        nameInput.focus();
        return;
    }

    nameDisplay.textContent = name || '–';
    statusLabel.textContent = 'Žádám o přístup ke kameře a mikrofonu…';

    // Zastav případný předchozí stream
    stopLocalStream();

    const videoConstraint = cameraSelect.value
        ? { deviceId: { exact: cameraSelect.value } }
        : true;

    const audioConstraint = micSelect.value
        ? { deviceId: { exact: micSelect.value } }
        : true;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,
            audio: audioConstraint
        });

        localStream = stream;
        localVideo.srcObject = stream;
        localVideo.muted = true; // aby to nehoukalo
        await localVideo.play().catch(() => {});

        currentAudioTrack = stream.getAudioTracks()[0] || null;
        isMuted = false;
        updateMuteButton();

        btnStartPreview.disabled = true;
        btnStopPreview.disabled  = false;
        btnMute.disabled         = !currentAudioTrack;
        statusLabel.textContent  = 'Náhled běží. Kamera a mikrofon jsou aktivní.';

        // Jakmile máme stream, napojíme ho do WebRTC
        setupWebRTC();

    } catch (err) {
        console.error('getUserMedia error:', err);
        statusLabel.textContent = 'Nepodařilo se získat kameru/mikrofon.';
    }
}

// Zastavení náhledu
function stopPreview() {
    stopLocalStream();
    if (localVideo) {
        localVideo.srcObject = null;
    }
    btnStartPreview.disabled = false;
    btnStopPreview.disabled  = true;
    btnMute.disabled         = true;
    isMuted = false;
    updateMuteButton();
    statusLabel.textContent = 'Náhled zastaven.';

    if (pc) {
        pc.close();
        pc = null;
    }
}

// Přepínání mute
function toggleMute() {
    if (!currentAudioTrack) return;
    isMuted = !isMuted;
    currentAudioTrack.enabled = !isMuted;
    updateMuteButton();
    statusLabel.textContent = isMuted ? 'Mikrofon je ztlumen.' : 'Mikrofon je aktivní.';
}

function updateMuteButton() {
    if (!btnMute) return;
    if (!currentAudioTrack) {
        btnMute.textContent = 'Ztlumit mikrofon';
        return;
    }
    btnMute.textContent = isMuted ? 'Zapnout mikrofon' : 'Ztlumit mikrofon';
}

// === WebRTC část ===

function connectSignaling() {
    ws = new WebSocket(SIGNALING_URL);

    ws.onopen = () => {
        console.log('WS: připojeno k signaling serveru');
        ws.send(JSON.stringify({
            type: 'join',
            role: 'presenter'
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

        switch (msg.type) {
            case 'joined':
                console.log(`WS: joined as ${msg.role}`);
                break;

            case 'peer-ready':
                console.log('WS: protistrana připravena:', msg.peer);
                // Pokud už máme PC a stream, negotiationneeded to srovná
                break;

            case 'answer':
                if (pc && msg.sdp) {
                    console.log('WS: dostal jsem answer od vieweru');
                    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                }
                break;

            case 'ice':
                if (pc && msg.candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    } catch (e) {
                        console.error('Chyba při addIceCandidate:', e);
                    }
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

async function setupWebRTC() {
    if (!localStream) {
        console.warn('setupWebRTC voláno bez localStreamu');
        return;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('Signaling WS ještě není ready, počkám...');
        // zkus drobný delay a pak znovu
        setTimeout(setupWebRTC, 1000);
        return;
    }

    if (pc) {
        pc.close();
    }

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // posíláme ICE kandidáty viewerovi
    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice',
                role: 'presenter',
                candidate: event.candidate
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('WebRTC state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            statusLabel.textContent = 'WebRTC: připojeno k viewerovi.';
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            statusLabel.textContent = 'WebRTC: odpojeno.';
        }
    };

    // Přidáme všechny tracky z localStream
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });

    // Jakmile je potřeba nabídka, vytvoříme offer
    pc.onnegotiationneeded = async () => {
        try {
            console.log('WebRTC: negotiationneeded → dělám offer');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(JSON.stringify({
                type: 'offer',
                sdp: pc.localDescription
            }));
        } catch (e) {
            console.error('Chyba při negotiationneeded:', e);
        }
    };
}

// Event listenery
if (btnStartPreview) {
    btnStartPreview.addEventListener('click', () => {
        startPreview().catch(err => {
            console.error(err);
            statusLabel.textContent = 'Chyba při startu náhledu.';
        });
    });
}
if (btnStopPreview) {
    btnStopPreview.addEventListener('click', stopPreview);
}
if (btnMute) {
    btnMute.addEventListener('click', toggleMute);
}

// Změna zařízení → restart náhledu (a tím pádem i WebRTC)
if (cameraSelect) {
    cameraSelect.addEventListener('change', () => {
        if (localStream) {
            startPreview().catch(() => {});
        }
    });
}
if (micSelect) {
    micSelect.addEventListener('change', () => {
        if (localStream) {
            startPreview().catch(() => {});
        }
    });
}

// Init
window.addEventListener('load', () => {
    connectSignaling();
    initDevices().catch(console.error);
});
