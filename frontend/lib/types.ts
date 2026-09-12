export type TemplateType =
  | "fixed"
  | "milestone"
  | "retainer"
  | "t-and-m"
  | "recurring"
  | "split"
  | "custom";

export interface Business {
  id: string;
  slug: string;
  ensSubname: string; // "<slug>.pact-hack.eth"
  walletAddress: string;
  worldVerified: boolean;
  worldSessionId: string;
  joinedAt: string; // ISO
  completedCount: number;
  disputeCount: number;
  totalValue: number;
}

export type MilestoneStatus =
  | "pending"
  | "submitted"
  | "released"
  | "disputed";

export interface Milestone {
  index: number;
  name: string;
  deliverable: string;
  due: string; // ISO date
  amount: number;
  status: MilestoneStatus;
  worldRequired: boolean;
  worldVerifiedAt?: string;
  submittedAt?: string;
  releasedAt?: string;
}

export type EngagementStatus =
  | "proposed"
  | "active"
  | "completed"
  | "disputed"
  | "cancelled";

export interface Engagement {
  id: string;
  ensSubname: string; // "eng-xxxxx.pact-hack.eth"
  templateType: TemplateType;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  partyAId: string; // proposer (business id)
  partyBSlug: string; // counterparty slug, may not exist yet as a Business
  partyBId?: string;
  totalAmount: number;
  milestones: Milestone[];
  acceptanceWindowHours: number;
  termsHash: string;
  status: EngagementStatus;
  hadDispute?: boolean; // sticky — true forever once any milestone is disputed, even after resolution
  createdAt: string;
  completedAt?: string;
  splitShareA?: number; // basis points, template 6 only
  splitShareB?: number;
  fields: Record<string, string>; // raw template-specific fields for the terms preview
}

export interface ReputationEvent {
  id: string;
  engagementId: string;
  engagementEnsSubname: string;
  businessId: string;
  counterpartySlug: string;
  templateType: TemplateType;
  totalValue: number;
  onTime: boolean;
  disputed: boolean;
  txHash: string;
  emittedAt: string;
}

export interface PactState {
  currentBusinessId: string | null;
  businesses: Record<string, Business>;
  engagements: Record<string, Engagement>;
  reputationEvents: ReputationEvent[];
  toasts: Toast[];
}

export interface Toast {
  id: string;
  message: string;
  tone: "stamp" | "ember" | "ink";
}