"""
Regression tests for backend.services.recorder's hls_generator ref-counting.

The real incident (see hls_generator.py and recorder.py for the full
writeup): the HLS generator must run for exactly as long as *any* recording
needs it, not per individual recording call — two concurrent recordings on
the same path must not have the first one's stop_recording() kill the
generator out from under the second. _path_refcounts is what makes that
correct; these tests pin that behavior down directly rather than relying on
manual live testing to catch a regression here again.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlmodel import Session

from backend.database import engine
from backend.services import recorder


class FakeProc:
    """Mimics asyncio.subprocess.Process just enough for recorder.py's use:
    terminate()/wait() from stop_recording, communicate() from the
    background _monitor task. Exit is modeled with an Event so terminate()
    correctly unblocks both without a real subprocess."""

    def __init__(self) -> None:
        self.pid = 4242
        self.returncode: int | None = None
        self._exited = asyncio.Event()

    def terminate(self) -> None:
        self.returncode = 0
        self._exited.set()

    async def wait(self) -> int:
        await self._exited.wait()
        return self.returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        await self._exited.wait()
        return b"", b""


class FakeHlsGenerator:
    def __init__(self) -> None:
        self.want_calls: list[str] = []
        self.unwant_calls: list[str] = []

    async def want(self, path: str) -> None:
        self.want_calls.append(path)

    async def unwant(self, path: str) -> None:
        self.unwant_calls.append(path)


@pytest.fixture
def fake_hls_generator(monkeypatch) -> FakeHlsGenerator:
    fake = FakeHlsGenerator()
    monkeypatch.setattr(recorder, "get_hls_generator", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def _fast_and_sandboxed(monkeypatch, tmp_path):
    # No real ffmpeg, no real sleeping through the HLS-file-appears poll
    # loop, and no writes outside the test sandbox.
    #
    # recorder.asyncio *is* the asyncio module (same object, not a copy) —
    # patching recorder.asyncio.sleep patches asyncio.sleep globally, so the
    # replacement must not call asyncio.sleep itself or it recurses into
    # its own patched version. Capture the real one first.
    real_sleep = asyncio.sleep
    monkeypatch.setattr(recorder.asyncio, "sleep", lambda *_a, **_kw: real_sleep(0))
    monkeypatch.setattr(recorder, "get_recordings_dir", lambda _session: tmp_path)

    async def fake_subprocess_exec(*_args, **_kwargs):
        return FakeProc()

    monkeypatch.setattr(recorder.asyncio, "create_subprocess_exec", fake_subprocess_exec)
    yield
    # Reset module-level state between tests — it's a real production
    # in-memory registry, not per-instance.
    recorder._processes.clear()
    recorder._output_paths.clear()
    recorder._start_times.clear()
    recorder._recording_paths.clear()
    recorder._path_refcounts.clear()


class TestRefCounting:
    async def test_single_recording_wants_and_unwants_once(self, fake_hls_generator: FakeHlsGenerator):
        with Session(engine) as session:
            rec = await recorder.start_recording(session, "Golf_Channel")
            assert fake_hls_generator.want_calls == ["Golf_Channel"]
            assert recorder._path_refcounts["Golf_Channel"] == 1

            await recorder.stop_recording(session, rec.id)
            assert fake_hls_generator.unwant_calls == ["Golf_Channel"]
            assert "Golf_Channel" not in recorder._path_refcounts

    async def test_two_concurrent_recordings_share_the_generator(
        self, fake_hls_generator: FakeHlsGenerator
    ):
        """The actual bug this guards: stopping the FIRST of two concurrent
        recordings on the same path must not tear down the generator the
        SECOND one still needs."""
        with Session(engine) as session:
            rec_a = await recorder.start_recording(session, "Golf_Channel")
            rec_b = await recorder.start_recording(session, "Golf_Channel")
            assert fake_hls_generator.want_calls == ["Golf_Channel", "Golf_Channel"]
            assert recorder._path_refcounts["Golf_Channel"] == 2

            await recorder.stop_recording(session, rec_a.id)
            assert fake_hls_generator.unwant_calls == []  # rec_b still needs it
            assert recorder._path_refcounts["Golf_Channel"] == 1

            await recorder.stop_recording(session, rec_b.id)
            assert fake_hls_generator.unwant_calls == ["Golf_Channel"]
            assert "Golf_Channel" not in recorder._path_refcounts

    async def test_independent_paths_do_not_share_refcounts(
        self, fake_hls_generator: FakeHlsGenerator
    ):
        with Session(engine) as session:
            rec_a = await recorder.start_recording(session, "Golf_Channel")
            rec_b = await recorder.start_recording(session, "World_Cup")

            await recorder.stop_recording(session, rec_a.id)
            assert fake_hls_generator.unwant_calls == ["Golf_Channel"]

            await recorder.stop_recording(session, rec_b.id)
            assert fake_hls_generator.unwant_calls == ["Golf_Channel", "World_Cup"]

    async def test_crash_path_releases_same_as_clean_stop(
        self, fake_hls_generator: FakeHlsGenerator
    ):
        """If ffmpeg dies on its own (not via stop_recording), the
        background monitor must still release the path — otherwise a
        crashed recording leaves its path's generator running forever."""
        with Session(engine) as session:
            rec = await recorder.start_recording(session, "Golf_Channel")
            proc = recorder._processes[rec.id]
            monitor_task = asyncio.create_task(recorder._monitor(rec.id, proc))

            proc.terminate()  # simulate ffmpeg exiting unexpectedly
            await monitor_task

            assert fake_hls_generator.unwant_calls == ["Golf_Channel"]
            assert "Golf_Channel" not in recorder._path_refcounts


