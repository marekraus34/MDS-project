// viewer.js
// ===============================================
// Video.js – HLS přehrávač pro diváka + "login" + /stats
// + WebRTC příjem (P2P s presenterem)
// ===============================================

let player = null;

// HTML prvky – HLS
const playBtn        = document.getElementById("playBtn");
const stopBtn        = document.getElementById("stopBtn");
const streamSelect   = document.getElementById("streamSelect");
const presenterList  = document.getElementById("presenterList");

const btnLive        = document.getElementById("btnLive");
const btnBack30      = document.getElementById("btnBack30");
const btnBack5min    = document.getElementById("btnBack5min");

const qualitySelect  = document.getElementById("qualitySelect");
const qualityLabel   = document.getElementById("qualityLabel");
const errorBox       = document.getElementById("viewerError");

// Login prvky
const viewerNameInput = document.getElementById("viewerName");
const viewerCodeInput = document.getElementById("viewerCode");
const joinBtn         = document.getElementById("joinBtn");
const loginError      = document.getElementById("loginError");
const viewerStatus    = document.getElementById("viewerStatus");

// WebRTC – remote video
const webrtcRemoteVideo = document.getElementById("webrtcRemote");

// Jednoduchý "tajný" kód pro demo
const ROOM_CODE = "mds2025";
//let isAuthorized = false;
let isAuthorized = true;    // pro snadné testování bez loginu

// WebRTC
let ws = null;
let pc = null;
const SIGNALING_URL = 'ws://localhost:3000';
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' }
];

// ===============================================
// Video.js inicializace
// ===============================================
function initPlayer() {
    if (player) return player;

    player = videojs("viewerVideo", {
        autoplay: false,
        controls: true,
        liveui: true,
        preload: "auto",
        html5: {
            vhs: {
                enableLowInitialPlaylist: true
            }
        }
    });

    return player;
}

function setControlsEnabled(enabled) {
    if (playBtn)       playBtn.disabled       = !enabled;
    if (stopBtn)       stopBtn.disabled       = !enabled;
    if (streamSelect)  streamSelect.disabled  = !enabled;
    if (btnLive)       btnLive.disabled       = !enabled;
    if (btnBack30)     btnBack30.disabled     = !enabled;
    if (btnBack5min)   btnBack5min.disabled   = !enabled;
    if (qualitySelect) qualitySelect.disabled = !enabled;
}

// defaultně zamknout ovládání streamu
setControlsEnabled(false);

// ===============================================
// Login logika
// ===============================================
function updateViewerStatus(name) {
    if (!viewerStatus) return;
    if (!isAuthorized) {
        viewerStatus.textContent = "Nepřihlášen";
        viewerStatus.className = "badge bg-secondary";
    } else {
        viewerStatus.textContent = `Přihlášen: ${name || "divák"}`;
        viewerStatus.className = "badge bg-success";
    }
}

// Zkus načíst jméno z localStorage
(function restoreViewerName() {
    const savedName = window.localStorage.getItem("viewerName");
    if (savedName && viewerNameInput) {
        viewerNameInput.value = savedName;
    }
})();

function connectSignaling() {
    console.log("Viewer: connectSignaling() → connectWebRTCViewer()");
    connectWebRTCViewer();
}

function handleJoin() {
    if (!viewerNameInput || !viewerCodeInput || !joinBtn) return;

    const name = viewerNameInput.value.trim();
    const code = viewerCodeInput.value.trim();

    if (!name) {
        loginError.textContent = "Zadej, prosím, své jméno.";
        return;
    }
    if (!code) {
        loginError.textContent = "Zadej kód místnosti.";
        return;
    }
    if (code !== ROOM_CODE) {
        loginError.textContent = "Neplatný kód (správný je mds2025).";
        return;
    }

    isAuthorized = true;
    loginError.textContent = "";
    setControlsEnabled(true);
    updateViewerStatus(name);

    try {
        window.localStorage.setItem("viewerName", name);
    } catch (e) {
        console.warn("Nepodařilo se uložit jméno do localStorage:", e);
    }

    // Po úspěšném "loginu" navážeme WebRTC signaling
    connectSignaling();
}

