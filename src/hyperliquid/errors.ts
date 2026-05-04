export class HyperliquidError extends Error {
  readonly code: number;
  readonly data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'HyperliquidError';
    this.code = code;
    this.data = data;
  }
}

// ─── HL-specific error codes (extends JSON-RPC convention) ───────────────────

export const HL_ERR_INVALID_PARAMS = -32602;
export const HL_ERR_ACCOUNT_NOT_FOUND = -32002;
export const HL_ERR_AGENT_NOT_CONFIGURED = -32010;
export const HL_ERR_SIGN_FAILED = -32005;
export const HL_ERR_API = -32020;
export const HL_ERR_INSUFFICIENT_FUNDS = -32001;
export const HL_ERR_INTERNAL = -32000;

/**
 * Normalize a Hyperliquid API response body to a consistent error.
 * The API always returns HTTP 200 even on errors — check status field.
 */
export function normalizeHlError(body: unknown, context: string): HyperliquidError {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (b['status'] === 'err') {
      const msg = typeof b['response'] === 'string' ? b['response'] : JSON.stringify(b['response']);
      return new HyperliquidError(HL_ERR_API, `Hyperliquid ${context} error: ${msg}`, {
        raw: b,
      });
    }
  }
  return new HyperliquidError(HL_ERR_API, `Hyperliquid ${context}: unexpected response`, {
    raw: body,
  });
}

export function assertHlOk(body: unknown, context: string): void {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    if (b['status'] === 'err') {
      throw normalizeHlError(body, context);
    }
    if (b['status'] === 'ok') return;
  }
  throw normalizeHlError(body, context);
}
