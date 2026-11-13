# Aircraft systems

Every jet used to fly on one generic set of assumptions: the engine always runs, the gear always moves, fuel is
one number, the avionics are always on. Aircraft are being moved off that shared set one at a time, so that each
has the systems and the cockpit of the real aircraft. The F-16 is the first.

## How it fits together

```
src/systems/types.ts        the contract: AircraftSystems, ControlDef / LightDef / GaugeDef, SystemsEnv, FmHooks
src/systems/registry.ts     which aircraft family has its own systems
src/systems/f16/            the F-16: panels.ts (switches, lights, gauges) and f16Systems.ts (the model)
src/ui/systemsPanel.ts      cockpit panel, built from the declarations (no per-aircraft UI code)
```

* `Aircraft.attachSystems(state)` gives an aircraft its systems (`cold`, `ground` or `air`). Only the player's
  jet gets them; AI jets and aircraft without an entry in the registry keep the generic set.
* Each sim step `Aircraft.stepSystems()` hands the systems a `SystemsEnv` (speed, altitude, throttle, damage, fuel)
  and the systems write `FmHooks`, which `FlightModel` reads: engine lit, rpm, thrust scale, afterburner inhibit,
  gear command and rate, flap command, speedbrake travel, flight-control power, brakes, nosewheel steering, gun and
  stores release. With no systems attached (`fm.sys === null`) the flight model behaves exactly as before.
* The systems own the fuel: they move it between tanks and burn it, then write the totals back to the flight model.
  Fuel changed elsewhere (tanker, jettison) is picked up on the next step.
* Controls, lights and gauges are data. The panel, the checklist, the auto-start and (later) a clickable 3D cockpit
  all work from that data.

## Adding an aircraft

1. Create `src/systems/<type>/` with the control, light and gauge declarations and a class that implements
   `AircraftSystems`.
2. Register its family in `src/systems/registry.ts`.
3. Add tests to `tests/systems.test.ts`. The architecture tests already check every registered type.

If the new type needs something from the flight model that `FmHooks` does not offer, add the field there with a
default in `defaultHooks()` that changes nothing.

## F-16: what is modelled (stage 1)

Source: TO 1F-16CM/AM-1 (BMS 4.38). Section numbers are in the code comments. Where the manual gives a number it
is used as is; estimates are marked in the code.

| System | Modelled |
|---|---|
| Engine (2) | JFS with brake/JFS accumulators, START 1 / START 2, run light, auto shutdown at 50 %; throttle cutoff; ignition from 12 %; light-off, hot start, hung start; FTIT, oil pressure, nozzle schedule (idle area reset with the LG handle down); SEC mode; flameout, windmilling and airstart; ENGINE warning |
| Fuel (3) | Seven internal tanks and up to three external; transfer order and EXT FUEL TRANS; tank pressurisation from the ECS; fuel flow proportioner and ENG FEED; automatic forward transfer; FUEL MASTER shutoff valve; FWD / AFT FUEL LOW; trapped fuel; negative-g limits; FUEL QTY SEL pointers |
| ECS (5) | AIR SOURCE: tank pressurisation, cabin altitude and CABIN PRESS, EQUIP HOT and radar shutdown |
| Electrical (6) | Battery, main and standby generators, FLCS PMG and relays, bus tree, all eight ELEC panel lights, ELEC SYS and CAUTION RESET, FLCS PWR TEST |
| Hydraulics (7) | Systems A and B, what each one drives, FLCS accumulators, HYD/OIL PRESS warning |
| EPU (8) | OFF / NORM / ON logic, automatic start, bleed air against hydrazine, about ten minutes on hydrazine, run / hydrazine / air lights, EPU/GEN test |
| Gear, brakes, flaps (9–15) | LG handle lock, system B retraction, ALT GEAR, wheels lights, handle warning light, warning horn and silencer, TO/LDG CONFIG; toe brakes, brake channels, parking brake, nosewheel steering; speedbrake 43° limit; trailing-edge flaps from the LG handle and ALT FLAPS |
| Cautions (19) | Glareshield warnings, caution panel, MASTER CAUTION reset logic, voice WARNING / CAUTION, MAL & IND LTS test |
| Avionics power | MMC, ST STA, MFD, UFC, FCR, threat warning: HUD, MFDs, radar and stores release need their bus and their switch |

In the game: **K** opens the cockpit panel, **Shift+K** runs the auto-start, **J** resets the master caution.
"Cold start" in Settings starts ground missions cold and dark.

## Next stages

1. Clickable 3D cockpit: map the declared controls to the switch nodes of the HD cockpit model, in VR too.
2. Parking spots and taxi, so a cold start begins on the ramp instead of the runway.
3. FLCS: gains (takeoff/landing, cruise, standby), leading-edge flap schedule, DBU, BIT, FLCS warnings and PFL.
4. Avionics from the Dash-34: ICP/DED pages, INS alignment, MFD formats, HOTAS functions, SMS.
5. Lighting, oxygen, canopy and the remaining panels; failures from battle damage to individual components.
6. The next aircraft.
