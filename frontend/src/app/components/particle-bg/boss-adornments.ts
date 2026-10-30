import * as THREE from 'three';

// Per-realm Three.js adornments for the realm bosses. Each boss gets
// a small additive group parented to its sprite plane (unit space,
// the plane spans -0.5..0.5), animated every frame by
// animateBossAdornment. Purely visual: no gameplay reads these.

const COLORS: number[] = [
  0xff7a1a, 0xb060ff, 0xa8f4ff, 0xf2f27a, 0x6dffbf,
  0xffd75a, 0xcdeeff, 0xff8a2a, 0x8affe6, 0xfff0b0,
];

function mat(color: number, opacity = 0.55): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}
function ring(r: number, w: number, color: number, opacity = 0.5, segs = 48, arc = Math.PI * 2): THREE.Mesh {
  return new THREE.Mesh(new THREE.RingGeometry(r - w, r, segs, 1, 0, arc), mat(color, opacity));
}
function shard(size: number, color: number, opacity = 0.7): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, size, 0, size * 0.35, 0, 0, 0, -size, 0, -size * 0.35, 0, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return new THREE.Mesh(g, mat(color, opacity));
}
function orbiters(group: THREE.Group, n: number, make: () => THREE.Object3D, radius: number): THREE.Group {
  const holder = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const o = make();
    const a = (i / n) * Math.PI * 2;
    o.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0.01);
    o.rotation.z = a - Math.PI / 2;
    holder.add(o);
  }
  holder.name = 'orbit';
  group.add(holder);
  return holder;
}

export function buildBossAdornment(worldIndex: number): THREE.Group {
  const w = Math.max(0, Math.min(9, worldIndex | 0));
  const c = COLORS[w];
  const g = new THREE.Group();
  g.userData['world'] = w;
  switch (w) {
    case 0: // Cinder Colossus: ember motes orbiting and a smoldering ground ring.
      g.add(Object.assign(ring(0.62, 0.05, c, 0.35), { name: 'pulse' }));
      orbiters(g, 6, () => new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), mat(0xffb040, 0.9)), 0.62);
      break;
    case 1: // Umbral Matriarch: a slow crescent halo and two veil rings.
      g.add(Object.assign(ring(0.7, 0.04, c, 0.45, 48, Math.PI * 1.2), { name: 'spin' }));
      g.add(Object.assign(ring(0.58, 0.02, 0x7fd0ff, 0.3), { name: 'pulse' }));
      break;
    case 2: // Prism Sentinel: four orbiting prisms and a hex lens.
      orbiters(g, 4, () => shard(0.09, c, 0.8), 0.68);
      g.add(Object.assign(ring(0.3, 0.03, 0xff9cf0, 0.5, 6), { name: 'spin' }));
      break;
    case 3: // Tempest Roc: a storm wheel of jagged sparks.
      orbiters(g, 8, () => shard(0.06, c, 0.85), 0.72);
      g.add(Object.assign(ring(0.75, 0.02, 0x8cd8ff, 0.3), { name: 'pulse' }));
      break;
    case 4: // Grave Warden: three soul wisps circling and a grave ring.
      orbiters(g, 3, () => new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), mat(c, 0.85)), 0.6);
      g.add(Object.assign(ring(0.66, 0.025, c, 0.25, 8), { name: 'spin' }));
      break;
    case 5: // Solar Monarch: a turning sun corona of rays.
      orbiters(g, 12, () => shard(0.08, c, 0.6), 0.8);
      g.add(Object.assign(ring(0.62, 0.03, 0xfff2a0, 0.45), { name: 'pulse' }));
      break;
    case 6: // Glacial Oracle: a tilted rune ring of ice shards.
      orbiters(g, 6, () => shard(0.07, c, 0.8), 0.75);
      g.add(Object.assign(ring(0.75, 0.015, c, 0.35, 6), { name: 'spin' }));
      break;
    case 7: // Wyrm Sovereign: embers trailing a smoke ring.
      orbiters(g, 5, () => new THREE.Mesh(new THREE.CircleGeometry(0.03, 8), mat(c, 0.9)), 0.7);
      g.add(Object.assign(ring(0.7, 0.05, 0x5aa070, 0.25, 48, Math.PI * 1.5), { name: 'spin' }));
      break;
    case 8: // Entropy Engine: counter-rotating gear rings.
      g.add(Object.assign(ring(0.82, 0.04, c, 0.4, 12), { name: 'spin' }));
      g.add(Object.assign(ring(0.62, 0.03, 0xff5a8a, 0.4, 9), { name: 'counter' }));
      break;
    case 9: // Phoenix Ascendant: a halo and a double feather crown.
      orbiters(g, 10, () => shard(0.08, c, 0.7), 0.82);
      g.add(Object.assign(ring(0.62, 0.035, 0xffc060, 0.5), { name: 'pulse' }));
      g.add(Object.assign(ring(0.95, 0.02, 0xfff0b0, 0.3), { name: 'counter' }));
      break;
  }
  return g;
}

// t in ms, enraged brightens and speeds the motion, telegraph pulses
// harder while an attack is winding up.
export function animateBossAdornment(g: THREE.Group, t: number, enraged: boolean, telegraph: boolean) {
  const w: number = g.userData['world'] ?? 0;
  const speed = (enraged ? 1.7 : 1) * (0.4 + w * 0.06);
  const s = t * 0.001 * speed;
  for (const child of g.children) {
    if (child.name === 'orbit') child.rotation.z = s * (w === 6 ? -0.6 : 1);
    else if (child.name === 'spin') child.rotation.z = s * 0.7;
    else if (child.name === 'counter') child.rotation.z = -s * 0.9;
    else if (child.name === 'pulse') {
      const p = 1 + (telegraph ? 0.12 : 0.05) * Math.sin(t * (telegraph ? 0.02 : 0.004));
      child.scale.set(p, p, 1);
    }
  }
  if (w === 6) g.rotation.x = 0.9; // the Oracle's rune ring lies tilted
}
