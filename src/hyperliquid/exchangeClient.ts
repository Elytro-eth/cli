import type { Address } from 'viem';
import { HlClient } from './client.js';
import { assertHlOk, HyperliquidError, HL_ERR_API } from './errors.js';
import type { KeyringService } from '../services/keyring.js';
import {
  signL1Action,
  signUsdSend,
  signSpotSend,
  signWithdraw,
  signUsdClassTransfer,
  signApproveAgent,
  signApproveBuilderFee,
} from './signing.js';
import type {
  HlOrder,
  HlBuilderRef,
  Grouping,
  HlOrderResponse,
  HlExchangeRequest,
  HlSignature,
} from './types.js';
import type { HlNetwork } from './constants.js';
import { ARBITRUM_CHAIN_ID_HEX } from './constants.js';

/**
 * Signed Hyperliquid exchange client.
 * Every method that modifies state requires a keyring with the appropriate
 * signer loaded (agent key for trading, owner key for fund actions).
 */
export class HlExchangeClient {
  private readonly client: HlClient;
  private readonly network: HlNetwork;

  constructor(network: HlNetwork) {
    this.client = new HlClient(network);
    this.network = network;
  }

  private now(): number {
    return Date.now();
  }

  private async send(
    action: Record<string, unknown>,
    signature: HlSignature,
    nonce: number,
    vaultAddress?: string,
  ): Promise<unknown> {
    const payload: HlExchangeRequest = {
      action,
      nonce,
      signature,
      ...(vaultAddress ? { vaultAddress } : {}),
    };

    const result = await this.client.exchange<{ status: string; response?: unknown }>(
      payload as unknown as Record<string, unknown>,
    );
    assertHlOk(result, action['type'] as string);
    return result;
  }

  // ─── Trading Actions (Scheme 1 — agent signs) ────────────────────────────

  async placeOrder(
    keyring: KeyringService,
    params: {
      orders: HlOrder[];
      grouping?: Grouping;
      builder?: HlBuilderRef;
      vaultAddress?: string;
    },
  ): Promise<HlOrderResponse> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'order',
      orders: params.orders,
      grouping: params.grouping ?? 'na',
      ...(params.builder ? { builder: params.builder } : {}),
    };

    const sig = await signL1Action(keyring, action, nonce, this.network, params.vaultAddress);
    const result = await this.send(action, sig, nonce, params.vaultAddress);
    return (result as { response: HlOrderResponse }).response;
  }

  async cancelOrder(
    keyring: KeyringService,
    cancels: Array<{ a: number; o: number }>,
    vaultAddress?: string,
  ): Promise<{ statuses: string[] }> {
    const nonce = this.now();
    const action: Record<string, unknown> = { type: 'cancel', cancels };
    const sig = await signL1Action(keyring, action, nonce, this.network, vaultAddress);
    const result = await this.send(action, sig, nonce, vaultAddress);
    return (result as { response: { data: { statuses: string[] } } }).response.data;
  }

  async cancelByCloid(
    keyring: KeyringService,
    cancels: Array<{ asset: number; cloid: string }>,
    vaultAddress?: string,
  ): Promise<{ statuses: string[] }> {
    const nonce = this.now();
    const action: Record<string, unknown> = { type: 'cancelByCloid', cancels };
    const sig = await signL1Action(keyring, action, nonce, this.network, vaultAddress);
    const result = await this.send(action, sig, nonce, vaultAddress);
    return (result as { response: { data: { statuses: string[] } } }).response.data;
  }

  async updateLeverage(
    keyring: KeyringService,
    params: { asset: number; isCross: boolean; leverage: number },
    vaultAddress?: string,
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'updateLeverage',
      asset: params.asset,
      isCross: params.isCross,
      leverage: params.leverage,
    };
    const sig = await signL1Action(keyring, action, nonce, this.network, vaultAddress);
    await this.send(action, sig, nonce, vaultAddress);
  }

  async updateIsolatedMargin(
    keyring: KeyringService,
    params: { asset: number; isBuy: boolean; ntli: number },
    vaultAddress?: string,
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'updateIsolatedMargin',
      asset: params.asset,
      isBuy: params.isBuy,
      ntli: params.ntli,
    };
    const sig = await signL1Action(keyring, action, nonce, this.network, vaultAddress);
    await this.send(action, sig, nonce, vaultAddress);
  }

  // ─── Fund Actions (Scheme 2 — main account signs) ────────────────────────

  async usdSend(
    keyring: KeyringService,
    params: { destination: Address; amount: string },
  ): Promise<void> {
    const time = this.now();
    const action: Record<string, unknown> = {
      type: 'usdSend',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      destination: params.destination.toLowerCase(),
      amount: params.amount,
      time,
    };
    const sig = await signUsdSend(keyring, {
      destination: params.destination,
      amount: params.amount,
      time,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, time);
  }

  async spotSend(
    keyring: KeyringService,
    params: { destination: Address; token: string; amount: string },
  ): Promise<void> {
    const time = this.now();
    const action: Record<string, unknown> = {
      type: 'spotSend',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      destination: params.destination.toLowerCase(),
      token: params.token,
      amount: params.amount,
      time,
    };
    const sig = await signSpotSend(keyring, {
      destination: params.destination,
      token: params.token,
      amount: params.amount,
      time,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, time);
  }

  async withdraw(
    keyring: KeyringService,
    params: { destination: Address; amount: string },
  ): Promise<void> {
    const time = this.now();
    const action: Record<string, unknown> = {
      type: 'withdraw3',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      amount: params.amount,
      time,
      destination: params.destination.toLowerCase(),
    };
    const sig = await signWithdraw(keyring, {
      destination: params.destination,
      amount: params.amount,
      time,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, time);
  }

  async usdClassTransfer(
    keyring: KeyringService,
    params: { amount: string; toPerp: boolean },
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'usdClassTransfer',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      amount: params.amount,
      toPerp: params.toPerp,
      nonce,
    };
    const sig = await signUsdClassTransfer(keyring, {
      amount: params.amount,
      toPerp: params.toPerp,
      nonce,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, nonce);
  }

  async approveAgent(
    keyring: KeyringService,
    params: { agentAddress: Address; agentName: string },
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'approveAgent',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      agentAddress: params.agentAddress.toLowerCase(),
      agentName: params.agentName,
      nonce,
    };
    const sig = await signApproveAgent(keyring, {
      agentAddress: params.agentAddress,
      agentName: params.agentName,
      nonce,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, nonce);
  }

  async approveBuilderFee(
    keyring: KeyringService,
    params: { builder: Address; maxFeeRate: string },
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'approveBuilderFee',
      hyperliquidChain: this.network,
      signatureChainId: ARBITRUM_CHAIN_ID_HEX,
      maxFeeRate: params.maxFeeRate,
      builder: params.builder.toLowerCase(),
      nonce,
    };
    const sig = await signApproveBuilderFee(keyring, {
      maxFeeRate: params.maxFeeRate,
      builder: params.builder,
      nonce,
      hyperliquidChain: this.network,
    });
    await this.send(action, sig, nonce);
  }

  async hip3LiquidatorTransfer(
    keyring: KeyringService,
    params: { dex: string; ntl: number; isDeposit: boolean },
    vaultAddress?: string,
  ): Promise<void> {
    const nonce = this.now();
    const action: Record<string, unknown> = {
      type: 'hip3LiquidatorTransfer',
      dex: params.dex,
      ntl: params.ntl,
      isDeposit: params.isDeposit,
    };
    const sig = await signL1Action(keyring, action, nonce, this.network, vaultAddress);
    await this.send(action, sig, nonce, vaultAddress);
  }
}
