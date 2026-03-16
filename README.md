# Elytro CLI

A command-line interface for ERC-4337 smart account wallets. Built for power users and AI agents managing smart accounts across multiple chains.

## Installation

```bash
npm install -g @elytro/cli
# or
bun add -g @elytro/cli
# or
pnpm add -g @elytro/cli
```

## Quick Start

```bash
# Initialize wallet (creates vault + EOA)
elytro init

# Create a smart account on OP Sepolia
elytro account create --chain 11155420 --email user@example.com --daily-limit 100

# Send a transaction
elytro tx send --tx "to:0xRecipient,value:0.1"

# Check balance
elytro query balance
```

## Key Features

- **Multi-account management** — Create multiple smart accounts per chain with user-friendly aliases
- **Zero-interaction security** — macOS/Linux/Windows: vault key stored in system keychain via `@napi-rs/keyring`; fallback: inject via `ELYTRO_VAULT_SECRET`
- **Flexible transaction building** — Single transfers, batch operations, contract calls via unified `--tx` syntax
- **Transaction simulation** — Preview gas, paymaster sponsorship, and balance impact before sending
- **Cross-chain support** — Manage accounts across Ethereum, Optimism, Arbitrum, Base, and testnets
- **SecurityHook (2FA)** — Install on-chain 2FA with email OTP and daily spending limits
- **Self-updating** — `elytro update` detects your package manager and upgrades in place

## Supported Chains

| Chain            | Chain ID  |
| ---------------- | --------- |
| Ethereum         | 1         |
| Optimism         | 10        |
| Arbitrum One     | 42161     |
| Base             | 8453      |
| Sepolia          | 11155111  |
| Optimism Sepolia | 11155420  |

Public RPC and bundler endpoints are used by default. Provide your own Alchemy/Pimlico keys for higher rate limits.

## Architecture

| Component          | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| **SecretProvider** | Vault key management (Keychain / env var)        |
| **KeyringService** | EOA encryption + decryption (AES-GCM)            |
| **AccountService** | Smart account lifecycle (CREATE2, multi-account) |
| **SdkService**     | `@elytro/sdk` wrapper (UserOp building)          |
| **FileStore**      | Persistent state (`~/.elytro/`)                  |

## Security Model

- **No plaintext keys on disk** — vault key stored in system keychain or injected at runtime
- **AES-GCM encryption** — all private keys encrypted with vault key before storage
- **Consume-once env var** — `ELYTRO_VAULT_SECRET` deleted from process after load
- **Memory cleanup** — all key buffers zeroed after use

## Configuration

| Variable              | Purpose                                   | Required             |
| --------------------- | ----------------------------------------- | -------------------- |
| `ELYTRO_VAULT_SECRET` | Base64 vault key (non-keychain platforms) | Yes, if no keychain  |
| `ELYTRO_ALCHEMY_KEY`  | Alchemy RPC endpoint                      | Optional (rate limit)|
| `ELYTRO_PIMLICO_KEY`  | Bundler + paymaster                       | Optional (rate limit)|
| `ELYTRO_ENV`          | `development` or `production`             | Optional             |

Persist API keys:
```bash
elytro config set alchemy-key <key>
elytro config set pimlico-key <key>
```

## Commands

```bash
# Account Management
elytro account create --chain <chainId> [--alias name] [--email addr] [--daily-limit amount]
elytro account list [alias|address]
elytro account info [alias|address]
elytro account switch [alias|address]
elytro account activate [alias|address]   # Deploy to chain

# Transactions
elytro tx send --tx "to:0xAddr,value:0.1" [--tx ...]
elytro tx build --tx "to:0xAddr,data:0xab..."
elytro tx simulate --tx "to:0xAddr,value:0.1"

# Queries
elytro query balance [account] [--token erc20Addr]
elytro query tokens [account]
elytro query tx <hash>
elytro query chain
elytro query address <address>

# Security (2FA + spending limits)
elytro security status
elytro security 2fa install [--capability 1|2|3]
elytro security 2fa uninstall
elytro security 2fa uninstall --force           # Start safety-delay countdown
elytro security 2fa uninstall --force --execute # Execute after delay
elytro security email bind <email>
elytro security email change <email>
elytro security spending-limit [amount]         # View or set daily USD limit

# Updates
elytro update              # Check and upgrade to latest
elytro update check        # Check without installing

# Config
elytro config set <key> <value>
elytro config get <key>
elytro config list
```

## Development

```bash
bun install
bun dev <command>      # Run from source
bun run build          # Build to dist/
bun run test           # Smoke tests
```
