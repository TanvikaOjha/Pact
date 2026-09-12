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

function normalizeCounter(value: string | null): string {
  if (value === null || value.trim() === '') return '0'
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid numeric ENS counter value: "${value}"`)
  }
  return String(n)
}

function addDecimalStrings(a: string, b: string): string {
  const [aInt, aFrac = ''] = a.split('.')
  const [bInt, bFrac = ''] = b.split('.')
  const scale = Math.max(aFrac.length, bFrac.length)
  const ai = BigInt(`${aInt || '0'}${aFrac.padEnd(scale, '0') || ''}`)
  const bi = BigInt(`${bInt || '0'}${bFrac.padEnd(scale, '0') || ''}`)
  const sum = (ai + bi).toString().padStart(scale + 1, '0')
  if (scale === 0) return sum
  const point = sum.length - scale
  return `${sum.slice(0, point)}.${sum.slice(point)}`.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
}

export interface CounterDelta {
  totalValue: string
  disputed: boolean
}

export async function incrementBusinessCounters(
  names: string[],
  delta: CounterDelta,
) {
  const uniqueNames = [...new Set(names.map((n) => normalize(n)))]
  const results = []

  for (const name of uniqueNames) {
    const resolver = await publicClient.getEnsResolver({ name })
    if (!resolver) throw new Error(`No resolver found for ${name}`)

    const completed = normalizeCounter(
      await publicClient.getEnsText({ name, key: 'pact:completed-count' }),
    )
    const disputes = normalizeCounter(
      await publicClient.getEnsText({ name, key: 'pact:dispute-count' }),
    )
    const totalValue = await publicClient.getEnsText({
      name,
      key: 'pact:total-value',
    }) ?? '0'

    const nextCompleted = String(Number(completed) + 1)
    const nextDisputes = String(
      Number(disputes) + (delta.disputed ? 1 : 0),
    )
    const nextTotalValue = addDecimalStrings(totalValue || '0', delta.totalValue)

    const node = namehash(name)
    const records: Array<[string, string]> = [
      ['pact:completed-count', nextCompleted],
      ['pact:dispute-count', nextDisputes],
      ['pact:total-value', nextTotalValue],
    ]

    const calls = records.map(([key, value]) =>
      encodeFunctionData({
        abi: resolverAbi,
        functionName: 'setText',
        args: [node, key, value],
      }),
    )

    await publicClient.simulateContract({
      address: resolver,
      abi: resolverAbi,
      functionName: 'multicall',
      args: [calls],
      account,
    })

    const txHash = await walletClient.writeContract({
      address: resolver,
      abi: resolverAbi,
      functionName: 'multicall',
      args: [calls],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    for (const [key, expected] of records) {
      const actual = await publicClient.getEnsText({ name, key })
      if (actual !== expected) {
        throw new Error(
          `Counter verification failed for ${name}/${key}: expected ${expected}, got ${actual}`,
        )
      }
    }

    console.log(
      `✅ ${name}: completed=${nextCompleted}, disputed=${nextDisputes}, total=${nextTotalValue}`,
    )
    console.log(`Transaction: ${txHash}`)
    console.log(`Block: ${receipt.blockNumber.toString()}`)

    results.push({
      name,
      txHash,
      blockNumber: receipt.blockNumber,
      completedCount: nextCompleted,
      disputeCount: nextDisputes,
      totalValue: nextTotalValue,
    })
  }

  return results
}

async function main() {
  const namesArg = process.argv[2]
  const totalValue = process.argv[3]
  const disputedArg = process.argv[4]

  if (!namesArg || totalValue === undefined) {
    console.error(
      'Usage: npx tsx src/ens/increment-counters.ts <name1,name2,...> <value> [disputed=true|false]',
    )
    process.exit(1)
  }

  await incrementBusinessCounters(
    namesArg.split(',').map((x) => x.trim()).filter(Boolean),
    {
      totalValue,
      disputed: disputedArg === 'true',
    },
  )
}

main().catch((error) => {
  console.error('\nCounter update failed:\n')
  console.error(error)
  process.exit(1)
})
