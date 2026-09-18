import type { SupabaseClient } from "@supabase/supabase-js";

export interface SplitRecipientRow {
  id: string;
  engagement_id: string;
  wallet_address: string;
  shares_bps: number;
  position: number;
}

export interface NewSplitRecipient {
  engagementId: string;
  walletAddress: string;
  sharesBps: number;
  position: number;
}

export interface PendingShareRow {
  engagement_id: string;
  wallet_address: string;
  amount: number;
  updated_at: string;
}

export interface SplitStore {
  listRecipients(engagementId: string): Promise<SplitRecipientRow[]>;
  insertRecipients(recipients: NewSplitRecipient[]): Promise<SplitRecipientRow[]>;
  listPendingShares(engagementId: string): Promise<PendingShareRow[]>;
  /** Chain is authoritative for the amount; this overwrites, it never accumulates. */
  setPendingShare(engagementId: string, walletAddress: string, amount: number): Promise<void>;
}

/** Mirror of PactEscrow's N-way split state: fixed recipient list + pull-payment fallback. */
export function createSupabaseSplitStore(client: SupabaseClient): SplitStore {
  return {
    async listRecipients(engagementId: string): Promise<SplitRecipientRow[]> {
      const result = await client
        .from("split_recipients")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("position")
        .returns<SplitRecipientRow[]>();
      if (result.error) throw new Error(`split recipient lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async insertRecipients(recipients: NewSplitRecipient[]): Promise<SplitRecipientRow[]> {
      if (recipients.length === 0) return [];
      const result = await client
        .from("split_recipients")
        .insert(
          recipients.map((recipient) => ({
            engagement_id: recipient.engagementId,
            wallet_address: recipient.walletAddress,
            shares_bps: recipient.sharesBps,
            position: recipient.position,
          })),
        )
        .select()
        .returns<SplitRecipientRow[]>();
      if (result.error) throw new Error(`split recipient insert failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async listPendingShares(engagementId: string): Promise<PendingShareRow[]> {
      const result = await client
        .from("pending_shares")
        .select("*")
        .eq("engagement_id", engagementId)
        .returns<PendingShareRow[]>();
      if (result.error) throw new Error(`pending share lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async setPendingShare(engagementId: string, walletAddress: string, amount: number): Promise<void> {
      const result = await client.from("pending_shares").upsert(
        {
          engagement_id: engagementId,
          wallet_address: walletAddress,
          amount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "engagement_id,wallet_address" },
      );
      if (result.error) throw new Error(`pending share upsert failed: ${result.error.message}`);
    },
  };
}