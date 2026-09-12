import { Resend } from "resend";

import type { BusinessStore } from "../repos/businesses.js";
import type { EngagementRow } from "../repos/engagements.js";
import { log } from "./log.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Notifier {
  send(message: EmailMessage): Promise<void>;
}

interface EmailContent {
  subject: string;
  text: string;
}

/**
 * Resend-backed notifier, log-only without an API key. send() never throws:
 * delivery failures are logged so notifications can't break API responses.
 */
export function createNotifier(apiKey: string | undefined, from: string): Notifier {
  if (apiKey === undefined || apiKey === "") {
    return {
      send: async (message: EmailMessage): Promise<void> => {
        log.info(`notify (log mode) to=${message.to} subject=${message.subject}`);
      },
    };
  }
  const resend = new Resend(apiKey);
  return {
    send: async (message: EmailMessage): Promise<void> => {
      try {
        const result = await resend.emails.send({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        if (result.error) {
          log.error(`notify failed to=${message.to}: ${result.error.message}`);
          return;
        }
        log.info(`notified ${message.to}: ${message.subject}`);
      } catch {
        log.error(`notify threw for to=${message.to}`);
      }
    },
  };
}

/** Emails of both parties with addresses on file, optionally excluding one. */
export async function recipientEmails(
  businesses: BusinessStore,
  engagement: EngagementRow,
  excludeBusinessId?: string,
): Promise<string[]> {
  const emails: string[] = [];
  const ids = [engagement.party_a_id, engagement.party_b_id];
  for (const id of ids) {
    if (id === null || id === excludeBusinessId) continue;
    const business = await businesses.findById(id);
    const email = business?.email ?? null;
    if (email !== null && email !== "") emails.push(email);
  }
  return emails;
}

export async function notifyAll(
  notifier: Notifier,
  recipients: string[],
  content: EmailContent,
): Promise<void> {
  for (const to of recipients) {
    await notifier.send({ to, subject: content.subject, text: content.text });
  }
}

function milestoneLabel(name: string | null, index: number): string {
  return name ?? `milestone ${index}`;
}

export function completionSubmittedEmail(
  ensSubname: string,
  name: string | null,
  index: number,
  amount: number,
  releaseAfter: string,
): EmailContent {
  return {
    subject: `Completion submitted: ${ensSubname}`,
    text: [
      `A completion notice was submitted for ${milestoneLabel(name, index)} (${amount} USDC)`,
      `on engagement ${ensSubname}.`,
      `Accept on-chain before ${releaseAfter}, dispute within the window,`,
      `or it auto-releases.`,
    ].join("\n"),
  };
}

export function milestoneReleasedEmail(
  ensSubname: string,
  name: string | null,
  index: number,
  amount: number,
): EmailContent {
  return {
    subject: `Milestone released: ${ensSubname}`,
    text: [
      `${milestoneLabel(name, index)} (${amount} USDC) on engagement ${ensSubname}`,
      `was released from escrow.`,
    ].join("\n"),
  };
}

export function disputeRaisedEmail(
  ensSubname: string,
  name: string | null,
  index: number,
): EmailContent {
  return {
    subject: `Dispute raised: ${ensSubname}`,
    text: [
      `${milestoneLabel(name, index)} on engagement ${ensSubname} is disputed.`,
      `Funds stay in escrow until both parties co-sign a resolution.`,
    ].join("\n"),
  };
}

export function disputeResolvedEmail(ensSubname: string, name: string | null, index: number): EmailContent {
  return {
    subject: `Dispute resolved: ${ensSubname}`,
    text: [
      `The dispute over ${milestoneLabel(name, index)} on engagement ${ensSubname}`,
      `was resolved by mutual agreement.`,
    ].join("\n"),
  };
}

export function disputeVoteEmail(
  ensSubname: string,
  name: string | null,
  index: number,
  providerAmount: number,
  clientRefund: number,
): EmailContent {
  return {
    subject: `Co-sign needed: ${ensSubname}`,
    text: [
      `Your counterparty proposed resolving ${milestoneLabel(name, index)} on`,
      `engagement ${ensSubname} as ${providerAmount} to provider / ${clientRefund} refund.`,
      `Submit the identical split to release the funds.`,
    ].join("\n"),
  };
}

export function releaseDueEmail(
  ensSubname: string,
  name: string | null,
  index: number,
  releaseAfter: string,
): EmailContent {
  return {
    subject: `Auto-release due: ${ensSubname}`,
    text: [
      `${milestoneLabel(name, index)} on engagement ${ensSubname} passed its`,
      `acceptance window (${releaseAfter}) and will auto-release.`,
    ].join("\n"),
  };
}

export function windowClosingEmail(
  ensSubname: string,
  name: string | null,
  index: number,
  releaseAfter: string,
): EmailContent {
  return {
    subject: `Acceptance window closing: ${ensSubname}`,
    text: [
      `${milestoneLabel(name, index)} on engagement ${ensSubname} auto-releases`,
      `at ${releaseAfter}. Accept or dispute before then.`,
    ].join("\n"),
  };
}

export function proposalExpiringEmail(token: string, expiresAt: string): EmailContent {
  return {
    subject: `Proposal expiring soon: ${token}`,
    text: [
      `Your proposal ${token} expires at ${expiresAt} without a counter-signature.`,
      `No funds move unless the counterparty accepts in time.`,
    ].join("\n"),
  };
}

export function proposalCreatedEmail(token: string, expiresAt: string): EmailContent {
  return {
    subject: `Proposal created: ${token}`,
    text: [
      `Your proposal ${token} expires at ${expiresAt}.`,
      `The counterparty link view is public; share the token so they can review and accept.`,
    ].join("\n"),
  };
}

export function proposalAcceptedEmail(
  engagementSubname: string,
  counterpartySubname: string,
): EmailContent {
  return {
    subject: `Proposal accepted: ${engagementSubname}`,
    text: [
      `Your proposal was accepted by ${counterpartySubname} as engagement ${engagementSubname}.`,
      `On-chain signatures and funding follow.`,
    ].join("\n"),
  };
}

export function disputeStaleEmail(ensSubname: string, name: string | null, index: number): EmailContent {
  return {
    subject: `Stale dispute needs co-signature: ${ensSubname}`,
    text: [
      `${milestoneLabel(name, index)} on engagement ${ensSubname} has been`,
      `disputed for 30 days with no resolution. Pact cannot force one:`,
      `co-sign a split or seek external arbitration. USDC stays in escrow.`,
    ].join("\n"),
  };
}
