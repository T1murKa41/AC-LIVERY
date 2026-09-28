import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Resolves a forward-slash path below `root`; returns null if it escapes the root. */
export function resolveInside(root: string, relPath: string): string | null {
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (cleaned.split('/').some((part) => part === '..')) return null
  const abs = resolve(root, ...cleaned.split('/').filter(Boolean))
  const rel = relative(resolve(root), abs)
  if (rel === '') return abs
  if (rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null
  return abs
}

/** A single path segment that is safe to use as a file or folder name. */
export function isSafeSegment(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/:*?"<>|]/.test(name) &&
    ![...name].some((ch) => ch.charCodeAt(0) < 0x20)
  )
}
