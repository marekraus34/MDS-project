// signaling-server.js
// WebRTC signaling + WebRTC → RTMP bridge pro MDS projekt
// Podporuje max 6 prezenterů, každý dostane svůj stream ID (cam1-cam6)

const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const { RTCPeerConnection, RTCSessionDescription } = require('wrtc');

const PORT = 3000;
const MAX_PRESENTERS = 6;
const RTMP_OUTPUT_BASE = 'rtmp://localhost:1936/live';

// Tracking prezenterů
const presenters = new Map(); // clientId → { ws, pc, ffmpeg, streamId, name }
const viewers = new Map();
let nextCamId = 1;

// HTTP server pro health check
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'running',
    presenters: presenters.size,
    viewers: viewers.size
  }));
});

// WebSocket server
const wss = new WebSocket.Server({ server });

console.log('🚀 MDS Signaling Server spuštěn');
console.log(`   WebSocket: ws://localhost:${PORT}`);
console.log(`   Max presenters: ${MAX_PRESENTERS}`);
console.log('');

wss.on('connection', (ws, req) => {
  const clientId = generateId();
  let client = { id: clientId, ws, role: null };

  console.log(`[${timestamp()}] ✓ Nový client: ${clientId}`);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      await handleMessage(client, msg);
    } catch (e) {
      console.error(`[${timestamp()}] Chyba zprávy:`, e.message);
    }
  });

  ws.on('close', () => {
    handleDisconnect(client);
  });

  ws.on('error', (err) => {
    console.error(`[${timestamp()}] WS error (${clientId}):`, err.message);
  });
});

async function handleMessage(client, msg) {
  switch (msg.type) {
    case 'join':
      if (msg.role === 'presenter') {
        await handlePresenterJoin(client, msg);
      }
      break;

    case 'role':
      if (msg.role === 'viewer') {
        handleViewerJoin(client);
      }
      break;

    case 'offer':
      await handleOffer(client, msg);
      break;

    case 'answer':
      await handleAnswer(client, msg);
      break;

    case 'ice':
    case 'ice-candidate':
      await handleIceCandidate(client, msg);
      break;

    default:
      console.log(`[${timestamp()}] Neznámý typ: ${msg.type}`);
  }
}

async function handlePresenterJoin(client, msg) {
  if (presenters.size >= MAX_PRESENTERS) {
    client.ws.send(JSON.stringify({
      type: 'error',
      message: 'Maximum počet prezenterů dosažen'
    }));
    return;
  }

  const streamId = `cam${nextCamId++}`;
  client.role = 'presenter';
  client.streamId = streamId;
  client.name = msg.name || 'Neznámý';

  // Vytvoř WebRTC peer connection
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  client.pc = pc;

  // ICE candidate handler
  pc.onicecandidate = (event) => {
    if (event.candidate && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        type: 'ice',
        candidate: event.candidate
      }));
    }
  };

  // Track handler - jakmile dostaneme video/audio track
  pc.ontrack = (event) => {
    console.log(`[${timestamp()}] 📹 Track přijat od ${client.name} (${streamId})`);
    
    const [stream] = event.streams;
    
    // Spusť FFmpeg pro konverzi WebRTC → RTMP
    if (!client.ffmpeg) {
      startFFmpegBridge(client, stream);
    }
  };

  presenters.set(client.id, client);

  client.ws.send(JSON.stringify({
    type: 'joined',
    role: 'presenter',
    streamId: streamId
  }));

  console.log(`[${timestamp()}] ✓ Presenter: ${client.name} → ${streamId}`);

  // Notifikuj viewery
  broadcastToViewers({
    type: 'presenter-ready',
    streamId: streamId,
    name: client.name
  });
}

function handleViewerJoin(client) {
  client.role = 'viewer';
  viewers.set(client.id, client);

  // Pošli seznam aktivních prezenterů
  const presenterList = Array.from(presenters.values()).map(p => ({
    streamId: p.streamId,
    name: p.name
  }));

  client.ws.send(JSON.stringify({
    type: 'presenter-list',
    presenters: presenterList
  }));

  console.log(`[${timestamp()}] ✓ Viewer připojen (${client.id})`);
}

