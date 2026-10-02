// Gizmo Deck Builder: turns a deck copied from Gizmo into 1920x1080 slide frames on the current page.
figma.showUI(__html__, { width: 380, height: 460 });

const BLUE = { r: 26 / 255, g: 102 / 255, b: 232 / 255 };
const INK = { r: 22 / 255, g: 22 / 255, b: 26 / 255 };
const BODY = { r: 58 / 255, g: 58 / 255, b: 66 / 255 };
const MUTE = { r: 107 / 255, g: 107 / 255, b: 116 / 255 };
const WHITE = { r: 1, g: 1, b: 1 };
const PALE = { r: 220 / 255, g: 232 / 255, b: 1 };

function text(parent, chars, opts) {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: opts.bold ? 'Bold' : 'Regular' };
  t.characters = chars;
  t.fontSize = opts.size;
  t.fills = [{ type: 'SOLID', color: opts.color }];
  if (opts.lineHeight) t.lineHeight = { value: opts.lineHeight, unit: 'PERCENT' };
  if (opts.spacing) t.paragraphSpacing = opts.spacing;
  parent.appendChild(t);
  t.x = opts.x; t.y = opts.y;
  t.resize(opts.w, t.height);
  t.textAutoResize = 'HEIGHT';
  return t;
}

figma.ui.onmessage = async (msg) => {
  if (!msg || msg.type !== 'build') return;
  let deck;
  try { deck = JSON.parse(msg.json); } catch (e) { figma.ui.postMessage({ type: 'error', text: 'That isn’t a Gizmo deck. In Gizmo, open the deck and press “Copy for Figma”.' }); return; }
  if (!deck || !Array.isArray(deck.slides) || !deck.slides.length) { figma.ui.postMessage({ type: 'error', text: 'The deck has no slides.' }); return; }
  try {
    await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
    await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  } catch (e) { figma.ui.postMessage({ type: 'error', text: 'Couldn’t load the Inter font.' }); return; }

  const page = figma.currentPage;
  let startX = 0;
  for (const n of page.children) startX = Math.max(startX, n.x + n.width + 200);
  const frames = [];
  const total = deck.slides.length;
  deck.slides.forEach((s, i) => {
    const f = figma.createFrame();
    f.name = String(i + 1).padStart(2, '0') + ' · ' + (s.title || 'Slide');
    f.resize(1920, 1080);
    f.x = startX + i * 2020; f.y = 0;
    const hero = s.layout === 'title' || s.layout === 'end';
    f.fills = [{ type: 'SOLID', color: hero ? BLUE : WHITE }];
    page.appendChild(f);
    if (hero) {
      if (s.layout === 'title') text(f, 'GIZMO DECK', { x: 140, y: 300, w: 1640, size: 28, bold: true, color: PALE });
      text(f, s.title || '', { x: 140, y: s.layout === 'title' ? 370 : 420, w: 1640, size: 112, bold: true, color: WHITE, lineHeight: 105 });
      if (s.bullets && s.bullets[0]) text(f, s.bullets[0], { x: 140, y: s.layout === 'title' ? 640 : 640, w: 1640, size: 40, color: PALE });
    } else {
      const bar = figma.createRectangle(); bar.resize(96, 12); bar.x = 140; bar.y = 140; bar.cornerRadius = 6; bar.fills = [{ type: 'SOLID', color: BLUE }]; f.appendChild(bar);
      const head = text(f, s.title || '', { x: 140, y: 180, w: 1640, size: 76, bold: true, color: INK, lineHeight: 110 });
      const lines = (s.bullets || []).map((b, k) => (s.layout === 'agenda' ? (k + 1) + '.  ' : '•  ') + b).join('\n');
      if (lines) text(f, lines, { x: 140, y: head.y + head.height + 70, w: 1640, size: 44, color: BODY, lineHeight: 140, spacing: 28 });
      text(f, (i + 1) + ' / ' + total, { x: 1580, y: 990, w: 200, size: 24, color: MUTE });
    }
    frames.push(f);
  });
  figma.currentPage.selection = frames;
  figma.viewport.scrollAndZoomIntoView(frames);
  figma.notify('Gizmo built ' + frames.length + ' slides');
  figma.ui.postMessage({ type: 'done', count: frames.length });
};
