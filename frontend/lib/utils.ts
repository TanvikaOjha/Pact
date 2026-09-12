// Pure client-side helpers: formatting plus localStorage persistence for
// engagement records mirrored from real API responses. The backend has no
// GET-engagement endpoint, so snapshots returned by propose/accept/submit
// calls are the record — chain state stays authoritative.

export function truncateMid(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatUSDC(amount: number): string {
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 24);
}

export interface LocalMilestone {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
  worldRequired: boolean;
  submittedAt: string | null;
  releasedAt: string | null;
  disputed: boolean;
  late: boolean;
  evidenceHash: string | null;
}

export type LocalEngagementStatus = "PROPOSED" | "ACTIVE" | "COMPLETED" | "DISPUTED";

export interface LocalEngagement {
  id: string;
  onChainId: string;
  ensSubname: string;
  templateType: number;
  templateName: string;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  termsHash: string;
  status: LocalEngagementStatus;
  counterparty: string;
  proposerWallet: string;
  milestones: LocalMilestone[];
  proposalToken: string;
  visibility: string;
  updatedAt: string;
}

const ENGAGEMENTS_KEY = "pact.engagements.v1";
const SUBNAMES_KEY = "pact.subnames.v1";
const PROPOSALS_KEY = "pact.proposals.v1";

export interface ProposalSnapshot {
  token: string;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  termsHash: string;
  templateType: number;
  templateName: string;
  counterparty: string;
  proposerWallet: string;
  visibility: string;
  milestones: LocalMilestone[];
}

function readMap(key: string): Record<string, string> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

export function loadEngagements(): Record<string, LocalEngagement> {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(ENGAGEMENTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LocalEngagement>;
  } catch {
    return {};
  }
}

export function loadEngagement(id: string): LocalEngagement | null {
  return loadEngagements()[id] ?? null;
}

export function saveEngagement(engagement: LocalEngagement): void {
  if (typeof window === "undefined") return;
  const all = loadEngagements();
  all[engagement.id] = {
    ...engagement,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(ENGAGEMENTS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — the record simply won't persist.
  }
}

export function saveSubnameFor(wallet: string, subname: string): void {
  if (typeof window === "undefined") return;
  const map = readMap(SUBNAMES_KEY);
  map[wallet.toLowerCase()] = subname;
  try {
    window.localStorage.setItem(SUBNAMES_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — the label simply won't persist.
  }
}

export function loadSubnameFor(wallet: string): string | null {
  return readMap(SUBNAMES_KEY)[wallet.toLowerCase()] ?? null;
}

export function saveProposalSnapshot(snapshot: ProposalSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PROPOSALS_KEY);
    const all: Record<string, ProposalSnapshot> = raw ? JSON.parse(raw) : {};
    all[snapshot.token] = snapshot;
    window.localStorage.setItem(PROPOSALS_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable — the snapshot simply won't persist.
  }
}

export function loadProposalSnapshot(token: string): ProposalSnapshot | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(PROPOSALS_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, ProposalSnapshot>;
    return all[token] ?? null;
  } catch {
    return null;
  }
}
