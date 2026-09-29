// Turning texture files (DDS / PNG / JPG) into three.js textures.
//
// Block-compressed DDS data is uploaded as-is when the GPU supports it, which
// keeps memory low for cars with dozens of 4K textures. Everything else is
// decoded on the CPU. Textures are treated as raw values without colour-space
// conversion, the same way Assetto Corsa samples them.

import * as THREE from 'three'
import {
  canDecodeOnCpu,
  decodeDdsMip,
  isDds,
  parseDds,
  type DdsFormat,
  type DdsImage,
} from '@shared/formats/dds'

export interface TextureInfo {
  texture: THREE.Texture
  width: number
  height: number
  format: DdsFormat | 'image'
  hasAlpha: boolean
}

const COMPRESSED: Partial<Record<DdsFormat, { format: THREE.CompressedPixelFormat; ext: string }>> =
  {
    BC1: { format: THREE.RGBA_S3TC_DXT1_Format, ext: 'WEBGL_compressed_texture_s3tc' },
    BC2: { format: THREE.RGBA_S3TC_DXT3_Format, ext: 'WEBGL_compressed_texture_s3tc' },
    BC3: { format: THREE.RGBA_S3TC_DXT5_Format, ext: 'WEBGL_compressed_texture_s3tc' },
    BC4: { format: THREE.RED_RGTC1_Format, ext: 'EXT_texture_compression_rgtc' },
    BC5: { format: THREE.RED_GREEN_RGTC2_Format, ext: 'EXT_texture_compression_rgtc' },
    BC7: { format: THREE.RGBA_BPTC_Format, ext: 'EXT_texture_compression_bptc' },
  }

function configure(t: THREE.Texture, mipmapped: boolean): THREE.Texture {
  t.flipY = false
  t.colorSpace = THREE.NoColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = mipmapped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

function completeChain(dds: DdsImage): boolean {
  const last = dds.mips.at(-1)!
  return last.width === 1 && last.height === 1
}

function fromDds(dds: DdsImage, renderer: THREE.WebGLRenderer): TextureInfo {
  const hasAlpha =
    dds.format === 'BC2' ||
    dds.format === 'BC3' ||
    dds.format === 'BGRA8' ||
    dds.format === 'RGBA8' ||
    dds.format === 'BC7' ||
    dds.format === 'A8' ||
    dds.format === 'L8A8'
  const gpu = COMPRESSED[dds.format]
  const blockAligned = dds.width % 4 === 0 && dds.height % 4 === 0
  if (gpu && blockAligned && renderer.extensions.has(gpu.ext)) {
    const mipmapped = completeChain(dds)
    const mips = (mipmapped ? dds.mips : dds.mips.slice(0, 1)).map((m) => ({
      data: m.data,
      width: m.width,
      height: m.height,
    }))
    const t = new THREE.CompressedTexture(mips, dds.width, dds.height, gpu.format)
    configure(t, mipmapped)
    t.generateMipmaps = false
    return { texture: t, width: dds.width, height: dds.height, format: dds.format, hasAlpha }
  }
  if (!canDecodeOnCpu(dds.format)) {
    throw new Error(`${dds.format} textures are not supported by this GPU`)
  }
  const rgba = decodeDdsMip(dds.format, dds.mips[0]!)
  return {
    texture: rgbaTexture(rgba, dds.width, dds.height),
    width: dds.width,
    height: dds.height,
    format: dds.format,
    hasAlpha,
  }
}

export function rgbaTexture(rgba: Uint8Array, width: number, height: number): THREE.DataTexture {
  const t = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.UnsignedByteType)
  configure(t, true)
  t.generateMipmaps = true
  return t
}

export async function loadTextureFromBytes(
  bytes: Uint8Array,
  renderer: THREE.WebGLRenderer,
): Promise<TextureInfo> {
  if (isDds(bytes)) return fromDds(parseDds(bytes), renderer)
  const blob = new Blob([bytes as BlobPart])
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  const t = new THREE.Texture(bitmap)
  configure(t, true)
  t.generateMipmaps = true
  return { texture: t, width: bitmap.width, height: bitmap.height, format: 'image', hasAlpha: true }
}

/** Size of a texture file without decoding it (DDS header or image). */
export async function textureSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  if (isDds(bytes)) {
    const { width, height } = parseDds(bytes)
    return { width, height }
  }
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/** 1x1 magenta placeholder for textures that could not be loaded. */
export function missingTexture(): THREE.DataTexture {
  return rgbaTexture(new Uint8Array([255, 0, 255, 255]), 1, 1)
}
