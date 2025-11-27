// grid-controller.js
// Spouštěj z adresáře MDS/nginx: node grid-controller.js
// Dynamická mřížka 1–6 kamer s popisky -> RTMP final/257148

const http = require('http');
const { spawn } = require('child_process');

const RTMP_APP_IN = 'live';      // vstupní RTMP app (cam1..cam6)
const RTMP_APP_OUT = 'final';    // výstupní RTMP app (257148)
const RTMP_PORT = 1936;
const HTTP_STATS_URL = 'http://localhost:8081/stats';
const MAX_CAMERAS = 6;
const FFMPEG_PATH = 'ffmpeg';

// TADY SI PŘEPIŠ JMÉNA PODLE SEBE
const NAME_BY_CAM = {
    cam1: 'Martin',
    cam2: 'Mára',
    cam3: 'Libuška',
    cam4: 'Přednášející 4',
    cam5: 'Přednášející 5',
    cam6: 'Přednášející 6'
};

let currentActive = [];
let ffmpegProc = null;
let updateCount = 0;

const POLL_INTERVAL_MS = 5000; // každých 5 s se podíváme na /stats

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║      MDS GRID CONTROLLER - Multi-Camera Composer          ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log('');
console.log('📡 Konfigurace:');
console.log('   • Vstup:    rtmp://localhost:' + RTMP_PORT + '/' + RTMP_APP_IN + '/cam[1-6]');
console.log('   • Výstup:   rtmp://localhost:' + RTMP_PORT + '/' + RTMP_APP_OUT + '/257148');
console.log('   • HLS URL:  http://localhost:8081/hls/index.m3u8');
console.log('   • Polling:  každých ' + (POLL_INTERVAL_MS / 1000) + 's');
console.log('   • Max kamer: ' + MAX_CAMERAS);
console.log('');
console.log('👥 Názvy presenterů:');
for (const [cam, name] of Object.entries(NAME_BY_CAM)) {
    console.log('   • ' + cam + ': ' + name);
}
console.log('');
console.log('🔄 Spouštím grid controller...');
console.log('');

// ----------- čtení /stats -------------

function fetchActiveCams(callback) {
    http.get(HTTP_STATS_URL, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const cams = parseCamsFromStats(data);
            callback(null, cams);
        });
    }).on('error', (err) => {
        console.error('❌ Chyba při čtení /stats:', err.message);
        callback(err, []);
    });
}

function parseCamsFromStats(xmlString) {
    const result = new Set();
    const streamRegex = /<stream>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<\/stream>/g;
    let m;
    while ((m = streamRegex.exec(xmlString)) !== null) {
        const name = m[1].trim();
        if (/^cam[1-6]$/.test(name)) {
            result.add(name);
        }
    }
    return Array.from(result).sort();
}

function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// ---------- pomocná funkce pro text v drawtext ----------

