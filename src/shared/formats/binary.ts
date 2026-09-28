/** Error thrown when a binary file does not match the expected layout. */
export class FormatError extends Error {
  override name = 'FormatError'
}

const utf8 = new TextDecoder('utf-8')
const utf8Encoder = new TextEncoder()

/** Little-endian reader over a byte array. Returned sub-arrays are views, not copies. */
export class BinaryReader {
  pos = 0
  private readonly view: DataView

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get length(): number {
    return this.bytes.byteLength
  }

  get remaining(): number {
    return this.bytes.byteLength - this.pos
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.bytes.byteLength) {
      throw new FormatError(`Unexpected end of data at offset ${this.pos} (need ${n} bytes)`)
    }
  }

  u8(): number {
    this.need(1)
    return this.view.getUint8(this.pos++)
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  u16(): number {
    this.need(2)
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }

  i32(): number {
    this.need(4)
    const v = this.view.getInt32(this.pos, true)
    this.pos += 4
    return v
  }

  u32(): number {
    this.need(4)
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }

  f32(): number {
    this.need(4)
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }

  bytesView(n: number): Uint8Array {
    this.need(n)
    const v = this.bytes.subarray(this.pos, this.pos + n)
    this.pos += n
    return v
  }

  /** Length-prefixed (u32) string. */
  string(maxLength = 1 << 16): string {
    const len = this.u32()
    if (len > maxLength) throw new FormatError(`String too long (${len}) at offset ${this.pos - 4}`)
    return utf8.decode(this.bytesView(len))
  }

  ascii(n: number): string {
    return String.fromCharCode(...this.bytesView(n))
  }

  f32Array(count: number): Float32Array {
    const out = new Float32Array(count)
    this.need(count * 4)
    for (let i = 0; i < count; i++) out[i] = this.view.getFloat32(this.pos + i * 4, true)
    this.pos += count * 4
    return out
  }

  u16Array(count: number): Uint16Array {
    const out = new Uint16Array(count)
    this.need(count * 2)
    for (let i = 0; i < count; i++) out[i] = this.view.getUint16(this.pos + i * 2, true)
    this.pos += count * 2
    return out
  }
}

/** Growable little-endian writer. */
export class BinaryWriter {
  private buf: Uint8Array
  private view: DataView
  pos = 0

  constructor(initialCapacity = 1024) {
    this.buf = new Uint8Array(initialCapacity)
    this.view = new DataView(this.buf.buffer)
  }

  private grow(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return
    let cap = this.buf.byteLength * 2
    while (cap < this.pos + n) cap *= 2
    const next = new Uint8Array(cap)
    next.set(this.buf)
    this.buf = next
    this.view = new DataView(next.buffer)
  }

  u8(v: number): this {
    this.grow(1)
    this.view.setUint8(this.pos++, v)
    return this
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0)
  }

  u16(v: number): this {
    this.grow(2)
    this.view.setUint16(this.pos, v, true)
    this.pos += 2
    return this
  }

  i32(v: number): this {
    this.grow(4)
    this.view.setInt32(this.pos, v, true)
    this.pos += 4
    return this
  }

  u32(v: number): this {
    this.grow(4)
    this.view.setUint32(this.pos, v >>> 0, true)
    this.pos += 4
    return this
  }

  f32(v: number): this {
    this.grow(4)
    this.view.setFloat32(this.pos, v, true)
    this.pos += 4
    return this
  }

  bytes(data: ArrayLike<number>): this {
    this.grow(data.length)
    this.buf.set(data, this.pos)
    this.pos += data.length
    return this
  }

  ascii(s: string): this {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i) & 0xff)
    return this
  }

  string(s: string): this {
    const data = utf8Encoder.encode(s)
    this.u32(data.length)
    return this.bytes(data)
  }

  f32s(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.f32(values[i]!)
    return this
  }

  toBytes(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}
