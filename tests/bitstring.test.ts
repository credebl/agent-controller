import { gzipSync } from 'node:zlib'

import {
  MIN_BITSTRING_LENGTH,
  createEmptyBitstring,
  decodeBitstring,
  encodeBitstring,
  getBit,
  setBit,
} from '../src/utils/bitstring'

describe('bitstring', () => {
  it('creates an empty bitstring of the minimum length', () => {
    const bits = createEmptyBitstring()
    expect(bits.length).toBe(MIN_BITSTRING_LENGTH / 8)
    expect(bits.every((byte) => byte === 0)).toBe(true)
  })

  it('round-trips through encode/decode', () => {
    const bits = createEmptyBitstring()
    setBit(bits, 0, true)
    setBit(bits, 7, true)
    setBit(bits, 8, true)
    setBit(bits, MIN_BITSTRING_LENGTH - 1, true)

    const decoded = decodeBitstring(encodeBitstring(bits))

    expect(decoded.length).toBe(bits.length)
    expect(Array.from(decoded)).toEqual(Array.from(bits))
  })

  it('uses most-significant-bit-first ordering', () => {
    const bits = createEmptyBitstring()

    setBit(bits, 0, true)
    expect(bits[0]).toBe(0x80)

    bits[0] = 0
    setBit(bits, 7, true)
    expect(bits[0]).toBe(0x01)

    bits[0] = 0
    setBit(bits, 8, true)
    expect(bits[0]).toBe(0x00)
    expect(bits[1]).toBe(0x80)
  })

  it('clears a previously set bit', () => {
    const bits = createEmptyBitstring()
    setBit(bits, 42, true)
    expect(getBit(bits, 42)).toBe(true)

    setBit(bits, 42, false)
    expect(getBit(bits, 42)).toBe(false)
  })

  it('rejects lists shorter than the minimum', () => {
    expect(() => encodeBitstring(new Uint8Array(8))).toThrow(/too short/)
  })

  it('rejects an encoded list without the u prefix', () => {
    const encoded = encodeBitstring(createEmptyBitstring())
    expect(() => decodeBitstring(encoded.slice(1))).toThrow(/multibase prefix/)
  })

  it('rejects malformed gzip data with a clear error', () => {
    expect(() => decodeBitstring('uH4sIA')).toThrow(/Invalid bitstring encodedList/)
  })

  it('rejects a valid gzip list shorter than the minimum', () => {
    const shortList = `u${gzipSync(Buffer.alloc(8)).toString('base64url')}`
    expect(() => decodeBitstring(shortList)).toThrow(/too short/)
  })

  it('rejects out-of-range and non-integer indices', () => {
    const bits = createEmptyBitstring()
    expect(() => getBit(bits, -1)).toThrow(RangeError)
    expect(() => getBit(bits, bits.length * 8)).toThrow(RangeError)
    expect(() => setBit(bits, 1.5, true)).toThrow(RangeError)
  })
})
