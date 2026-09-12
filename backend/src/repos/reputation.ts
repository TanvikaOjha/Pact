import type { SupabaseClient } from "@supabase/supabase-js";

export interface ReputationEventRow {
  id: string;
  engagement_id: string;
  business_id: string;
  counterparty_id: string;
  template_type: number;
  total_value: number;
  on_time: boolean;
  disputed: boolean;
  tx_hash: string | null;
  emitted_at: string;
}

export interface NewReputationEvent {
  engagementId: string;
  businessId: string;
  counterpartyId: string;
  templateType: number;
  totalValue: number;
  onTime: boolean;
  disputed: boolean;
  txHash: string | null;
  emittedAt: string;
}

export interface ReputationStore {
  recordCompletion(events: NewReputationEvent[]): Promise<void>;
  eventsForBusiness(businessId: string): Promise<ReputationEventRow[]>;
}

/** Append-only mirror of PactCompleted events (one row per party perspective). */
export function createSupabaseReputationStore(client: SupabaseClient): ReputationStore {
  return {
    async recordCompletion(events: NewReputationEvent[]): Promise<void> {
      if (events.length === 0) return;
      const result = await client.from("reputation_events").insert(
        events.map((event) => ({
          engagement_id: event.engagementId,
          business_id: event.businessId,
          counterparty_id: event.counterpartyId,
          template_type: event.templateType,
          total_value: event.totalValue,
          on_time: event.onTime,
          disputed: event.disputed,
          tx_hash: event.txHash,
          emitted_at: event.emittedAt,
        })),
      );
      if (result.error) throw new Error(`reputation insert failed: ${result.error.message}`);
    },
    async eventsForBusiness(businessId: string): Promise<ReputationEventRow[]> {
      const result = await client
        .from("reputation_events")
        .select("*")
        .eq("business_id", businessId)
        .order("emitted_at", { ascending: false })
        .returns<ReputationEventRow[]>();
      if (result.error) throw new Error(`reputation lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
  };
}
