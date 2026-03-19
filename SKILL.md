---
name: elytro
description: >
  Elytro — security-first ERC-4337 smart account wallet CLI for AI agents.
  On-chain 2FA, configurable spending limits, and cross-platform OS keychain-backed vault
  (macOS Keychain, Windows Credential Manager, Linux Secret Service).
  Send ETH, ERC-20 tokens, and batch transactions via UserOperations on Ethereum,
  Optimism, Arbitrum, and Base. Account abstraction wallet with gas sponsorship,
  counterfactual deployment, social recovery, and guardian management.
  For token swaps, combine this skill with `defi/uniswap` for planning and `defi/elytro` for execution.
  For programmatic consumption by agents and MCP integrations.
version: 0.6.0
homepage: https://elytro.com
metadata:
  openclaw:
    requires:
      bins:
        - elytro
      node: ">=24.0.0"
    emoji: "🔐"
    homepage: https://github.com/Elytro-eth/skills
    os: ["macos", "windows", "linux"]
    install:
      - id: npm
        kind: npm
        package: "@elytro/cli"
        bins: ["elytro"]
        label: "Install Elytro CLI (npm)"
---

# Elytro CLI — Agent Skill

Operate the Elytro smart account wallet from the command line. Every command
returns structured JSON (`{ "success": true/false, ... }`). Parse stdout as
JSON and check the `success` field — never regex-match free-form text.

Install: `npm install -g @elytro/cli` (requires Node >= 24)

---

## Rules

1. **Check for updates at session start.** Run `elytro update check`; inform the user if `updateAvailable` is `true`. Do not auto-upgrade — ask first.
2. **Never guess on-chain data.** Always query balances, tx status, etc. via `elytro query`.
3. **Never auto-confirm prompts.** When a command outputs `(y/N)`, STOP and present the user with a confirmation choice. Wait for explicit approval.
4. **Supported chains**: 1 (Ethereum), 10 (Optimism), 42161 (Arbitrum), 8453 (Base), 11155111 (Sepolia), 11155420 (OP Sepolia). Hex and decimal accepted. Unsupported IDs are rejected with an error listing valid options.
5. **`value` is always in ETH**, not wei. Example: `value:0.001` = 0.001 ETH.
6. **`data` must be valid hex** with `0x` prefix and even length. Use `data:0x` for plain ETH transfers.
7. **Deploy before transacting.** Check `account info` → `deployed: true`. If not, run `account activate` first.
8. **Alias or address work interchangeably** in all `<account>` arguments.
9. **Security is non-negotiable.** Never `tx send` without `hookInstalled: true` AND `emailVerified: true` (from `security status`).
10. **Always create accounts with `--email` and `--daily-limit`.** Omitting them creates an unprotected wallet.
11. **Email binding and spending limits happen AFTER activation.** `security email bind` requires a deployed account. Order: activate → email bind → spending-limit.
12. **`emailBindingStarted: false` on create is expected** — email binding requires deployment; it completes in the email bind step.
13. **Sponsor covers gas, not value.** If sending 0.1 ETH, the account must hold ≥ 0.1 ETH regardless of sponsorship.
14. **Always pass alias/address to `account switch`.** The interactive selector is not agent-compatible.
15. **Parse JSON from every command.** Spinners and prompts go to stderr; stdout is always JSON.

---

## Agent Communication Standard

Every response to the user after running an Elytro command should follow a consistent
structure. The goal is predictability — users should always know where to look for the
status, the important details, and what happens next. Stick to this format regardless
of which agent runtime or framework is executing the skill.

### Response Template

```
<Status Line>      — one sentence: what happened and whether it succeeded
<Key Details>      — the 2-4 most important fields from the result, as a compact list
<Context / Link>   — explorer URL or next-step hint (when applicable)
```

Keep it compact. Agents should not dump raw JSON at the user or narrate every field.
Pull out what matters and discard the rest.

### Per-Operation Formats

**Transaction sent:**

