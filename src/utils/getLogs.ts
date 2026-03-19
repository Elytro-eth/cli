import { createPublicClient, http } from 'viem';
import type { PublicClient, Address, Hex } from 'viem';
import type { ChainConfig } from '../types';

/**
 * Arguments for getLogsResilient — mirrors viem's getLogs args.
 */
export interface GetLogsArgs {
  address: Address;
  event: ReturnType<typeof import('viem')['parseAbiItem']>;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock?: bigint | 'latest';
}

/**
 * Adaptive chunked log query — ported from extension's getLogsOnchain.ts.
 *
 * Problem: Many RPC endpoints cap getLogs block ranges:
 *   - publicnode: ~1000 blocks
 *   - Alchemy: ~2000 blocks
 *   - Others: 3000-10000 blocks
 *
 * Strategy:
 *   1. Cap toBlock at the actual chain head (never use open-ended 'latest')
 *   2. Walk in 3000-block chunks
 *   3. On "block range too large" error: halve the step size and retry
 *   4. Return on first non-empty batch (caller typically wants latest record)
 *   5. 20s timeout per request, 3 retries per chunk
 */
export async function getLogsResilient(
  client: PublicClient,
  args: GetLogsArgs
): Promise<any[]> {
  // Fetch concrete chain head — never query open-ended ranges
  const headBlock = await client.getBlockNumber();
  const toBlock = args.toBlock === 'latest' || args.toBlock === undefined
    ? headBlock
    : args.toBlock > headBlock
      ? headBlock
      : args.toBlock;

  let step = 3000n;
  let from = args.fromBlock;

  while (from <= toBlock) {
    const to = from + step - 1n > toBlock ? toBlock : from + step - 1n;

    let retries = 3;
    while (retries > 0) {
      try {
        const logs = await Promise.race([
          client.getLogs({
            address: args.address,
            event: args.event as any,
            args: args.args as any,
            fromBlock: from,
            toBlock: to,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('getLogs timeout')), 20_000)
          ),
        ]);

        if (logs && (logs as any[]).length > 0) {
          return logs as any[];
        }

        // Empty batch — advance to next chunk
        break;
      } catch (err: unknown) {
        const msg = (err as Error).message ?? '';
        const isRangeError =
          msg.includes('block range') ||
          msg.includes('Log response size exceeded') ||
          msg.includes('query returned more than') ||
          msg.includes('exceed maximum block range') ||
          msg.includes('range too large');

        if (isRangeError && step > 100n) {
          // Halve step size and retry same chunk
          step = step / 2n;
          continue;
        }

        retries--;
        if (retries === 0) throw err;
      }
    }

    from = to + 1n;
  }

  return [];
}

/**
 * Convenience wrapper: create a client and run getLogsResilient.
 */
export async function getLogsForChain(
  chainConfig: ChainConfig,
  args: GetLogsArgs
): Promise<any[]> {
  const client = createPublicClient({ transport: http(chainConfig.endpoint) });
  return getLogsResilient(client, args);
}
