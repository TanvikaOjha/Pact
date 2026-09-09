import {
  erc20Abi,
  parseAbi,
  parseUnits,
  zeroAddress,
} from 'viem'

import {
  publicClient,
  walletClient,
  account,
} from '../config/viem'

const ETH_REGISTRAR =
  '0xa4449a0dd2b83007553d9b1d28b583a46a805a30' as const

const MOCK_USDC =
  '0xd3322b29a7bdee707d1684676f149bf41aa3422f' as const

const label = 'pact-hack'

// 1 year
const duration = 365n * 24n * 60n * 60n

const registrarAbi = parseAbi([
  'function isAvailable(string label) view returns (bool)',

  'function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)',

  'function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)',

  'function commit(bytes32 commitment)',

  'function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256 tokenId)',

  'function MIN_COMMITMENT_AGE() view returns (uint256)',

  'function MIN_REGISTER_DURATION() view returns (uint64)',
])

async function main() {
  console.log('Using account:', account.address)
  console.log('Checking:', `${label}.eth`)

  // --------------------------------------------------
  // 1. Check availability
  // --------------------------------------------------

  const available = await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: 'isAvailable',
    args: [label],
  })

  console.log('Available:', available)

  if (!available) {
    throw new Error(`${label}.eth is not available`)
  }

  // --------------------------------------------------
  // 2. Check minimum duration
  // --------------------------------------------------

  const minDuration = await publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: 'MIN_REGISTER_DURATION',
  })

  console.log(
    'Minimum duration:',
    minDuration.toString(),
    'seconds',
  )

  if (duration < minDuration) {
    throw new Error('Registration duration is too short')
  }

  // --------------------------------------------------
  // 3. Generate random secret
  // --------------------------------------------------

  const secret = cryptoRandomBytes32()

  // No subregistry/resolver for the root registration.
  // We can configure these later.
  const subregistry = zeroAddress
  const resolver = zeroAddress
  const referrer = `0x${'00'.repeat(32)}` as `0x${string}`

  // --------------------------------------------------
  // 4. Get registration price
  // --------------------------------------------------

  const [base, premium] =
    await publicClient.readContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: 'getRegisterPrice',
      args: [
        label,
        duration,
        MOCK_USDC,
      ],
    })

  const totalCost = base + premium

  console.log(
    'Base price:',
    base.toString(),
    'MockUSDC',
  )

  console.log(
    'Premium:',
    premium.toString(),
    'MockUSDC',
  )

  console.log(
    'Total:',
    totalCost.toString(),
    'raw units',
  )

  // --------------------------------------------------
  // 5. Check MockUSDC balance
  // --------------------------------------------------

  const balance = await publicClient.readContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account.address],
  })

  console.log(
    'MockUSDC balance:',
    balance.toString(),
  )

  // --------------------------------------------------
  // 6. Mint MockUSDC if necessary
  // --------------------------------------------------

  if (balance < totalCost) {
    console.log('Not enough MockUSDC. Minting...')

    const mintHash = await walletClient.writeContract({
      address: MOCK_USDC,
      abi: parseAbi([
        'function mint(address to, uint256 amount)',
      ]),
      functionName: 'mint',
      args: [
        account.address,
        parseUnits('1000', 6),
      ],
    })

    console.log('Mint tx:', mintHash)

    await publicClient.waitForTransactionReceipt({
      hash: mintHash,
    })

    console.log('MockUSDC minted')
  }

  // --------------------------------------------------
  // 7. Approve ETH Registrar
  // --------------------------------------------------

  console.log('Approving registrar...')

  const approveHash = await walletClient.writeContract({
    address: MOCK_USDC,
    abi: erc20Abi,
    functionName: 'approve',
    args: [
      ETH_REGISTRAR,
      totalCost,
    ],
  })

  console.log('Approve tx:', approveHash)

  await publicClient.waitForTransactionReceipt({
    hash: approveHash,
  })

  console.log('Registrar approved')

  // --------------------------------------------------
  // 8. Create commitment
  // --------------------------------------------------

  const commitment =
    await publicClient.readContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: 'makeCommitment',
      args: [
        label,
        account.address,
        secret,
        subregistry,
        resolver,
        duration,
        referrer,
      ],
    })

  console.log('Commitment:', commitment)

  // --------------------------------------------------
  // 9. Submit commitment
  // --------------------------------------------------

  console.log('Submitting commitment...')

  const commitHash =
    await walletClient.writeContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: 'commit',
      args: [commitment],
    })

  console.log('Commit tx:', commitHash)

  await publicClient.waitForTransactionReceipt({
    hash: commitHash,
  })

  console.log('Commitment confirmed')

  // --------------------------------------------------
  // 10. Wait 60+ seconds
  // --------------------------------------------------

  const minAge =
    await publicClient.readContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: 'MIN_COMMITMENT_AGE',
    })

  const waitSeconds =
    Number(minAge) + 5

  console.log(
    `Waiting ${waitSeconds} seconds...`,
  )

  await sleep(waitSeconds * 1000)

  // --------------------------------------------------
  // 11. Register
  // --------------------------------------------------

  console.log('Registering pact-hack.eth...')

  const registerHash =
    await walletClient.writeContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: 'register',
      args: [
        label,
        account.address,
        secret,
        subregistry,
        resolver,
        duration,
        MOCK_USDC,
        referrer,
      ],
    })

  console.log(
    'Register tx:',
    registerHash,
  )

  const receipt =
    await publicClient.waitForTransactionReceipt({
      hash: registerHash,
    })

  console.log(
    'Registration confirmed!',
  )

  console.log(
    'Block:',
    receipt.blockNumber.toString(),
  )

  console.log(
    'Your ENS name:',
    `${label}.eth`,
  )
}

function cryptoRandomBytes32(): `0x${string}` {
  const bytes = new Uint8Array(32)

  globalThis.crypto.getRandomValues(bytes)

  return `0x${Array.from(bytes)
    .map((b) =>
      b.toString(16).padStart(2, '0'),
    )
    .join('')}` as `0x${string}`
}

function sleep(ms: number) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  )
}

main().catch((error) => {
  console.error('\nRegistration failed:\n')
  console.error(error)
  process.exit(1)
})