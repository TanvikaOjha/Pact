// src/ens/mint-business-subname.ts
//
// Mints <slug>.pact-hack.eth for a business, e.g. studio.pact-hack.eth.
//
// IMPORTANT:
// pact-hack.eth is already registered on the CURRENT ENSv2 Sepolia
// deployment. A UserRegistry proxy was also already deployed successfully,
// so this script REUSES that existing proxy instead of deploying another one.
//
// --------------------------------------------------------------------------
// MECHANISM (ENSv2):
// --------------------------------------------------------------------------
// pact-hack.eth is a name in the current ENSv2 ETHRegistry.
// Its subregistry must point to a UserRegistry that manages:
//
//   studio.pact-hack.eth
//   agency.pact-hack.eth
//   ...
//
// The UserRegistry proxy below was already deployed at:
//
//   0x49f0907840Cf172987dD32A77586420d470A1F77
//
// This script therefore does NOT call VerifiableFactory.deployProxy()
// for the UserRegistry again.
//
// One-time setup:
//
//   1. Reuse the existing UserRegistry proxy.
//   2. Point pact-hack.eth's subregistry at it.
//   3. Set the UserRegistry's canonical parent pointer.
//   4. Revoke dangerous ROOT_RESOURCE roles from Pact's account,
//      leaving the registry able to register/renew names.
//
// Per-business minting:
//
//   5. Deploy a PermissionedResolver proxy for the business.
//   6. Register <slug>.pact-hack.eth in the UserRegistry.
//
// --------------------------------------------------------------------------

import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
  toHex,
  zeroAddress,
} from 'viem'

import {
  publicClient,
  walletClient,
  account,
} from '../config/viem'

import {
  ENSV2_SEPOLIA,
  ALL_ROLES,
  BUSINESS_REGISTRATION_ROLE_BITMAP,
  DANGEROUS_ROOT_ROLES_TO_REVOKE,
} from '../config/ensv2.js'

const PARENT_LABEL = 'pact-hack'
const PARENT_NAME = 'pact-hack.eth'

// --------------------------------------------------------------------------
// IMPORTANT:
// This UserRegistry was ALREADY deployed successfully.
// Do NOT deploy another one with the same salt.
// --------------------------------------------------------------------------

const EXISTING_USER_REGISTRY =
  '0x49f0907840Cf172987dD32A77586420d470A1F77' as `0x${string}`

// --------------------------------------------------------------------------
// Minimal ABIs
// --------------------------------------------------------------------------

const verifiableFactoryAbi = parseAbi([
  'function deployProxy(address implementation, uint256 salt, bytes data) returns (address proxy)',
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
])

const resolverInitAbi = parseAbi([
  'function initialize(address admin, uint256 roleBitmap, bytes[] setters)',
])

