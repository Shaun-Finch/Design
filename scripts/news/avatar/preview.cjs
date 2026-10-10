// node preview.cjs ROOT  -> for each ROOT/<Name>/Export/<Name>_facial.fbx renders ROOT/<Name>.png and ROOT/<Name>.json
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const http = require('http');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
function serve() {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      const f = decodeURIComponent(q.url.split('?')[0]);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
(async () => {
  const root = path.resolve(process.argv[2]);
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}`;
  const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const b = await chromium.launch(launch);
  for (const name of fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'Export')))) {
    const exp = path.join(root, name, 'Export');
    const fbx = fs.readdirSync(exp).filter(f => /_facial\.fbx$/i.test(f))[0] || fs.readdirSync(exp).filter(f => /\.fbx$/i.test(f))[0];
    if (!fbx) continue;
    const p = await b.newPage({ viewport: { width: 800, height: 800 } });
    p.on('pageerror', e => console.log(name, 'pageerror', e.message));
    await p.goto(`${base}${path.join(__dirname, 'preview.html')}?m=${encodeURIComponent(base + path.join(exp, fbx))}&tex=${encodeURIComponent(base + path.join(root, name, 'Textures'))}`);
    await p.waitForFunction(() => window.READY, null, { timeout: 240000 });
    const info = await p.evaluate(() => window.READY);
    fs.writeFileSync(path.join(root, name + '.json'), info);
    await p.screenshot({ path: path.join(root, name + '.png') });
    const d = info.startsWith('ERR') ? null : JSON.parse(info);
    console.log('==', name, fbx, d ? `bones ${d.bones.length}, head ${d.head}, height ${d.height.toFixed(1)}` : info);
    if (d) {
      console.log('   face bones:', d.bones.filter(x => /jaw|lip|eye|lid|mouth|brow|teeth|tongue|cheek|nose/i.test(x)).join(', '));
      for (const [k, v] of Object.entries(d.morphs)) console.log('   morphs', k, v.length, v.slice(0, 80).join(','));
      console.log('   materials:', d.materials.join(', '));
    }
    await p.close();
  }
  await b.close(); srv.close();
})();
