import { normalize } from 'viem/ens'
import { publicClient } from '../config/viem'

export async function resolveEnsName(name: string) {
  return publicClient.getEnsAddress({
    name: normalize(name),
  })
}
