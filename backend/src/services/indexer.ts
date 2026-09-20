import { createPublicClient, http, isAddress, parseAbiItem } from "viem";
import { sepolia } from "viem/chains";
import { z } from "zod";

import type { EscrowReader, FundingState } from "../chain/escrow.js";
import type { BusinessStore } from "../repos/businesses.js";
import type { BondRow, BondStore, EngagementStore, MilestoneStore, NewBond } from "../repos/engagements.js";
import type { NewReputationEvent, ReputationStore } from "../repos/reputation.js";
import type { SplitStore } from "../repos/splits.js";
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

const splitReleasedEvent = parseAbiItem(
  "event SplitReleased(bytes32 indexed engagementId, uint256 total)",
);

const shareClaimedEvent = parseAbiItem(
  "event ShareClaimed(bytes32 indexed engagementId, address indexed recipient, uint256 amount)",
);
const engagementFundedEvent = parseAbiItem(
  "event EngagementFunded(bytes32 indexed engagementId, address indexed client, address indexed provider, uint256 totalAmount, uint256 milestoneCount)",
);

const topUpFundedEvent = parseAbiItem(
  "event TopUpFunded(bytes32 indexed engagementId, uint256 startIndex, uint256 count)",
);

const defaultRecordedEvent = parseAbiItem(
  "event DefaultRecorded(bytes32 indexed engagementId)",
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
  /**
   * M5 split mirror. All three of splits/engagements/milestones plus
   * escrowReader are required together to watch SplitReleased/ShareClaimed;
   * partial wiring leaves that watcher off (log-only), same as the
   * chain/registry.ts and chain/escrow.ts "null when unconfigured" pattern.
   */
  splits?: SplitStore;
  engagements?: EngagementStore;
  milestones?: MilestoneStore;
  escrowReader?: EscrowReader;
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
const fundingLogSchema = z.object({
  eventName: z.string(),
  args: z
    .object({
      engagementId: z.string().optional(),
    })
    .passthrough(),
});

/** Boundary decode for split logs (SplitReleased / ShareClaimed). */
const splitLogSchema = z.object({
  eventName: z.string(),
  args: z
    .object({
      engagementId: z.string().optional(),
      recipient: z.string().optional(),
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

export interface SplitEventStores {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  splits: SplitStore;
  escrowReader: EscrowReader;
}

/**
 * Mirror of SplitReleased: marks milestone 0 released (covers the case where
 * the release happened via a direct on-chain call, bypassing the backend's
 * release route entirely — the FilePizza mechanic) and re-reads
 * pendingShares() for every known recipient, since the contract emits no
 * per-recipient event for a failed transfer that fell back to pull-payment.
 */
export async function recordSplitReleased(
  stores: SplitEventStores,
  onChainId: string,
): Promise<void> {
  const engagement = await stores.engagements.findByOnChainId(onChainId);
  if (engagement === null) {
    log.error(`indexer skipping SplitReleased for unknown engagement ${onChainId}`);
    return;
  }
  const milestone = await stores.milestones.findByIndex(engagement.id, 0);
  if (milestone !== null && milestone.released_at === null) {
    await stores.milestones.markReleased(milestone.id, new Date().toISOString());
  }
  const recipients = await stores.splits.listRecipients(engagement.id);
  for (const recipient of recipients) {
    const remaining = await stores.escrowReader.getPendingShare(onChainId, recipient.wallet_address);
    if (remaining !== null) {
      await stores.splits.setPendingShare(engagement.id, recipient.wallet_address, remaining);
    }
  }
}
export interface FundingEventStores {
  engagements: EngagementStore;
  milestones: MilestoneStore;
  escrowReader: EscrowReader;
}

/**
 * Re-syncs the funding mirror from EscrowInfo. Used for all three funding
 * events (EngagementFunded, TopUpFunded, DefaultRecorded) — re-reading the
 * whole struct is simpler and safer than trying to derive the delta from
 * each event's own args, and it's idempotent regardless of which route (if
 * any) already recorded the same change.
 */
export async function recordFundingSync(
  stores: FundingEventStores,
  onChainId: string,
): Promise<void> {
  const engagement = await stores.engagements.findByOnChainId(onChainId);
  if (engagement === null) {
    log.error(`indexer skipping funding sync for unknown engagement ${onChainId}`);
    return;
  }
  const state = await stores.escrowReader.getFundingState(onChainId);
  if (state === null) return;
  await stores.engagements.recordFunding(engagement.id, state.fundedCount, state.fundedTotal);
  await stores.milestones.setFundedThrough(engagement.id, state.fundedCount);
  if (state.defaulted) {
    await stores.engagements.recordDefault(engagement.id);
  }
}

/**
 * Mirror of ShareClaimed: re-reads pendingShares() for the claimant rather
 * than trusting the event's amount field, since claimShare() zeroes the
 * on-chain balance atomically and the chain is the only authority here.
 */
export async function recordShareClaimed(
  stores: { engagements: EngagementStore; splits: SplitStore; escrowReader: EscrowReader },
  onChainId: string,
  recipient: string,
): Promise<void> {
  const engagement = await stores.engagements.findByOnChainId(onChainId);
  if (engagement === null) {
    log.error(`indexer skipping ShareClaimed for unknown engagement ${onChainId}`);
    return;
  }
  const remaining = await stores.escrowReader.getPendingShare(onChainId, recipient);
  await stores.splits.setPendingShare(engagement.id, recipient, remaining ?? 0);
}

/**
 * Watch PactCompleted + bond events, and (when splits/engagements/
 * milestones/escrowReader are all wired) SplitReleased/ShareClaimed too.
 * Returns the unwatch function, or null when unconfigured. No backfill:
 * restarts only observe new events. Skips are logged and archived for ops
 * via options.archive when provided.
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
    let unwatchFunding: (() => void) | null = null;
  if (
    options.engagements !== undefined &&
    options.milestones !== undefined &&
    options.escrowReader !== undefined
  ) {
    const fundingStores: FundingEventStores = {
      engagements: options.engagements,
      milestones: options.milestones,
      escrowReader: options.escrowReader,
    };
    unwatchFunding = client.watchContractEvent({
      address: options.escrowAddress,
      abi: [engagementFundedEvent, topUpFundedEvent, defaultRecordedEvent],
      onLogs: (logs) => {
        void (async () => {
          for (const entry of logs) {
            const parsed = fundingLogSchema.safeParse(entry);
            const txHash = entry.transactionHash ?? null;
            if (!parsed.success || parsed.data.args.engagementId === undefined) {
              log.error("indexer skipping funding log with missing fields");
              options.archive?.archive({
                reason: "funding_fields_missing",
                engagementId: "unknown",
                partyA: "unknown",
                partyB: "unknown",
                txHash,
                archivedAt: new Date().toISOString(),
              });
              continue;
            }
            await recordFundingSync(fundingStores, parsed.data.args.engagementId);
          }
        })().catch(() => {
          log.error("indexer funding batch failed");
        });
      },
    });
  }

  let unwatchSplits: (() => void) | null = null;
  if (
    options.splits !== undefined &&
    options.engagements !== undefined &&
    options.milestones !== undefined &&
    options.escrowReader !== undefined
  ) {
    const splitStores: SplitEventStores = {
      engagements: options.engagements,
      milestones: options.milestones,
      splits: options.splits,
      escrowReader: options.escrowReader,
    };
    unwatchSplits = client.watchContractEvent({
      address: options.escrowAddress,
      abi: [splitReleasedEvent, shareClaimedEvent],
      onLogs: (logs) => {
        void (async () => {
          for (const entry of logs) {
            const parsed = splitLogSchema.safeParse(entry);
            const txHash = entry.transactionHash ?? null;
            if (!parsed.success) {
              log.error("indexer skipping split log with missing fields");
              options.archive?.archive({
                reason: "split_fields_missing",
                engagementId: "unknown",
                partyA: "unknown",
                partyB: "unknown",
                txHash,
                archivedAt: new Date().toISOString(),
              });
              continue;
            }
            const { eventName, args } = parsed.data;
            if (eventName === "SplitReleased" && args.engagementId !== undefined) {
              await recordSplitReleased(splitStores, args.engagementId);
            } else if (
              eventName === "ShareClaimed" &&
              args.engagementId !== undefined &&
              args.recipient !== undefined
            ) {
              await recordShareClaimed(splitStores, args.engagementId, args.recipient);
            } else {
              log.error(`indexer skipping split log with unrecognized shape: ${eventName}`);
              options.archive?.archive({
                reason: "split_fields_missing",
                engagementId: args.engagementId ?? "unknown",
                partyA: "unknown",
                partyB: args.recipient ?? "unknown",
                txHash,
                archivedAt: new Date().toISOString(),
              });
            }
          }
        })().catch(() => {
          log.error("indexer split batch failed");
        });
      },
    });
  }

  return () => {
    unwatch();
    unwatchBonds();
    unwatchSplits?.();
    unwatchFunding?.();
  };
}