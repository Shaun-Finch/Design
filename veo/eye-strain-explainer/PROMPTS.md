# Eye strain explainer: Veo 3 prompts (30s, 9:16)

**Idea:** "Why your eyes hurt after screens, and the 20-20-20 fix." Nearly everyone has
it, the fix is free and takes 20 seconds, and it reuses the eye-grid shot from the
black-eye video.

**Built to stay inside Google's content policy:** no blood, no injuries, no wounds, no
medical procedures, no brands or logos, no real or famous people, no children. Only one
adult, calm everyday actions, and a clean anatomy diagram.

| Beat | Black eye video | This video |
|---|---|---|
| Hook | Ball hits her face | She's scrolling her phone, rubs her tired eyes |
| Anatomy | Grid zoom on eye, then skin cutaway | Grid zoom on eye, then eye cutaway: focusing muscle tense, tear film drying |
| Fix | Ice pack, water, warm towel | Looks far into the distance, blinks slowly, relaxes |
| Warning | Headache, so get it checked | Headache / blurry vision, so book an eye test |
| Payoff | Smile + OK hand, gym background | Smile + OK hand, gym background |

4 clips × 8s = 32s. Trim to 30s.

## How to generate in Flow

1. Use **Ingredients to video** and attach `character-reference.jpg` to clips 1, 3 and 4.
   For clip 2, attach `eye-grid-style-reference.jpg` and `anatomy-style-reference.jpg`.
2. If Flow rejects a reference image, generate that clip from the text prompt alone.
   The prompt describes the woman in full.
3. Use **Veo 3 Fast** for test versions to save credits.
4. The prompts ask for **no voice and no music**, because the audio track is already made.

---

## Clip 1: Hook (0–8s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, slow gentle push-in. A woman in her mid-30s with a tousled shoulder-length dark brown bob, brown eyes, light freckles and natural makeup, wearing a lavender crew-neck sweatshirt, centred chest-up framing.

She is looking down at a plain smartphone held at chest height (no logos, screen not visible), its cool glow lighting her face. She squints, blinks heavily, then lowers the phone slightly and gently rubs her closed eyes with her fingertips, looking tired.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 2: Anatomy (8–16s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused lighting, powder-blue colour palette.

Start with an extreme close-up of a woman's brown eye, styled like the eye reference image, as a glowing thin white holographic wireframe grid traces across the eye and surrounding skin. The camera pushes smoothly into a clean, educational 3D medical cross-section of the eye, styled like the anatomy reference: translucent pale-blue and soft pink layered structures, a clear glassy lens, and the ring-shaped focusing muscle around it glowing a soft warm orange to show it is tense. On the front surface of the eye, a thin glistening tear layer slowly thins and loses its shine. Calm, clinical, diagram-like, nothing graphic.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 3: The fix (16–24s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, plain soft powder-blue backdrop, shallow depth of field, slow gentle push-in. The same woman: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles, wearing a red hoodie, centred chest-up framing.

She lowers a plain smartphone out of frame, lifts her head and turns her gaze to look far into the distance past the camera, as soft warm daylight falls across her face. She blinks slowly and fully a few times, her shoulders drop and her face visibly relaxes into a calm, gentle expression.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

## Clip 4: Warning + payoff (24–32s)

```
Vertical 9:16 video. Hyper-realistic, smooth airbrushed digital-render look, soft diffused studio lighting, shallow depth of field. The same woman: mid-30s, tousled shoulder-length dark brown bob, brown eyes, light freckles.

First shot: wearing an orange t-shirt against a plain powder-blue backdrop, she squints slightly, frowns and presses her fingertips to her temple as if she has a mild headache. Then a soft cross-dissolve to her wearing a navy sports vest over a white t-shirt in a softly blurred pale-blue gym changing room; she smiles warmly at camera and makes an OK hand gesture.

No dialogue, no narration, no music. No text, no captions, no subtitles.
```

---

## Audio (ready-made)

`audio/eye-strain-audio_bf_emma.mp3` (or `.wav`) is the **finished 30s track**: AI
voiceover + soft music bed + a whoosh going into the anatomy shot, timed to the 8s cuts.
Put the 4 clips back to back, put the track underneath, trim to 30s, export.
`eye-strain-audio_bf_isabella.*` is the same track with a different voice.

| Time | Voiceover |
|---|---|
| 0:00 | "Eyes tired, dry and sore after a day on screens? You're not imagining it." |
| 0:08 | "When you stare at a screen, you blink far less, and the tiny muscles that focus your eyes stay locked tight." |
| 0:16 | "Try the twenty, twenty, twenty rule. Every twenty minutes, look at something twenty feet away for twenty seconds." |
| 0:24 | "Headaches or blurry vision that won't go away? Book an eye test. Otherwise... your eyes will thank you." |

To change the script, edit `lines.json`, then run
`python3 ../make_audio.py . <kokoro-v1.0.onnx> <voices-v1.0.bin> bf_emma`.

## If Veo misbehaves

- **Clip 4 won't do two shots:** generate each half as its own clip and cut between them.
- **The phone shows a logo or readable screen:** add "the phone is a plain matte black rectangle".
- **Veo adds a voice or music anyway:** mute the clip audio. The track covers everything.

**Medical note:** the 20-20-20 rule and reduced blinking at screens are standard
optometry advice. Add an "educational only, not medical advice" line in the caption.