async function handleOffer(client, msg) {
  if (!client.pc) {
    console.warn(`[${timestamp()}] Offer bez peer connection`);
    return;
  }

  try {
    await client.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    const answer = await client.pc.createAnswer();
    await client.pc.setLocalDescription(answer);

    client.ws.send(JSON.stringify({
      type: 'answer',
      sdp: client.pc.localDescription
    }));

    console.log(`[${timestamp()}] ✓ Answer odeslaná pro ${client.streamId}`);
  } catch (err) {
    console.error(`[${timestamp()}] Chyba offer/answer:`, err);
  }
}

async function handleAnswer(client, msg) {
  // Pro viewer → presenter komunikaci
  const presenter = Array.from(presenters.values())[0];
  if (presenter && presenter.ws.readyState === WebSocket.OPEN) {
    presenter.ws.send(JSON.stringify({
      type: 'answer',
      sdp: msg.sdp
    }));
  }
}

async function handleIceCandidate(client, msg) {
  if (client.pc && msg.candidate) {
    try {
      await client.pc.addIceCandidate(msg.candidate);
    } catch (err) {
      console.error(`[${timestamp()}] ICE error:`, err.message);
    }
  }
}

function startFFmpegBridge(client, stream) {
  console.log(`[${timestamp()}] 🎬 Spouštím FFmpeg bridge: ${client.streamId}`);

  const outputUrl = `${RTMP_OUTPUT_BASE}/${client.streamId}`;

  // FFmpeg příkaz pro WebRTC → RTMP
  const args = [
    '-re',
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', // dummy audio pokud chybí
    '-f', 'rawvideo',
    '-pix_fmt', 'yuv420p',
    '-s', '1280x720',
    '-r', '30',
    '-i', 'pipe:0', // video ze stdin
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '2000k',
    '-maxrate', '2500k',
    '-bufsize', '5000k',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-f', 'flv',
    outputUrl
  ];

  const ffmpeg = spawn('ffmpeg', args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  client.ffmpeg = ffmpeg;

  // Zde by bylo potřeba dostat raw video frames z WebRTC stream
  // a posílat je do ffmpeg.stdin
  // Pro jednoduchost zatím simulujeme

  ffmpeg.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('frame=')) {
      // Progress info (optional)
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${timestamp()}] ⛔ FFmpeg ukončen (${client.streamId}): code ${code}`);
    client.ffmpeg = null;
  });

  console.log(`[${timestamp()}] ✓ FFmpeg běží: ${outputUrl}`);
}

function handleDisconnect(client) {
  console.log(`[${timestamp()}] ⛔ Client odpojený: ${client.id}`);

  if (client.role === 'presenter') {
    // Zastav FFmpeg
    if (client.ffmpeg) {
      client.ffmpeg.kill('SIGTERM');
    }

    // Zavři peer connection
    if (client.pc) {
      client.pc.close();
    }

    presenters.delete(client.id);

    // Notifikuj viewery
    broadcastToViewers({
      type: 'presenter-gone',
      streamId: client.streamId
    });

    console.log(`[${timestamp()}] Presenter odstraněn: ${client.streamId}`);
  }

  if (client.role === 'viewer') {
    viewers.delete(client.id);
  }
}

function broadcastToViewers(msg) {
  const payload = JSON.stringify(msg);
  viewers.forEach((viewer) => {
    if (viewer.ws.readyState === WebSocket.OPEN) {
      viewer.ws.send(payload);
    }
  });
}

function generateId() {
  return Math.random().toString(36).substr(2, 9);
}

function timestamp() {
  return new Date().toISOString().substr(11, 8);
}

// Spuštění serveru
server.listen(PORT, () => {
  console.log(`✅ Server naslouchá na portu ${PORT}\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⛔ Vypínám server...');
  
  // Zavři všechny FFmpeg procesy
  presenters.forEach((p) => {
    if (p.ffmpeg) p.ffmpeg.kill();
    if (p.pc) p.pc.close();
  });

  wss.close();
  server.close(() => {
    process.exit(0);
  });
});
