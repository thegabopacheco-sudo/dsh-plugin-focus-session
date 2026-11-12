#!/usr/bin/env node
// dsh-plugin-focus-session — minimiza ventanas por patrón (modo concentración).
// Tools: status, windows, focus.

import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'focus-session', 'config.json');
const CACHE_DIR = path.join(DSH_HOME, 'cache', 'focus-session');
const READ_ONLY = String(process.env.DSH_FOCUS_MODE || '').toLowerCase() === 'read-only';
const log = (m) => process.stderr.write(`[focus] ${m}\n`);

const WIN32 = `
$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class FocusWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@
Add-Type -TypeDefinition $code
function Get-FocusWindows {
  $script:WINS = New-Object System.Collections.ArrayList
  $callback = [FocusWin32+EnumWindowsProc]{ param($h, $l)
    if ([FocusWin32]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [void][FocusWin32]::GetWindowText($h, $sb, 512)
      $title = $sb.ToString()
      if ($title) { [void]$script:WINS.Add([pscustomobject]@{ title=$title; minimized=[FocusWin32]::IsIconic($h) }) }
    }
    return $true
  }
  [void][FocusWin32]::EnumWindows($callback, [IntPtr]::Zero)
  return ,$script:WINS
}
`;
function ps(script, timeoutMs = 30000) {
  const result = spawnSync('powershell', ['-NoProfile', '-Command', `${WIN32}\n${script}`], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  if (result.status !== 0) throw new Error(`PowerShell falló: ${(result.stderr || '').trim().slice(0, 240)}`);
  return (result.stdout || '').trim();
}
function loadConfig() { try { if (existsSync(CONFIG_FILE)) return { patterns: [], ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch { /* defaults */ } return { patterns: [] }; }
function listWindows() {
  if (process.platform !== 'win32') throw new Error('focus-session solo soporta Windows');
  const output = ps('Get-FocusWindows | ConvertTo-Json -Compress -Depth 3');
  if (!output) return [];
  const parsed = JSON.parse(output);
  return Array.isArray(parsed) ? parsed : [parsed];
}
function textResult(text) { return { content: [{ type: 'text', text }] }; }

function buildInstructions() {
  return [
    'Focus Session: minimiza ventanas por patrón (modo concentración).',
    '',
    'Herramientas: status, windows, focus.',
    '',
    'Reglas:',
    '- windows lista ventanas visibles (solo lectura).',
    '- focus minimiza (no cierra) ventanas cuyo título coincida con los patrones.',
    '- dryRun es true por defecto; para minimizar de verdad requiere dryRun:false y confirm:true.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-focus-session', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });
  server.registerTool('status', { title: 'Estado', description: 'Patrones configurados y modo.', inputSchema: z.object({}) }, async () => textResult([`Patrones: ${(loadConfig().patterns || []).join(', ') || '(ninguno)'}`, `Ventanas: ${listWindows().length}`, `Modo: ${READ_ONLY ? 'read-only' : 'normal'}`].join('\n')));
  server.registerTool('windows', { title: 'Ventanas visibles', description: 'Lista ventanas con título y estado.', inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional() }) }, async (args) => {
    const windows = listWindows().slice(0, args.limit ?? 25);
    if (windows.length === 0) return textResult('Sin ventanas visibles.');
    return textResult([`Ventanas: ${windows.length}`, '', ...windows.map((win) => `- ${win.minimized ? '🗕 ' : ''}${win.title.slice(0, 80)}`)].join('\n'));
  });
  server.registerTool('focus', { title: 'Minimizar por patrón', description: 'Minimiza ventanas que coincidan. Requiere confirm para modo real.', inputSchema: z.object({ patterns: z.array(z.string().min(2).max(60)).min(1).max(20), dryRun: z.boolean().optional(), confirm: z.boolean().optional() }) }, async (args) => {
    if (READ_ONLY) throw new Error('modo read-only: focus deshabilitado');
    const patterns = args.patterns.map((pattern) => pattern.toLowerCase());
    const windows = listWindows();
    const matches = windows.filter((win) => patterns.some((pattern) => win.title.toLowerCase().includes(pattern)));
    const dryRun = args.dryRun !== false;
    if (dryRun) return textResult([`Coincidencias: ${matches.length}`, ...matches.map((win) => `- ${win.title.slice(0, 80)}`)].join('\n'));
    if (args.confirm !== true) throw new Error('focus real requiere confirm:true');
    if (matches.length === 0) return textResult('Sin ventanas que coincidan; nada que minimizar.');
    const payload = path.join(CACHE_DIR, `patterns-${Date.now()}.json`);
    mkdirSync(path.dirname(payload), { recursive: true });
    writeFileSync(payload, JSON.stringify(patterns), 'utf8');
    const script = `
$patterns = Get-Content -Raw '${payload.replace(/'/g, "''")}' | ConvertFrom-Json
$count = 0
$script:TARGETS = New-Object System.Collections.ArrayList
$callback = [FocusWin32+EnumWindowsProc]{ param($h, $l)
  if ([FocusWin32]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][FocusWin32]::GetWindowText($h, $sb, 512)
    $title = $sb.ToString().ToLower()
    foreach ($p in $patterns) { if ($title -ne '' -and $title.Contains([string]$p)) { [void][FocusWin32]::ShowWindow($h, 6); $script:TARGETS.Add($title); break } }
  }
  return $true
}
[void][FocusWin32]::EnumWindows($callback, [IntPtr]::Zero)
Write-Output $script:TARGETS.Count
`;
    const count = ps(script);
    return textResult(`Minimizadas: ${count} ventana(s).`);
  });
  return server;
}

try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* ignora */ }
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
