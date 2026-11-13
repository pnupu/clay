// Drag a card; on release it springs back to its resting place.
export const SPRING = { stiffness: 120, damping: 4, mass: 1 };

export function attachSnapBack(card) {
  let x = 0, v = 0, dragging = false, startX = 0, raf = 0;
  const render = () => { card.style.transform = `translateX(${x}px)`; };
  const step = () => {
    const dt = 1 / 60;
    const a = (-SPRING.stiffness * x - SPRING.damping * v) / SPRING.mass;
    v += a * dt;
    x += v * dt;
    render();
    if (Math.abs(x) > 0.1 || Math.abs(v) > 0.1) raf = requestAnimationFrame(step);
    else { x = 0; v = 0; render(); }
  };
  card.addEventListener("pointerdown", (e) => { dragging = true; startX = e.clientX - x; cancelAnimationFrame(raf); card.setPointerCapture(e.pointerId); });
  card.addEventListener("pointermove", (e) => { if (dragging) { x = e.clientX - startX; render(); } });
  card.addEventListener("pointerup", () => { dragging = false; v = 0; raf = requestAnimationFrame(step); });
}
