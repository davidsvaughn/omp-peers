/**
 * State-directory layout and path helpers.
 *
 * The state dir is machine-global and NEVER repo-local. Resolution order:
 *   1. `$OMP_PEERS_DIR` (explicit override)
 *   2. `%LOCALAPPDATA%\omp-peers`   (Windows)
 *   3. `$HOME/.omp/var/omp-peers`   (fallback)
 *
 * Layout:
 *   <state>/peers/<pid>.json      owner-only presence records (0600)
 *   <state>/peers/<pid>.sock      unix sockets (non-Windows only)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
function stripTrailingSeparators(p) {
    return p.replace(/[\\/]+$/, '');
}
/** Resolve the machine-global state dir from the environment. */
export function resolveStateDir() {
    const override = process.env.OMP_PEERS_DIR;
    if (override !== undefined && override.trim() !== '') {
        return stripTrailingSeparators(override);
    }
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData !== undefined && localAppData.trim() !== '') {
        return join(stripTrailingSeparators(localAppData), 'omp-peers');
    }
    return join(homedir(), '.omp', 'var', 'omp-peers');
}
/** Isolate discovery and listening sockets by checkout, or launch directory outside Git. */
export function projectStateDir(cwd) {
    let root = realpathSync(cwd);
    try {
        root = realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], {
            cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).replace(/\r?\n$/, ''));
    }
    catch {
        // Without a Git worktree, use the narrower directory scope.
    }
    return join(resolveStateDir(), createHash('sha256').update(root).digest('hex').slice(0, 32));
}
/** Directory holding one `<pid>.json` presence record per live peer. */
export function peersDir(stateDir = resolveStateDir()) {
    return join(stateDir, 'peers');
}
/** Presence record for one peer pid (single writer: the owning process). */
export function peerPath(pid, stateDir = resolveStateDir()) {
    return join(peersDir(stateDir), `${pid}.json`);
}
/** Create the fixed state directory skeleton. Returns the state dir. */
export async function ensureStateDirs(stateDir = resolveStateDir()) {
    await mkdir(stateDir, { recursive: true });
    await mkdir(peersDir(stateDir), { recursive: true });
    // mkdir's mode only applies to dirs it creates — chmod unconditionally so
    // pre-existing installs get repaired too. Other users must not reach the
    // socket files (local prompt-injection surface).
    if (process.platform !== 'win32') {
        await chmod(stateDir, 0o700).catch(() => undefined);
        await chmod(peersDir(stateDir), 0o700).catch(() => undefined);
    }
    return stateDir;
}
