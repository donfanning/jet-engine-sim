/* VX-90 — 3D engine, environment and interactive camera */
(function () {
  'use strict';

  const T = THREE;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const shortAngle = (from, to) => from + wrapAngle(to - from);

  const VIEWS = {
    quarter: { theta: 0.82, phi: 1.14, radius: 13.2, target: [0, 0.05, -0.55] },
    side: { theta: Math.PI / 2, phi: 1.33, radius: 14.4, target: [0, 0.05, -0.9] },
    front: { theta: 0.03, phi: 1.26, radius: 11.2, target: [0, 0.05, 0] },
    rear: { theta: Math.PI - 0.62, phi: 1.24, radius: 12.2, target: [0, 0.05, -0.55] },
    top: { theta: 0.55, phi: 0.38, radius: 12.8, target: [0, 0.05, 0] },
    core: { theta: 1.04, phi: 1.22, radius: 10.0, target: [0, 0.05, -0.4] }
  };

  class Engine3D {
    constructor(canvas, sim) {
      this.canvas = canvas;
      this.sim = sim;
      this.coverT = 0;
      this.coverTarget = 0;
      this.flowOn = true;
      this.labelsOn = true;
      this.autoOrbit = false;
      this.activeCam = 'quarter';
      this.time = 0;
      this._labelClock = 0;
      this._tmpColor = new T.Color();

      this.spherical = { theta: 0.82, phi: 1.14, radius: 13.0 };
      this.target = new T.Vector3(0, 0, 0);
      this.camTween = null;
      this._proj = new T.Vector3();
      this._dummy = new T.Object3D();
      this._quat = new T.Quaternion();
      this._up = new T.Vector3(0, 1, 0);
      this._dir = new T.Vector3();
      this._pA = new T.Vector3();
      this._pB = new T.Vector3();

      this.initRenderer();
      this.initScene();
      this.buildEnvironment();
      this.buildMaterials();
      this.buildEngine();
      this.buildFlow();
      this.buildLabels();
      this.initInput();

      this.setView('quarter', true);
      this.resize();

      window.addEventListener('resize', () => this.resize());
    }

    /* ── renderer / scene ─────────────────────────────────────── */

    initRenderer() {
      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputEncoding = T.sRGBEncoding;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.06;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    }

    initScene() {
      this.scene = new T.Scene();
      this.scene.background = new T.Color(0x04070b);
      this.scene.fog = new T.FogExp2(0x04070b, 0.021);
      this.camera = new T.PerspectiveCamera(36, 1, 0.1, 260);
    }

    buildEnvironment() {
      /* Dusk test-cell sky used as a reflection probe */
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 512;
      const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 512);
      sky.addColorStop(0.0, '#101d29');
      sky.addColorStop(0.34, '#384d5c');
      sky.addColorStop(0.48, '#9aa7ae');
      sky.addColorStop(0.52, '#45515a');
      sky.addColorStop(0.68, '#121a20');
      sky.addColorStop(1.0, '#05080b');
      g.fillStyle = sky;
      g.fillRect(0, 0, 1024, 512);

      let rg = g.createRadialGradient(260, 160, 0, 260, 160, 240);
      rg.addColorStop(0, 'rgba(230,246,255,0.95)');
      rg.addColorStop(0.3, 'rgba(150,200,230,0.35)');
      rg.addColorStop(1, 'rgba(20,40,60,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 512);

      rg = g.createRadialGradient(790, 300, 0, 790, 300, 260);
      rg.addColorStop(0, 'rgba(255,172,96,0.8)');
      rg.addColorStop(0.4, 'rgba(180,88,40,0.22)');
      rg.addColorStop(1, 'rgba(40,20,10,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 512);

      rg = g.createRadialGradient(950, 120, 0, 950, 120, 200);
      rg.addColorStop(0, 'rgba(110,210,255,0.5)');
      rg.addColorStop(1, 'rgba(10,40,60,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, 1024, 512);

      const tex = new T.CanvasTexture(c);
      tex.mapping = T.EquirectangularReflectionMapping;
      tex.encoding = T.sRGBEncoding;
      const pmrem = new T.PMREMGenerator(this.renderer);
      this.envRT = pmrem.fromEquirectangular(tex);
      this.scene.environment = this.envRT.texture;
      tex.dispose();
      pmrem.dispose();

      this.scene.add(new T.HemisphereLight(0x9fc6db, 0x05080a, 0.42));

      const key = new T.DirectionalLight(0xfff1dc, 1.85);
      key.position.set(7, 12, 9);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -9;
      key.shadow.camera.right = 9;
      key.shadow.camera.top = 9;
      key.shadow.camera.bottom = -9;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 40;
      key.shadow.bias = -0.0008;
      key.shadow.normalBias = 0.02;
      this.scene.add(key);

      const fill = new T.DirectionalLight(0x69b7ee, 0.9);
      fill.position.set(-9, 4, -7);
      this.scene.add(fill);

      const rim = new T.DirectionalLight(0xff9d5c, 0.55);
      rim.position.set(-3, -5, -10);
      this.scene.add(rim);

      const top = new T.DirectionalLight(0xbdd9e8, 0.55);
      top.position.set(0, 10, -4);
      this.scene.add(top);

      /* floor, platform and grid */
      const floor = new T.Mesh(
        new T.PlaneGeometry(220, 220),
        new T.MeshStandardMaterial({ color: 0x05090d, roughness: 0.82, metalness: 0.14 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -3.04;
      floor.receiveShadow = true;
      this.scene.add(floor);

      const grid = new T.GridHelper(58, 58, 0x14384c, 0x0a161e);
      grid.position.y = -3.0;
      grid.material.transparent = true;
      grid.material.opacity = 0.23;
      grid.material.depthWrite = false;
      this.scene.add(grid);

      const base = new T.Mesh(
        new T.CylinderGeometry(4.9, 5.05, 0.16, 96),
        new T.MeshStandardMaterial({ color: 0x090f14, roughness: 0.5, metalness: 0.6 })
      );
      base.position.y = -2.92;
      base.receiveShadow = true;
      this.scene.add(base);

      const baseTop = new T.Mesh(
        new T.CylinderGeometry(4.55, 4.55, 0.012, 96),
        new T.MeshStandardMaterial({ color: 0x0c141a, roughness: 0.44, metalness: 0.66 })
      );
      baseTop.position.y = -2.83;
      baseTop.receiveShadow = true;
      this.scene.add(baseTop);

      const ringMat = new T.MeshBasicMaterial({
        color: 0x2d9fc4, transparent: true, opacity: 0.3,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.platformRing = new T.Mesh(new T.TorusGeometry(4.58, 0.012, 6, 180), ringMat);
      this.platformRing.rotation.x = Math.PI / 2;
      this.platformRing.position.y = -2.8;
      this.scene.add(this.platformRing);

      const innerRing = new T.Mesh(
        new T.TorusGeometry(3.7, 0.007, 6, 140),
        new T.MeshBasicMaterial({
          color: 0x1d5d75, transparent: true, opacity: 0.3,
          blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
        })
      );
      innerRing.rotation.x = Math.PI / 2;
      innerRing.position.y = -2.81;
      this.scene.add(innerRing);

      /* soft contact shadow */
      const sc = document.createElement('canvas');
      sc.width = sc.height = 256;
      const sg = sc.getContext('2d');
      const grad = sg.createRadialGradient(128, 128, 10, 128, 128, 126);
      grad.addColorStop(0, 'rgba(0,0,0,0.62)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.26)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      sg.fillStyle = grad;
      sg.fillRect(0, 0, 256, 256);
      const shadowTex = new T.CanvasTexture(sc);
      const shadow = new T.Mesh(
        new T.PlaneGeometry(8.4, 4.6),
        new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, -2.815, -0.3);
      this.scene.add(shadow);

      /* service lights around the pad */
      const markerMat = new T.MeshBasicMaterial({ color: 0xffb454, toneMapped: false });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const m = new T.Mesh(new T.BoxGeometry(0.13, 0.015, 0.035), markerMat);
        m.position.set(Math.cos(a) * 4.72, -2.811, Math.sin(a) * 4.72);
        m.rotation.y = -a;
        this.scene.add(m);
      }
    }

    makeMetalTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      g.fillStyle = '#cdcdcd';
      g.fillRect(0, 0, 512, 512);

      for (let i = 0; i < 2200; i++) {
        const y = Math.random() * 512;
        const a = 0.008 + Math.random() * 0.03;
        g.strokeStyle = (Math.random() > 0.5 ? 'rgba(255,255,255,' : 'rgba(30,30,30,') + a + ')';
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(512, y);
        g.stroke();
      }

      g.strokeStyle = 'rgba(78,78,78,0.52)';
      g.lineWidth = 2;
      for (const x of [74, 206, 342, 470]) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
      }
      for (const y of [118, 268, 418]) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke();
      }

      g.fillStyle = 'rgba(92,92,92,0.5)';
      for (const x of [74, 206, 342, 470]) {
        for (let y = 10; y < 512; y += 19) {
          g.beginPath();
          g.arc(x + 7, y, 1.3, 0, Math.PI * 2);
          g.fill();
        }
      }

      const tex = new T.CanvasTexture(c);
      tex.wrapS = tex.wrapT = T.RepeatWrapping;
      tex.anisotropy = 4;
      tex.encoding = T.sRGBEncoding;
      return tex;
    }

    buildMaterials() {
      const std = (opts) => new T.MeshStandardMaterial(opts);
      const metalTex = this.makeMetalTexture();
      this.metalTex = metalTex;
      this.M = {
        casing: std({
          color: 0xaab4bc, metalness: 0.9, roughness: 0.58, side: T.DoubleSide,
          envMapIntensity: 0.72, map: metalTex
        }),
        casingInner: std({
          color: 0x69737c, metalness: 0.86, roughness: 0.62, side: T.DoubleSide,
          envMapIntensity: 0.6, map: metalTex
        }),
        casingDark: std({ color: 0x323b43, metalness: 0.9, roughness: 0.4, side: T.DoubleSide }),
        steel: std({ color: 0x626c75, metalness: 0.96, roughness: 0.38 }),
        steelDark: std({ color: 0x1d242a, metalness: 0.82, roughness: 0.52 }),
        titanium: std({ color: 0x7f8a93, metalness: 1.0, roughness: 0.3, side: T.DoubleSide }),
        blade: std({ color: 0x77828c, metalness: 0.62, roughness: 0.62, side: T.DoubleSide, envMapIntensity: 0.3 }),
        bladeDark: std({ color: 0x565f67, metalness: 0.6, roughness: 0.66, side: T.DoubleSide, envMapIntensity: 0.28 }),
        bladeHot: std({
          color: 0x5a4236, metalness: 0.55, roughness: 0.6, side: T.DoubleSide,
          emissive: 0xff2c00, emissiveIntensity: 0.0
        }),
        hotMetal: std({
          color: 0x4a342a, metalness: 0.8, roughness: 0.48, side: T.DoubleSide,
          emissive: 0xff3606, emissiveIntensity: 0.0
        }),
        copper: std({ color: 0xb06b3f, metalness: 0.95, roughness: 0.36 }),
        dark: std({ color: 0x161c21, metalness: 0.55, roughness: 0.62 }),
        rubber: std({ color: 0x0c0f12, metalness: 0.2, roughness: 0.85 }),
        accent: new T.MeshBasicMaterial({ color: 0xffb454, toneMapped: false }),
        warningBand: std({ color: 0x6d211a, metalness: 0.5, roughness: 0.5, emissive: 0x3a0000, emissiveIntensity: 0.22, side: T.DoubleSide }),
        petal: std({ color: 0x3d444a, metalness: 0.9, roughness: 0.58, side: T.DoubleSide, envMapIntensity: 0.38 }),
        petalEdge: std({ color: 0x2e343a, metalness: 0.88, roughness: 0.6, side: T.DoubleSide })
      };

      this.flameOuter = new T.MeshBasicMaterial({
        color: 0xff5a12, transparent: true, opacity: 0, side: T.DoubleSide,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.flameInner = new T.MeshBasicMaterial({
        color: 0xffcf8a, transparent: true, opacity: 0, side: T.DoubleSide,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.abFlameOuter = new T.MeshBasicMaterial({
        color: 0xff3300, transparent: true, opacity: 0, side: T.DoubleSide,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.abFlameInner = new T.MeshBasicMaterial({
        color: 0xffa13d, transparent: true, opacity: 0, side: T.DoubleSide,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.plumeMat = new T.MeshBasicMaterial({
        color: 0x8fc8ff, transparent: true, opacity: 0, side: T.DoubleSide,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });

      this.glowTex = this.makeGlowTexture();
      this.plumeTex = this.makePlumeTexture();
      this.abFlameOuter.map = this.plumeTex;
      this.abFlameOuter.needsUpdate = true;
      this.flameLight = new T.PointLight(0xff5a1a, 0, 11, 1.6);
      this.flameLight.position.set(0, 0, -1.22);
      this.scene.add(this.flameLight);

      this.abLight = new T.PointLight(0xff7326, 0, 14, 1.5);
      this.abLight.position.set(0, 0.05, -4.8);
      this.scene.add(this.abLight);
    }

    makeGlowTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.18, 'rgba(255,235,200,0.9)');
      gr.addColorStop(0.45, 'rgba(255,140,60,0.35)');
      gr.addColorStop(1, 'rgba(255,80,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
      return new T.CanvasTexture(c);
    }

    makePlumeTexture() {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 256;
      const g = c.getContext('2d');
      /* opaque at the nozzle (image bottom / v=0), transparent at the tail */
      const grd = g.createLinearGradient(0, 256, 0, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0.95)');
      grd.addColorStop(0.3, 'rgba(255,240,208,0.78)');
      grd.addColorStop(0.62, 'rgba(255,175,90,0.4)');
      grd.addColorStop(0.85, 'rgba(255,110,30,0.14)');
      grd.addColorStop(1, 'rgba(255,70,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 256);
      /* flame streaks */
      for (let i = 0; i < 26; i++) {
        const x = Math.random() * 64;
        const w = 0.8 + Math.random() * 3.4;
        const top = 256 * (0.35 + Math.random() * 0.6);
        const a = 0.04 + Math.random() * 0.1;
        g.fillStyle = 'rgba(255,' + Math.round(190 + Math.random() * 55) + ',' +
          Math.round(110 + Math.random() * 90) + ',' + a.toFixed(3) + ')';
        g.fillRect(x, top, w, 256 - top);
      }
      const tex = new T.CanvasTexture(c);
      tex.flipY = false;
      tex.wrapS = T.RepeatWrapping;
      tex.wrapT = T.ClampToEdgeWrapping;
      return tex;
    }

    /* ── geometry helpers ─────────────────────────────────────── */

    radiusAt(profile, z) {
      for (let i = 0; i < profile.length - 1; i++) {
        const a = profile[i], b = profile[i + 1];
        const lo = Math.min(a[0], b[0]);
        const hi = Math.max(a[0], b[0]);
        if (z <= hi && z >= lo) {
          const t = (z - a[0]) / (b[0] - a[0]);
          return lerp(a[1], b[1], t);
        }
      }
      return profile[profile.length - 1][1];
    }

    makeShell(profile, thetaStart, thetaLength, segZ, segT) {
      segZ = segZ || 44;
      segT = segT || 34;
      const pos = [];
      const uv = [];
      const idx = [];
      const z0 = profile[0][0];
      const z1 = profile[profile.length - 1][0];
      for (let i = 0; i <= segZ; i++) {
        const z = lerp(z0, z1, i / segZ);
        const r = this.radiusAt(profile, z);
        for (let j = 0; j <= segT; j++) {
          const a = thetaStart + thetaLength * (j / segT);
          pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
          uv.push(j / segT, i / segZ);
        }
      }
      for (let i = 0; i < segZ; i++) {
        for (let j = 0; j < segT; j++) {
          const a = i * (segT + 1) + j;
          const b = a + segT + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    makeBladeGeometry(hub, tip, chordRoot, chordTip, thickness, sweep) {
      const span = tip - hub;
      const xr = -span / 2;
      const xt = span / 2;
      const ht = thickness / 2;
      const rle = -chordRoot / 2;
      const rte = chordRoot / 2;
      const tle = sweep - chordTip / 2;
      const tte = sweep + chordTip / 2;
      const pos = [
        xr, -ht, rle,  xr, -ht, rte,  xt, -ht, tle,  xt, -ht, tte,
        xr,  ht, rle,  xr,  ht, rte,  xt,  ht, tle,  xt,  ht, tte
      ];
      const idx = [
        0, 1, 2, 1, 3, 2,
        4, 6, 5, 5, 6, 7,
        0, 2, 4, 2, 6, 4,
        1, 5, 3, 3, 5, 7,
        0, 4, 1, 1, 4, 5,
        2, 3, 6, 3, 7, 6
      ];
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    makePetalGeometry(rootWidth, tipWidth, length, thickness) {
      const ht = thickness / 2;
      const rw = rootWidth / 2;
      const tw = tipWidth / 2;
      const pos = [
        -ht, -rw, 0,  -ht, rw, 0,  -ht, -tw, -length,  -ht, tw, -length,
         ht, -rw, 0,   ht, rw, 0,   ht, -tw, -length,   ht, tw, -length
      ];
      const idx = [
        0, 2, 1, 1, 2, 3,
        4, 5, 6, 5, 7, 6,
        0, 1, 4, 1, 5, 4,
        2, 6, 3, 3, 6, 7,
        0, 4, 2, 2, 4, 6,
        1, 3, 5, 3, 7, 5
      ];
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    }

    bladeRow(parent, opts) {
      const o = Object.assign({
        z: 0, hub: 0.28, tip: 0.5, count: 24, chord: 0.16,
        chordTip: null, thickness: 0.02, pitch: 0.4, sweep: 0,
        mat: this.M.blade, phase: 0
      }, opts);
      const geo = o.geo || this.makeBladeGeometry(
        o.hub, o.tip, o.chord, o.chordTip == null ? o.chord * 0.92 : o.chordTip,
        o.thickness, o.sweep
      );
      const mesh = new T.InstancedMesh(geo, o.mat, o.count);
      mesh.frustumCulled = false;
      const m = new T.Matrix4();
      const rz = new T.Matrix4();
      const tr = new T.Matrix4();
      const rx = new T.Matrix4();
      const mid = (o.hub + o.tip) / 2;
      for (let i = 0; i < o.count; i++) {
        const a = (i / o.count) * Math.PI * 2 + o.phase;
        rz.makeRotationZ(a);
        tr.makeTranslation(mid, 0, o.z);
        rx.makeRotationX(o.pitch);
        m.copy(rz).multiply(tr).multiply(rx);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    }

    addTorus(parent, radius, tube, z, mat, arc, rotZ) {
      const geo = new T.TorusGeometry(radius, tube, 8, 60, arc == null ? Math.PI * 2 : arc);
      const mesh = new T.Mesh(geo, mat || this.M.steelDark);
      mesh.position.z = z;
      if (rotZ) mesh.rotation.z = rotZ;
      parent.add(mesh);
      return mesh;
    }

    addCylinder(parent, rTop, rBot, len, z, mat, rot) {
      const mesh = new T.Mesh(new T.CylinderGeometry(rTop, rBot, len, 40), mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.z = z;
      if (rot) mesh.rotation.z = rot;
      parent.add(mesh);
      return mesh;
    }

    /* ── camera ───────────────────────────────────────────────── */

    setView(name, instant) {
      if (name === 'orbit') {
        this.autoOrbit = true;
        this.activeCam = 'orbit';
        this.camTween = null;
        return;
      }
      const v = VIEWS[name];
      if (!v) return;
      this.autoOrbit = false;
      this.activeCam = name;
      if (name === 'core') this.coverTarget = 1; else if (name === 'rear') this.coverTarget = 0;
      const to = {
        theta: this.spherical.theta + wrapAngle(v.theta - this.spherical.theta),
        phi: v.phi,
        radius: v.radius,
        target: new T.Vector3(v.target[0], v.target[1], v.target[2])
      };
      if (instant) {
        this.spherical.theta = to.theta;
        this.spherical.phi = to.phi;
        this.spherical.radius = to.radius;
        this.target.copy(to.target);
        this.camTween = null;
      } else {
        this.camTween = {
          t: 0,
          dur: 1.15,
          from: {
            theta: this.spherical.theta,
            phi: this.spherical.phi,
            radius: this.spherical.radius,
            target: this.target.clone()
          },
          to: to
        };
      }
    }

    initInput() {
      const el = this.canvas;
      let dragging = false;
      let px = 0, py = 0;

      const down = (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        dragging = true;
        px = e.clientX;
        py = e.clientY;
        this.camTween = null;
        this.autoOrbit = false;
        this.activeCam = null;
        el.classList.add('dragging');
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
      };
      const move = (e) => {
        if (!dragging) return;
        const dx = e.clientX - px;
        const dy = e.clientY - py;
        px = e.clientX;
        py = e.clientY;
        this.spherical.theta -= dx * 0.0052;
        this.spherical.phi = clamp(this.spherical.phi + dy * 0.0048, 0.12, 1.545);
      };
      const up = (e) => {
        dragging = false;
        el.classList.remove('dragging');
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* noop */ }
      };

      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.spherical.radius = clamp(this.spherical.radius * Math.exp(e.deltaY * 0.0011), 6.2, 30);
      }, { passive: false });
    }

    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    /* ── public switches ──────────────────────────────────────── */

    setCover(open) {
      this.coverTarget = open ? 1 : 0;
    }

    snapCover(open) {
      this.coverTarget = open ? 1 : 0;
      this.coverT = this.coverTarget;
      const a = smoothstep(0, 1, this.coverT) * (Math.PI * 0.43);
      if (this.coverR) this.coverR.rotation.z = a;
      if (this.coverL) this.coverL.rotation.z = -a;
    }

    toggleCover() {
      this.coverTarget = this.coverTarget > 0.5 ? 0 : 1;
      return this.coverTarget > 0.5;
    }

    setFlow(on) {
      this.flowOn = !!on;
      if (this.flowMesh) this.flowMesh.visible = this.flowOn;
    }

    setLabels(on) {
      this.labelsOn = !!on;
      if (!on) {
        for (const l of this.labels) l.el.classList.add('hide');
      }
    }

    setThrottleControls() { /* used by UI for button state, kept for symmetry */ }

    /* ── per-frame ────────────────────────────────────────────── */

    update(dt) {
      const sim = this.sim;
      this.time += dt;

      /* cover animation: unlatch, swing clear, lift away */
      if (this.coverT < this.coverTarget) this.coverT = Math.min(this.coverTarget, this.coverT + dt / 1.55);
      else if (this.coverT > this.coverTarget) this.coverT = Math.max(this.coverTarget, this.coverT - dt / 1.55);
      const open = smoothstep(0, 1, this.coverT);
      const angle = open * (Math.PI * 0.43);
      const lift = smoothstep(0.34, 1, this.coverT);
      const fade = 1 - smoothstep(0.5, 0.94, this.coverT);
      if (this.coverR) {
        this.coverR.rotation.z = angle;
        this.coverR.position.x = 2.5 * lift;
        this.coverR.position.y = this.hingeY + 0.62 * lift;
        this.coverR.visible = this.coverT < 0.975 || this.coverTarget < 0.5;
      }
      if (this.coverL) {
        this.coverL.rotation.z = -angle;
        this.coverL.position.x = -2.5 * lift;
        this.coverL.position.y = this.hingeY + 0.62 * lift;
        this.coverL.visible = this.coverT < 0.975 || this.coverTarget < 0.5;
      }
      if (this.coverMats) {
        for (const m of this.coverMats) {
          if (m.opacity !== fade) m.opacity = fade;
          m.depthWrite = fade > 0.6;
        }
      }
      if (this.hingeGroup) {
        this.hingeGroup.visible = this.coverT < 0.9 || this.coverTarget < 0.5;
      }

      /* rotors - scale to RPM */
      if (this.lpGroup) {
        const n1 = sim.n1 || 0;
        const sign = sim.combustion || sim.n1 > 0.5 ? -1 : 1;
        this.lpGroup.rotation.z += dt * n1 * 0.052 * sign;
      }
      if (this.hpGroup) {
        const n2 = sim.n2 || 0;
        const sign = sim.combustion || sim.n2 > 0.5 ? -1 : 1;
        this.hpGroup.rotation.z += dt * n2 * 0.088 * sign;
      }

      /* airframe vibration */
      if (this.root) {
        this.root.position.y = Math.sin(this.time * 71) * 0.0016 * (sim.n2 / 100);
      }

      this.updateFlame(dt);
      this.updateNozzle();
      this.updateCamera(dt);
      this.updateFlow(dt);
      this.updateLabels(dt);

      /* platform mood ring */
      if (this.platformRing) {
        const ab = sim.ab;
        this.platformRing.material.opacity = 0.3 + 0.35 * ab + 0.08 * Math.sin(this.time * 2);
        this.platformRing.material.color.setHSL(0.53 - 0.1 * ab, 0.85, 0.5 + 0.08 * ab);
      }

      this.renderer.render(this.scene, this.camera);
    }

    updateCamera(dt) {
      if (this.camTween) {
        const tw = this.camTween;
        tw.t += dt;
        const k = smoothstep(0, 1, tw.t / tw.dur);
        this.spherical.theta = lerp(tw.from.theta, tw.to.theta, k);
        this.spherical.phi = lerp(tw.from.phi, tw.to.phi, k);
        this.spherical.radius = lerp(tw.from.radius, tw.to.radius, k);
        this.target.lerpVectors(tw.from.target, tw.to.target, k);
        if (tw.t >= tw.dur) this.camTween = null;
      }
      if (this.autoOrbit) this.spherical.theta += dt * 0.12;

      const s = this.spherical;
      const sp = Math.sin(s.phi);
      this.camera.position.set(
        this.target.x + s.radius * sp * Math.sin(s.theta),
        this.target.y + s.radius * Math.cos(s.phi),
        this.target.z + s.radius * sp * Math.cos(s.theta)
      );
      this.camera.lookAt(this.target);
    }

    updateFlame(dt) {
      const sim = this.sim;
      const lit = sim.combustion;
      const thr = sim.throttle / 100;
      const flick = 0.86 + Math.sin(this.time * 41) * 0.07 + Math.sin(this.time * 17.3) * 0.05;
      const load = lit ? (0.28 + 0.72 * thr) : 0;

      if (this.combustorFlame) {
        this.combustorFlame.visible = lit;
        const sc = 0.85 + load * 0.3 + Math.sin(this.time * 29) * 0.03;
        this.combustorFlame.scale.set(sc, sc, 0.92 + load * 0.25);
        this.flameOuter.opacity = 0.16 + 0.4 * load * flick;
        this.flameInner.opacity = 0.1 + 0.3 * load * flick;
      }
      if (this.combustorGlow) {
        this.combustorGlow.visible = lit;
        const sc = (1.6 + load * 1.1) * flick;
        this.combustorGlow.scale.set(sc, sc, 1);
        this.combustorGlow.material.opacity = 0.16 + 0.3 * load;
      }
      if (this.flameLight) {
        this.flameLight.intensity = lit ? (0.8 + 2.7 * load) * flick : 0;
      }

      const hot = clamp((sim.egt - 320) / 700, 0, 1.2);
      if (this.M) {
        this.M.bladeHot.emissiveIntensity = hot * 0.75;
        this.M.hotMetal.emissiveIntensity = hot * 0.5;
      }
      if (this.turbineGlow) {
        const sc = 1.2 + hot * 1.2;
        this.turbineGlow.scale.set(sc, sc, 1);
        this.turbineGlow.material.opacity = 0.05 + hot * 0.3;
      }

      /* afterburner - shock diamonds / mach disk inspired */
      const ab = sim.ab;
      if (this.abFlameGroup) {
        this.abFlameGroup.visible = ab > 0.015;
        const length = 0.8 + ab * 1.25;
        const wiggle = Math.sin(this.time * 67) * 0.02 + Math.sin(this.time * 31) * 0.015;
        this.abFlameGroup.scale.set(0.76 + ab * 0.26 + wiggle, 0.76 + ab * 0.26 - wiggle * 0.5, length);
        this.abFlameOuter.opacity = ab * (0.54 + 0.09 * Math.sin(this.time * 61));
        this.abFlameInner.opacity = ab * (0.3 + 0.08 * Math.sin(this.time * 53));
      }
      if (this.abGlow) {
        this.abGlow.visible = ab > 0.01;
        const sc = (0.9 + ab * 0.9) * (0.94 + Math.sin(this.time * 49) * 0.06);
        this.abGlow.scale.set(sc, sc, 1);
        this.abGlow.material.opacity = ab * 0.16;
      }
      if (this.abTail) {
        this.abTail.visible = ab > 0.01;
        const sc = (1.1 + ab * 0.9) * (0.94 + Math.sin(this.time * 41) * 0.06);
        this.abTail.scale.set(sc, sc, 1);
        this.abTail.material.opacity = ab * 0.18;
      }
      if (this.abLight) {
        this.abLight.intensity = ab * (1.8 + Math.sin(this.time * 53) * 0.35);
      }
      if (this.nozzleGlow) {
        this.nozzleGlow.material.opacity = 0.06 + ab * 0.26;
      }

      /* dry exhaust plume */
      if (this.plumeGroup) {
        const p = lit ? (1 - ab) * (0.35 + 0.65 * clamp(sim.thrust / 14000, 0, 1)) : 0;
        this.plumeGroup.visible = p > 0.02;
        this.plumeGroup.scale.set(0.7 + p * 0.3, 0.7 + p * 0.3, 0.5 + p * 0.9);
        this.plumeMat.opacity = p * 0.1;
      }

      if (this.abLinerMat) {
        this.abLinerMat.emissiveIntensity = lit ? 0.05 + 0.33 * ab : 0;
      }
    }

    updateNozzle() {
      const sim = this.sim;
      const open = sim.nozzle;
      const a = 0.05 - 0.30 * open;
      for (const p of this.petals) {
        p.child.rotation.y = a;
      }
    }

    /* ── airflow ──────────────────────────────────────────────── */

    buildFlow() {
      const profiles = {
        core: [[6.6, 1.02], [4.3, 0.56], [3.5, 0.36], [2.5, 0.33], [0.4, 0.31], [-1.0, 0.36], [-2.8, 0.31], [-4.1, 0.17], [-5.0, 0.15], [-6.6, 0.34]],
        bypass: [[6.6, 1.28], [4.3, 0.98], [3.5, 0.88], [2.6, 0.84], [1.0, 0.82], [-1.4, 0.8], [-2.7, 0.84], [-3.6, 0.76], [-6.6, 1.14]],
        external: [[6.8, 1.55], [4.3, 1.3], [2.4, 1.18], [0.2, 1.15], [-2.0, 1.23], [-4.2, 1.44], [-6.8, 1.72]]
      };
      const paths = [];
      const count = 5;
      for (let i = 0; i < count; i++) {
        const base = (i / count) * Math.PI * 2;
        paths.push({ kind: 'core', angle: base + 0.13, profile: profiles.core, twist: 0.72, speed: 1.0, arrows: 2, z0: 5.8, z1: -5.9 });
        paths.push({ kind: 'bypass', angle: base + 0.31, profile: profiles.bypass, twist: 0.14, speed: 0.86, arrows: 2, z0: 6.4, z1: -6.0 });
        const ext = { kind: 'external', angle: base + 0.61, profile: profiles.external, twist: 0.0, speed: 0.62, arrows: 1, z0: 5.0, z1: -5.0 };
        paths.push(ext);
      }
      this.flowPaths = paths;
      let total = 0;
      for (const p of paths) { p.offset = total; total += p.arrows; p.t0 = Math.random(); }
    }

    flowRadius(profile, z) {
      for (let i = 0; i < profile.length - 1; i++) {
        const a = profile[i], b = profile[i + 1];
        const lo = Math.min(a[0], b[0]);
        const hi = Math.max(a[0], b[0]);
        if (z <= hi && z >= lo) {
          const t = (z - a[0]) / (b[0] - a[0]);
          return lerp(a[1], b[1], t);
        }
      }
      return profile[profile.length - 1][1];
    }

    flowPoint(path, t, out) {
      const z0 = path.z0 == null ? 6.6 : path.z0;
      const z1 = path.z1 == null ? -6.6 : path.z1;
      const z = z0 + (z1 - z0) * t;
      const r = this.flowRadius(path.profile, z);
      const a = path.angle + path.twist * t;
      out.set(Math.cos(a) * r, Math.sin(a) * r, z);
      return out;
    }

    updateFlow(dt) {
      if (!this.flowMesh) return;
      const sim = this.sim;
      this.flowMesh.visible = this.flowOn;
      if (!this.flowOn) return;

      const airflow = sim.airflow || 0;
      const n1 = sim.n1 || 0;
      const state = sim.state;
      const spool = Math.max(0, (n1 + sim.n2) / 200);
      const rev = (state === 'shutdown' && airflow < 2) ? -1 : 1;
      const speed = 0.025 + 0.52 * clamp(airflow / 210, 0, 1) * (0.4 + 0.6 * clamp(spool, 0, 1));
      this.flowMesh.material.opacity = 0.24 + 0.52 * clamp((airflow / 210 + spool), 0, 1);
      const dummy = this._dummy;
      const color = this._tmpColor;
      const { cold, mid, hot } = this.flowPalette;

      for (const path of this.flowPaths) {
        for (let j = 0; j < path.arrows; j++) {
          const base = ((this.time * speed * path.speed * rev + path.t0 + j / path.arrows) % 1);
          let t = rev > 0 ? base : (1 - base);
          if (t < 0) t += 1;
          this.flowPoint(path, t, this._pA);
          const t2 = Math.min(0.999, t + 0.006);
          this.flowPoint(path, t2, this._pB);
          this._dir.copy(this._pB).sub(this._pA).normalize();
          this._quat.setFromUnitVectors(this._up, this._dir);

          const fade = smoothstep(0, 0.08, t) * (1 - smoothstep(0.9, 1, t));
          const scale = (path.kind === 'external' ? 0.58 : 0.78) * (0.32 + 0.68 * fade);
          dummy.position.copy(this._pA);
          dummy.quaternion.copy(this._quat);
          dummy.scale.set(scale, scale * 1.15, scale * 1.25);
          dummy.updateMatrix();
          this.flowMesh.setMatrixAt(path.offset + j, dummy.matrix);

          if (path.kind === 'core') {
            const heat = clamp((-this._pA.z - 0.4) / 3.6, 0, 1);
            color.copy(cold).lerp(hot, heat * 0.9);
          } else if (path.kind === 'bypass') {
            color.copy(cold).lerp(mid, 0.32);
          } else {
            color.copy(cold).lerp(mid, 0.42);
          }
          this.flowColors.setXYZ(path.offset + j, color.r, color.g, color.b);
        }
      }
      this.flowMesh.instanceMatrix.needsUpdate = true;
      this.flowColors.needsUpdate = true;
    }

    /* ── screen-space labels ──────────────────────────────────── */

    buildLabels() {
      const wrap = document.getElementById('callouts');
      this.labels = [];
      const specs = [
        { name: 'INLET', pos: [0.0, 1.16, 3.55], open: false, dx: 0, dy: -8, val: () => this.fmt(this.sim.airflow) + ' lb/s' },
        { name: 'HPC · T3', pos: [-0.64, 0.84, 0.15], open: true, dx: -34, dy: 30, val: () => this.fmt(this.sim.t3) + '°C' },
        { name: 'COMB · TIT', pos: [0.0, 0.9, -1.2], open: true, dx: 6, dy: 46, val: () => this.fmt(this.sim.tit) + '°C', hot: true },
        { name: 'TURB · EGT', pos: [-0.64, 0.74, -2.3], open: true, dx: -40, dy: 36, val: () => this.fmt(this.sim.egt) + '°C', hot: true },
        { name: 'NOZZLE', pos: [0.56, 0.62, -4.3], open: false, dx: 22, dy: -22, val: () => this.fmt(this.sim.thrust) + ' lbf' }
      ];
      for (const s of specs) {
        const el = document.createElement('div');
        el.className = 'callout hide';
        if (s.hot) el.classList.add('hot');
        el.innerHTML = '<span class="co-pill"><span class="co-name">' + s.name + '</span><span class="co-val"></span></span><i class="co-dot"></i>';
        const pill = el.querySelector('.co-pill');
        pill.style.setProperty('--dx', (s.dx || 0) + 'px');
        pill.style.setProperty('--dy', (s.dy || 0) + 'px');
        wrap.appendChild(el);
        this.labels.push({
          el,
          anchor: new T.Vector3(s.pos[0], s.pos[1], s.pos[2]),
          needsOpen: s.open,
          val: s.val,
          valueEl: el.querySelector('.co-val'),
          last: '',
          hot: !!s.hot
        });
      }
    }

    fmt(n) {
      return Math.round(n).toLocaleString('en-US');
    }

    updateLabels(dt) {
      this._labelClock += dt;
      const refresh = this._labelClock > 0.16;
      if (refresh) this._labelClock = 0;
      const w = window.innerWidth;
      const h = window.innerHeight;

      for (const l of this.labels) {
        const visible = this.labelsOn && (!l.needsOpen || this.coverT > 0.72);
        if (!visible) {
          if (!l.el.classList.contains('hide')) l.el.classList.add('hide');
          continue;
        }
        this._proj.copy(l.anchor);
        this._proj.project(this.camera);
        if (this._proj.z > 1 || this._proj.z < -1 || Math.abs(this._proj.x) > 1.15 || Math.abs(this._proj.y) > 1.15) {
          l.el.classList.add('hide');
          continue;
        }
        l.el.classList.remove('hide');
        const x = (this._proj.x * 0.5 + 0.5) * w;
        const y = (-this._proj.y * 0.5 + 0.5) * h;
        l.el.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
        if (refresh) {
          const txt = l.val();
          if (txt !== l.last) {
            l.last = txt;
            l.valueEl.textContent = txt;
          }
          if (l.hot) {
            const hotNow = this.sim.combustion && (this.sim.egt > 700 || this.sim.tit > 800);
            l.el.classList.toggle('hot', hotNow);
          }
        }
      }
    }

    /* ── engine assembly ──────────────────────────────────────── */

    buildEngine() {
      this.root = new T.Group();
      this.scene.add(this.root);
      this.lpGroup = new T.Group();
      this.hpGroup = new T.Group();
      this.root.add(this.lpGroup, this.hpGroup);

      this.buildFan();
      this.buildCompressors();
      this.buildCombustor();
      this.buildTurbines();
      this.buildAfterburner();
      this.buildNozzle();
      this.buildCasing();
      this.buildMounts();

      this.root.traverse((o) => {
        if (o.isMesh) {
          if (o.castShadow !== false) o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }

    buildFan() {
      const fan = this.lpGroup;

      /* shaft */
      this.addCylinder(this.root, 0.055, 0.055, 6.1, 0.15, this.M.steel);

      /* spinner */
      const spinnerGeo = new T.ConeGeometry(0.335, 0.84, 44, 1);
      spinnerGeo.rotateX(Math.PI / 2);
      const spinner = new T.Mesh(spinnerGeo, this.M.titanium);
      spinner.position.z = 3.15;
      fan.add(spinner);
      this.addTorus(fan, 0.332, 0.024, 2.74, this.M.steelDark);

      /* fix potential blade-fan contact: move FEGV slightly aft and trim fan blade root */
      const fanBlade = this.makeBladeGeometry(0.375, 0.945, 0.27, 0.4, 0.046, -0.1);
      this.bladeRow(fan, {
        geo: fanBlade, z: 2.62, hub: 0.375, tip: 0.945,
        count: 16, pitch: 0.44, mat: this.M.blade
      });

      this.addTorus(this.root, 0.958, 0.022, 2.62, this.M.steelDark);

      /* fan exit guide vanes bridge the fan frame to the core */
      this.bladeRow(this.root, {
        z: 2.28, hub: 0.58, tip: 0.945, count: 20,
        chord: 0.23, thickness: 0.017, pitch: 0.14, mat: this.M.bladeDark
      });
      this.addTorus(this.root, 0.58, 0.025, 2.28, this.M.steelDark);
      this.addTorus(this.root, 0.95, 0.018, 2.28, this.M.steelDark);

      /* balance marks on the rotor face */
      const markGeo = new T.BoxGeometry(0.055, 0.018, 0.014);
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + 0.4;
        const m = new T.Mesh(markGeo, this.M.accent);
        m.position.set(Math.cos(a) * 0.25, Math.sin(a) * 0.25, 2.935);
        fan.add(m);
      }

    }

    buildCompressors() {
      /* LP compressor drum */
      this.addCylinder(this.lpGroup, 0.295, 0.295, 1.6, 1.53, this.M.steelDark);
      const lpCone = new T.Mesh(new T.CylinderGeometry(0.295, 0.36, 0.22, 40), this.M.steelDark);
      lpCone.rotation.x = Math.PI / 2;
      lpCone.position.z = 2.44;
      this.lpGroup.add(lpCone);

      const lpStages = [
        { z: 2.02, hub: 0.30, tip: 0.535 },
        { z: 1.58, hub: 0.29, tip: 0.505 },
        { z: 1.14, hub: 0.28, tip: 0.475 }
      ];
      for (const s of lpStages) {
        this.bladeRow(this.lpGroup, {
          z: s.z, hub: s.hub, tip: s.tip, count: 16,
          chord: 0.115, thickness: 0.011, pitch: 0.46,
          sweep: -0.008, mat: this.M.blade
        });
        this.addCylinder(this.lpGroup, s.hub + 0.014, s.hub + 0.014, 0.045, s.z, this.M.steelDark);
        this.addTorus(this.root, s.tip + 0.004, 0.007, s.z, this.M.steelDark);
      }

      const lpStators = [
        { z: 1.8, tip: 0.47 },
        { z: 1.36, tip: 0.45 },
        { z: 0.92, tip: 0.43 }
      ];
      for (const s of lpStators) {
        this.bladeRow(this.root, {
          z: s.z, hub: 0.29, tip: s.tip, count: 18,
          chord: 0.095, thickness: 0.01, pitch: -0.42, mat: this.M.bladeDark
        });
      }

      this.addTorus(this.root, 0.435, 0.018, 0.82, this.M.steelDark);
      this.addTorus(this.root, 0.36, 0.02, 0.72, this.M.steelDark);

      /* HP drum */
      this.addCylinder(this.hpGroup, 0.238, 0.238, 1.28, 0.1, this.M.steelDark);
      const hpCone = new T.Mesh(new T.CylinderGeometry(0.238, 0.31, 0.18, 40), this.M.steelDark);
      hpCone.rotation.x = Math.PI / 2;
      hpCone.position.z = 0.75;
      this.hpGroup.add(hpCone);

      const hpStages = [
        { z: 0.63, tip: 0.37 },
        { z: 0.44, tip: 0.355 },
        { z: 0.25, tip: 0.34 },
        { z: 0.06, tip: 0.325 },
        { z: -0.13, tip: 0.31 },
        { z: -0.32, tip: 0.298 }
      ];
      for (const s of hpStages) {
        this.bladeRow(this.hpGroup, {
          z: s.z, hub: 0.238, tip: s.tip, count: 18,
          chord: 0.07, thickness: 0.009, pitch: 0.42,
          sweep: -0.004, mat: this.M.blade
        });
        this.addCylinder(this.hpGroup, 0.25, 0.25, 0.035, s.z, this.M.steelDark);
      }

      for (let i = 0; i < 6; i++) {
        const z = 0.535 - i * 0.19;
        this.bladeRow(this.root, {
          z: z, hub: 0.24, tip: 0.305 + (5 - i) * 0.014, count: 20,
          chord: 0.058, thickness: 0.009, pitch: -0.4, mat: this.M.bladeDark
        });
      }

      this.addTorus(this.root, 0.31, 0.018, -0.53, this.M.steelDark);

      /* HP balance marks */
      const markGeo = new T.BoxGeometry(0.04, 0.014, 0.12);
      for (let i = 0; i < 2; i++) {
        const a = i * Math.PI + 0.3;
        const m = new T.Mesh(markGeo, this.M.accent);
        m.position.set(Math.cos(a) * 0.243, Math.sin(a) * 0.243, 0.51);
        this.hpGroup.add(m);
      }
    }

    buildCombustor() {
      const profile = [[-0.84, 0.445], [-1.66, 0.425]];
      const gap = 0.72;
      const casing = new T.Mesh(
        this.makeShell(profile, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 22, 38),
        this.M.hotMetal
      );
      this.root.add(casing);

      this.addTorus(this.root, 0.445, 0.024, -0.84, this.M.steelDark);
      this.addTorus(this.root, 0.43, 0.02, -1.25, this.M.steelDark);
      this.addTorus(this.root, 0.425, 0.028, -1.66, this.M.steelDark);
      this.addTorus(this.root, 0.30, 0.016, -1.2, this.M.hotMetal);

      /* fuel manifold and nozzles */
      this.addTorus(this.root, 0.52, 0.022, -0.86, this.M.copper, Math.PI * 2);
      const nozzleGeo = new T.CylinderGeometry(0.022, 0.034, 0.2, 10);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const n = new T.Mesh(nozzleGeo, this.M.copper);
        n.position.set(Math.cos(a) * 0.485, Math.sin(a) * 0.485, -0.88);
        n.rotation.z = a - Math.PI / 2;
        this.root.add(n);
        const tip = new T.Mesh(new T.SphereGeometry(0.024, 8, 6), this.M.dark);
        tip.position.set(Math.cos(a) * 0.39, Math.sin(a) * 0.39, -0.88);
        this.root.add(tip);
      }

      /* combustion flame rings */
      this.combustorFlame = new T.Group();
      const ringA = new T.Mesh(new T.TorusGeometry(0.30, 0.082, 10, 52), this.flameOuter);
      ringA.position.z = -1.17;
      const ringB = new T.Mesh(new T.TorusGeometry(0.32, 0.055, 10, 52), this.flameInner);
      ringB.position.z = -1.3;
      const ringC = new T.Mesh(new T.TorusGeometry(0.27, 0.065, 10, 52), this.flameOuter);
      ringC.position.z = -1.05;
      this.combustorFlame.add(ringA, ringB, ringC);
      this.root.add(this.combustorFlame);

      const sprMat = new T.SpriteMaterial({
        map: this.glowTex, color: 0xff8a3a, transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.combustorGlow = new T.Sprite(sprMat);
      this.combustorGlow.position.set(0, 0, -1.2);
      this.combustorGlow.scale.set(2, 2, 1);
      this.root.add(this.combustorGlow);
    }

    buildTurbines() {
      /* HP turbine */
      this.addCylinder(this.hpGroup, 0.205, 0.205, 0.62, -1.94, this.M.steelDark);
      const hpRows = [
        { z: -1.83, tip: 0.355, count: 24 },
        { z: -2.03, tip: 0.375, count: 26 }
      ];
      for (const s of hpRows) {
        this.bladeRow(this.hpGroup, {
          z: s.z, hub: 0.205, tip: s.tip, count: s.count,
          chord: 0.1, chordTip: 0.085, thickness: 0.016,
          pitch: 0.54, mat: this.M.bladeHot
        });
      }

      const hpNgv = [-1.72, -1.92];
      for (const z of hpNgv) {
        this.bladeRow(this.root, {
          z: z, hub: 0.21, tip: 0.395, count: 24,
          chord: 0.09, chordTip: 0.078, thickness: 0.014,
          pitch: -0.5, mat: this.M.hotMetal
        });
      }

      /* LP turbine */
      this.addCylinder(this.lpGroup, 0.195, 0.195, 0.8, -2.54, this.M.steelDark);
      const lpRows = [
        { z: -2.3, tip: 0.405 },
        { z: -2.55, tip: 0.43 },
        { z: -2.79, tip: 0.455 }
      ];
      for (const s of lpRows) {
        this.bladeRow(this.lpGroup, {
          z: s.z, hub: 0.195, tip: s.tip, count: 26,
          chord: 0.11, chordTip: 0.095, thickness: 0.014,
          pitch: 0.5, mat: this.M.bladeHot
        });
      }

      const lpNgv = [-2.18, -2.43, -2.68];
      for (const z of lpNgv) {
        this.bladeRow(this.root, {
          z: z, hub: 0.2, tip: 0.465, count: 28,
          chord: 0.085, chordTip: 0.072, thickness: 0.012,
          pitch: -0.44, mat: this.M.hotMetal
        });
      }

      this.addTorus(this.root, 0.44, 0.018, -1.68, this.M.steelDark);
      this.addTorus(this.root, 0.5, 0.02, -2.92, this.M.steelDark);

      /* exhaust plug */
      const plugGeo = new T.ConeGeometry(0.33, 1.08, 30, 1, true);
      plugGeo.rotateX(-Math.PI / 2);
      const plug = new T.Mesh(plugGeo, this.M.hotMetal);
      plug.position.z = -3.12;
      this.root.add(plug);

      const strutGeo = new T.BoxGeometry(0.035, 0.2, 0.22);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        const strut = new T.Mesh(strutGeo, this.M.steelDark);
        strut.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, -3.0);
        strut.rotation.z = a - Math.PI / 2;
        this.root.add(strut);
      }

      const glowMat = new T.SpriteMaterial({
        map: this.glowTex, color: 0xff5f22, transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.turbineGlow = new T.Sprite(glowMat);
      this.turbineGlow.position.set(0, 0, -2.2);
      this.turbineGlow.scale.set(1.7, 1.7, 1);
      this.root.add(this.turbineGlow);
    }

    buildAfterburner() {
      this.abLinerMat = this.M.steelDark.clone();
      this.abLinerMat.side = T.DoubleSide;
      this.abLinerMat.emissive = new T.Color(0xff4a10);
      this.abLinerMat.emissiveIntensity = 0;

      const profile = [[-2.92, 0.525], [-3.86, 0.505]];
      const liner = new T.Mesh(
        this.makeShell(profile, Math.PI / 2 + 0.52, Math.PI * 2 - 1.04, 26, 40),
        this.abLinerMat
      );
      this.root.add(liner);

      this.addTorus(this.root, 0.523, 0.02, -2.92, this.M.steelDark);
      this.addTorus(this.root, 0.505, 0.022, -3.86, this.M.steelDark);

      /* flame holder rings */
      for (let i = 0; i < 3; i++) {
        const ring = new T.Mesh(
          new T.TorusGeometry(0.24 + i * 0.062, 0.014, 8, 48),
          this.M.hotMetal
        );
        ring.position.z = -3.16 - i * 0.07;
        this.root.add(ring);
      }

      /* radial flame-holder struts */
      const strutGeo = new T.BoxGeometry(0.03, 0.24, 0.05);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const strut = new T.Mesh(strutGeo, this.M.hotMetal);
        strut.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, -3.24);
        strut.rotation.z = a - Math.PI / 2;
        this.root.add(strut);
      }

      /* spray bars */
      const barGeo = new T.CylinderGeometry(0.018, 0.026, 0.17, 8);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.2;
        const bar = new T.Mesh(barGeo, this.M.copper);
        bar.position.set(Math.cos(a) * 0.46, Math.sin(a) * 0.46, -3.0);
        bar.rotation.z = a - Math.PI / 2;
        this.root.add(bar);
      }

      /* augmentor flame */
      this.abFlameGroup = new T.Group();
      this.abFlameGroup.position.z = -3.3;
      const outerGeo = new T.CylinderGeometry(0.46, 0.34, 2.7, 28, 1, true);
      outerGeo.rotateX(-Math.PI / 2);
      const outer = new T.Mesh(outerGeo, this.abFlameOuter);
      outer.position.z = -1.35;
      const innerGeo = new T.ConeGeometry(0.23, 1.9, 22, 1, true);
      innerGeo.rotateX(-Math.PI / 2);
      const inner = new T.Mesh(innerGeo, this.abFlameInner);
      inner.position.z = -0.95;
      this.abFlameGroup.add(outer, inner);
      this.root.add(this.abFlameGroup);

      const sprMat = new T.SpriteMaterial({
        map: this.glowTex, color: 0xff8236, transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.abGlow = new T.Sprite(sprMat);
      this.abGlow.position.set(0, 0, -3.95);
      this.abGlow.scale.set(1.6, 1.6, 1);
      this.root.add(this.abGlow);

      const tailMat = new T.SpriteMaterial({
        map: this.glowTex, color: 0xff7a22, transparent: true, opacity: 0,
        blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
      });
      this.abTail = new T.Sprite(tailMat);
      this.abTail.position.set(0, 0, -5.9);
      this.abTail.scale.set(1.5, 1.5, 1);
      this.root.add(this.abTail);

      /* dry plume */
      this.plumeGroup = new T.Group();
      const plumeGeo = new T.ConeGeometry(0.27, 2.0, 22, 1, true);
      plumeGeo.rotateX(-Math.PI / 2);
      const plume = new T.Mesh(plumeGeo, this.plumeMat);
      plume.position.z = -1.0;
      this.plumeGroup.add(plume);
      this.plumeGroup.position.z = -4.0;
      this.root.add(this.plumeGroup);
    }

    buildNozzle() {
      const profile = [[-3.38, 0.735], [-3.57, 0.615]];
      const collar = new T.Mesh(
        this.makeShell(profile, 0, Math.PI * 2, 10, 64),
        this.M.casingInner
      );
      this.root.add(collar);
      this.addTorus(this.root, 0.748, 0.022, -3.38, this.M.steelDark);
      this.addTorus(this.root, 0.618, 0.018, -3.57, this.M.steelDark);

      /* fixed inner liner so the nozzle throat reads as a dark bore */
      const linerProfile = [[-3.56, 0.588], [-4.34, 0.468]];
      const liner = new T.Mesh(
        this.makeShell(linerProfile, 0, Math.PI * 2, 12, 56),
        this.M.petalEdge
      );
      this.root.add(liner);
      this.addTorus(this.root, 0.472, 0.014, -4.34, this.M.steelDark);

      this.petals = [];
      const r0 = 0.59;
      const z0 = -3.56;
      const count = 16;
      const petalGeo = this.makePetalGeometry(0.228, 0.19, 0.72, 0.02);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const hinge = new T.Group();
        hinge.position.set(Math.cos(a) * r0, Math.sin(a) * r0, z0);
        hinge.rotation.z = a;
        const child = new T.Group();
        const plate = new T.Mesh(petalGeo, this.M.petal);
        plate.position.z = 0;
        child.add(plate);
        hinge.add(child);
        this.root.add(hinge);
        this.petals.push({ hinge, child });
      }

      this.nozzleGlow = new T.Mesh(
        new T.TorusGeometry(0.5, 0.014, 6, 72),
        new T.MeshBasicMaterial({
          color: 0xff7a2a, transparent: true, opacity: 0.1,
          blending: T.AdditiveBlending, depthWrite: false, toneMapped: false
        })
      );
      this.nozzleGlow.position.z = -3.6;
      this.root.add(this.nozzleGlow);
    }

    buildCasing() {
      this.casingProfile = [
        [3.36, 1.0], [3.1, 1.036], [2.6, 1.05], [2.0, 1.04],
        [1.2, 1.008], [0.3, 0.982], [-0.6, 0.952], [-1.6, 0.902],
        [-2.4, 0.842], [-3.0, 0.782], [-3.38, 0.738]
      ];
      const prof = this.casingProfile;

      /* fixed inlet duct */
      const intakeProfile = [[3.34, 1.002], [3.58, 1.012], [3.8, 0.955], [3.94, 0.868]];
      const intake = new T.Mesh(
        this.makeShell(intakeProfile, 0, Math.PI * 2, 16, 72),
        this.M.casing
      );
      this.root.add(intake);
      this.addTorus(this.root, 0.87, 0.036, 3.94, this.M.steelDark);
      this.addTorus(this.root, 1.002, 0.016, 3.35, this.M.steelDark);

      /* clamshell halves, hinged along the top of the nacelle */
      const hingeY = 1.05;
      this.hingeY = hingeY;
      this.coverR = new T.Group();
      this.coverR.position.y = hingeY;
      this.coverL = new T.Group();
      this.coverL.position.y = hingeY;

      const rightShell = new T.Mesh(
        this.makeShell(prof, -Math.PI / 2, Math.PI, 74, 38),
        this.M.casing
      );
      rightShell.position.y = -hingeY;
      const leftShell = new T.Mesh(
        this.makeShell(prof, Math.PI / 2, Math.PI, 74, 38),
        this.M.casing
      );
      leftShell.position.y = -hingeY;
      this.coverR.add(rightShell);
      this.coverL.add(leftShell);

      const ribZ = [2.55, 1.45, 0.35, -0.8, -2.0, -3.05];
      for (const half of [this.coverR, this.coverL]) {
        const side = half === this.coverR;
        for (const z of ribZ) {
          const r = this.radiusAt(prof, z) + 0.019;
          const rib = new T.Mesh(
            new T.TorusGeometry(r, 0.022, 8, 54, Math.PI * 0.985),
            this.M.casingDark
          );
          rib.position.set(0, -hingeY, z);
          rib.rotation.z = side ? -Math.PI / 2 - 0.008 : Math.PI / 2 + 0.008;
          half.add(rib);
        }

        /* red warning band near the fan */
        const bandProfile = [
          [3.02, this.radiusAt(prof, 3.02) + 0.008],
          [2.94, this.radiusAt(prof, 2.94) + 0.008]
        ];
        const band = new T.Mesh(
          this.makeShell(bandProfile, side ? -Math.PI / 2 : Math.PI / 2, Math.PI, 3, 42),
          this.M.warningBand
        );
        band.position.y = -hingeY;
        half.add(band);

        /* edge trims */
        const frontTrim = new T.Mesh(
          new T.TorusGeometry(1.001, 0.014, 6, 54, Math.PI * 0.985),
          this.M.casingDark
        );
        frontTrim.position.set(0, -hingeY, 3.35);
        frontTrim.rotation.z = side ? -Math.PI / 2 - 0.008 : Math.PI / 2 + 0.008;
        half.add(frontTrim);

        const rearTrim = new T.Mesh(
          new T.TorusGeometry(0.742, 0.014, 6, 54, Math.PI * 0.985),
          this.M.casingDark
        );
        rearTrim.position.set(0, -hingeY, -3.37);
        rearTrim.rotation.z = side ? -Math.PI / 2 - 0.008 : Math.PI / 2 + 0.008;
        half.add(rearTrim);

        /* latch pad at the bottom seam */
        const pad = new T.Mesh(new T.BoxGeometry(0.1, 0.035, 0.26), this.M.casingDark);
        pad.position.set(0, -(hingeY + 0.985), -0.45);
        half.add(pad);
      }

      this.root.add(this.coverR, this.coverL);

      /* make the covers independently fadeable */
      this.coverMats = [];
      for (const half of [this.coverR, this.coverL]) {
        half.traverse((o) => {
          if (o.isMesh) {
            const mat = o.material.clone();
            mat.transparent = true;
            mat.opacity = 1;
            o.material = mat;
            o.castShadow = true;
            this.coverMats.push(mat);
          }
        });
      }

      /* hinge hardware */
      this.hingeGroup = new T.Group();
      const rod = new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 7.0, 14), this.M.steel);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(0, hingeY, 0);
      this.hingeGroup.add(rod);
      for (const z of [-3.3, 3.3]) {
        const bracket = new T.Mesh(new T.BoxGeometry(0.1, 0.16, 0.2), this.M.casingDark);
        bracket.position.set(0, hingeY, z);
        this.hingeGroup.add(bracket);
      }
      this.root.add(this.hingeGroup);
    }

    buildMounts() {
      const prof = this.casingProfile;
      for (const z of [-1.9, 1.9]) {
        const r = this.radiusAt(prof, z) + 0.03;
        const post = new T.Mesh(new T.BoxGeometry(0.16, 1.92, 0.24), this.M.steelDark);
        post.position.set(0, -1.93, z);
        post.castShadow = true;
        this.root.add(post);

        const foot = new T.Mesh(new T.BoxGeometry(0.58, 0.075, 0.58), this.M.steelDark);
        foot.position.set(0, -2.84, z);
        foot.receiveShadow = true;
        this.root.add(foot);

        const cap = new T.Mesh(new T.BoxGeometry(0.18, 0.05, 0.3), this.M.accent);
        cap.position.set(0, -1.12, z);
        this.root.add(cap);

        const saddle = new T.Mesh(
          new T.TorusGeometry(r, 0.036, 8, 40, 1.7),
          this.M.steelDark
        );
        saddle.position.set(0, 0, z);
        saddle.rotation.z = -Math.PI / 2 - 0.85;
        this.root.add(saddle);
      }
    }
  }

  window.Engine3D = Engine3D;
})();
