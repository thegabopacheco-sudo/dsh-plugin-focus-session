// Test end-to-end de focus-session (Windows).
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
const home = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(home, 'focus-session'), { recursive: true });
writeFileSync(path.join(home, 'focus-session', 'config.json'), JSON.stringify({ patterns: ['no-match'] }), 'utf8');

function makeClient(extraEnv = {}) {
  const entry = process.env.FOCUS_SERVER ? path.resolve(process.env.FOCUS_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: home, ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'focus-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const status = textOf(await client.callTool({ name: 'status', arguments: {} }));
console.log('--- status ---'); console.log(status);
console.log('patrones configurados:', status.includes('no-match'));
const windows = textOf(await client.callTool({ name: 'windows', arguments: { limit: 10 } }));
console.log('--- windows ---'); console.log(windows.slice(0, 500));
console.log('lista ventanas:', windows.includes('Ventanas:') || windows.includes('Sin ventanas'));
const dry = textOf(await client.callTool({ name: 'focus', arguments: { patterns: ['ZZZNoMatchXYZ'] } }));
console.log('--- dry run ---'); console.log(dry);
console.log('dry run 0 coincidencias:', dry.includes('Coincidencias: 0'));
const noConfirm = await client.callTool({ name: 'focus', arguments: { patterns: ['ZZZNoMatchXYZ'], dryRun: false } });
console.log('focus real sin confirm isError:', noConfirm.isError === true);
const safe = textOf(await client.callTool({ name: 'focus', arguments: { patterns: ['ZZZNoMatchXYZ'], dryRun: false, confirm: true } }));
console.log('--- real sin match ---'); console.log(safe);
console.log('no minimiza nada:', safe.includes('Sin ventanas que coincidan'));
await client.close(); try { await transport.close?.(); } catch {}
const { client: roClient, transport: roTransport } = await makeClient({ DSH_FOCUS_MODE: 'read-only' });
const ro = await roClient.callTool({ name: 'focus', arguments: { patterns: ['x'], dryRun: false, confirm: true } });
console.log('read-only focus isError:', ro.isError === true);
await roClient.close(); try { await roTransport.close?.(); } catch {}
console.log('OK');
