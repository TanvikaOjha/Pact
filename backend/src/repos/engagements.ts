import type { SupabaseClient } from "@supabase/supabase-js";

export type EngagementStatus = "PROPOSED" | "ACTIVE" | "COMPLETED" | "DISPUTED" | "CANCELLED";

export interface EngagementRow {
  id: string;
  on_chain_id: string;
  ens_subname: string;
  party_a_id: string | null;
  party_b_id: string | null;
  template_type: number;
  terms_hash: string;
  total_amount: number;
  status: EngagementStatus;
  created_at: string;
  completed_at: string | null;
  /** Optional: absent on rows written before migration 0007. */
  visibility?: string | null;
  default_provider_bps?: number | null;
  challenge_window_seconds?: number | null;
}

export interface NewEngagement {
  onChainId: string;
  ensSubname: string;
  partyAId: string;
  partyBId: string;
  templateType: number;
  termsHash: string;
  totalAmount: number;
  visibility?: string;
  defaultProviderBps?: number | null;
  challengeWindowSeconds?: number | null;
}

export interface EngagementStore {
  findById(id: string): Promise<EngagementRow | null>;
  findByOnChainId(onChainId: string): Promise<EngagementRow | null>;
  insert(engagement: NewEngagement): Promise<EngagementRow>;
  updateStatus(id: string, status: EngagementStatus): Promise<EngagementRow | null>;
}

export interface EngagementStatusPatch {
  status: EngagementStatus;
  completed_at?: string;
}

interface MilestoneSubmitPatch {
  submitted_at: string;
  evidence_hash?: string | null;
  late?: boolean;
}

export interface MilestoneRow {
  id: string;
  engagement_id: string;
  index: number;
  name: string | null;
  description: string | null;
  amount: number;
  due_date: string | null;
  submitted_at: string | null;
  released_at: string | null;
  disputed: boolean;
  world_session_id: string | null;
  /** Optional: absent on rows written before migration 0006. */
  disputed_at?: string | null;
  /** Optional: absent on rows written before migration 0007. */
  evidence_hash?: string | null;
  late?: boolean;
}

export interface NewMilestone {
  engagementId: string;
  index: number;
  name: string | null;
  description: string | null;
  amount: number;
  dueDate: string | null;
}

export interface MilestoneStore {
  listByEngagement(engagementId: string): Promise<MilestoneRow[]>;
  listSubmittedUnreleased(): Promise<MilestoneRow[]>;
  listDisputed(): Promise<MilestoneRow[]>;
  findByIndex(engagementId: string, index: number): Promise<MilestoneRow | null>;
  insertMany(milestones: NewMilestone[]): Promise<MilestoneRow[]>;
  markSubmitted(
    id: string,
    submittedAt: string,
    evidenceHash?: string | null,
    late?: boolean,
  ): Promise<MilestoneRow | null>;
  markReleased(id: string, releasedAt: string): Promise<MilestoneRow | null>;
  setDisputed(id: string, disputed: boolean): Promise<MilestoneRow | null>;
  markResolved(id: string, releasedAt: string): Promise<MilestoneRow | null>;
  setWorldSession(id: string, worldSessionId: string): Promise<MilestoneRow | null>;
  findByWorldSession(worldSessionId: string): Promise<MilestoneRow | null>;
}

function firstRow<T>(rows: T[] | null): T | null {
  if (rows === null || rows.length === 0) return null;
  const row = rows[0];
  if (row === undefined) return null;
  return row;
}

