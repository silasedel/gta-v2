// Southline desktop app (Electron main process).
// Loads the production web build from local files over app://game/, on the high-performance GPU,
// with no background throttling, a large V8 heap, a crash guard and logs in the user data folder.
// Developer switches (all optional):
//   --ps-web-root=<dir>    serve this build instead of the bundled one
//   --ps-query=<query>     append a query string to the start URL (for example mute)
//   --ps-size=<W>x<H>      start with this content size, windowed (for measurements)
//   --ps-windowed          start windowed even if the last session ended in fullscreen
//   --ps-fullscreen        start in native fullscreen
//   --ps-test-profile      use the separate "Port Solana Test" profile (implied by --ps-size)
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, screen, session, shell, crashReporter } = require('electron');
const log = require('./log.cjs');
const protocolMod = require('./protocol.cjs');
const crashGuard = require('./crashGuard.cjs');

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) {
    return null;
  }
  return hit.slice(prefix.length);
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

// ---------- Chromium switches (must be set before 'ready') ----------
const sw = app.commandLine;
// Discrete / high-performance GPU on dual-GPU Macs and Windows laptops.
sw.appendSwitch('force_high_performance_gpu');
// Use the GPU even where Chromium's blocklist would fall back to software.
sw.appendSwitch('ignore-gpu-blocklist');
sw.appendSwitch('enable-gpu-rasterization');
sw.appendSwitch('enable-zero-copy');
// WebGPU on every platform (on by default on macOS; this also unlocks Windows/Linux adapters).
sw.appendSwitch('enable-unsafe-webgpu');
// Never throttle timers or rAF, even when the window is hidden or covered.
sw.appendSwitch('disable-background-timer-throttling');
sw.appendSwitch('disable-renderer-backgrounding');
sw.appendSwitch('disable-backgrounding-occluded-windows');
sw.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// No autoplay gate for game audio.
sw.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// perf (Nov 19): the game allocates ~100 MB/s while streaming the city, and garbage collection took ~45 % of the main
// thread downtown (CPU profile). A bigger young generation means fewer, cheaper scavenges and fewer objects promoted
// into the old heap (which then needs slow full collections).
// Large V8 heap for the renderer (the browser tab caps lower).
// --ps-js-flags="..." adds V8 flags for measurement runs (A/B of GC settings with the in-game benchmark).
sw.appendSwitch(
  'js-flags',
  ['--max-old-space-size=8192', '--max-semi-space-size=64', argValue('ps-js-flags') || '']
    .join(' ')
    .trim(),
);
if (process.platform === 'darwin') {
  // ANGLE on Metal: Chromium's fastest WebGL path on Apple silicon.
  sw.appendSwitch('use-angle', 'metal');
}

app.setName('Southline');
// Measurement runs (--ps-size) use their own profile, so they never share the single-instance lock,
// window state, saves or logs with the player's copy of the app.
const benchLabel = argValue('ps-bench'); // built-in benchmark (src/perf/bench.v2.js): --ps-bench=<label> [--ps-bench-out=<file.json>] [--ps-bench-stay]
const testProfile = !!argValue('ps-size') || hasArg('ps-test-profile') || !!benchLabel;
if (testProfile) {
  // --ps-profile=<name>: a separate test profile (own single-instance lock and logs), so two measurement runs (A/B
  // builds) can run side by side
  const prof = argValue('ps-profile');
  const dir = prof ? 'Port Solana Test ' + String(prof).replace(/[^\w-]/g, '') : 'Port Solana Test';
  app.setPath('userData', path.join(app.getPath('appData'), dir));
} else {
  // renamed to Southline: keep the saves, settings and window state where earlier builds put them
  app.setPath('userData', path.join(app.getPath('appData'), 'Port Solana'));
}
protocolMod.registerSchemes();

