/* VX-90 — boot */
(function () {
  'use strict';

  function showFatal(message) {
    console.error(message);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showFatal._t);
    showFatal._t = setTimeout(() => toast.classList.remove('show'), 9000);
  }

  /* Synthesise a plausible startup history so the demo chart is populated. */
  function seedTrend(ui, sim) {
    const N = ui.trend.max || 240;
    const n2 = [];
    const egt = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const ramp = 1 - Math.pow(1 - t, 3.2);
      const jitter = Math.sin(i * 0.83) * 0.35 + Math.sin(i * 2.1) * 0.18;
      n2.push(sim.n2 * (0.14 + 0.86 * ramp) + jitter * ramp);
      egt.push(sim.egt * (0.1 + 0.9 * ramp) + jitter * 2.4 * ramp);
    }
    ui.trend.n2 = n2;
    ui.trend.egt = egt;
    ui.drawChart();
  }

  function boot() {
    const canvas = document.getElementById('scene');
    if (!window.THREE) {
      showFatal('Three.js did not load. Check vendor/three.min.js.');
      return;
    }
    if (!canvas) {
      showFatal('Render canvas missing.');
      return;
    }

    let sim, engine, ui;
    try {
      sim = new window.EngineSim();
      engine = new window.Engine3D(canvas, sim);
      ui = new window.UI(sim, engine);
      ui.init();
    } catch (err) {
      showFatal('ENGINE START ABORTED · ' + (err && err.message ? err.message : 'unknown error'));
      return;
    }

    window.__vx = { sim, engine, ui };

    /* optional showcase states: index.html#demo, #demo-max, #demo-ab */
    const demo = location.hash.replace('#', '');
    if (demo.indexOf('demo') === 0) {
      sim.start();
      for (let i = 0; i < 420; i++) sim.update(1 / 60);
      if (demo.indexOf('ab') >= 0) {
        sim.setThrottle(100);
        for (let i = 0; i < 300; i++) sim.update(1 / 60);
        sim.setABArmed(true);
        for (let i = 0; i < 180; i++) sim.update(1 / 60);
      } else if (demo.indexOf('max') >= 0) {
        sim.setThrottle(100);
        for (let i = 0; i < 300; i++) sim.update(1 / 60);
      }
      engine.setCover(true);
      engine.snapCover(true);
      if (demo.indexOf('rear') >= 0) engine.setView('rear', true);
      else if (demo.indexOf('side') >= 0) engine.setView('side', true);
      else if (demo.indexOf('top') >= 0) engine.setView('top', true);
      else if (demo.indexOf('core') >= 0) engine.setView('core', true);
      else engine.setView('quarter', true);
      seedTrend(ui, sim);
      ui.syncReadouts(true);
    }

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      showFatal('WebGL CONTEXT LOST · RELOAD THE PAGE');
    });

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      try {
        sim.update(dt);
        engine.update(dt);
        ui.update(dt);
      } catch (err) {
        showFatal('SIMULATION FAULT · ' + (err && err.message ? err.message : 'unknown error'));
        console.error(err);
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.addEventListener('error', (e) => {
    if (e && e.message) showFatal('SCRIPT ERROR · ' + e.message);
  });
})();
