import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import type { ProposalRow, ProposalStore } from "../repos/proposals.js";
import type { EmailMessage } from "./notifications.js";
import { buildCronJobs, startCron } from "./cron.js";

function businessStore(): BusinessStore {
  return {
    findById: async (id: string) =>
      id === "biz-a" || id === "biz-b"
        ? {
            id,
            wallet_address: "0x00",
            privy_wallet_id: "dev",
            ens_subname: `${id}.pact-hack.eth`,
            world_session_id: null,
            world_verified_at: null,
            created_at: new Date().toISOString(),
            email: `${id}@example.com`,
          }
        : null,
    findByWallet: async () => null,
    findBySubname: async () => null,
    findByWorldSession: async () => null,
    insert: async () => {
      throw new Error("not implemented in cron tests");
    },
  };
}

function proposalRow(token: string, expiresAt: string, accepted: boolean): ProposalRow {
  return {
    token,
    template_type: 1,
    fields: {
      templateType: 1,
      title: "T",
      scope: "S",
      acceptanceCriteria: "A",
      totalAmount: 100,
      acceptanceWindowHours: 48,
      milestones: [],
      fields: {},
      termsHash: "0xabc",
    },
    proposer_id: "biz-a",
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    accepted_engagement_id: accepted ? "eng-1" : null,
  };
}

function milestoneRow(id: string, disputedAt: string | null): MilestoneRow {
  return {
    id,
    engagement_id: "eng-1",
    index: 0,
    name: "Work",
    description: null,
    amount: 2000,
    due_date: null,
    submitted_at: "2026-08-01T00:00:00.000Z",
    released_at: null,
    disputed: disputedAt !== null,
    world_session_id: null,
    disputed_at: disputedAt,
  };
}

describe("cron", () => {
  test("builds the three jobs with sane cadences", () => {
    // SAFETY: metadata-only test; job bodies never run so stores stay unimplemented.
    const emptyMilestones = {} as MilestoneStore;
    // SAFETY: metadata-only test; see above.
    const emptyEngagements = {} as never;
    // SAFETY: metadata-only test; see above.
    const emptyBusinesses = {} as BusinessStore;
    // SAFETY: metadata-only test; see above.
    const emptyProposals = {} as ProposalStore;
    const jobs = buildCronJobs({
      milestones: emptyMilestones,
      engagements: emptyEngagements,
      businesses: emptyBusinesses,
      proposals: emptyProposals,
      notify: { send: async () => {} },
    });
    expect(jobs.map((job) => job.name)).toEqual(["sweep", "proposal-expiry", "dispute-escalation"]);
    expect(jobs[0]?.intervalMs).toBe(15 * 60 * 1000);
  });

  test("proposal-expiry notifies only soon, unaccepted proposers", async () => {
    const sent: EmailMessage[] = [];
    const soon = new Date(Date.now() + 3600 * 1000).toISOString();
    const far = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const rows: ProposalRow[] = [
      proposalRow("soon", soon, false),
      proposalRow("accepted", soon, true),
      proposalRow("far", far, false),
    ];
    const proposals: ProposalStore = {
      findByToken: async (token: string) => rows.find((row) => row.token === token) ?? null,
      insert: async () => {
        throw new Error("not implemented in cron tests");
      },
      markAccepted: async () => null,
      listExpiringUnaccepted: async (beforeIso: string) =>
        rows.filter((row) => row.accepted_engagement_id === null && row.expires_at <= beforeIso),
    };
    const jobs = buildCronJobs({
      // SAFETY: expiry job never touches milestones or engagements.
      milestones: {} as MilestoneStore,
      // SAFETY: expiry job never touches milestones or engagements.
      engagements: {} as never,
      businesses: businessStore(),
      proposals,
      notify: {
        send: async (message: EmailMessage): Promise<void> => {
          sent.push(message);
        },
      },
    });
    const expiry = jobs.find((job) => job.name === "proposal-expiry");
    if (expiry === undefined) throw new Error("expiry job missing");
    await expiry.run();
    expect(sent.map((message) => message.to)).toEqual(["biz-a@example.com"]);
    expect(sent[0]?.subject.includes("Proposal expiring")).toBe(true);
  });

  test("dispute escalation fires once in the 30-31 day band", async () => {
    const sent: EmailMessage[] = [];
    const staleAt = new Date(Date.now() - 30 * 24 * 3600 * 1000 - 3600 * 1000).toISOString();
    const freshAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const rows: MilestoneRow[] = [
      milestoneRow("stale", staleAt),
      milestoneRow("fresh", freshAt),
    ];
    const milestones: MilestoneStore = {
      listByEngagement: async () => [],
      listSubmittedUnreleased: async () => [],
      listDisputed: async () => rows.filter((row) => row.disputed && row.released_at === null),
      findByIndex: async (engagementId: string, index: number) =>
        rows.find((row) => row.engagement_id === engagementId && row.index === index) ?? null,
      insertMany: async () => [],
      markSubmitted: async () => null,
      markReleased: async () => null,
      setDisputed: async () => null,
      markResolved: async () => null,
      setWorldSession: async () => null,
      findByWorldSession: async () => null,
    };
    const jobs = buildCronJobs({
      milestones,
      engagements: {
        findById: async (id: string) =>
          id === "eng-1"
            ? {
                id,
                on_chain_id: "offchain",
                ens_subname: "eng-1.pact-hack.eth",
                party_a_id: "biz-a",
                party_b_id: "biz-b",
                template_type: 1,
                terms_hash: "0xabc",
                total_amount: 2000,
                status: "DISPUTED",
                created_at: new Date().toISOString(),
                completed_at: null,
              }
            : null,
        findByOnChainId: async () => null,
        insert: async () => {
          throw new Error("not implemented in cron tests");
        },
        updateStatus: async () => null,
      },
      businesses: businessStore(),
      // SAFETY: escalation job never touches proposals.
      proposals: {} as ProposalStore,
      notify: {
        send: async (message: EmailMessage): Promise<void> => {
          sent.push(message);
        },
      },
    });
    const escalation = jobs.find((job) => job.name === "dispute-escalation");
    if (escalation === undefined) throw new Error("escalation job missing");
    await escalation.run();
    expect(sent.map((message) => message.to).sort()).toEqual([
      "biz-a@example.com",
      "biz-b@example.com",
    ]);
    expect(sent[0]?.subject.includes("Stale dispute")).toBe(true);
  });

  test("startCron runs jobs and stops them", async () => {
    let runs = 0;
    const stop = startCron([{ name: "tick", intervalMs: 10, run: async () => {
      runs += 1;
    } }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    stop();
    const observed = runs;
    expect(observed).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runs).toBe(observed);
  });
});
