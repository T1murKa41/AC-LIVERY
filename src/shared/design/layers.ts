// Stack operations on a design: groups, moving blocks of layers, copies and
// removal. Members of a group always sit next to each other in the stack, so
// a group behaves like one layer when it is moved.

import { duplicateLayer, newId, pruneAssets, type Design, type Layer } from './types'

/** Members of a group, bottom first. */
export function groupMembers(design: Design, groupId: string): Layer[] {
  return design.layers.filter((l) => l.group === groupId)
}

/** Gathers every group into one run, drops empty groups and dangling references. */
export function normalizeGroups(design: Design): Design {
  const groups = design.groups ?? {}
  const layers = design.layers.map((l) =>
    l.group && !groups[l.group] ? { ...l, group: undefined } : l,
  )
  const byGroup = new Map<string, Layer[]>()
  for (const l of layers) {
    if (!l.group) continue
    const list = byGroup.get(l.group) ?? []
    list.push(l)
    byGroup.set(l.group, list)
  }
  const out: Layer[] = []
  const placed = new Set<string>()
  for (const l of layers) {
    if (!l.group) out.push(l)
    else if (!placed.has(l.group)) {
      placed.add(l.group)
      out.push(...byGroup.get(l.group)!)
    }
  }
  const used = Object.fromEntries(Object.entries(groups).filter(([id]) => byGroup.has(id)))
  const next: Design = { ...design, layers: out, groups: used }
  if (!Object.keys(used).length) delete next.groups
  return next
}

/** Puts the layers into a new group placed where the topmost of them was. */
export function groupLayers(
  design: Design,
  ids: readonly string[],
  name: string,
): { design: Design; groupId: string | null } {
  const chosen = new Set(ids)
  const members = design.layers.filter((l) => chosen.has(l.id))
  if (members.length < 2) return { design, groupId: null }
  const groupId = newId('g')
  const top = members.at(-1)!.id
  const layers: Layer[] = []
  for (const l of design.layers) {
    if (!chosen.has(l.id)) layers.push(l)
    if (l.id === top) layers.push(...members.map((m) => ({ ...m, group: groupId })))
  }
  return {
    design: normalizeGroups({
      ...design,
      layers,
      groups: { ...design.groups, [groupId]: { name } },
    }),
    groupId,
  }
}

export function ungroup(design: Design, groupId: string): Design {
  const groups = { ...design.groups }
  delete groups[groupId]
  return normalizeGroups({
    ...design,
    layers: design.layers.map((l) => (l.group === groupId ? { ...l, group: undefined } : l)),
    groups,
  })
}

/**
 * Moves the layers one step up (+1, towards the top) or down (-1). A whole
 * group next to them is jumped over as one step; layers inside a group stay
 * inside it.
 */
export function moveLayers(design: Design, ids: readonly string[], delta: 1 | -1): Design {
  const chosen = new Set(ids)
  const layers = design.layers
  const idx = layers.flatMap((l, i) => (chosen.has(l.id) ? [i] : []))
  if (!idx.length) return design
  const lo = idx[0]!
  const hi = idx.at(-1)!
  if (hi - lo + 1 !== idx.length) return design // not one block
  const block = layers.slice(lo, hi + 1)
  const g = block[0]!.group
  const sameGroup = !!g && block.every((l) => l.group === g)
  const wholeGroup = sameGroup && groupMembers(design, g).length === block.length
  const inside = sameGroup && !wholeGroup

  let n = delta > 0 ? hi + 1 : lo - 1
  if (n < 0 || n >= layers.length) return design
  const neighbour = layers[n]!
  if (inside && neighbour.group !== g) return design
  // jump over a whole neighbouring group
  if (!inside && neighbour.group) {
    while (layers[n + delta]?.group === neighbour.group) n += delta
  }
  const rest = layers.filter((l) => !chosen.has(l.id))
  const anchor = rest.indexOf(layers[n]!)
  const at = delta > 0 ? anchor + 1 : anchor
  return { ...design, layers: [...rest.slice(0, at), ...block, ...rest.slice(at)] }
}

/**
 * Copies layers above the topmost of them. Copying all members of a group
 * makes a new group; single members are copied into their own group.
 */
export function duplicateLayers(
  design: Design,
  ids: readonly string[],
): { design: Design; ids: string[] } {
  const chosen = new Set(ids)
  const originals = design.layers.filter((l) => chosen.has(l.id))
  if (!originals.length) return { design, ids: [] }
  const groups = { ...design.groups }
  const regroup = new Map<string, string>()
  for (const l of originals) {
    if (!l.group || regroup.has(l.group)) continue
    if (groupMembers(design, l.group).every((m) => chosen.has(m.id))) {
      const id = newId('g')
      regroup.set(l.group, id)
      groups[id] = { name: `${groups[l.group]?.name ?? 'group'} copy` }
    }
  }
  const copies = originals.map((l) => {
    const copy = duplicateLayer(l)
    return l.group && regroup.has(l.group) ? { ...copy, group: regroup.get(l.group)! } : copy
  })
  const top = originals.at(-1)!.id
  const layers: Layer[] = []
  for (const l of design.layers) {
    layers.push(l)
    if (l.id === top) layers.push(...copies)
  }
  return {
    design: normalizeGroups({ ...design, layers, groups }),
    ids: copies.map((c) => c.id),
  }
}

export function removeLayers(
  design: Design,
  ids: readonly string[],
  keepAssets: Iterable<string> = [],
): Design {
  const chosen = new Set(ids)
  return normalizeGroups(
    pruneAssets({ ...design, layers: design.layers.filter((l) => !chosen.has(l.id)) }, keepAssets),
  )
}
