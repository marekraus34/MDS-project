// --- DOM prvky ---
const preview   = document.getElementById('preview');
const startBtn  = document.getElementById('startBtn');
const stopBtn   = document.getElementById('stopBtn');
const muteBtn   = document.getElementById('muteBtn');
const statusEl  = document.getElementById('status');
const errEl     = document.getElementById('error');
const videoSel  = document.getElementById('videoSelect');
const audioSel  = document.getElementById('audioSelect');
const nameInput = document.getElementById('displayName');
const monitorChk= document.getElementById('monitorChk');
const vuBar     = document.getElementById('vu');
const wrapper = document.getElementById('videoWrapper');

// --- stav ---
let currentStream = null;
let audioMuted = false;

// WebAudio uzly pro monitoring a VU
let audioCtx = null;
let srcNode = null;
let analyser = null;
let monitorGain = null;
let rafId = null;

// --- Pomocné funkce UI ---
function setStatus(text, ok=false) {
    statusEl.textContent = text;
    statusEl.className = 'pill ' + (ok ? 'ok' : '');
}

function stopTracks() {
    if (!currentStream) return;
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
}

// --- Zařízení ---
async function listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoSel.innerHTML = '';
    audioSel.innerHTML = '';

    devices
        .filter(d => d.kind === 'videoinput')
        .forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Kamera ${i+1}`;
            videoSel.appendChild(opt);
        });

    devices
        .filter(d => d.kind === 'audioinput')
        .forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || `Mikrofon ${i+1}`;
            audioSel.appendChild(opt);
        });
}

// --- WebAudio monitoring + VU ---
function ensureAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume?.();
    }
}

function startMeterAndMonitor(stream) {
    ensureAudioContext();
    stopMeterAndMonitor(); // čistý start

    srcNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    monitorGain = audioCtx.createGain();
    monitorGain.gain.value = 1.0;

    // paralelní větev: analyser pro VU + gain pro monitoring do repro
    srcNode.connect(analyser);
    srcNode.connect(monitorGain);

    updateMonitoring();

    const buf = new Uint8Array(analyser.fftSize);
    const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128; // -1..1
            sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length); // 0..~1
        const pct = Math.min(100, Math.round(rms * 150)); // jednoduché škálování
        if (vuBar) vuBar.style.width = pct + '%';
	if (wrapper) {
    	    if (rms > 0.05) {   // práh "mluví"
        	wrapper.classList.add('active');
    	    } else {
        	wrapper.classList.remove('active');
    	    }
	}
        rafId = requestAnimationFrame(tick);
    };
    tick();
}

function stopMeterAndMonitor() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;

    try { monitorGain?.disconnect(); } catch(_) {}
    try { analyser?.disconnect(); } catch(_) {}
    try { srcNode?.disconnect(); } catch(_) {}

    monitorGain = null;
    analyser = null;
    srcNode = null;

    if (vuBar) vuBar.style.width = '0%';
}

function updateMonitoring() {
    if (!monitorGain || !audioCtx) return;
    try { monitorGain.disconnect(); } catch(_) {}
    // Přehrávat do reproduktorů jen pokud je checkbox zaškrtnutý a mikrofon není ztlumený
    if (monitorChk?.checked && !audioMuted) {
        monitorGain.connect(audioCtx.destination);
    }
}

// --- Start/Stop náhledu ---
async function startPreview() {
    errEl.textContent = '';

    const displayName = nameInput.value.trim();
    if (!displayName) {
        errEl.textContent = 'Zadej prosím své jméno (bude se hodit později pro popisek ve videu).';
        return;
    }

    const videoDeviceId = videoSel.value || undefined;
    const audioDeviceId = audioSel.value || undefined;

    const constraints = {
        video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    };

    try {
        stopTracks(); // pro jistotu
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        currentStream = stream;

        // Náhled videa necháme ztlumený, monitoring řeší WebAudio
        preview.srcObject = stream;
        preview.muted = true;
        audioMuted = false;

        // Po získání oprávnění se doplní názvy zařízení
        await listDevices();

        // Spustit VU metr a volitelný monitoring
        startMeterAndMonitor(stream);

        setStatus(`Náhled běží • ${displayName}`, true);
        startBtn.disabled = true;
        stopBtn.disabled = false;
        muteBtn.disabled = false;
        muteBtn.textContent = 'Ztlumit mikrofon';
    } catch (e) {
        console.error(e);
        errEl.textContent = 'Nepodařilo se získat přístup ke kameře/mikrofonu. Zkontroluj oprávnění prohlížeče.';
        setStatus('Chyba přístupu');
    }
}

function stopPreview() {
    stopTracks();
    preview.srcObject = null;
    stopMeterAndMonitor();
    setStatus('Neaktivní');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    muteBtn.disabled = true;
}

// --- Mute/Unmute ---
function toggleMute() {
    if (!currentStream) return;
    const audioTracks = currentStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    audioMuted = !audioMuted;
    audioTracks.forEach(t => t.enabled = !audioMuted);
    muteBtn.textContent = audioMuted ? 'Zapnout mikrofon' : 'Ztlumit mikrofon';

    updateMonitoring(); // aby se monitoring hned přepnul
}

// --- Listeners ---
startBtn.addEventListener('click', startPreview);
stopBtn .addEventListener('click', stopPreview);
muteBtn .addEventListener('click', toggleMute);

monitorChk?.addEventListener('change', () => {
    ensureAudioContext();
    updateMonitoring();
});

// Předvyplnění seznamu zařízení (někdy vyžaduje první gUM, aby byly popisky)
(async () => {
    try {
        const pre = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        pre.getTracks().forEach(t => t.stop());
    } catch(_) { /* uživatel povolí až při Start */ }
    await listDevices();
})();