const permissionedRegistryAbi = [
  {
    name: 'getState',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'anyId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'status', type: 'uint8' },
          { name: 'expiry', type: 'uint64' },
          { name: 'latestOwner', type: 'address' },
          { name: 'tokenId', type: 'uint256' },
          { name: 'resource', type: 'uint256' },
        ],
      },
    ],
  },

  {
    name: 'getSubregistry',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },

  {
    name: 'setSubregistry',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'anyId', type: 'uint256' },
      { name: 'registry', type: 'address' },
    ],
    outputs: [],
  },

  {
    name: 'getParent',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'parent', type: 'address' },
      { name: 'label', type: 'string' },
    ],
  },

  {
    name: 'setParent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'parent', type: 'address' },
      { name: 'label', type: 'string' },
    ],
    outputs: [],
  },

  {
    name: 'roles',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'resource', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },

  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },

  {
    name: 'revokeRootRoles',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const STATUS = [
  'AVAILABLE',
  'RESERVED',
  'REGISTERED',
] as const

// --------------------------------------------------------------------------
// Label → ENSv2 registry ID
// --------------------------------------------------------------------------

function labelId(label: string): bigint {
  return BigInt(keccak256(toHex(label)))
}

// --------------------------------------------------------------------------
// Step 1-4:
// Configure the EXISTING UserRegistry for pact-hack.eth
// --------------------------------------------------------------------------

async function ensureBusinessRegistry(): Promise<`0x${string}`> {
  console.log('\n--- Business UserRegistry setup ---')

  // ------------------------------------------------------------------------
  // 1. Confirm the existing UserRegistry actually has bytecode.
  // ------------------------------------------------------------------------

  const code = await publicClient.getCode({
    address: EXISTING_USER_REGISTRY,
  })

  if (!code || code === '0x') {
    throw new Error(
      `Expected UserRegistry at ${EXISTING_USER_REGISTRY}, but no contract code was found.`,
    )
  }

  console.log(
    '✅ Existing UserRegistry contract found:',
    EXISTING_USER_REGISTRY,
  )

  // ------------------------------------------------------------------------
  // 2. Check whether pact-hack.eth already points to a subregistry.
  // ------------------------------------------------------------------------

  const existing = await publicClient.readContract({
    address: ENSV2_SEPOLIA.ethRegistry as `0x${string}`,
    abi: permissionedRegistryAbi,
    functionName: 'getSubregistry',
    args: [PARENT_LABEL],
  })

  if (existing !== zeroAddress) {
    console.log(
      'Existing subregistry for pact-hack.eth:',
      existing,
    )

    // Make absolutely sure it is the proxy we expect.
    if (
      existing.toLowerCase() !==
      EXISTING_USER_REGISTRY.toLowerCase()
    ) {
      throw new Error(
        `pact-hack.eth already points to a different subregistry: ${existing}. ` +
        `Expected: ${EXISTING_USER_REGISTRY}. ` +
        `Do NOT continue until this is investigated.`,
      )
    }

    console.log(
      '✅ pact-hack.eth already points to our expected UserRegistry.',
    )
  } else {
    // ----------------------------------------------------------------------
    // 3. Wire pact-hack.eth → existing UserRegistry.
    // ----------------------------------------------------------------------

    console.log(
      'No subregistry found for pact-hack.eth.',
    )

    console.log(
      'Setting pact-hack.eth subregistry to:',
      EXISTING_USER_REGISTRY,
    )

    const setSubregistryTx =
      await walletClient.writeContract({
        address: ENSV2_SEPOLIA.ethRegistry as `0x${string}`,
        abi: permissionedRegistryAbi,
        functionName: 'setSubregistry',
        args: [
          labelId(PARENT_LABEL),
          EXISTING_USER_REGISTRY,
        ],
      })

    console.log(
      'setSubregistry tx:',
      setSubregistryTx,
    )

    await publicClient.waitForTransactionReceipt({
      hash: setSubregistryTx,
    })

    console.log(
      '✅ pact-hack.eth subregistry set.',
    )
  }

  // ------------------------------------------------------------------------
  // 4. Make sure the UserRegistry has the canonical parent pointer.
  // ------------------------------------------------------------------------

  const [currentParent, currentLabel] =
    await publicClient.readContract({
      address: EXISTING_USER_REGISTRY,
      abi: permissionedRegistryAbi,
      functionName: 'getParent',
    })

  console.log(
    '\nCurrent UserRegistry parent:',
    currentParent,
  )

  console.log(
    'Current UserRegistry parent label:',
    currentLabel,
  )

  const parentNeedsSetup =
    currentParent.toLowerCase() !==
      ENSV2_SEPOLIA.ethRegistry.toLowerCase() ||
    currentLabel !== PARENT_LABEL

  if (parentNeedsSetup) {
    console.log(
      'Setting canonical parent pointer...',
    )

    const setParentTx =
      await walletClient.writeContract({
        address: EXISTING_USER_REGISTRY,
        abi: permissionedRegistryAbi,
        functionName: 'setParent',
        args: [
          ENSV2_SEPOLIA.ethRegistry as `0x${string}`,
          PARENT_LABEL,
        ],
      })

    console.log(
      'setParent tx:',
      setParentTx,
    )

    await publicClient.waitForTransactionReceipt({
      hash: setParentTx,
    })

    console.log(
      '✅ Canonical parent pointer set.',
    )
  } else {
    console.log(
      '✅ Canonical parent pointer already correct.',
    )
  }

  // ------------------------------------------------------------------------
  // 5. Emancipate the registry:
  //    remove dangerous ROOT_RESOURCE roles from our account.
  // ------------------------------------------------------------------------

  const ROOT_RESOURCE = 0n

  const currentRootRoles =
    await publicClient.readContract({
      address: EXISTING_USER_REGISTRY,
      abi: permissionedRegistryAbi,
      functionName: 'roles',
      args: [
        ROOT_RESOURCE,
        account.address,
      ],
    })

  console.log(
    '\nCurrent ROOT_RESOURCE roles:',
    currentRootRoles.toString(),
  )

  const dangerousRolesStillHeld =
    currentRootRoles &
    DANGEROUS_ROOT_ROLES_TO_REVOKE

  if (dangerousRolesStillHeld !== 0n) {
    console.log(
      'Dangerous root roles still present:',
      dangerousRolesStillHeld.toString(),
    )

    console.log(
      'Revoking dangerous root roles (emancipating registry)...',
    )

    const revokeTx =
      await walletClient.writeContract({
        address: EXISTING_USER_REGISTRY,
        abi: permissionedRegistryAbi,
        functionName: 'revokeRootRoles',
        args: [
          dangerousRolesStillHeld,
          account.address,
        ],
      })

    console.log(
      'revokeRootRoles tx:',
      revokeTx,
    )

    await publicClient.waitForTransactionReceipt({
      hash: revokeTx,
    })

    console.log(
      '✅ Dangerous root roles revoked.',
    )
  } else {
    console.log(
      '✅ No dangerous ROOT_RESOURCE roles remain on Pact account.',
    )
  }

  // ------------------------------------------------------------------------
  // Final root-role verification.
  // ------------------------------------------------------------------------

  const finalRootRoles =
    await publicClient.readContract({
      address: EXISTING_USER_REGISTRY,
      abi: permissionedRegistryAbi,
      functionName: 'roles',
      args: [
        ROOT_RESOURCE,
        account.address,
      ],
    })

  const dangerousRolesAfter =
    finalRootRoles &
    DANGEROUS_ROOT_ROLES_TO_REVOKE

  console.log(
    'Final ROOT_RESOURCE roles:',
    finalRootRoles.toString(),
  )

  if (dangerousRolesAfter !== 0n) {
    throw new Error(
      `Emancipation verification failed. Dangerous roles still remain: ${dangerousRolesAfter.toString()}`,
    )
  }

  console.log(
    '✅ UserRegistry setup/emancipation verified.',
  )

  return EXISTING_USER_REGISTRY
}

// --------------------------------------------------------------------------
// Step 5-6:
// Mint one business subname
// --------------------------------------------------------------------------

async function mintBusinessSubname(
  userRegistry: `0x${string}`,
  slug: string,
  ownerAddress: `0x${string}`,
) {
  console.log(
    `\n--- Minting ${slug}.pact-hack.eth ---`,
  )

  // ------------------------------------------------------------------------
  // 1. Check availability.
  // ------------------------------------------------------------------------

  const state = await publicClient.readContract({
    address: userRegistry,
    abi: permissionedRegistryAbi,
    functionName: 'getState',
    args: [labelId(slug)],
  })

  const status = STATUS[state.status]

  console.log(
    'Current status:',
    status,
  )

  console.log(
    'Current owner:',
    state.latestOwner,
  )

  if (status !== 'AVAILABLE') {
    throw new Error(
      `"${slug}" is not available under pact-hack.eth ` +
      `(status: ${status}, owner: ${state.latestOwner}). ` +
      `Pick a different slug.`,
    )
  }

  // ------------------------------------------------------------------------
  // 2. Deploy a resolver controlled by the business owner.
  // ------------------------------------------------------------------------

  const version = 0n

  // The resolver is Pact-managed because Pact writes the business
  // reputation records during the application lifecycle.
  // Include the normalized slug in the salt so every business gets a
  // deterministic but distinct resolver proxy, even when multiple
  // businesses share the same owner address.
  const resolverSalt = BigInt(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'string' },
          { type: 'address' },
          { type: 'uint256' },
        ],
        [
          keccak256(
            stringToHex('OwnedResolver'),
          ),
          slug.toLowerCase(),
          ownerAddress,
          version,
        ],
      ),
    ),
  )

  const resolverInitData = encodeFunctionData({
    abi: resolverInitAbi,
    functionName: 'initialize',
    args: [
      account.address,
      ALL_ROLES,
      [],
    ],
  })

  console.log(
    `Deploying resolver for ${slug}.pact-hack.eth...`,
  )

  console.log(
    'Resolver admin:',
    account.address,
  )

  console.log(
    'Business owner:',
    ownerAddress,
  )

  const resolverTx =
    await walletClient.writeContract({
      address:
        ENSV2_SEPOLIA.verifiableFactory as `0x${string}`,
      abi: verifiableFactoryAbi,
      functionName: 'deployProxy',
      args: [
        ENSV2_SEPOLIA.permissionedResolverImpl as `0x${string}`,
        resolverSalt,
        resolverInitData,
      ],
    })

  console.log(
    'Resolver deploy tx:',
    resolverTx,
  )

  const resolverReceipt =
    await publicClient.waitForTransactionReceipt({
      hash: resolverTx,
    })

  const [resolverLog] =
    parseEventLogs({
      abi: verifiableFactoryAbi,
      eventName: 'ProxyDeployed',
      logs: resolverReceipt.logs,
    })

  const resolverAddress =
    resolverLog.args.proxyAddress

  console.log(
    '✅ Resolver deployed at:',
    resolverAddress,
  )

  // ------------------------------------------------------------------------
  // 3. Register the business subname.
  // ------------------------------------------------------------------------

  const expiry = BigInt(
    Math.floor(Date.now() / 1000) +
      5 * 365 * 24 * 60 * 60,
  )

  console.log(
    `Registering ${slug}.pact-hack.eth...`,
  )

  const registerTx =
    await walletClient.writeContract({
      address: userRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'register',
      args: [
        slug,
        ownerAddress,
        zeroAddress,
        resolverAddress,
        BUSINESS_REGISTRATION_ROLE_BITMAP,
        expiry,
      ],
    })

  console.log(
    'Register tx:',
    registerTx,
  )

  const registerReceipt =
    await publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

  console.log(
    '✅ Registered!',
  )

  console.log(
    'Block:',
    registerReceipt.blockNumber.toString(),
  )

  return {
    resolverAddress,
    expiry,
    registerTx,
  }
}

