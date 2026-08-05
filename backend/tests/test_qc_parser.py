"""
Unit tests for qc_monitor.parse_qc_line() — the ffmpeg stderr lines below
are copy-pasted verbatim from a REAL ffmpeg run (freezedetect/blackdetect/
silencedetect against a synthetic test clip with known frozen, black, and
silent segments), not guessed from filter documentation. See
qc_monitor.py's module docstring for what that run confirmed about each
filter's actual real-time-vs-retrospective behavior.
"""

from __future__ import annotations

from backend.services.qc_monitor import parse_qc_line


def test_freeze_start_is_parsed_as_a_live_start_event():
    line = "[Parsed_freezedetect_0 @ 0000020079a47f00] lavfi.freezedetect.freeze_start: 5"
    assert parse_qc_line(line) == {"kind": "freeze", "action": "start"}


def test_freeze_end_is_parsed_as_an_end_event():
    line = "[Parsed_freezedetect_0 @ 0000011dc6e01800] lavfi.freezedetect.freeze_end: 6"
    assert parse_qc_line(line) == {"kind": "freeze", "action": "end"}


def test_freeze_duration_line_alone_is_not_an_event():
    # ffmpeg logs freeze_duration as its own separate line, distinct from
    # freeze_end — not something record_sample()/the state machine needs.
    line = "[Parsed_freezedetect_0 @ 0000011dc6e01800] lavfi.freezedetect.freeze_duration: 3"
    assert parse_qc_line(line) is None


def test_silence_start_is_parsed_as_a_live_start_event():
    line = "[Parsed_silencedetect_0 @ 000002007754e500] silence_start: 5.001905"
    assert parse_qc_line(line) == {"kind": "silence", "action": "start"}


def test_silence_end_is_parsed_with_its_duration():
    line = "[Parsed_silencedetect_0 @ 000002007754e500] silence_end: 10.0078 | silence_duration: 5.005896"
    event = parse_qc_line(line)
    assert event["kind"] == "silence"
    assert event["action"] == "end"
    assert event["duration"] == 5.005896


def test_black_line_is_parsed_as_a_single_retrospective_event():
    # Confirmed live: ffmpeg never emits a separate black_start on its own —
    # this one combined line is the only signal blackdetect ever produces,
    # and only after the black period has already ended.
    line = "[Parsed_blackdetect_1 @ 0000020079a47bc0] black_start:5 black_end:9.96 black_duration:4.96"
    event = parse_qc_line(line)
    assert event["kind"] == "black"
    assert event["action"] == "detected"
    assert event["duration"] == 4.96


def test_unrelated_ffmpeg_log_lines_are_ignored():
    for line in [
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'combined.mp4':",
        "  Stream #0:0: Video: h264, yuv420p, 320x240, 25 fps",
        "frame=  250 fps= 25 q=-1.0 size=N/A time=00:00:10.00 bitrate=N/A speed=1x",
    ]:
        assert parse_qc_line(line) is None
