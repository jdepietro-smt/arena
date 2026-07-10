/**
 * Start a WHEP (WebRTC-HTTP Egress Protocol) connection to a mediamtx stream.
 * Returns the RTCPeerConnection; call pc.close() to stop.
 *
 * url  - full WHEP endpoint, e.g. http://host:8889/Golf_Channel/whep
 * videoEl - <video> element to attach the incoming stream to
 */
export async function startWhep(url, videoEl) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })

  pc.addTransceiver('video', { direction: 'recvonly' })
  pc.addTransceiver('audio', { direction: 'recvonly' })

  pc.ontrack = ({ streams }) => {
    if (streams[0] && videoEl.srcObject !== streams[0]) {
      videoEl.srcObject = streams[0]
      videoEl.play().catch(() => {})
    }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // Wait for ICE gathering (max 2s). Peer-reflexive candidates handle
  // cases where STUN is slow — the server discovers the browser's
  // external address from the first ICE connectivity check it receives.
  await new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return }
    const check = () => { if (pc.iceGatheringState === 'complete') resolve() }
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(resolve, 2000)
  })

  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp,
    })
  } catch (e) {
    pc.close()
    throw new Error(`WHEP fetch failed: ${e.message}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    pc.close()
    throw new Error(`WHEP ${res.status}${body ? ': ' + body.trim() : ''}`)
  }

  const sdp = await res.text()
  await pc.setRemoteDescription({ type: 'answer', sdp })
  return pc
}
