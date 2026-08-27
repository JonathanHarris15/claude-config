#!/usr/bin/env node
/**
 * Make the board work on this machine.
 *
 * The repo syncs source, never build output: `out/` and `node_modules/` are in
 * the ignore list on purpose, because they are per-machine. So a fresh clone
 * has every file the board needs and still does nothing, and a `git pull` that
 * changes one TypeScript file leaves the editor running yesterday's build.
 * This closes that gap: install, compile, link into VS Code.
 *
 * Idempotent and quiet. Run it as often as you like — when there is nothing to
 * do it says so and exits. It never touches logins, settings, or the network
 * beyond npm, because those need the human. What it cannot do it names at the
 * end, pointing at SETUP.md.
 *
 *   node setup.js            build and link, report what a human still owes
 *   node setup.js --check    report only, change nothing; exit 1 if work is due
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const here = __dirname;
const checkOnly = process.argv.includes('--check');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const todo = [];   // what a human has to finish
let did = 0;       // what this run actually changed
let failed = false;

function say(line) {
  process.stdout.write(line + '\n');
}

/** Newest mtime under a directory, skipping the two we never build from. */
function newest(dir) {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'out') {
      continue;
    }
    const full = path.join(dir, entry.name);
    const stamp = entry.isDirectory() ? newest(full) : fs.statSync(full).mtimeMs;
    if (stamp > latest) {
      latest = stamp;
    }
  }
  return latest;
}

function mtime(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function run(label, args) {
  if (checkOnly) {
    say(`due: ${label}`);
    failed = true;
    return false;
  }
  say(`${label}...`);
  const result = spawnSync(npm, args, { cwd: here, stdio: 'inherit' });
  if (result.status !== 0) {
    say(`FAILED: npm ${args.join(' ')} exited ${result.status}`);
    failed = true;
    return false;
  }
  did += 1;
  return true;
}

/* ---------- 0. node itself ---------- */

const major = Number(process.versions.node.split('.')[0]);
if (major < 20) {
  say(`Node ${process.versions.node} is too old — the extension and the Claude`);
  say('Agent SDK both need 20 or newer. Install the LTS from https://nodejs.org');
  process.exit(1);
}

/* ---------- 1. dependencies ---------- */

// package-lock newer than the installed tree means the lock moved in a pull.
const deps = path.join(here, 'node_modules');
if (!fs.existsSync(deps)) {
  run('installing dependencies', ['install']);
} else if (mtime(path.join(here, 'package-lock.json')) > mtime(deps)) {
  run('dependencies are behind the lockfile, reinstalling', ['install']);
} else {
  say('ok  dependencies');
}

/* ---------- 2. build ---------- */

const built = mtime(path.join(here, 'out', 'extension.js'));
if (!failed) {
  if (!built) {
    run('compiling for the first time', ['run', 'compile']);
  } else if (newest(path.join(here, 'src')) > built) {
    run('source is newer than the build, recompiling', ['run', 'compile']);
  } else {
    say('ok  build');
  }
}

/* ---------- 3. the link VS Code loads the extension through ---------- */

// Not packaged: VS Code reads this folder directly, so pull + compile is the
// whole upgrade. Windows gets a junction, which needs no administrator.
const link = path.join(os.homedir(), '.vscode', 'extensions', 'board-extension');

function linkState() {
  try {
    return fs.realpathSync(link) === fs.realpathSync(here) ? 'ours' : 'foreign';
  } catch {
    return 'missing';
  }
}

const state = linkState();
if (state === 'ours') {
  say('ok  linked into VS Code');
} else if (state === 'foreign') {
  // Replacing someone else's extension without asking is not this script's call.
  say(`warn  ${link} exists and points somewhere else`);
  todo.push(`Decide what to do with ${link} — it is not this folder.`);
} else if (checkOnly) {
  say('due: link into VS Code');
  failed = true;
} else {
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(here, link, process.platform === 'win32' ? 'junction' : 'dir');
    say('linked into VS Code');
    did += 1;
  } catch (err) {
    say(`FAILED: could not link ${link} — ${err.message}`);
    failed = true;
  }
}

/* ---------- 4. what only the human can do ---------- */

const settings = process.platform === 'win32'
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'settings.json')
  : process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json')
    : path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json');

let repos = '';
try {
  repos = fs.readFileSync(settings, 'utf8');
} catch {
  // No settings file yet is itself the answer.
}
function foundTwg() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const places = process.platform === 'win32'
    ? [path.join(local, 'Programs', 'twg', 'bin', 'twg.exe')]
    : [
        path.join(os.homedir(), '.local', 'bin', 'twg'),
        '/usr/local/bin/twg',
        '/opt/homebrew/bin/twg'
      ];
  return places.some((place) => fs.existsSync(place));
}

// Cheap presence checks. Being installed is not being logged in, and this
// script deliberately does not try to log anything in.
for (const [cmd, why] of [
  ['claude', 'the SDK spawns Claude Code to run every agent'],
  ['twg', 'every JIRA read and write goes through it'],
  ['gh', 'the merge queue reads pull requests with it']
]) {
  if (spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: true }).status === 0) {
    continue;
  }
  // twg is usually installed somewhere off PATH, so the extension keeps a list
  // of where to look. Check the same places, or this nags on a machine where
  // the board works perfectly. Keep in step with resolveTwg() in src/twg.ts.
  if (cmd === 'twg' && (repos.indexOf('board.twgPath') >= 0 || foundTwg())) {
    continue;
  }
  todo.push(`Install ${cmd} — ${why}. SETUP.md section 1 has the command.`);
}

// board.repos lives in VS Code's user settings, which this script does not
// edit: getting it wrong points agents at the wrong checkout.
if (repos.indexOf('board.repos') < 0) {
  todo.push(
    'Set "board.repos" in VS Code user settings — it maps each JIRA space to a ' +
    'checkout, and its defaults are one machine\'s Windows paths. SETUP.md section 3.'
  );
}

/* ---------- 5. say where that leaves it ---------- */

say('');
if (failed) {
  say(checkOnly
    ? 'The board needs work on this machine. Run: node setup.js'
    : 'Setup did not finish. Fix what is named above and run it again.');
} else if (did) {
  say(`Board built and linked. Restart VS Code to pick it up.`);
} else {
  say('Board is already set up on this machine. Nothing to do.');
}

if (todo.length) {
  say('');
  say('Still needs you:');
  for (const item of todo) {
    say(`  - ${item}`);
  }
  say('');
  say('Then prove the whole thing works: npm run preflight');
}

process.exit(failed ? 1 : 0);
