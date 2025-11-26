// presenter.js - OPRAVENÁ VERZE
// Explicitně vyžaduje povolení kamery a mikrofonu

// === FALLBACK PRO WEBRTC API ===
const RTCPeerConnection = window.RTCPeerConnection || 
                          window.webkitRTCPeerConnection || 
                          window.mozRTCPeerConnection;

const RTCSessionDescription = window.RTCSessionDescription || 
                               window.webkitRTCSessionDescription || 
                               window.mozRTCSessionDescription;

const RTCIceCandidate = window.RTCIceCandidate || 
                        window.webkitRTCIceCandidate || 
                        window.mozRTCIceCandidate;

if (!RTCPeerConnection) {
    console.error('❌ RTCPeerConnection není dostupné!');
    alert('❌ Váš prohlížeč nepodporuje WebRTC!\n\nPoužijte:\n- Chrome 90+\n- Edge 90+\n- Firefox 80+\n\nNebo zkuste HTTPS: https://localhost/presenter.html');
}

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

console.log('🎬 Presenter.js načten');

// === INICIALIZACE ===
window.addEventListener('load', () => {
    console.log('✅ Stránka načtena, inicializuji...');
    
    // Připoj signaling server
    connectSignaling();
    
    // Načti zařízení
    initDevices().catch(err => {
        console.error('❌ Chyba při inicializaci:', err);
        statusLabel.textContent = 'Chyba: ' + err.message;
    });
});

// === FUNKCE ===

function stopLocalStream() {
    if (localStream) {
        localStream.getTracks().forEach(t => {
            console.log('🛑 Zastavuji track:', t.kind);
            t.stop();
        });
        localStream = null;
        currentAudioTrack = null;
    }
}

async function initDevices() {
    try {
        console.log('📹 Načítám zařízení...');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            throw new Error('Prohlížeč nepodporuje MediaDevices API');
        }

        // POUZE AUDIO - vyžádej povolení
        console.log('🎤 Vyžaduji povolení k mikrofonu (bez kamery)...');
        
        try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ 
                video: false,  // ← BEZ KAMERY
                audio: true 
            });
            
            console.log('✅ Povolení k mikrofonu uděleno!');
            
            // Zastav dočasný stream
            tempStream.getTracks().forEach(t => t.stop());
            
        } catch (permErr) {
            console.error('❌ Povolení zamítnuto:', permErr);
            throw new Error('Musíte povolit přístup k mikrofonu!');
        }

        // Načti seznam zařízení
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log('📋 Nalezená zařízení:', devices.length);

        // Skryj výběr kamery (není potřeba)
        if (cameraSelect && cameraSelect.parentElement) {
            cameraSelect.parentElement.parentElement.style.display = 'none';
        }

        micSelect.innerHTML = '<option value="">Výchozí</option>';

        let micCount = 0;

        devices.forEach(device => {
            console.log(`  - ${device.kind}: ${device.label || '(bez názvu)'}`);
            
            if (device.kind === 'audioinput') {
                const opt = document.createElement('option');
                opt.value = device.deviceId;
                opt.textContent = device.label || `Mikrofon ${++micCount}`;
                micSelect.appendChild(opt);
            }
        });

        statusLabel.textContent = `✅ Nalezeno ${micCount} mikrofonů. Zadejte jméno a spusťte náhled (POUZE AUDIO).`;
        statusLabel.style.color = '#22c55e';

    } catch (err) {
        console.error('❌ Chyba při načítání zařízení:', err);
        statusLabel.textContent = '❌ ' + err.message;
        statusLabel.style.color = '#ef4444';
        throw err;
    }
}

async function startPreview() {
    console.log('▶️ Spouštím náhled...');
    
    const name = (nameInput.value || '').trim();
    if (!name) {
        alert('❌ Nejdříve zadejte své jméno.');
        nameInput.focus();
        return;
    }

    nameDisplay.textContent = name;
    statusLabel.textContent = '⏳ Žádám o přístup ke kameře a mikrofonu...';

    // Zastav případný předchozí stream
    stopLocalStream();

    // POUZE AUDIO - bez kamery
    let videoConstraint = false;  // ← ŽÁDNÉ VIDEO

    let audioConstraint = micSelect.value
        ? { deviceId: { exact: micSelect.value } }
        : true;

    try {
        console.log('🎤 getUserMedia POUZE AUDIO:', { video: videoConstraint, audio: audioConstraint });
        
        const stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraint,  // false
            audio: audioConstraint
        });

        console.log('✅ Audio stream získán:', stream.id);
        console.log('   Audio tracks:', stream.getAudioTracks().length);

        localStream = stream;
        
        // Nastav audio do video elementu (i když není video, element to přehraje)
        localVideo.srcObject = stream;
        localVideo.muted = true;

        currentAudioTrack = stream.getAudioTracks()[0] || null;
        isMuted = false;
        updateMuteButton();

        btnStartPreview.disabled = true;
        btnStopPreview.disabled  = false;
        btnMute.disabled         = !currentAudioTrack;
        
        statusLabel.textContent  = '✅ Audio stream běží (bez videa).';
        statusLabel.style.color = '#22c55e';

        setupWebRTC();

    } catch (err) {
        console.error('❌ getUserMedia selhalo:', err);
        
        let errorMsg = 'Chyba: ';
        if (err.name === 'NotAllowedError') {
            errorMsg += 'Přístup k mikrofonu zamítnut. Povolte mikrofon v nastavení prohlížeče.';
        } else if (err.name === 'NotFoundError') {
            errorMsg += 'Mikrofon nebyl nalezen. Máte připojený mikrofon?';
        } else if (err.name === 'NotReadableError') {
            errorMsg += 'Mikrofon je používán jinou aplikací (Teams, Zoom, atd.)';
        } else {
            errorMsg += err.message;
        }
        
        statusLabel.textContent = errorMsg;
        statusLabel.style.color = '#ef4444';
        alert(errorMsg);
    }
}