```
✅ Sent 0.05 ETH to 0xAbc…1234 on Optimism.
  Tx: 0xdef…5678
  Gas: 0.00012 ETH (sponsored)
  Explorer: https://optimistic.etherscan.io/tx/0xdef…5678
```

**Transaction simulated:**

```
🧪 Simulation passed — estimated max gas 0.00015 ETH (sponsored).
  No warnings. Safe to proceed.
```

If `warnings` is non-empty, list each warning on its own line prefixed with ⚠️.

**Balance query:**

```
💰 agent-primary on OP Sepolia: 0.482 ETH
```

For token balances, append token symbol and contract: `1,200.00 USDC (0xA0b8…)`.

**Account created / activated:**

```
✅ Account "agent-primary" created on OP Sepolia.
  Address: 0xAbc…1234
  Deployed: false — run `account activate` next.
```

After activation, include `hookInstalled` status and flag any pending security steps.

**Security status:**

```
🔐 Security status for agent-primary:
  Hook installed: ✅  |  Email verified: ✅  |  Daily limit: $100.00
  Ready to transact.
```

If any check fails, replace ✅ with ❌ and add a one-line remediation hint.

**Recovery initiated:**

```
🔁 Recovery started for 0xWallet…1234 on Optimism.
  Guardians: Alice (unsigned), Bob (unsigned), Carol (unsigned) — need 2 of 3
  Share this link with your guardians:
  https://recovery.elytro.com/?id=...
```

**Recovery status:**

```
⏳ Recovery in progress — 1 of 2 required signatures collected.
  Alice ✅  |  Bob ⬜  |  Carol ⬜
  Share the recovery URL with remaining guardians.
```

Once `status` is `SIGNATURE_COMPLETED`:

```
✅ All required signatures collected. Recovery can now be executed.
  Open the Recovery App with a different wallet: https://recovery.elytro.com/?id=...
```

**Errors:**

```
❌ Transaction failed: Insufficient balance (code -32005).
  Account holds 0.02 ETH but the transaction requires 0.05 ETH.
  → Fund the account and retry.
```

Always include: error description, the code, the cause in plain language, and a
concrete next step.

### Communication Principles

- **Lead with outcome, not process.** Say "Sent 0.05 ETH" not "I ran `elytro tx send`
  and received JSON with success true…"
- **Surface explorer links for every on-chain action.** Transactions, deployments,
  and activations all return an `explorer` field — always show it.
- **Translate codes into plain language.** The user doesn't need to know what -32002
  means; they need to know "the account isn't deployed yet."
- **Flag security gaps immediately.** If `hookInstalled`, `emailVerified`, or
  `dailyLimitUsd` is missing/false, call it out before doing anything else —
  don't bury it in a list.
- **For multi-step workflows (e.g. setup, batch sends), number the steps** and
  report each one as it completes so the user can track progress.
- **Never show raw JSON unless the user explicitly asks for it.** Parse it,
  extract what matters, present it in the format above.

---

## Account Lifecycle

```
  no account ──account create──► CREATED (deployed: false)
                                    │
                              account activate
                                    ▼
                               DEPLOYED (hookInstalled: true, email not yet bound)
                                    │
                        security email bind + spending-limit
                                    ▼
                               PROTECTED  ← safe to transact
                                    │
                  (if access lost) recovery initiate + guardians sign
                                    ▼
                               RECOVERING  ← write ops blocked
                                    │
                              recovery completes on-chain
                                    ▼
                               PROTECTED (new controller)
```

| State      | How to verify                                                                         | Safe to transact? |
| ---------- | ------------------------------------------------------------------------------------- | :---------------: |
| CREATED    | `account info` → `deployed: false`                                                    |        No         |
| DEPLOYED   | `account info` → `deployed: true`; `security status` → `emailVerified: false`         |        No         |
| PROTECTED  | `security status` → `hookInstalled: true`, `emailVerified: true`, `dailyLimitUsd` set |      **Yes**      |
| RECOVERING | `account list` → `recovery` field present; write ops return error `-32023`            |        No         |

