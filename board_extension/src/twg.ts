import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** Thrown when twg runs but reports a problem (auth, bad JQL, unknown key). */
export class TwgError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
  }
}

let cachedPath: string | undefined;

/**
 * Find the twg binary. The installer drops it in a known per-platform
 * location and only sometimes lands on PATH, so look there before
 * trusting PATH resolution.
 */
export function resolveTwg(): string {
  const configured = vscode.workspace.getConfiguration('board').get<string>('twgPath');
  if (configured) {
    return configured;
  }
  if (cachedPath) {
    return cachedPath;
  }

  const home = os.homedir();
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
            'Programs',
            'twg',
            'bin',
            'twg.exe'
          )
        ]
      : [path.join(home, '.local', 'bin', 'twg'), '/usr/local/bin/twg', '/opt/homebrew/bin/twg'];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedPath = candidate;
      return candidate;
    }
  }
  // Fall back to PATH and let the spawn failure carry the message.
  return 'twg';
}

function siteArgs(): string[] {
  const site = vscode.workspace.getConfiguration('board').get<string>('site');
  return site ? ['--site', site] : [];
}

/**
 * Run a twg command and parse its JSON. Every twg command takes `-o json`,
 * which is why the extension shells out rather than going through MCP.
 */
export function twgJson<T>(args: string[]): Promise<T> {
  const bin = resolveTwg();
  const full = [...args, ...siteArgs(), '-o', 'json'];

  return new Promise<T>((resolve, reject) => {
    execFile(
      bin,
      full,
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          const hint =
            (err as NodeJS.ErrnoException).code === 'ENOENT'
              ? `Could not find the twg CLI (looked for "${bin}"). Install it, or set board.twgPath.`
              : `twg ${args[0] ?? ''} failed: ${err.message}`;
          reject(new TwgError(hint, stderr));
          return;
        }
        try {
          resolve(unwrap(parse(stdout)) as T);
        } catch (parseErr) {
          reject(
            new TwgError(
              parseErr instanceof TwgError
                ? parseErr.message
                : `twg returned output that was not JSON. That is usually auth — run "twg doctor".`,
              stderr || stdout.slice(0, 400)
            )
          );
        }
      }
    );
  });
}

/**
 * Above a size threshold twg stops printing JSON and instead writes the
 * payload to a temp file, printing a YAML envelope that names it. Both
 * shapes are normal, so handle either.
 */
const quote = String.fromCharCode(34);

function parse(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }

  const spilled = /^\s*stdout:\s*"(.+?)"\s*$/m.exec(trimmed);
  if (!spilled) {
    throw new TwgError('twg printed neither JSON nor a payload file reference.', trimmed.slice(0, 400));
  }

  // The envelope JSON-escapes the path, so let JSON unescape it.
  const file = JSON.parse(quote + spilled[1] + quote) as string;
  if (!fs.existsSync(file)) {
    throw new TwgError(`twg wrote its payload to ${file}, which no longer exists.`, '');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The inline form is the bare payload; the spilled form nests it under
 * `data` alongside request metadata. Callers should not have to care.
 */
function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if ('data' in record && 'apiVersion' in record) {
      return record.data;
    }
  }
  return payload;
}
