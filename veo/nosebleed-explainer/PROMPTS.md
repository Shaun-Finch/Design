# Nosebleed explainer: Veo 3 prompts (30s, 9:16)

**Idea:** "You've been stopping nosebleeds wrong." Most people tilt their head back.
That is the wrong thing to do, because the blood runs down the throat. The right fix
is to lean forward and pinch the soft part of the nose. It's useful, it corrects a
myth (which helps people share it), and it fits the black-eye video's structure:

| Beat | Black eye video | This video |
|---|---|---|
| Hook | Ball hits her face | Nosebleed starts, she tilts her head back (the mistake) |
| Anatomy | Grid zoom on eye, then a skin cutaway with leaking vessels | Grid zoom on nose, then a cutaway of nasal lining with a burst vessel |
| Fix | Ice pack, water, warm towel | Lean forward, pinch, cold pack on the bridge |
| Warning | Headache, so get it checked | Still bleeding after 15 minutes or after a head knock: get help |
| Payoff | Smile + OK hand, gym background | Smile + OK hand, gym background |

4 clips × 8s = 32s. Trim to 30s in your editor.

## How to generate in Flow

1. Use **Ingredients to video** (or "Frames to video" with the image as the first frame)
   and attach `character-reference.jpg` to every clip, so it's the same woman.
2. For clip 2, also attach `anatomy-style-reference.jpg`.
3. Use **Veo 3 Fast** for test versions to save credits. Switch to Quality for final
   clips only if Fast looks off.
4. The prompts tell Veo to make **no voice and no music**, because the finished
   audio track is already made (see *Audio* below).
5. Paste each prompt in full. Veo doesn't remember the earlier clips, so the style
   block is repeated on purpose.

---

## Clip 1: Hook (0–8s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, slow gentle push-in. Same woman as the reference: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles, natural makeup, wearing a heather-grey crew-neck sweatshirt, centred chest-up framing.

She is looking at camera when a small, thin trickle of blood runs from one nostril onto her upper lip (subtle, not graphic). She touches it with a fingertip, looks surprised, then instinctively tilts her head back and grimaces, swallowing uncomfortably.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 2: Anatomy (8–16s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, powder-blue colour palette.

Start with an extreme close-up of the same woman's nose (reference image) as a glowing thin white holographic wireframe grid traces over the skin. The camera pushes smoothly through the skin into a clean 3D medical cross-section of the nasal lining, styled like the anatomy reference: soft pink layered tissue, rounded cream cells, a branching network of translucent pale-blue and red blood vessels just beneath the surface. One tiny red vessel near the front ruptures and small red droplets drift out and pool slowly.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 3: The fix (16–24s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, slow gentle push-in. Same woman as the reference: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles, wearing a red hoodie, centred chest-up framing.

She leans her head slightly forward and calmly pinches the soft lower part of her nose, just below the bony bridge, with her thumb and index finger, breathing through her mouth. Then with her other hand she presses a blue gel cold pack wrapped in a grey cloth gently against the bridge of her nose; faint cold vapour drifts from the pack. Her expression relaxes.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 4: Warning + payoff (24–32s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, shallow depth of field. Same woman as the reference: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles.

First shot: wearing an orange t-shirt against a plain powder-blue backdrop, she looks concerned, frowns and presses her fingertips to her temple. Then a soft cross-dissolve to her wearing a navy sports vest over a white t-shirt in a softly blurred pale-blue gym changing room; she smiles warmly at camera and makes an OK hand gesture.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

---

## Audio (ready-made, no ElevenLabs needed)

`audio/nosebleed-audio_bf_emma.mp3` (or `.wav`) is the **finished 30s track**: AI
voiceover + soft music bed + a whoosh going into the anatomy shot, already timed to
the 8s clip cuts. Drop the 4 clips on a timeline back to back, put this track under
them, trim to 30s, export. That's it.

| Time | Voiceover |
|---|---|
| 0:00 | "Got a nosebleed? Don't tilt your head back. The blood just runs down your throat." |
| 0:08 | "Most nosebleeds start at the front of the nose, where tiny blood vessels sit right under the surface." |
| 0:16 | "Lean forward, pinch the soft part of your nose, and hold for ten to fifteen minutes. A cold pack helps too." |
| 0:24 | "Still bleeding after fifteen minutes, or after a knock to the head? Get medical help. Otherwise... you've got this." |

Other files in `audio/`:
- `nosebleed-audio_bf_isabella.*`: same track, different British female voice
- `voiceover-only_*.wav` / `music-only.wav`: separate stems if you want to adjust levels

The voice is Kokoro (open-source, Apache-2.0) and the music is generated by
`make_audio.py`, so there's nothing to license. To change the script, edit `LINES`
in that file and re-run it.

## If Veo misbehaves

- **Blood gets blocked or looks too graphic:** change it to "a small red mark under one nostril".
- **Clip 4 won't do two shots:** split it into two 4s clips, or generate each half separately.
- **Veo adds a voice or music anyway:** mute the clip audio in your editor. The audio track below covers everything.

**Medical note:** the advice follows standard first-aid guidance (lean forward, pinch the
soft part for 10–15 min, get help if it doesn't stop or follows a head injury). It's worth
adding an "educational only, not medical advice" line in the caption.
