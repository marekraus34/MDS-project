// viewer.js - DUAL VIDEO VERSION
// Zobrazuje WebRTC stream od presentera + HLS grid stream vedle sebe

// === Globální proměnné ===
let player = null; // Video.js player pro HLS
let localStream = null; // Lokální stream (kamera/mikrofon)
let pc = null; // WebRTC peer connection
let ws = null; // WebSocket pro signaling
let isLoggedIn = false;
let currentStreamSource = 'multi';

const SIGNALING_URL = 'ws://localhost:3000';

// DOM elementy
const loginContainer = document.getElementById('loginContainer');
const viewerContainer = document.getElementById('viewerContainer');
const viewerName = document.getElementById('viewerName');
const viewerCode = document.getElementById('viewerCode');
const joinBtn = document.getElementById('joinBtn');
const loginError = document.getElementById('loginError');

// Video elementy
const viewerVideo = document.getElementById('viewerVideo'); // HLS player
const webrtcRemote = document.getElementById('webrtcRemote'); // WebRTC remote
const localVideo = document.getElementById('localVideo'); // Lokální preview
const localPreview = document.getElementById('localPreview');

// Status elementy
const viewerStatus = document.getElementById('viewerStatus');
const mediaStatus = document.getElementById('mediaStatus');
const detailedMediaStatus = document.getElementById('detailedMediaStatus');
const webrtcLiveBadge = document.getElementById('webrtcLiveBadge');
const hlsLiveBadge = document.getElementById('hlsLiveBadge');
const webrtcPlaceholder = document.getElementById('webrtcPlaceholder');

// Control elementy
const streamSelect = document.getElementById('streamSelect');
const playBtn = document.getElementById('playBtn');
const stopBtn = document.getElementById('stopBtn');
const qualitySelect = document.getElementById('qualitySelect');
const qualityLabel = document.getElementById('qualityLabel');
const viewerError = document.getElementById('viewerError');
const btnLive = document.getElementById('btnLive');
const btnBack30 = document.getElementById('btnBack30');
const btnBack5min = document.getElementById('btnBack5min');
const presenterList = document.getElementById('presenterList');

// === CAMERA/MICROPHONE PERMISSIONS ===
async function requestMediaPermissions() {
    try {
        console.log('🎤 Vyžadování oprávnění ke kameře a mikrofonu...');
        
        localStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        console.log('✅ Oprávnění uděleno!');
        
        // Zobraz lokální video preview
        if (localVideo) {
            localVideo.srcObject = localStream;
            localPreview.style.display = 'block';
        }

        // Aktualizuj status
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];
        
        if (mediaStatus) {
            mediaStatus.textContent = '✅ Média OK';
            mediaStatus.classList.remove('status-offline');
            mediaStatus.classList.add('status-online');
        }

        if (detailedMediaStatus) {
            detailedMediaStatus.innerHTML = `
                ✅ <strong>Kamera:</strong> ${videoTrack.label}<br>
                ✅ <strong>Mikrofon:</strong> ${audioTrack.label}
            `;
        }

        return true;

    } catch (error) {
        console.error('❌ Chyba při získávání média:', error);
        
        let errorMessage = 'Chyba: ';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += 'Přístup zamítnut. Povolte kameru a mikrofon.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'Kamera nebo mikrofon nebyl nalezen.';
        } else if (error.name === 'NotReadableError') {
            errorMessage += 'Zařízení je používáno jinou aplikací.';
        } else {
            errorMessage += error.message;
        }

        if (detailedMediaStatus) {
            detailedMediaStatus.innerHTML = '❌ ' + errorMessage;
        }
        
        alert(errorMessage);
        return false;
    }
}

// === HLS PLAYER SETUP ===
function initPlayer() {
    if (player) {
        player.dispose();
        player = null;
    }

    player = videojs('viewerVideo', {
        controls: true,
        autoplay: false,
        preload: 'auto',
        fluid: false,
        liveui: true,
        html5: {
            vhs: {
                enableLowInitialPlaylist: true,
                smoothQualityChange: true,
                overrideNative: true
            }
        }
    });

    player.on('error', function() {
        const error = player.error();
        console.error('❌ Player error:', error);
        showError(`Chyba HLS: ${error.message}`);
    });

    player.on('loadedmetadata', function() {
        console.log('✅ HLS metadata načtena');
        updateQualityOptions();
    });

    player.on('playing', function() {
        console.log('▶️ HLS stream běží');
        hlsLiveBadge.style.display = 'block';
        qualityLabel.textContent = 'Stream běží...';
    });

    player.on('pause', function() {
        hlsLiveBadge.style.display = 'none';
    });

    console.log('✅ Video.js player inicializován');
}