`account info` shows local + on-chain state. `security status` shows the full security profile (email, spending limit) from the backend.

---

## First-Time Setup

Every step is mandatory. Do not skip or reorder.

```bash
# 1. Initialize — vault key auto-stored in OS credential store
elytro init

# 2. Create account WITH security
elytro account create --chain 11155420 --alias agent-primary \
  --email user@example.com --daily-limit 100

# 3. Activate (deploy + install SecurityHook atomically)
# CHECK: result.hookInstalled MUST be true
elytro account activate agent-primary

# 4. Bind email (INTERACTIVE — human provides OTP from inbox)
elytro security email bind user@example.com

# 5. Set spending limit (INTERACTIVE — another OTP)
elytro security spending-limit 100

# 6. Verify fully protected before transacting
elytro security status
# → hookInstalled: true, emailVerified: true, dailyLimitUsd: "100.00"
```

Before any `tx send`, verify: (1) `deployed: true`, (2) `hookInstalled: true`,
(3) `emailVerified: true`, (4) `dailyLimitUsd` set, (5) sufficient balance.

---

## Command Reference

### `elytro init`

Generates vault key + EOA signing key. Returns `{ status, dataDir, secretProvider }`.
If already initialized: `{ status: "already_initialized" }`.

### Account Commands

#### `account create`

```bash
elytro account create -c <chainId> [-a <alias>] [-e <email>] [-l <dailyLimitUsd>]
```

Returns: `{ alias, address, chain, chainId, deployed: false, security: { email, emailBindingStarted: false, dailyLimitUsd, hookPending } }`.

`emailBindingStarted: false` is always expected for new accounts.
If `security: null` in result, warn user — account has no security configuration.

#### `account activate`

```bash
elytro account activate [alias|address] [--no-sponsor]
```

Deploys wallet + installs SecurityHook atomically. Returns `{ alias, address, transactionHash, hookInstalled, emailPending, dailyLimitPending, sponsored, explorer }`.

**Critical**: Check `hookInstalled`. If `false`, STOP — account is deployed but unprotected. Run `security 2fa install` manually.

`emailPending` and `dailyLimitPending` mean those steps are still outstanding.

If already deployed: `{ status: "already_deployed" }`.

#### `account list`

```bash
elytro account list [-c <chainId>]
```

Returns `{ accounts: [{ active, alias, address, chain, chainId, deployed, recovery }], total }`.

#### `account info`

```bash
elytro account info [alias|address]
```

Live on-chain data. Returns `{ alias, address, chain, chainId, deployed, balance, securityStatus: { hookInstalled }, explorer }`.

Does **not** show email or spending-limit — use `security status` for those.

#### `account rename`

```bash
elytro account rename <alias|address> <newAlias>
```

Returns `{ alias, address, chain, chainId }`. New alias must be unique (case-insensitive).

#### `account switch`

```bash
elytro account switch <alias|address>
```

Always pass alias or address — without arguments it shows an interactive selector.

### Transaction Commands

All use the `--tx` flag: `--tx "to:0xAddr,value:0.1,data:0xAbcDef"`

- `to` required; at least one of `value` or `data` required
- Multiple `--tx` flags = batch (`executeBatch`), order preserved

#### `tx send`

```bash
elytro tx send [account] --tx <spec> [--no-sponsor] [--no-hook] [--userop <json>]
```

Pipeline: resolve account → balance check → build UserOp → sponsor → confirm → sign → send → receipt.

Returns `{ status: "confirmed", transactionHash, gasCost, sponsored, explorer }`.
Cancelled: `{ status: "cancelled" }`. Exit code 1 on error.

```bash
# ETH transfer
elytro tx send --tx "to:0xRecipient,value:0.001"
# Contract call
elytro tx send --tx "to:0xContract,data:0xa9059cbb..."
# Batch
elytro tx send --tx "to:0xA,value:0.1" --tx "to:0xB,data:0xab"
# From specific account
elytro tx send my-alias --tx "to:0xAddr,value:0.01"
```

