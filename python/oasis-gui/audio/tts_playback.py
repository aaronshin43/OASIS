from __future__ import annotations
import os
import signal
import subprocess
import tempfile
import threading
import platform
from queue import Queue, Empty
from PyQt5.QtCore import QThread, pyqtSignal

IS_PI = platform.machine().startswith("aarch")
PIPER_BINARY = os.getenv("PIPER_BINARY_PATH", "/home/pi/piper/piper/piper")
PIPER_MODEL = os.getenv("PIPER_MODEL_PATH", "/home/pi/piper/voices/en_US-amy-medium.onnx")
SOUND_CARD_INDEX = os.getenv("SOUND_CARD_INDEX", "1")
PIPER_SENTENCE_SILENCE = os.getenv("PIPER_SENTENCE_SILENCE", "0.3")
PIPER_LENGTH_SCALE = os.getenv("PIPER_LENGTH_SCALE", "1.0")

_FLUSH = "__FLUSH__"
_STOP  = "__STOP__"

# Check if Piper binary exists (PC mode won't have it)
_TTS_AVAILABLE = os.path.isfile(PIPER_BINARY)


class TTSPlaybackWorker(QThread):
    playback_finished = pyqtSignal()  # emitted after _FLUSH when queue drains

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sentence_queue: Queue = Queue()
        self._wav_queue: Queue = Queue()
        self._abort = False
        self._current_process: subprocess.Popen | None = None

    # ── Public API (called from any thread) ───────────────────────────

    def queue_sentence(self, sentence: str):
        if _TTS_AVAILABLE and not self._abort:
            self._sentence_queue.put(sentence)

    def flush(self):
        """Signal that LLM stream is done — play remaining, then emit playback_finished."""
        self._sentence_queue.put(_FLUSH)

    def cancel(self):
        """Interrupt — stop current playback and drain queues."""
        self._abort = True
        self._kill_current()
        # Drain sentence queue
        while not self._sentence_queue.empty():
            try:
                self._sentence_queue.get_nowait()
            except Empty:
                break
        # Wake synth thread so it forwards FLUSH → wav queue → play loop unblocks
        self._sentence_queue.put(_FLUSH)

    def reset(self):
        """Prepare for next query (called before new recording starts)."""
        self._abort = False

    def shutdown(self):
        """Graceful shutdown — called on app exit."""
        self._abort = True
        self._kill_current()
        self._sentence_queue.put(_STOP)

    # ── Thread loops ──────────────────────────────────────────────────

    def run(self):
        """QThread entry: start synth thread, run play loop in this thread."""
        print(f"[TTS] Worker started (piper available: {_TTS_AVAILABLE})")
        synth_thread = threading.Thread(target=self._synth_loop, daemon=True)
        synth_thread.start()
        self._play_loop()

    def _synth_loop(self):
        """Synthesis thread: sentence_queue → wav_queue.

        Runs concurrently with _play_loop so the next sentence is synthesized
        while the current one is still playing.
        """
        while True:
            item = self._sentence_queue.get()

            if item == _STOP:
                self._wav_queue.put(_STOP)
                break

            if item == _FLUSH:
                self._wav_queue.put(_FLUSH)
                continue

            if self._abort:
                continue

            wav_path = self._synthesize(item)
            if wav_path:
                self._wav_queue.put(wav_path)

    def _play_loop(self):
        """Play loop: wav_queue → audio output."""
        while True:
            item = self._wav_queue.get()

            if item == _STOP:
                break

            if item == _FLUSH:
                if not self._abort:
                    self.playback_finished.emit()
                continue

            if self._abort:
                try:
                    os.unlink(item)
                except OSError:
                    pass
                continue

            self._play(item)
            try:
                os.unlink(item)
            except OSError:
                pass

    # ── Synthesis & playback ──────────────────────────────────────────

    def _synthesize(self, text: str) -> str | None:
        """Piper binary: stdin text → WAV file."""
        if not _TTS_AVAILABLE or self._abort:
            return None
        try:
            fd, wav_path = tempfile.mkstemp(suffix=".wav", prefix="oasis_tts_")
            os.close(fd)

            proc = subprocess.Popen(
                [PIPER_BINARY, "--model", PIPER_MODEL,
                 "--sentence-silence", PIPER_SENTENCE_SILENCE,
                 "--length_scale", PIPER_LENGTH_SCALE,
                 "--output_file", wav_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            proc.stdin.write(text.encode("utf-8"))
            proc.stdin.close()
            proc.wait(timeout=15)

            if self._abort:
                try:
                    os.unlink(wav_path)
                except OSError:
                    pass
                return None

            if os.path.exists(wav_path) and os.path.getsize(wav_path) > 44:
                return wav_path
            return None
        except Exception as e:
            print(f"[TTS] Synthesis error: {e}")
            return None

    def _play(self, wav_path: str):
        """Play WAV via aplay (Pi) or sox play (PC) — blocking."""
        try:
            if IS_PI:
                play_cmd = ["aplay", "-D", f"plughw:{SOUND_CARD_INDEX},0", wav_path]
            else:
                play_cmd = ["play", wav_path, "-q"]
            self._current_process = subprocess.Popen(
                play_cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self._current_process.wait(timeout=30)
        except Exception as e:
            print(f"[TTS] Playback error: {e}")
        finally:
            self._current_process = None

    def _kill_current(self):
        proc = self._current_process
        if proc and proc.poll() is None:
            try:
                proc.send_signal(signal.SIGINT)
                proc.wait(timeout=1)
            except Exception:
                proc.kill()
