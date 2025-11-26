@echo off
REM ============================================
REM   MDS STREAMING - STARTUP SCRIPT
REM   VUT FIT - Multimedialní služby 2025
REM ============================================
REM
REM Tento script spustí všechny komponenty:
REM 1. Nginx (RTMP + HTTP/HLS)
REM 2. Signaling Server (WebRTC)
REM 3. Grid Controller (skladani kamer)
REM
REM PŘED SPUŠTĚNÍM:
REM - Upravte cesty níže podle vašeho systému!
REM - Spusťte: npm install
REM ============================================

echo.
echo ========================================
echo   MDS STREAMING - STARTUP
echo ========================================
echo.

REM === KONFIGURACE - UPRAVTE! ===
set NGINX_DIR=C:\Users\Marek\OneDrive - VUT\MDS\mdstesting\projekt_MDS-main\nginx
set NGINX_EXE=%NGINX_DIR%\nginx.exe
set NGINX_CONF=%NGINX_DIR%\conf\nginx.conf

set FFMPEG_EXE=ffmpeg
set NODE_EXE=node

set PROJECT_DIR=%~dp0

REM Kontrola, zda jsou soubory na místě
if not exist "%NGINX_EXE%" (
    echo [ERROR] Nginx nenalezen: %NGINX_EXE%
    echo        Upravte cestu v tomto skriptu!
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%signaling-server.js" (
    echo [ERROR] signaling-server.js nenalezen
    echo        Ujistete se, ze jste ve spravnem adresari!
    pause
    exit /b 1
)

REM === Check Node.js a závislosti ===
echo [INFO] Kontrola Node.js...
%NODE_EXE% --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js nenalezen! Nainstalujte Node.js z nodejs.org
    pause
    exit /b 1
)

if not exist "%PROJECT_DIR%node_modules" (
    echo [WARN] node_modules nenalezeny
    echo        Spoustim: npm install
    cd "%PROJECT_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install selhal!
        pause
        exit /b 1
    )
)

echo [OK] Dependencies v poradku
echo.

REM === Vytvoř temp složky pro HLS ===
if not exist "%NGINX_DIR%\temp\tmp_hls" (
    mkdir "%NGINX_DIR%\temp\tmp_hls"
)

REM === 1. NGINX ===
echo [1/3] Spoustim NGINX...
echo       Port: 8081 (HTTP), 1935/1936 (RTMP)
echo       HLS:  http://localhost:8081/hls/master.m3u8
start "NGINX - MDS" cmd /k "cd /d %NGINX_DIR% && %NGINX_EXE% -c %NGINX_CONF%"
timeout /t 2 /nobreak >nul

REM === 2. SIGNALING SERVER ===
echo [2/3] Spoustim Signaling Server (WebRTC)...
echo       WebSocket: ws://localhost:3000
start "SIGNALING SERVER - MDS" cmd /k "cd /d %PROJECT_DIR% && %NODE_EXE% signaling-server.js"
timeout /t 2 /nobreak >nul

REM === 3. GRID CONTROLLER ===
echo [3/3] Spoustim Grid Controller...
echo       Monitoruje: rtmp://localhost:1936/live/camX
echo       Output:     rtmp://localhost:1936/live/grid
start "GRID CONTROLLER - MDS" cmd /k "cd /d %PROJECT_DIR% && %NODE_EXE% grid-controller.js"
timeout /t 2 /nobreak >nul

echo.
echo ========================================
echo   Vse uspesne spusteno!
echo ========================================
echo.
echo Pristup k webove aplikaci:
echo   http://localhost:8081/index.html
echo.
echo Presenter:
echo   http://localhost:8081/presenter.html
echo.
echo Viewer:
echo   http://localhost:8081/viewer.html
echo.
echo Nginx stats:
echo   http://localhost:8081/stats
echo.
echo Pro vypnuti zavrete vsechna okna terminalu
echo nebo stisknete Ctrl+C v kazdem z nich.
echo.
echo ========================================
echo.

REM === Otevři prohlížeč (optional) ===
set /p OPEN_BROWSER="Otevrit prohlizec? (y/n): "
if /i "%OPEN_BROWSER%"=="y" (
    start http://localhost:8081/index.html
)

pause
