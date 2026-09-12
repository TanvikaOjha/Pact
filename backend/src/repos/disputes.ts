import type { SupabaseClient } from "@supabase/supabase-js";

export interface DisputeVoteRow {
  id: string;
  engagement_id: string;
  milestone_index: number;
  wallet_address: string;
  provider_amount: number;
  client_refund: number;
  created_at: string;
}

export interface NewDisputeVote {
  engagementId: string;
  milestoneIndex: number;
  walletAddress: string;
  providerAmount: number;
  clientRefund: number;
}

export interface DisputeVoteStore {
  /** Counterparty vote with identical amounts, excluding the given wallet. */
  findMatchingCounterVote(
    engagementId: string,
    milestoneIndex: number,
    providerAmount: number,
    clientRefund: number,
    excludeWallet: string,
  ): Promise<DisputeVoteRow | null>;
  recordVote(vote: NewDisputeVote): Promise<DisputeVoteRow>;
  hasVotesForEngagement(engagementId: string): Promise<boolean>;
}

function firstRow(rows: DisputeVoteRow[] | null): DisputeVoteRow | null {
  if (rows === null || rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined) return null;
  return row;
}

function firstProposalRow(rows: DisputeProposalRow[] | null): DisputeProposalRow | null {
  if (rows === null || rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined) return null;
  return row;
}

/** Mirror of the on-chain vote quorum (see PactEscrow.resolveDispute). */
export function createSupabaseDisputeVoteStore(client: SupabaseClient): DisputeVoteStore {
  return {
    async findMatchingCounterVote(
      engagementId: string,
      milestoneIndex: number,
      providerAmount: number,
      clientRefund: number,
      excludeWallet: string,
    ): Promise<DisputeVoteRow | null> {
      const result = await client
        .from("dispute_votes")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("milestone_index", milestoneIndex)
        .eq("provider_amount", providerAmount)
        .eq("client_refund", clientRefund)
        .neq("wallet_address", excludeWallet)
        .limit(1)
        .returns<DisputeVoteRow[]>();
      if (result.error) throw new Error(`dispute vote lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async recordVote(vote: NewDisputeVote): Promise<DisputeVoteRow> {
      const result = await client
        .from("dispute_votes")
        .upsert(
          {
            engagement_id: vote.engagementId,
            milestone_index: vote.milestoneIndex,
            wallet_address: vote.walletAddress,
            provider_amount: vote.providerAmount,
            client_refund: vote.clientRefund,
          },
          { onConflict: "engagement_id,milestone_index,wallet_address" },
        )
        .select()
        .returns<DisputeVoteRow[]>();
      if (result.error) throw new Error(`dispute vote insert failed: ${result.error.message}`);
      const row = firstRow(result.data);
      if (row === null) throw new Error("dispute vote insert returned no row");
      return row;
    },
    async hasVotesForEngagement(engagementId: string): Promise<boolean> {
      const result = await client
        .from("dispute_votes")
        .select("id")
        .eq("engagement_id", engagementId)
        .limit(1)
        .returns<Array<{ id: string }>>();
      if (result.error) throw new Error(`dispute vote lookup failed: ${result.error.message}`);
      return result.data !== null && result.data.length > 0;
    },
  };
}

export interface DisputeProposalRow {
  engagement_id: string;
  milestone_index: number;
  provider_amount: number;
  client_refund: number;
  proposer_wallet: string;
  challenge_deadline: string;
  challenged: boolean;
  executed_at: string | null;
}

export interface NewDisputeProposal {
  engagementId: string;
  milestoneIndex: number;
  providerAmount: number;
  clientRefund: number;
  proposerWallet: string;
  challengeDeadline: string;
}

export interface DisputeProposalStore {
  findProposal(engagementId: string, index: number): Promise<DisputeProposalRow | null>;
  upsertProposal(row: NewDisputeProposal): Promise<DisputeProposalRow>;
  markChallenged(engagementId: string, index: number): Promise<void>;
  markExecuted(engagementId: string, index: number, executedAt: string): Promise<void>;
  listOpen(): Promise<DisputeProposalRow[]>;
}

/** Mirror of on-chain optimistic-dispute state (propose/challenge/execute). */
export function createSupabaseDisputeProposalStore(client: SupabaseClient): DisputeProposalStore {
  return {
    async findProposal(engagementId: string, index: number): Promise<DisputeProposalRow | null> {
      const result = await client
        .from("dispute_proposals")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("milestone_index", index)
        .limit(1)
        .returns<DisputeProposalRow[]>();
      if (result.error) throw new Error(`dispute proposal lookup failed: ${result.error.message}`);
      return firstProposalRow(result.data);
    },
    async upsertProposal(row: NewDisputeProposal): Promise<DisputeProposalRow> {
      const result = await client
        .from("dispute_proposals")
        .upsert(
          {
            engagement_id: row.engagementId,
            milestone_index: row.milestoneIndex,
            provider_amount: row.providerAmount,
            client_refund: row.clientRefund,
            proposer_wallet: row.proposerWallet,
            challenge_deadline: row.challengeDeadline,
          },
          { onConflict: "engagement_id,milestone_index" },
        )
        .select()
        .returns<DisputeProposalRow[]>();
      if (result.error) throw new Error(`dispute proposal upsert failed: ${result.error.message}`);
      const created = firstProposalRow(result.data);
      if (created === null) throw new Error("dispute proposal upsert returned no row");
      return created;
    },
    async markChallenged(engagementId: string, index: number): Promise<void> {
      const result = await client
        .from("dispute_proposals")
        .update({ challenged: true })
        .eq("engagement_id", engagementId)
        .eq("milestone_index", index);
      if (result.error) throw new Error(`dispute proposal update failed: ${result.error.message}`);
    },
    async markExecuted(engagementId: string, index: number, executedAt: string): Promise<void> {
      const result = await client
        .from("dispute_proposals")
        .update({ executed_at: executedAt })
        .eq("engagement_id", engagementId)
        .eq("milestone_index", index);
      if (result.error) throw new Error(`dispute proposal update failed: ${result.error.message}`);
    },
    async listOpen(): Promise<DisputeProposalRow[]> {
      const result = await client
        .from("dispute_proposals")
        .select("*")
        .is("executed_at", null)
        .returns<DisputeProposalRow[]>();
      if (result.error) throw new Error(`dispute proposal lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
  };
}
