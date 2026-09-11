# Pact

**Mutual B2B engagement on-chain. Propose, commit, deliver, get paid — with reputation that's yours forever.**

Pact is a B2B engagement platform where two businesses propose, commit, and settle work in USDC using one of six contract templates. Terms live on ENS as text records, escrow is enforced on-chain, and every completed engagement writes a permanent, portable reputation record — one that outlives Pact itself.

---

## The problem

Two small businesses working together today rely on emailed Word docs, PayPal invoices, and hope:

1. **Disputes over what was agreed** — ~40% of B2B payment delays are documentation disputes. There's no shared source of truth.
2. **Reputation locked to a platform** — Upwork/Fiverr history disappears if the platform bans you or shuts down.
3. **No mutual commitment** — clientflow tools (HoneyBook, Bonsai, Dubsado) are one-sided. The provider sends a contract and hopes the client pays; the client has no skin in the game.

Pact fixes all three: both parties fund USDC escrow before work starts, terms are ENS text records anyone can verify, and reputation is an on-chain event log neither party nor Pact controls.

---

## How it works (end-to-end)

1. **Identity** — Sign in with email (Privy embedded wallet, no seed phrase). Mint `<slug>.pact.eth` with EAC fuses burned so Pact cannot revoke it. Pass World Selfie Check once; session ID written to `pact:world-verified`.
2. **Propose** — Pick one of six templates (or the guided custom builder), fill 4–6 fields, preview the exact ENS text records that will be written.
3. **Both sign** — Counterparty opens the proposal link, resolves the terms live from ENS ("Verify on ENS" — pure client-side, no backend), and signs. USDC funds `PactEscrow`. An engagement subname (`eng-<hex>.pact.eth`) is minted.
4. **Work happens** — Provider submits a completion notice. Counterparty has a configured acceptance window (48h–7 days).
5. **Release (backend-optional)** — `PactEscrow.releaseMilestone()` is callable directly by the accepting party's wallet. If the window lapses, `autoRelease()` fires instead (callable by anyone, e.g. a Privy session signer). Pact's server is never in the critical path of fund release.
6. **Reputation** — On completion, `PactCompleted` emits both parties' ENS subnames, template type, value, an `onTime` flag, and a `disputed` flag. This event *is* the reputation record — reproducible by anyone from the block explorer.

---

## The six templates

| # | Template | Use case | Payment structure |
|---|---|---|---|
| 1 | Fixed Delivery | One deliverable, one price | 50% upfront, 50% on acceptance |
| 2 | Milestone | Phased project (2–5 checkpoints) | Escrowed and released per milestone |
| 3 | Retainer | Reserved monthly capacity | Privy session signer auto-releases monthly |
| 4 | Time & Materials | Hourly/daily rate, flexible scope | Pre-funded ceiling; auto-release after 48h dispute window |
| 5 | Recurring Delivery | Same deliverable every period | Auto-released per period |
| 6 | Split Delivery | Two providers, one client | Atomic on-chain split (basis points) |

A seventh path — a 6-question guided **custom builder** — covers everything else and maps to the nearest template's ENS schema, so every engagement produces the same machine-readable record regardless of how it was created.

---

## Architecture

```
Next.js (App Router, TS, Tailwind) ── Privy embedded wallets/session signers
        │
        ├── PactRegistry.sol   business identity + engagement creation/signing
        ├── PactEscrow.sol     USDC escrow, milestone release, split release
        ├── ENSv2 (Sepolia)    <slug>.pact.eth (business) / eng-<hex>.pact.eth (engagement)
        └── World Selfie Check identity activation + high-value milestone acceptance
```

**Design philosophy: backend.** A Node/Express + Supabase backend exists for proposal storage, notifications, and a reputation-events cache — but it mirrors on-chain state and is never required for fund release or terms verification. If Pact's server disappears, `releaseMilestone()`, `autoRelease()`, and ENS resolution keep working.

---

## Repo layout

```
pact/
  contracts/     PactRegistry.sol, PactEscrow.sol — Solidity 0.8.24, Foundry
  ens/            ENSv2 scripts (subname minting, text records) — shares contracts/ ABI
  backend/        Express + TS + Supabase — proposals, notifications, reputation indexing
  frontend/       Next.js 14, TypeScript, Tailwind — lib/stubs.ts isolates Privy/World/ENS integrations
```

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind, `viem` |
| Auth + wallets | Privy — embedded wallets, session signers, key quorums, gas sponsorship |
| Identity/terms | ENSv2 NameWrapper (Sepolia), `@ensdomains/ensjs`, ENSIP-5 text records, EAC fuses |
| Contracts | Solidity ^0.8.24, Foundry |
| Human verification | World Selfie Check browser SDK |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL via Supabase (cache only — on-chain is authoritative) |
| Email | Resend |
| Deployment | Vercel (frontend), Railway (backend), Sepolia (contracts/ENS) |

---

## Current build status

**Smart contracts** — `PactRegistry.sol` and `PactEscrow.sol` compile cleanly on solc 0.8.24. Implemented: business registration with World proof, mutual engagement creation and dual-signature flow, milestone escrow with order-independent pair nonces, `highValueThreshold`-gated releases, `autoRelease` (the FilePizza mechanic), atomic split delivery via basis-point shares, and `PactCompleted` as the on-chain reputation record.

**Frontend** — Full Next.js 14 scaffold (App Router, TypeScript, Tailwind) with six screens: landing, identity setup, template picker, dynamic template form with terms preview, and supporting infrastructure. Paper/ledger aesthetic — dark ink `#14171C`, brass `#C89B5C`, verified teal `#5C9C8F`; Fraunces + IBM Plex Sans.

**Open gap:** `_subnameOf` in `PactEscrow` currently returns the *engagement-level* ENS subname rather than each business's individual subname (e.g. `studio.pact.eth`). Needs a fix before the Day 4 freeze — either add a business-subname lookup to `PactRegistry`, or resolve it off-chain via an indexer.

---

## Design principles

- **Backend-optional by design** — `autoRelease()` and a localStorage-backed frontend context store exist specifically so early development (and the live demo) never depends on Pact's server being up.
- **Deterministic terms hashing** — canonical JSON + `keccak256` via `viem` must match the on-chain script byte-for-byte. This is a correctness constraint, not a convention: mismatched hashes break the "verify before you sign" feature.
- **Clean integration seam** — `lib/stubs.ts` isolates all Privy, World Selfie Check, and ENS integration points for easy swap-out as SDKs mature.

---

## Getting started

> Contracts and frontend are further along than backend/ENS scripting — check each workspace's own state before assuming parity with the plan below.

```bash
# Contracts
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
forge test -vv
forge create src/PactRegistry.sol:PactRegistry \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY

# Frontend
cd frontend
npm install
npm run dev
```

Required environment variables (see `.env.example` at repo root):

```
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=
PACT_ETH_OWNER_PRIVATE_KEY=
PRIVY_APP_ID=
PRIVY_APP_SECRET=
WORLD_APP_ID=
WORLD_ACTION_ID=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
RESEND_API_KEY=
USDC_SEPOLIA_ADDRESS=
PACT_REGISTRY_ADDRESS=
PACT_ESCROW_ADDRESS=
```

