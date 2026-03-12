# Elytro CLI

A command-line interface for ERC-4337 smart account wallets. Built for power users and AI Agents managing smart accounts across multiple chains.

## Quick Start

```bash
# Initialize wallet (creates vault + EOA)
bun dev init

# Create a smart account on Sepolia
bun dev account create --chain 11155420 --email user@example.com --daily-limit 100

# Send a transaction
bun dev tx send --tx "to:0xRecipient,value:0.1"

# Check balance
bun dev query balance
```

## Key Features

- **Multi-account management** — Create multiple smart accounts per chain with user-friendly aliases
- **Zero-interaction security** — macOS: vault key stored in Keychain; non-macOS: injected via `ELYTRO_VAULT_SECRET`
- **Flexible transaction building** — Single transfers, batch operations, contract calls via unified `--tx` syntax
- **Transaction simulation** — Preview gas, paymaster sponsorship, and balance impact before sending
- **Cross-chain support** — Manage accounts across Sepolia, OP Sepolia, Arbitrum, and custom networks
- **Security intents** — Declare email/spending limits at account creation; deployed atomically on activation

## Architecture

| Component          | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| **SecretProvider** | Vault key management (Keychain/env var)          |
| **KeyringService** | EOA encryption + decryption (AES-GCM)            |
| **AccountService** | Smart account lifecycle (CREATE2, multi-account) |
| **SdkService**     | @elytro/sdk wrapper (UserOp building)            |
| **FileStore**      | Persistent state (`~/.elytro/`)                  |

See [docs/architecture.md](docs/architecture.md) for detailed data flow.

## Security Model

- **No plaintext keys on disk** — vault key stored in macOS Keychain or injected at runtime
- **AES-GCM encryption** — all private keys encrypted with vault key before storage
- **Consume-once env var** — `ELYTRO_VAULT_SECRET` deleted from process after load
- **Memory cleanup** — all key buffers zeroed after use

See [docs/security.md](docs/security.md) for threat model.

## Configuration

| Variable              | Purpose                       | Required       |
| --------------------- | ----------------------------- | -------------- |
| `ELYTRO_VAULT_SECRET` | Base64 vault key (non-macOS)  | Yes, non-macOS |
| `ELYTRO_ALCHEMY_KEY`  | Alchemy RPC endpoint          | For queries    |
| `ELYTRO_PIMLICO_KEY`  | Bundler + paymaster           | For tx send    |
| `ELYTRO_ENV`          | `development` or `production` | Optional       |

Persist API keys: `bun dev config set alchemy-key <key>`

## Commands

```bash
# Account Management
bun dev account create --chain 11155420 [--alias name] [--email addr] [--daily-limit amount]
bun dev account list [alias|address]
bun dev account info [alias|address]
bun dev account switch [alias|address]
bun dev account activate [alias|address]  # Deploy to chain

# Transactions
bun dev tx send --tx "to:0xAddr,value:0.1" [--tx ...]
bun dev tx build --tx "to:0xAddr,data:0xab..."
bun dev tx simulate --tx "to:0xAddr,value:0.1"

# Queries
bun dev query balance [account] [--token erc20Addr]
bun dev query tokens [account]
bun dev query tx <hash>
bun dev query chain
bun dev query address <address>
```

## Development

```bash

```
