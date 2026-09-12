import { keccak256, stringToHex } from 'viem'

export const PACT_TERMS_VERSION = 1 as const

export type CanonicalMilestone = {
  index: number
  name: string
  deliverable: string
  due: string
  amount: number
  worldRequired: boolean
}

export type EngagementTermsInput = {
  templateType: string
  title: string
  scope: string
  acceptanceCriteria: string
  totalAmount: number
  acceptanceWindowHours: number
  milestones: CanonicalMilestone[]
  splitShareA?: number
  splitShareB?: number
  fields: Record<string, string>
}

/**
 * Contract terms exclude lifecycle/application metadata:
 * id, ENS name, status, timestamps and local DB identifiers are not part
 * of the terms a counterparty signs.
 *
 * Canonicalization rule:
 * - fixed top-level key order
 * - fixed milestone key order
 * - template-specific `fields` keys sorted lexicographically
 * - JSON.stringify with no whitespace
 * - UTF-8 bytes
 * - keccak256(bytes)
 *
 * This is the provisional Pact Terms V1 format. Person D should confirm
 * the exact schema before a production deployment that relies on the hash
 * as a cross-implementation commitment.
 */
export function canonicalizeEngagementTerms(
  input: EngagementTermsInput,
): string {
  const fields = Object.fromEntries(
    Object.entries(input.fields)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)]),
  )

  const milestones = [...input.milestones]
    .sort((a, b) => a.index - b.index)
    .map((m) => ({
      index: m.index,
      name: String(m.name),
      deliverable: String(m.deliverable),
      due: new Date(m.due).toISOString(),
      amount: Number(m.amount),
      worldRequired: Boolean(m.worldRequired),
    }))

  const payload: Record<string, unknown> = {
    version: PACT_TERMS_VERSION,
    templateType: String(input.templateType),
    title: String(input.title),
    scope: String(input.scope),
    acceptanceCriteria: String(input.acceptanceCriteria),
    totalAmount: Number(input.totalAmount),
    acceptanceWindowHours: Number(input.acceptanceWindowHours),
    milestones,
    fields,
  }

  if (input.splitShareA !== undefined) {
    payload.splitShareA = Number(input.splitShareA)
  }
  if (input.splitShareB !== undefined) {
    payload.splitShareB = Number(input.splitShareB)
  }

  return JSON.stringify(payload)
}

export function hashEngagementTerms(
  input: EngagementTermsInput,
): `0x${string}` {
  return keccak256(stringToHex(canonicalizeEngagementTerms(input)))
}
