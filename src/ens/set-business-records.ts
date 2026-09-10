// src/ens/set-business-records.ts
//
// Writes the initial business-level Pact records to:
//   <business>.pact-hack.eth
//
// ENSv2 flow:
//   1. Resolve the name's CURRENT resolver
//   2. Compute the full namehash
//   3. Batch setText calls through resolver.multicall()
//   4. Verify the records by resolving them again through ENS
//
// Example:
//   npx tsx src/ens/set-business-records.ts studio
//
// Optional World session ID:
//   npx tsx src/ens/set-business-records.ts studio WORLD_SESSION_ID
//
// NOTE:
// The Pact spec requires pact:world-verified to eventually contain
// the World Selfie Check session ID. Until Person C's real World flow
// is available, this script uses "pending" as a temporary development
// value. Replace it with the real World session ID later.

import {
  encodeFunctionData,
  parseAbi,
} from 'viem'

import {
  namehash,
  normalize,
} from 'viem/ens'

import {
  publicClient,
  walletClient,
  account,
} from '../config/viem'

const resolverAbi = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[] results)',
])

const ROOT_NAME = 'pact-hack.eth'

async function main() {
  // --------------------------------------------------
  // 1. Read business slug
  // --------------------------------------------------

  const slug = process.argv[2]
  const worldSessionArg = process.argv[3]

  if (!slug) {
    console.error(
      'Usage: npx tsx src/ens/set-business-records.ts <slug> [worldSessionId]',
    )

    console.error(
      'Example: npx tsx src/ens/set-business-records.ts studio',
    )

    process.exit(1)
  }

  const businessName = normalize(
    `${slug}.${ROOT_NAME}`,
  )

  console.log('Account:', account.address)
  console.log('Business name:', businessName)

  // --------------------------------------------------
  // 2. Resolve the CURRENT resolver
  // --------------------------------------------------

  const resolverAddress =
    await publicClient.getEnsResolver({
      name: businessName,
    })

  if (!resolverAddress) {
    throw new Error(
      `No resolver found for ${businessName}`,
    )
  }

  console.log(
    'Current resolver:',
    resolverAddress,
  )

  // --------------------------------------------------
  // 3. Compute full ENS namehash
  // --------------------------------------------------

  const node = namehash(businessName)

  console.log(
    'Namehash:',
    node,
  )

  // --------------------------------------------------
  // 4. Prepare records
  // --------------------------------------------------

  const worldSessionId =
    worldSessionArg || 'pending'

  const joined =
    new Date().toISOString()

  const records = [
    {
      key: 'pact:world-verified',
      value: worldSessionId,
    },
    {
      key: 'pact:joined',
      value: joined,
    },
    {
      key: 'pact:completed-count',
      value: '0',
    },
    {
      key: 'pact:dispute-count',
      value: '0',
    },
    {
      key: 'pact:total-value',
      value: '0',
    },
  ]

  console.log('\nRecords to write:')

  for (const record of records) {
    console.log(
      `  ${record.key} = ${record.value}`,
    )
  }

  // --------------------------------------------------
  // 5. Encode all setText calls
  // --------------------------------------------------

  const calls = records.map(
    ({ key, value }) =>
      encodeFunctionData({
        abi: resolverAbi,
        functionName: 'setText',
        args: [
          node,
          key,
          value,
        ],
      }),
  )

  // --------------------------------------------------
  // 6. Simulate first
  // --------------------------------------------------

  console.log(
    '\nSimulating resolver multicall...',
  )

  await publicClient.simulateContract({
    address:
      resolverAddress as `0x${string}`,
    abi: resolverAbi,
    functionName: 'multicall',
    args: [calls],
    account: account.address,
  })

  console.log(
    '✅ Simulation succeeded.',
  )

  // --------------------------------------------------
  // 7. Send the transaction
  // --------------------------------------------------

  console.log(
    '\nWriting business records...',
  )

  const tx =
    await walletClient.writeContract({
      address:
        resolverAddress as `0x${string}`,
      abi: resolverAbi,
      functionName: 'multicall',
      args: [calls],
    })

  console.log(
    'Transaction:',
    tx,
  )

  // --------------------------------------------------
  // 8. Wait for confirmation
  // --------------------------------------------------

  const receipt =
    await publicClient.waitForTransactionReceipt({
      hash: tx,
    })

  console.log(
    'Confirmed in block:',
    receipt.blockNumber.toString(),
  )

  // --------------------------------------------------
  // 9. Verify each record through ENS resolution
  // --------------------------------------------------

  console.log(
    '\n--- Verification ---',
  )

  // Resolve resolver again rather than assuming it
  // remained unchanged.
  const verifiedResolver =
    await publicClient.getEnsResolver({
      name: businessName,
    })

  console.log(
    'Resolver after write:',
    verifiedResolver,
  )

  for (const record of records) {
    const value =
      await publicClient.getEnsText({
        name: businessName,
        key: record.key,
      })

    console.log(
      `${record.key}:`,
      value,
    )

    if (value !== record.value) {
      throw new Error(
        `Verification failed for ${record.key}. Expected "${record.value}", got "${value}".`,
      )
    }
  }

  console.log(
    `\n✅ All business records verified for ${businessName}`,
  )
}

main().catch((error) => {
  console.error(
    '\nBusiness record update failed:\n',
  )

  console.error(error)

  process.exit(1)
})