// Local minidumps only (never uploaded): <userData>/Crashpad/.
crashReporter.start({
  uploadToServer: false,
  compress: true,
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

function webRoot() {
  const override = argValue('ps-web-root') || process.env.PS_WEB_ROOT;
  if (override) {
    return path.resolve(override);
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web');
  }
  return path.resolve(__dirname, '..', 'dist', 'web');
}

function startUrl() {
  let q = argValue('ps-query');
  if (benchLabel) {
    q = [q, `bench=${encodeURIComponent(benchLabel)}`, 'nomenu'].filter(Boolean).join('&');
  }
  const base = `${protocolMod.ORIGIN}/index.html`;
  if (!q) {
    return base;
  }
  return `${base}?${q}`;
}

// ---------- window state ----------
function statePath() {
  return path.join(app.getPath('userData'), 'window.json');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch (e) {
    return {};
  }
}

// Measurement runs never overwrite the player's window state.
let saveDisabled = testProfile;

function saveState() {
  if (saveDisabled || !win || win.isDestroyed()) {
    return;
  }
  const fullscreen = win.isFullScreen();
  const state = {
    fullscreen,
    bounds: fullscreen ? readState().bounds : win.getBounds(),
  };
  try {
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch (e) {
    // not fatal
  }
}

// Saved windowed bounds are reused only when they still sit on a display and are a sensible size.
function usableBounds(b) {
  if (!b || !(b.width >= 960) || !(b.height >= 540)) {
    return null;
  }
  const display = screen.getDisplayMatching(b);
  const area = display.workArea;
  const insideX = b.x >= area.x - 40 && b.x + b.width <= area.x + area.width + 40;
  const insideY = b.y >= area.y - 40 && b.y + b.height <= area.y + area.height + 40;
  if (!insideX || !insideY) {
    return null;
  }
  return b;
}

function toggleFullscreen() {
  if (!win || win.isDestroyed()) {
    return;
  }
  win.setFullScreen(!win.isFullScreen());
}

// ---------- menu: app essentials only ----------
function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: 'Southline',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Open Log Folder',
          click: () => shell.openPath(log.dir()),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Full Screen',
          accelerator: 'Ctrl+Cmd+F',
          click: toggleFullscreen,
        },
        {
          label: 'Reload Game',
          accelerator: 'Cmd+Shift+R',
          click: () => win && win.webContents.loadURL(startUrl()),
        },
        {
          label: 'Developer Tools',
          accelerator: 'Alt+Cmd+I',
          click: () => win && win.webContents.toggleDevTools(),
        },
      ],
    },
    {
      role: 'windowMenu',
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- lockdown: this process shows the game and nothing else ----------
function lockDown(ses) {
  const allowed = new Set([
    'pointerLock',
    'fullscreen',
    'clipboard-sanitized-write',
    'persistent-storage',
  ]);
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => allowed.has(permission));
  // Only the game's own files may load. The one exception is the game's web fonts (index.html links
  // Google Fonts); Chromium's HTTP cache keeps them, so later launches work offline too.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const font =
      details.method === 'GET' &&
      (u.startsWith('https://fonts.googleapis.com/') || u.startsWith('https://fonts.gstatic.com/'));
    const ok =
      u.startsWith(protocolMod.ORIGIN + '/') ||
      font ||
      u.startsWith('devtools:') ||
      u.startsWith('data:') ||
      u.startsWith('blob:') ||
      u.startsWith('ws://') ||
      u.startsWith('wss://'); // multiplayer server (?mp=)
    if (!ok) {
      log.info('blocked request ' + u.slice(0, 200));
    }
    cb({ cancel: !ok });
  });
}

