const socket     = io();
const roomInput  = document.getElementById("room");
const joinBtn    = document.getElementById("joinBtn");
const startBtn   = document.getElementById("startBtn");
const stopBtn    = document.getElementById("stopBtn");
const muteBtn    = document.getElementById("muteBtn");
const statusEl   = document.getElementById("status");
const errEl      = document.getElementById("error");
const localVideo = document.getElementById("localVideo");
const nameInput  = document.getElementById("displayName");
const videoWrapper = document.getElementById("videoWrapper");

let joinedRoom = null;
let localStream = null;
let peer = null;
let audioMuted = false;

// WebRTC simple-peer

function setStatus(text, ok=false) {
  statusEl.textContent = text;
  statusEl.className = "pill " + (ok ? "ok" : "");
}

// --- Audio activity detection (wrapper .active) ---
let audioCtx = null;
let analyser = null;
let srcNode  = null;
let rafId    = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume?.();
  }
}

function startAudioActivity(stream) {
  ensureAudioContext();
  stopAudioActivity(); // čistý start

  try {
    srcNode = audioCtx.createMediaStreamSource(stream);
  } catch (e) {
    console.warn("MediaStreamSource error:", e);
    return;
  }

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;

  srcNode.connect(analyser);

  const buf = new Uint8Array(analyser.fftSize);

  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128; // -1..1
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length); // 0..~1

    if (videoWrapper) {
      if (rms > 0.05 && !audioMuted) {
        videoWrapper.classList.add("active");
      } else {
        videoWrapper.classList.remove("active");
      }
    }

    rafId = requestAnimationFrame(tick);
  };

  tick();
}

function stopAudioActivity() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  try { srcNode?.disconnect(); } catch (_) {}
  try { analyser?.disconnect(); } catch (_) {}

  srcNode = null;
  analyser = null;

  if (videoWrapper) {
    videoWrapper.classList.remove("active");
  }
}

// --- Media + peer ---

async function getLocalMedia() {
  const displayName = (nameInput.value || "").trim();
  if (!displayName) {
    errEl.textContent = "Zadej prosím své jméno.";
    return null;
  }
  errEl.textContent = "";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    localVideo.srcObject = stream;
    localVideo.muted = true; // vlastní zvuk nebudeme přehrávat přes <video>
    startAudioActivity(stream);
    return stream;
  } catch (e) {
    console.error(e);
    errEl.textContent = "Nepodařilo se získat kameru/mikrofon.";
    return null;
  }
}

function createPeerAsSender() {
  if (!localStream) return;

  peer = new SimplePeer({
    initiator: true,
    trickle: false,
    stream: localStream
  });

  peer.on("signal", data => {
    if (!joinedRoom) return;
    socket.emit("signal", { room: joinedRoom, data });
  });

  peer.on("connect", () => {
    console.log("WebRTC spojeno (sender)");
    setStatus("Vysílám ✅", true);
  });

  peer.on("error", err => {
    console.error("Peer error:", err);
    errEl.textContent = "Chyba WebRTC spojení (sender).";
  });

  peer.on("close", () => {
    console.log("Peer zavřen (sender)");
  });
}

function destroyPeer() {
  if (peer) {
    peer.destroy();
    peer = null;
  }
}

// --- UI akce ---

joinBtn.addEventListener("click", () => {
  const room = (roomInput.value || "").trim() || "demo";
  socket.emit("join", room);
  joinedRoom = room;
  setStatus(`Připojeno k místnosti „${room}“`, true);
  startBtn.disabled = false;
});

startBtn.addEventListener("click", async () => {
  if (!joinedRoom) {
    errEl.textContent = "Nejprve se připoj do místnosti.";
    return;
  }
  if (!localStream) {
    localStream = await getLocalMedia();
    if (!localStream) return;
  }
  destroyPeer();
  createPeerAsSender();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  muteBtn.disabled = false;
});

stopBtn.addEventListener("click", () => {
  destroyPeer();
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  stopAudioActivity();
  setStatus(`Připojeno k místnosti „${joinedRoom}“ (nevysílám)`);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  muteBtn.disabled = true;
  audioMuted = false;
  muteBtn.textContent = "Ztlumit mikrofon";
});

muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  audioMuted = !audioMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !audioMuted);
  muteBtn.textContent = audioMuted ? "Zapnout mikrofon" : "Ztlumit mikrofon";
  // wrapper se vypne i vizuálně, pokud je ztlumeno:
  if (audioMuted && videoWrapper) {
    videoWrapper.classList.remove("active");
  }
});

// příchozí signalizace z vieweru (odpověď / ICE)
socket.on("signal", data => {
  if (!peer) return;
  peer.signal(data);
});
