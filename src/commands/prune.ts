import { rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveProvider } from '../providers';
import { outputResult, outputError } from '../utils/display';

const DATA_DIR = join(homedir(), '.elytro');

/**
 * prune — delete all local Elytro data and the vault key.
 *
 * This command intentionally runs OUTSIDE the normal app context so it
 * works even when context creation fails (missing vault key, corrupted
 * keyring, etc.) — which is exactly when a reset is needed.
 *
 * Without --force it returns a dry-run summary describing what will be
 * deleted, so agents can present a confirmation step to the user before
 * re-calling with --force.
 */
export async function handlePrune(force: boolean): Promise<void> {
  // ── Dry run ─────────────────────────────────────────────────────
  if (!force) {
    let dataDirExists = false;
    try {
      await access(DATA_DIR);
      dataDirExists = true;
    } catch {
      // doesn't exist
    }

    let secretProviderName = 'none';
    try {
      const { loadProvider } = await resolveProvider();
      if (loadProvider) secretProviderName = loadProvider.name;
    } catch {
      // ignore
    }

    outputResult({
      status: 'confirmation_required',
      message: 'This will permanently delete ALL local Elytro data. This cannot be undone.',
      willDelete: {
        dataDir: {
          path: DATA_DIR,
          exists: dataDirExists,
          contents: 'keyring, accounts, config, API keys, recovery records, guardian labels',
        },
        vaultKey: {
          provider: secretProviderName,
          note: 'The signing key stored in the OS secret provider will also be removed.',
        },
      },
      action: 'Re-run with --force to confirm: elytro prune --force',
      warning:
        'Accounts cannot be recovered without a keyring backup. ' +
        'Ensure you have a backup before proceeding.',
    });
    return;
  }

  // ── Forced deletion ──────────────────────────────────────────────

  // 1. Delete ~/.elytro/ data directory
  let dataDirDeleted = false;
  try {
    await rm(DATA_DIR, { recursive: true, force: true });
    dataDirDeleted = true;
  } catch (err) {
    outputError(-32000, `Failed to delete data directory: ${(err as Error).message}`);
    return;
  }

  // 2. Delete vault key from OS secret provider (best-effort)
  let secretProviderCleared = false;
  let secretProviderName = 'none';
  try {
    const { loadProvider } = await resolveProvider();
    if (loadProvider) {
      secretProviderName = loadProvider.name;
      await loadProvider.delete();
      secretProviderCleared = true;
    }
  } catch {
    // Best-effort — data dir already gone; report partial result
    secretProviderCleared = false;
  }

  outputResult({
    status: 'pruned',
    dataDir: DATA_DIR,
    dataDirDeleted,
    secretProviderCleared,
    secretProvider: secretProviderName,
    message: "All local Elytro data has been deleted. Run 'elytro init' to start fresh.",
  });
}
