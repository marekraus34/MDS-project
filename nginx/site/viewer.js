<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <title>MDS – Viewer</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <!-- Bootstrap 5 -->
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <script type="module" src="https://cdn.jsdelivr.net/npm/hls-video-element@1.2/+esm"></script>

    <style>
        body {
            background: #0f172a; /* dark navy */
            color: #e5e7eb;
        }
        .navbar {
            box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        }
        .card {
            box-shadow: 0 2px 10px rgba(0,0,0,0.35);
            border-radius: 1rem;
            border: 1px solid #1e293b;
            background: #020617;
            color: #e5e7eb;
        }
        .card-header {
            border-radius: 1rem 1rem 0 0 !important;
            background: #020617;
            border-bottom: 1px solid #1e293b;
        }
        .vjs-control-bar {
            font-size: 14px !important;
        }
        #qualityLabel {
            font-size: 0.9rem;
            color: #9ca3af;
        }
        .presenter-badge {
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #22c55e;
            display: inline-block;
            margin-right: 6px;
        }
        .monospace {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
    </style>
</head>

<body>

<nav class="navbar navbar-dark bg-dark mb-4">
    <div class="container-fluid">
        <span class="navbar-brand mb-0 h1">MDS – Divák</span>
        <span id="viewerStatus" class="badge bg-secondary">Nepřihlášen</span>
    </div>
</nav>

<div class="container">

    <div class="row">
        <!-- Player card -->
        <div class="col-lg-8 mb-4">
            <div class="card p-3">

                <h4 class="mb-3">Živý stream</h4>

                <media-controller>
                <hls-video
                    src="http://localhost:8081/hls/master.m3u8"
                    slot="media"
                    crossorigin
                    muted
                ></hls-video>
                <media-loading-indicator slot="centered-chrome" noautohide></media-loading-indicator>
                <media-control-bar>
                    <media-play-button></media-play-button>
                    <media-seek-backward-button></media-seek-backward-button>
                    <media-seek-forward-button ></media-seek-forward-button>
                    <media-mute-button></media-mute-button>
                    <media-volume-range></media-volume-range>
                    <media-time-range></media-time-range>
                    <media-time-display showduration remaining></media-time-display>
                    <media-playback-rate-button></media-playback-rate-button>
                    <media-fullscreen-button></media-fullscreen-button>
                </media-control-bar>
                </media-controller>

                <div class="mt-3">
                    <div class="d-flex justify-content-between align-items-center">

                        <div>
                            <button id="btnLive" class="btn btn-danger btn-sm">ŽIVĚ</button>
                            <button id="btnBack30" class="btn btn-secondary btn-sm">⏪ -30s</button>
                            <button id="btnBack5min" class="btn btn-secondary btn-sm">⏪ -5min</button>
                        </div>

                        <div class="d-flex align-items-center">
                            <label class="me-2">Kvalita:</label>
                            <select id="qualitySelect" class="form-select form-select-sm" style="width: 110px;">
                                <option value="auto">Auto</option>
                            </select>
                        </div>
                    </div>

                    <div id="qualityLabel" class="mt-2">(čekám na stream…)</div>
                    <div id="viewerError" class="text-danger mt-2"></div>
                </div>

            </div>
        </div>

        <div class="card p-3 mt-4">
            <h5>WebRTC (přímé spojení s presenterem)</h5>
                <p class="small text-muted">
                    Toto je separátní demo: video jde přímo z <b>presentera</b> do <b>viewera</b> (WebRTC).
                </p>

                <video
                    id="webrtcPlayer"
                    autoplay
                    playsinline
                    controls
                    style="width: 100%; max-width: 640px; background: #000;"
                ></video>

                <p class="small text-muted mt-2">
                    Připojení se naváže po přihlášení diváka a spuštění náhledu na stránce presentera.
                </p>
        </div>

        <!-- Pravý sloupec: login + seznam přednášejících + nastavení streamu -->
        <div class="col-lg-4">

            <!-- „Login“ diváka -->
            <div class="card p-3 mb-4">
                <h5>Přihlášení diváka</h5>
                <div class="mb-3">
                    <label class="form-label">Jméno:</label>
                    <input id="viewerName" type="text" class="form-control" placeholder="Např. Martin">
                </div>
                <div class="mb-3">
                    <label class="form-label">Kód místnosti:</label>
                    <input id="viewerCode" type="password" class="form-control" placeholder="Např. mds2025">
                    <div class="form-text text-muted">Demo kód: <span class="monospace">mds2025</span></div>
                </div>
                <button id="joinBtn" class="btn btn-primary w-100">Přihlásit</button>
                <div id="loginError" class="text-danger small mt-2"></div>
            </div>
                    <!-- WebRTC P2P náhled (demo) -->
            <div class="col-lg-8 mb-4">
                <div class="card p-3 mt-2">
                    <h4 class="mb-3">WebRTC (přímé spojení s presenterem)</h4>
                    <p class="small text-muted mb-2">
                        Toto je separátní demo: video jde přímo z <strong>presentera</strong> do <strong>viewera</strong> (WebRTC).
                        HLS výše je přes Nginx/FFmpeg.
                    </p>
                    <video id="webrtcRemote"
                        class="w-100 rounded"
                        playsinline
                        autoplay
                        controls></video>
                    <div class="mt-2 small text-muted">
                        Připojení se naváže po přihlášení diváka a připojení presentera.
                    </div>
                </div>
            </div>

            <!-- Přednášející -->
            <div class="card p-3 mb-4">
                <h5>Přednášející (podle /stats)</h5>
                <div id="presenterList" class="mt-2 small">
                    (Čekám na data ze /stats…)
                </div>
            </div>

            <!-- Nastavení streamu -->
            <div class="card p-3">
                <h5>Nastavení streamu</h5>

                <div class="mt-3">
                    <label class="form-label">Zdroj streamu:</label>
                    <select id="streamSelect" class="form-select">
                        <option value="multi">Multi (master.m3u8)</option>
                        <option value="single">Single (stream.m3u8)</option>
                    </select>
                </div>

                <button id="playBtn" class="btn btn-success mt-3 w-100">Přehrát</button>
                <button id="stopBtn" class="btn btn-outline-danger mt-2 w-100">Stop</button>
            </div>
        </div>

    </div>

</div>

<!-- Bootstrap JS -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>

<!-- Video.js -->
<script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>

<!-- Hls.js (klidně tu může zůstat, i když aktuální kód ho přímo nepoužívá) -->
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>

<!-- Tvůj JS -->
<script src="./viewer.js"></script>

</body>
</html>
