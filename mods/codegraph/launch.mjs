// Starts the MCP server bundled inside the Codegraph desktop app. The app
// lives in a different place on each OS, so this finds it rather than
// .mcp.json naming one machine's path. CODEGRAPH_MCP overrides the search.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const inApp = ['app', 'out', 'main', 'mcp.js']
const candidates = [
  process.env.CODEGRAPH_MCP,
  path.join('/Applications/Codegraph.app/Contents/Resources', ...inApp),
  path.join(os.homedir(), 'Applications/Codegraph.app/Contents/Resources', ...inApp),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Codegraph', 'resources', ...inApp),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Codegraph', 'resources', ...inApp),
].filter(Boolean)

const server = candidates.find(p => existsSync(p))
if (!server) {
  console.error('codegraph: app not found. Looked in:\n  ' + candidates.join('\n  ') +
    '\nInstall Codegraph, or set CODEGRAPH_MCP to its out/main/mcp.js.')
  process.exit(1)
}

// stdin/stdout are the MCP channel, so hand them straight through.
const child = spawn(process.execPath, [server], { stdio: 'inherit' })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 0))
