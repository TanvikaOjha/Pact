import { createPublicClient, http, isAddress, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { z } from "zod";

import type { BusinessStore } from "../repos/businesses.js";
import type { BondStore } from "../repos/engagements.js";
import type { NewReputationEvent, ReputationStore } from "../repos/reputation.js";
import { log } from "./log.js";

const pactCompletedEvent = parseAbiItem(
  "event PactCompleted(bytes32 indexed engagementId, address indexed partyA, string subnameA, address indexed partyB, string subnameB, uint8 templateType, uint256 totalValue, bool onTime, bool disputed)",
);

const bondPostedEvent = parseAbiItem(
  "event BondPosted(bytes32 indexed engagementId, address indexed bonder, uint256 amount)",
);

const bondReturnedEvent = parseAbiItem(
  "event BondReturned(bytes32 indexed engagementId, address indexed provider, uint256 amount)",
);

const bondSlashedEvent = parseAbiItem(
  "event BondSlashed(bytes32 indexed engagementId, uint256 amount)",
);

const bondFrozenEvent = parseAbiItem(
  "event BondFrozen(bytes32 indexed engagementId)",
);

export interface PactCompletedLog {
  engagementId: string;
  partyA: string;
  partyB: string;
  templateType: number;
  totalValue: number;
  onTime: boolean;
  disputed: boolean;
  txHash: string | null;
}

/** A skipped log kept for ops. The watcher stays new-events-only; this is the backlog. */
export interface ArchivedIndexerSkip {
  reason: string;
  engagementId: string;
  partyA: string;
  partyB: string;
  txHash: string | null;
  archivedAt: string;
}

export interface IndexerArchive {
  archive(entry: ArchivedIndexerSkip): void;
  list(): ArchivedIndexerSkip[];
}

/** Append-only in-memory skip archive, capped (oldest dropped past the limit). */
export function createIndexerArchive(limit: number = 500): IndexerArchive {
  const entries: ArchivedIndexerSkip[] = [];
  return {
    archive(entry: ArchivedIndexerSkip): void {
      entries.push(entry);
      if (entries.length > limit) {
        entries.splice(0, entries.length - limit);
      }
    },
    list(): ArchivedIndexerSkip[] {
      return entries.slice();
    },
  };
}

export interface IndexerOptions {
  rpcUrl: string;
  escrowAddress: string;
  businesses: BusinessStore;
  reputation: ReputationStore;
  bonds: BondStore;
  archive?: IndexerArchive;
}

export interface BondEventDecoded {
  engagementId: string;
  bonder: string;
  provider: string;
  amount: number;
}

export interface BondEventStores {
  bonds: BondStore;
}

/** Boundary decode for bond logs; amounts arrive as bigint from viem. */
const bondLogSchema = z.object({
  eventName: z.string(),
  args: z
    .object({
      engagementId: z.string(),
      bonder: z.string().optional(),
      provider: z.string().optional(),
      amount: z.union([z.bigint(), z.number()]).optional(),
    })
    .passthrough(),
});

function bondKindForEvent(eventName: string): string | null {
  if (eventName === "BondPosted") return "posted";
  if (eventName === "BondReturned") return "returned";
  if (eventName === "BondSlashed") return "slashed";
  if (eventName === "BondFrozen") return "frozen";
  return null;
}

/**
 * Map a decoded bond event to mirror writes. Pure: unit-tested without a chain.
 * Slashes accumulate on-chain burns: recordSlashed stores the cumulative total,
 * so the decoded amount is added to the existing row before writing.
 */
export async function recordBondEvent(
  stores: BondEventStores,
  kind: string,
  decoded: BondEventDecoded,
  at: string,
): Promise<void> {
  if (kind === "posted") {
    await stores.bonds.recordPosted({
      engagementId: decoded.engagementId,
      amount: decoded.amount,
      bonderWallet: decoded.bonder,
    });
    return;
  }
  if (kind === "returned") {
    await stores.bonds.recordReturned(decoded.engagementId, at);
    return;
  }
  if (kind === "slashed") {
    const existing = await stores.bonds.findByEngagement(decoded.engagementId);
    const cumulative = (existing === null ? 0 : existing.slashed_amount) + decoded.amount;
    await stores.bonds.recordSlashed(decoded.engagementId, cumulative);
    return;
  }
  if (kind === "frozen") {
    await stores.bonds.setFrozen(decoded.engagementId, true);
    return;
  }
  log.error(`indexer skipping bond event with unknown kind ${kind}`);
}

/**
 * Map a decoded PactCompleted log to mirror rows. Pure: unit-tested without a chain.
 * Business ids resolve by wallet; unknown wallets skip with a log (their
 * registration hasn't mirrored yet — a later backfill picks them up).
 */
export async function recordPactCompleted(
  stores: { businesses: BusinessStore; reputation: ReputationStore },
  decoded: PactCompletedLog,
  emittedAt: string,
  archive?: IndexerArchive,
): Promise<boolean> {
  const [businessA, businessB] = await Promise.all([
    stores.businesses.findByWallet(decoded.partyA),
    stores.businesses.findByWallet(decoded.partyB),
  ]);
  if (businessA === null || businessB === null) {
    log.error(`indexer skipping ${decoded.engagementId}: unknown party wallets`);
    archive?.archive({
      reason: "unknown_party_wallets",
      engagementId: decoded.engagementId,
      partyA: decoded.partyA,
      partyB: decoded.partyB,
      txHash: decoded.txHash,
      archivedAt: emittedAt,
    });
    return false;
  }
  const rows: NewReputationEvent[] = [
    {
      engagementId: decoded.engagementId,
      businessId: businessA.id,
      counterpartyId: businessB.id,
      templateType: decoded.templateType,
      totalValue: decoded.totalValue,
      onTime: decoded.onTime,
      disputed: decoded.disputed,
      txHash: decoded.txHash,
      emittedAt,
    },
    {
      engagementId: decoded.engagementId,
      businessId: businessB.id,
      counterpartyId: businessA.id,
      templateType: decoded.templateType,
      totalValue: decoded.totalValue,
      onTime: decoded.onTime,
      disputed: decoded.disputed,
      txHash: decoded.txHash,
      emittedAt,
    },
  ];
  await stores.reputation.recordCompletion(rows);
  return true;
}

/**
 * Watch PactCompleted events and mirror them. Returns the unwatch function,
 * or null when unconfigured (callers treat null as "indexer disabled").
 * No backfill: restarts only observe new events. Skips are logged and
 * archived for ops via options.archive when provided.
 *
 * Bond events (BondPosted/Returned/Slashed/Frozen) ride a second watcher on
 * the same escrow with the same disabled-when-unconfigured semantics.
 */
export function startPactCompletedWatcher(options: IndexerOptions): (() => void) | null {
  if (options.rpcUrl === "" || options.escrowAddress === "") {
    return null;
  }
  if (!isAddress(options.escrowAddress)) {
    log.error("PACT_ESCROW_ADDRESS is not a valid address; indexer disabled");
    return null;
  }
  const client = createPublicClient({ chain: sepolia, transport: http(options.rpcUrl) });
  const unwatch = client.watchContractEvent({
    address: options.escrowAddress,
    abi: [pactCompletedEvent],
    eventName: "PactCompleted",
    onLogs: (logs) => {
      void (async () => {
        for (const entry of logs) {
          const args = entry.args;
          if (
            args.engagementId === undefined ||
            args.partyA === undefined ||
            args.partyB === undefined ||
            args.templateType === undefined ||
            args.totalValue === undefined ||
            args.onTime === undefined ||
            args.disputed === undefined
          ) {
            log.error("indexer skipping log with missing fields");
            options.archive?.archive({
              reason: "missing_fields",
              engagementId: "unknown",
              partyA: "unknown",
              partyB: "unknown",
              txHash: entry.transactionHash ?? null,
              archivedAt: new Date().toISOString(),
            });
            continue;
          }
          await recordPactCompleted(
            { businesses: options.businesses, reputation: options.reputation },
            {
              engagementId: args.engagementId,
              partyA: args.partyA,
              partyB: args.partyB,
              templateType: args.templateType,
              totalValue: Number(args.totalValue),
              onTime: args.onTime,
              disputed: args.disputed,
              txHash: entry.transactionHash ?? null,
            },
            new Date().toISOString(),
            options.archive,
          );
        }
      })().catch(() => {
        log.error("indexer batch failed");
      });
    },
  });
  const unwatchBonds = client.watchContractEvent({
    address: options.escrowAddress,
    abi: [bondPostedEvent, bondReturnedEvent, bondSlashedEvent, bondFrozenEvent],
    onLogs: (logs) => {
      void (async () => {
        for (const entry of logs) {
          const parsed = bondLogSchema.safeParse(entry);
          const txHash = entry.transactionHash ?? null;
          if (!parsed.success) {
            log.error("indexer skipping bond log with missing fields");
            options.archive?.archive({
              reason: "bond_fields_missing",
              engagementId: "unknown",
              partyA: "unknown",
              partyB: "unknown",
              txHash,
              archivedAt: new Date().toISOString(),
            });
            continue;
          }
          const kind = bondKindForEvent(parsed.data.eventName);
          if (kind === null) {
            log.error("indexer skipping bond log with missing fields");
            options.archive?.archive({
              reason: "bond_fields_missing",
              engagementId: parsed.data.args.engagementId,
              partyA: parsed.data.args.bonder ?? "unknown",
              partyB: parsed.data.args.provider ?? "unknown",
              txHash,
              archivedAt: new Date().toISOString(),
            });
            continue;
          }
          const bondArgs = parsed.data.args;
          await recordBondEvent(
            { bonds: options.bonds },
            kind,
            {
              engagementId: bondArgs.engagementId,
              bonder: bondArgs.bonder ?? "unknown",
              provider: bondArgs.provider ?? "unknown",
              amount: bondArgs.amount === undefined ? 0 : Number(bondArgs.amount),
            },
            new Date().toISOString(),
          );
        }
      })().catch(() => {
        log.error("indexer bond batch failed");
      });
    },
  });
  return () => {
    unwatch();
    unwatchBonds();
  };
}
