import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { DisputeProposalRow } from "../repos/disputes.js";
import type { EngagementStore, MilestoneRow, MilestoneStore } from "../repos/engagements.js";
import type { EmailMessage } from "./notifications.js";
import { findClosingChallenges, findDueReleases, runSweep } from "./scheduler.js";

const NOW = "2026-09-12T12:00:00.000Z";
const THREE_DAYS_AGO = "2026-09-09T12:00:00.000Z";
const ONE_HOUR_AGO = "2026-09-12T11:00:00.000Z";

function row(overrides: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    id: "ms-1",
    engagement_id: "eng-1",
    index: 0,
    name: "Design",
    description: null,
    amount: 2000,
    due_date: null,
    submitted_at: null,
    released_at: null,
    disputed: false,
    world_session_id: null,
    ...overrides,
  };
}

describe("findDueReleases", () => {
  test("reports only submitted, unreleased, undisputed milestones past the window", () => {
    const due = findDueReleases(
      [
        row({ id: "due", submitted_at: THREE_DAYS_AGO }),
        row({ id: "fresh", submitted_at: ONE_HOUR_AGO }),
        row({ id: "released", submitted_at: THREE_DAYS_AGO, released_at: THREE_DAYS_AGO }),
        row({ id: "disputed", submitted_at: THREE_DAYS_AGO, disputed: true }),
        row({ id: "draft" }),
      ],
      NOW,
    );
    expect(due).toEqual([
      {
        engagementId: "eng-1",
        milestoneIndex: 0,
        releaseAfter: "2026-09-11T12:00:00.000Z",
      },
    ]);
  });
});

function proposalRow(overrides: Partial<DisputeProposalRow> = {}): DisputeProposalRow {
  return {
    engagement_id: "eng-1",
    milestone_index: 0,
    provider_amount: 1200,
    client_refund: 800,
    proposer_wallet: "0xAa",
    challenge_deadline: "2026-09-12T15:00:00.000Z",
    challenged: false,
    executed_at: null,
    ...overrides,
  };
}

describe("findClosingChallenges", () => {
  test("reports only open proposals with deadlines inside the horizon", () => {
    const closing = findClosingChallenges(
      [
        proposalRow({ milestone_index: 0 }),
        proposalRow({ milestone_index: 1, challenge_deadline: "2026-09-20T12:00:00.000Z" }),
        proposalRow({ milestone_index: 2, challenge_deadline: "2026-09-11T12:00:00.000Z" }),
        proposalRow({ milestone_index: 3, executed_at: "2026-09-12T11:00:00.000Z" }),
      ],
      NOW,
    );
    expect(closing.map((proposal) => proposal.milestone_index)).toEqual([0]);
  });
});

describe("runSweep challenge reminders", () => {
  test("open proposals closing soon are counted and notified", async () => {
    const sent: EmailMessage[] = [];
    const milestones: MilestoneStore = {
      listByEngagement: async () => [],
      listSubmittedUnreleased: async () => [],
      listDisputed: async () => [],
      findByIndex: async (engagementId: string, index: number) =>
        engagementId === "eng-1" && index === 0 ? row() : null,
      insertMany: async () => [],
      markSubmitted: async () => null,
      markReleased: async () => null,
      setDisputed: async () => null,
      markResolved: async () => null,
      setWorldSession: async () => null,
      findByWorldSession: async () => null,
    };
    const engagements: EngagementStore = {
      findById: async (id: string) =>
        id === "eng-1"
          ? {
              id: "eng-1",
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
        throw new Error("not implemented in scheduler challenge tests");
      },
      updateStatus: async () => null,
    };
    const businesses: BusinessStore = {
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
        throw new Error("not implemented in scheduler challenge tests");
      },
    };
    const result = await runSweep({
      milestones,
      engagements,
      businesses,
      notify: {
        send: async (message: EmailMessage): Promise<void> => {
          sent.push(message);
        },
      },
      proposals: {
        listOpen: async () => [
          proposalRow({ challenge_deadline: new Date(Date.now() + 3600 * 1000).toISOString() }),
        ],
      },
    });
    expect(result.challengeClosing).toBe(1);
    expect(sent.map((message) => message.to).sort()).toEqual([
      "biz-a@example.com",
      "biz-b@example.com",
    ]);
    expect(sent[0]?.subject.includes("Challenge window closing")).toBe(true);
  });

  test("sweep without proposals reports zero challenge closings", async () => {
    const milestones: MilestoneStore = {
      listByEngagement: async () => [],
      listSubmittedUnreleased: async () => [],
      listDisputed: async () => [],
      findByIndex: async () => null,
      insertMany: async () => [],
      markSubmitted: async () => null,
      markReleased: async () => null,
      setDisputed: async () => null,
      markResolved: async () => null,
      setWorldSession: async () => null,
      findByWorldSession: async () => null,
    };
    const engagements: EngagementStore = {
      findById: async () => null,
      findByOnChainId: async () => null,
      insert: async () => {
        throw new Error("not implemented in scheduler challenge tests");
      },
      updateStatus: async () => null,
    };
    const businesses: BusinessStore = {
      findById: async () => null,
      findByWallet: async () => null,
      findBySubname: async () => null,
      findByWorldSession: async () => null,
      insert: async () => {
        throw new Error("not implemented in scheduler challenge tests");
      },
    };
    const result = await runSweep({
      milestones,
      engagements,
      businesses,
      notify: { send: async (): Promise<void> => {} },
    });
    expect(result.challengeClosing).toBe(0);
    expect(result.autoRelease).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
  });
});
