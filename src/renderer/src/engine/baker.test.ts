import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { uvTiles } from './baker'

function geometry(uvs: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return g
}

describe('uvTiles', () => {
  it('keeps 0..1 meshes in place', () => {
    expect(uvTiles(geometry([0, 0, 1, 1, 0.5, 0.2]))).toEqual([[0, 0]])
  })

  it('moves a mesh stored one tile away back into 0..1', () => {
    expect(uvTiles(geometry([0.1, -1, 0.9, 0, 0.5, -0.4]))).toEqual([[0, 1]])
  })

  it('draws every tile a mesh spans', () => {
    expect(uvTiles(geometry([-0.5, 0.2, 0.5, 0.8]))).toEqual([
      [1, 0],
      [0, 0],
    ])
  })

  it('ignores rounding noise at tile borders', () => {
    expect(uvTiles(geometry([-0.00001, 0, 1.00001, 1]))).toEqual([[0, 0]])
  })
})
