import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';

it('prints the released SQL error report as JSON with a failing exit code', async () => {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'proxydiablo-cli-error-'));
  const report = { status: 'error', tabId: 'fixture', proxyType: 'pgsql', error: 'fixture error', sql: 'select missing' };
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/health'
      ? { ok: true, app: 'proxydiablo' }
      : { ok: true, data: report }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as { port: number }).port;
    fs.mkdirSync(path.join(config, 'proxydiablo'));
    fs.writeFileSync(path.join(config, 'proxydiablo/bridge.json'), JSON.stringify({ port, token: 'fixture-only' }));
    const child = spawn(process.execPath, ['src/cli/proxydiablo.mjs', 'sql', 'submit', 'fixture', 'fixture', '--classification', 'read', '--description', 'Fixture', '--sql', report.sql], { env: { ...process.env, XDG_CONFIG_HOME: config }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const code = await new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toEqual(report);
    expect(stderr).toBe('');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(config, { recursive: true, force: true });
  }
});