if (joinBtn) {
    joinBtn.addEventListener("click", handleJoin);
}

// ===============================================
// Start / stop přehrávání HLS
// ===============================================
function getSelectedUrl() {
    if (!streamSelect) {
        return "/hls/master.m3u8";
    }
    return streamSelect.value === "single"
        ? "/hls/stream.m3u8"
        : "/hls/master.m3u8";
}

function startPlayback() {
    if (!isAuthorized) {
        if (loginError) {
            loginError.textContent = "Nejdřív se přihlas (jméno + kód).";
        }
        return;
    }

    const url = getSelectedUrl();
    const p = initPlayer();
    errorBox.textContent = "";

    p.src({
        src: url,
        type: "application/x-mpegURL"
    });

    p.play().catch(err => {
        console.error("Chyba při přehrávání:", err);
        errorBox.textContent = "Nepodařilo se spustit přehrávání.";
    });
}

function stopPlayback() {
    if (!player) return;
    try {
        player.pause();
        player.src({ src: "", type: "" });
    } catch (e) {
        console.warn("Chyba při zastavení:", e);
    }
}

// ===============================================
// DVR – LIVE, -30s, -5min + zpoždění
// ===============================================
function updateDelayLabel() {
    if (!player || !qualityLabel) return;

    const seekable = player.seekable();
    if (!seekable || seekable.length === 0) {
        qualityLabel.textContent = "(čekám na stream…)";
        return;
    }

    const livePos   = seekable.end(seekable.length - 1);
    const cur       = player.currentTime();
    const delay     = livePos - cur;

    if (!Number.isFinite(delay)) {
        qualityLabel.textContent = "(čekám na stream…)";
        return;
    }

    qualityLabel.textContent = `Zpoždění ~ ${delay.toFixed(1)} s`;
}

// voláme každou vteřinu
setInterval(updateDelayLabel, 1000);

function seekRelative(seconds) {
    if (!player) return;
    try {
        const current = player.currentTime() || 0;
        const target  = Math.max(0, current + seconds);
        player.currentTime(target);
    } catch (e) {
        console.error("seekRelative error", e);
    }
}

function jumpToLive() {
    if (!player) return;
    try {
        const seekable = player.seekable();
        if (!seekable || seekable.length === 0) return;
        const livePos = seekable.end(seekable.length - 1);
        player.currentTime(Math.max(0, livePos - 1));
    } catch (e) {
        console.error("jumpToLive error", e);
    }
}

if (btnBack30) {
    btnBack30.addEventListener("click", () => seekRelative(-30));
}
if (btnBack5min) {
    btnBack5min.addEventListener("click", () => seekRelative(-300));
}
if (btnLive) {
    btnLive.addEventListener("click", jumpToLive);
}

// qualitySelect – zatím jen placeholder
if (qualitySelect) {
    qualitySelect.value = "auto";
    qualitySelect.addEventListener("change", () => {
        // Manuální přepínání kvality bychom museli řešit přes Hls.js / VHS API.
    });
}

// ===============================================
// Panel přednášejících – /stats z Nginx
// ===============================================
const PRESENTER_NAMES = {
    cam1: "Martin",
    cam2: "Přednášející 2",
    cam3: "Přednášející 3",
    cam4: "Přednášející 4",
    cam5: "Přednášející 5",
    cam6: "Přednášející 6"
};

function parseCamsFromStats(xmlText) {
    if (!xmlText) return [];
    const regex = /<stream>[\s\S]*?<name>(.*?)<\/name>[\s\S]*?<\/stream>/g;
    const cams = [];
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
        const name = match[1].trim();
        if (/^cam[1-6]$/.test(name)) {
            cams.push(name);
        }
    }
    return cams;
}

