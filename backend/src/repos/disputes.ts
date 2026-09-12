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
