// Sharper-than-bilinear video upscaling for fullscreen playback.
//
// A <video> stretched past its native size is scaled with plain bilinear
// filtering (on Windows often by the GPU overlay scaler), which looks soft —
// a 720p stream on a 1080p/4K screen is the usual case. This draws each
// decoded frame to a WebGL canvas with a Catmull-Rom bicubic filter instead.
// The <video> keeps playing underneath (audio, WebRTC stats); the canvas is
// only a display surface, so latency is one extra GPU draw per frame.

const VERT = `attribute vec2 p; varying vec2 uv;
void main(){ uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`

const FRAG = `precision highp float;
varying vec2 uv; uniform sampler2D t; uniform vec2 ts;
vec4 cr(vec4 a, vec4 b, vec4 c, vec4 d, float x){
  return b + .5 * x * (c - a + x * (2.*a - 5.*b + 4.*c - d + x * (3.*(b - c) + d - a)));
}
vec4 row(float y, vec2 f, vec2 b){
  return cr(texture2D(t, (b + vec2(-1., y)) * ts), texture2D(t, (b + vec2(0., y)) * ts),
            texture2D(t, (b + vec2(1., y)) * ts),  texture2D(t, (b + vec2(2., y)) * ts), f.x);
}
void main(){
  vec2 pos = uv / ts - .5;
  vec2 b = floor(pos) + .5;
  vec2 f = pos - floor(pos);
  gl_FragColor = cr(row(-1., f, b), row(0., f, b), row(1., f, b), row(2., f, b), f.y);
}`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
  return s
}

// Starts drawing `video` into `canvas` (sized by the caller, in device pixels).
// Returns stop(), or null if WebGL / requestVideoFrameCallback isn't available
// — the caller then just keeps showing the plain <video>.
export function startUpscaler(video, canvas) {
  if (!video.requestVideoFrameCallback) return null
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, desynchronized: true })
  if (!gl) return null

  let prog
  try {
    prog = gl.createProgram()
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  } catch { return null }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const tsLoc = gl.getUniformLocation(prog, 'ts')

  let alive = true
  let handle = 0
  const draw = () => {
    if (!alive) return
    if (video.videoWidth) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(tsLoc, 1 / video.videoWidth, 1 / video.videoHeight)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    handle = video.requestVideoFrameCallback(draw)
  }
  handle = video.requestVideoFrameCallback(draw)

  return () => {
    alive = false
    try { video.cancelVideoFrameCallback(handle) } catch { /* ignore */ }
  }
}
