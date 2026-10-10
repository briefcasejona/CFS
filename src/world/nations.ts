// Nations and their air forces. Coalitions (BLUE / RED) are formed per theater or scenario from nations;
// `Side` stays blue/red everywhere in the sim (IFF, AI, radar), the nation adds identity: name, air force, roundel.

export interface Nation {
  id: string;
  name: string;
  airForce: string;
  /** roundel colours, outer → inner (CSS hex), for markings and map/UI chips */
  roundel: string[];
  /** fictional (Varnia factions) vs real */
  fictional?: boolean;
}

export const NATIONS: Record<string, Nation> = Object.fromEntries(([
  // fictional (Varnia)
  { id: 'coalition', name: 'Coalition', airForce: 'Coalition Air Forces', roundel: ['#1d4f91', '#ffffff', '#1d4f91'], fictional: true },
  { id: 'federation', name: 'Federation', airForce: 'Federation Air Force', roundel: ['#b3262d', '#ffffff', '#b3262d'], fictional: true },
  // real
  { id: 'us', name: 'United States', airForce: 'US Air Force / US Navy', roundel: ['#ffffff', '#002868', '#ffffff'] },
  { id: 'nl', name: 'Netherlands', airForce: 'Royal Netherlands Air Force', roundel: ['#ae1c28', '#ffffff', '#21468b'] },
  { id: 'be', name: 'Belgium', airForce: 'Belgian Air Component', roundel: ['#ef3340', '#fdda24', '#000000'] },
  { id: 'de', name: 'Germany', airForce: 'Luftwaffe', roundel: ['#000000', '#ffffff', '#000000'] },
  { id: 'fr', name: 'France', airForce: 'Armée de l\'Air et de l\'Espace', roundel: ['#ef4135', '#ffffff', '#0055a4'] },
  { id: 'uk', name: 'United Kingdom', airForce: 'Royal Air Force', roundel: ['#012169', '#ffffff', '#c8102e'] },
  { id: 'dk', name: 'Denmark', airForce: 'Royal Danish Air Force', roundel: ['#c8102e', '#ffffff', '#c8102e'] },
  { id: 'no', name: 'Norway', airForce: 'Royal Norwegian Air Force', roundel: ['#ba0c2f', '#ffffff', '#00205b'] },
  { id: 'se', name: 'Sweden', airForce: 'Swedish Air Force', roundel: ['#006aa7', '#fecc00', '#006aa7'] },
  { id: 'pl', name: 'Poland', airForce: 'Polish Air Force', roundel: ['#dc143c', '#ffffff', '#dc143c'] },
  { id: 'ru', name: 'Russia', airForce: 'Russian Aerospace Forces', roundel: ['#0039a6', '#ffffff', '#d52b1e'] },
  { id: 'by', name: 'Belarus', airForce: 'Belarusian Air Force', roundel: ['#c8313e', '#4aa657', '#c8313e'] },
  { id: 'sa', name: 'Saudi Arabia', airForce: 'Royal Saudi Air Force', roundel: ['#006c35', '#ffffff', '#006c35'] },
  { id: 'kw', name: 'Kuwait', airForce: 'Kuwait Air Force', roundel: ['#007a3d', '#ffffff', '#ce1126'] },
  { id: 'iq', name: 'Iraq', airForce: 'Iraqi Air Force', roundel: ['#ce1126', '#ffffff', '#000000'] },
  { id: 'ir', name: 'Iran', airForce: 'Islamic Republic of Iran Air Force', roundel: ['#239f40', '#ffffff', '#da0000'] },
  { id: 'sy', name: 'Syria', airForce: 'Syrian Air Force', roundel: ['#ce1126', '#ffffff', '#000000'] },
  { id: 'il', name: 'Israel', airForce: 'Israeli Air Force', roundel: ['#0038b8', '#ffffff', '#0038b8'] },
  { id: 'ca', name: 'Canada', airForce: 'Royal Canadian Air Force', roundel: ['#d80621', '#ffffff', '#d80621'] },
] as Nation[]).map((n) => [n.id, n]));

export function nation(id: string | undefined): Nation | undefined { return id ? NATIONS[id] : undefined; }
