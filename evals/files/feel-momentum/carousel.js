// Horizontal carousel dragged by pointer. On release it should keep gliding and slow down.
export const MOMENTUM = { friction: 0.6, minVelocity: 0.5, maxGlidePx: 4000 };

export function attachCarousel(track) {
  let x = 0, v = 0, last = 0, dragging = false, raf = 0;
  const render = () => { track.style.transform = `translateX(${x}px)`; };
  const glide = () => {
    v *= MOMENTUM.friction; // per frame
    x += v;
    render();
    if (Math.abs(v) > MOMENTUM.minVelocity) raf = requestAnimationFrame(glide);
  };
  track.addEventListener("pointerdown", (e) => { dragging = true; last = e.clientX; v = 0; cancelAnimationFrame(raf); track.setPointerCapture(e.pointerId); });
  track.addEventListener("pointermove", (e) => { if (!dragging) return; v = e.clientX - last; last = e.clientX; x += v; render(); });
  track.addEventListener("pointerup", () => { dragging = false; v = Math.max(-MOMENTUM.maxGlidePx, Math.min(MOMENTUM.maxGlidePx, v)); raf = requestAnimationFrame(glide); });
}
