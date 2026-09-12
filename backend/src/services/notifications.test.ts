import { describe, expect, test } from "vitest";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementRow } from "../repos/engagements.js";
import {
  completionSubmittedEmail,
  createNotifier,
  disputeVoteEmail,
  recipientEmails,
  type EmailMessage,
} from "./notifications.js";

const ENGAGEMENT = {
  id: "eng-1",
  on_chain_id: "offchain",
  ens_subname: "eng-1.pact-hack.eth",
  party_a_id: "biz-a",
  party_b_id: "biz-b",
  template_type: 1,
  terms_hash: "0xabc",
  total_amount: 2000,
  status: "ACTIVE",
  created_at: new Date().toISOString(),
  completed_at: null,
} as const;

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
            email: id === "biz-a" ? "a@example.com" : null,
          }
        : null,
    findByWallet: async () => null,
    findBySubname: async () => null,
    findByWorldSession: async () => null,
    insert: async () => {
      throw new Error("not implemented in notification tests");
    },
  };
}

describe("notifications", () => {
  test("log-mode notifier never throws and templates render", async () => {
    const notifier = createNotifier(undefined, "Pact <noreply@example.com>");
    const sent: EmailMessage[] = [];
    const capturing = {
      send: async (message: EmailMessage): Promise<void> => {
        sent.push(message);
      },
    };
    await capturing.send({
      to: "a@example.com",
      ...completionSubmittedEmail("eng-1.pact-hack.eth", "Design", 0, 2000, "2026-09-14T00:00:00.000Z"),
    });
    await notifier.send({ to: "nobody@example.com", subject: "hi", text: "hello" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe("Completion submitted: eng-1.pact-hack.eth");
    expect(sent[0]?.text.includes("2000")).toBe(true);

    const vote = disputeVoteEmail("eng-1.pact-hack.eth", null, 0, 1200, 800);
    expect(vote.subject).toBe("Co-sign needed: eng-1.pact-hack.eth");
    expect(vote.text.includes("1200")).toBe(true);
  });

  test("recipientEmails resolves addressed parties minus exclusions", async () => {
    const engagement: EngagementRow = { ...ENGAGEMENT };
    expect(await recipientEmails(businessStore(), engagement)).toEqual(["a@example.com"]);
    expect(await recipientEmails(businessStore(), engagement, "biz-a")).toEqual([]);
  });
});
