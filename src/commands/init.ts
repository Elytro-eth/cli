import { webcrypto } from 'node:crypto';
import { Command } from 'commander';
import ora from 'ora';
import type { AppContext } from '../context';
import { resolveProvider } from '../providers';
import { outputResult, outputError, sanitizeErrorMessage } from '../utils/display';

/**
 * `elytro init` — Initialize a new wallet.
 *
 * Generates a 256-bit vault key and an EOA signing key.
 *
 * Key storage (auto-detected):
 *   - macOS: stored in Keychain (zero-interaction, encrypted at rest)
 *   - Other: displayed once for manual storage, injected via ELYTRO_VAULT_SECRET
 *
 * No password required — key management is handled by the SecretProvider.
 */
export function registerInitCommand(program: Command, ctx: AppContext): void {
  program
    .command('init')
    .description('Initialize a new Elytro wallet')
    .action(async () => {
      if (await ctx.keyring.isInitialized()) {
        outputResult({
          status: 'already_initialized',
          dataDir: ctx.store.dataDir,
          hint: 'Use `elytro account create` to create a smart account.',
        });
        return;
      }

      const spinner = ora('Setting up wallet...').start();
      try {
        // 1. Generate a cryptographically secure 256-bit vault key
        const vaultKey = webcrypto.getRandomValues(new Uint8Array(32));

        // 2. Resolve the init provider (persistent storage)
        const { initProvider } = await resolveProvider();

        let providerName: string | null = null;
        let vaultSecretB64: string | null = null;

        if (initProvider) {
          // Persistent provider available (e.g. macOS Keychain)
          await initProvider.store(vaultKey);
          providerName = initProvider.name;
        } else {
          // No persistent provider — return secret for manual storage
          vaultSecretB64 = Buffer.from(vaultKey).toString('base64');
        }

        // 3. Create the encrypted vault with the new key
        await ctx.keyring.createNewOwner(vaultKey);

        // Zero-fill the key buffer after use
        vaultKey.fill(0);

        spinner.stop();

        outputResult({
          status: 'initialized',
          dataDir: ctx.store.dataDir,
          secretProvider: providerName,
          ...(vaultSecretB64 ? { vaultSecret: vaultSecretB64 } : {}),
          ...(vaultSecretB64
            ? { hint: 'Save ELYTRO_VAULT_SECRET — it will NOT be shown again.' }
            : {}),
          nextStep: 'Run `elytro account create --chain <chainId>` to create your first smart account.',
        });
      } catch (err) {
        spinner.fail('Failed to initialize wallet.');
        outputError(-32000, sanitizeErrorMessage((err as Error).message));
      }
    });
}
