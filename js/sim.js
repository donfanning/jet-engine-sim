/* VX-90 — engine simulation model
   Reduced-order model inspired by the Pratt & Whitney F100-PW-100/229 class
   low-bypass afterburning turbofan. Numbers are illustrative, not certified. */

(function () {
  'use strict';

  const AMBIENT = 15;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const approach = (current, target, dt, tau) => {
    if (tau <= 0) return target;
    const k = 1 - Math.exp(-dt / tau);
    return current + (target - current) * k;
  };
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  class EngineSim {
    constructor() {
      this.onEvent = null;
      this.ramjetEnabled = true;
      this.mode = 'turbo'; // turbo | ramjet | combined
      this.reset();
    }

    reset() {
      this.state = 'off';        // off | crank | running | shutdown | failed
      this.n1 = 0;
      this.n2 = 0;
      this.throttle = 0;
      this.fuelOn = false;
      this.combustion = false;
      this.abArmed = false;
      this.ab = 0;
      this.abActive = false;
      this.abInhibited = false;
      this.abReady = false;
      this.abReason = '';

      this.tit = AMBIENT;
      this.egt = AMBIENT;
      this.t3 = AMBIENT;
      this.abTemp = AMBIENT;
      this.oilTemp = 18;
      this.oilPress = 0;
      this.oilFlow = 0;
      this.oilHeat = 0;

      this.fuelFlow = 0;
      this.airflow = 0;
      this.bypassFlow = 0;
      this.coreFlow = 0;
      this.thrust = 0;
      this.tsfc = 0;
      this.far = 0;
      this.nozzle = 0.16;

      this.starter = false;
      this.igniter = false;
      this.crankTime = 0;
      this.lightTimer = 0;
      this.relightTimer = 0;
      this.startSpike = 0;

      this.clock = 0;
      this.runTime = 0;
      this.warnings = [];
      this.lastEvent = null;
      this._abLit = false;
      this._cutoutLogged = false;
      this._flameoutLogged = false;
      this._crankFailLogged = false;
      this._idleLogged = false;
    }

    /* ── commands ─────────────────────────────────────────────── */

    emit(text, level) {
      const event = { text, level: level || 'info', time: this.clock };
      this.lastEvent = event;
      if (this.onEvent) this.onEvent(event);
    }

    start() {
      if (this.state === 'running' || this.state === 'crank') return false;
      if (this.state === 'shutdown' && this.n2 > 20) {
        this.emit('START INHIBITED — SPOOL STILL TURNING', 'warn');
        return false;
      }
      this.state = 'crank';
      this.starter = true;
      this.igniter = true;
      this.fuelOn = true;
      this.throttle = 0;
      this.abArmed = false;
      this.ab = 0;
      this.crankTime = 0;
      this.lightTimer = 0;
      this.relightTimer = 0;
      this._cutoutLogged = false;
      this._crankFailLogged = false;
      this.emit('STARTER ENGAGED · FUEL VALVE OPEN', 'info');
      return true;
    }

    stop() {
      if (this.state === 'off') return;
      if (this.state === 'failed') {
        this.failedReset();
        return;
      }
      const wasCrank = this.state === 'crank';
      this.fuelOn = false;
      this.igniter = false;
      this.starter = false;
      this.combustion = false;
      this.abArmed = false;
      this.ab = 0;
      this.abActive = false;
      this.state = 'shutdown';
      this._cutoutLogged = false;
      this.emit(wasCrank ? 'START ABORTED · STARTER OFF' : 'FUEL CUTOFF · ENGINE SHUTDOWN', 'warn');
    }

    failedReset() {
      this.state = 'off';
      this.fuelOn = false;
      this.igniter = false;
      this.starter = false;
      this.crankTime = 0;
      this.emit('START FAULT CLEARED', 'info');
    }

    setFuel(on) {
      on = !!on;
      if (on === this.fuelOn) return;
      this.fuelOn = on;
      if (on) {
        this.emit('FUEL VALVE OPEN', 'info');
      } else {
        this.emit('FUEL VALVE CLOSED', 'warn');
        if (this.combustion) this.flameout();
      }
      if (on && this.state === 'shutdown') this.relightTimer = 0;
    }

    toggleFuel() { this.setFuel(!this.fuelOn); }

    flameout() {
      if (this._flameoutLogged) return;
      this._flameoutLogged = true;
      this.combustion = false;
      this.state = 'shutdown';
      this.starter = false;
      this.igniter = false;
      this.abArmed = false;
      this.ab = 0;
      this.abActive = false;
      this._cutoutLogged = false;
      this.emit('FLAMEOUT — COMBUSTION LOST', 'bad');
    }

    setThrottle(value) {
      this.throttle = clamp(Number(value) || 0, 0, 100);
    }

    nudgeThrottle(delta) {
      this.setThrottle(this.throttle + delta);
    }

    setABArmed(on) {
      on = !!on;
      if (on) {
        if (this.state !== 'running' || !this.combustion) {
          this.emit('A/B INHIBIT — ENGINE NOT RUNNING', 'warn');
          return false;
        }
        this.abArmed = true;
        this.emit('AFTERBURNER ARMED', 'info');
      } else {
        if (this.abArmed) this.emit('AFTERBURNER DISARMED', 'info');
        this.abArmed = false;
        this.ab = 0;
        this.abActive = false;
      }
      return true;
    }

    toggleAB() { return this.setABArmed(!this.abArmed); }

    /* ── internal transitions ─────────────────────────────────── */

    lightOff(relight) {
      this.combustion = true;
      this.state = 'running';
      this.igniter = true;
      this.startSpike = 110;
      this._idleLogged = false;
      this._cutoutLogged = false;
      this._flameoutLogged = false;
      this.emit(relight ? 'RELIGHT · COMBUSTION RESTORED' : 'LIGHT-OFF · COMBUSTION STABLE', 'good');
    }

    /* ── per-frame update ─────────────────────────────────────── */

    update(dt) {
      dt = clamp(dt, 0, 0.1);
      this.clock += dt;
      const thr = this.throttle / 100;

      /* state machine */
      if (this.state === 'crank') {
        this.crankTime += dt;
        if (this.fuelOn && this.igniter && this.n2 > 11 && !this.combustion) {
          this.lightTimer += dt;
          if (this.lightTimer >= 0.55) this.lightOff(false);
        }
        if (this.crankTime > 16 && !this.combustion) {
          if (!this._crankFailLogged) {
            this._crankFailLogged = true;
            this.state = 'failed';
            this.starter = false;
            this.igniter = false;
            this.emit(this.fuelOn ? 'START FAILED — NO LIGHT' : 'START FAILED — FUEL OFF', 'bad');
          }
        }
      }

      if (this.state === 'running') {
        this.runTime += dt;
        if (this.starter && this.n2 > 49) {
          this.starter = false;
          if (!this._cutoutLogged) {
            this._cutoutLogged = true;
            this.emit('STARTER CUTOUT · N2 50%', 'info');
          }
        }
        if (this.n2 > 46) this.igniter = false;
        if (!this._idleLogged && this.n2 > 55 && this.throttle < 3) {
          this._idleLogged = true;
          this.emit('IDLE STABLE · READY FOR THROTTLE', 'good');
        }
        if (!this.fuelOn && this.combustion) this.flameout();
      }

      if (this.state === 'shutdown') {
        if (this.fuelOn && this.n2 > 22 && !this.combustion) {
          this.relightTimer += dt;
          if (this.relightTimer > 0.9) this.lightOff(true);
        }
        if (!this.fuelOn) this.relightTimer = 0;
        if (this.n2 < 2.5 && !this.combustion) {
          this.state = 'off';
          this.n2 = 0;
          this.emit('ENGINE SECURED', 'info');
        }
      }

      if (this.state === 'failed') {
        this.starter = false;
        this.igniter = false;
      }

      if (this.state === 'off') {
        this.starter = false;
        this.igniter = false;
      }

      /* spools - F100 class: N1 fan/LPC driven by LPT, N2 HP compressor/HPT */
      let targetN2 = 0;
      let tauN2 = 3.8;
      if (this.state === 'crank') {
        targetN2 = 22;
        tauN2 = 1.28;
      } else if (this.state === 'running') {
        targetN2 = 62 + 40 * thr + 1.8 * this.ab;
        tauN2 = 0.9 + 1.6 * (1 - thr);
      } else if (this.state === 'shutdown') {
        targetN2 = 0;
        tauN2 = this.n2 > 55 ? 2.2 : 4.0;
      } else {
        targetN2 = 0;
        tauN2 = 4.5;
      }
      if (this.state === 'running' && this.starter && this.n2 < 52) {
        targetN2 = Math.max(targetN2, 52);
        tauN2 = Math.min(tauN2, 1.05);
      }

      this.n2 = clamp(approach(this.n2, targetN2, dt, tauN2), 0, 104);
      if (this.n2 < 0.15) this.n2 = 0;

      let targetN1 = 0;
      if (this.combustion) {
        const core = clamp((this.n2 - 48) / 52, 0, 1.06);
        targetN1 = 28 + 72 * core;
      }
      const tauN1 = targetN1 > this.n1 ? 1.7 : 2.9;
      this.n1 = clamp(approach(this.n1, targetN1, dt, tauN1), 0, 104);
      if (this.n1 < 0.1) this.n1 = 0;

      /* afterburner */
      const canAB = this.state === 'running' && this.combustion && this.fuelOn &&
        this.abArmed && this.n1 > 87 && this.throttle > 86;
      this.abReady = canAB;
      this.abInhibited = this.abArmed && !canAB && this.state === 'running';
      if (this.abArmed) {
        if (this.throttle <= 86) this.abReason = 'THROTTLE BELOW A/B GATE';
        else if (this.n1 <= 87) this.abReason = 'WAITING FOR N1 > 87%';
        else this.abReason = '';
      } else {
        this.abReason = '';
      }

      const abTarget = canAB ? 1 : 0;
      this.ab = approach(this.ab, abTarget, dt, abTarget > this.ab ? 0.28 : 0.52);
      const abWasActive = this.abActive;
      this.abActive = this.ab > 0.08;
      if (this.abActive && !abWasActive) {
        this._abLit = true;
        this.emit('AFTERBURNER IGNITION · NOZZLE OPENING', 'good');
      } else if (!this.abActive && abWasActive) {
        this._abLit = false;
        this.emit('AFTERBURNER CUTOFF', 'warn');
      }

      /* combustion temperatures */
      const lit = this.combustion;
      const targetT3 = lit
        ? AMBIENT + 520 * Math.pow(this.n2 / 100, 2.05)
        : AMBIENT + 210 * Math.pow(this.n2 / 100, 2.3);
      this.t3 = approach(this.t3, targetT3, dt, 0.52);

      const targetTIT = lit
        ? 540 + 520 * Math.pow(thr, 0.88) + 140 * (this.n2 / 100) + 45 * this.ab
        : AMBIENT + 35 * (this.n2 / 100);
      const targetEGT = lit ? targetTIT - 165 : AMBIENT + 24 * (this.n2 / 100);
      this.startSpike *= Math.exp(-dt / 1.12);
      if (this.startSpike < 0.5) this.startSpike = 0;

      this.tit = clamp(approach(this.tit, targetTIT, dt, 0.78) + this.startSpike * 0.1, AMBIENT, 1420);
      this.egt = clamp(approach(this.egt, targetEGT, dt, 1.08) + this.startSpike * 0.08, AMBIENT, 1260);
      this.abTemp = lit
        ? approach(this.abTemp, this.egt + 210 + 420 * this.ab, dt, 0.68)
        : approach(this.abTemp, this.egt, dt, 2.4);

      /* flows & performance - low bypass ratio ~0.36 (F100 class) with ramjet augmentation path */
      const targetAir = (lit || this.n2 > 4)
        ? 4.5 + 198 * Math.pow(this.n1 / 100, 1.65)
        : 0;
      this.airflow = approach(this.airflow, targetAir, dt, 0.38);
      const bypassRatio = 0.36;
      this.bypassFlow = this.airflow * (bypassRatio / (1 + bypassRatio));
      this.coreFlow = this.airflow - this.bypassFlow;

      /* ramjet mode activation concept: at high speed/flow augment core with ram compression */
      if (this.ramjetEnabled && lit && this.n1 > 92 && thr > 0.9) {
        this.mode = 'combined';
      } else if (this.ramjetEnabled && lit && this.n1 > 96 && thr >= 1.0 && this.abActive) {
        this.mode = 'ramjet';
      } else {
        this.mode = lit ? 'turbo' : 'turbo';
      }

      let targetFuel = 0;
      if (lit) {
        targetFuel = 420 + 9800 * Math.pow(thr, 1.08) +
          2350 * Math.pow(this.n2 / 100, 2.3) + 29500 * this.ab;
        if (this.mode === 'combined') targetFuel += 4200 * thr;
        if (this.mode === 'ramjet') targetFuel += 8600;
      } else if (this.state === 'crank' && this.fuelOn) {
        targetFuel = 265;
      }
      this.fuelFlow = approach(this.fuelFlow, targetFuel, dt, 0.2);

      let targetThrust = lit
        ? 14800 * Math.pow(this.n1 / 100, 2.85) + 7800 * this.ab
        : 0;
      if (this.mode === 'combined') targetThrust += 2400 * thr;
      if (this.mode === 'ramjet') targetThrust += 6200;
      this.thrust = approach(this.thrust, targetThrust, dt, 0.22);
      this.tsfc = this.thrust > 40 ? this.fuelFlow / this.thrust : 0;
      this.far = this.coreFlow > 0.5 ? this.fuelFlow / (this.coreFlow * 3600) : 0;

      /* lubrication */
      const targetOil = lit
        ? 42 + 58 * (this.n2 / 100) + 14 * thr + 6 * this.ab
        : 18;
      this.oilTemp = approach(this.oilTemp, targetOil, dt, targetOil > this.oilTemp ? 26 : 75);
      const targetPress = this.n2 > 2.5 ? 5 + 52 * (this.n2 / 100) + 5 * thr : 0;
      this.oilPress = approach(this.oilPress, targetPress, dt, 0.35);
      this.oilFlow = approach(this.oilFlow, this.n2 > 2.5 ? 3 + 17 * (this.n2 / 100) : 0, dt, 0.45);
      this.oilHeat = approach(this.oilHeat, lit ? 22 + 210 * thr + 45 * (this.n2 / 100) + 30 * this.ab : 0, dt, 0.8);

      /* nozzle - F100 convergent-divergent, opens significantly in AB */
      const targetNozzle = lit ? 0.18 + 0.24 * thr + 0.58 * this.ab : 0.14;
      this.nozzle = approach(this.nozzle, targetNozzle, dt, 0.38);

      this._updateWarnings();
    }

    _updateWarnings() {
      const w = [];
      if (this.tit > 1200) w.push({ id: 'tit', label: 'TIT HIGH · ' + Math.round(this.tit) + '°C', level: 'danger' });
      else if (this.tit > 1140) w.push({ id: 'tit', label: 'TIT NEAR LIMIT', level: 'caution' });
      if (this.egt > 1035) w.push({ id: 'egt', label: 'EGT HIGH · ' + Math.round(this.egt) + '°C', level: 'danger' });
      else if (this.egt > 980) w.push({ id: 'egt', label: 'EGT NEAR LIMIT', level: 'caution' });
      if (this.oilPress > 0.5 && this.oilPress < 20 && this.n2 > 45) {
        w.push({ id: 'oilp', label: 'OIL PRESSURE LOW', level: 'danger' });
      }
      if (this.oilTemp > 148) w.push({ id: 'oilt', label: 'OIL TEMP HIGH', level: 'danger' });
      else if (this.oilTemp > 132) w.push({ id: 'oilt', label: 'OIL TEMP CAUTION', level: 'caution' });
      if (this.n2 > 101.5) w.push({ id: 'n2', label: 'N2 OVERSPEED', level: 'danger' });
      if (this.state === 'failed') w.push({ id: 'fail', label: 'START FAILED · RESET REQUIRED', level: 'danger' });
      if (this.state === 'crank' && !this.fuelOn && this.crankTime > 2.5) {
        w.push({ id: 'nofuel', label: 'NO FUEL · NO IGNITION', level: 'danger' });
      }
      if (this.abInhibited && this.abReason) {
        w.push({ id: 'ab', label: 'A/B INHIBIT · ' + this.abReason, level: 'caution' });
      }
      this.warnings = w;
    }

    /* ── readouts for UI ──────────────────────────────────────── */

    get statusLabel() {
      switch (this.state) {
        case 'crank':
          return 'CRANKING';
        case 'running':
          if (this.abActive) return 'AFTERBURNER';
          if (this.n2 < 59 && this.throttle < 4) return 'IDLE';
          if (this.throttle >= 99) return 'MAX DRY';
          return 'RUNNING';
        case 'shutdown':
          return 'SPOOLING DOWN';
        case 'failed':
          return 'START FAILED';
        default:
          return 'ENGINE OFF';
      }
    }

    get statusDetail() {
      switch (this.state) {
        case 'crank':
          if (!this.fuelOn) return { text: 'NO FUEL — NO LIGHT', level: 'bad' };
          if (this.n2 < 12) return { text: 'STARTER CRANKING', level: 'active' };
          return { text: 'FUEL ON · IGNITION', level: 'active' };
        case 'running':
          if (this.abActive) return { text: 'AUGMENTOR LIT · NOZZLE OPEN', level: 'warn' };
          if (this.starter) return { text: 'LIGHT-OFF · ACCELERATING', level: 'active' };
          if (this.n2 < 59 && this.throttle < 4) return { text: 'IDLE · GENERATORS ONLINE', level: '' };
          return { text: 'STABLE · FADEC NORMAL', level: '' };
        case 'shutdown':
          return { text: 'FUEL OFF · WINDMILLING', level: 'warn' };
        case 'failed':
          return { text: 'START FAILED · PRESS STOP TO RESET', level: 'bad' };
        default:
          return { text: 'READY FOR START', level: '' };
      }
    }
  }

  window.EngineSim = EngineSim;
})();
