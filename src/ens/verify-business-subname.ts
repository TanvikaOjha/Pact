import { normalize } from 'viem/ens'
import { publicClient } from '../config/viem'

const NAME = 'studio.pact-hack.eth'

async function main() {
  console.log(`Checking ${NAME}...\n`)

  const resolver = await publicClient.getEnsResolver({
    name: normalize(NAME),
  })

  console.log('Resolver:', resolver ?? '(none)')

  const address = await publicClient.getEnsAddress({
    name: normalize(NAME),
  })

  console.log(
    'Address:',
    address ?? '(no address record — this is okay for now)',
  )

  if (!resolver) {
    throw new Error(
      'Universal Resolver could not find a resolver for the business name.',
    )
  }

  console.log('\n✅ Universal Resolver can find the business resolver.')
}

main().catch((error) => {
  console.error('\nVerification failed:\n')
  console.error(error)
  process.exit(1)
})