#### `tx build`

```bash
elytro tx build [account] --tx <spec> [--no-sponsor]
```

Same as `send` but stops before signing. Returns the unsigned UserOp.

#### `tx simulate`

```bash
elytro tx simulate [account] --tx <spec> [--no-sponsor]
```

Dry-run with gas breakdown. Returns `{ gas: { maxCost }, sponsored, balance, warnings }`.
`warnings` array is only present when issues exist. Always simulate before large sends.

### Query Commands

Read-only, no confirmation needed.

```bash
elytro query balance [alias|address]                 # ETH balance
elytro query balance [alias|address] --token 0xAddr  # ERC-20 balance
elytro query tokens [alias|address]                  # All ERC-20 holdings (needs Alchemy key)
elytro query tx <hash>                               # Transaction receipt
elytro query chain                                   # Current chain info
elytro query address <0xAddress>                     # Address type + balance
```

### Security Commands

All require a **deployed** account.

#### `security status`

```bash
elytro security status
```

Returns `{ hookInstalled, hookAddress, capabilities, profile: { email, emailVerified, dailyLimitUsd } }`.

**Use this to verify the account is fully protected before transacting.**

#### `security 2fa install` / `2fa uninstall`

```bash
elytro security 2fa install [--capability <1|2|3>]   # 3=BOTH (default)
elytro security 2fa uninstall [--force [--execute]]
```

Only needed if `activate` was run without security intent. Prefer the atomic create→activate flow.

#### `security email bind`

```bash
elytro security email bind <email>
```

**INTERACTIVE** — requires human OTP. Agent MUST pause and wait.
Returns `{ status: "email_bound", emailVerified: true }`.

#### `security email change`

```bash
elytro security email change <email>
```

**INTERACTIVE** — requires OTP from new email.

#### `security spending-limit`

```bash
elytro security spending-limit           # View current
elytro security spending-limit <usd>     # Set (INTERACTIVE — requires OTP)
```

Registers the daily limit with the backend. The `--daily-limit` from create is a local intent only — this command applies it via OTP.

### Recovery Commands

Social recovery lets trusted guardians restore wallet control when the signing device is lost. Recovery is purely off-chain until guardians approve — no transactions from the recovering device are needed.

**Key concepts:**
- **Contacts (guardians)**: trusted addresses that can approve recovery. Set while you still have access.
- **Threshold**: minimum approvals required to complete recovery.
- **Recovery App**: a web UI where guardians sign the approval. `recovery initiate` returns the URL.
- **RECOVERING state**: once initiated, write operations on the wallet are blocked until recovery completes or is cancelled on-chain.

#### `recovery contacts list`

```bash
elytro recovery contacts list
```

Returns `{ address, chainId, contacts: [{ address, label? }], threshold, contactsHash, nonce, delayPeriod, recoveryInfo? }`.

`recoveryInfo` is present only when the account is in RECOVERING state — it contains `{ status, message }`.

#### `recovery contacts set`

```bash
elytro recovery contacts set <addr1,addr2,...> --threshold <n> [--label "0xAddr=Name,..."] [--privacy]
```

Sets guardian contacts on-chain (UserOperation). Blocked if account is RECOVERING.

- `--threshold`: min approvals required (1 ≤ n ≤ number of contacts)
- `--label`: optional local display names, comma-separated `address=name` pairs
- `--privacy`: store only the hash on-chain; omit plaintext contacts from `InfoRecorder`

Returns `{ status: "contacts_set", txHash, contacts, threshold, contactsHash, privacyMode }`.
If no change from current on-chain state: `{ status: "no_changes" }`.

#### `recovery contacts clear`

```bash
elytro recovery contacts clear
```

Removes all guardian contacts (sets hash to zero). Blocked if account is RECOVERING.

Returns `{ status: "contacts_cleared", txHash }`.

#### `recovery backup export`

