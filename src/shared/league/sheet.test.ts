import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { parseCsv, readTable, readXlsx, SheetFormatError } from './sheet'

describe('parseCsv', () => {
  it('detects the delimiter and handles quotes and a BOM', () => {
    expect(parseCsv('\uFEFFНомер;Пилот\r\n7;"Иванов; Иван"\r\n12;"He said ""go"""\r\n')).toEqual([
      ['Номер', 'Пилот'],
      ['7', 'Иванов; Иван'],
      ['12', 'He said "go"'],
    ])
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(parseCsv('a\tb\n"multi\nline"\t2\n\n')).toEqual([
      ['a', 'b'],
      ['multi\nline', '2'],
    ])
  })
})

function xlsx(sheet: string, shared = ''): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'xl/workbook.xml': strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Drivers" sheetId="1" r:id="rId3"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<Relationships><Relationship Id="rId3" Type="ws" Target="worksheets/drivers.xml"/></Relationships>',
    ),
    'xl/sharedStrings.xml': strToU8(`<sst>${shared}</sst>`),
    'xl/worksheets/drivers.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  })
}

describe('readXlsx', () => {
  it('reads shared, inline, rich and numeric cells of the first sheet', () => {
    const bytes = xlsx(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2"><v>7</v></c><c r="B2" t="inlineStr"><is><t>skipped B</t></is></c><c r="C2" t="s"><v>2</v></c></row>' +
        '<row r="4"><c r="A4"><v>12.5</v></c><c r="C4" t="b"><v>1</v></c></row>',
      '<si><t>Number</t></si><si><t>Driver</t></si><si><r><t>Ann</t></r><r><t xml:space="preserve"> &amp; Bo</t></r></si>',
    )
    expect(readXlsx(bytes)).toEqual([
      ['Number', '', 'Driver'],
      ['7', 'skipped B', 'Ann & Bo'],
      ['', '', ''],
      ['12.5', '', 'TRUE'],
    ])
    expect(readTable(bytes, 'drivers.xlsx')[1]![2]).toBe('Ann & Bo')
  })

  it('rejects other files', () => {
    expect(() => readXlsx(strToU8('nope'))).toThrow(SheetFormatError)
    expect(() => readXlsx(zipSync({ 'a.txt': strToU8('x') }))).toThrow(SheetFormatError)
  })
})
