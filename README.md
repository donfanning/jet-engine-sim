# VX-90 Jet Engine Simulator

An interactive, browser-based 3D turbofan simulator with a simplified afterburning low-bypass engine model. Runs as a static site (no build step) — open `index.html` directly in a modern browser.

## Features
- **Engine simulation**: State machine (off/crank/running/shutdown/failed), spool dynamics (N1/N2), TIT/EGT/T3, fuel/air flow, thrust, TSFC, oil system, F/A ratio, afterburner logic, cautions/warnings.
- **3D visualization**: Three.js scene with fan/compressor/combustor/turbine/afterburner/nozzle, animated rotors, airflow streamlines, temperature glow, afterburner plume.
- **Nacelle cover**: Clamshell cover with unlatch/swing/lift animation; opens to reveal internals with station labels.
- **HUD**: Left controls, right instruments (gauges/bars/trend), status lamps, cautions, event log, keyboard hints.
- **Cameras**: Quarter/Side/Front/Rear/Top/Core presets plus orbit (mouse drag/wheel to navigate).
- **Demo modes**: `index.html#demo`, `#demo-max`, `#demo-ab` with view modifiers `-rear`, `-side`, `-top`, `-core`.

## Controls

### Mouse/UI
- **Start/Stop/Reset** - Engine state control
- **Throttle** - Slider or +/-/Idle/Mil buttons
- **Fuel** - Toggle fuel valve
- **Afterburner** - Arm/select augmentor (lights above ~85% N1 when armed)
- **Nacelle Cover** - Open/close clamshell
- **Airflow** - Toggle streamline arrows
- **Labels** - Toggle station labels (visible when cover open)
- **Camera** - Preset buttons or orbit

### Keyboard Shortcuts
| Key | Action |
|---|---|
| `Space` | Start/Stop (contextual) |
| `W` / `↑` | Throttle up (held) |
| `S` / `↓` | Throttle down (held) |
| `F` | Fuel toggle |
| `B` | Afterburner toggle |
| `C` | Cover toggle |
| `A` | Airflow toggle |
| `L` | Labels toggle |
| `H` | Hide/show UI |
| `1-6` | Camera presets (Quarter/Side/Front/Rear/Top/Core) |
| `7` | Orbit camera |

## Running
1. Clone/download this folder
2. Open `index.html` in a modern browser (Chrome/Edge/Firefox). No server required.
3. Click **Start** and advance throttle to run. Arm afterburner at high power.

## Tech Stack
- Vanilla HTML/CSS/JavaScript
- [Three.js r149](https://threejs.org/) (vendored in `vendor/three.min.js`)
- Custom reduced-order engine model (for demonstration)

## Files
```
jet-engine-sim/
├── index.html      # HUD markup and script loading
├── styles.css      # UI styling
├── js/
│   ├── sim.js      # Engine physics/state
│   ├── engine.js   # Three.js scene/geometry/animation
│   ├── ui.js       # HUD bindings/gauges/chart
│   └── main.js     # Boot/demo/orchestration
└── vendor/
    └── three.min.js
```

## Notes
- Performance depends on GPU; uses ACES tone mapping and lightweight geometry.
- Demo hashes pre-warm the sim and open the cover for inspection.
- This is a educational/simulation demo, not a certified engine model.
# jet-engine-sim
# jet-engine-sim
# jet-engine-sim
