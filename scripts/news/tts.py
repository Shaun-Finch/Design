#!/usr/bin/env python3
"""Voice the weekly episode and work out its timing.

Reads OUT_DIR/episode.json, speaks each segment with Kokoro (open-weight, Apache-2.0 text-to-speech that
runs on a normal CPU), falling back to espeak-ng if Kokoro isn't available. Writes:
  audio.wav     the whole voice track
  timeline.json segment start/end times and a 0..1 mouth-opening value for every video frame
  captions.vtt  subtitles for the page's video player

Usage: tts.py OUT_DIR
"""
import json
import os
import re
import subprocess
import sys
import wave

import numpy as np

SR = 24000
FPS = 25
GAP = 0.45            # pause between segments, seconds
VOICE = os.environ.get("NEWS_VOICE") or "bf_emma"   # Kokoro British English voice


# Kokoro phoneme symbols -> the 15 standard visemes (sil PP FF TH DD kk CH SS nn RR aa E I O U), indices 0-14
VIS = {"p": 1, "b": 1, "m": 1, "f": 2, "v": 2, "θ": 3, "ð": 3, "t": 4, "d": 4, "ɾ": 4, "k": 5, "g": 5, "ɡ": 5, "ŋ": 5,
       "ʧ": 6, "ʤ": 6, "ʃ": 6, "ʒ": 6, "s": 7, "z": 7, "n": 8, "l": 8, "ɹ": 9, "r": 9, "ɑ": 10, "æ": 10, "a": 10,
       "ʌ": 10, "ɐ": 10, "I": 10, "W": 10, "ɛ": 11, "e": 11, "A": 11, "ə": 11, "ɜ": 11, "ɚ": 11, "i": 12, "ɪ": 12,
       "j": 12, "ɔ": 13, "o": 13, "O": 13, "Q": 13, "Y": 13, "ɒ": 13, "u": 14, "ʊ": 14, "w": 14, "h": 0}


def kokoro_say(pipe, text):
    """Audio plus [(start_s, end_s, phonemes)] per word, when Kokoro reports word timings."""
    chunks, words, off = [], [], 0.0
    for res in pipe(text, voice=VOICE, speed=1.02):
        a = res[2] if isinstance(res, tuple) else getattr(res, "audio", None)
        if a is None:
            continue
        a = a.detach().cpu().numpy() if hasattr(a, "detach") else np.asarray(a)
        a = a.astype(np.float32).reshape(-1)
        for tk in (getattr(res, "tokens", None) or []):
            st, en, ph = getattr(tk, "start_ts", None), getattr(tk, "end_ts", None), getattr(tk, "phonemes", "") or ""
            if st is not None and en is not None and en > st and ph:
                words.append((off + float(st), off + float(en), ph))
        chunks.append(a)
        off += len(a) / SR
    return (np.concatenate(chunks) if chunks else np.zeros(1, np.float32)), words


def viseme_track(words, n_frames, mouth):
    """Per frame [[viseme, weight], ...]: each word's phonemes spread evenly over its duration, scaled by loudness."""
    track = [[] for _ in range(n_frames)]
    for st, en, ph in words:
        seq = [VIS[c] for c in ph if c in VIS]
        if not seq:
            continue
        step = (en - st) / len(seq)
        for k, v in enumerate(seq):
            a, b = st + k * step, st + (k + 1) * step
            for f in range(max(0, int(a * FPS)), min(n_frames, int(np.ceil(b * FPS)))):
                track[f].append(v)
    out = []
    for f, vs in enumerate(track):
        if not vs:
            out.append([])
            continue
        w = max(0.35, min(1.0, mouth[f] * 1.3 if f < len(mouth) else 0.6))
        main = max(set(vs), key=vs.count)
        out.append([[main, round(w, 2)]] + ([[vs[-1], round(w * 0.4, 2)]] if vs[-1] != main else []))
    return out


