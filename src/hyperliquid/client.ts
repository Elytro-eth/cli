import { HyperliquidError, HL_ERR_API } from './errors.js';
import type { HlNetwork } from './constants.js';
import { hlApiBase } from './constants.js';

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Base HTTP client for Hyperliquid API.
 * All methods return parsed JSON — never throw on HTTP 200 (HL always returns 200).
 */
export class HlClient {
  private readonly baseUrl: string;

  constructor(network: HlNetwork) {
    this.baseUrl = hlApiBase(network);
  }

  async info<T>(payload: Record<string, unknown>): Promise<T> {
    return this.post<T>('/info', payload);
  }

  async exchange<T>(payload: Record<string, unknown>): Promise<T> {
    return this.post<T>('/exchange', payload);
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new HyperliquidError(
          HL_ERR_API,
          `Hyperliquid API HTTP ${response.status}: ${response.statusText}`,
          { url, status: response.status },
        );
      }

      return response.json() as Promise<T>;
    } catch (err) {
      if (err instanceof HyperliquidError) throw err;
      const msg = (err as Error).message ?? String(err);
      throw new HyperliquidError(HL_ERR_API, `Hyperliquid API request failed: ${msg}`, { url });
    } finally {
      clearTimeout(timer);
    }
  }
}
