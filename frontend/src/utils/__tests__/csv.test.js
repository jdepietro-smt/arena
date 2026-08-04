import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toCsv, downloadCsv } from '../csv'

describe('toCsv', () => {
  it('joins headers and rows with CRLF line endings', () => {
    expect(toCsv(['a', 'b'], [['1', '2'], ['3', '4']])).toBe('a,b\r\n1,2\r\n3,4')
  })

  it('quotes a field containing a comma', () => {
    expect(toCsv(['name'], [['Studio A, CDN']])).toBe('name\r\n"Studio A, CDN"')
  })

  it('quotes and escapes a field containing double quotes', () => {
    expect(toCsv(['note'], [['say "hi"']])).toBe('note\r\n"say ""hi"""')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsv(['note'], [['line1\nline2']])).toBe('note\r\n"line1\nline2"')
  })

  it('renders null/undefined fields as empty, not the string "null"', () => {
    expect(toCsv(['a'], [[null], [undefined]])).toBe('a\r\n\r\n')
  })
})

describe('downloadCsv', () => {
  let clickSpy

  beforeEach(() => {
    clickSpy = vi.fn()
    const realCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      if (tag !== 'a') return realCreateElement(tag)
      return { click: clickSpy, remove: vi.fn(), href: '', download: '' }
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el)
    global.URL.createObjectURL = vi.fn(() => 'blob:fake-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  it('creates a blob download link, clicks it, and revokes the URL', () => {
    downloadCsv('audit-log.csv', ['a'], [['1']])

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })
})