function createWindow() {
  const state = readState();
  const area = screen.getPrimaryDisplay().workArea;
  const sizeArg = argValue('ps-size');
  // Default: the whole screen. The game then goes native fullscreen unless the player left it windowed.
  let bounds = {
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  };
  const saved = usableBounds(state.bounds);
  if (saved && !sizeArg) {
    bounds = saved;
  }
  // Only measurement runs ask for an exact content size.
  let useContentSize = false;
  if (sizeArg) {
    const [w, h] = sizeArg.split('x').map(Number);
    bounds = {
      x: area.x + 40,
      y: area.y + 40,
      width: w,
      height: h,
    };
    useContentSize = true;
    saveDisabled = true;
  }
  let startFullscreen = state.fullscreen !== false;
  if (sizeArg || hasArg('ps-windowed')) {
    startFullscreen = false;
  }
  if (hasArg('ps-fullscreen')) {
    startFullscreen = true;
  }

  win = new BrowserWindow({
    ...bounds,
    useContentSize,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#000000',
    title: 'Southline',
    fullscreenable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
      enableWebSQL: false,
      v8CacheOptions: 'bypassHeatCheck',
      zoomFactor: 1.0,
    },
  });

  const wc = win.webContents;
  crashGuard.attach(win, startUrl());

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    if (startFullscreen) {
      win.setFullScreen(true);
    }
  });

  // Page zoom stays at exactly 1 (no Cmd+/- zoom, no pinch zoom), so the canvas maps 1:1 to the window.
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(1);
    wc.setVisualZoomLevelLimits(1, 1).catch(() => {});
  });
  wc.on('zoom-changed', () => {
    wc.setZoomFactor(1);
  });

  // Chromium already fires 'resize' in the page; an extra one after the fullscreen animation settles
  // makes sure the game re-reads the final size.
  let resizeTimer = null;
  const nudgeResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) {
        return;
      }
      wc.executeJavaScript('dispatchEvent(new Event("resize")); 1').catch(() => {});
    }, 250);
  };
  win.on('resize', nudgeResize);
  win.on('enter-full-screen', nudgeResize);
  win.on('leave-full-screen', nudgeResize);
  const logSize = (what) => {
    const [w, h] = win.getContentSize();
    const d = screen.getDisplayMatching(win.getBounds());
    log.info(
      `${what}: content ${w}x${h}, display ${d.size.width}x${d.size.height} @${d.scaleFactor}x ${d.displayFrequency}Hz`,
    );
  };
  win.on('enter-full-screen', () => logSize('fullscreen on'));
  win.on('leave-full-screen', () => logSize('fullscreen off'));
  win.once('show', () => logSize('shown'));

  // F11 toggles native fullscreen everywhere (Cmd+Ctrl+F also works on macOS via the menu).
  wc.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  // No popups, no navigation away from the game.
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, url) => {
    if (!url.startsWith(protocolMod.ORIGIN + '/')) {
      event.preventDefault();
    }
  });

  wc.on('console-message', (...args) => {
    const e = args[0];
    const level = e && e.level !== undefined ? e.level : args[1];
    const message = e && e.message !== undefined ? e.message : args[2];
    if (level === 'error' || level === 3) {
      log.info('console error: ' + String(message).slice(0, 600));
    }
  });

  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('enter-full-screen', saveState);
  win.on('leave-full-screen', saveState);
  win.on('close', saveState);
  win.on('closed', () => {
    win = null;
  });

  wc.loadURL(startUrl());
  if (benchLabel) {
    watchBench(wc);
  }
}

