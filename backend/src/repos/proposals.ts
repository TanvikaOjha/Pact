import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProposalMilestone {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
  worldRequired: boolean;
}

/** Canonical terms plus hash, exactly as the counterparty will verify them. */
export interface StoredProposalTerms {
  templateType: number;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  acceptanceWindowHours: number;
  milestones: ProposalMilestone[];
  fields: Record<string, string>;
  splitShareA?: number;
  splitShareB?: number;
  termsHash: string;
}

export interface ProposalRow {
  token: string;
  template_type: number;
  fields: StoredProposalTerms;
  proposer_id: string | null;
  expires_at: string;
  created_at: string;
  accepted_engagement_id: string | null;
}

export interface NewProposal {
  token: string;
  templateType: number;
  terms: StoredProposalTerms;
  proposerId: string;
  expiresAt: string;
}

export interface ProposalStore {
  findByToken(token: string): Promise<ProposalRow | null>;
  insert(proposal: NewProposal): Promise<ProposalRow>;
  markAccepted(token: string, engagementId: string): Promise<ProposalRow | null>;
}

function firstRow(rows: ProposalRow[] | null): ProposalRow | null {
  if (rows === null || rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined) return null;
  return row;
}

/** Ephemeral pre-signature drafts. Rows expire after 14 days; nothing here is authoritative. */
export function createSupabaseProposalStore(client: SupabaseClient): ProposalStore {
  return {
    async findByToken(token: string): Promise<ProposalRow | null> {
      const result = await client
        .from("proposals")
        .select("*")
        .eq("token", token)
        .limit(1)
        .returns<ProposalRow[]>();
      if (result.error) throw new Error(`proposal lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async insert(proposal: NewProposal): Promise<ProposalRow> {
      const result = await client
        .from("proposals")
        .insert({
          token: proposal.token,
          template_type: proposal.templateType,
          fields: proposal.terms,
          proposer_id: proposal.proposerId,
          expires_at: proposal.expiresAt,
        })
        .select()
        .returns<ProposalRow[]>();
      if (result.error) throw new Error(`proposal insert failed: ${result.error.message}`);
      const row = firstRow(result.data);
      if (row === null) throw new Error("proposal insert returned no row");
      return row;
    },
    async markAccepted(token: string, engagementId: string): Promise<ProposalRow | null> {
      const result = await client
        .from("proposals")
        .update({ accepted_engagement_id: engagementId })
        .eq("token", token)
        .select()
        .returns<ProposalRow[]>();
      if (result.error) throw new Error(`proposal update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
  };
}
