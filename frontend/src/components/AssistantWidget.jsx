import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Sparkles, X, Send } from 'lucide-react'
import { queryAssistant } from '../api/client'
import { getErrorMessage } from '../utils/errors'

const SUGGESTIONS = [
  'Are any streams down right now?',
  'What happened in the last 15 minutes?',
  'Which stream has the highest packet loss?',
]

function MessageBubble({ role, text, isError }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-brand-600 text-white'
            : isError
              ? 'bg-red-500/10 border border-red-500/25 text-red-300'
              : 'bg-surface-700 text-gray-200'
        }`}
      >
        {text}
      </div>
    </div>
  )
}

export default function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState([])
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  const mutation = useMutation({
    mutationFn: (question) => queryAssistant(question),
    onSuccess: (data) => {
      setMessages(m => [...m, { role: 'assistant', text: data.answer }])
    },
    onError: (err) => {
      setMessages(m => [...m, { role: 'assistant', text: getErrorMessage(err, 'Something went wrong.'), isError: true }])
    },
  })

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, mutation.isPending])

  function send(question) {
    const q = question.trim()
    if (!q || mutation.isPending) return
    setMessages(m => [...m, { role: 'user', text: q }])
    setInput('')
    mutation.mutate(q)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-20 right-6 z-[250] w-[360px] max-h-[520px] flex flex-col bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600 bg-gradient-to-r from-brand-600/20 to-transparent">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-brand-400" />
              <span className="text-sm font-semibold text-white">Ops Assistant</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-white focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2 rounded"
              aria-label="Close ops assistant"
            >
              <X size={18} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 min-h-[200px]">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-gray-500">Ask about live streams, alerts, or recent events. Try:</p>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-xs text-gray-300 bg-surface-750 hover:bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m, i) => <MessageBubble key={i} {...m} />)
            )}
            {mutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-surface-700 text-gray-400 rounded-xl px-3 py-2 text-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-end gap-2 p-3 border-t border-surface-600">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the ops assistant…"
              rows={1}
              className="flex-1 resize-none bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || mutation.isPending}
              className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2"
              aria-label="Send question"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-6 right-6 z-[250] w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 shadow-lg shadow-brand-900/40 flex items-center justify-center text-white hover:scale-105 transition-transform focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2"
        aria-label={open ? 'Minimize ops assistant' : 'Open ops assistant'}
        aria-expanded={open}
      >
        <Sparkles size={20} />
      </button>
    </>
  )
}
