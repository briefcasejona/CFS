# CFS — Combat Flight Simulator

A browser-based 3D combat flight simulator that puts realism ahead of graphics. The Dynamic Campaign is inspired by Falcon BMS, and the accessibility and overall feel by DCS. It has full HOTAS support.

## Running the game

Requirements: **Node.js 18+** and **Chrome or Edge** (WebGL2 + Gamepad API).

```bash
npm install
npm start
```

Then open **http://localhost:5173**.

* `npm start` compiles the TypeScript to `build/` and starts a small static server.
* `npm run dev` does the same, but keeps the compiler in watch mode. Reload the browser after you edit something.
* `npm test` compiles and runs the test suite: flight model envelope for all 16 jets, weapons, all scenarios and the campaign engine.

The toolchain is pure JavaScript (TypeScript `tsc` + Node). Nothing uses native binaries, so it also runs on machines where Windows Smart App Control / WDAC blocks tools like esbuild or rollup.

## Aircraft

| USA | Russia | Europe |
|---|---|---|
| F-15C Eagle · F-16C Block 50 · F/A-18C Hornet · F/A-18E/F Super Hornet · F-14B(U) Tomcat · F-4E Phantom II · T-38C Talon · AV-8B Harrier II (Hawker lineage) | MiG-29A · Su-27S · Su-30SM · Su-57 | Mirage 2000-5 · Rafale C · JAS-39C Gripen · Eurofighter Typhoon |

All 16 fly on the same **6-DOF rigid-body flight model**, and each jet supplies its own data: mass, inertia, wing geometry, Mach-dependent lift and drag (including wave drag), stability and control derivatives, engine thrust lapse with altitude and Mach, afterburner, spool-up, fuel burn, G and AoA limits, and gear geometry. On top of that:

* **Fly-by-wire** (F-16, F/A-18, Flankers, Su-57, Mirage, Rafale, Gripen, Typhoon): G/AoA-command pitch law with limiter, roll-rate command, sideslip and turn coordination.
* **Mechanical / CAS** (F-15, F-14, F-4E, T-38, MiG-29, Harrier): stick drives the surfaces, plus dampers. These jets can be over-G'd, stalled and departed.
* **Thrust vectoring** (Su-30, Su-57), **automatic swing wing** (F-14), **vectored-thrust V/STOL with reaction controls** (Harrier).
* ISA atmosphere, ground handling (gear spring-dampers, nosewheel steering, brakes), tail strikes, hard-landing gear collapse, over-G structural failure, G-LOC / red-out.

## Combat

* Radar with RWS / TWS / STT / ACM modes. Detection range scales with RCS, and look-down Doppler notching and terrain masking apply. Some jets also carry an IRST.
* RWR with search, lock, launch and active-missile warnings, plus chaff and flares.
* IR, semi-active and active radar missiles (AIM-9M/X, AIM-7M, AIM-120C, AIM-54C, R-73, R-27R/ER, R-77, Magic II, MICA IR/EM, Super 530D, IRIS-T, ASRAAM, Meteor). They fly proportional navigation with motor burn, drag and lofting, and can be defeated by flares, chaff and notching.
* Ballistic guns with a lead-computing pipper, plus CCIP bombs, laser-guided bombs, Mavericks / Kh-29 and HARM / Kh-31P.
* SAM sites (SA-10, SA-6, SA-2, SA-15, Patriot, Hawk) and AAA.
* AI pilots fly the same flight model. They shoot and crank in BVR, fight BFM with lead/lag pursuit, defend by beaming and notching with countermeasures, and attack ground targets.

## Carriers

Carrier-capable jets (F-14, F/A-18) can operate from a Nimitz-class carrier that steams through the scenario: the USS Theodore Roosevelt off Varnia's west coast and the USS Harry S. Truman in the North Sea.
* **Catapult:** run up to full power and press **C**. The shuttle takes the jet to flying speed in about 90 m.
* **Recovery:** gear, flaps and hook (**H**) down. Fly a 3.5° glideslope to the angled deck. The HUD shows the "ball" (glideslope) and lineup, and the LSO talks you in. Catch one of four wires (the 3-wire is the target), or bolter and go around.
* The deck moves: it keeps steaming at 15 kt and "walks" to the right on final.

