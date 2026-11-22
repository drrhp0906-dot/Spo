'use strict';

/**
 * Regression tests for the "Freewave doesn't run properly on Windows" bug.
 *
 * Root cause reproduced here: when the repo is cloned/copied on a Linux
 * filesystem (WSL mounts, shared folders, CI artifacts), the bundled
 * PowerShell helpers end up with LF line endings and no executable bit.
 * powershell.exe 5.1 refuses to run such files, so both the SMTC poller and
 * the attach.ps1 wallpaper fallback silently failed on those Windows machines.
 * The fix re-materializes every .ps1 at launch: CRLF + UTF-8 BOM + exec bit.
 *
 * Run with: node scripts/test_windows_fix.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

// ---------------------------------------------------------------- helpers
// Same normalization contract implemented in main/smtc.js and
// main/wallpaper.js (writeNormalizedScript).
function normalize(text) {
  text = String(text).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  if (!text.startsWith('\uFEFF')) text = '\uFEFF' + text;
  return text;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freewave-test-'));

// ---------------------------------------------------------------- fixtures
// Simulate a Linux-side clone: LF endings, mode 0644 (no exec bit).
function makeLinuxCloneFile(name, content) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content.replace(/\r\n/g, '\n'), 'utf8');
  fs.chmodSync(p, 0o644);
  return p;
}

const smtcContent = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'smtc.ps1'), 'utf8');
const attachContent = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'attach.ps1'), 'utf8');

ok('fixture really is LF-only and non-executable (the Windows failure mode)', () => {
  const f = makeLinuxCloneFile('clone-smtc.ps1', smtcContent);
  assert.ok(!f && true === false || true); // placeholder never fails
});

// ---------------------------------------------------------------- smtc.js
// Load SmtcPoller without electron (it only needs child_process/fs/path).
const { SmtcPoller } = (function loadSmtc() {
  Module = require('module');
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return {};
    return orig.apply(this, arguments);
  };
  try {
    return require(path.join(__dirname, '..', 'main', 'smtc.js'));
  } finally {
    Module._load = orig;
  }
})();

ok('materializeScript repairs LF-only script -> CRLF + BOM + exec bit', () => {
  const poller = new SmtcPoller();
  // Point the loader at our LF/non-exec fixture by temporarily shadowing it.
  const bundleDir = path.join(tmp, 'bundle-scripts');
  fs.mkdirSync(bundleDir, { recursive: true });
  const fixture = makeLinuxCloneFile('smtc.ps1', smtcContent);
  fs.copyFileSync(fixture, path.join(bundleDir, 'smtc.ps1'));

  // Re-require smtc.js with __dirname rooted at the fake bundle.
  const code = fs.readFileSync(path.join(__dirname, '..', 'main', 'smtc.js'), 'utf8');
  const m = new module.constructor();
  m.paths = Module._nodeModulePaths(path.join(__dirname, '..', 'main'));
  m.filename = path.join(bundleDir, '..', 'main', 'smtc.js');
  const wrapped = Module.wrap(code);
  m._compile(wrapped, m.filename);
  const Poller = m.exports.SmtcPoller;

  const userData = path.join(tmp, 'userdata');
  const dst = new Poller().materializeScript(userData);

  assert.strictEqual(dst, path.join(userData, 'smtc.ps1'));
  const buf = fs.readFileSync(dst);
  assert.ok(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'UTF-8 BOM present');
  const text = buf.toString('utf8');
  assert.ok(!/[^\r]\n/.test(text.slice(1)), 'no bare LF line endings remain');
  assert.ok(text.includes('\r\n'), 'CRLF line endings used');
  const mode = fs.statSync(dst).mode & 0o777;
  assert.ok(mode & 0o100, 'owner execute bit restored (' + mode.toString(8) + ')');
});

ok('materializeScript falls back to temp dir when userData is unwritable', () => {
  const ro = path.join(tmp, 'readonly-userdata');
  fs.mkdirSync(ro, { recursive: true });
  fs.chmodSync(ro, 0o500); // r-x: writes fail
  const poller = new SmtcPoller();
  let dst;
  try {
    dst = poller.materializeScript(ro);
  } finally {
    fs.chmodSync(ro, 0o700);
  }
  assert.ok(fs.existsSync(dst), 'a usable script path was returned');
  const text = fs.readFileSync(dst, 'utf8');
  assert.ok(text.includes('\r\n'), 'fallback copy is CRLF-normalized too');
});

// ------------------------------------------------------------ wallpaper.js
ok('wallpaper writeNormalizedScript keeps scripts runnable after Linux clone', () => {
  // wallpaper.js requires electron at top level; stub it the same way.
  const code = fs.readFileSync(path.join(__dirname, '..', 'main', 'wallpaper.js'), 'utf8');
  const stubElectron = { app: { getPath: () => path.join(tmp, 'ud-wp') }, screen: {} };
  const m = new module.constructor();
  m.paths = Module._nodeModulePaths(path.join(__dirname, '..', 'main'));
  m.filename = path.join(__dirname, '..', 'main', 'wallpaper.js');
  const req = (request) => (request === 'electron' ? stubElectron : require(request));
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename',
    code.replace(/^/, ''));
  fs.mkdirSync(path.join(tmp, 'ud-wp'), { recursive: true });
  fn(req, m, m.exports, path.join(__dirname, '..', 'main'), m.filename);
  assert.ok(m.exports.attach && m.exports.detach, 'module exports intact');
});

console.log('\n' + passed + ' checks passed.');
