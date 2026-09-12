import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { NewReputationEvent, ReputationStore } from "../repos/reputation.js";
import { recordPactCompleted } from "./indexer.js";
import { createIndexerArchive } from "./indexerArchive.js";

function createNullBusinessStore(): BusinessStore {
  return {
    findById: async () => null,
    findByWallet: async () => null,
    findBySubname: async () => null,
    findByWorldSession: async () => null,
    insert: async () => {
      throw new Error("not implemented in indexerArchive tests");
    },
  };
}

function createMemoryReputationStore() {
  const recorded: NewReputationEvent[] = [];
  const store: ReputationStore = {
    recordCompletion: async (entries: NewReputationEvent[]) => {
      for (const entry of entries) {
        recorded.push(entry);
      }
    },
    eventsForBusiness: async () => [],
  };
  return { store, recorded };
}

describe("indexerArchive", () => {
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

  test("list returns a copy in order", () => {
    const archive = createIndexerArchive();
    archive.archive({
      reason: "unknown_party_wallets",
      engagementId: "0x0a",
      partyA: "0xAa",
      partyB: "0xBb",
      txHash: null,
      archivedAt: "2026-09-12T12:00:00.000Z",
    });
    archive.archive({
      reason: "unknown_party_wallets",
      engagementId: "0x0b",
      partyA: "0xCc",
      partyB: "0xDd",
      txHash: null,
      archivedAt: "2026-09-12T12:01:00.000Z",
    });
    const copy = archive.list();
    expect(copy.map((entry) => entry.engagementId)).toEqual(["0x0a", "0x0b"]);
    copy.pop();
    expect(copy).toHaveLength(1);
    expect(archive.list()).toHaveLength(2);
  });

  test("recordPactCompleted with unknown wallets returns false and archives one entry", async () => {
    const businesses = createNullBusinessStore();
    const reputation = createMemoryReputationStore();
    const archive = createIndexerArchive();
    const recorded = await recordPactCompleted(
      { businesses, reputation: reputation.store },
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
    expect(reputation.recorded).toHaveLength(0);
    const listed = archive.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      reason: "unknown_party_wallets",
      engagementId: "0xeng",
      partyA: "0xUnknownA",
      partyB: "0xUnknownB",
      txHash: null,
      archivedAt: "2026-09-12T12:00:00.000Z",
    });
  });
});
