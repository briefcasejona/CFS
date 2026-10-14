import * as THREE from 'three';
import { G0 } from '../sim/atmosphere.js';
import { surfaceHeight } from '../world/theater.js';
import type { Aircraft } from '../sim/entities.js';
import type { World } from '../sim/world.js';

const MAX = 4000;

/**
 * Ballistic projectile system (structure-of-arrays) for aircraft guns and AAA.
 * Rounds fly with gravity and velocity-squared drag; hits use swept-sphere tests.
 */
export class Bullets {
  count = 0;
  px = new Float64Array(MAX); py = new Float64Array(MAX); pz = new Float64Array(MAX);
  vx = new Float32Array(MAX); vy = new Float32Array(MAX); vz = new Float32Array(MAX);
  life = new Float32Array(MAX);
  dmg = new Float32Array(MAX);
  owner: (Aircraft | null)[] = new Array(MAX).fill(null);
  side = new Int8Array(MAX);   // 0 blue 1 red
  tracer = new Uint8Array(MAX);
  ox = new Float64Array(MAX); oy = new Float64Array(MAX); oz = new Float64Array(MAX);

  spawn(pos: THREE.Vector3, vel: THREE.Vector3, owner: Aircraft | null, side: 'blue' | 'red', damage: number, tracer: boolean, life = 4) {
    if (this.count >= MAX) return;
    const i = this.count++;
    this.px[i] = this.ox[i] = pos.x; this.py[i] = this.oy[i] = pos.y; this.pz[i] = this.oz[i] = pos.z;
    this.vx[i] = vel.x; this.vy[i] = vel.y; this.vz[i] = vel.z;
    this.life[i] = life;
    this.dmg[i] = damage;
    this.owner[i] = owner;
    this.side[i] = side === 'blue' ? 0 : 1;
    this.tracer[i] = tracer ? 1 : 0;
  }

  private kill(i: number) {
    const j = --this.count;
    if (i !== j) {
      this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
      this.ox[i] = this.ox[j]; this.oy[i] = this.oy[j]; this.oz[i] = this.oz[j];
      this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
      this.life[i] = this.life[j]; this.dmg[i] = this.dmg[j]; this.owner[i] = this.owner[j];
      this.side[i] = this.side[j]; this.tracer[i] = this.tracer[j];
    }
    this.owner[j] = null;
  }

  step(dt: number, world: World) {
    const targets = world.aircraft.filter((a) => a.alive && !a.removed);
    const grounds = world.ground.filter((g) => g.alive);
    for (let i = 0; i < this.count; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); i--; continue; }
      const vx = this.vx[i], vy = this.vy[i], vz = this.vz[i];
      const v = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const k = 1 - 0.00045 * v * dt * Math.exp(-this.py[i] / 9000);
      this.vx[i] = vx * k; this.vy[i] = vy * k - G0 * dt; this.vz[i] = vz * k;
      this.ox[i] = this.px[i]; this.oy[i] = this.py[i]; this.oz[i] = this.pz[i];
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      const side = this.side[i] === 0 ? 'blue' : 'red';
      let hit = false;
      for (const a of targets) {
        if (a.side === side || a === this.owner[i]) continue;
        const r = a.def.span * 0.33 + 1;
        if (sweptHit(this.ox[i], this.oy[i], this.oz[i], this.px[i], this.py[i], this.pz[i], a.pos, r)) {
          world.damageAircraft(a, this.dmg[i], this.owner[i], this.owner[i] ? 'Gun' : 'AAA');
          world.addEffect('hit', new THREE.Vector3(this.px[i], this.py[i], this.pz[i]), 1);
          hit = true; break;
        }
      }
      if (!hit && this.py[i] < 4000) {
        for (const g of grounds) {
          if (g.side === side) continue;
          if (sweptHit(this.ox[i], this.oy[i], this.oz[i], this.px[i], this.py[i], this.pz[i], g.pos, g.radius)) {
            world.damageGround(g, this.dmg[i] * 0.5, this.owner[i]);
            world.addEffect('hit', new THREE.Vector3(this.px[i], this.py[i], this.pz[i]), 1);
            hit = true; break;
          }
        }
        if (!hit && this.py[i] < surfaceHeight(this.px[i], this.pz[i])) {
          world.addEffect('dust', new THREE.Vector3(this.px[i], this.py[i], this.pz[i]), 1);
          hit = true;
        }
      }
      if (hit) { this.kill(i); i--; }
    }
  }
}

function sweptHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number, p: THREE.Vector3, r: number) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = p.x - ax, apy = p.y - ay, apz = p.z - az;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? (apx * abx + apy * aby + apz * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - p.x, dy = ay + aby * t - p.y, dz = az + abz * t - p.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}