// === HLS STREAM LOADING ===
function loadStream(source) {
    currentStreamSource = source;
    
    let streamUrl;
    if (source === 'multi') {
        streamUrl = 'http://localhost:8081/hls/master.m3u8';
    } else {
        // Pro single kameru (pokud by byla implementace)
        streamUrl = `http://localhost:8081/hls/${source}/master.m3u8`;
    }

    console.log('📡 Načítám HLS stream:', streamUrl);
    qualityLabel.textContent = 'Načítám...';

    if (!player) {
        initPlayer();
    }

    player.src({
        src: streamUrl,
        type: 'application/x-mpegURL'
    });

    player.play().catch(err => {
        console.error('❌ Chyba při spuštění HLS:', err);
        showError('Nepodařilo se spustit HLS stream. Klikni PLAY.');
    });
}

// === QUALITY SELECTION ===
function updateQualityOptions() {
    if (!player || !player.qualityLevels) return;

    const levels = player.qualityLevels();
    qualitySelect.innerHTML = '<option value="auto">Auto</option>';

    for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `${level.height}p (${Math.round(level.bitrate / 1000)}kbps)`;
        qualitySelect.appendChild(option);
    }

    levels.on('change', function() {
        for (let i = 0; i < levels.length; i++) {
            if (levels[i].enabled) {
                qualityLabel.textContent = `Kvalita: ${levels[i].height}p`;
                break;
            }
        }
    });
}

qualitySelect?.addEventListener('change', function() {
    if (!player || !player.qualityLevels) return;

    const levels = player.qualityLevels();
    const selectedIndex = this.value;

    if (selectedIndex === 'auto') {
        for (let i = 0; i < levels.length; i++) {
            levels[i].enabled = true;
        }
        qualityLabel.textContent = 'Kvalita: Auto';
    } else {
        for (let i = 0; i < levels.length; i++) {
            levels[i].enabled = (i == selectedIndex);
        }
    }
});

// === DVR CONTROLS ===
btnLive?.addEventListener('click', function() {
    if (player && player.liveTracker) {
        player.liveTracker.seekToLiveEdge();
        console.log('⏭️ Přechod na LIVE');
    }
});

btnBack30?.addEventListener('click', function() {
    if (player) {
        player.currentTime(Math.max(0, player.currentTime() - 30));
        console.log('⏪ -30s');
    }
});

btnBack5min?.addEventListener('click', function() {
    if (player) {
        player.currentTime(Math.max(0, player.currentTime() - 300));
        console.log('⏪ -5min');
    }
});

// === STREAM CONTROLS ===
playBtn?.addEventListener('click', function() {
    if (!isLoggedIn) {
        alert('Nejdřív se přihlaš!');
        return;
    }
    loadStream(streamSelect.value);
});

stopBtn?.addEventListener('click', function() {
    if (player) {
        player.pause();
        hlsLiveBadge.style.display = 'none';
        qualityLabel.textContent = 'Stream zastaven';
    }
});

streamSelect?.addEventListener('change', function() {
    if (player && !player.paused()) {
        loadStream(this.value);
    }
});

// === LOGIN ===
joinBtn?.addEventListener('click', async function() {
    const name = viewerName.value.trim();
    const code = viewerCode.value.trim();

    console.log('🔐 Login pokus...', { name, code });

    if (!name) {
        loginError.textContent = '❌ Zadej jméno';
        return;
    }

    if (!code) {
        loginError.textContent = '❌ Zadej kód místnosti';
        return;
    }

    if (code !== 'mds2025') {
        loginError.textContent = '❌ Nesprávný kód';
        return;
    }

    // Zobraz loading
    loginError.textContent = '🔄 Připojuji se...';
    loginError.style.color = '#667eea';
    joinBtn.disabled = true;
    joinBtn.textContent = 'Připojuji se...';

    try {
        // Vyžádat oprávnění
        console.log('📹 Vyžadování média permissions...');
        const granted = await requestMediaPermissions();
        
        if (!granted) {
            loginError.textContent = '❌ Bez oprávnění nelze pokračovat';
            loginError.style.color = '#dc3545';
            joinBtn.disabled = false;
            joinBtn.textContent = 'Připojit se';
            return;
        }

        console.log('✅ Oprávnění získáno');

        isLoggedIn = true;
        loginError.textContent = '✅ Připojeno!';
        loginError.style.color = '#28a745';

        // KRITICKÉ: Přepnout na viewer UI
        console.log('🔄 Přepínám na viewer UI...');
        
        if (loginContainer && viewerContainer) {
            loginContainer.style.display = 'none';
            viewerContainer.style.display = 'block';
            console.log('✅ UI přepnuto');
        } else {
            console.error('❌ CHYBA: loginContainer nebo viewerContainer neexistuje!');
            alert('Chyba: UI elementy nenalezeny!');
            return;
        }

        // Aktualizovat status
        if (viewerStatus) {
            viewerStatus.textContent = `✅ ${name}`;
            viewerStatus.classList.remove('status-offline');
            viewerStatus.classList.add('status-online');
        }

        console.log('✅ Viewer přihlášen:', name);

        // Připojit k signaling serveru
        console.log('🔌 Připojuji k signaling serveru...');
        connectSignaling();

        // Načíst presentery
        console.log('👥 Načítám presentery...');
        fetchPresenters();
        setInterval(fetchPresenters, 5000);

        // Automaticky spustit HLS stream
        console.log('▶️ Spouštím HLS stream...');
        setTimeout(() => {
            loadStream('multi');
        }, 1000);

    } catch (error) {
        console.error('❌ Login error:', error);
        loginError.textContent = '❌ Chyba při přihlášení: ' + error.message;
        loginError.style.color = '#dc3545';
        joinBtn.disabled = false;
        joinBtn.textContent = 'Připojit se';
    }
});

