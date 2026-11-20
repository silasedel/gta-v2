import * as _cp from 'node:child_process';
// V2 test browser: the ONLY way V2 agents may drive a browser.
// - Own muted, isolated headless Chrome with a fresh temp profile and a random debugging port (never 9222/9333).
// - Machine-wide semaphore (2 slots) so parallel agents never run more than two Chromes at once (the user is filming v1).
// - Hard watchdog: Chrome, the profile and the slot are always cleaned up, even on crash or timeout.
// Usage:
//   import { withBrowser } from '../../tools/v2/browser.mjs';
//   await withBrowser({ width: 1280, height: 720, maxSeconds: 240 }, async (b) => {
//     await b.goto('http://127.0.0.1:5200/src/foo/preview.html');
//     await b.waitFor('window.ready === true', 60);
//     const v = await b.eval('JSON.stringify(window.stats)');
//     await b.screenshot('docs/v2/shots/foo.png');
//     if (b.errors.length) console.log('CONSOLE ERRORS', b.errors);
//   });
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOCK_DIR = path.join(os.tmpdir(), 'port-solana-v2-browser');
// user (Nov 19): testing made the Mac unusable (load 50-100). One test browser at a time, always.
const SLOTS = 1;
const STALE_MS = 50 * 60 * 1000; // a live owner keeps its slot (12 min let long runs lose it, so 4+ Chromes ran at once)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function acquireSlot(waitSeconds = 1500) {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  const t0 = Date.now();
  let told = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const d = path.join(LOCK_DIR, `slot${i}`);
      try {
        fs.mkdirSync(d);
        fs.writeFileSync(path.join(d, 'pid'), String(process.pid));
        return d;
      } catch (e) {
        // stale slot? (owner dead, or far too old)
        try {
          const pid = Number(fs.readFileSync(path.join(d, 'pid'), 'utf8'));
          const age = Date.now() - fs.statSync(d).mtimeMs;
          if (!pidAlive(pid) || age > STALE_MS) fs.rmSync(d, { recursive: true, force: true });
        } catch (e2) {
          try {
            if (Date.now() - fs.statSync(d).mtimeMs > 5000)
              fs.rmSync(d, { recursive: true, force: true });
          } catch (e3) {
            /* */
          }
        }
      }
    }
    if (!told) {
      console.error('[v2 browser] waiting for a free browser slot...');
      told = true;
    }
    if (Date.now() - t0 > waitSeconds * 1000) throw new Error('no free browser slot');
    await sleep(1500 + Math.random() * 1000);
  }
}

// Kill test browsers whose node script died without cleaning up (a killed script leaves Chrome running under
// launchd, and those kept burning CPU for hours).
function reapOrphanBrowsers() {
  const rows = execSyncSafe('ps -axo pid=,ppid=,command=').split('\n');
  for (const row of rows) {
    const m = row.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, cmd] = m;
    if (ppid !== '1' || !cmd.includes('--headless=new') || !cmd.includes('ps-v2-chrome-')) continue;
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch (e) {
      /* */
    }
  }
}

