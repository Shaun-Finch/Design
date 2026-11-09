# Rules for working on this site

This is Shaun Finch's portfolio. It is a static site on GitHub Pages
(shaun-finch.github.io/Design). Plain HTML, CSS and a little JavaScript. No build step.

## Never change without asking

- The main URL, `shaun-finch.github.io/Design`. It is printed on the CV.
- The CV link, `cv/Shaun_Finch_CV_2026_UX_AI_Workflows.pdf`.
- Contact details. Never publish a phone number.
- Client logos and names in "Worked with". Add or remove only when Shaun asks.

## How to work

- Do only what the request asks. Do not tidy, restyle or reword other parts of a page.
- Work on a branch and open a pull request. Shaun reviews and merges. Nothing goes live without that.
- Never invent results, numbers, quotes or client names. Leave `[TODO: …]` and tell Shaun.
- Health demos use synthetic data. Label them as concepts, not medical devices, not for clinical use.
- Credit any licensed image. Do not copy copyrighted images. Label AI-generated video.
- Concept work for real brands carries an "unofficial concept" label.
- API keys live in GitHub Secrets, never in the code or the chat.

## House style

- Dark theme. Tokens are in each page's `:root`: `--bg #0E0E10`, `--surface #161618`,
  `--ink #ECECEE`, `--mute #A3A3AA`, `--line #2A2A2E`, `--accent #F0562A`.
- Fonts: Figtree for text, JetBrains Mono for labels.
- Plain English, first person, short sentences.
- Project tiles share one pattern: linked heading, Project / Type / Role row,
  Problem / What I did / Outcome lines, and one call to action.

## Checks before a pull request

1. Open every changed page at desktop (1440 × 900) and mobile (390 × 844).
2. No sideways scroll, no console errors, no broken links or anchors.
3. Run an accessibility check (axe) and fix serious issues.
4. Read the diff once more against the request. Remove anything that wasn't asked for.