// Benchmark: poll the page for its report, write it, log the summary, quit (unless --ps-bench-stay).
function watchBench(wc) {
  const out =
    argValue('ps-bench-out') ||
    path.join(app.getPath('userData'), 'logs', `bench-${benchLabel}.json`);
  log.info(`bench ${benchLabel} started -> ${out}`);
  const timer = setInterval(async () => {
    if (!win || win.isDestroyed()) {
      clearInterval(timer);
      return;
    }
    let rep = null;
    try {
      rep = await wc.executeJavaScript('window.__benchDone ? window.__benchReport : null');
    } catch (e) {
      return;
    }
    if (!rep) {
      return;
    }
    clearInterval(timer);
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(JSON.parse(rep), null, 1));
    } catch (e) {
      log.info('bench write failed: ' + e.message);
    }
    try {
      const r = JSON.parse(rep);
      const g = r.gate || {};
      log.info(
        `bench ${benchLabel}: p50 ${g.p50} p95 ${g.p95} p99 ${g.p99} max ${g.max} over16.7 ${g.over16_7} over25 ${g.over25} over33 ${g.over33} over50 ${g.over50} over100 ${g.over100} pass ${g.pass} preset ${r.quality && r.quality.preset} canvas ${r.display && r.display.canvas}`,
      );
      for (const sgm of r.segments || []) {
        log.info(
          `bench ${benchLabel} ${sgm.id}: p50 ${sgm.p50} p99 ${sgm.p99} max ${sgm.max} >33 ${sgm.over33} cpuP99 ${sgm.cpuP99} calls ${sgm.calls} gc ${sgm.gc} top ${(
            sgm.sys || []
          )
            .slice(0, 5)
            .map((x) => x.join(' '))
            .join(', ')}`,
        );
      }
      for (const w of (r.worst || []).slice(0, 8)) {
        log.info(
          `bench ${benchLabel} worst ${w.seg} +${w.t}s gap ${w.gap} work ${w.work} prog ${w.newPrograms} gc ${w.gcMB} top ${(w.top || []).map((x) => x.join(' ')).join(', ')}`,
        );
      }
    } catch (e) {
      log.info('bench report unreadable: ' + e.message);
    }
    if (!hasArg('ps-bench-stay')) {
      app.quit();
    }
  }, 2000);
}

function startMemorySampler() {
  setInterval(() => {
    try {
      const metrics = app.getAppMetrics();
      const parts = metrics.map((m) => `${m.type}:${Math.round(m.memory.workingSetSize / 1024)}MB`);
      log.info('memory ' + parts.join(' '));
    } catch (e) {
      // ignore
    }
  }, 60 * 1000).unref();
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) {
      win.restore();
    }
    win.focus();
  }
});

app.whenReady().then(async () => {
  log.init(app.getPath('userData'));
  const root = webRoot();
  log.info(
    `start v${app.getVersion()} electron ${process.versions.electron} chrome ${process.versions.chrome} packaged=${app.isPackaged} webRoot=${root}`,
  );
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    log.crash('missing web build at ' + root);
  }
  protocolMod.handle(root);
  lockDown(session.defaultSession);
  buildMenu();
  // About panel and (unpackaged dev runs) the Dock icon carry the Southline brand
  try {
    app.setAboutPanelOptions({
      applicationName: 'Southline',
      applicationVersion: app.getVersion(),
      copyright: 'Southline',
      credits: 'An original open-world Florida story.',
    });
    if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
      const devIcon = path.join(__dirname, '..', 'build', 'icon.png');
      if (fs.existsSync(devIcon)) app.dock.setIcon(devIcon);
    }
  } catch (e) {
    log.info('about panel / dock icon: ' + e.message);
  }
  createWindow();
  startMemorySampler();
  // GPU feature status is only meaningful once the GPU process has reported in.
  setTimeout(async () => {
    try {
      const gpu = await app.getGPUInfo('basic');
      const devices = (gpu.gpuDevice || []).map(
        (d) => `${d.vendorId}:${d.deviceId}${d.active ? '*' : ''}`,
      );
      log.info(
        'gpu ' + JSON.stringify(app.getGPUFeatureStatus()) + ' devices ' + devices.join(','),
      );
    } catch (e) {
      log.info('gpu info unavailable');
    }
  }, 15000).unref();
});

// Saves live in this profile (<userData>/IndexedDB and Local Storage). Flush them to disk before quitting
// so the last autosave is never lost, and every few minutes in case the app is force-quit.
app.on('before-quit', () => {
  try {
    session.defaultSession.flushStorageData();
  } catch (e) {
    // ignore
  }
});
setInterval(
  () => {
    try {
      session.defaultSession.flushStorageData();
    } catch (e) {
      // ignore
    }
  },
  2 * 60 * 1000,
).unref();

app.on('window-all-closed', () => {
  app.quit();
});