async function refreshPresenters() {
    if (!presenterList) return;
    try {
        const res  = await fetch("/stats", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const text = await res.text();
        const cams = parseCamsFromStats(text);

        presenterList.innerHTML = "";

        if (!cams.length) {
            presenterList.innerHTML = "<div class='text-muted small'>Žádné aktivní kamery.</div>";
            return;
        }

        cams.forEach(cam => {
            const div  = document.createElement("div");
            const dot  = document.createElement("span");
            const span = document.createElement("span");

            dot.className  = "presenter-badge";
            span.textContent = PRESENTER_NAMES[cam] || cam;

            div.appendChild(dot);
            div.appendChild(span);

            presenterList.appendChild(div);
        });
    } catch (err) {
        presenterList.innerHTML =
            "<div class='text-muted small'>/stats není k dispozici (není nutné pro přehrávání).</div>";
    }
}

function startPresenterPolling() {
    refreshPresenters();
    setInterval(refreshPresenters, 5000);
}
startPresenterPolling();

// ===============================================
// WebRTC – přímé spojení s presenterem
// ===============================================

const webrtcVideo = document.getElementById("webrtcPlayer");

let wrtcSocket = null;
let wrtcPeer = null;

function createViewerPeer() {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" }
        ]
    });

    pc.ontrack = (event) => {
    console.log("Viewer: přišel remote track");
    const [stream] = event.streams;
    if (webrtcVideo) {
        webrtcVideo.srcObject = stream;
        webrtcVideo.play().catch(() => {});
    }
};

    pc.onicecandidate = (event) => {
        if (event.candidate && wrtcSocket && wrtcSocket.readyState === WebSocket.OPEN) {
            wrtcSocket.send(JSON.stringify({
                type: "ice-candidate",
                target: "presenter",
                candidate: event.candidate
            }));
        }
    };

    pc.onconnectionstatechange = () => {
        console.log("Viewer RTC: connection state =", pc.connectionState);
    };

    return pc;
}

function connectWebRTCViewer() {
    if (!webrtcVideo) {
        console.warn("Viewer RTC: nenašel jsem <video id=\"webrtcPlayer\">");
        return;
    }

    wrtcSocket = new WebSocket("ws://localhost:3000");

    wrtcSocket.onopen = () => {
        console.log("Viewer WS: připojeno k signaling serveru");
        wrtcSocket.send(JSON.stringify({ type: "role", role: "viewer" }));
        console.log("Viewer WS: joined as viewer");
    };

    wrtcSocket.onmessage = async (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            console.error("Viewer WS: neplatný JSON", event.data);
            return;
        }

        switch (msg.type) {
            case "presenter-ready":
                console.log("Viewer WS: presenter-ready");
                break;

            case "offer":
                console.log("Viewer WS: dorazila offer");
                if (!wrtcPeer) {
                    wrtcPeer = createViewerPeer();
                }
                try {
                    await wrtcPeer.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                    const answer = await wrtcPeer.createAnswer();
                    await wrtcPeer.setLocalDescription(answer);

                    wrtcSocket.send(JSON.stringify({
                        type: "answer",
                        sdp: answer
                    }));
                    console.log("Viewer WS: answer odeslána");
                } catch (err) {
                    console.error("Viewer RTC: chyba při zpracování offer/answer", err);
                }
                break;

            case "ice-candidate":
                if (wrtcPeer && msg.candidate) {
                    try {
                        await wrtcPeer.addIceCandidate(new RTCIceCandidate(msg.candidate));
                    } catch (err) {
                        console.error("Viewer RTC: chyba addIceCandidate", err);
                    }
                }
                break;

            case "presenter-gone":
                console.log("Viewer WS: presenter-gone, čistím peer");
                if (wrtcPeer) {
                    wrtcPeer.close();
                    wrtcPeer = null;
                }
                if (webrtcVideo) webrtcVideo.srcObject = null;
                break;

            default:
                // jiné typy ignorujeme
                break;
        }
    };

    wrtcSocket.onclose = () => {
        console.log("Viewer WS: spojení uzavřeno");
    };

    wrtcSocket.onerror = (err) => {
        console.error("Viewer WS: chyba", err);
    };
}

if (webrtcVideo) {
    connectWebRTCViewer();
}