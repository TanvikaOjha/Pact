# Pact — Agent Guide

Read this file first. Repo root is `Pact/` with two packages: `backend/` (Express + TS API,
`@pact/backend`, ESM) and `contracts/` (Foundry) — plus a root-level `pact` package
(CommonJS CLI scripts under `src/`). Always run commands inside one workspace.

Never edit, stage, or commit anything outside this directory — only files under the repo
root are part of the project.

## What we're building (one paragraph)

Pact is a mutual B2B engagement layer: two businesses propose, sign, and settle work in USDC
using one of six contract templates, with terms living on ENS and reputation building
permanently on-chain. `PactRegistry` handles identities, proposals, and signatures; `PactEscrow`
holds milestone funds and emits `PactCompleted` — the portable reputation record. A Supabase-
backed API mirrors on-chain state for UX and notifications. Stack: Privy · ENSv2 · World Selfie
Check. Target tracks: ENSv2 Best Use ($4.5k) · Privy B2B Financial Product ($2.5k) · World
Selfie Check ($3.5k).

**The whole thesis in one line:** propose → sign → fund → deliver → release, with the reputation
record emitted by the escrow itself, so neither party can ghost, dispute what was agreed, or
take their history with them.

## Golden rules (do not violate)

**On-chain is authoritative.** Supabase is a mirror for UX + notifications. Never treat DB rows
as the source of truth for engagement or milestone state.

**Three green gates before every backend commit:** `npm run lint`, `npm run typecheck`, and
`npm run build` — all from `backend/`, no exceptions. Contracts: `forge build` + `forge test`
green before commit.

**oxlint is pinned exact `1.78.0`.** Both `oxlint` and `@oxlint/plugins` in
`backend/package.json` are exact-pinned — do not bump, tilde, or caret them. Config is
`backend/oxlint.config.ts` (note: in `backend/`, not repo root).

**No `console.*`.** All process output goes through `src/services/log.ts` (`log.info` /
`log.error`). `no-console` is an error.

**No empty `catch {}`, no hardcoded keys or secrets.** `anti-slop/no-empty-catch` and
`anti-slop/no-hardcoded-private-key` are errors.

**Never suppress an anti-slop rule without asking.** Before suppressing anything, read the
rule source in `backend/tools/oxlint/anti-slop/src/rules/` (each rule has a `.ts` plus a test).

**Type assertions need a safety comment.** Also avoid `unknown` params/returns/aliases,
`Reflect.apply/get`, runtime `typeof` branches, chained assertions, and object params — all
`anti-slop/*: error`.

**One Request augmentation only.** `src/types/express.d.ts` is the single Express `Request`
augmentation (`requestId`, `identity?: Identity`). New auth fields go on `Identity` in
`src/middleware/privyAuth.ts`, never as ad-hoc casts.

**ESM everywhere.** `"type": "module"`, `NodeNext` resolution; use `.js` import suffixes in
`src/` (e.g. `./config/env.js`).

**Solidity: `^0.8.24`, custom errors only** — no revert reason strings. `PactCompleted` is THE
reputation record; the escrow guards it against double-emit (`completedEmitted` flag).

**Do not edit submodule contents in place.** Rule changes go in the `Copernicium282/anti-slop`
fork: push there, then `git submodule update --remote backend/tools/oxlint/anti-slop`.

**Privy API usage comes from docs + installed types, never memory.** Auth uses
`@privy-io/node` (NOT the legacy `@privy-io/server-auth`). Before touching any Privy call,
check `docs.privy.io` AND the installed `node_modules/@privy-io/node` `.d.ts` — the SDK
migrated once already (`verifyAuthToken` → `verifyAccessToken`, camelCase → snake_case
`User`). Do not add `server-auth` back.

## Setup

1. **Submodules** (required — lint/build/test fail on fresh clones without them):

   ```bash
   git submodule update --init --recursive          # contracts/lib/openzeppelin-contracts
   cd contracts && forge install foundry-rs/forge-std   # tests import forge-std; no submodule ships it
   ```

2. **Backend:** `cd backend && npm ci` (package-lock.json is committed).

3. **Contracts:** nothing else. There is no `foundry.toml` — forge defaults apply. Do not add
   one unless requested.