```bash
elytro recovery backup export [--output <path>]
```

Exports guardian info + local labels to JSON. Store this file securely — it is needed if the device is lost.

- Without `--output`: returns `{ status: "exported", backup: { ... } }` (inline JSON)
- With `--output <path>`: writes file, returns `{ status: "exported", path }`

#### `recovery backup import`

```bash
elytro recovery backup import <file>
```

Imports guardian contacts and labels from a backup file. Does not modify on-chain state — local labels only.

Returns `{ status: "imported", address, chainId, contacts, threshold }`.

#### `recovery initiate`

```bash
elytro recovery initiate <wallet-address> [--chain-id <n>] [--from-backup <file>]
```

Generates a Recovery App URL. Share this URL with guardians — they open it and sign the approval. No transaction is sent from the recovering device.

- `--chain-id`: target chain (default: current chain)
- `--from-backup`: load guardian list from a backup file (required if contacts were set with `--privacy`)

**Guard**: if the current device already controls the wallet, returns `{ status: "no_recovery_needed" }` immediately — no URL is generated.

Returns `{ walletAddress, chainId, recoveryId, approveHash, contacts: [{ address, signed }], threshold, recoveryUrl }`.

The `recoveryUrl` is the shareable link for guardians. After calling this, the wallet enters RECOVERING state — write operations will be blocked with error `-32023` until recovery completes.

#### `recovery status`

```bash
elytro recovery status
```

Queries current recovery progress from the local record + on-chain state. Returns a `suggestion` array at the top level with concrete next steps based on status.

Returns `{ walletAddress, status, contacts: [{ address, signed }], signedCount, threshold, recoveryUrl, validTime?, remainingSeconds? }`.

**`status` values:**

| Value                  | Meaning                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `WAITING_FOR_SIGNATURE`| Not enough guardians have signed yet                           |
| `SIGNATURE_COMPLETED`  | Threshold reached; recovery can be executed on-chain            |
| `RECOVERY_STARTED`     | Recovery transaction submitted, waiting for delay period        |
| `RECOVERY_READY`       | Delay elapsed; control transfer can be finalized                |
| `RECOVERY_COMPLETED`   | Recovery complete — wallet now controlled by the new device     |

### Configuration

```bash
elytro config show                        # View current config
elytro config set alchemy-key <KEY>       # Set Alchemy API key
elytro config set pimlico-key <KEY>       # Set Pimlico API key
elytro config remove <key>                # Remove a config key
```

### Update

```bash
elytro update check    # Read-only version check → { currentVersion, latestVersion, updateAvailable }
elytro update          # Install latest (auto-detects package manager)
```

Check at session start. If `updateAvailable: true`, show `upgradeCommand` and ask before upgrading.

---

## Output Format

Every command returns JSON to stdout:

```json
{ "success": true, "result": { ... } }
{ "success": false, "error": { "code": -32000, "message": "...", "data": { ... } } }
```

| Code   | Meaning                          |
| ------ | -------------------------------- |
| -32000 | Internal error                   |
| -32001 | Not found                        |
| -32002 | Account not ready                |
| -32003 | Sponsorship failed               |
| -32004 | UserOp build failed              |
| -32005 | Send failed                      |
| -32006 | Execution reverted               |
| -32007 | Hook auth failed                 |
| -32010 | Email not bound                  |
| -32011 | Safety delay pending             |
| -32012 | OTP failed                       |
| -32021 | Recovery: invalid parameters     |
| -32022 | Recovery: no local record found  |
| -32023 | Account is in RECOVERING state   |
| -32602 | Invalid parameters               |

When error code is `-32023`, the response includes a `context.recoveryStatus` field and a `suggestion` array with next steps. Do not attempt write operations — surface the `suggestion` to the user.

---

## Workflow Patterns

### Simulate → Send

```bash
SIM=$(elytro tx simulate --tx "to:0xAddr,value:0.5")
# parse warnings array — empty = safe
elytro tx send --tx "to:0xAddr,value:0.5"
```

