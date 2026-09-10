import { normalize } from 'viem/ens'
import { publicClient } from '../config/viem'

export async function getEnsText(
  name: string,
  key: string,
) {
  return publicClient.getEnsText({
    name: normalize(name),
    key,
  })
}
export async function getEnsAvatar(name: string) {
  return publicClient.getEnsAvatar({
    name: normalize(name),
  })
}
