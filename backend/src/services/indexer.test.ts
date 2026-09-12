import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { NewReputationEvent, ReputationEventRow, ReputationStore } from "../repos/reputation.js";
import { recordPactCompleted, startPactCompletedWatcher } from "./indexer.js";

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

describe("indexer", () => {
  test("returns null when unconfigured", () => {
    const stores = createMemoryStores();
    expect(
      startPactCompletedWatcher({
        rpcUrl: "",
        escrowAddress: "",
        businesses: stores.businesses,
        reputation: stores.reputation,
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
