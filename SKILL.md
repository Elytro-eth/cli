---
name: elytro
description: >
  Elytro — ERC-4337 smart account wallet CLI for AI agents. On-chain 2FA, spending limits,
  OS keychain vault (macOS/Windows/Linux). Deferred OTP: commands exit with otp_pending;
  complete with `otp submit <id> <code>`. Send ETH/ERC-20, batch tx, gas sponsorship.
  Use when: managing smart accounts, sending transactions, binding email, setting limits,
  or any wallet operation on Ethereum, Optimism, Arbitrum, Base. Combine with defi/uniswap
  for swaps. Node >= 24.
version: 0.6.1
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

Operate the Elytro smart account wallet. Prefer structured JSON over scraping free-form text.

Install: `npm install -g @elytro/cli` (Node >= 24)

**Command reference**: [references/commands.md](references/commands.md) — exact flags (`-c` / `--chain`), return shapes, high-risk commands, error codes.

---

## Parsing CLI output (critical)

| Stream | Content |
|--------|---------|
| **stdout** | Success payload: `{ "success": true, "result": { ... } }`. Always parse `result` (and `success`). |
| **stderr** | **Errors:** `{ "success": false, "error": { "code", "message", "data?" } }` (process exits **1**). Also: `ora` spinners, optional `tx send` preflight summary JSON, OTP helper text — **do not** treat stderr as the only command result. |

**Agent implementation:** Capture **both** stdout and stderr. On exit code **0**, parse stdout JSON. On **non-zero**, parse stderr for `error.code` / `error.message` (and `error.data` hints). Never assume failures appear on stdout.

---

## Rules

1. **Update check at session start.** Run `elytro update check`; inform if `updateAvailable`. Do not auto-upgrade.
2. **Never guess on-chain data.** Use `elytro query` (balance, tokens, chain, tx, address).
3. **User approval for high-risk commands.** The CLI has no yes/no prompts. Before any command under **Agent: user approval before running** in `references/commands.md`, obtain explicit user confirmation.
4. **OTP is deferred.** After a **successful** parse, if `result.status === "otp_pending"`, read `result.otpPending` (`id`, `submitCommand`, `maskedEmail`). Tell the user to check email and run `otp submit` **only after they paste the code**. Do not busy-wait for email inside the tool loop.
5. **Chains**: 1, 10, 42161, 8453, 11155111, 11155420. `value` in **ETH** (decimal). `data` is hex with `0x` prefix.
6. **Deploy before tx.** `account info` → `deployed: true`. Else `account activate` (see user approval in `commands.md`).
7. **Security for normal sends.** Before routine `tx send`, confirm `security status`: `hookInstalled` and `emailVerified`. **Exception:** `tx send --no-hook` bypasses the hook — only with explicit user approval and never as a default.
8. **Recommended create path.** Use `-e` / `--email` and `-l` / `--daily-limit` on `account create`. Typical order: create → activate → `security email bind` (if not already verified) → `security spending-limit` → `security status`.
9. **Non-interactive / headless agents.** Always pass an **account** argument to `account switch`, `tx simulate`, and `tx send` when multiple accounts exist. Omitting it can open an interactive picker (TTY) and **hang** automated runners.
10. **Clear, inclusive explanations.** Summarize outcomes in plain language for the user. Call out security gaps, costs, and irreversible steps. Emojis in templates below are optional — replace with text if the user prefers accessible, screen-reader-friendly output.

---

## Agent Communication

**Template**: `<Status> — <Key details> — <Explorer/next step>`

Keep compact. Never dump raw JSON unless asked.

### Formats

| Operation | Format |
|-----------|--------|
| Tx sent | `✅ Sent 0.05 ETH to 0xAbc…1234. Tx: 0xdef… Explorer: <url>` |
| Simulated | Short summary from `tx simulate` **result**: include `gas.maxCost`, `sponsored` (yes/no), `balance`, and **every** `warnings[]` line; if no warnings, say so explicitly. |
| Balance | `💰 agent-primary: 0.482 ETH` |
| OTP pending | `🔐 OTP sent to <maskedEmail>. Run: elytro otp submit <id> <code>` (user must paste the code from email). |
| Error | `❌ <description> (code -32xxx). → <fix>` — use `error.data` from stderr when present (`hint`, `supportedChains`, etc.). |

