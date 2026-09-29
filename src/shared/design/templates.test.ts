import { describe, expect, it } from 'vitest'
import { normalizeGroups } from './layers'
import { placeholders, resolveDraft } from './params'
import { BUILTIN_TEMPLATES } from './templates'

describe('built-in templates', () => {
  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t] as const))('%s is consistent', (_, t) => {
    const c = t.build()
    const ids = new Set(c.params.map((p) => p.id))
    expect(c.design.layers.length).toBeGreaterThan(0)
    for (const l of c.design.layers) {
      for (const p of Object.values(l.bindings ?? {})) expect(ids).toContain(p)
      if (l.kind === 'text') for (const p of placeholders(l.text)) expect(ids).toContain(p)
    }
    for (const p of Object.values(c.bindings ?? {})) expect(ids).toContain(p)
    // groups are already in one run each
    expect(normalizeGroups(c.design).layers.map((l) => l.id)).toEqual(
      c.design.layers.map((l) => l.id),
    )
    // every build gets fresh layer ids
    expect(t.build().design.layers[0]!.id).not.toBe(c.design.layers[0]!.id)
    const r = resolveDraft({
      ...c,
      parts: c.parts!,
      csp: c.csp!,
      meta: c.meta ?? {},
      values: { ...c.values, number: '7', driver: 'Ann', team: 'Blue' },
    })
    expect(r.baseColor).toBe(c.values!.primary)
    for (const l of r.design.layers) {
      if (l.kind === 'text') expect(l.text).not.toMatch(/\{/)
    }
    expect(r.meta.number).toBe('7')
  })
})
