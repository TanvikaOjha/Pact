import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { BondRow, BondStore, NewBond } from "../repos/engagements.js";
import type { NewReputationEvent, ReputationEventRow, ReputationStore } from "../repos/reputation.js";
import {
  createIndexerArchive,
  recordBondEvent,
  recordPactCompleted,
  startPactCompletedWatcher,
} from "./indexer.js";

function createMemoryStores() {
  const events: ReputationEventRow[] = [];
  async function findBusinessById(id: string) {
    if (id !== "biz-a" && id !== "biz-b") return null;
    return {
      id,
      wallet_address: id === "biz-a" ? "0xAa" : "0xBb",
      privy_wallet_id: "dev",
      ens_subname: `${id}.pact-hack.eth`,
      world_session_id: null,
      world_verified_at: null,
      created_at: new Date().toISOString(),
    };
  }
  const businesses: BusinessStore = {
    findById: (id: string) => findBusinessById(id),
    findByWallet: async (walletAddress: string) => {
      if (walletAddress === "0xAa") {
        return findBusinessById("biz-a");
      }
      if (walletAddress === "0xBb") {
        return findBusinessById("biz-b");
      }
      return null;
    },
    findBySubname: async () => null,
    findByWorldSession: async () => null,
    insert: async () => {
      throw new Error("not implemented in indexer tests");
    },
  };
  const reputation: ReputationStore = {
    recordCompletion: async (entries: NewReputationEvent[]) => {
      for (const entry of entries) {
        events.push({
          id: `rep-${events.length + 1}`,
          engagement_id: entry.engagementId,
          business_id: entry.businessId,
          counterparty_id: entry.counterpartyId,
          template_type: entry.templateType,
          total_value: entry.totalValue,
          on_time: entry.onTime,
          disputed: entry.disputed,
          tx_hash: entry.txHash,
          emitted_at: entry.emittedAt,
        });
      }
    },
    eventsForBusiness: async (businessId: string) =>
      events.filter((event) => event.business_id === businessId),
  };
  return { businesses, reputation, events };
}

function createMemoryBondStore() {
  const rows: BondRow[] = [];
  const store: BondStore = {
    findByEngagement: async (engagementId: string) =>
      rows.find((row) => row.engagement_id === engagementId) ?? null,
    recordPosted: async (row: NewBond) => {
      const created: BondRow = {
        engagement_id: row.engagementId,
        amount: row.amount,
        bonder_wallet: row.bonderWallet,
        posted_at: new Date().toISOString(),
        frozen: false,
        settled_at: null,
        slashed_amount: 0,
      };
      rows.push(created);
      return created;
    },
    setFrozen: async (engagementId: string, frozen: boolean) => {
      const row = rows.find((candidate) => candidate.engagement_id === engagementId);
      if (row !== undefined) row.frozen = frozen;
    },
    recordReturned: async (engagementId: string, settledAt: string) => {
      const row = rows.find((candidate) => candidate.engagement_id === engagementId);
      if (row !== undefined) row.settled_at = settledAt;
    },
    recordSlashed: async (engagementId: string, slashedAmount: number) => {
      const row = rows.find((candidate) => candidate.engagement_id === engagementId);
      if (row !== undefined) row.slashed_amount = slashedAmount;
    },
  };
  return { store, rows };
}

describe("indexer", () => {
  test("returns null when unconfigured", () => {
    const stores = createMemoryStores();
    expect(
      startPactCompletedWatcher({
        rpcUrl: "",
        escrowAddress: "",
        businesses: stores.businesses,
        reputation: stores.reputation,
        bonds: createMemoryBondStore().store,
      }),
    ).toBeNull();
  });

  test("maps a decoded PactCompleted log to both mirror rows", async () => {
    const stores = createMemoryStores();
    const recorded = await recordPactCompleted(
      { businesses: stores.businesses, reputation: stores.reputation },
      {
        engagementId: "0xeng",
        partyA: "0xAa",
        partyB: "0xBb",
        templateType: 2,
        totalValue: 7500,
        onTime: true,
        disputed: false,
        txHash: "0xtx",
      },
      "2026-09-12T12:00:00.000Z",
    );
    expect(recorded).toBe(true);
    expect(stores.events).toHaveLength(2);
    expect(stores.events[0]).toMatchObject({
      engagement_id: "0xeng",
      business_id: "biz-a",
      counterparty_id: "biz-b",
      tx_hash: "0xtx",
    });
    expect(stores.events[1]?.business_id).toBe("biz-b");
  });

  test("skips logs with unknown party wallets", async () => {
    const stores = createMemoryStores();
    const recorded = await recordPactCompleted(
      { businesses: stores.businesses, reputation: stores.reputation },
      {
        engagementId: "0xeng",
        partyA: "0xUnknown",
        partyB: "0xBb",
        templateType: 2,
        totalValue: 7500,
        onTime: true,
        disputed: false,
        txHash: null,
      },
      "2026-09-12T12:00:00.000Z",
    );
    expect(recorded).toBe(false);
    expect(stores.events).toHaveLength(0);
  });
});

