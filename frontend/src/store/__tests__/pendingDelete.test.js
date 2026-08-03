import { act } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { scheduleDelete, usePendingDelete } from '../pendingDelete'
import { useToastStore } from '../toast'

beforeEach(() => {
  vi.useFakeTimers()
  act(() => useToastStore.setState({ toasts: [] }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduleDelete', () => {
  it('hides the id immediately', () => {
    const { result } = renderHook(() => usePendingDelete(1))
    expect(result.current).toBe(false)

    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete: vi.fn() }))

    expect(result.current).toBe(true)
  })

  it('shows an undo toast', () => {
    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete: vi.fn() }))

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Recording deleted')
    expect(toasts[0].action.label).toBe('Undo')
  })

  it('calls onDelete only after the grace period elapses', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete, grace: 6000 }))

    expect(onDelete).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(5999))
    expect(onDelete).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(2))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('un-hides the id once the delete completes', async () => {
    const { result } = renderHook(() => usePendingDelete(1))
    const onDelete = vi.fn().mockResolvedValue(undefined)
    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete, grace: 1000 }))

    expect(result.current).toBe(true)
    await act(async () => vi.advanceTimersByTime(1001))

    expect(result.current).toBe(false)
  })

  it('undo cancels the delete and un-hides the id, without ever calling onDelete', async () => {
    const { result } = renderHook(() => usePendingDelete(1))
    const onDelete = vi.fn().mockResolvedValue(undefined)
    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete, grace: 6000 }))
    expect(result.current).toBe(true)

    const undoAction = useToastStore.getState().toasts[0].action
    act(() => undoAction.onClick())

    expect(result.current).toBe(false)

    await act(async () => vi.advanceTimersByTime(10000))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('un-hides the id and calls onError if the real delete fails', async () => {
    const { result } = renderHook(() => usePendingDelete(1))
    const onDelete = vi.fn().mockRejectedValue(new Error('boom'))
    const onError = vi.fn()
    act(() => scheduleDelete({ id: 1, label: 'Recording', onDelete, onError, grace: 1000 }))

    await act(async () => vi.advanceTimersByTime(1001))
    await act(async () => {}) // flush the rejected promise's microtask

    expect(result.current).toBe(false)
    expect(onError).toHaveBeenCalledWith(new Error('boom'))
  })

  it('tracks multiple pending deletes independently', () => {
    const idOne = renderHook(() => usePendingDelete(1))
    const idTwo = renderHook(() => usePendingDelete(2))

    act(() => scheduleDelete({ id: 1, label: 'A', onDelete: vi.fn() }))

    expect(idOne.result.current).toBe(true)
    expect(idTwo.result.current).toBe(false)
  })
})
