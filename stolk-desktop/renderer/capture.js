// Area picker over the frozen screenshot. Sends the box as fractions of the screen, or null on Esc.
const shot = document.getElementById('shot');
const box = document.getElementById('box');
const dim = document.getElementById('dim');
let start = null;
window.stolk.onShot((url) => { shot.src = url; });
const rectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
document.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; box.style.display = 'block'; dim.style.display = 'none'; draw(e); });
document.addEventListener('pointermove', (e) => { if (start) draw(e); });
document.addEventListener('pointerup', (e) => {
  if (!start) return;
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  start = null;
  window.stolk.cropDone({ x: r.x / innerWidth, y: r.y / innerHeight, w: r.w / innerWidth, h: r.h / innerHeight });
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.stolk.cropDone(null); });
function draw(e) {
  const r = rectFrom(start, { x: e.clientX, y: e.clientY });
  Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}