class InstantProc:
    """A subprocess double whose communicate()/wait() resolve immediately —
    for the thumbnail ffmpeg call, which stop_recording awaits synchronously
    (unlike the recording process, it isn't terminate()'d first)."""

    def __init__(self, returncode: int = 0) -> None:
        self.returncode = returncode

    async def communicate(self) -> tuple[bytes, bytes]:
        return b"", b""

    async def wait(self) -> int:
        return self.returncode

    def terminate(self) -> None:
        pass


class TestThumbnailGeneration:
    async def test_generates_thumbnail_when_output_file_exists(
        self, fake_hls_generator: FakeHlsGenerator, monkeypatch
    ):
        calls: list[tuple] = []

        async def fake_ffmpeg(*args, **kwargs):
            calls.append(args)
            return InstantProc(returncode=0)

        with Session(engine) as session:
            rec = await recorder.start_recording(session, "Golf_Channel")
            output_path = recorder._output_paths[rec.id]
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"fake mp4 bytes")

            monkeypatch.setattr(recorder.asyncio, "create_subprocess_exec", fake_ffmpeg)
            await recorder.stop_recording(session, rec.id)

        thumbnail_calls = [c for c in calls if c[0] == "ffmpeg"]
        assert len(thumbnail_calls) == 1
        assert str(output_path.with_suffix(".jpg")) in thumbnail_calls[0]

    async def test_skips_thumbnail_when_output_file_missing(
        self, fake_hls_generator: FakeHlsGenerator, monkeypatch
    ):
        calls: list[tuple] = []

        async def fake_ffmpeg(*args, **kwargs):
            calls.append(args)
            return InstantProc(returncode=0)

        with Session(engine) as session:
            rec = await recorder.start_recording(session, "Golf_Channel")
            # No file written at output_path this time.
            monkeypatch.setattr(recorder.asyncio, "create_subprocess_exec", fake_ffmpeg)
            await recorder.stop_recording(session, rec.id)

        assert calls == []

    async def test_thumbnail_failure_does_not_block_completion(
        self, fake_hls_generator: FakeHlsGenerator, monkeypatch
    ):
        async def failing_ffmpeg(*args, **kwargs):
            return InstantProc(returncode=1)

        with Session(engine) as session:
            rec = await recorder.start_recording(session, "Golf_Channel")
            output_path = recorder._output_paths[rec.id]
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(b"fake mp4 bytes")

            monkeypatch.setattr(recorder.asyncio, "create_subprocess_exec", failing_ffmpeg)
            result = await recorder.stop_recording(session, rec.id)
            assert result.status == recorder.RecordingStatus.complete
