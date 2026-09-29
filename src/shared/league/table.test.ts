import { describe, expect, it } from 'vitest'
import { STANDARD_PARAMS } from '../design/params'
import { guessMapping, parseColour, parseCountry, rowsFromCells, skinFolders } from './table'

describe('league table', () => {
  it('matches columns to parameters by their headers', () => {
    expect(
      guessMapping(
        ['№', 'Пилот', 'Команда', 'Цвет 1', 'Цвет 2', 'Страна', 'Спонсор', 'Notes', 'accent'],
        STANDARD_PARAMS,
      ),
    ).toEqual([
      'number',
      'driver',
      'team',
      'primary',
      'secondary',
      'country',
      'sponsor1',
      null,
      'accent',
    ])
    // a parameter is used once
    expect(guessMapping(['Driver', 'Name'], STANDARD_PARAMS)).toEqual(['driver', null])
  })

  it('reads colours and countries in several spellings', () => {
    expect(parseColour('#FFF')).toBe('#ffffff')
    expect(parseColour('1c5fd4')).toBe('#1c5fd4')
    expect(parseColour('rgb(255, 0, 16)')).toBe('#ff0010')
    expect(parseColour('Красный')).toBe('#d7261e')
    expect(parseColour('teal-ish')).toBeNull()
    expect(parseCountry('DE')).toBe('flag:de')
    expect(parseCountry('Germany')).toBe('flag:de')
    expect(parseCountry('Германия')).toBe('flag:de')
    expect(parseCountry('GBR')).toBe('flag:gb')
    expect(parseCountry('Atlantis')).toBeNull()
  })

  it('builds rows and reports cells it cannot read', () => {
    const cells = [
      ['Number', 'Driver', 'Colour', 'Country', 'Sponsor'],
      ['7', 'Ann', 'blue', 'Finland', 'Apex Tyres'],
      ['', '', '', '', ''],
      ['12', 'Bo', 'mauve?', 'Atlantis', 'Unknown Co'],
    ]
    const mapping = guessMapping(cells[0]!, STANDARD_PARAMS)
    const { rows, problems } = rowsFromCells(cells, mapping, STANDARD_PARAMS, {
      header: true,
      resolveImage: (v) => (v === 'Apex Tyres' ? 'st_apex' : null),
    })
    expect(rows.map((r) => r.values)).toEqual([
      { number: '7', driver: 'Ann', primary: '#1c5fd4', country: 'flag:fi', sponsor1: 'st_apex' },
      { number: '12', driver: 'Bo' },
    ])
    expect(problems.map((p) => [p.row, p.column])).toEqual([
      [4, 'Colour'],
      [4, 'Country'],
      [4, 'Sponsor'],
    ])
  })

  it('names skin folders safely and uniquely', () => {
    const rows = [
      { id: 'a', values: { number: '7', driver: 'Иван Петров' } },
      { id: 'b', values: { number: '7', driver: 'Иван Петров' } },
      { id: 'c', values: { number: '12', driver: 'Ann' } },
    ]
    expect(skinFolders(rows, '{number}_{driver}', (r) => r.values)).toEqual([
      '7_ivan_petrov',
      '7_ivan_petrov_2',
      '12_ann',
    ])
  })
})
