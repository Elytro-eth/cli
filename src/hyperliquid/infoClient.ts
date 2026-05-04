import type { Address } from 'viem';
import { HlClient } from './client.js';
import { assertHlOk } from './errors.js';
import type {
  HlPerpMeta,
  HlAssetContext,
  HlClearinghouseState,
  HlOpenOrder,
  HlSpotMeta,
  HlSpotClearinghouseState,
  HlApprovedBuilder,
} from './types.js';
import type { HlNetwork } from './constants.js';

/**
 * Read-only Hyperliquid info client.
 * No signing required. All methods POST to /info.
 */
export class HlInfoClient {
  private readonly client: HlClient;

  constructor(network: HlNetwork) {
    this.client = new HlClient(network);
  }

  // ─── Perpetuals ───────────────────────────────────────────────────────────

  async getMeta(): Promise<HlPerpMeta> {
    return this.client.info<HlPerpMeta>({ type: 'meta' });
  }

  async getMetaAndAssetCtxs(): Promise<[HlPerpMeta, HlAssetContext[]]> {
    return this.client.info<[HlPerpMeta, HlAssetContext[]]>({ type: 'metaAndAssetCtxs' });
  }

  async getAllMids(): Promise<Record<string, string>> {
    return this.client.info<Record<string, string>>({ type: 'allMids' });
  }

  async getClearinghouseState(user: Address): Promise<HlClearinghouseState> {
    return this.client.info<HlClearinghouseState>({
      type: 'clearinghouseState',
      user: user.toLowerCase(),
    });
  }

  async getOpenOrders(user: Address): Promise<HlOpenOrder[]> {
    return this.client.info<HlOpenOrder[]>({
      type: 'openOrders',
      user: user.toLowerCase(),
    });
  }

  async getOrderStatus(user: Address, oid: number): Promise<unknown> {
    return this.client.info({ type: 'orderStatus', user: user.toLowerCase(), oid });
  }

  async getUserFills(user: Address): Promise<unknown[]> {
    return this.client.info<unknown[]>({ type: 'userFills', user: user.toLowerCase() });
  }

  async getFundingHistory(
    coin: string,
    startTime: number,
    endTime?: number,
  ): Promise<unknown[]> {
    return this.client.info<unknown[]>({
      type: 'fundingHistory',
      coin,
      startTime,
      ...(endTime !== undefined ? { endTime } : {}),
    });
  }

  async getUserRole(user: Address): Promise<{ role: string }> {
    return this.client.info<{ role: string }>({
      type: 'userRole',
      user: user.toLowerCase(),
    });
  }

  async getSubAccounts(user: Address): Promise<unknown[]> {
    return this.client.info<unknown[]>({
      type: 'subAccounts',
      user: user.toLowerCase(),
    });
  }

  // ─── Spot ─────────────────────────────────────────────────────────────────

  async getSpotMeta(): Promise<HlSpotMeta> {
    return this.client.info<HlSpotMeta>({ type: 'spotMeta' });
  }

  async getSpotMetaAndAssetCtxs(): Promise<[HlSpotMeta, unknown[]]> {
    return this.client.info<[HlSpotMeta, unknown[]]>({ type: 'spotMetaAndAssetCtxs' });
  }

  async getSpotClearinghouseState(user: Address): Promise<HlSpotClearinghouseState> {
    return this.client.info<HlSpotClearinghouseState>({
      type: 'spotClearinghouseState',
      user: user.toLowerCase(),
    });
  }

  // ─── Builder ──────────────────────────────────────────────────────────────

  async getApprovedBuilders(user: Address): Promise<HlApprovedBuilder[]> {
    return this.client.info<HlApprovedBuilder[]>({
      type: 'approvedBuilders',
      user: user.toLowerCase(),
    });
  }

  async getMaxBuilderFee(user: Address, builder: Address): Promise<string> {
    return this.client.info<string>({
      type: 'maxBuilderFee',
      user: user.toLowerCase(),
      builder: builder.toLowerCase(),
    });
  }

  // ─── DEX (HIP-3) ─────────────────────────────────────────────────────────

  async getPerpDexs(): Promise<unknown[]> {
    return this.client.info<unknown[]>({ type: 'perpDexs' });
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Find a perp asset index by coin name (case-insensitive).
   * Returns undefined if not found.
   */
  async findAssetIndex(coin: string): Promise<number | undefined> {
    const meta = await this.getMeta();
    const idx = meta.universe.findIndex(
      (a) => a.name.toUpperCase() === coin.toUpperCase(),
    );
    return idx >= 0 ? idx : undefined;
  }

  /**
   * Find a spot asset index (returns 10000 + raw index for exchange actions).
   */
  async findSpotAssetIndex(coin: string): Promise<number | undefined> {
    const meta = await this.getSpotMeta();
    const idx = meta.universe.findIndex(
      (u) => u.name.toUpperCase() === coin.toUpperCase() ||
             u.name.toUpperCase() === `${coin.toUpperCase()}/USDC`,
    );
    return idx >= 0 ? 10000 + meta.universe[idx].index : undefined;
  }

  /**
   * Get the current mid price for a coin.
   */
  async getMidPrice(coin: string): Promise<string | null> {
    const mids = await this.getAllMids();
    return mids[coin.toUpperCase()] ?? null;
  }
}
