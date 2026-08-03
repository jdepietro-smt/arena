import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStreams, getMultiviewJobs, stopMultiviewJob,
  getExternalSources, addExternalSource, removeExternalSource,
  getYoutubeCookiesStatus, uploadYoutubeCookies, removeYoutubeCookies,
} from '../api/client'
import MultiviewTile, { gridColsClassFor } from '../components/MultiviewTile'
import { toast } from '../store/toast'

function parseStreamsParam(searchParams) {
  return new Set(
    (searchParams.get('streams') || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  )
}

// Matches watch?v=, youtu.be/, embed/, live/, and shorts/ URL forms.
function extractYoutubeId(url) {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  )
  return m ? m[1] : null
}

const YOUTUBE_EMBEDS_KEY = 'arena-youtube-embeds'
const SAVED_MULTIVIEWERS_KEY = 'arena-saved-multiviewers'

function loadYoutubeEmbeds() {
  try {
    return JSON.parse(localStorage.getItem(YOUTUBE_EMBEDS_KEY) || '[]')
  } catch {
    return []
  }
}

function loadSavedMultiviewers() {
  try {
    return JSON.parse(localStorage.getItem(SAVED_MULTIVIEWERS_KEY) || '[]')
  } catch {
    return []
  }
}

export default function MultiviewerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pinned, setPinned] = useState(() => parseStreamsParam(searchParams))
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()
  const [stoppingId, setStoppingId] = useState(null)

  const { data: streams = [], isError: streamsError } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })

  const { data: activeJobs = [] } = useQuery({
    queryKey: ['multiview-jobs'],
    queryFn: getMultiviewJobs,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })

  async function stopJob(jobId) {
    setStoppingId(jobId)
    try {
      await stopMultiviewJob(jobId)
      queryClient.invalidateQueries({ queryKey: ['multiview-jobs'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to stop composite job')
    } finally {
      setStoppingId(null)
    }
  }

  const { data: externalSources = [] } = useQuery({
    queryKey: ['external-sources'],
    queryFn: getExternalSources,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })
  const [removingSource, setRemovingSource] = useState(null)

  async function removeSource(name) {
    setRemovingSource(name)
    try {
      await removeExternalSource(name)
      queryClient.invalidateQueries({ queryKey: ['external-sources'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || `Failed to remove "${name}"`)
    } finally {
      setRemovingSource(null)
    }
  }

  const { data: cookiesStatus } = useQuery({
    queryKey: ['youtube-cookies-status'],
    queryFn: getYoutubeCookiesStatus,
    refetchInterval: 10000,
  })
  const [uploadingCookies, setUploadingCookies] = useState(false)
  const [cookiesError, setCookiesError] = useState(null)

  async function handleCookiesFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setUploadingCookies(true)
    setCookiesError(null)
    try {
      await uploadYoutubeCookies(file)
      queryClient.invalidateQueries({ queryKey: ['youtube-cookies-status'] })
    } catch (err) {
      setCookiesError(err.response?.data?.detail || err.message || 'Upload failed')
    } finally {
      setUploadingCookies(false)
    }
  }

  async function clearCookies() {
    setUploadingCookies(true)
    try {
      await removeYoutubeCookies()
      queryClient.invalidateQueries({ queryKey: ['youtube-cookies-status'] })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to remove cookies')
    } finally {
      setUploadingCookies(false)
    }
  }

  const [youtubeEmbeds, setYoutubeEmbeds] = useState(loadYoutubeEmbeds)
  const [pinnedYoutubeIds, setPinnedYoutubeIds] = useState(() => new Set())
  const [linkName, setLinkName] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState(null)
  const [addingLink, setAddingLink] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  // Named, saved selections — the picker only ever edits one live selection
  // at a time (the `pinned`/`pinnedYoutubeIds` state above), so without
  // this there's no way to keep more than one multiviewer combo around;
  // picking a new set of streams just overwrites what you had. Saving
  // snapshots the current selection under a name so several can coexist,
  // each independently loadable/openable — each is still just a distinct
  // streams=/youtube= URL under the hood, same as today.
  const [savedMultiviewers, setSavedMultiviewers] = useState(loadSavedMultiviewers)
  const [savingName, setSavingName] = useState('')
  const [savingError, setSavingError] = useState(null)

  function persistSavedMultiviewers(next) {
    setSavedMultiviewers(next)
    localStorage.setItem(SAVED_MULTIVIEWERS_KEY, JSON.stringify(next))
  }

  function saveCurrentAsMultiviewer(e) {
    e.preventDefault()
    const name = savingName.trim()
    if (!name) {
      setSavingError('Name is required')
      return
    }
    if (pinned.size === 0 && pinnedYoutubeIds.size === 0) {
      setSavingError('Select at least one stream or embed first')
      return
    }
    setSavingError(null)
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      streams: Array.from(pinned),
      youtube: youtubeEmbeds.filter((y) => pinnedYoutubeIds.has(y.videoId)),
    }
    persistSavedMultiviewers([...savedMultiviewers, entry])
    setSavingName('')
  }

  function deleteSavedMultiviewer(id) {
    persistSavedMultiviewers(savedMultiviewers.filter((m) => m.id !== id))
  }

  function loadSavedMultiviewer(entry) {
    // Any YouTube embeds this saved combo references but that aren't in
    // the current embeds list anymore (e.g. removed since) get restored.
    const missing = entry.youtube.filter(
      (y) => !youtubeEmbeds.some((existing) => existing.videoId === y.videoId)
    )
    if (missing.length > 0) {
      persistEmbeds([...youtubeEmbeds, ...missing])
    }
    applyPinned(new Set(entry.streams))
    setPinnedYoutubeIds(new Set(entry.youtube.map((y) => y.videoId)))
  }

  function buildStandaloneUrl(streamPaths, youtubeList) {
    const params = new URLSearchParams()
    if (streamPaths.length > 0) params.set('streams', streamPaths.join(','))
    if (youtubeList.length > 0) {
      params.set('youtube', youtubeList.map((y) => y.videoId).join(','))
      params.set('ytLabels', youtubeList.map((y) => encodeURIComponent(y.label || y.videoId)).join(','))
    }
    return `${window.location.origin}/multiview?${params.toString()}`
  }

  function openSavedMultiviewer(entry) {
    window.open(buildStandaloneUrl(entry.streams, entry.youtube), '_blank', 'noopener')
  }

  function persistEmbeds(next) {
    setYoutubeEmbeds(next)
    localStorage.setItem(YOUTUBE_EMBEDS_KEY, JSON.stringify(next))
  }

  // One field for either kind of external link: an srt:// URL becomes a
  // real ingested stream (mediamtx pulls it natively, shows up in Live
  // Streams once ready); anything else that looks like a YouTube URL
  // becomes a client-side embed (no server ingestion, no bot-check risk).
  async function submitExternalLink(e) {
    e.preventDefault()
    setLinkError(null)
    const url = linkUrl.trim()
    const name = linkName.trim()

    if (url.toLowerCase().startsWith('srt://')) {
      if (!name) {
        setLinkError('Name is required for an SRT source')
        return
      }
      setAddingLink(true)
      try {
        await addExternalSource(name, url)
        queryClient.invalidateQueries({ queryKey: ['external-sources'] })
        setLinkUrl('')
        setLinkName('')
      } catch (err) {
        setLinkError(err.response?.data?.detail || err.message || 'Failed to add source')
      } finally {
        setAddingLink(false)
      }
      return
    }

    const videoId = extractYoutubeId(url)
    if (videoId) {
      if (youtubeEmbeds.some((y) => y.videoId === videoId)) {
        setLinkError('Already added')
        return
      }
      persistEmbeds([...youtubeEmbeds, { videoId, url, label: name || videoId }])
      setLinkUrl('')
      setLinkName('')
      return
    }

    setLinkError('Enter an SRT URL (srt://...) or a YouTube link')
  }

  function removeYoutubeEmbed(videoId) {
    persistEmbeds(youtubeEmbeds.filter((y) => y.videoId !== videoId))
    setPinnedYoutubeIds((prev) => {
      const next = new Set(prev)
      next.delete(videoId)
      return next
    })
  }

  function toggleYoutubePin(videoId) {
    setPinnedYoutubeIds((prev) => {
      const next = new Set(prev)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })
  }

  function startRenaming(y) {
    setRenamingId(y.videoId)
    setRenameValue(y.label || y.videoId)
  }

  function saveRename(videoId) {
    const label = renameValue.trim() || videoId
    persistEmbeds(youtubeEmbeds.map((y) => (y.videoId === videoId ? { ...y, label } : y)))
    setRenamingId(null)
  }

  const liveStreams = streams.filter((s) => s.ready)
  const pinnedStreams = liveStreams.filter((s) => pinned.has(s.path))
  const pinnedYoutubeEmbeds = youtubeEmbeds.filter((y) => pinnedYoutubeIds.has(y.videoId))

  function applyPinned(next) {
    setPinned(next)
    setSearchParams(next.size ? { streams: Array.from(next).join(',') } : {}, { replace: true })
  }

  function togglePin(path) {
    const next = new Set(pinned)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    applyPinned(next)
  }

  function standaloneUrl() {
    return buildStandaloneUrl(Array.from(pinned), pinnedYoutubeEmbeds)
  }

  function openStandalone() {
    window.open(standaloneUrl(), '_blank', 'noopener')
  }

  function copyLink() {
    const url = standaloneUrl()

    const fallbackCopy = () => {
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(textarea)
      }
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(fallbackCopy)
    } else {
      fallbackCopy()
    }

    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const gridColsClass = gridColsClassFor(pinnedStreams.length + pinnedYoutubeEmbeds.length)

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-0 overflow-y-auto lg:overflow-hidden">
      <div className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-surface-600 p-3 max-h-80 lg:max-h-none overflow-y-auto">
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Live Streams
          </h2>
          {pinned.size > 0 && (
            <button
              onClick={() => applyPinned(new Set())}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Clear
            </button>
          )}
        </div>
        {(pinned.size > 0 || pinnedYoutubeIds.size > 0) && (
          <div className="flex flex-col gap-1.5 mb-3">
            <button
              onClick={copyLink}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold border border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 transition-colors"
            >
              {copied ? 'Link copied' : 'Copy standalone link'}
            </button>
            <button
              onClick={openStandalone}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold border border-surface-600 text-gray-400 hover:text-gray-200 hover:bg-surface-700 transition-colors"
            >
              Open standalone view
            </button>
            <form onSubmit={saveCurrentAsMultiviewer} className="flex gap-1.5">
              <input
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                placeholder="Save as…"
                className="flex-1 min-w-0 text-xs bg-surface-800 border border-surface-600 text-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500/50"
              />
              <button
                type="submit"
                className="shrink-0 px-2 py-1.5 rounded-lg text-xs font-semibold border border-surface-600 text-gray-400 hover:text-gray-200 hover:bg-surface-700 transition-colors"
              >
                Save
              </button>
            </form>
            {savingError && <p className="text-xs text-red-400 px-1">{savingError}</p>}
          </div>
        )}
        {savedMultiviewers.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 px-1">
              Saved Multiviewers
            </h2>
            <div className="flex flex-col gap-1">
              {savedMultiviewers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-surface-600 bg-surface-800"
                >
                  <span className="truncate flex-1 text-gray-300" title={[...m.streams, ...m.youtube.map((y) => y.label)].join(', ')}>
                    {m.name}
                  </span>
                  <button
                    onClick={() => loadSavedMultiviewer(m)}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 transition-colors"
                  >
                    Load
                  </button>
                  <button
                    onClick={() => openSavedMultiviewer(m)}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-surface-600 text-gray-400 hover:text-gray-200 hover:bg-surface-700 transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => deleteSavedMultiviewer(m.id)}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeJobs.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 px-1">
              Active Composites
            </h2>
            <div className="flex flex-col gap-1">
              {activeJobs.map((j) => (
                <div
                  key={j.job_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-surface-600 bg-surface-800"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${j.running ? 'bg-emerald-500' : 'bg-gray-500'}`} />
                  <span className="truncate flex-1 text-gray-300" title={j.paths.join(', ')}>
                    {j.paths.join(' + ')}
                    {j.audio_path && <span className="text-gray-500"> 🔊{j.audio_path}</span>}
                  </span>
                  <button
                    onClick={() => stopJob(j.job_id)}
                    disabled={stoppingId === j.job_id}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                  >
                    {stoppingId === j.job_id ? '…' : 'Stop'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mb-4">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 px-1">
            External Links
          </h2>
          <p className="text-xs text-gray-400 mb-2 px-1">
            One field for either — an srt:// URL becomes a real ingested stream (shows up in Live Streams below once ready); a YouTube URL becomes an embed (YouTube's own player, no bot-check risk).
          </p>

          <form onSubmit={submitExternalLink} className="flex flex-col gap-1.5 mb-2 px-1">
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="srt://... or YouTube URL"
              className="text-xs bg-surface-800 border border-surface-600 text-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500/50"
            />
            <input
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
              placeholder="Name"
              className="text-xs bg-surface-800 border border-surface-600 text-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500/50"
            />
            {linkError && <p className="text-xs text-red-400">{linkError}</p>}
            <button
              type="submit"
              disabled={addingLink}
              className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 disabled:opacity-50 transition-colors"
            >
              {addingLink ? 'Adding…' : 'Add link'}
            </button>
          </form>

          {(externalSources.length > 0 || youtubeEmbeds.length > 0) && (
            <div className="flex flex-col gap-1 mb-2">
              {externalSources.map((s) => (
                <div
                  key={`src-${s.name}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-surface-600 bg-surface-800"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.status === 'live' || s.status === 'srt' ? 'bg-emerald-500' : s.status === 'error' ? 'bg-red-500' : 'bg-amber-500'
                  }`} title={s.last_error || s.status} />
                  <span className="truncate flex-1 text-gray-300" title={s.url}>{s.name}</span>
                  <button
                    onClick={() => removeSource(s.name)}
                    disabled={removingSource === s.name}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                  >
                    {removingSource === s.name ? '…' : 'Remove'}
                  </button>
                </div>
              ))}

              {youtubeEmbeds.map((y) => (
                <div
                  key={`yt-${y.videoId}`}
                  role={renamingId === y.videoId ? undefined : 'button'}
                  tabIndex={renamingId === y.videoId ? undefined : 0}
                  aria-pressed={renamingId === y.videoId ? undefined : pinnedYoutubeIds.has(y.videoId)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                    pinnedYoutubeIds.has(y.videoId)
                      ? 'bg-brand-600/20 text-brand-300 border-brand-500/40'
                      : 'text-gray-300 hover:bg-surface-700 border-surface-600'
                  } ${renamingId === y.videoId ? '' : 'cursor-pointer'}`}
                  onClick={renamingId === y.videoId ? undefined : () => toggleYoutubePin(y.videoId)}
                  onKeyDown={renamingId === y.videoId ? undefined : (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleYoutubePin(y.videoId)
                    }
                  }}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pinnedYoutubeIds.has(y.videoId) ? 'bg-brand-400' : 'bg-gray-600'}`} />
                  {renamingId === y.videoId ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(y.videoId); if (e.key === 'Escape') setRenamingId(null) }}
                      onBlur={() => saveRename(y.videoId)}
                      className="flex-1 min-w-0 bg-[#1a1a2e] border border-brand-500/40 rounded px-1 py-0.5 text-xs text-gray-200 focus:outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-400"
                    />
                  ) : (
                    <span className="truncate flex-1" title={y.url}>{y.label || y.videoId}</span>
                  )}
                  {renamingId !== y.videoId && (
                    <button
                      onClick={(e) => { e.stopPropagation(); startRenaming(y) }}
                      className="shrink-0 text-gray-500 hover:text-gray-300"
                      title="Rename"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeYoutubeEmbed(y.videoId) }}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <details>
            <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-400 px-1">
              Advanced: YouTube cookies (only needed if ingesting YouTube as a real composited stream, not an embed)
            </summary>
            <div className="flex items-center gap-2 mt-2 mb-1 px-1 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cookiesStatus?.present ? 'bg-emerald-500' : 'bg-gray-600'}`} />
              <span className="text-gray-500 flex-1">
                {cookiesStatus?.present ? 'YouTube cookies loaded' : 'No YouTube cookies (may hit bot checks)'}
              </span>
              {cookiesStatus?.present ? (
                <button onClick={clearCookies} disabled={uploadingCookies} className="text-gray-500 hover:text-red-300 disabled:opacity-50">
                  Clear
                </button>
              ) : (
                <label className="text-brand-300 hover:text-brand-200 cursor-pointer">
                  {uploadingCookies ? 'Uploading…' : 'Upload'}
                  <input type="file" accept=".txt" onChange={handleCookiesFile} disabled={uploadingCookies} className="hidden" />
                </label>
              )}
            </div>
            {cookiesError && <p className="text-xs text-red-400 mb-1 px-1">{cookiesError}</p>}
          </details>
        </div>

        {streamsError && (
          <p className="text-sm text-red-400 px-1 mb-2">Could not load streams. Retrying…</p>
        )}
        {!streamsError && liveStreams.length === 0 && (
          <p className="text-sm text-gray-400 px-1">No live streams right now.</p>
        )}
        <div className="flex flex-col gap-1">
          {liveStreams.map((s) => (
            <button
              key={s.path}
              onClick={() => togglePin(s.path)}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-colors border ${
                pinned.has(s.path)
                  ? 'bg-brand-600/20 text-brand-300 border-brand-500/40'
                  : 'text-gray-300 hover:bg-surface-700 border-transparent'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  pinned.has(s.path) ? 'bg-brand-400' : 'bg-gray-600'
                }`}
              />
              <span className="truncate flex-1">{s.name || s.path}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        {pinnedStreams.length === 0 && pinnedYoutubeEmbeds.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            Select streams or YouTube embeds from the left to add them to the multiviewer.
          </div>
        ) : (
          <div className={`grid ${gridColsClass} content-start gap-3 w-full`}>
            {pinnedStreams.map((s) => (
              <MultiviewTile key={s.path} path={s.path} label={s.name || s.path} />
            ))}
            {pinnedYoutubeEmbeds.map((y) => (
              <div key={y.videoId} className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                <iframe
                  src={`https://www.youtube.com/embed/${y.videoId}?autoplay=1&mute=1`}
                  className="w-full h-full"
                  title={y.label || y.videoId}
                  frameBorder="0"
                  allow="autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm text-white pointer-events-none">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {y.label || y.videoId}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
