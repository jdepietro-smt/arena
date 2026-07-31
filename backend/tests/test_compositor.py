"""
Regression tests for backend.services.compositor._Job._build_cmd().

Each test here maps directly to a real bug found and fixed in production
this session — see the comments in compositor.py itself for the full
incident writeup. _build_cmd() is a pure function (no I/O, no subprocess),
so these run instantly with no mocking.
"""

from __future__ import annotations

from backend.services.compositor import _Job, _grid


def _cmd_str(job: _Job) -> str:
    return " ".join(job._build_cmd())


class TestGrid:
    def test_square_counts(self):
        assert _grid(1) == (1, 1)
        assert _grid(4) == (2, 2)
        assert _grid(9) == (3, 3)

    def test_near_square_rounds_up(self):
        # Prime/awkward counts must round up to a near-square shape, not a
        # single row — that was the whole point of not relying on xstack's
        # grid=/fill= shorthand (unsupported on this server's ffmpeg build).
        assert _grid(2) == (2, 1)
        assert _grid(3) == (2, 2)
        assert _grid(5) == (3, 2)
        assert _grid(7) == (3, 3)


class TestSingleStreamNoXstack:
    """xstack hard-requires 2+ inputs — confirmed via a live ffmpeg error:
    "Value 1.000000 for parameter 'inputs' out of range [2 - ...]", which
    made the whole filter graph fail to initialize and the composite never
    published, leaving the viewer on "Waiting for stream..." forever."""

    def test_one_real_stream_no_blanks_skips_xstack(self):
        job = _Job("mv_test", ["Golf_Channel"], audio_path=None, blank_slots=0)
        cmd = _cmd_str(job)
        assert "xstack" not in cmd
        assert "[outv]" in cmd
        # still scales/normalizes the single stream
        assert "scale=" in cmd
        assert f"rtsp://localhost:8554/Golf_Channel" in cmd

    def test_two_real_streams_uses_xstack(self):
        job = _Job("mv_test", ["Golf_Channel", "World_Cup"], audio_path=None, blank_slots=0)
        cmd = _cmd_str(job)
        assert "xstack=inputs=2" in cmd

    def test_one_real_stream_plus_blank_slot_uses_xstack(self):
        # needed=2 here (1 real + 1 reserved), so xstack has 2 inputs and is
        # valid — only the true single-cell case (grid_capacity == 1) must
        # bypass it.
        job = _Job("mv_test", ["Golf_Channel"], audio_path=None, blank_slots=1)
        cmd = _cmd_str(job)
        assert "xstack=inputs=2" in cmd


class TestAspectRatioScaling:
    """2-stream (and other single-row) grids produce cells nowhere near
    16:9 (e.g. 960x1080 for 2 tiles) — crop-to-fill there meant zooming in
    ~2x and cutting away roughly half of each picture's width, which read
    as broken/zoomed aspect ratio. Letterbox (pad) is correct for rows==1;
    crop is still correct for 2+ rows, where it avoids a visible gap from
    stacked letterbox bars between rows."""

    def test_two_tiles_single_row_letterboxes(self):
        job = _Job("mv_test", ["A", "B"], audio_path=None, blank_slots=0)
        cmd = _cmd_str(job)
        assert "force_original_aspect_ratio=decrease" in cmd
        assert "pad=" in cmd
        assert "crop=" not in cmd

    def test_four_tiles_two_rows_crops(self):
        job = _Job("mv_test", ["A", "B", "C", "D"], audio_path=None, blank_slots=0)
        cmd = _cmd_str(job)
        assert "force_original_aspect_ratio=increase" in cmd
        assert "crop=" in cmd
        assert "pad=" not in cmd


class TestInputRobustness:
    """thread_queue_size=512 was confirmed too small via a live job's
    captured stderr: "Thread message queue blocking" cascading into real
    decode corruption once a 2nd video decode + audio were competing for
    the same queue capacity. use_wallclock_as_timestamps fixed an earlier
    slow-motion bug from trusting mismatched source PTS."""

    def test_per_input_flags_present(self):
        job = _Job("mv_test", ["A", "B"], audio_path=None, blank_slots=0)
        cmd = job._build_cmd()
        assert cmd.count("4096") >= 2  # once per real input
        assert "512" not in cmd
        assert "-use_wallclock_as_timestamps" in cmd


class TestAudioMapping:
    def test_no_audio_path_is_muted(self):
        job = _Job("mv_test", ["A", "B"], audio_path=None, blank_slots=0)
        cmd = job._build_cmd()
        assert "-an" in cmd

    def test_audio_path_maps_correct_input_index(self):
        job = _Job("mv_test", ["A", "B", "C"], audio_path="B", blank_slots=0)
        cmd = job._build_cmd()
        assert "1:a" in cmd  # "B" is input index 1
        assert "-an" not in cmd
        # No aresample filter — tried twice, both times made real playback
        # (not just logs) worse; see the long comment in compositor.py.
        assert "aresample" not in " ".join(cmd)

    def test_audio_path_not_in_paths_is_muted(self):
        job = _Job("mv_test", ["A", "B"], audio_path="not-in-list", blank_slots=0)
        cmd = job._build_cmd()
        assert "-an" in cmd