### Batch Operations

```bash
elytro tx send \
  --tx "to:0xAlice,value:0.01" \
  --tx "to:0xBob,value:0.02" \
  --tx "to:0xContract,data:0xa9059cbb..."
```

### Multi-Account

```bash
elytro account create --chain 11155420 --alias hot-wallet --email u@x.com --daily-limit 50
elytro account create --chain 11155420 --alias cold-storage --email u@x.com --daily-limit 500
# activate + email bind + spending-limit for EACH account
elytro account switch hot-wallet
elytro account rename hot-wallet daily-spending
```

### Set Up Recovery (while you have access)

Do this before losing device access. Must be done on a PROTECTED account.

```bash
# 1. Set guardians
elytro recovery contacts set 0xGuardian1,0xGuardian2,0xGuardian3 \
  --threshold 2 \
  --label "0xGuardian1=Alice,0xGuardian2=Bob,0xGuardian3=Carol"

# 2. Export backup — store securely (needed if device is lost)
elytro recovery backup export --output ./elytro-recovery-backup.json

# 3. Verify on-chain
elytro recovery contacts list
# → contacts: [...], threshold: 2, contactsHash: 0x...
```

### Initiate Recovery (after losing access)

Run this on the **new device** that should take control.

```bash
# 1. Initialize keyring on new device
elytro init

# 2. Initiate — generates Recovery App URL
elytro recovery initiate 0xWalletAddress [--from-backup ./backup.json]
# → recoveryUrl: https://recovery.elytro.com/?...
# Share this URL with guardians

# 3. Monitor guardian approvals
elytro recovery status
# → status: WAITING_FOR_SIGNATURE, signedCount: 1, threshold: 2
# → suggestion: [{ action: "open https://...", description: "Share link..." }]

# 4. Once SIGNATURE_COMPLETED
# → suggestion: open Recovery App with a different wallet to submit on-chain

# 5. After recovery executes on-chain
elytro recovery status
# → status: RECOVERY_COMPLETED
```

### Token Swap (Uniswap)

Combine `defi/uniswap` (returns calldata + route summary) with Elytro execution:

```bash
elytro query tokens my-wallet
# invoke defi/uniswap → get { target, calldata, valueEth }
elytro tx simulate my-wallet --tx "to:$ROUTER,value:$VALUE_ETH,data:$CALLDATA"
elytro tx send my-wallet --tx "to:$ROUTER,value:$VALUE_ETH,data:$CALLDATA"
```

Never guess swap outputs — always surface exact minimums/routes from `defi/uniswap`.

---

## Error Recovery

| Error                          | Cause                      | Fix                                   |
| ------------------------------ | -------------------------- | ------------------------------------- |
| "Wallet not initialized"       | Missing keyring.json       | `elytro init`                         |
| "Keyring is locked"            | Missing vault key          | Check OS credential store             |
| "Vault key not found"          | Provider ok, key missing   | Re-run `elytro init`                  |
| "No secret provider available" | No keychain/file/env found | See platform hint in error            |
| "insecure permissions"         | .vault-key > 0600          | `chmod 600 ~/.elytro/.vault-key`      |
| "Chain N is not supported"     | Invalid --chain            | Use supported chain from error output |
| "Alias already taken"          | Duplicate alias            | Choose different alias                |
| "Account not deployed"         | Needs deployment           | `elytro account activate`             |
| "Insufficient balance"         | Value > balance            | Fund the account                      |
| `hookInstalled: false`         | Hook batching failed       | `elytro security 2fa install`         |
| "AA21" in error                | UserOp simulation failed   | Usually balance or nonce issue        |
| error code `-32023`            | Account is RECOVERING      | Use `recovery status`; no writes until complete |
| `status: no_recovery_needed`   | Device already controls wallet | No action needed                  |
| `status: no_changes`           | Contacts already match     | No transaction sent                   |
| error code `-32022`            | No local recovery record   | Run `recovery initiate` first         |