// === FETCH PRESENTERS ===
async function fetchPresenters() {
    try {
        const response = await fetch('http://localhost:8081/stats');
        const xmlText = await response.text();
        
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const streams = xmlDoc.querySelectorAll('stream');
        
        const presentersHTML = [];
        streams.forEach(stream => {
            const name = stream.querySelector('name')?.textContent || '';
            const nclients = stream.querySelector('nclients')?.textContent || '0';

            if (name.match(/^cam[1-6]$/)) {
                presentersHTML.push(
                    `<div style="padding: 5px 0;">
                        <span style="color: #28a745;">●</span> ${name} (${nclients})
                    </div>`
                );
            }
        });

        if (presentersHTML.length === 0) {
            presenterList.innerHTML = '<div style="color: #999;">Žádní aktivní</div>';
        } else {
            presenterList.innerHTML = presentersHTML.join('');
        }

    } catch (err) {
        console.error('❌ Chyba /stats:', err);
        presenterList.innerHTML = '<div style="color: #dc3545;">Chyba</div>';
    }
}

// === WEBRTC SIGNALING ===
function connectSignaling() {
    ws = new WebSocket(SIGNALING_URL);

    ws.onopen = () => {
        console.log('🔌 WS: připojeno');
        ws.send(JSON.stringify({
            type: 'join',
            role: 'viewer'
        }));
    };

    ws.onmessage = async (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error('❌ Nevalidní WS zpráva');
            return;
        }

        console.log('📨 WS:', msg.type);

        switch (msg.type) {
            case 'joined':
                console.log(`✅ Joined as ${msg.role}`);
                break;

            case 'offer':
                if (msg.sdp) {
                    console.log('📥 Dostal jsem offer od presentera');
                    await handleOffer(msg.sdp);
                }
                break;

            case 'ice':
                if (msg.candidate && pc) {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    } catch (e) {
                        console.error('❌ ICE candidate error:', e);
                    }
                }
                break;
        }
    };

    ws.onclose = () => {
        console.log('🔌 WS: odpojeno');
    };

    ws.onerror = (err) => {
        console.error('❌ WS error:', err);
    };
}

// === WEBRTC OFFER HANDLING ===
async function handleOffer(sdp) {
    if (pc) {
        pc.close();
    }

    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Přidat local stream
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log('➕ Local track:', track.kind);
        });
    }

    pc.onicecandidate = (event) => {
        if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'ice',
                role: 'viewer',
                candidate: event.candidate
            }));
        }
    };

    pc.ontrack = (event) => {
        console.log('📺 WebRTC: dostal jsem track od presentera:', event.track.kind);
        const [stream] = event.streams;
        if (webrtcRemote) {
            webrtcRemote.srcObject = stream;
            webrtcPlaceholder.style.display = 'none';
            webrtcLiveBadge.style.display = 'block';
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('🔗 WebRTC state:', pc.connectionState);
        
        if (pc.connectionState === 'connected') {
            webrtcLiveBadge.style.display = 'block';
            webrtcPlaceholder.style.display = 'none';
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            webrtcLiveBadge.style.display = 'none';
            webrtcPlaceholder.style.display = 'block';
        }
    };

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: 'answer',
            sdp: pc.localDescription
        }));

        console.log('✅ WebRTC: answer odeslána');
    } catch (e) {
        console.error('❌ WebRTC handshake error:', e);
    }
}

// === ERROR DISPLAY ===
function showError(message) {
    viewerError.textContent = message;
    viewerError.style.display = 'block';
    setTimeout(() => {
        viewerError.style.display = 'none';
    }, 5000);
}

// === INIT ===
window.addEventListener('load', () => {
    console.log('🚀 Viewer inicializován');
    initPlayer();
});

// === CLEANUP ===
window.addEventListener('beforeunload', () => {
    if (player) player.dispose();
    if (pc) pc.close();
    if (ws) ws.close();
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
});
