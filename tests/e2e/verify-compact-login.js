'use strict';

// Compact login drawer end-to-end smoke (Phase: compact-login).
//
// Boots the REAL backend against an isolated temp data dir, seeds a platform
// admin + a tenant owner via the public user API, then drives the REAL
// platform.html in headless Chromium (global playwright-core + cached
// browser build) through: visitor browsing, drawer open/close, failed login,
// master login -> STAYS in the drawer with the Google link section revealed
// -> app entry through the existing «فتح البرنامج» link -> Master nav
// visibility inside index.html,
// tenant-owner landing without Master UI, logout clearing credentials, and a
// mobile-viewport pass. No production data, no real credentials — every
// account is created fresh inside the temp dir, which is removed afterwards.
//
// Usage: node tests/e2e/verify-compact-login.js [port]
// Exit code is nonzero when any check fails.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.argv[2] || '18943', 10);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + String(detail).slice(0, 200) : ''));
}

function dataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compact-login-e2e-'));
}

function postJSON(port, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: Object.assign(
        { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        token ? { Authorization: 'Bearer ' + token } : {}
      )
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function main() {
  const dir = dataDir();
  let server = null;
  let browser = null;
  try {
    process.env.DIGITRONICS_DATA_DIR = dir;
    process.env.JWT_SECRET = 'compact-login-e2e-secret';
    process.env.PLATFORM_ADMINS = 'e2emaster';
    delete process.env.AUTH_REQUIRED;
    const app = require('../../backend/server.js');

    server = await new Promise((resolve, reject) => {
      const s = app.listen(PORT, () => resolve(s));
      s.on('error', reject);
    });

    const base = 'http://127.0.0.1:' + PORT;
    const created = await postJSON(PORT, '/api/v1/users', {
      username: 'e2emaster', password: 'Master#123', fullName: 'E2E Master', role: 'Owner'
    });
    check('seed platform admin account via public API', created.status === 201, 'status=' + created.status);
    const createdOwner = await postJSON(PORT, '/api/v1/users', {
      username: 'e2eowner', password: 'Owner#1234', fullName: 'E2E Owner', role: 'Owner'
    });
    check('seed tenant owner account via public API', createdOwner.status === 201, 'status=' + createdOwner.status);

    const pw = require('C:/Users/hp/AppData/Roaming/npm/node_modules/playwright-core');
    const exe = 'C:/Users/hp/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe';
    const launchOpts = fs.existsSync(exe) ? { executablePath: exe } : {};
    browser = await pw.chromium.launch(Object.assign({ headless: true }, launchOpts));

    const errors = [];
    const benignErrors = [];
    async function newPage() {
      const page = await browser.newPage();
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = String(m.text());
        // Known-benign environment noise in the temp backend (missing favicon,
        // unconfigured Supabase self-check, failed-dependency resource logs):
        // recorded visibly, never counted as product breakage.
        if (/favicon|supabase|Failed to load resource/i.test(text)) {
          benignErrors.push('benign-console: ' + text.slice(0, 160));
          return;
        }
        errors.push('console: ' + text);
      });
      return page;
    }

    // ---- visitor browsing: page usable, drawer closed, no auto navigation ----
    {
      const page = await newPage();
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      check('visitor: homepage renders with nav', await page.evaluate(() => !!document.querySelector('.glass-nav')));
      check('visitor: drawer starts hidden', await page.evaluate(() => {
        const d = document.getElementById('platformAuthDrawer');
        return d && d.hasAttribute('hidden');
      }));
      check('visitor: still on platform.html (no auto redirect)', page.url().endsWith('/platform.html'));
      await page.close();
    }

    // ---- drawer mechanics + failed login ----
    {
      const page = await newPage();
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.click('#platformLoginBtn');
      await page.waitForSelector('#platformAuthDrawer:not([hidden])', { timeout: 5000 });
      check('drawer: opens on button click', true);
      const box = await page.locator('#platformAuthDrawer').boundingBox();
      const vw = page.viewportSize();
      check('drawer: compact overlay fits viewport', !!box && box.width <= vw.width && box.width < 500, 'w=' + (box && box.width));
      await page.fill('#platformAuthUser', 'nobody-here');
      await page.fill('#platformAuthPass', 'wrong-password');
      await page.click('#platformAuthSubmit');
      await page.waitForSelector('#platformAuthError:not([hidden])', { timeout: 8000 });
      check('drawer: bad credentials show a safe error', true);
      const tokenAfterFail = await page.evaluate(() => localStorage.getItem('access_token'));
      check('drawer: failed login stores no token and stays put',
        !tokenAfterFail && page.url().endsWith('/platform.html'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const d = document.getElementById('platformAuthDrawer');
        return d && d.hasAttribute('hidden');
      }, null, { timeout: 5000 });
      check('drawer: escape closes and restores browsing', page.url().endsWith('/platform.html'));
      await page.close();
    }

    // ---- master login: STAYS in the homepage drawer so the Google link
    //      flow is reachable, then enters the app through the existing entry ----
    {
      const page = await newPage();
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.click('#platformLoginBtn');
      await page.fill('#platformAuthUser', 'e2emaster');
      await page.fill('#platformAuthPass', 'Master#123');
      await page.click('#platformAuthSubmit');
      // Master password login must NOT navigate away: the session-gated
      // Google link section + step-up live in this drawer, and opening
      // /index.html manually must never be a prerequisite for linking.
      await page.waitForFunction(() => {
        const s = document.getElementById('platformAuthGoogleLinkSection');
        return s && !s.hasAttribute('hidden');
      }, null, { timeout: 20000 });
      check('master: login stays on the homepage and reveals the Google link section',
        page.url().endsWith('/platform.html'), 'url=' + page.url());
      const guidance = await page.evaluate(() => {
        const el = document.getElementById('platformAuthError');
        return el && !el.hasAttribute('hidden') ? String(el.textContent || '') : '';
      });
      check('master: post-login guidance message is visible',
        guidance.indexOf('ربط حساب Google') !== -1, guidance);
      // Enter the app through the existing «فتح البرنامج» nav entry: the
      // one-shot key recorded at login must still land the Master on the
      // Master Control Center behind index.html's own canAccessPage gate.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        const d = document.getElementById('platformAuthDrawer');
        return d && d.hasAttribute('hidden');
      }, null, { timeout: 5000 });
      await Promise.all([
        page.waitForURL('**/index.html', { timeout: 20000 }),
        page.click('a[href="index.html"]')
      ]);
      check('master: existing app-entry link reaches the app', page.url().endsWith('/index.html'));
      // Session restore is asynchronous (auth.me + role hydration): only once
      // the Master nav is revealed has the restore chain necessarily run, so
      // the one-shot key must be gone by then — never before.
      await page.waitForFunction(() => {
        const el = document.getElementById('platformMasterNav');
        return el && getComputedStyle(el).display !== 'none';
      }, null, { timeout: 25000 });
      check('master: Master nav visible inside the app', true);
      const key = await page.evaluate(() => { try { return sessionStorage.getItem('__omniPostLoginPage'); } catch (_) { return null; } });
      check('master: one-shot redirect key consumed (not lingering)', key === null);
      await page.close();
    }

    // ---- tenant owner: lands without Master UI ----
    {
      const page = await newPage();
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.click('#platformLoginBtn');
      await page.fill('#platformAuthUser', 'e2eowner');
      await page.fill('#platformAuthPass', 'Owner#1234');
      await Promise.all([
        page.waitForURL('**/index.html', { timeout: 20000 }),
        page.click('#platformAuthSubmit')
      ]);
      await page.waitForTimeout(4000);
      const masterVisible = await page.evaluate(() => {
        const el = document.getElementById('platformMasterNav');
        return !!(el && getComputedStyle(el).display !== 'none');
      });
      check('tenant: no Master nav for a non-platform account', masterVisible === false);
      await page.close();
    }

    // ---- logout clears credentials ----
    {
      const page = await newPage();
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.evaluate(() => {
        localStorage.setItem('access_token', 'STALE');
        localStorage.setItem('refresh_token', 'STALE');
      });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#platformLoginBtn', { timeout: 10000 });
      console.log('LOGOUT-DIAG btn-visible, clicking');
      await page.click('#platformLoginBtn', { timeout: 10000 });
      console.log('LOGOUT-DIAG drawer state: ' + await page.evaluate(() => {
        const d = document.getElementById('platformAuthDrawer');
        const l = document.getElementById('platformAuthLogout');
        return 'drawerHidden=' + (d && d.hasAttribute('hidden')) +
          ' logoutHidden=' + (l && l.hasAttribute('hidden')) +
          ' logoutVisible=' + (l ? getComputedStyle(l).display : 'NO_EL');
      }));
      await page.click('#platformAuthLogout', { timeout: 10000 });
      await page.waitForTimeout(800);
      const leftovers = await page.evaluate(() => ({
        a: localStorage.getItem('access_token'),
        r: localStorage.getItem('refresh_token')
      }));
      check('logout: every credential cleared from storage',
        !leftovers.a && !leftovers.r, JSON.stringify(leftovers));
      await page.close();
    }

    // ---- mobile viewport ----
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push('pageerror(mobile): ' + e.message));
      await page.goto(base + '/platform.html', { waitUntil: 'load' });
      await page.click('#platformLoginBtn');
      await page.waitForSelector('#platformAuthDrawer:not([hidden])', { timeout: 5000 });
      const box = await page.locator('#platformAuthDrawer').boundingBox();
      check('mobile: drawer fits a 390px viewport', !!box && box.width <= 390, 'w=' + (box && box.width));
      await ctx.close();
    }

    check('no page JS errors across the whole run', errors.length === 0, errors.slice(0, 3).join('; '));
    if (benignErrors.length) console.log('BENIGN-ENV-NOISE | ' + benignErrors.slice(0, 4).join(' ;; '));
  } finally {
    try { browser && await browser.close(); } catch (_) {}
    try { server && await new Promise((r) => server.close(r)); } catch (_) {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

main().then(() => {
  const failed = results.filter((r) => !r.ok);
  console.log('verify-compact-login: ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed');
  process.exitCode = failed.length ? 1 : 0;
}).catch((err) => {
  console.error('FATAL | ' + (err && err.stack || err));
  process.exitCode = 2;
});