// --------------------------------------------------------------------------
// Verification:
// Read registry state back independently.
// --------------------------------------------------------------------------

async function verify(
  userRegistry: `0x${string}`,
  slug: string,
  expectedOwner: `0x${string}`,
) {
  const state =
    await publicClient.readContract({
      address: userRegistry,
      abi: permissionedRegistryAbi,
      functionName: 'getState',
      args: [labelId(slug)],
    })

  console.log('\n--- Verification ---')

  console.log(
    'Status:',
    STATUS[state.status],
  )

  console.log(
    'Owner:',
    state.latestOwner,
  )

  console.log(
    'Expiry:',
    new Date(
      Number(state.expiry) * 1000,
    ).toISOString(),
  )

  if (
    STATUS[state.status] !==
    'REGISTERED'
  ) {
    throw new Error(
      'Verification failed: name is not REGISTERED.',
    )
  }

  if (
    state.latestOwner.toLowerCase() !==
    expectedOwner.toLowerCase()
  ) {
    throw new Error(
      'Verification failed: registered owner does not match expected owner.',
    )
  }

  console.log(
    `✅ ${slug}.pact-hack.eth is registered to ${expectedOwner}`,
  )

  console.log(
    `   UserRegistry: ${userRegistry}`,
  )

  console.log(
    `   Etherscan: https://sepolia.etherscan.io/address/${userRegistry}`,
  )
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

async function main() {
  const slug = process.argv[2]
  const ownerArg = process.argv[3]

  if (!slug || !ownerArg) {
    console.error(
      'Usage: npx tsx src/ens/mint-business-subname.ts <slug> <ownerAddress>',
    )

    console.error(
      'Example: npx tsx src/ens/mint-business-subname.ts studio 0xYourBusinessWallet',
    )

    process.exit(1)
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(ownerArg)) {
    throw new Error(
      'Invalid owner address.',
    )
  }

  const ownerAddress =
    ownerArg as `0x${string}`

  console.log(
    'Using account:',
    account.address,
  )

  console.log(
    `Target: ${slug}.pact-hack.eth -> ${ownerAddress}`,
  )

  // Configure/reuse existing UserRegistry.
  const userRegistry =
    await ensureBusinessRegistry()

  console.log(
    '\nUserRegistry:',
    userRegistry,
  )

  // Mint the requested business name.
  await mintBusinessSubname(
    userRegistry,
    slug,
    ownerAddress,
  )

  // Verify everything.
  await verify(
    userRegistry,
    slug,
    ownerAddress,
  )

  console.log(
    '\n🎉 Business subname setup complete.',
  )
}

main().catch((error) => {
  console.error(
    '\nBusiness subname minting failed:\n',
  )

  console.error(error)

  process.exit(1)
})