4. **DB:** apply `backend/supabase/migrations/0001_pact_core.sql` (the only migration — note
   the path is `backend/supabase/`, not `./supabase/`) via `supabase db push` / `psql` /
   dashboard. Requires `pgcrypto`. Tables: `businesses`, `engagements` (status enum
   PROPOSED/ACTIVE/COMPLETED/DISPUTED/CANCELLED; `template_type` checked 1–6), `milestones`,
   `reputation_events`, `proposals` (ephemeral pre-signature link-flow table).

5. **Env:** `cp backend/.env.example backend/.env` (see Env below).

## Repo layout

```
backend/
  src/
    server.ts            entry: loadEnv() + listen
    app.ts               createApp(): json → requestId → healthRouter → errorHandler
    config/env.ts        zod env schema + loadEnv() (envFlag() for booleans)
    config/supabase.ts   Supabase client
    chain/registry.ts    viem read-only Registry access (isBusinessActive; null when unconfigured)
    chain/escrow.ts      viem read-only Escrow access (milestones released flag; null when unconfigured)
    middleware/http.ts   requestId + errorHandler
    middleware/privyAuth.ts  Identity + createRequireAuth (Bearer via @privy-io/node;
    dev-header privyAuthStub only when ALLOW_DEV_AUTH=true)
    middleware/privyAuth.test.ts  resolveIdentity unit tests
    routes/health.ts     GET /health → { ok, service } (public; /api/* requires auth)
    routes/me.ts         GET /api/me → { identity } (behind requireAuth)
    routes/me.test.ts    HTTP tests (real app + fetch on ephemeral port)
    routes/world.ts      POST /api/world/verify (Selfie Check; behind requireAuth)
    routes/world.test.ts HTTP tests (stub mode)
    routes/businesses.ts POST /api/businesses/register (World→dedupe→mirror row;
    caller sends registerBusiness tx themselves; ENS minting follows)
    routes/businesses.test.ts HTTP tests (memory store)
    routes/proposals.ts  POST /api/proposals (authed, canonical hash) +
    GET /api/proposals/:token (public link view, 410 past expiry)
    routes/engagements.ts POST /api/engagements (mirror intent row) +
    POST /api/engagements/:id/milestones/:index/submit (completion notice,
    starts 48h acceptance window) + .../release (mirror on-chain release,
    chain-verified when configured; completes engagement on last release)
    routes/scheduler.ts  POST /api/scheduler/sweep (due-release detection;
    execution via session signer follows)
    repos/businesses.ts  BusinessStore (Supabase mirror) + in-memory-testable interface
    repos/proposals.ts   ProposalStore (ephemeral drafts, 14d TTL)
    repos/engagements.ts EngagementStore + MilestoneStore (chain is authoritative)
    ens/pact-terms.ts    Terms-V1 canonicalizer — MUST stay byte-identical to
                         root src/ens/pact-terms.ts (parity vectors in pact-terms.test.ts)
    services/log.ts      the only logger (no-console rule)
    services/world.ts    portal verify via fetch to v4/verify/{rp_id} + zod parsing
    services/scheduler.ts ACCEPTANCE_WINDOW_HOURS + releaseAfter + findDueReleases (pure)
    types/express.d.ts   Request augmentation
    repos/ens/         repos has businesses.ts; ens/ has pact-terms.ts (more ports
                         only after root scripts stabilize — never fork them)
  supabase/migrations/0001_pact_core.sql + 0002_business_session_unique.sql
  oxlint.config.ts
  vitest.config.ts     scopes `npm test` to `src/**` (excludes submodule RuleTester files)
  tools/oxlint/anti-slop/    lint plugin (submodule; loaded by oxlint.config.ts)
contracts/
  src/PactRegistry.sol       registry: proposals, signatures, setEscrow (admin, one-time)
  src/PactEscrow.sol         escrow: fund, milestones, disputes, PactCompleted;
                             constructor(usdc, registry); admin: setWorldVerifier,
                             setHighValueThreshold, transferAdmin
  src/MockUSDC.sol           testnet USDC (mint is open — testnet only)
  src/interfaces/IERC20.sol
  test/PactRegistry.t.sol  test/PactEscrow.t.sol
.env.example                 root copy (shared template: chain, Privy, World, Supabase,
                             ENS_ROOT_NAME, backend-only keys)
backend/.env.example         authoritative copy for backend work (adds PORT, DEV_WORLD_STUB, ALLOW_DEV_AUTH,
                             PRIVY_JWT_VERIFICATION_KEY, DATABASE_URL)
src/                         teammate ENS CLI scripts (CommonJS, `npx tsx src/ens/*.ts`;
                             NOT importable from backend — see gotchas)
```

## Commands

Backend (run in `backend/`):
`npm run dev` (tsx watch) · `npm run build` (tsc) + `npm start` (node dist/server.js) ·
`npm run typecheck` · `npm run lint` · `npm run test` (vitest)

Contracts (run in `contracts/`): `forge build` · `forge test`

## Env

`backend/.env.example` is authoritative; the root copy is the team-shared template
(restore point: Day-0 13 vars + ENS_ROOT_NAME + backend keys).

- **Required** (zod-enforced in `src/config/env.ts`): `SEPOLIA_RPC_URL`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`
- **Optional:** `DEPLOYER_PRIVATE_KEY`, `PACT_ETH_OWNER_PRIVATE_KEY`, `PRIVY_APP_ID` /
  `PRIVY_APP_SECRET`, `PRIVY_JWT_VERIFICATION_KEY` (skips JWKS fetch on verify),
  `WORLD_APP_ID` / `WORLD_ACTION_ID`, `RESEND_API_KEY`,
  `USDC_SEPOLIA_ADDRESS`, `PACT_REGISTRY_ADDRESS`, `PACT_ESCROW_ADDRESS`
- **Defaults:** `PORT=4000`, `DEV_WORLD_STUB=true`, `ALLOW_DEV_AUTH=false` (dev-header
  auth is opt-in; never enable in prod), `ENS_ROOT_NAME=pact-hack.eth` (the root actually
  registered on Sepolia — do NOT change to `pact.eth` until it exists on-chain). Flags parse
  strict `"true"`/`"false"` via `envFlag()` — never use `z.coerce.boolean()` for flags
  (`Boolean("false")` is true).
- `DATABASE_URL` appears in the example but is **not** in the zod schema — do not rely on it.

Contract wiring: `USDC_SEPOLIA_ADDRESS` → `PactEscrow` constructor; `PACT_REGISTRY_ADDRESS` /
`PACT_ESCROW_ADDRESS` → backend viem config. After deploy, call `registry.setEscrow()` (one-
time, admin-only — reverts with `EscrowAlreadySet` after) and `escrow.setWorldVerifier()`.

## Gotchas

- `oxlint.config.ts` lives in `backend/`, not repo root — always lint from `backend/`.
- `contracts/lib/openzeppelin-contracts` is a declared submodule but nothing in `contracts/src`
  imports it — sources use only local files. The hard dependency for `forge test` is
  `forge-std`, which no submodule ships (see Setup step 1).
- `.gitignore` mentions `frontend/` and `ens/` — neither exists. Do not create them unasked.
- `src/repos/` and `src/ens/` are empty placeholders — check them before adding new modules.
- `privyAuthStub` trusts the `x-wallet-address` header (`x-privy-wallet-id` defaults to
  `"dev"`; missing wallet → 401 `missing_identity`). It only runs when `ALLOW_DEV_AUTH=true`
  (default false) — never enable in prod, never treat these headers as secure.
- Bearer tokens are Privy **access tokens** (ES256 JWT, ~1h expiry, `Authorization: Bearer`).
  `resolveIdentity` prefers the embedded ethereum wallet, else first ethereum wallet;
  `privyWalletId` is the embedded id or the user DID. Users with no ethereum wallet get
  401 `no_wallet`.
- `src/` (root) scripts target `*.pact-hack.eth` via CLI (`console.*`, `process.exit`,
  key required at import). Never import them from `backend/` (ESM vs CommonJS, logging
  rules, wallet-on-import) — port pure pieces (addresses, ABIs, record keys) into
  `backend/src/ens/` instead. Known issues there: resolver-salt collision on re-mint,
  `set-business-records` signs as Pact vs business-owned resolver, `"pending"` world-session
  placeholder, 6-hex engagement collisions. Five files are still 0-byte stubs.