async function findOne<T>(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<T | null> {
  const result = await client.from(table).select("*").eq(column, value).limit(1).returns<T[]>();
  if (result.error) throw new Error(`engagement lookup failed: ${result.error.message}`);
  return firstRow(result.data);
}

/** Mirror of on-chain engagement + milestone state. Chain is authoritative. */
export function createSupabaseEngagementStore(client: SupabaseClient): EngagementStore {
  return {
    findById: (id: string) => findOne<EngagementRow>(client, "engagements", "id", id),
    findByOnChainId: (onChainId: string) =>
      findOne<EngagementRow>(client, "engagements", "on_chain_id", onChainId),
    async insert(engagement: NewEngagement): Promise<EngagementRow> {
      const result = await client
        .from("engagements")
        .insert({
          on_chain_id: engagement.onChainId,
          ens_subname: engagement.ensSubname,
          party_a_id: engagement.partyAId,
          party_b_id: engagement.partyBId,
          template_type: engagement.templateType,
          terms_hash: engagement.termsHash,
          total_amount: engagement.totalAmount,
          status: "PROPOSED",
          visibility: engagement.visibility ?? "public",
          default_provider_bps: engagement.defaultProviderBps ?? null,
          challenge_window_seconds: engagement.challengeWindowSeconds ?? null,
        })
        .select()
        .returns<EngagementRow[]>();
      if (result.error) throw new Error(`engagement insert failed: ${result.error.message}`);
      const row = firstRow(result.data);
      if (row === null) throw new Error("engagement insert returned no row");
      return row;
    },
    async updateStatus(id: string, status: EngagementStatus): Promise<EngagementRow | null> {
      const patch: EngagementStatusPatch = { status };
      if (status === "COMPLETED") {
        patch.completed_at = new Date().toISOString();
      }
      const result = await client
        .from("engagements")
        .update(patch)
        .eq("id", id)
        .select()
        .returns<EngagementRow[]>();
      if (result.error) throw new Error(`engagement update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
  };
}

export function createSupabaseMilestoneStore(client: SupabaseClient): MilestoneStore {
  return {
    async listByEngagement(engagementId: string): Promise<MilestoneRow[]> {
      const result = await client
        .from("milestones")
        .select("*")
        .eq("engagement_id", engagementId)
        .order("index")
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async listSubmittedUnreleased(): Promise<MilestoneRow[]> {
      const result = await client
        .from("milestones")
        .select("*")
        .not("submitted_at", "is", null)
        .is("released_at", null)
        .eq("disputed", false)
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async listDisputed(): Promise<MilestoneRow[]> {
      const result = await client
        .from("milestones")
        .select("*")
        .eq("disputed", true)
        .is("released_at", null)
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone lookup failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async findByIndex(engagementId: string, index: number): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .select("*")
        .eq("engagement_id", engagementId)
        .eq("index", index)
        .limit(1)
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async insertMany(milestones: NewMilestone[]): Promise<MilestoneRow[]> {
      if (milestones.length === 0) return [];
      const result = await client
        .from("milestones")
        .insert(
          milestones.map((milestone) => ({
            engagement_id: milestone.engagementId,
            index: milestone.index,
            name: milestone.name,
            description: milestone.description,
            amount: milestone.amount,
            due_date: milestone.dueDate,
          })),
        )
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone insert failed: ${result.error.message}`);
      return result.data ?? [];
    },
    async markSubmitted(
      id: string,
      submittedAt: string,
      evidenceHash?: string | null,
      late?: boolean,
    ): Promise<MilestoneRow | null> {
      const patch: MilestoneSubmitPatch = { submitted_at: submittedAt };
      if (evidenceHash !== undefined) patch.evidence_hash = evidenceHash;
      if (late !== undefined) patch.late = late;
      const result = await client
        .from("milestones")
        .update(patch)
        .eq("id", id)
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async markReleased(id: string, releasedAt: string): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .update({ released_at: releasedAt })
        .eq("id", id)
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async setDisputed(id: string, disputed: boolean): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .update({ disputed, disputed_at: disputed ? new Date().toISOString() : null })
        .eq("id", id)
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async markResolved(id: string, releasedAt: string): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .update({ disputed: false, released_at: releasedAt })
        .eq("id", id)
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async setWorldSession(id: string, worldSessionId: string): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .update({ world_session_id: worldSessionId })
        .eq("id", id)
        .select()
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone update failed: ${result.error.message}`);
      return firstRow(result.data);
    },
    async findByWorldSession(worldSessionId: string): Promise<MilestoneRow | null> {
      const result = await client
        .from("milestones")
        .select("*")
        .eq("world_session_id", worldSessionId)
        .limit(1)
        .returns<MilestoneRow[]>();
      if (result.error) throw new Error(`milestone lookup failed: ${result.error.message}`);
      return firstRow(result.data);
    },
  };
}
