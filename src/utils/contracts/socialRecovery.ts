import { encodeFunctionData, encodeAbiParameters, parseAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';
import { INFO_RECORDER_ADDRESS, GUARDIAN_INFO_KEY, ABI_RECOVERY_INFO_RECORDER } from '../../constants/recovery';

/**
 * Encode calldata for SocialRecoveryModule.setGuardian(bytes32 guardianHash).
 *
 * Used by both `contacts set` (non-zero hash) and `contacts clear` (zeroHash).
 */
export function encodeSetGuardian(
  guardianHash: Hex,
  recoveryModuleAddress: Address
): { to: Address; value: string; data: Hex } {
  const data = encodeFunctionData({
    abi: [
      {
        type: 'function',
        name: 'setGuardian',
        inputs: [{ name: 'guardianHash', type: 'bytes32' }],
        outputs: [],
        stateMutability: 'nonpayable',
      },
    ] as const,
    functionName: 'setGuardian',
    args: [guardianHash],
  });

  return { to: recoveryModuleAddress, value: '0x0', data };
}

/**
 * Encode calldata for InfoRecorder.recordData(category, data).
 *
 * Stores plaintext guardian contact info on-chain via events.
 * Used by `contacts set` when --privacy is NOT specified.
 *
 * Data format mirrors extension's encodeGuardianInfo:
 *   abi.encode(address[], uint256, bytes32) = contacts, threshold, salt
 */
export function encodeRecordGuardianInfo(
  contacts: string[],
  threshold: number,
  salt: Hex
): { to: Address; value: string; data: Hex } {
  // Encode guardian info payload: (address[], uint256, bytes32)
  const payload = encodeAbiParameters(parseAbiParameters('address[], uint256, bytes32'), [
    contacts as Address[],
    BigInt(threshold),
    salt,
  ]);

  const data = encodeFunctionData({
    abi: ABI_RECOVERY_INFO_RECORDER,
    functionName: 'recordData',
    args: [GUARDIAN_INFO_KEY, payload],
  });

  return { to: INFO_RECORDER_ADDRESS, value: '0x0', data };
}
