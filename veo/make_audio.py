"""Build a 30s voiceover + music track for a 4-clip (4 x 8s) Veo explainer.

Voice: Kokoro (open-source TTS, Apache-2.0). Music: a soft synth pad generated here,
so there is nothing to license.

Usage: python3 make_audio.py <project-dir> <kokoro-v1.0.onnx> <voices-v1.0.bin> [voice]
Reads <project-dir>/lines.json (4 voiceover lines, one per clip) and writes
<project-dir>/audio/. Model files: github.com/thewh1teagle/kokoro-onnx releases.
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

SR = 24000
LENGTH = 30.0
STARTS = [0.4, 8.4, 16.4, 24.3]  # each clip is 8s; lines start just after each cut
SLOT = [7.4, 7.4, 7.4, 5.5]  # max seconds each line may run


def voiceover(kokoro, voice, lines):
    track = np.zeros(int(SR * LENGTH), dtype=np.float32)
    for start, text, slot in zip(STARTS, lines, SLOT):
        speed = 1.0
        while True:
            audio, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-gb")
            assert sr == SR
            audio = np.trim_zeros(audio, "fb") if np.any(audio) else audio
            if len(audio) / SR <= slot or speed >= 1.35:
                break
            speed += 0.05
        print(f"{start:5.1f}s  {len(audio)/SR:4.2f}s  speed {speed:.2f}  {text[:40]}...")
        i = int(start * SR)
        track[i:i + len(audio)] += audio[: len(track) - i]
    return track


def note(freq, dur, amp):
    t = np.arange(int(SR * dur)) / SR
    wave = sum(np.sin(2 * np.pi * freq * h * t + h) / h**1.6 for h in (1, 2, 3))
    wave += 0.5 * np.sin(2 * np.pi * freq * 1.003 * t)  # slight detune = warmth
    env = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.5)  # slow swell
    return (amp * wave * np.clip(env, 0, 1)).astype(np.float32)


def bell(freq, dur=1.6, amp=0.05):
    t = np.arange(int(SR * dur)) / SR
    wave = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2.01 * t)
    return (amp * wave * np.exp(-t * 3.5) * np.minimum(1, t / 0.005)).astype(np.float32)


def music():
    track = np.zeros(int(SR * LENGTH), dtype=np.float32)
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    # Cmaj7 - Am7 - Fmaj7 - G6 - Cmaj7 ... (calm, hopeful), 4s per chord
    chords = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59]]
    for k, start in enumerate(np.arange(0, LENGTH, 4.0)):
        chord = chords[k % 4]
        for m in chord:
            seg = note(hz(m), 5.0, 0.035)
            i = int(start * SR)
            track[i:i + len(seg)] += seg[: len(track) - i]
        # gentle arpeggio on top, one note every 0.5s
        for j in range(8):
            m = chord[(j % 3) + 1] + 12
            seg = bell(hz(m))
            i = int((start + j * 0.5) * SR)
            track[i:i + len(seg)] += seg[: max(0, len(track) - i)]
    return track


def whoosh(at, dur=0.9, amp=0.12):
    """Filtered noise sweep for the push into the skin (clip 2)."""
    n = int(SR * dur)
    noise = np.random.default_rng(1).standard_normal(n).astype(np.float32)
    out, y = np.zeros(n, dtype=np.float32), 0.0
    for i in range(n):
        a = 0.02 + 0.25 * (i / n)  # opening low-pass
        y += a * (noise[i] - y)
        out[i] = y
    env = np.sin(np.pi * np.arange(n) / n) ** 2
    track = np.zeros(int(SR * LENGTH), dtype=np.float32)
    s = int(at * SR)
    track[s:s + n] = amp * out * env / (np.abs(out).max() + 1e-9)
    return track


def duck(music_track, vo, depth=0.45):
    """Lower the music while the voice is speaking."""
    env = np.convolve(np.abs(vo), np.ones(SR // 10) / (SR // 10), mode="same")
    env = np.clip(env / (env.max() + 1e-9) * 6, 0, 1)
    smooth = np.convolve(env, np.ones(SR // 4) / (SR // 4), mode="same")
    return music_track * (1 - depth * smooth)


def main():
    project, model, voices = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    voice = sys.argv[4] if len(sys.argv) > 4 else "bf_emma"
    lines = json.loads((project / "lines.json").read_text())
    assert len(lines) == 4, "need exactly 4 lines, one per 8s clip"
    out = project / "audio"
    out.mkdir(exist_ok=True)
    kokoro = Kokoro(model, voices)

    vo = voiceover(kokoro, voice, lines)
    vo *= 0.9 / np.abs(vo).max()
    bed = music() + whoosh(7.6)
    mix = vo + duck(bed, vo) * 1.0

    fade = int(SR * 1.2)
    mix[-fade:] *= np.linspace(1, 0, fade)
    mix *= 0.89 / np.abs(mix).max()

    sf.write(out / f"voiceover-only_{voice}.wav", vo, SR)
    sf.write(out / "music-only.wav", bed / np.abs(bed).max() * 0.7, SR)
    sf.write(out / f"full-mix_{voice}.wav", mix, SR)
    print("written to", out)


if __name__ == "__main__":
    main()
