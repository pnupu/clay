// Opens a modal with a scale animation driven by a spring.
export const OPEN = { stiffness: 420, damping: 9, mass: 1, fromScale: 0.6 };

export function openModal(el) {
  let s = OPEN.fromScale, v = 0, raf = 0;
  el.hidden = false;
  const step = () => {
    const dt = 1 / 60;
    const a = (-OPEN.stiffness * (s - 1) - OPEN.damping * v) / OPEN.mass;
    v += a * dt;
    s += v * dt;
    el.style.transform = `scale(${s})`;
    el.style.opacity = String(Math.min(1, Math.max(0, (s - OPEN.fromScale) / (1 - OPEN.fromScale))));
    if (Math.abs(s - 1) > 0.001 || Math.abs(v) > 0.001) raf = requestAnimationFrame(step);
    else el.style.transform = "scale(1)";
  };
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(step);
}
