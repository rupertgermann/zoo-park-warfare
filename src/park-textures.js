// Canvas-drawn textures for the park: grass, water, sign atlas, building windows. Pure functions, no scene state.
import * as THREE from 'three';

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- canvases ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function grassTexture() {
  const [c, g] = canvas(1024, 1024);
  const r = mulberry32(5);
  g.fillStyle = '#5cbc3c'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 8; i++) { // mowing stripes
    g.fillStyle = i % 2 ? 'rgba(40,150,40,0.16)' : 'rgba(170,240,90,0.12)';
    g.fillRect(0, i * 128, 1024, 128);
  }
  for (let i = 0; i < 70; i++) { // soft blotches
    const x = r() * 1024, y = r() * 1024, rad = 40 + r() * 110;
    for (const [ox, oy] of [[0, 0], [-1024, 0], [1024, 0], [0, -1024], [0, 1024]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      const dark = r() < 0.5;
      gr.addColorStop(0, dark ? 'rgba(30,130,50,0.22)' : 'rgba(190,245,100,0.2)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  }
  g.lineCap = 'round';
  for (let i = 0; i < 1400; i++) { // grass ticks
    const x = r() * 1024, y = r() * 1024;
    g.strokeStyle = r() < 0.5 ? 'rgba(35,120,40,0.45)' : 'rgba(200,250,110,0.5)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 5, y - 5 - r() * 7); g.stroke();
  }
  const t = tex(c, true);
  t.repeat.set(1 / 20, 1 / 20);
  return t;
}

export function waterTexture() {
  const [c, g] = canvas(256, 256);
  const r = mulberry32(9);
  g.fillStyle = '#cfe9f9'; g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = r() * 256, y = r() * 256, w = 14 + r() * 26;
    g.strokeStyle = i % 3 ? 'rgba(255,255,255,0.95)' : 'rgba(150,205,235,0.9)';
    g.lineWidth = 3 + r() * 2;
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, w, w * 0.28, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
      }
    }
  }
  return tex(c, true);
}

export const SIGN = { fuettern: 0, angeln: 1, imbiss: 2, spiel: 3, rasen: 4, menu: 5 };
export function signAtlas() {
  const [c, g] = canvas(2048, 1024);
  const font = (px) => `900 ${px}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  const fit = (txt, px, maxW) => { g.font = font(px); const w = g.measureText(txt).width; return w > maxW ? Math.floor(px * maxW / w) : px; };
  const cell = (i, bg, border, bw) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 256;
    g.save(); g.translate(x, y);
    g.fillStyle = border; g.fillRect(0, 0, 512, 256);
    g.fillStyle = bg; g.fillRect(bw, bw, 512 - bw * 2, 256 - bw * 2);
    return () => g.restore();
  };
  const text = (txt, cx, cy, px, color, maxW, shadow) => {
    const p = fit(txt, px, maxW);
    g.font = font(p); g.textAlign = 'center'; g.textBaseline = 'middle';
    if (shadow) { g.fillStyle = shadow; g.fillText(txt, cx + 3, cy + 4); }
    g.fillStyle = color; g.fillText(txt, cx, cy);
  };
  const noSign = (cx, cy, rad) => {
    g.strokeStyle = '#d4202a'; g.lineWidth = rad * 0.22;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(cx - rad * 0.7, cy - rad * 0.7); g.lineTo(cx + rad * 0.7, cy + rad * 0.7); g.stroke();
  };
  let done = cell(SIGN.fuettern, '#fffdf5', '#d4202a', 14);
  g.fillStyle = '#e0a35a'; g.beginPath(); g.ellipse(100, 128, 62, 34, -0.3, 0, 7); g.fill();
  g.strokeStyle = '#a8692c'; g.lineWidth = 5;
  for (const dx of [-26, 0, 26]) { g.beginPath(); g.moveTo(100 + dx - 6, 110 + dx * 0.1); g.lineTo(100 + dx + 8, 134 + dx * 0.1); g.stroke(); }
  noSign(100, 128, 76);
  text('Füttern', 318, 94, 84, '#b01a24', 300); text('verboten!', 318, 170, 84, '#b01a24', 300);
  done();
  done = cell(SIGN.angeln, '#fffdf5', '#d4202a', 14);
  g.fillStyle = '#2f9be0'; g.beginPath(); g.ellipse(100, 128, 52, 28, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(140, 128); g.lineTo(176, 98); g.lineTo(176, 158); g.fill();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(70, 120, 7, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(68, 120, 3.5, 0, 7); g.fill();
  noSign(110, 128, 78);
  text('Angeln', 340, 94, 84, '#b01a24', 270); text('verboten!', 340, 170, 84, '#b01a24', 270);
  done();
  done = cell(SIGN.imbiss, '#d62828', '#ffd23f', 16);
  g.fillStyle = '#ffd23f';
  for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(40 + i * 40, 36, 7, 0, 7); g.fill(); g.beginPath(); g.arc(40 + i * 40, 222, 7, 0, 7); g.fill(); }
  text('IMBISS', 256, 110, 136, '#fff6e0', 430, '#7a0f16');
  text('Pommes · Eis · Wurst', 256, 190, 44, '#ffd23f', 420);
  done();
  done = cell(SIGN.spiel, '#2e9d4e', '#fff', 12);
  text('Spielplatz', 256, 100, 96, '#fff', 440, '#1a6a33');
  text('Eltern haften für ihre Kinder', 256, 188, 30, '#fff7c2', 440);
  done();
  done = cell(SIGN.rasen, '#fffdf5', '#d4202a', 14);
  text('Rasen betreten', 256, 90, 62, '#b01a24', 440); text('verboten!', 256, 172, 82, '#b01a24', 440);
  done();
  done = cell(SIGN.menu, '#2b3a32', '#9a6a3a', 16);
  g.textAlign = 'left';
  const lines = [['Currywurst', '3,50'], ['Pommes rot-weiß', '2,80'], ['Eis (3 Kugeln)', '1,50'], ['Brot: nur für Enten!', '']];
  lines.forEach(([a, b], i) => {
    g.font = '700 34px "Comic Sans MS", "Marker Felt", cursive'; g.fillStyle = i === 3 ? '#ffd23f' : '#f4f4ea';
    g.textAlign = 'left'; g.fillText(a, 38, 70 + i * 52);
    g.textAlign = 'right'; g.fillText(b, 474, 70 + i * 52);
  });
  done();
  return tex(c, false);
}
export const signUV = (cellIdx) => {
  const c = cellIdx % 4, r = Math.floor(cellIdx / 4);
  return [c / 4, 1 - (r + 1) / 4, (c + 1) / 4, 1 - r / 4]; // u0 v0 u1 v1
};

export function windowTexture() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  const r = mulberry32(3);
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const lit = r() < 0.3;
      g.fillStyle = lit ? '#fff0a8' : '#7d96b4';
      g.fillRect(14 + i * 56, 34 + j * 46, 42, 32);
      g.fillStyle = '#ffffff';
      g.fillRect(14 + i * 56 + 19, 34 + j * 46, 4, 32);
    }
  }
  const t = tex(c, true);
  t.anisotropy = 4;
  return t;
}
