/* VX-90 — HUD bindings, gauges and trend recorder */
(function () {
  'use strict';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class UI {
    constructor(sim, engine) {
      this.sim = sim;
      this.engine = engine;
      this.cache = {};
      this.last = {};
      this.keys = new Set();
      this._cautionSig = null;
      this._toastTimer = null;
      this._clockLast = '';
      this.domTimer = 0;
      this.chartTimer = 0;
      this.statusLast = '';
      this.detailLast = '';
      this.trend = { n2: [], egt: [], max: 240 };
      this.camBtns = [];
    }

    el(id) {
      if (!this.cache[id]) this.cache[id] = document.getElementById(id);
      return this.cache[id];
    }

    init() {
      this.camBtns = Array.from(document.querySelectorAll('.cam-btn'));
      this.bind();
      this.sim.onEvent = (e) => this.addLog(e);

      this.addLog({ text: 'TEST CELL ONLINE · SENSORS CALIBRATED', level: 'info', time: 0 });
      this.addLog({ text: 'NACELLE INSTALLED · AIRFLOW TRACE ACTIVE', level: 'info', time: 0 });
      this.addLog({ text: 'READY FOR START · FUEL VALVE CLOSED', level: 'good', time: 0 });

      this.syncReadouts(true);
      this.drawChart();
    }

    /* ── wiring ───────────────────────────────────────────────── */

    bind() {
      const on = (id, ev, fn) => {
        const node = this.el(id);
        if (node) node.addEventListener(ev, fn);
      };

      on('startBtn', 'click', () => this.start());
      on('stopBtn', 'click', () => this.stop());
      on('resetBtn', 'click', () => this.reset());

      on('fuelToggle', 'click', () => {
        this.sim.toggleFuel();
        this.syncReadouts(true);
      });
      on('abToggle', 'click', () => {
        this.sim.toggleAB();
        this.syncReadouts(true);
      });

      on('throttle', 'input', (e) => {
        this.sim.setThrottle(e.target.value);
        this.updateThrottleUI();
      });
      on('thrDown', 'click', () => { this.sim.nudgeThrottle(-5); this.syncReadouts(true); });
      on('thrUp', 'click', () => { this.sim.nudgeThrottle(5); this.syncReadouts(true); });
      on('thrIdle', 'click', () => {
        this.sim.setThrottle(0);
        this.syncReadouts(true);
      });
      on('thrMil', 'click', () => {
        this.sim.setThrottle(100);
        this.syncReadouts(true);
      });

      on('coverToggle', 'click', () => {
        const open = this.engine.toggleCover();
        this.addLog({
          text: open ? 'NACELLE COVER UNLATCHED · OPENING' : 'NACELLE COVER CLOSING',
          level: 'info', time: this.sim.clock
        });
        this.syncReadouts(true);
      });
      on('flowToggle', 'click', () => {
        this.engine.setFlow(!this.engine.flowOn);
        this.addLog({
          text: this.engine.flowOn ? 'AIRFLOW STREAMLINES ON' : 'AIRFLOW STREAMLINES OFF',
          level: 'info', time: this.sim.clock
        });
        this.syncReadouts(true);
      });
      on('labelsToggle', 'click', () => {
        this.engine.setLabels(!this.engine.labelsOn);
        this.syncReadouts(true);
      });

      for (const b of this.camBtns) {
        b.addEventListener('click', () => {
          this.engine.setView(b.dataset.cam);
          this.syncReadouts(true);
        });
      }

      on('uiToggle', 'click', () => this.toggleUI());

      window.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.code === 'Space' && document.activeElement && document.activeElement.tagName === 'BUTTON') {
          document.activeElement.blur();
        }
        if (e.code === 'Space') {
          e.preventDefault();
          this.primaryAction();
          return;
        }
        if (e.code === 'KeyW' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'ArrowDown') {
          e.preventDefault();
          this.keys.add(e.code);
          return;
        }
        if (e.repeat) return;
        switch (e.code) {
          case 'KeyF': this.sim.toggleFuel(); break;
          case 'KeyB': this.sim.toggleAB(); break;
          case 'KeyC': {
            const open = this.engine.toggleCover();
            this.addLog({
              text: open ? 'NACELLE COVER UNLATCHED · OPENING' : 'NACELLE COVER CLOSING',
              level: 'info', time: this.sim.clock
            });
            break;
          }
          case 'KeyA': this.engine.setFlow(!this.engine.flowOn); break;
          case 'KeyL': this.engine.setLabels(!this.engine.labelsOn); break;
          case 'KeyH': this.toggleUI(); break;
          case 'Digit1': this.engine.setView('quarter'); break;
          case 'Digit2': this.engine.setView('side'); break;
          case 'Digit3': this.engine.setView('front'); break;
          case 'Digit4': this.engine.setView('rear'); break;
          case 'Digit5': this.engine.setView('top'); break;
          case 'Digit6': this.engine.setView('core'); break;
          case 'Digit7': this.engine.setView('orbit'); break;
          default: return;
        }
        this.syncReadouts(true);
      });

      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.keys.clear());
    }

    start() {
      if (this.sim.start()) {
        this.sim.setThrottle(0);
        this.el('throttle').value = '0';
        this.updateThrottleUI();
        this.syncReadouts(true);
      }
    }

    stop() {
      this.sim.stop();
      this.syncReadouts(true);
    }

    primaryAction() {
      if (this.sim.state === 'running' || this.sim.state === 'crank') this.stop();
      else this.start();
    }

    reset() {
      this.sim.reset();
      this.sim.setThrottle(0);
      this.engine.setCover(false);
      this.engine.setView('quarter', false);
      this.el('log').innerHTML = '';
      this.trend.n2 = [];
      this.trend.egt = [];
      this.last = {};
      this._cautionSig = null;
      this.addLog({ text: 'SIMULATION RESET · COLD AND DARK', level: 'info', time: 0 });
      this.syncReadouts(true);
      this.drawChart();
    }

    toggleUI() {
      document.body.classList.toggle('ui-hidden');
    }

    /* ── event log ────────────────────────────────────────────── */

    clockString(seconds) {
      const s = Math.max(0, Math.floor(seconds || 0));
      const m = Math.floor(s / 60);
      return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }

    addLog(event) {
      const log = this.el('log');
      if (!log) return;
      const row = document.createElement('div');
      row.className = 'log-entry ' + (event.level || 'info');
      const time = document.createElement('time');
      time.textContent = this.clockString(event.time != null ? event.time : this.sim.clock);
      const text = document.createElement('span');
      text.textContent = event.text;
      row.appendChild(time);
      row.appendChild(text);
      log.appendChild(row);
      while (log.children.length > 8) log.removeChild(log.firstChild);
    }

    toast(message) {
      const el = this.el('toast');
      if (!el) return;
      el.textContent = message;
      el.classList.add('show');
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
    }

    /* ── per-frame ────────────────────────────────────────────── */

    update(dt) {
      /* held throttle keys */
      if (this.keys.size) {
        let delta = 0;
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) delta += 1;
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) delta -= 1;
        if (delta !== 0) {
          this.sim.nudgeThrottle(delta * 38 * dt);
        }
      }

      this.domTimer += dt;
      if (this.domTimer >= 0.1) {
        this.domTimer = 0;
        this.syncReadouts(false);
      }

      this.chartTimer += dt;
      if (this.chartTimer >= 0.25) {
        this.chartTimer = 0;
        this.trend.n2.push(this.sim.n2);
        this.trend.egt.push(this.sim.egt);
        if (this.trend.n2.length > this.trend.max) this.trend.n2.shift();
        if (this.trend.egt.length > this.trend.max) this.trend.egt.shift();
        this.drawChart();
      }
    }

    /* ── readouts ─────────────────────────────────────────────── */

    setText(id, text) {
      if (this.last[id] === text) return;
      this.last[id] = text;
      const node = this.el(id);
      if (node) node.textContent = text;
    }

    fmt(value, digits) {
      const d = digits == null ? 0 : digits;
      const v = Number.isFinite(value) ? value : 0;
      return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    updateThrottleUI() {
      const v = clamp(this.sim.throttle, 0, 100);
      const slider = this.el('throttle');
      if (slider) {
        if (Math.abs(Number(slider.value) - v) > 0.4) slider.value = String(v);
        slider.style.setProperty('--fill', v.toFixed(1) + '%');
      }
      this.setText('throttleVal', String(Math.round(v)));
    }

    syncReadouts(force) {
      const sim = this.sim;
      if (force) { this.last = {}; this.statusLast = ''; this.detailLast = ''; }

      /* status */
      const chip = this.el('statusChip');
      if (chip) {
        chip.dataset.state = sim.state;
        const label = sim.statusLabel;
        if (this.statusLast !== label) {
          this.statusLast = label;
          chip.querySelector('span').textContent = label;
        }
      }
      this.setText('clock', this.clockString(sim.clock));

      const detail = sim.statusDetail;
      if (this.detailLast !== detail.text) {
        this.detailLast = detail.text;
        const ps = this.el('powerStatus');
        if (ps) {
          ps.className = 'power-status ' + (detail.level || '');
          ps.innerHTML = '<i></i><span></span>';
          ps.querySelector('span').textContent = detail.text;
        }
      }

      const running = sim.state === 'running' || sim.state === 'crank';
      const startBtn = this.el('startBtn');
      if (startBtn) startBtn.disabled = running;
      const stopBtn = this.el('stopBtn');
      if (stopBtn) stopBtn.disabled = sim.state === 'off';

      /* throttle */
      this.updateThrottleUI();

      /* spool gauges */
      const arc = (id, pct) => {
        const node = this.el(id);
        if (!node) return;
        const len = clamp(pct / 105, 0, 1) * 226.2;
        node.style.strokeDasharray = len.toFixed(1) + ' 302';
      };
      arc('n1Arc', sim.n1);
      arc('n2Arc', sim.n2);
      this.setText('n1Val', sim.n1.toFixed(1));
      this.setText('n2Val', sim.n2.toFixed(1));

      /* temperatures */
      this.setText('titVal', this.fmt(sim.tit));
      this.setText('egtVal', this.fmt(sim.egt));
      this.setText('t3Val', this.fmt(sim.t3));
      this.setText('oilTempVal', this.fmt(sim.oilTemp));

      const width = (id, pct) => {
        const node = this.el(id);
        if (node) node.style.width = clamp(pct, 0, 100).toFixed(1) + '%';
      };
      width('titBar', (sim.tit / 1250) * 100);
      width('egtBar', (sim.egt / 1100) * 100);
      width('t3Bar', (sim.t3 / 550) * 100);
      width('oilTempBar', (sim.oilTemp / 180) * 100);

      const high = (id, on) => {
        const bar = this.el(id);
        const meter = bar && bar.closest('.meter');
        if (meter) meter.classList.toggle('high', !!on);
      };
      high('titBar', sim.tit > 1120);
      high('egtBar', sim.egt > 960);
      high('t3Bar', sim.t3 > 510);
      high('oilTempBar', sim.oilTemp > 132);

      /* performance */
      this.setText('thrustVal', this.fmt(sim.thrust));
      this.setText('fuelVal', this.fmt(sim.fuelFlow));
      this.setText('airVal', this.fmt(sim.airflow, 1));
      this.setText('tsfcVal', sim.tsfc > 0.02 ? sim.tsfc.toFixed(2) : '—');
      this.setText('oilPressVal', this.fmt(sim.oilPress, 1));
      this.setText('oilFlowVal', this.fmt(sim.oilFlow, 1));
      this.setText('oilHeatVal', this.fmt(sim.oilHeat));
      this.setText('nozzleVal', this.fmt(sim.nozzle * 100));
      this.setText('abTempVal', this.fmt(sim.abTemp));
      this.setText('farVal', sim.far > 0.0005 ? sim.far.toFixed(3) : '0.000');

      /* fuel valve */
      const fuelBtn = this.el('fuelToggle');
      if (fuelBtn) {
        fuelBtn.classList.toggle('active', sim.fuelOn);
        fuelBtn.setAttribute('aria-pressed', String(sim.fuelOn));
      }
      this.setText('fuelState', sim.fuelOn ? 'OPEN' : 'CLOSED');

      /* afterburner */
      const abBtn = this.el('abToggle');
      if (abBtn) {
        abBtn.classList.toggle('active', sim.abArmed);
        abBtn.classList.toggle('lit', sim.abActive);
        abBtn.setAttribute('aria-pressed', String(sim.abArmed));
      }
      let abLabel = 'SAFE';
      if (sim.abActive) abLabel = 'LIT';
      else if (sim.abArmed) abLabel = 'ARMED';
      this.setText('abState', abLabel);

      const hint = this.el('abHint');
      if (hint) {
        let text;
        let cls = 'ab-hint';
        if (sim.abActive) {
          text = 'AUGMENTOR LIT · NOZZLE ' + Math.round(sim.nozzle * 100) + '% OPEN';
          cls += ' live';
        } else if (sim.state !== 'running') {
          text = 'Select after high power to light the augmentor.';
        } else if (sim.abInhibited) {
          text = 'INHIBIT · ' + (sim.abReason || 'A/B GATE NOT MET');
          cls += ' inhibit';
        } else if (sim.abArmed) {
          text = 'ARMED · ADVANCE THROTTLE ABOVE 85% N1';
          cls += ' live';
        } else {
          text = 'Select after high power to light the augmentor.';
        }
        if (this.last.abHintText !== text) {
          this.last.abHintText = text;
          hint.textContent = text;
          hint.className = cls;
        }
      }

      /* visual toggles */
      const coverOpen = this.engine.coverTarget > 0.5;
      const coverBtn = this.el('coverToggle');
      if (coverBtn) {
        coverBtn.classList.toggle('active', coverOpen);
        coverBtn.setAttribute('aria-pressed', String(coverOpen));
      }
      let coverLabel;
      if (coverOpen && this.engine.coverT < 0.94) coverLabel = 'REMOVING';
      else if (!coverOpen && this.engine.coverT > 0.06) coverLabel = 'INSTALLING';
      else coverLabel = coverOpen ? 'REMOVED' : 'INSTALLED';
      this.setText('coverState', coverLabel);

      this.el('flowToggle').classList.toggle('active', this.engine.flowOn);
      this.el('flowToggle').setAttribute('aria-pressed', String(this.engine.flowOn));
      this.setText('flowState', this.engine.flowOn ? 'ON' : 'OFF');

      this.el('labelsToggle').classList.toggle('active', this.engine.labelsOn);
      this.el('labelsToggle').setAttribute('aria-pressed', String(this.engine.labelsOn));
      this.setText('labelsState', this.engine.labelsOn ? 'ON' : 'OFF');

      /* camera buttons */
      const activeCam = this.engine.autoOrbit ? 'orbit' : this.engine.activeCam;
      for (const b of this.camBtns) b.classList.toggle('active', b.dataset.cam === activeCam);

      /* lamps */
      const setLamp = (id, mode) => {
        const node = this.el(id);
        if (node) node.className = 'lamp' + (mode ? ' ' + mode : '');
      };
      const oilBad = sim.warnings.find((w) => w.id === 'oilp' || w.id === 'oilt');
      setLamp('lampFuel', sim.fuelOn ? (sim.combustion ? 'on' : 'warn') : '');
      setLamp('lampIgn', sim.igniter ? 'on' : (sim.state === 'crank' ? 'warn' : ''));
      setLamp('lampAB', sim.abActive ? 'on' : (sim.abArmed ? 'warn' : ''));
      setLamp('lampOil', oilBad ? oilBad.level : (sim.oilPress > 20 ? 'on' : ''));

      /* cautions */
      const warns = sim.warnings;
      const sig = warns.map((w) => w.id + w.label + w.level).join('|');
      if (sig !== this._cautionSig) {
        this._cautionSig = sig;
        const box = this.el('cautions');
        if (box) {
          if (!warns.length) {
            box.innerHTML = '<div class="nominal"><i></i>ALL SYSTEMS NOMINAL</div>';
          } else {
            box.innerHTML = warns.map((w) =>
              '<div class="caution-item ' + w.level + '"><i></i>' + w.label + '</div>'
            ).join('');
          }
        }
      }
      this.setText('cautionCount', warns.length + ' ACTIVE');

      const mc = this.el('masterCaution');
      if (mc) {
        const danger = warns.some((w) => w.level === 'danger');
        mc.classList.toggle('danger', danger);
        mc.classList.toggle('active', warns.length > 0 && !danger);
      }
    }

    /* ── trend chart ──────────────────────────────────────────── */

    drawChart() {
      const c = this.el('trend');
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const w = Math.max(100, Math.round(rect.width));
      const h = Math.max(40, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      /* grid */
      g.lineWidth = 1;
      g.strokeStyle = 'rgba(126,186,220,0.085)';
      g.beginPath();
      for (let i = 1; i < 4; i++) {
        const y = (h * i) / 4;
        g.moveTo(0, y + 0.5);
        g.lineTo(w, y + 0.5);
      }
      for (let i = 1; i < 6; i++) {
        const x = (w * i) / 6;
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, h);
      }
      g.stroke();

      /* EGT limit */
      g.strokeStyle = 'rgba(255,98,98,0.3)';
      g.setLineDash([3, 3]);
      g.beginPath();
      const limitY = h - (1010 / 1150) * h;
      g.moveTo(0, limitY);
      g.lineTo(w, limitY);
      g.stroke();
      g.setLineDash([]);

      const n = this.trend.n2.length;
      if (n < 2) {
        g.fillStyle = 'rgba(150,192,216,0.38)';
        g.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        g.textAlign = 'center';
        g.fillText('AWAITING TELEMETRY', w / 2, h / 2 + 3);
        g.textAlign = 'left';
        return;
      }
      const step = w / (this.trend.max - 1);
      const x0 = w - (n - 1) * step;

      const line = (arr, scale, color, fill) => {
        g.beginPath();
        for (let i = 0; i < arr.length; i++) {
          const x = x0 + i * step;
          const y = h - clamp(arr[i] / scale, 0, 1) * (h - 2) - 1;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.lineWidth = 1.25;
        g.strokeStyle = color;
        g.shadowColor = color;
        g.shadowBlur = 4;
        g.stroke();
        g.shadowBlur = 0;
        if (fill) {
          const grad = g.createLinearGradient(0, 0, 0, h);
          grad.addColorStop(0, fill);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.lineTo(x0 + (arr.length - 1) * step, h);
          g.lineTo(x0, h);
          g.closePath();
          g.fillStyle = grad;
          g.fill();
        }
      };

      line(this.trend.egt, 1150, '#ffb454', null);
      line(this.trend.n2, 110, '#9aa9ff', 'rgba(154,169,255,0.14)');
    }
  }

  window.UI = UI;
})();
