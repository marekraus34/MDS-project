const socket      = io();
const roomInput   = document.getElementById("room");
const joinBtn     = document.getElementById("joinBtn");
const statusEl    = document.getElementById("status");
const errEl       = document.getElementById("error");
const remoteVideo = document.getElementById("remoteVideo");

let joinedRoom = null;
let peer = null;

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.className = "pill " + (ok ? "ok" : "");
}

function createPeerAsViewer() {
  // viewer je vždy "initiator: false"
  peer = new SimplePeer({
    initiator: false,
    trickle: false
  });

  peer.on("signal", data => {
    // tohle je odpověď (answer/ICE) zpátky na sender
    if (!joinedRoom) return;
    socket.emit("signal", { room: joinedRoom, data });
  });

  peer.on("stream", stream => {
    console.log("Viewer: dostal stream");
    remoteVideo.srcObject = stream;
  });

  peer.on("connect", () => {
    console.log("Viewer: WebRTC spojeno");
    setStatus("Přijímám stream ✅", true);
  });

  peer.on("error", err => {
    console.error("Viewer peer error:", err);
    errEl.textContent = "Chyba WebRTC spojení (viewer).";
  });

  peer.on("close", () => {
    console.log("Viewer: peer zavřen");
    remoteVideo.srcObject = null;
  });
}

function destroyPeer() {
  if (peer) {
    peer.destroy();
    peer = null;
  }
}

joinBtn.addEventListener("click", () => {
  const room = (roomInput.value || "").trim() || "demo";
  socket.emit("join", room);
  joinedRoom = room;
  errEl.textContent = "";
  setStatus(`Připojeno k místnosti „${room}“ – čekám na vysílání`, true);
  // peer teď NEvytváříme hned, počkáme na první signal
});

// Jakmile přijde signalizace od senderu (offer/ICE):
socket.on("signal", data => {
  console.log("Viewer: přišel signal", data);

  // Pokud ještě nemáme peer, vytvoříme ho až teď
  if (!peer) {
    console.log("Viewer: vytvářím peer (na základě příchozího signálu)");
    createPeerAsViewer();
  }

  try {
    peer.signal(data);
  } catch (e) {
    console.error("Viewer: chyba při peer.signal()", e);
  }
});
