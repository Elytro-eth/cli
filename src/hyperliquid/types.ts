import type { Address } from 'viem';
import type { HlNetwork } from './constants.js';

// ─── Account Mapping ─────────────────────────────────────────────────────────

export interface HlAccountInfo {
  elytroAccountAddress: Address;
  elytroOwnerAddress: Address;
  hlMainAddress: Address;
  agentAddress?: Address;
  agentName?: string;
  network: HlNetwork;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface HlAgentInfo {
  agentAddress: Address;
  agentName: string;
  ownerAddress: Address;
  authorizedAt: string;
  network: HlNetwork;
}

// ─── Order Types ──────────────────────────────────────────────────────────────

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit';
export type OrderTif = 'Gtc' | 'Ioc' | 'Alo';
export type TpslType = 'tp' | 'sl';
export type Grouping = 'na' | 'normalTpsl' | 'positionTpsl';

export interface LimitOrderType {
  limit: { tif: OrderTif };
}

export interface TriggerOrderType {
  trigger: {
    isMarket: boolean;
    triggerPx: string;
    tpsl: TpslType;
  };
}

export type HlOrderType = LimitOrderType | TriggerOrderType;

/** Raw order object sent to Hyperliquid exchange API */
export interface HlOrder {
  a: number;      // asset index
  b: boolean;     // isBuy
  p: string;      // price (string for precision)
  s: string;      // size (string)
  r: boolean;     // reduceOnly
  t: HlOrderType;
  c?: string;     // cloid (optional 128-bit hex)
}

export interface HlBuilderRef {
  b: Address;     // builder address
  f: number;      // fee in tenths of basis points
}

export interface PlaceOrderAction {
  type: 'order';
  orders: HlOrder[];
  grouping: Grouping;
  builder?: HlBuilderRef;
}

export interface CancelOrderAction {
  type: 'cancel';
  cancels: Array<{ a: number; o: number }>;
}

export interface CancelByCloidAction {
  type: 'cancelByCloid';
  cancels: Array<{ asset: number; cloid: string }>;
}

export interface ModifyOrderAction {
  type: 'modify';
  oid: number | string;
  order: HlOrder;
}

export interface UpdateLeverageAction {
  type: 'updateLeverage';
  asset: number;
  isCross: boolean;
  leverage: number;
}

export interface UpdateIsolatedMarginAction {
  type: 'updateIsolatedMargin';
  asset: number;
  isBuy: boolean;
  ntli: number;
}

// ─── User-Signed Actions (fund movement / account management) ────────────────

export interface UsdSendAction {
  type: 'usdSend';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  destination: string;
  amount: string;
  time: number;
}

export interface SpotSendAction {
  type: 'spotSend';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  destination: string;
  token: string;
  amount: string;
  time: number;
}

export interface Withdraw3Action {
  type: 'withdraw3';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  amount: string;
  time: number;
  destination: string;
}

export interface UsdClassTransferAction {
  type: 'usdClassTransfer';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  amount: string;
  toPerp: boolean;
  nonce: number;
}

export interface ApproveAgentAction {
  type: 'approveAgent';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  agentAddress: string;
  agentName: string;
  nonce: number;
}

export interface ApproveBuilderFeeAction {
  type: 'approveBuilderFee';
  hyperliquidChain: HlNetwork;
  signatureChainId: string;
  maxFeeRate: string;
  builder: string;
  nonce: number;
}

// ─── Signature ────────────────────────────────────────────────────────────────

export interface HlSignature {
  r: string;
  s: string;
  v: number;
}

export interface HlExchangeRequest {
  action: Record<string, unknown>;
  nonce: number;
  signature: HlSignature;
  vaultAddress?: string;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface HlApiResponse<T = unknown> {
  status: 'ok' | 'err';
  response?: T;
}

export interface HlOrderStatus {
  resting?: { oid: number };
  filled?: { totalSz: string; avgPx: string; oid: number };
  error?: string;
}

export interface HlOrderResponse {
  type: 'order';
  data: { statuses: HlOrderStatus[] };
}

// ─── Info Response Types ──────────────────────────────────────────────────────

export interface HlAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean;
}

export interface HlPerpMeta {
  universe: HlAssetMeta[];
}

export interface HlAssetContext {
  dayNtlVlm: string;
  funding: string;
  impactPxs: [string, string];
  markPx: string;
  midPx: string | null;
  openInterest: string;
  oraclePx: string;
  premium: string | null;
  prevDayPx: string;
}

export interface HlPosition {
  coin: string;
  cumFunding: { allTime: string; sinceChange: string; sinceOpen: string };
  entryPx: string | null;
  leverage: { rawUsd: string; type: 'cross' | 'isolated'; value: number };
  liquidationPx: string | null;
  marginUsed: string;
  maxLeverage: number;
  positionValue: string;
  returnOnEquity: string;
  szi: string;
  unrealizedPnl: string;
}

export interface HlMarginSummary {
  accountValue: string;
  totalMarginUsed: string;
  totalNtlPos: string;
  totalRawUsd: string;
}

export interface HlClearinghouseState {
  assetPositions: Array<{ position: HlPosition; type: string }>;
  crossMaintenanceMarginUsed: string;
  crossMarginSummary: HlMarginSummary;
  marginSummary: HlMarginSummary;
  time: number;
  withdrawable: string;
}

export interface HlOpenOrder {
  coin: string;
  isPositionTpsl: boolean;
  isTrigger: boolean;
  limitPx: string;
  oid: number;
  orderType: string;
  origSz: string;
  reduceOnly: boolean;
  side: 'A' | 'B';
  sz: string;
  timestamp: number;
  triggerCondition: string;
  triggerPx: string;
}

export interface HlSpotToken {
  name: string;
  szDecimals: number;
  weiDecimals: number;
  index: number;
  tokenId: string;
  isCanonical: boolean;
}

export interface HlSpotMeta {
  tokens: HlSpotToken[];
  universe: Array<{ name: string; tokens: number[]; index: number; isCanonical: boolean }>;
}

export interface HlSpotBalance {
  coin: string;
  hold: string;
  token: number;
  total: string;
  entryNtl: string;
}

export interface HlSpotClearinghouseState {
  balances: HlSpotBalance[];
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export interface OrderPreview {
  action: string;
  coin: string;
  side: OrderSide;
  orderType: OrderType;
  estimatedSize: string;
  estimatedPrice: string;
  estimatedFee: string;
  estimatedNotional: string;
  slippage?: string;
  reduceOnly: boolean;
  hlMainAddress: string;
  signerAddress: string;
  signerRole: 'main-account' | 'agent';
  network: HlNetwork;
}

export interface FundPreview {
  action: string;
  amount: string;
  fromAddress?: string;
  toAddress?: string;
  fee?: string;
  estimatedTime?: string;
  network: HlNetwork;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export interface HlApprovedBuilder {
  builder: Address;
  maxFeeRate: string;
}
