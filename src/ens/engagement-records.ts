import { normalize } from 'viem/ens'
import { publicClient } from '../config/viem.js'
import { hashEngagementTerms, type EngagementTermsInput } from './pact-terms.js'

export const ENGAGEMENT_RECORD_KEYS = [
  'pact:type',
  'pact:scope',
  'pact:deadline',
  'pact:acceptance',
  'pact:amount',
  'pact:milestone-count',
  'pact:milestone-1',
  'pact:milestone-2',
  'pact:milestone-3',
  'pact:milestone-4',
  'pact:milestone-5',
  'pact:monthly',
  'pact:capacity',
  'pact:rollover',
  'pact:duration',
  'pact:rate',
  'pact:ceiling',
  'pact:cadence',
  'pact:deliverable',
  'pact:period',
  'pact:per-period',
  'pact:periods',
  'pact:joint-scope',
  'pact:party-a',
  'pact:party-b',
  'pact:total',
  'pact:terms-hash',
  'pact:status',
] as const

export type EngagementRecordKey = typeof ENGAGEMENT_RECORD_KEYS[number]

export interface EngagementRecords {
  name: string
  resolver: `0x${string}` | null
  records: Partial<Record<EngagementRecordKey, string | null>>
}

export async function getEngagementRecords(
  name: string,
  keys: readonly EngagementRecordKey[] = ENGAGEMENT_RECORD_KEYS,
): Promise<EngagementRecords> {
  const normalized = normalize(name)
  const resolver = await publicClient.getEnsResolver({ name: normalized })

  const records: Partial<Record<EngagementRecordKey, string | null>> = {}

  await Promise.all(
    keys.map(async (key) => {
      records[key] = await publicClient.getEnsText({
        name: normalized,
        key,
      })
    }),
  )

  return {
    name: normalized,
    resolver,
    records,
  }
}


export async function verifyEngagementTermsHash(
  name: string,
  terms: EngagementTermsInput,
): Promise<{ expected: `0x${string}`; actual: string | null; matches: boolean }> {
  const normalized = normalize(name)
  const expected = hashEngagementTerms(terms)
  const actual = await publicClient.getEnsText({
    name: normalized,
    key: 'pact:terms-hash',
  })
  return {
    expected,
    actual,
    matches: actual?.toLowerCase() === expected.toLowerCase(),
  }
}