function getLabelForCam(camName) {
    const label = NAME_BY_CAM[camName] || camName;
    return label.replace(/[:'\\]/g, '').replace(/,/g, ' ');
}

// ----------- FFmpeg argy -------------

function buildFfmpegArgs(activeCams) {
    const n = activeCams.length;
    if (n === 0) return null;

    const args = [];

    // vstupy: camX z application "live"
    for (const cam of activeCams) {
        args.push('-i', `rtmp://localhost:${RTMP_PORT}/${RTMP_APP_IN}/${cam}`);
    }

    const filterParts = [];

    // pro každý vstup: scale+pad na 640x360 + drawtext se jménem mluvčího
    for (let i = 0; i < n; i++) {
        const camName = activeCams[i];
        const label = getLabelForCam(camName);

        filterParts.push(
            `[${i}]` +
            `scale=640:360:force_original_aspect_ratio=decrease,` +
            `pad=640:360:(ow-iw)/2:(oh-ih)/2,` +
            `drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':` +
            `text='${label}':` +
            `x=10:y=h-30:` +
            `fontsize=24:fontcolor=white:` +
            `box=1:boxcolor=0x00000099[v${i}]`
        );
    }

    if (n === 1) {
        // 1 kamera -> fullscreen grid (1280x720)
        filterParts.push('[v0]scale=1280:720[vgrid]');
    } else {
        // 2–6 kamer -> mřížka max 3x2 dlaždice (1920x720)
        const tiles = [];
        for (let i = 0; i < n; i++) {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = col * 640;
            const y = row * 360;
            tiles.push(`${x}_${y}`);
        }
        const layoutStr = tiles.join('|');
        const vInputs = Array.from({ length: n }, (_, i) => `[v${i}]`).join('');
        filterParts.push(`${vInputs}xstack=inputs=${n}:layout=${layoutStr}[vgrid]`);
    }

    // audio – mix všech kamer do jedné stopy
    if (n === 1) {
        // audio přímo z prvního vstupu (0:a)
    } else {
        const aInputs = Array.from({ length: n }, (_, i) => `[${i}:a]`).join('');
        filterParts.push(`${aInputs}amix=inputs=${n}:normalize=1[aout]`);
    }

    const filterComplex = filterParts.join(';');
    args.push('-filter_complex', filterComplex);

    if (n === 1) {
        args.push('-map', '[vgrid]', '-map', '0:a');
    } else {
        args.push('-map', '[vgrid]', '-map', '[aout]');
    }

    // enkódování a výstup jako RTMP (final/257148)
    args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-ar', '48000',
        '-ac', '2',
        '-f', 'flv',
        `rtmp://localhost:${RTMP_PORT}/${RTMP_APP_OUT}/257148`
    );

    return args;
}

function getGridLayout(count) {
    if (count === 1) return '1x1 (fullscreen)';
    if (count === 2) return '2x1';
    if (count <= 3) return '3x1';
    if (count <= 6) return '3x2';
    return 'custom';
}

function startFfmpeg(activeCams) {
    const args = buildFfmpegArgs(activeCams);
    if (!args) {
        console.log('⚪ Žádné aktivní kamery → FFmpeg neběží');
        return;
    }

    const layout = getGridLayout(activeCams.length);
    const names = activeCams.map(cam => NAME_BY_CAM[cam] || cam).join(', ');
    
    console.log('');
    console.log('▶️  SPOUŠTÍM FFMPEG GRID:');
    console.log('   📹 Kamery:  ' + activeCams.join(', '));
    console.log('   👥 Jména:   ' + names);
    console.log('   📐 Layout:  ' + layout);
    console.log('   🎬 Výstup:  rtmp://localhost:' + RTMP_PORT + '/final/257148');
    console.log('');

    ffmpegProc = spawn(FFMPEG_PATH, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    // Logovat pouze důležité FFmpeg výstupy
    ffmpegProc.stderr.on('data', (data) => {
        const output = data.toString();
        // Logovat jen chyby a důležité info
        if (output.includes('Error') || output.includes('failed') || output.includes('Invalid')) {
            console.error('❌ FFmpeg error:', output.trim());
        }
    });

    ffmpegProc.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
            console.log('⏹️  FFmpeg ukončen (code=' + code + ', signal=' + signal + ')');
        }
        ffmpegProc = null;
    });
}

function stopFfmpeg() {
    if (ffmpegProc) {
        console.log('⏹️  Zastavuji FFmpeg grid...');
        ffmpegProc.kill('SIGTERM');
        ffmpegProc = null;
    }
}

function updatePipeline(newActive) {
    if (!newActive) newActive = [];
    
    updateCount++;
    
    if (!arraysEqual(currentActive, newActive)) {
        console.log('');
        console.log('🔄 UPDATE #' + updateCount + ' - Změna aktivních kamer:');
        console.log('   Předchozí: [' + (currentActive.length > 0 ? currentActive.join(', ') : 'žádné') + ']');
        console.log('   Nové:      [' + (newActive.length > 0 ? newActive.join(', ') : 'žádné') + ']');
        
        currentActive = newActive.slice();

        stopFfmpeg();

        if (currentActive.length > 0) {
            startFfmpeg(currentActive);
        } else {
            console.log('⚪ Žádné kamery aktivní → grid vypnut');
        }
    } else {
        // Tiché logování bez změny
        process.stdout.write('.');
    }
}

// ----------- hlavní loop -------------

function poll() {
    fetchActiveCams((err, cams) => {
        if (err) {
            console.error('❌ Nepodařilo se načíst aktivní kamery');
        } else {
            const limited = cams.filter((c, idx) => idx < MAX_CAMERAS);
            updatePipeline(limited);
        }
    });
}

// První poll ihned
poll();

// Pak každých X sekund
setInterval(poll, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('');
    console.log('');
    console.log('🛑 Zastavuji grid controller...');
    stopFfmpeg();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('');
    console.log('🛑 Zastavuji grid controller...');
    stopFfmpeg();
    process.exit(0);
});