function execSyncSafe(cmd) {
  try {
    return String(_cp.execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32e6 }));
  } catch (e) {
    return '';
  }
}
export async function withBrowser(opts, fn) {
  if (typeof opts === 'function') {
    fn = opts;
    opts = {};
  }
  const { width = 1280, height = 720, maxSeconds = 240, extraArgs = [] } = opts || {};
  reapOrphanBrowsers();
  const slot = await acquireSlot();
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-v2-chrome-'));
  const chrome = spawn(
    'nice',
    [
      '-n',
      '15',
      CHROME,
      '--headless=new',
      '--mute-audio',
      `--user-data-dir=${prof}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      `--window-size=${width},${height}`,
      '--hide-scrollbars',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      ...extraArgs,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      chrome.kill('SIGKILL');
    } catch (e) {
      /* */
    }
    try {
      spawn('pkill', ['-9', '-f', prof], { stdio: 'ignore' });
    } catch (e) {
      /* */
    }
    try {
      fs.rmSync(slot, { recursive: true, force: true });
    } catch (e) {
      /* */
    }
    // delete the profile now (a delayed timer never fires when the process is exiting), then again shortly after
    // in case Chrome was still flushing files. Leaked profiles once filled ~128 GB of the user's disk.
    try {
      fs.rmSync(prof, { recursive: true, force: true });
    } catch (e) {
      /* */
    }
    setTimeout(() => {
      try {
        fs.rmSync(prof, { recursive: true, force: true });
      } catch (e) {
        /* */
      }
    }, 400).unref?.();
  };
  // sweep profiles leaked by earlier runs: any ps-v2-chrome-* older than 20 min that no running Chrome uses
  try {
    const live = execSyncSafe('ps -axo command');
    for (const n of fs.readdirSync(os.tmpdir())) {
      if (!n.startsWith('ps-v2-chrome-') || path.join(os.tmpdir(), n) === prof || live.includes(n))
        continue;
      const d = path.join(os.tmpdir(), n);
      try {
        if (Date.now() - fs.statSync(d).mtimeMs > 20 * 60e3)
          fs.rmSync(d, { recursive: true, force: true });
      } catch (e) {
        /* */
      }
    }
  } catch (e) {
    /* */
  }
  const onSig = () => {
    cleanup();
    process.exit(130);
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
  process.on('SIGHUP', onSig);
  process.on('SIGALRM', onSig); // perl alarm time limits
  process.on('exit', cleanup);
  const dog = setTimeout(() => {
    console.error(`[v2 browser] watchdog: exceeded ${maxSeconds}s, killing Chrome`);
    cleanup();
    process.exit(2);
  }, maxSeconds * 1000);

  let ws,
    id = 0,
    port = 0;
  const pending = new Map();
  const errors = [],
    logs = [],
    listeners = [];
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  try {
    for (let i = 0; i < 120 && !port; i++) {
      try {
        port = Number(
          fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0],
        );
      } catch (e) {
        await sleep(250);
      }
    }
    if (!port) throw new Error('Chrome did not start');
    for (let i = 0; i < 60 && !ws; i++) {
      try {
        const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const pg = l.find((t) => t.type === 'page');
        if (pg) {
          ws = new WebSocket(pg.webSocketDebuggerUrl);
          await new Promise((r, j) => {
            ws.onopen = r;
            ws.onerror = j;
          });
        }
      } catch (e) {
        ws = null;
        await sleep(200);
      }
    }
    if (!ws) throw new Error('could not attach to Chrome');
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) {
        pending.get(d.id)(d);
        pending.delete(d.id);
        return;
      }
      if (d.method)
        for (const f of listeners) {
          try {
            f(d.method, d.params);
          } catch (e) {
            /* listener bug */
          }
        }
      if (d.method === 'Runtime.exceptionThrown')
        errors.push(
          'EXC ' +
            (
              d.params.exceptionDetails?.exception?.description ||
              d.params.exceptionDetails?.text ||
              ''
            ).slice(0, 500),
        );
      else if (d.method === 'Runtime.consoleAPICalled') {
        const txt = (d.params.args || [])
          .map((a) => a.value ?? a.description ?? '')
          .join(' ')
          .slice(0, 500);
        if (d.params.type === 'error') errors.push('ERR ' + txt);
        else if (logs.length < 400) logs.push(`${d.params.type}: ${txt}`);
      } else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error')
        errors.push('LOG ' + `${d.params.entry.text} ${d.params.entry.url || ''}`.slice(0, 500));
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    // tests never hot-reload: several helpers save files at once, and a Vite full reload mid-test ruins the run. The Vite
    // client's socket is replaced by a fake one that opens and then stays silent (no 'close', so no reconnect polling).
    if (!process.env.V2_ALLOW_HMR)
      await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { const W = window.WebSocket;
      window.WebSocket = function (url, proto) { const p = [].concat(proto || []); if (!p.some((x) => /^vite-/.test(x))) return new W(url, proto);
        const f = new EventTarget(); f.readyState = 1; f.url = url; f.protocol = p[0]; f.send = () => {}; f.close = () => {};
        setTimeout(() => { f.dispatchEvent(new Event('open')); f.onopen?.(new Event('open')); }, 0); return f; };
      Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket.prototype = W.prototype; })();`,
      });
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const api = {
      errors,
      logs,
      sleep,
      send,
      // raw CDP events: b.on((method, params) => ...) (r2-web: Network.* for the load profiler)
      on(fn) {
        listeners.push(fn);
      },
      async goto(url) {
        await send('Page.navigate', { url });
        await sleep(300);
      },
      async eval(expr, timeoutMs = 120000) {
        const r = await send('Runtime.evaluate', {
          expression: expr,
          awaitPromise: true,
          returnByValue: true,
          timeout: timeoutMs,
        });
        if (r.result?.exceptionDetails)
          throw new Error(
            'page eval failed: ' +
              JSON.stringify(
                r.result.exceptionDetails.exception?.description || r.result.exceptionDetails,
              ).slice(0, 800),
          );
        return r.result?.result?.value;
      },
      async waitFor(expr, seconds = 120) {
        for (let i = 0; i < seconds * 2; i++) {
          try {
            if (await api.eval(`!!(${expr})`, 5000)) return true;
          } catch (e) {
            /* page not ready yet */
          }
          await sleep(500);
        }
        throw new Error(`waitFor timed out after ${seconds}s: ${expr}`);
      },
      async screenshot(file, { format, quality = 90, clip } = {}) {
        const fmt =
          format || (/\.jpe?g$/i.test(file) ? 'jpeg' : /\.webp$/i.test(file) ? 'webp' : 'png');
        const p = { format: fmt };
        if (fmt !== 'png') p.quality = quality;
        if (clip) p.clip = { ...clip, scale: 1 };
        const r = await send('Page.captureScreenshot', p);
        if (!r.result?.data) throw new Error('screenshot failed');
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
        return file;
      },
      async key(code, down = true, key = '') {
        await send('Input.dispatchKeyEvent', {
          type: down ? 'keyDown' : 'keyUp',
          code,
          key: key || code.replace(/^Key|^Digit/, '').toLowerCase(),
          windowsVirtualKeyCode: 0,
        });
      },
      async click(x, y) {
        for (const type of ['mousePressed', 'mouseReleased'])
          await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      },
      async resize(w, h) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: 1,
          mobile: false,
        });
      },
    };
    return await fn(api);
  } finally {
    clearTimeout(dog);
    try {
      ws?.close();
    } catch (e) {
      /* */
    }
    cleanup();
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
}

// Helpers for full-game tests (http://127.0.0.1:5200/?mute or a production preview).
export const GAME_READY = `window.game && game.ready === true && game.v2`;

// Stage 1: leave the title screen the way a player does (Enter, Enter) and wait until gameplay is live, so the title
// cinematic no longer moves the player or sets the hour. Returns true when game.ui.title is false.
export async function startGame(b, seconds = 120) {
  await b.waitFor(GAME_READY, 480);
  for (let i = 0; i < seconds; i++) {
    if (await b.eval('!(game.ui && game.ui.title)')) {
      await b.sleep(1500);
      return true;
    }
    if (i % 3 === 0) {
      await b.key('Enter', true, 'Enter');
      await b.key('Enter', false, 'Enter');
    }
    await b.sleep(1000);
  }
  return false;
}