def espeak_say(text, tmp):
    subprocess.run(["espeak-ng", "-v", "en-gb", "-s", "165", "-w", tmp, text], check=True)
    with wave.open(tmp) as w:
        sr, n = w.getframerate(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    # resample to SR with linear interpolation (good enough for speech)
    x = np.linspace(0, len(a) - 1, int(len(a) * SR / sr))
    return np.interp(x, np.arange(len(a)), a).astype(np.float32)


def mouth_envelope(audio):
    hop = SR // FPS
    n = int(np.ceil(len(audio) / hop))
    rms = np.array([float(np.sqrt(np.mean(audio[i * hop:(i + 1) * hop] ** 2) + 1e-12)) for i in range(n)])
    ref = np.percentile(rms[rms > 1e-4], 90) if (rms > 1e-4).any() else 1.0
    m = np.clip((rms / ref) ** 0.8, 0, 1)
    m[rms < ref * 0.12] = 0
    sm = np.copy(m)  # light smoothing so the mouth doesn't flicker
    for i in range(1, len(m)):
        sm[i] = 0.55 * m[i] + 0.45 * sm[i - 1]
    return [round(float(v), 3) for v in sm]


def vtt_time(t):
    h, r = divmod(t, 3600)
    m, s = divmod(r, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:06.3f}"


def main():
    out = sys.argv[1]
    ep = json.load(open(os.path.join(out, "episode.json")))
    try:
        from kokoro import KPipeline
        pipe = KPipeline(lang_code="b")
        say, engine = (lambda txt: kokoro_say(pipe, txt)), f"kokoro/{VOICE}"
    except Exception as e:
        print(f"Kokoro unavailable ({e}); using espeak-ng", file=sys.stderr)
        say, engine = (lambda txt: (espeak_say(txt, os.path.join(out, "_tmp.wav")), [])), "espeak-ng"
    parts, t, cues, words = [], 0.6, [], []
    parts.append(np.zeros(int(0.6 * SR), np.float32))
    for seg in ep["segments"]:
        a, wds = say(seg["text"])
        dur = len(a) / SR
        words += [(t + s0, t + s1, ph) for s0, s1, ph in wds]
        seg["start"], seg["end"] = round(t, 3), round(t + dur, 3)
        # captions: split into sentences, time them by length
        sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", seg["text"]) if x.strip()]
        total = sum(len(x) for x in sents) or 1
        c0 = t
        for x in sents:
            d = dur * len(x) / total
            cues.append((c0, c0 + d, x))
            c0 += d
        parts += [a, np.zeros(int(GAP * SR), np.float32)]
        t += dur + GAP
    parts.append(np.zeros(int(1.0 * SR), np.float32))
    audio = np.concatenate(parts)
    audio = audio / max(1e-6, float(np.max(np.abs(audio)))) * 0.89
    with wave.open(os.path.join(out, "audio.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((audio * 32767).astype(np.int16).tobytes())
    ep["segments"][0]["start"] = 0.0
    mouth = mouth_envelope(audio)
    tl = {"fps": FPS, "duration": round(len(audio) / SR, 3), "engine": engine, "mouth": mouth,
          "visemes": viseme_track(words, len(mouth), mouth), "wordTimings": len(words),
          "segments": [{k: s[k] for k in ("id", "title", "tag", "bar", "graphic", "start", "end")} for s in ep["segments"]],
          "strip": ep["strip"], "clock": ep["clock"], "ticker": ep["ticker"]}
    json.dump(tl, open(os.path.join(out, "timeline.json"), "w"))
    with open(os.path.join(out, "captions.vtt"), "w") as fh:
        fh.write("WEBVTT\n\n")
        for i, (a, b, x) in enumerate(cues, 1):
            fh.write(f"{i}\n{vtt_time(a)} --> {vtt_time(b)}\n{x}\n\n")
    json.dump(ep, open(os.path.join(out, "episode.json"), "w"), ensure_ascii=False, indent=1)
    print(f"voiced {len(ep['segments'])} segments with {engine}: {tl['duration']:.1f}s")


if __name__ == "__main__":
    main()
