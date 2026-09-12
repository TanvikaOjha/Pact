import {
  encodeFunctionData,
  parseAbi,
} from 'viem'
import { namehash, normalize } from 'viem/ens'
import { publicClient, walletClient, account } from '../config/viem.js'

const resolverAbi = parseAbi([
  'function setText(bytes32 node, string key, string value)',
  'function multicall(bytes[] data) returns (bytes[] results)',
])

const ALLOWED = [
  'proposed',
  'active',
  'completed',
  'disputed',
  'cancelled',
] as const

type Status = typeof ALLOWED[number]

const TERMINAL = new Set<Status>(['completed', 'cancelled'])

function isStatus(value: string): value is Status {
  return (ALLOWED as readonly string[]).includes(value)
}

function canTransition(from: Status | null, to: Status): boolean {
  if (from === null || from === to) return true
  if (from === 'proposed') return ['active', 'disputed', 'cancelled'].includes(to)
  if (from === 'active') return ['completed', 'disputed', 'cancelled'].includes(to)
  if (from === 'disputed') return ['active', 'completed'].includes(to)
  if (TERMINAL.has(from)) return false
  return false
}

export async function updateEngagementStatus(
  name: string,
  status: Status,
) {
  const normalized = normalize(name)
  const current = await publicClient.getEnsText({
    name: normalized,
    key: 'pact:status',
  })

  const currentStatus =
    current && isStatus(current) ? current : null

  if (!canTransition(currentStatus, status)) {
    throw new Error(
      `Invalid Pact status transition: ${currentStatus ?? '(unset)'} -> ${status}`,
    )
  }

  const resolver = await publicClient.getEnsResolver({ name: normalized })
  if (!resolver) throw new Error(`No resolver found for ${normalized}`)

  const node = namehash(normalized)
  const call = encodeFunctionData({
    abi: resolverAbi,
    functionName: 'setText',
    args: [node, 'pact:status', status],
  })

  await publicClient.simulateContract({
    address: resolver,
    abi: resolverAbi,
    functionName: 'multicall',
    args: [[call]],
    account,
  })

  const txHash = await walletClient.writeContract({
    address: resolver,
    abi: resolverAbi,
    functionName: 'multicall',
    args: [[call]],
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  const verified = await publicClient.getEnsText({
    name: normalized,
    key: 'pact:status',
  })

  if (verified !== status) {
    throw new Error(
      `Status verification failed for ${normalized}: expected ${status}, got ${verified ?? '(null)'}`,
    )
  }

  console.log(`✅ ${normalized}: ${currentStatus ?? '(unset)'} -> ${status}`)
  console.log(`Transaction: ${txHash}`)
  console.log(`Block: ${receipt.blockNumber.toString()}`)

  return { txHash, blockNumber: receipt.blockNumber, previous: currentStatus, status }
}

async function main() {
  const name = process.argv[2]
  const statusArg = process.argv[3]

  if (!name || !statusArg || !isStatus(statusArg)) {
    console.error(
      `Usage: npx tsx src/ens/update-status.ts <ensName> <status>\nAllowed: ${ALLOWED.join(', ')}`,
    )
    process.exit(1)
  }

  await updateEngagementStatus(name, statusArg)
}

main().catch((error) => {
  console.error('\nStatus update failed:\n')
  console.error(error)
  process.exit(1)
})
