import { describe, it, expect } from 'vitest'
import { getErrorMessage } from '../errors'

describe('getErrorMessage', () => {
  it('returns a string detail as-is', () => {
    const err = { response: { data: { detail: 'Username already taken' } } }
    expect(getErrorMessage(err, 'fallback')).toBe('Username already taken')
  })

  it('joins a FastAPI 422 validation-error array into a readable string', () => {
    const err = {
      response: {
        data: {
          detail: [
            { type: 'missing', loc: ['body', 'email'], msg: 'Field required', input: {} },
            { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 8 characters', input: 'x' },
          ],
        },
      },
    }
    expect(getErrorMessage(err, 'fallback')).toBe(
      'Field required; String should have at least 8 characters'
    )
  })

  it('falls back to err.message when there is no detail', () => {
    const err = { message: 'Network Error' }
    expect(getErrorMessage(err, 'fallback')).toBe('Network Error')
  })

  it('falls back to the provided fallback when nothing else is available', () => {
    expect(getErrorMessage({}, 'fallback')).toBe('fallback')
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback')
  })

  it('never returns the raw detail array or object (would crash React as a child)', () => {
    const err = { response: { data: { detail: [{ msg: undefined }] } } }
    expect(typeof getErrorMessage(err, 'fallback')).toBe('string')
  })
})