function stopPreview() {
    console.log('⏹️ Zastavuji náhled...');
    
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
    statusLabel.style.color = '#9ca3af';

    if (pc) {
        pc.close();
        pc = null;
    }
}

function toggleMute() {
    if (!currentAudioTrack) return;
    isMuted = !isMuted;
    currentAudioTrack.enabled = !isMuted;
    updateMuteButton();
    statusLabel.textContent = isMuted ? '🔇 Mikrofon ztlumen' : '🔊 Mikrofon aktivní';
}

function updateMuteButton() {
    if (!btnMute) return;
    if (!currentAudioTrack) {
        btnMute.textContent = 'Ztlumit mikrofon';
        return;
    }
    btnMute.textContent = isMuted ? 'Zapnout mikrofon' : 'Ztlumit mikrofon';
}

// === WEBRTC ===

function connectSignaling() {
    console.log('🔌 Připojuji se k signaling serveru...');
    
    ws = new WebSocket(SIGNALING_URL);

    ws.onopen = () => {
        console.log('✅ WebSocket připojen');
        const name = nameInput.value || 'Neznámý';
        ws.send(JSON.stringify({
            type: 'join',
            role: 'presenter',
            name: name
        }));
    };

    ws.onmessage = async (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error('❌ Nevalidní WS zpráva:', event.data);
            return;
        }

        console.log('📨 WS zpráva:', msg.type);

        switch (msg.type) {
            case 'joined':
                console.log(`✅ Joined as ${msg.role}, streamId: ${msg.streamId}`);
                break;

            case 'peer-ready':
                console.log('👥 Viewer připraven');
                break;

            case 'answer':
                if (pc && msg.sdp) {
                    console.log('📥 Přijata answer');
                    await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                }
                break;

            case 'ice':
            case 'ice-candidate':
                if (pc && msg.candidate) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                        console.log('✅ ICE candidate přidán');
                    } catch (e) {
                        console.error('❌ Chyba ICE:', e);
                    }
                }
                break;

            default:
                console.log('❓ Neznámý typ:', msg.type);
        }
    };

    ws.onclose = () => {
        console.log('🔌 WebSocket odpojen');
    };

    ws.onerror = (err) => {
        console.error('❌ WebSocket chyba:', err);
    };
}

async function setupWebRTC() {
    if (!localStream) {
        console.warn('⚠️ setupWebRTC bez streamu');
        return;
    }
    
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn('⚠️ WebSocket není připojen, čekám...');
        setTimeout(setupWebRTC, 1000);
        return;
    }

    if (pc) {
        pc.close();
    }

    console.log('🔧 Vytvářím RTCPeerConnection...');
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice',
                role: 'presenter',
                candidate: event.candidate
            }));
            console.log('📤 ICE candidate odeslán');
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('🔗 WebRTC state:', pc.connectionState);
        if (pc.connectionState === 'connected') {
            statusLabel.textContent = '✅ WebRTC: Připojeno k viewerovi';
            statusLabel.style.color = '#22c55e';
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            statusLabel.textContent = '⚠️ WebRTC: Odpojeno';
            statusLabel.style.color = '#f59e0b';
        }
    };

    // Přidej tracky
    localStream.getTracks().forEach(track => {
        console.log(`➕ Přidávám track: ${track.kind}`);
        pc.addTrack(track, localStream);
    });

    // Vytvoř offer
    pc.onnegotiationneeded = async () => {
        try {
            console.log('🤝 Negotiation needed → vytvářím offer...');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(JSON.stringify({
                type: 'offer',
                sdp: pc.localDescription
            }));
            
            console.log('📤 Offer odeslán');
        } catch (e) {
            console.error('❌ Chyba při negotiation:', e);
        }
    };
}

// === EVENT LISTENERY ===

if (btnStartPreview) {
    btnStartPreview.addEventListener('click', () => {
        startPreview().catch(err => {
            console.error('❌ Chyba při spuštění:', err);
            statusLabel.textContent = 'Chyba: ' + err.message;
            statusLabel.style.color = '#ef4444';
        });
    });
}

if (btnStopPreview) {
    btnStopPreview.addEventListener('click', stopPreview);
}

if (btnMute) {
    btnMute.addEventListener('click', toggleMute);
}

// Změna zařízení → restart náhledu
if (cameraSelect) {
    cameraSelect.addEventListener('change', () => {
        if (localStream) {
            console.log('🔄 Kamera změněna, restartuji náhled...');
            startPreview().catch(console.error);
        }
    });
}

if (micSelect) {
    micSelect.addEventListener('change', () => {
        if (localStream) {
            console.log('🔄 Mikrofon změněn, restartuji náhled...');
            startPreview().catch(console.error);
        }
    });
}

console.log('✅ Presenter.js připraven');
