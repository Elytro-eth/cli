import type { Address } from 'viem';
import type { AppContext } from '../../context.js';
import type { AccountInfo } from '../../types/index.js';
import { HlAccountStore } from '../accountMapping.js';
import type { HlAccountInfo } from '../types.js';
import { HyperliquidError, HL_ERR_ACCOUNT_NOT_FOUND } from '../errors.js';
import { outputError, sanitizeErrorMessage } from '../../utils/display.js';

/**
 * Resolve the Elytro account and its Hyperliquid mapping.
 * Falls back to current account if no target specified.
 * hlAccount may be null if `elytro hyperliquid init` has not been run.
 */
export async function resolveHlAccount(
  ctx: AppContext,
  store: HlAccountStore,
  target?: string,
): Promise<{ account: AccountInfo; hlAccount: HlAccountInfo | null }> {
  const identifier =
    target ?? ctx.account.currentAccount?.alias ?? ctx.account.currentAccount?.address;

  if (!identifier) {
    throw new HyperliquidError(
      HL_ERR_ACCOUNT_NOT_FOUND,
      'No account selected. Specify an alias/address or create one with `elytro account create`.',
    );
  }

  const account = ctx.account.resolveAccount(identifier);
  if (!account) {
    throw new HyperliquidError(
      HL_ERR_ACCOUNT_NOT_FOUND,
      `Account "${identifier}" not found.`,
    );
  }

  const hlAccount = await store.getAccount(account.address as Address);
  return { account, hlAccount };
}

/**
 * Require that the Hyperliquid account has been initialized.
 */
export function requireHlAccount(
  hlAccount: HlAccountInfo | null,
  accountAlias: string,
): asserts hlAccount is HlAccountInfo {
  if (!hlAccount) {
    throw new HyperliquidError(
      HL_ERR_ACCOUNT_NOT_FOUND,
      `Hyperliquid not initialized for account "${accountAlias}". ` +
        'Run `elytro hyperliquid init` first.',
    );
  }
}

/**
 * Standard error handler for all HL command actions.
 */
export function handleHlError(err: unknown): never {
  if (err instanceof HyperliquidError) {
    outputError(err.code, err.message, err.data);
  }
  outputError(-32000, sanitizeErrorMessage((err as Error).message ?? String(err)));
}
