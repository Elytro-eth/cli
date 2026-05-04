import type { HlPerpMeta, HlAssetMeta } from './types.js';
import { HyperliquidError, HL_ERR_INVALID_PARAMS } from './errors.js';

function fail(message: string): never {
  throw new HyperliquidError(HL_ERR_INVALID_PARAMS, message);
}

export function validateSide(side: string): asserts side is 'buy' | 'sell' {
  if (side !== 'buy' && side !== 'sell') {
    fail(`Invalid side "${side}". Must be "buy" or "sell".`);
  }
}

export function validateOrderType(type: string): asserts type is 'market' | 'limit' {
  if (type !== 'market' && type !== 'limit') {
    fail(`Invalid order type "${type}". Must be "market" or "limit".`);
  }
}

export function validateSize(size: number): void {
  if (!isFinite(size) || size <= 0) {
    fail(`Invalid size "${size}". Must be a positive number.`);
  }
}

export function validatePrice(price: number | undefined, orderType: string): void {
  if (orderType === 'limit') {
    if (price === undefined || price === null) {
      fail('Limit orders require a --price argument.');
    }
    if (!isFinite(price) || price <= 0) {
      fail(`Invalid price "${price}". Must be a positive number.`);
    }
  }
}

export function validateSlippage(slippage: number): void {
  if (!isFinite(slippage) || slippage < 0 || slippage > 100) {
    fail(`Invalid slippage "${slippage}". Must be between 0 and 100 (percent).`);
  }
}

export function validateLeverage(leverage: number, assetMeta: HlAssetMeta): void {
  if (!Number.isInteger(leverage) || leverage < 1) {
    fail(`Invalid leverage "${leverage}". Must be a positive integer.`);
  }
  if (leverage > assetMeta.maxLeverage) {
    fail(
      `Leverage ${leverage}x exceeds maximum ${assetMeta.maxLeverage}x for ${assetMeta.name}.`,
    );
  }
}

export function validateNotional(size: number, price: number, minNotional = 10): void {
  const notional = size * price;
  if (notional < minNotional) {
    fail(
      `Order notional $${notional.toFixed(2)} is below minimum $${minNotional}. ` +
        'Increase size or price.',
    );
  }
}

export function validateCoin(meta: HlPerpMeta, coin: string): HlAssetMeta {
  const asset = meta.universe.find((a) => a.name.toUpperCase() === coin.toUpperCase());
  if (!asset) {
    const names = meta.universe.map((a) => a.name).join(', ');
    fail(`Coin "${coin}" not found. Available: ${names}`);
  }
  return asset;
}

export function validateAmount(amount: string, context = 'amount'): void {
  const n = parseFloat(amount);
  if (!isFinite(n) || n <= 0) {
    fail(`Invalid ${context} "${amount}". Must be a positive number.`);
  }
}

export function validateBuilderFeeRate(rate: string): void {
  // Expected format: "0.001%" or "0.1%"
  if (!/^\d+(\.\d+)?%$/.test(rate)) {
    fail(`Invalid builder fee rate "${rate}". Expected format: "0.001%"`);
  }
  const n = parseFloat(rate);
  if (n < 0 || n > 100) {
    fail(`Builder fee rate ${rate} is out of range (0–100%).`);
  }
}

/**
 * Validate market order fill price vs slippage tolerance.
 * midPrice: current mid price as string
 * estimatedFill: estimated fill price
 * slippage: percentage (e.g. 1.0 = 1%)
 */
export function checkSlippageBreached(
  side: 'buy' | 'sell',
  midPrice: number,
  estimatedFill: number,
  slippagePct: number,
): void {
  const tolerance = midPrice * (slippagePct / 100);
  if (side === 'buy' && estimatedFill > midPrice + tolerance) {
    fail(
      `Estimated fill price $${estimatedFill.toFixed(4)} exceeds slippage tolerance ` +
        `(mid: $${midPrice.toFixed(4)}, slippage: ${slippagePct}%).`,
    );
  }
  if (side === 'sell' && estimatedFill < midPrice - tolerance) {
    fail(
      `Estimated fill price $${estimatedFill.toFixed(4)} is below slippage tolerance ` +
        `(mid: $${midPrice.toFixed(4)}, slippage: ${slippagePct}%).`,
    );
  }
}
