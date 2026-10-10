#!/usr/bin/env python3
"""Write latest.json for the page: where this week's video lives and its chapters and transcript.
The video is served through jsDelivr pinned to the exact commit, so a new episode never hits a stale cache.
Usage: manifest.py OUT_DIR COMMIT_SHA VIDEO_FILE > latest.json
"""
import json
import sys

out, sha, fname = sys.argv[1], sys.argv[2], sys.argv[3]
ep = json.load(open(f"{out}/episode.json"))
tl = json.load(open(f"{out}/timeline.json"))
cdn = f"https://cdn.jsdelivr.net/gh/Shaun-Finch/Design@{sha}/"
print(json.dumps({
    "weekEnding": ep["weekEnding"], "published": ep["published"], "writer": ep.get("writer"), "voice": tl.get("engine"),
    "duration": tl["duration"], "video": cdn + fname, "poster": cdn + "poster.jpg", "captions": cdn + "captions.vtt",
    "chapters": [{"title": s["title"], "start": s["start"]} for s in ep["segments"]],
    "transcript": [{"title": s["title"], "text": s["text"]} for s in ep["segments"]],
}, ensure_ascii=False))