**Principles**: Lead with outcome. Surface explorer links from `result` when present. Map error codes using `references/commands.md`. Flag security gaps (`hookInstalled`, `emailVerified`, limits) before suggesting sends. Show raw JSON only if the user asks.

---

## Account Lifecycle

```
create → activate → email bind + spending-limit → PROTECTED
```

| State | Verify | Safe to tx? |
|-------|--------|:-----------:|
| CREATED | `deployed: false` | No |
| DEPLOYED | `deployed: true`, `emailVerified: false` | No |
| PROTECTED | `hookInstalled`, `emailVerified`, `dailyLimitUsd` | **Yes** |

---

## First-Time Setup

```bash
elytro init
elytro account create -c 11155420 -a agent-primary -e u@x.com -l 100
elytro account activate agent-primary   # User-approved: deploys account; CHECK hookInstalled in result
elytro security email bind u@x.com      # → otp_pending; user runs otp submit <id> <code>
elytro security spending-limit 100      # → otp_pending if setting limit; user runs otp submit
elytro security status                  # Verify: hookInstalled, emailVerified, dailyLimitUsd
```

Before `tx send`: (1) deployed, (2) hookInstalled, (3) emailVerified, (4) dailyLimitUsd set, (5) sufficient balance.

---

## Workflow Patterns

**Simulate → user confirmation → Send** (required agent pattern; see `references/commands.md`)

```bash
elytro tx simulate <account> --tx "to:0xAddr,value:0.5"
# Present gas.maxCost, sponsored, balance, warnings to the user; wait for explicit OK
elytro tx send <account> --tx "to:0xAddr,value:0.5"   # same account and --tx / sponsor flags as simulate
```

For **batch** sends, use the same **number and order** of `--tx` arguments in simulate and send.

**`elytro init`:** If `result.vaultSecret` appears (no OS keychain), tell the user to store it safely once; do not treat it as routine log output.

**Deferred OTP** (email bind, spending-limit, tx send when limit exceeded, 2fa uninstall)
```bash
elytro security email bind u@x.com
# Parse result.otpPending.id, result.otpPending.submitCommand
# User checks email → elytro otp submit <id> <code>
```

**Batch**
```bash
elytro tx simulate <account> --tx "to:0xA,value:0.01" --tx "to:0xB,value:0.02"
elytro tx send <account> --tx "to:0xA,value:0.01" --tx "to:0xB,value:0.02"
```

**Token swap** (with defi/uniswap): Build calldata off-chain → same **simulate → confirm → send** pattern with `--tx "to:router,data:0x..."` (and `value` if native ETH is sent).

**Environment (CI / servers):** `ELYTRO_VAULT_SECRET`, optional `ELYTRO_ALCHEMY_KEY` / `ELYTRO_PIMLICO_KEY`; see project README. Agents should not echo secrets in chat.

---

## Error Recovery

| Symptom / message | Fix |
|-------------------|-----|
| Wallet not initialized | `elytro init` |
| Vault key / credential missing | OS keychain or `ELYTRO_VAULT_SECRET` per README |
| Account not deployed | `elytro account activate` (user-approved) |
| Insufficient balance / `-32001` | Fund smart account; re-check with `query balance` |
| Sponsorship / `-32003` | Balance or paymaster; try `--no-sponsor` if user pays gas |
| Build / estimate / `-32004` | Fix `--tx` spec; check chain and deployment |
| Send / `-32005` | Bundler/network; retry or check RPC keys |
| Execution reverted / `-32006` | On-chain revert; fix calldata or simulate first |
| `hookInstalled: false` | `elytro security 2fa install` (user-approved) |
| Chain not supported / `-32602` `supportedChains` | Pick a chain from `error.data` |
| Alias conflict | Choose another alias |
| OTP / session mismatch | Same account as initiator; `otp list`; re-run origin command if expired |
| Unknown OTP id | `otp list` |
| AA21 (bundler) | Balance or nonce; run `tx simulate` |

Full numeric codes: [references/commands.md](references/commands.md#error-codes).
