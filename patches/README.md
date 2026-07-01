# mediamtx_avsync_fix

Custom build of mediamtx (based on v1.19.2) with a fix for a confirmed A/V
sync bug: when a source stream has no native NTP (SRT/MPEG-TS sources use
`ReplaceNTP`), each track (video, audio) independently self-anchors its own
wall-clock-to-PTS reference point the first time it sees a unit. Since
video and audio units from the same source virtually never reach the
demuxer at exactly the same instant, each track's estimated NTP time drifts
from a slightly different origin — which is what WebRTC uses to keep tracks
in sync. This surfaces as audio lagging video by anywhere from a few
hundred milliseconds to (after a reconnect-triggered independent reset)
several seconds.

Fix: introduced `ntpestimator.SharedAnchor`, one wall-clock reference point
shared by every track of the same `Stream`, instead of each track's
`Estimator` picking its own. All tracks now derive their NTP mapping from
the exact same wall-clock moment.

Changed files (relative to upstream mediamtx):
- `internal/ntpestimator/estimator.go`
- `internal/stream/stream.go`
- `internal/stream/stream_media.go`
- `internal/stream/stream_format.go`

Built with: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`

Status: NOT YET DEPLOYED to production. Intended for a side-by-side test
on a separate port before replacing the running mediamtx instance.
