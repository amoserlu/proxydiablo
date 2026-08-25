#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONFIG_DIR = path.join(os.homedir(), '.config', 'proxydiablo');
const BRIDGE_FILE = path.join(CONFIG_DIR, 'bridge.json');
const LOG_FILE = path.join(CONFIG_DIR, 'server.log');
const SERVER_ENTRY = path.join(PROJECT_DIR, 'dist-server', 'server', 'main.js');
const LEGACY_BRIDGE_FILE = path.join(os.homedir(), '.config', 'pgsqldiablo-ui', 'bridge.json');
const MAX_STREAM_BYTES = 5 * 1024 * 1024;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readBridge() {
  return readJson(BRIDGE_FILE);
}

function request(method, route, body, timeoutMs = 5000) {
  const bridge = readBridge();
  if (!bridge?.port || !bridge?.token) return Promise.reject(new Error('bridge_not_running'));
  return requestWithBridge(bridge, method, route, body, timeoutMs);
}

function requestWithBridge(bridge, method, route, body, timeoutMs = 5000) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: bridge.port,
      path: route,
      method,
      timeout: timeoutMs,
      headers: {
        authorization: `Bearer ${bridge.token}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode && res.statusCode >= 400) reject(new Error(parsed.error || `http_${res.statusCode}`));
          else resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

async function healthyService() {
  try {
    const health = await request('GET', '/health', undefined, 1200);
    return health?.ok === true && health?.app === 'proxydiablo';
  } catch {
    return false;
  }
}

async function stopLegacyService() {
  const legacy = readJson(LEGACY_BRIDGE_FILE);
  if (!legacy?.pid) return;
  try {
    const health = await requestWithBridge(legacy, 'GET', '/health', undefined, 1200);
    if (health?.ok !== true || health?.app === 'proxydiablo') return;
    process.kill(Number(legacy.pid), 'SIGTERM');
    for (let index = 0; index < 25; index += 1) {
      await delay(200);
      try {
        process.kill(Number(legacy.pid), 0);
      } catch {
        return;
      }
    }
  } catch {
    // An unreachable or stale legacy bridge must never be allowed to kill a reused PID.
  }
}

async function ensureService({ open = false } = {}) {
  if (!await healthyService()) {
    await stopLegacyService();
    if (!fs.existsSync(SERVER_ENTRY)) {
      throw new Error(`Missing web build. Run: cd ${PROJECT_DIR} && npm run build`);
    }
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(CONFIG_DIR, 0o700);
    const log = fs.openSync(LOG_FILE, 'a', 0o600);
    fs.chmodSync(LOG_FILE, 0o600);
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: PROJECT_DIR,
      detached: true,
      env: { ...process.env, PROXYDIABLO_PROJECT_DIR: PROJECT_DIR },
      stdio: ['ignore', log, log],
    });
    child.unref();
    fs.closeSync(log);

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !await healthyService()) await delay(200);
    if (!await healthyService()) throw new Error(`Could not start proxydiablo. See ${LOG_FILE}`);
  }
  if (open) await request('POST', '/open', {}, 3000);
}

function parseClassification(value) {
  if (value !== 'read' && value !== 'write') {
    throw new Error('Missing --classification read|write. When uncertain, use write.');
  }
  return value;
}

function parseOptions(args, valueOptions) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueOptions.has(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      options[arg] = value;
    } else positional.push(arg);
  }
  return { options, positional };
}

function parsePgsqlSubmit(args) {
  const { options, positional } = parseOptions(args, new Set(['--sql', '--description', '--desc', '--classification']));
  const [profile, database, ...extra] = positional;
  if (!profile || !database || extra.length) {
    throw new Error('Usage: proxydiablo pgsql submit <profile> <database> --classification read|write --description "..." --sql "..."');
  }
  const sql = options['--sql'] ?? '';
  const description = options['--description'] ?? options['--desc'] ?? '';
  if (!sql || !description) throw new Error('--sql and --description are required.');
  return { profile, database, sql, description, classification: parseClassification(options['--classification']) };
}

function parseCommand(args) {
  const { options, positional } = parseOptions(args, new Set(['--command', '--description', '--desc', '--classification', '--cwd']));
  if (positional.length) throw new Error(`Unknown command arguments: ${positional.join(' ')}`);
  const command = options['--command'] ?? '';
  const description = options['--description'] ?? options['--desc'] ?? '';
  const cwd = path.resolve(options['--cwd'] ?? process.cwd());
  if (!command || !description) throw new Error('--command and --description are required.');
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error(`Working directory does not exist: ${cwd}`);
  return { command, description, cwd, classification: parseClassification(options['--classification']) };
}

function parseInspect(args) {
  const [profile, database, ...rest] = args;
  if (!profile || !database) {
    throw new Error('Usage: proxydiablo pgsql inspect <profile> <database> [--all|--schemas|--tables|--views|--columns] [--schema <schema>]');
  }
  const kinds = [];
  let schema;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--all') kinds.push('all');
    else if (arg === '--schemas') kinds.push('schemas');
    else if (arg === '--tables') kinds.push('tables');
    else if (arg === '--views') kinds.push('views');
    else if (arg === '--columns') kinds.push('columns');
    else if (arg === '--schema') schema = rest[++index];
    else throw new Error(`Unknown inspect option: ${arg}`);
  }
  return { profile, database, kinds: kinds.length ? kinds : ['all'], schema };
}

async function pgsqlSubmit(args) {
  await ensureService();
  const response = await request('POST', '/pgsql/submit', parsePgsqlSubmit(args), 1000 * 60 * 60 * 6);
  handleFinalResponse(response.data);
}

async function pgsqlInspect(args) {
  await ensureService();
  const response = await request('POST', '/pgsql/inspect', parseInspect(args), 1000 * 60 * 5);
  console.log(JSON.stringify(response.data, null, 2));
}

async function pgsqlProfiles() {
  await ensureService();
  const response = await request('GET', '/pgsql/profiles', undefined, 1000 * 60);
  console.log(JSON.stringify(response.data, null, 2));
}

async function commandSubmit(args) {
  await ensureService();
  const created = await request('POST', '/command/submit', parseCommand(args), 10000);
  const tabId = created.data.tabId;
  let seq = 0;
  let result;

  while (true) {
    const instruction = await waitForInstruction(tabId, seq);
    seq = instruction.seq;

    if (instruction.type === 'run') {
      const outcome = await executeSilently(tabId, instruction, seq);
      if (outcome.interrupted) {
        handleCommandInstruction(tabId, outcome.instruction, result);
        return;
      }
      result = outcome.result;
      await request('POST', `/command/${encodeURIComponent(tabId)}/result`, result, 30000);
      continue;
    }

    handleCommandInstruction(tabId, instruction, result);
    return;
  }
}

async function executeSilently(tabId, instruction, afterSeq) {
  const shell = process.env.SHELL || '/usr/bin/zsh';
  const started = Date.now();
  const child = spawn(shell, ['-lc', instruction.command], {
    cwd: instruction.cwd,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = createCapture();
  const stderr = createCapture();
  child.stdout.on('data', (chunk) => appendCapture(stdout, chunk));
  child.stderr.on('data', (chunk) => appendCapture(stderr, chunk));

  let finished = false;
  const completed = new Promise((resolve) => {
    child.on('error', (error) => {
      appendCapture(stderr, Buffer.from(error.message));
      finished = true;
      resolve({ exitCode: null, signal: null });
    });
    child.on('close', (exitCode, signal) => {
      finished = true;
      resolve({ exitCode, signal });
    });
  });

  const interrupted = (async () => {
    while (!finished) {
      await delay(250);
      const next = await fetchInstruction(tabId, afterSeq);
      if (next && next.type !== 'run') return next;
    }
    return undefined;
  })();

  const winner = await Promise.race([
    completed.then((processResult) => ({ processResult })),
    interrupted.then((control) => ({ control })),
  ]);

  if (winner.control) {
    terminateProcessGroup(child.pid);
    return { interrupted: true, instruction: winner.control };
  }

  const stdoutText = captureText(stdout);
  return {
    interrupted: false,
    result: {
      stdout: stdoutText,
      stderr: captureText(stderr),
      exitCode: winner.processResult.exitCode,
      signal: winner.processResult.signal,
      durationMs: Date.now() - started,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      outputKind: detectOutputKind(stdoutText),
    },
  };
}

function detectOutputKind(stdout) {
  if (!stdout.trim()) return 'text';
  try {
    JSON.parse(stdout);
    return 'json';
  } catch {
    return 'text';
  }
}

function createCapture() {
  return { chunks: [], bytes: 0, truncated: false };
}

function appendCapture(capture, value) {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const remaining = MAX_STREAM_BYTES - capture.bytes;
  if (remaining <= 0) {
    capture.truncated = true;
    return;
  }
  const kept = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
  capture.chunks.push(kept);
  capture.bytes += kept.length;
  if (kept.length < chunk.length) capture.truncated = true;
}

function captureText(capture) {
  return Buffer.concat(capture.chunks, capture.bytes).toString('utf8');
}

function terminateProcessGroup(pid) {
  if (!pid) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }, 1500).unref();
}

async function waitForInstruction(tabId, afterSeq) {
  while (true) {
    const instruction = await fetchInstruction(tabId, afterSeq);
    if (instruction) return instruction;
    await delay(300);
  }
}

async function fetchInstruction(tabId, afterSeq) {
  const response = await request('GET', `/command/${encodeURIComponent(tabId)}/instruction?after=${afterSeq}`, undefined, 3000);
  return response.data;
}

function handleCommandInstruction(tabId, instruction, result) {
  if (instruction.type === 'released') {
    if (!result) throw new Error('Command output was released before execution completed.');
    handleFinalResponse({ status: 'released', tabId, proxyType: 'command', result });
  } else if (instruction.type === 'revision_requested') {
    handleFinalResponse({
      status: 'revision_requested',
      tabId,
      proxyType: 'command',
      explanation: instruction.explanation,
    });
  } else if (instruction.type === 'cancelled') {
    handleFinalResponse({ status: 'cancelled', tabId, proxyType: 'command' });
  } else if (instruction.type === 'error') {
    handleFinalResponse({ status: 'error', tabId, proxyType: 'command', error: instruction.error });
  }
}

function handleFinalResponse(response) {
  if (response.status === 'released' || response.status === 'revision_requested') {
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  if (response.status === 'cancelled') {
    console.error('Cancelled by the user.');
    process.exitCode = 130;
    return;
  }
  console.error(response.error || 'Unknown proxy error.');
  process.exitCode = 1;
}

async function main() {
  const [group, command, ...args] = process.argv.slice(2);
  if (!group || group === 'ui' || group === 'open') {
    await ensureService({ open: true });
    return;
  }
  if (group === 'pgsql' && command === 'profiles') return pgsqlProfiles();
  if (group === 'pgsql' && command === 'inspect') return pgsqlInspect(args);
  if (group === 'pgsql' && command === 'submit') return pgsqlSubmit(args);
  if (group === 'command') return commandSubmit([command, ...args].filter((value) => value !== undefined));
  throw new Error('Usage: proxydiablo ui | pgsql <profiles|inspect|submit> | command <options>');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
