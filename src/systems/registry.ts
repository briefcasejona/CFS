// Which aircraft have their own systems. A family not listed here flies on the generic set.
import type { AircraftDef } from '../aircraft/types.js';
import type { AircraftSystems } from './types.js';
import { F16Systems } from './f16/f16Systems.js';

type Factory = (def: AircraftDef) => AircraftSystems;

/** keyed by aircraft family (AircraftDef.family); add a line here when a type gets its own systems */
const FACTORIES: Record<string, Factory> = {
  'F-16': (def) => new F16Systems(def),
};

export function hasSystems(def: AircraftDef) { return !!FACTORIES[def.family ?? '']; }

export function createSystems(def: AircraftDef): AircraftSystems | null {
  return FACTORIES[def.family ?? '']?.(def) ?? null;
}
