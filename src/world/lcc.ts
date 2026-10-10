// Spherical Lambert Conformal Conic projection for real-world theaters.
// Game frame: x = east (m), z = south (m), origin at (lat0, lon0).
const R = 6371008.8;
const D2R = Math.PI / 180;

export interface LccParams { lat0: number; lon0: number; lat1: number; lat2: number }

export class Lcc {
  private n: number; private F: number; private rho0: number; private lon0: number;
  constructor(readonly p: LccParams) {
    const f1 = p.lat1 * D2R, f2 = p.lat2 * D2R, f0 = p.lat0 * D2R;
    const t = (f: number) => Math.tan(Math.PI / 4 + f / 2);
    this.n = Math.abs(p.lat1 - p.lat2) < 1e-9 ? Math.sin(f1) : Math.log(Math.cos(f1) / Math.cos(f2)) / Math.log(t(f2) / t(f1));
    this.F = Math.cos(f1) * Math.pow(t(f1), this.n) / this.n;
    this.rho0 = R * this.F / Math.pow(t(f0), this.n);
    this.lon0 = p.lon0 * D2R;
  }
  /** lat/lon (deg) → game x (east), z (south) in metres */
  forward(lat: number, lon: number): { x: number; z: number } {
    const rho = R * this.F / Math.pow(Math.tan(Math.PI / 4 + lat * D2R / 2), this.n);
    const th = this.n * (lon * D2R - this.lon0);
    return { x: rho * Math.sin(th), z: -(this.rho0 - rho * Math.cos(th)) };
  }
  /** game x, z → lat/lon (deg) */
  inverse(x: number, z: number): { lat: number; lon: number } {
    const y = -z;
    const dy = this.rho0 - y;
    const rho = Math.sign(this.n) * Math.hypot(x, dy);
    const th = Math.atan2(x * Math.sign(this.n), dy * Math.sign(this.n));
    const lat = 2 * Math.atan(Math.pow(R * this.F / rho, 1 / this.n)) - Math.PI / 2;
    return { lat: lat / D2R, lon: (this.lon0 + th / this.n) / D2R };
  }
}