## Game modes

* **Instant Action**: pick a jet, a map (Varnia or Northern Europe) and a scenario: free flight, takeoff & landing, carrier cat shot & recovery, carrier trap practice, aerial refueling, guns BFM, heater BFM, BVR 2v2, 4v4 furball, strike, SEAD, CAS or scramble.
* **Mission Setup**: the same scenarios, with full control over opponents, numbers, skill, wingmen, start, altitude, time of day and weather.
* **Dynamic Campaign**: a persistent war on the Varnia Peninsula in 6-hour turns. Each turn both sides' AI writes an **Air Tasking Order** (CAP, sweep, SEAD, strike packages with escort, OCA, CAS). You pick any Coalition flight and fly it in 3D, with enemy CAPs and SAMs placed from the campaign state. Everything you don't fly is resolved statistically.
  * Factories, depots, bridges and the command HQ feed **supply**, which drives the ground war.
  * The **frontline** moves, airbases get overrun, and squadrons relocate, take losses and get replacements.
  * The campaign saves to three slots and can be exported or imported as JSON.

## HOTAS / joystick

1. Connect the HOTAS and **press any button on it**. Browsers only expose a gamepad after the first input.
2. CFS applies a default profile automatically: stick X/Y = roll/pitch, twist = rudder, throttle axis, trigger = gun, plus a few buttons and a hat.
3. Open **Controls / HOTAS**. There's one column per device. Click **Bind**, then press a button or hat direction or move an axis.
   * Conflicts are removed automatically.
   * Click ⚙ next to an axis binding to set **invert, slider mode, deadzone, saturation and curvature**, with a live preview.
   * The device monitor shows every axis and button live.
4. **Export profile** saves your bindings as JSON, and **Import profile** loads them back. Bindings are stored per device name.

The afterburner detent position for throttle axes can be set under Settings.

## Default keyboard (DCS-like)

| Function | Key | Function | Key |
|---|---|---|---|
| Stick | Arrow keys | Rudder | Z / X |
| Throttle | PgUp / PgDn, Num+ / Num− | Trim | Ctrl + arrows, Ctrl+, / Ctrl+. (reset Shift+T) |
| Fire selected weapon | Space | Next weapon | D |
| BVR / dogfight / gun / A-G mode | 2 / 3 / 4 / 6 | Radar lock / unlock | Enter / Backspace |
| Target cursor | Tab | Radar mode / range | R / [ ] |
| Flare / chaff / program | Q / E / V | Gear / flaps / speed brake | G / F / B |
| Wheel brakes | W | Autopilot | A |
| Tailhook | H | Catapult launch (at full power) | C |
| Harrier nozzles | N / M | Eject (press twice) | Shift+E |
| Views | F1–F6, F10 / O map | Look around | Mouse drag, numpad |
| Padlock | L | Labels | F9 |
| Pause / menu | Esc | Time acceleration | Ctrl+Z |

## Project layout

```
src/sim        flight model, atmosphere, autopilot, entities, world simulation
src/aircraft   aircraft data (16 jets)
src/weapons    weapon database, missile guidance/seekers, guns
src/avionics   radar / IRST / RWR
src/ai         AI pilot
src/world      theater: terrain, airbases, objectives
src/render     three.js scene, terrain LOD, procedural models, effects
src/ui         HUD, MFDs, map, menus, controls screen, campaign screens
src/campaign   dynamic campaign engine (ATO, resolver, ground war, saves)
src/game       mission builder, scenarios, flight session
tests          node:test suites
```

## Known limitations

* The cockpit is a 2D-style HUD plus two MFDs, with no clickable 3D cockpit. Avionics are realistic in behaviour but simplified compared with BMS or DCS study modules.
* Aerodynamic data are approximations from public sources, tuned to match published performance.
* Browsers reserve some shortcuts (Ctrl+W, Ctrl+T, Ctrl+N), so they can't be bound.
