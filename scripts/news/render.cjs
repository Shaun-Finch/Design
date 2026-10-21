// Render the weekly episode: studio.html frame by frame in headless Chromium, then ffmpeg -> MP4.
// Usage: node render.cjs OUT_DIR   (needs OUT_DIR/timeline.json and OUT_DIR/audio.wav)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const http = require('http');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
// serve this folder over local http: browsers refuse ES modules (three.js) from file://
function serve(root) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

(async () => {
  const out = path.resolve(process.argv[2] || 'out');
  const tl = JSON.parse(fs.readFileSync(path.join(out, 'timeline.json'), 'utf8'));
  const fps = tl.fps || 25, n = process.env.MAX_FRAMES ? Math.min(+process.env.MAX_FRAMES, Math.ceil(tl.duration * fps)) : Math.ceil(tl.duration * fps);
  const frames = path.join(out, 'frames');
  fs.rmSync(frames, { recursive: true, force: true });
  fs.mkdirSync(frames, { recursive: true });
  const srv = await serve(__dirname);
  const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.addInitScript(ep => { window.EP = ep; }, tl);
  await page.goto(`http://127.0.0.1:${srv.address().port}/studio.html`);
  await page.waitForFunction(() => window.STUDIO_READY, null, { timeout: 180000 });
  console.log('presenter:', await page.evaluate(() => window.STUDIO_READY));
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.setFrame(t), i / fps);
    await page.screenshot({ path: path.join(frames, String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 86 });
    if (i % 500 === 0) console.log(`frame ${i}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await page.evaluate(t => window.setFrame(t), Math.min(3, tl.duration / 2));
  await page.screenshot({ path: path.join(out, 'poster.jpg'), type: 'jpeg', quality: 82 });
  await browser.close(); srv.close();
  if (process.env.FRAMES_ONLY) return;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, '%05d.jpg'),
    '-i', path.join(out, 'audio.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', path.join(out, 'weekly.mp4')], { stdio: 'inherit' });
  const mb = fs.statSync(path.join(out, 'weekly.mp4')).size / 1e6;
  console.log(`rendered ${n} frames -> weekly.mp4 (${mb.toFixed(1)} MB) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (mb > 19) { console.error('video is over 19 MB (the CDN limit is 20 MB)'); process.exitCode = 1; }
})();
