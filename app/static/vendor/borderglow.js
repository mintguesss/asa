/*
 * BorderGlow 的滑鼠追蹤與配色 —— 移植自 React Bits（https://reactbits.dev，作者 David Haz）
 * 原始檔：src/content/Components/BorderGlow/BorderGlow.jsx，授權：MIT + Commons Clause
 * 計算方式照原樣，改成對整頁所有 .border-glow-card 生效的事件委派。
 */
(function () {
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;   // 觸控不追蹤（Asa 的修改）
    const card = e.target.closest && e.target.closest('.border-glow-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const dx = e.clientX - rect.left - cx, dy = e.clientY - rect.top - cy;
    let kx = Infinity, ky = Infinity;
    if (dx !== 0) kx = cx / Math.abs(dx);
    if (dy !== 0) ky = cy / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let degrees = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    if (degrees < 0) degrees += 360;
    card.style.setProperty('--edge-proximity', (edge * 100).toFixed(3));
    card.style.setProperty('--cursor-angle', degrees.toFixed(3) + 'deg');
  }, { passive: true });

  const GRADIENT_POSITIONS = ['80% 55%', '69% 34%', '8% 6%', '41% 38%', '86% 85%', '82% 18%', '51% 4%'];
  const GRADIENT_KEYS = ['--gradient-one', '--gradient-two', '--gradient-three', '--gradient-four', '--gradient-five', '--gradient-six', '--gradient-seven'];
  const COLOR_MAP = [0, 1, 2, 0, 1, 2, 1];

  /* colors：三個色碼；glowHsl：像 "190 100 75" 的 HSL 數值 */
  window.setBorderGlowPalette = function (colors, glowHsl, intensity = 1) {
    const root = document.documentElement.style;
    for (let i = 0; i < 7; i++) {
      const c = colors[Math.min(COLOR_MAP[i], colors.length - 1)];
      root.setProperty(GRADIENT_KEYS[i], `radial-gradient(at ${GRADIENT_POSITIONS[i]}, ${c} 0px, transparent 50%)`);
    }
    root.setProperty('--gradient-base', `linear-gradient(${colors[0]} 0 100%)`);
    const [h, s, l] = glowHsl.split(/\s+/);
    const opacities = [100, 60, 50, 40, 30, 20, 10], keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
    opacities.forEach((o, i) => root.setProperty(`--glow-color${keys[i]}`, `hsl(${h}deg ${s}% ${l}% / ${Math.min(o * intensity, 100)}%)`));
  };
})();
