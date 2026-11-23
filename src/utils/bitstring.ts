import { gunzipSync, gzipSync } from 'node:zlib'

export const MIN_BITSTRING_LENGTH = 131072

export function decodeBitstring(encodedList: string): Uint8Array {
  if (!encodedList.startsWith('u')) {
    throw new Error("Bitstring status list must start with the 'u' multibase prefix")
  }

  let raw: Buffer
  try {
    const compressed = Buffer.from(encodedList.slice(1), 'base64url')
    raw = gunzipSync(compressed)
  } catch (error) {
    throw new Error(
      `Invalid bitstring encodedList: not valid gzip data (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (raw.length * 8 < MIN_BITSTRING_LENGTH) {
    throw new Error(`Bitstring status list is too short: ${raw.length * 8} bits (minimum ${MIN_BITSTRING_LENGTH} bits)`)
  }

  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

export function encodeBitstring(bits: Uint8Array): string {
  if (bits.length * 8 < MIN_BITSTRING_LENGTH) {
    throw new Error(
      `Bitstring status list is too short: ${bits.length * 8} bits (minimum ${MIN_BITSTRING_LENGTH} bits)`,
    )
  }

  return `u${gzipSync(bits).toString('base64url')}`
}

export function createEmptyBitstring(length = MIN_BITSTRING_LENGTH): Uint8Array {
  if (length <= 0 || length % 8 !== 0) {
    throw new Error(`Bitstring length must be a positive multiple of 8, received ${length}`)
  }

  return new Uint8Array(length / 8)
}

export function getBit(bits: Uint8Array, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= bits.length * 8) {
    throw new RangeError(`Bit index ${index} is out of range for a ${bits.length * 8}-bit list`)
  }

  const byte = bits[index >> 3]
  return (byte & (0x80 >> (index & 7))) !== 0
}

export function setBit(bits: Uint8Array, index: number, value: boolean): void {
  if (!Number.isInteger(index) || index < 0 || index >= bits.length * 8) {
    throw new RangeError(`Bit index ${index} is out of range for a ${bits.length * 8}-bit list`)
  }

  const byteIndex = index >> 3
  const mask = 0x80 >> (index & 7)
  bits[byteIndex] = value ? bits[byteIndex] | mask : bits[byteIndex] & ~mask
}
