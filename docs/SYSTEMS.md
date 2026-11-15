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

## F-16: stage 2

Sources: TO 1F-16CM/AM-1 for the flight controls, TO 1F-16CM/AM-34-1-1 for the avionics (both BMS 4.38). The code
comments carry the section numbers.

| Area | Modelled | Where |
|---|---|---|
| Flight control system (-1, 16–17) | Cruise and take-off/landing gains from the LG handle, ALT FLAPS and the air-refuel door; CAT I / CAT III; standby gains after two air-data failures (unheated probe in icing, battle damage) with the leading-edge flaps at zero; digital backup; manual pitch override; LE FLAPS lock; the 45-second BIT with its interlocks; FLCS RESET; autopilot interlocks. The flight model's limiters and response read all of this. | `f16/flcs.ts` |
| Faults (-1, 19.6; -34, 7.1) | Pilot fault list on the PFLD with F-ACK, FLCS warning, DBU ON, FLCS / ENGINE / AVIONICS FAULT cautions, maintenance fault list with test numbers and the TOF / LAND pseudo-faults on the MFD TEST page | `f16/flcs.ts` |
| Up-front controls (-34, 2.2.1) | ICP keys, data control switch, the DED with the CNI page, COM 1 / COM 2 / IFF / LIST overrides, the nine priority pages, LIST and MISC sub-pages; scratchpad entry of steerpoints, bingo, ALOW, TACAN and ILS | `f16/avionics.ts` |
| Navigation (-34, 2.2.3) | EGI alignment: NORM (usable at 90 s, complete at four minutes), stored heading, in-flight alignment with GPS; taking it to NAV early leaves no steering; drift without GPS. Steerpoints, automatic sequencing, time over steerpoint, bingo and ALOW warnings | `f16/avionics.ts` |
| Data cartridge (-34, 2.1.6.13) | The flight plan, bingo and radio aids arrive with a DTE LOAD, not before | `f16/avionics.ts` |
| Multifunction displays (-34, 2.1.6) | Twenty option-select buttons per display, three format slots on OSB 12–14, the format menu, SWAP; FCR, HSD (with the flight plan, range and centred/depressed), SMS, TEST, FLCS, DTE, RESET MENU | `f16/avionics.ts`, `ui/mfd.ts` |
| MASTER ARM | Nothing is released and the gun does not fire unless it is in MASTER ARM | `f16/f16Systems.ts` |

### Clickable cockpit

`AircraftSystems.cockpit` is a `PitLayout` (`systems/pitLayout.ts`): flat plates around the pilot's eye, each
listing what it carries row by row. `render/cockpit3d.ts` builds the 3D parts from the declarations (toggle
switches, guarded switches, rotary knobs, push-buttons, caption lights, dial gauges, text displays, MFD buttons)
and seats each plate on the cockpit model by raycast, so one layout serves the HD cockpit and the procedural one.
An aircraft that gets its own systems gets a clickable cockpit by adding a layout.

Left click moves a control up or presses it, right click moves it down, the wheel turns a rotary knob. A guarded
switch takes one click to lift its cover and a second to move it. Hover for the name, the current position and
what the control does. Dragging anywhere else still turns your head.

### Ramp start

With **Cold start** on, a jet with its own systems begins parked: in a shelter on a field with a mapped layout,
on the apron elsewhere (`game/ramp.ts`). Ground clears the taxi once the engine runs and the parking brake comes
off, the route is drawn on the map (F10), the HUD marks the next corner, and tower clears the take-off at the
hold-short point.

## Next stages

1. VR hands for the clickable cockpit.
2. HOTAS functions (DMS, TMS, CMS), the HSI and the remaining Dash-34 pages (FIX, A-CAL, DTS).
3. Lighting, oxygen, canopy and the remaining panels; failures from battle damage to individual components.
4. Taxiing wingmen, ATC sequencing.
5. The next aircraft.
