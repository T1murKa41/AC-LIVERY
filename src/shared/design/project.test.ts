import { strToU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  ProjectFormatError,
  bytesToDataUrl,
  dataUrlToBytes,
  packProject,
  peekTemplate,
  projectFileName,
  unpackProject,
} from './project'
import { DEFAULT_PLACEMENT, newImageLayer, type Design } from './types'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 251, 252])

function design(): Design {
  const image = newImageLayer('a1', 'logo', DEFAULT_PLACEMENT, 2)
  return {
    layers: [image],
    assets: { a1: { name: 'logo.png', mime: 'image/png', data: bytesToDataUrl(png, 'image/png') } },
  }
}

describe('project files', () => {
  it('round-trips a draft with its assets', () => {
    const draft = { baseColor: '#123456', design: design() }
    const bytes = packProject({ carId: 'ks_porsche_919', draft })
    const back = unpackProject(bytes)
    expect(back.carId).toBe('ks_porsche_919')
    expect(back.draft.baseColor).toBe('#123456')
    expect(back.draft.design.layers).toEqual(draft.design.layers)
    expect(dataUrlToBytes(back.draft.design.assets.a1!.data)).toEqual(png)
  })

  it('stores assets as files, not data URLs', () => {
    const files = unzipSync(packProject({ carId: null, draft: { design: design() } }))
    expect(Object.keys(files).sort()).toEqual(['assets/a1.png', 'project.json'])
    expect(files['assets/a1.png']).toEqual(png)
    expect(new TextDecoder().decode(files['project.json'])).not.toContain('base64')
  })

  it('keeps groups, template details and the thumbnail', () => {
    const d: Design = { ...design(), groups: { g1: { name: 'logo' } } }
    const preview = new Uint8Array([0xff, 0xd8, 1, 2])
    const bytes = packProject({
      carId: null,
      draft: { design: d },
      template: { name: 'Stripes', description: 'two of them' },
      preview,
    })
    const back = unpackProject(bytes)
    expect(back.draft.design.groups).toEqual({ g1: { name: 'logo' } })
    expect(back.template).toEqual({ name: 'Stripes', description: 'two of them' })
    expect(back.preview).toEqual(preview)
    expect(peekTemplate(bytes)).toEqual({ name: 'Stripes', preview })
    expect(peekTemplate(packProject({ carId: null, draft: { design: d } }))?.name).toBeNull()
    expect(peekTemplate(strToU8('junk'))).toBeNull()
  })

  it('rejects other files and newer versions', () => {
    expect(() => unpackProject(strToU8('hello'))).toThrow(ProjectFormatError)
    expect(() => unpackProject(zipSync({ 'a.txt': strToU8('x') }))).toThrow(ProjectFormatError)
    const newer = zipSync({
      'project.json': strToU8(JSON.stringify({ kind: 'project', version: 99, draft: {} })),
    })
    expect(() => unpackProject(newer)).toThrow(/newer version/)
  })

  it('makes file names from livery names', () => {
    expect(projectFileName('Gulf: #9 / 2024')).toBe('Gulf #9 2024.aclivery')
    expect(projectFileName('  ')).toBe('livery.aclivery')
  })
})
