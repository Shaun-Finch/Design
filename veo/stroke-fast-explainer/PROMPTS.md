# Stroke (FAST) explainer: Veo 3 prompts (30s, 9:16)

**Idea:** "How to spot a stroke in seconds." Stroke is a genuine, common emergency.
Knowing the FAST signs (Face, Arms, Speech, Time) is what gets people help in time, so
this is something viewers can actually use and share. The signs show on the face,
which suits the close-up, chest-up style of the black-eye video.

**Policy-safe:** no blood, no wounds, no injury, no procedures, no brands, no real people,
no children. The face droop is mild and the anatomy is a clean diagram.

| Beat | Black eye video | This video |
|---|---|---|
| Hook | Ball hits her face | Her smile suddenly droops on one side |
| Anatomy | Grid zoom, then skin cutaway | Grid over her head, then brain cutaway: an artery blocks, a region dims |
| Fix | Ice pack, water, warm towel | FAST check: she can't keep both arms raised |
| Warning | Headache, so get it checked | She calls 999 straight away |
| Payoff | Smile + OK hand, gym background | Smile + OK hand, gym background |

4 clips × 8s = 32s. Trim to 30s.

## How to generate in Flow

1. Use **Ingredients to video** with `character-reference.jpg` on clips 1, 3 and 4.
   For clip 2, use `eye-grid-style-reference.jpg` + `anatomy-style-reference.jpg`.
2. If Flow rejects a reference image, use the text prompt alone. It describes her in full.
3. Use **Veo 3 Fast** for test versions to save credits.
4. The prompts ask for **no voice and no music**, because the audio track is already made.

---

## Clip 1: Hook (0–8s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, slow gentle push-in. A woman in her mid-30s with a tousled shoulder-length dark brown bob, brown eyes, light freckles and natural makeup, wearing a navy zip-up track jacket over a white t-shirt, centred chest-up framing.

She smiles warmly at the camera. Then, subtly, the right side of her face droops slightly: the corner of her mouth and her right eyelid sag a little, so her smile becomes lopsided. Her expression turns confused and uncertain, and she touches her cheek with her fingertips. Subtle and realistic, not exaggerated.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 2: Anatomy (8–16s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused lighting, powder-blue colour palette.

Start with a close-up of the side of a woman's head and temple, styled like the grid reference image, as a glowing thin white holographic wireframe grid traces across her skin and hair. The camera pushes smoothly through into a clean, educational 3D medical visualisation of the brain, styled like the anatomy reference: soft pink brain tissue with a branching network of translucent pale-blue and red arteries flowing with gentle pulses of light. A small dark clot drifts along one artery and lodges in a narrow branch; the glowing flow beyond it stops, and the region of brain it fed slowly fades from soft pink to dull grey. Calm, clinical, diagram-like, nothing graphic.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 3: FAST check (16–24s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, static medium shot from the waist up. The same woman: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles, wearing a red hoodie, the right side of her mouth drooping slightly.

She slowly raises both arms straight out in front of her at shoulder height, palms down. Her left arm stays up, but her right arm gradually drifts downward on its own. She looks at her drifting arm with a worried, confused expression and tries to speak, her mouth moving slowly and unevenly.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 4: Call 999 + payoff (24–32s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, shallow depth of field. The same woman: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles.

First shot: wearing an orange t-shirt against a plain powder-blue backdrop, she holds a plain smartphone (no logos) to her ear with a focused, urgent but calm expression, speaking quickly. Then a soft cross-dissolve to her fully recovered, wearing a navy sports vest over a white t-shirt in a softly blurred pale-blue gym changing room; she smiles warmly at camera with an even, symmetrical smile and makes an OK hand gesture.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

---

## Audio (ready-made)

`audio/stroke-audio_bf_emma.mp3` (or `.wav`) is the **finished 30s track**: AI voiceover +
soft music bed + a whoosh going into the brain shot, timed to the 8s cuts. Put the 4
clips back to back, put the track underneath, trim to 30s, export.
`stroke-audio_bf_isabella.*` is the same track with a different voice.

| Time | Voiceover |
|---|---|
| 0:00 | "Her smile suddenly drops on one side. This could be a stroke, and every minute counts." |
| 0:08 | "A stroke happens when blood flow to part of the brain is blocked, and brain cells start to die within minutes." |
| 0:16 | "Remember the word fast. Face drooping. Arm weakness. Speech slurred. Time to call nine nine nine." |
| 0:24 | "Don't wait to see if it passes. Calling fast saves lives." |

999 is the UK number. For a US audience, change it to "nine one one" in `lines.json` and
re-run `python3 ../make_audio.py . <kokoro-v1.0.onnx> <voices-v1.0.bin> bf_emma`.

**On-screen text idea (add in your editor):** F – Face · A – Arms · S – Speech · T – Time,
popping up one at a time in clip 3.

## If Veo misbehaves

- **Face droop too extreme or missing:** change to "her smile is slightly uneven on one side".
- **Clip 4 won't do two shots:** generate each half separately and cut between them.
- **Veo adds a voice or music anyway:** mute the clip audio.

**Medical note:** FAST and "call 999 immediately, even if symptoms go away" are NHS and
Stroke Association guidance. Add an "educational only, not medical advice" line in the caption.
