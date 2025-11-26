// Jednoduchý signaling server pro WebRTC (1 presenter + 1 viewer)
// Používá WebSockety (knihovna "ws")

const WebSocket = require('ws');

const PORT = 3000;
const wss = new WebSocket.Server({ port: PORT });

console.log(`WebRTC signaling server běží na ws://localhost:${PORT}`);

let presenterSocket = null;
let viewerSocket = null;

function safeSend(ws, msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws) => {
    console.log('Nové WebSocket připojení');

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch (e) {
            console.error('Nevalidní JSON:', data.toString());
            return;
        }

        // msg.type: "join", "offer", "answer", "ice"
        switch (msg.type) {
            case 'join':
                if (msg.role === 'presenter') {
                    presenterSocket = ws;
                    console.log('Presenter připojen');
                    safeSend(ws, { type: 'joined', role: 'presenter' });
                    if (viewerSocket) {
                        safeSend(ws, { type: 'peer-ready', peer: 'viewer' });
                        safeSend(viewerSocket, { type: 'peer-ready', peer: 'presenter' });
                    }
                } else if (msg.role === 'viewer') {
                    viewerSocket = ws;
                    console.log('Viewer připojen');
                    safeSend(ws, { type: 'joined', role: 'viewer' });
                    if (presenterSocket) {
                        safeSend(ws, { type: 'peer-ready', peer: 'presenter' });
                        safeSend(presenterSocket, { type: 'peer-ready', peer: 'viewer' });
                    }
                }
                break;

            case 'offer':
                console.log('Přišla offer od prezentera → posílám viewerovi');
                safeSend(viewerSocket, { type: 'offer', sdp: msg.sdp });
                break;

            case 'answer':
                console.log('Přišla answer od viewera → posílám presenterovi');
                safeSend(presenterSocket, { type: 'answer', sdp: msg.sdp });
                break;

            case 'ice':
                if (msg.role === 'presenter') {
                    safeSend(viewerSocket, { type: 'ice', candidate: msg.candidate });
                } else if (msg.role === 'viewer') {
                    safeSend(presenterSocket, { type: 'ice', candidate: msg.candidate });
                }
                break;

            default:
                console.log('Neznámý typ zprávy:', msg);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket se odpojil');
        if (ws === presenterSocket) presenterSocket = null;
        if (ws === viewerSocket) viewerSocket = null;
    });
});
