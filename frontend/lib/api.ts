// Typed client for the Pact backend (Express API in `backend/src`).
//
// One async method per backend endpoint, with request/response interfaces
// mirroring the backend's wire shapes verbatim (snake_case stays snake_case).
// On-chain state remains authoritative; these calls only touch the mirror.
//
// Auth semantics (see `backend/src/middleware/privyAuth.ts`):
// - Privy access token present  -> `Authorization: Bearer <token>`
// - else dev wallet present     -> `x-wallet-address` (+ `x-privy-wallet-id: dev`)
//                                 (backend only honors these when ALLOW_DEV_AUTH=true)
// - neither                     -> request still sent; public endpoints work, authed ones 401.

export interface ApiCredentials {
  token?: string | null;
  wallet?: string | null;
}

export interface ApiClientOptions {
  baseUrl?: string;
  getAuth?: () => ApiCredentials;
}

/** Opaque World IDKit result, forwarded byte-for-byte and verified server-side. */
export interface WorldProofPayload {
  [key: string]: string | string[] | number | boolean | null;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(message ?? code ?? `request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    if (code !== undefined) this.code = code;
  }
}

export interface HealthResponse {
  ok: boolean;
  service: string;
}

export interface Identity {
  walletAddress: string;
  privyWalletId: string;
}

export interface MeResponse {
  identity: Identity | null;
}

export interface RegisterBusinessInput {
  slug: string;
  proof: WorldProofPayload;
  email?: string;
}

export interface RegisterBusinessResponse {
  ensSubname: string;
  walletAddress: string;
  worldSessionId: string;
  worldSessionIdBytes32: string;
  status: "pending_onchain";
}

export interface ProposalMilestoneInput {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
  worldRequired: boolean;
}

export interface CreateProposalInput {
  templateType: number;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  acceptanceWindowHours?: number;
  milestones?: ProposalMilestoneInput[];
  fields?: Record<string, string>;
  splitShareA?: number;
  splitShareB?: number;
}

export interface CreateProposalResponse {
  token: string;
  expiresAt: string;
  termsHash: string;
}

/** Canonical terms as stored on the proposal row (`fields` column). */
export interface ProposalTerms {
  templateType: number;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  acceptanceWindowHours: number;
  milestones: ProposalMilestoneInput[];
  fields: Record<string, string>;
  splitShareA?: number;
  splitShareB?: number;
  termsHash: string;
}

export interface GetProposalResponse {
  token: string;
  templateType: number;
  terms: ProposalTerms;
  proposer: { ensSubname: string } | null;
  expiresAt: string;
}

export interface AcceptProposalResponse {
  engagementId: string;
  ensSubname: string;
  milestones: number;
}

export type EngagementStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "COMPLETED"
  | "DISPUTED"
  | "CANCELLED";

export interface EngagementMilestoneInput {
  index: number;
  name?: string | null;
  description?: string | null;
  amount: number;
  dueDate?: string | null;
}

export interface CreateEngagementInput {
  counterpartyWallet: string;
  templateType: number;
  termsHash: string;
  totalAmount: number;
  onChainId?: string;
  ensSubname?: string;
  milestones?: EngagementMilestoneInput[];
  visibility?: "public" | "commit";
  defaultProviderBps?: number | null;
  challengeWindowSeconds?: number | null;
}

export interface CreateEngagementResponse {
  id: string;
  status: EngagementStatus;
  milestones: number;
}

export interface SubmitMilestoneResponse {
  submittedAt: string;
  releaseAfter: string;
  evidenceHash: string | null;
  late: boolean;
}

export interface ReleaseMilestoneResponse {
  releasedAt: string;
  engagementCompleted: boolean;
}

export interface WorldCheckResponse {
  worldSessionId: string;
}

export interface RaiseDisputeResponse {
  disputed: boolean;
}

export interface ResolveDisputeResponse {
  resolved: boolean;
  releasedAt?: string;
  engagementCompleted?: boolean;
}

export interface ProposeResolutionResponse {
  proposed: boolean;
  challengeDeadline: string;
}

export interface ChallengeResolutionResponse {
  challenged: boolean;
}

export interface VerifyWorldResponse {
  pass: boolean;
  sessionId: string | null;
  nullifier: string | null;
}

export interface ReputationRecentItem {
  templateType: number;
  totalValue: number;
  onTime: boolean;
  disputed: boolean;
  counterpartySubname: string | null;
  redacted: boolean;
  emittedAt: string;
  txHash: string | null;
}

export interface ReputationResponse {
  ensSubname: string;
  completedCount: number;
  totalValue: number;
  onTimeRate: number | null;
  disputeCount: number;
  score: number;
  tier: number;
  scoreVersion: number;
  recent: ReputationRecentItem[];
}

export interface DueRelease {
  engagementId: string;
  milestoneIndex: number;
  releaseAfter: string;
}

export interface SweepResponse {
  checkedAt: string;
  due: DueRelease[];
  closingSoon: number;
  autoRelease: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
  challengeClosing: number;
}

export interface ArchiveSkip {
  reason: string;
  engagementId: string;
  partyA: string;
  partyB: string;
  txHash: string | null;
  archivedAt: string;
}

export interface ArchiveResponse {
  count: number;
  skips: ArchiveSkip[];
}

export interface PactApi {
  health(): Promise<HealthResponse>;
  me(): Promise<MeResponse>;
  registerBusiness(input: RegisterBusinessInput): Promise<RegisterBusinessResponse>;
  createProposal(draft: CreateProposalInput): Promise<CreateProposalResponse>;
  getProposal(token: string): Promise<GetProposalResponse>;
  acceptProposal(token: string): Promise<AcceptProposalResponse>;
  createEngagement(draft: CreateEngagementInput): Promise<CreateEngagementResponse>;
  submitMilestone(
    id: string,
    index: number,
    evidenceHash?: string,
  ): Promise<SubmitMilestoneResponse>;
  releaseMilestone(
    id: string,
    index: number,
    viaExecute?: boolean,
  ): Promise<ReleaseMilestoneResponse>;
  worldCheck(id: string, index: number, proof: WorldProofPayload): Promise<WorldCheckResponse>;
  raiseDispute(id: string, index: number): Promise<RaiseDisputeResponse>;
  resolveDispute(
    id: string,
    index: number,
    providerAmount: number,
    clientRefund: number,
  ): Promise<ResolveDisputeResponse>;
  proposeResolution(
    id: string,
    index: number,
    providerAmount: number,
    clientRefund: number,
  ): Promise<ProposeResolutionResponse>;
  challengeResolution(id: string, index: number): Promise<ChallengeResolutionResponse>;
  verifyWorld(proof: WorldProofPayload): Promise<VerifyWorldResponse>;
  getReputation(subname: string): Promise<ReputationResponse>;
  schedulerSweep(): Promise<SweepResponse>;
  schedulerArchive(): Promise<ArchiveResponse>;
}

function authHeaders(getAuth?: () => ApiCredentials): Record<string, string> {
  const creds = getAuth?.();
  const token = creds?.token;
  if (token !== undefined && token !== null && token !== "") {
    return { authorization: `Bearer ${token}` };
  }
  const wallet = creds?.wallet;
  if (wallet !== undefined && wallet !== null && wallet !== "") {
    return { "x-wallet-address": wallet, "x-privy-wallet-id": "dev" };
  }
  return {};
}

function errorCodeFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === "string") return error;
  // Some endpoints report failures via `{ pass: false, code }` (e.g. World verify 422).
  const code = record.code;
  if (typeof code === "string") return code;
  return undefined;
}

export function createApiClient(options?: ApiClientOptions): PactApi {
  const baseUrl =
    options?.baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  const getAuth = options?.getAuth;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...authHeaders(getAuth),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      let code: string | undefined;
      try {
        code = errorCodeFromBody(await res.json());
      } catch {
        // Non-JSON error body — fall back to the HTTP status text below.
      }
      throw new ApiError(res.status, code, res.statusText);
    }
    return (await res.json()) as T;
  }

  function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    });
  }

  return {
    health() {
      return request<HealthResponse>("/health");
    },
    me() {
      return request<MeResponse>("/api/me");
    },
    registerBusiness(input) {
      return request<RegisterBusinessResponse>("/api/businesses/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    createProposal(draft) {
      return post<CreateProposalResponse>("/api/proposals", draft);
    },
    getProposal(token) {
      return request<GetProposalResponse>(`/api/proposals/${encodeURIComponent(token)}`);
    },
    acceptProposal(token) {
      return post<AcceptProposalResponse>(`/api/proposals/${encodeURIComponent(token)}/accept`);
    },
    createEngagement(draft) {
      return post<CreateEngagementResponse>("/api/engagements", draft);
    },
    submitMilestone(id, index, evidenceHash?) {
      return post<SubmitMilestoneResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/submit`,
        evidenceHash === undefined ? undefined : { evidenceHash },
      );
    },
    releaseMilestone(id, index, viaExecute?) {
      return post<ReleaseMilestoneResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/release`,
        viaExecute === undefined ? undefined : { viaExecute },
      );
    },
    worldCheck(id, index, proof) {
      return post<WorldCheckResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/world-check`,
        { proof },
      );
    },
    raiseDispute(id, index) {
      return post<RaiseDisputeResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/dispute`,
      );
    },
    resolveDispute(id, index, providerAmount, clientRefund) {
      return post<ResolveDisputeResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/resolve`,
        { providerAmount, clientRefund },
      );
    },
    proposeResolution(id, index, providerAmount, clientRefund) {
      return post<ProposeResolutionResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/resolve-propose`,
        { providerAmount, clientRefund },
      );
    },
    challengeResolution(id, index) {
      return post<ChallengeResolutionResponse>(
        `/api/engagements/${encodeURIComponent(id)}/milestones/${index}/resolve-challenge`,
      );
    },
    verifyWorld(proof) {
      return post<VerifyWorldResponse>("/api/world/verify", { proof });
    },
    getReputation(subname) {
      return request<ReputationResponse>(
        `/api/businesses/${encodeURIComponent(subname)}/reputation`,
      );
    },
    schedulerSweep() {
      return post<SweepResponse>("/api/scheduler/sweep");
    },
    schedulerArchive() {
      return request<ArchiveResponse>("/api/scheduler/archive");
    },
  };
}