describe("recordBondEvent", () => {
  test("posted creates the bond row, frozen/returned update it", async () => {
    const bonds = createMemoryBondStore();
    await recordBondEvent(
      { bonds: bonds.store },
      "posted",
      { engagementId: "eng-1", bonder: "0xBonder", provider: "", amount: 750 },
      "2026-09-12T12:00:00.000Z",
    );
    expect(bonds.rows).toHaveLength(1);
    expect(bonds.rows[0]).toMatchObject({
      engagement_id: "eng-1",
      amount: 750,
      bonder_wallet: "0xBonder",
      frozen: false,
      settled_at: null,
      slashed_amount: 0,
    });

    await recordBondEvent(
      { bonds: bonds.store },
      "frozen",
      { engagementId: "eng-1", bonder: "", provider: "", amount: 0 },
      "2026-09-12T12:01:00.000Z",
    );
    expect(bonds.rows[0]?.frozen).toBe(true);

    await recordBondEvent(
      { bonds: bonds.store },
      "returned",
      { engagementId: "eng-1", bonder: "", provider: "0xProvider", amount: 750 },
      "2026-09-12T12:02:00.000Z",
    );
    expect(bonds.rows[0]?.settled_at).toBe("2026-09-12T12:02:00.000Z");
  });

  test("slashed accumulates onto the existing row", async () => {
    const bonds = createMemoryBondStore();
    await recordBondEvent(
      { bonds: bonds.store },
      "posted",
      { engagementId: "eng-1", bonder: "0xBonder", provider: "", amount: 750 },
      "2026-09-12T12:00:00.000Z",
    );
    await recordBondEvent(
      { bonds: bonds.store },
      "slashed",
      { engagementId: "eng-1", bonder: "", provider: "", amount: 100 },
      "2026-09-12T12:01:00.000Z",
    );
    expect(bonds.rows[0]?.slashed_amount).toBe(100);
    await recordBondEvent(
      { bonds: bonds.store },
      "slashed",
      { engagementId: "eng-1", bonder: "", provider: "", amount: 50 },
      "2026-09-12T12:02:00.000Z",
    );
    expect(bonds.rows[0]?.slashed_amount).toBe(150);
  });
});

describe("indexer skip archive", () => {
  test("caps at limit and keeps oldest-first order", () => {
    const archive = createIndexerArchive(2);
    archive.archive({
      reason: "unknown_party_wallets",
      engagementId: "0x01",
      partyA: "0xAa",
      partyB: "0xBb",
      txHash: null,
      archivedAt: "2026-09-12T12:00:00.000Z",
    });
    archive.archive({
      reason: "unknown_party_wallets",
      engagementId: "0x02",
      partyA: "0xCc",
      partyB: "0xDd",
      txHash: "0xtx2",
      archivedAt: "2026-09-12T12:01:00.000Z",
    });
    archive.archive({
      reason: "missing_fields",
      engagementId: "unknown",
      partyA: "unknown",
      partyB: "unknown",
      txHash: null,
      archivedAt: "2026-09-12T12:02:00.000Z",
    });
    const listed = archive.list();
    expect(listed).toHaveLength(2);
    expect(listed[0]?.engagementId).toBe("0x02");
    expect(listed[1]?.engagementId).toBe("unknown");
  });

  test("unknown wallets archive one entry with the skip detail", async () => {
    const stores = createMemoryStores();
    const archive = createIndexerArchive();
    const recorded = await recordPactCompleted(
      { businesses: stores.businesses, reputation: stores.reputation },
      {
        engagementId: "0xeng",
        partyA: "0xUnknownA",
        partyB: "0xUnknownB",
        templateType: 2,
        totalValue: 7500,
        onTime: true,
        disputed: false,
        txHash: null,
      },
      "2026-09-12T12:00:00.000Z",
      archive,
    );
    expect(recorded).toBe(false);
    expect(stores.events).toHaveLength(0);
    expect(archive.list()).toHaveLength(1);
    expect(archive.list()[0]).toMatchObject({
      reason: "unknown_party_wallets",
      engagementId: "0xeng",
      partyA: "0xUnknownA",
      partyB: "0xUnknownB",
      txHash: null,
      archivedAt: "2026-09-12T12:00:00.000Z",
    });
    const copy = archive.list();
    copy.pop();
    expect(archive.list()).toHaveLength(1);
  });
});
