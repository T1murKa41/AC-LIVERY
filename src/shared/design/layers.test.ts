import { describe, expect, it } from 'vitest'
import {
  duplicateLayers,
  groupLayers,
  groupMembers,
  moveLayers,
  normalizeGroups,
  removeLayers,
  ungroup,
} from './layers'
import { DEFAULT_PLACEMENT, newShapeLayer, type Design, type Layer } from './types'

function design(...names: string[]): Design {
  return {
    layers: names.map((name) => ({ ...newShapeLayer('rect', DEFAULT_PLACEMENT), id: name, name })),
    assets: {},
  }
}

const order = (d: Design) => d.layers.map((l) => l.id).join(' ')
const ids = (d: Design, ...names: string[]) =>
  names.map((n) => d.layers.find((l) => l.name === n)!.id)

describe('layer groups', () => {
  it('groups layers at the position of the topmost one', () => {
    const { design: d, groupId } = groupLayers(design('a', 'b', 'c', 'd'), ['a', 'c'], 'logo')
    expect(order(d)).toBe('b a c d')
    expect(groupMembers(d, groupId!).map((l) => l.id)).toEqual(['a', 'c'])
    expect(d.groups?.[groupId!]?.name).toBe('logo')
  })

  it('needs two layers to make a group', () => {
    expect(groupLayers(design('a', 'b'), ['a'], 'x').groupId).toBeNull()
  })

  it('ungroups and forgets empty groups', () => {
    const { design: d, groupId } = groupLayers(design('a', 'b'), ['a', 'b'], 'g')
    const u = ungroup(d, groupId!)
    expect(u.groups).toBeUndefined()
    expect(u.layers.every((l: Layer) => !l.group)).toBe(true)
    const r = removeLayers(d, ['a', 'b'])
    expect(r.groups).toBeUndefined()
  })

  it('keeps members together', () => {
    const d = design('a', 'b', 'c')
    const mixed = normalizeGroups({
      ...d,
      layers: [{ ...d.layers[0]!, group: 'g' }, d.layers[1]!, { ...d.layers[2]!, group: 'g' }],
      groups: { g: { name: 'g' } },
    })
    expect(order(mixed)).toBe('a c b')
  })

  it('moves a layer over a whole group in one step', () => {
    const { design: d } = groupLayers(design('a', 'b', 'c', 'd'), ['b', 'c'], 'g')
    expect(order(moveLayers(d, ['a'], 1))).toBe('b c a d')
    expect(order(moveLayers(d, ['d'], -1))).toBe('a d b c')
    // the group moves as a block
    expect(order(moveLayers(d, ['b', 'c'], 1))).toBe('a d b c')
    // a member stays inside its group
    expect(order(moveLayers(d, ['c'], 1))).toBe('a b c d')
    expect(order(moveLayers(d, ['c'], -1))).toBe('a c b d')
    // nothing above the top
    expect(order(moveLayers(d, ['d'], 1))).toBe('a b c d')
  })

  it('copies a whole group into a new group above it', () => {
    const { design: d, groupId } = groupLayers(design('a', 'b', 'c'), ['a', 'b'], 'g')
    const { design: copy, ids: added } = duplicateLayers(d, ['a', 'b'])
    expect(added).toHaveLength(2)
    expect(copy.layers).toHaveLength(5)
    const newGroup = copy.layers.find((l) => l.id === added[0])!.group
    expect(newGroup).toBeDefined()
    expect(newGroup).not.toBe(groupId)
    expect(order(copy).startsWith('a b')).toBe(true)
    expect(copy.layers.at(-1)!.id).toBe('c')
    // a single member is copied into the same group
    const {
      design: one,
      ids: [single],
    } = duplicateLayers(d, ['a'])
    expect(one.layers.find((l) => l.id === single)!.group).toBe(groupId)
    expect(groupMembers(one, groupId!)).toHaveLength(3)
    expect(ids(one, 'a')).toHaveLength(1)
  })
})
