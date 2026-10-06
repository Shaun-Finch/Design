# virtual-spaces.uk

Static portfolio for Shaun Finch. One page, no build step, no dependencies.

```
index.html                 Design and motion work (CSS inlined)
branding.html              Branding — static image galleries (CSS inlined)
xovern.html                Xovern — AI security dashboard (work in progress)
ventryx.html               Ventryx — trading ideas scanner (work in progress)
scripts/build_markets.py   Builds Ventryx's markets.json (run by a GitHub Action)
data/sanctions.json        Sanctions data for Xovern, refreshed daily by a GitHub Action
scripts/build_sanctions.py Builds data/sanctions.json from the UK and OFAC lists
work/                      Videos and poster images
branding/                  Branding stills
Shaun_Finch_CV_2026.pdf
CNAME                      Custom domain for GitHub Pages
```

## Deploying

1. Create a public repo on GitHub — `virtual-spaces` is fine.
2. Push every file in this folder to the root of the repo.
3. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
4. It publishes at `https://<username>.github.io/virtual-spaces/` within a minute or two.

That `github.io` URL is a fully working public link. It does not depend on the
custom domain, and it keeps working after the custom domain is attached.

## Custom domain

`CNAME` already contains `virtual-spaces.uk`, so GitHub claims the domain once DNS
points at them. At the registrar:

| Type  | Host | Value |
|-------|------|-------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| CNAME | www  | `<username>.github.io` |

Then Settings → Pages → Custom domain → `virtual-spaces.uk` → tick **Enforce HTTPS**
once the certificate issues (can take an hour).

**Before any of that will work:** as of 20 Sept 2026 the domain's *delegation* is
broken at the .uk registry — Nominet's nameservers return SERVFAIL for
`virtual-spaces.uk` (a genuinely unregistered .uk domain returns NXDOMAIN instead,
so the domain is still registered). No records added in a DNS panel can resolve
until the nameserver delegation itself is repaired at the registrar. Fix the
delegation first, then apply the table above.

## Adding the videos

Each work slot shows a placeholder naming the file it wants. Filenames are listed in
`work/README.md`. Drop the file into `work/`, then replace the placeholder:

```html
<div class="frame awaiting t1">
  <b>work/liv-golf.mp4</b>
  <span>Drop this file into the work folder to fill the frame</span>
</div>
```

with:

```html
<div class="frame">
  <video controls preload="metadata" playsinline poster="work/liv-golf.jpg">
    <source src="work/liv-golf.mp4" type="video/mp4">
  </video>
</div>
```

GitHub rejects any single file over **100 MB** and wants the repo under about 1 GB.
Compress to roughly 8 MB per piece:

```bash
ffmpeg -i source.mov -vf scale=1920:-2 -c:v libx264 -crf 24 -preset slow -an work/liv-golf.mp4
```

If a piece has to stay high quality, host it on Vimeo or YouTube and swap the
`<video>` block for the embed instead.

## Editing text

Plain HTML — open the file and change the words. Pieces are `<figure class="piece">`
blocks; delete one and the grid closes up on its own.

## Xovern sanctions data

`.github/workflows/sanctions-data.yml` runs every day at 06:17 UTC (and on demand
from the Actions tab). It downloads the official UK Sanctions List (FCDO) and the
OFAC SDN list, writes `data/sanctions.json` and commits it if anything changed.
If a download or parse fails, the job fails and the previous file stays in place.

## Ventryx market data

`.github/workflows/markets-data.yml` runs `scripts/build_markets.py` every 15
minutes on weekdays during US market hours, plus once after the close. It
writes `markets.json` (and a daily `fundamentals.json` cache) to the
`market-data` branch, which `ventryx.html` reads from raw.githubusercontent.com,
so frequent refreshes never add commits to `main`. Data comes from Yahoo
Finance via yfinance and may be delayed.
