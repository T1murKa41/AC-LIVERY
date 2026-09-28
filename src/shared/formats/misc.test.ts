import { describe, expect, it } from 'vitest'
import { parseLenientJson } from './json'
import { parseUiSkin, serializeUiSkin } from './uiSkin'
import { parseVdf, steamLibraryPaths } from './vdf'

describe('parseLenientJson', () => {
  it('accepts BOM, comments, trailing commas and raw control characters', () => {
    const text = '\ufeff{\n // comment\n "name": "Line1\nLine2\tTab", /* block */ "list": [1, 2,],\n}'
    expect(parseLenientJson(text)).toEqual({ name: 'Line1\nLine2\tTab', list: [1, 2] })
  })

  it('keeps commas and slashes inside strings', () => {
    expect(parseLenientJson('{"a": "x,}", "b": "http://y"}')).toEqual({ a: 'x,}', b: 'http://y' })
  })
})

describe('ui_skin.json', () => {
  it('normalizes numbers to strings and preserves unknown keys', () => {
    const skin = parseUiSkin('{"skinname":"A","number":7,"priority":"2","custom":true}')
    expect(skin).toEqual({ skinname: 'A', number: '7', priority: 2, custom: true })
  })

  it('serializes known keys first', () => {
    const text = serializeUiSkin({ custom: 1, number: '3', skinname: 'S' })
    expect(Object.keys(JSON.parse(text))).toEqual(['skinname', 'number', 'custom'])
  })
})

describe('vdf', () => {
  it('reads library folders in the new layout', () => {
    const vdf = parseVdf(`"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "apps" { "244210" "123" }
  }
  "1" { "path" "D:\\\\SteamLibrary" }
}`)
    expect(steamLibraryPaths(vdf)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary'])
  })

  it('reads library folders in the old layout', () => {
    const vdf = parseVdf('"LibraryFolders" { "TimeNextStatsReport" "1" "1" "E:\\\\Games" }')
    expect(steamLibraryPaths(vdf)).toEqual(['E:\\Games'])
  })
})
