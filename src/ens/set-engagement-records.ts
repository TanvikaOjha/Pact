// Writes the canonical engagement records to a Pact-owned ENSv2 name.
//
// Usage:
//   npx tsx src/ens/set-engagement-records.ts \
//     eng-6cf50f.pact-hack.eth proposed ./terms.json
//
// The JSON file must contain the EngagementTermsInput shape used by
// src/ens/pact-terms.ts. `fields` contains the template-specific pact:*
// records; `pact:terms-hash` is calculated here, never trusted from input.

import {
  encodeFunctionData,
  parseAbi,
} from 'viem'
import {
  namehash,
  normalize,
} from 'viem/ens'
import {
  readFile,
} from 'node:fs/promises'

import {
  publicClient,
  walletClient,
  account,
} from '../config/viem'
import {
  canonicalizeEngagementTerms,
  hashEngagementTerms,
  type EngagementTermsInput,
} from './pact-terms.js'

const resolverAbi = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[] results)',
])

const ALLOWED_STATUS = [
  'proposed',
  'active',
  'completed',
  'disputed',
  'cancelled',
] as const

type EngagementStatus = typeof ALLOWED_STATUS[number]

export interface SetEngagementRecordsOptions {
  name: string
  status: EngagementStatus
  terms: EngagementTermsInput
}

export async function setEngagementRecords(
  options: SetEngagementRecordsOptions,
) {
  const name = normalize(options.name)
  const resolverAddress = await publicClient.getEnsResolver({ name })

  if (!resolverAddress) {
    throw new Error(`No resolver found for ${name}`)
  }

  const node = namehash(name)
  const termsHash = hashEngagementTerms(options.terms)
  const canonicalJson = canonicalizeEngagementTerms(options.terms)

  // The template-specific fields are the exact Pact keys represented by the
  // canonical terms input. They are written in deterministic key order.
  const templateRecords = Object.entries(options.terms.fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([key]) => key.startsWith('pact:'))

  const records = [
    ...templateRecords,
    ['pact:terms-hash', termsHash],
    ['pact:status', options.status],
  ] as Array<[string, string]>

  const calls = records.map(([key, value]) =>
    encodeFunctionData({
      abi: resolverAbi,
      functionName: 'setText',
      args: [node, key, value],
    }),
  )

  console.log(`Account: ${account.address}`)
  console.log(`Engagement: ${name}`)
  console.log(`Resolver: ${resolverAddress}`)
  console.log(`Terms hash: ${termsHash}`)
  console.log(`Canonical JSON bytes: ${Buffer.byteLength(canonicalJson, 'utf8')}`)
  console.log('\nRecords:')
  for (const [key, value] of records) {
    console.log(`  ${key} = ${value}`)
  }

  console.log('\nSimulating resolver multicall...')
  await publicClient.simulateContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: 'multicall',
    args: [calls],
    account,
  })

  const txHash = await walletClient.writeContract({
    address: resolverAddress,
    abi: resolverAbi,
    functionName: 'multicall',
    args: [calls],
  })

  console.log('Transaction:', txHash)

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log('Confirmed in block:', receipt.blockNumber.toString())

  console.log('\nVerification:')
  for (const [key, expected] of records) {
    const actual = await publicClient.getEnsText({ name, key })
    console.log(`  ${key}: ${actual}`)
    if (actual !== expected) {
      throw new Error(
        `Verification failed for ${key}. Expected "${expected}", got "${actual}".`,
      )
    }
  }

  console.log(`\n✅ Engagement ENS records verified for ${name}`)

  return {
    txHash,
    name,
    resolverAddress,
    termsHash,
    records,
  }
}

function isStatus(value: string): value is EngagementStatus {
  return (ALLOWED_STATUS as readonly string[]).includes(value)
}

async function main() {
  const nameArg = process.argv[2]
  const statusArg = process.argv[3]
  const jsonPath = process.argv[4]

  if (!nameArg || !statusArg || !jsonPath) {
    console.error(
      'Usage: npx tsx src/ens/set-engagement-records.ts <ensName> <status> <terms.json>',
    )
    process.exit(1)
  }

  if (!isStatus(statusArg)) {
    throw new Error(
      `Invalid status "${statusArg}". Allowed: ${ALLOWED_STATUS.join(', ')}`,
    )
  }

  const json = await readFile(jsonPath, 'utf8')
  const terms = JSON.parse(json) as EngagementTermsInput

  await setEngagementRecords({
    name: nameArg,
    status: statusArg,
    terms,
  })
}

main().catch((error) => {
  console.error('\nEngagement record write failed:\n')
  console.error(error)
  process.exit(1)
})
