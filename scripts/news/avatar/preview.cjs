// node preview.cjs DIR  -> renders every DIR/*.glb to DIR/<name>.png (serves files over local http: browsers
// refuse ES modules from file://)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve(root) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
      if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
(async () => {
  const dir = path.resolve(process.argv[2]), root = path.resolve('/');
  const srv = await serve(root), port = srv.address().port;
  const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const b = await chromium.launch(launch);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.glb'));
  if (!files.length) console.log('no .glb files in', dir);
  for (const f of files) {
    const p = await b.newPage({ viewport: { width: 800, height: 800 } });
    p.on('console', m => console.log(f, m.text())); p.on('pageerror', e => console.log(f, 'pageerror', e.message));
    await p.goto(`http://127.0.0.1:${port}${path.join(__dirname, 'preview.html')}?m=${encodeURIComponent(`http://127.0.0.1:${port}${path.join(dir, f)}`)}`);
    await p.waitForFunction(() => window.READY, null, { timeout: 180000 });
    console.log(f, await p.evaluate(() => window.READY));
    await p.screenshot({ path: path.join(dir, f.replace('.glb', '.png')) });
    await p.close();
  }
  await b.close(); srv.close();
})();
