import { keccak256, stringToHex } from "viem";

export const PACT_TERMS_VERSION = 1 as const;

export interface CanonicalMilestoneInput {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
  worldRequired: boolean;
}

export interface CanonicalMilestone {
  index: number;
  name: string;
  deliverable: string;
  due: string;
  amount: number;
  worldRequired: boolean;
}

export interface EngagementTermsInput {
  templateType: string;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  acceptanceWindowHours: number;
  milestones: CanonicalMilestoneInput[];
  splitShareA?: number;
  splitShareB?: number;
  fields: Record<string, string>;
}

interface CanonicalTermsPayload {
  version: number;
  templateType: string;
  title: string;
  scope: string;
  acceptanceCriteria: string;
  totalAmount: number;
  acceptanceWindowHours: number;
  milestones: CanonicalMilestone[];
  fields: Record<string, string>;
  splitShareA?: number;
  splitShareB?: number;
}

/**
 * Pact Terms V1 canonicalizer. MUST stay byte-identical to
 * `src/ens/pact-terms.ts` (root CLI package) and `frontend/lib/pactTerms.ts`:
 * the hash is the cross-party commitment written to `pact:terms-hash`.
 *
 * Known fragility (do NOT "fix" unilaterally — any change alters every hash):
 * field sorting uses `localeCompare` with the runtime default locale, so a
 * backend on a different ICU version than the writer could order exotic keys
 * differently. Safe in practice while keys stay ASCII `pact:*`; Terms V2
 * should pin codepoint order everywhere.
 */
export function canonicalizeEngagementTerms(input: EngagementTermsInput): string {
  const fields: Record<string, string> = Object.fromEntries(
    Object.entries(input.fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  );

  const milestones: CanonicalMilestone[] = [...input.milestones]
    .sort((a, b) => a.index - b.index)
    .map((milestone) => ({
      index: milestone.index,
      name: String(milestone.name),
      deliverable: String(milestone.deliverable),
      due: new Date(milestone.due).toISOString(),
      amount: Number(milestone.amount),
      worldRequired: Boolean(milestone.worldRequired),
    }));

  const payload: CanonicalTermsPayload = {
    version: PACT_TERMS_VERSION,
    templateType: String(input.templateType),
    title: String(input.title),
    scope: String(input.scope),
    acceptanceCriteria: String(input.acceptanceCriteria),
    totalAmount: Number(input.totalAmount),
    acceptanceWindowHours: Number(input.acceptanceWindowHours),
    milestones,
    fields,
  };

  if (input.splitShareA !== undefined) {
    payload.splitShareA = Number(input.splitShareA);
  }
  if (input.splitShareB !== undefined) {
    payload.splitShareB = Number(input.splitShareB);
  }

  return JSON.stringify(payload);
}

export function hashEngagementTerms(input: EngagementTermsInput): `0x${string}` {
  return keccak256(stringToHex(canonicalizeEngagementTerms(input)));
}
