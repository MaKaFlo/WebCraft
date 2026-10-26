// Local player: input, movement and collision against the block world.

const HALF_W = 0.3;
const HEIGHT = 1.8;
const SWIM_HEIGHT = 0.6;   // lying in the water, like Minecraft's swimming pose
const EYE = 1.62;
const GRAVITY = 32;
const JUMP_SPEED = 9.0;
const WALK = 4.3;
const SPRINT = 5.6;
const SNEAK = 1.3;
const SWIM = 5.6;          // sprint-swimming
const STEP = 0.6;
const EPS = 1e-4;

// Floating point: start + d - start is not always exactly d, so compare with a tolerance
const blocked = (moved, wanted) => Math.abs(moved - wanted) > 1e-6;

export class Player {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.z = 0;
    this.border = null;      // { x, z, size } world border (a wall like in Minecraft)
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0;    // Minecraft yaw in degrees (0 = south/+z, 90 = west/-x)
    this.pitch = 0;  // degrees, positive = looking down
    this.onGround = false;
    this.inLiquid = false;
    this.keys = new Set();
    this.sprinting = false;
    this.canSprint = true;   // false when hungry (food <= 6)
    this.autoJump = true;
    this.canFly = false;   // creative / allowed by the server
    this.flying = false;
    this.swimming = false; // sprinting in water: lying, moves where you look
    this.kbx = 0; this.kbz = 0; // knockback, fades out
    this.frozen = false;   // dead or waiting for the world
  }

  get height() { return this.swimming ? SWIM_HEIGHT : HEIGHT; }

  get eyeY() { return this.y + (this.swimming ? 0.4 : this.keys.has('ShiftLeft') ? EYE - 0.3 : EYE); }

  setPosition(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.kbx = this.kbz = 0;
  }

  /** Velocity set by the server (hits, explosions, plugin abilities like a dash). Blocks per second. */
  push(vx, vy, vz) {
    this.vy = vy;
    this.kbx = vx;
    this.kbz = vz;
    if (vy > 0) this.onGround = false;
  }

  toggleFly() {
    if (!this.canFly) { this.flying = false; return; }
    this.flying = !this.flying;
    this.vy = 0;
  }

  look(dxPixels, dyPixels, sensitivity) {
    this.yaw = (this.yaw + dxPixels * sensitivity) % 360;
    this.pitch = Math.max(-89.9, Math.min(89.9, this.pitch + dyPixels * sensitivity));
  }

  /** True when the ground below us has arrived from the server. */
  groundLoaded() {
    return this.world.hasChunk(Math.floor(this.x) >> 4, Math.floor(this.z) >> 4);
  }

  /** True if the player box at this position overlaps a solid block. */
  insideBlock(x, y, z, height = this.height) {
    const x0 = Math.floor(x - HALF_W + EPS), x1 = Math.floor(x + HALF_W - EPS);
    const y0 = Math.floor(y + EPS) - 1, y1 = Math.floor(y + height - EPS);
    const z0 = Math.floor(z - HALF_W + EPS), z1 = Math.floor(z + HALF_W - EPS);
    for (let bx = x0; bx <= x1; bx++) {
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          const list = this.world.collisionBoxes(bx, by, bz);
          if (!list) continue;
          for (const b of list) {
            if (x + HALF_W > bx + b[0] + EPS && x - HALF_W < bx + b[3] - EPS && y + height > by + b[1] + EPS
              && y < by + b[4] - EPS && z + HALF_W > bz + b[2] + EPS && z - HALF_W < bz + b[5] - EPS) return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Stuck inside blocks (a broken block came back, a lag correction, a bad saved position):
   * move to the nearest free spot close by, like Minecraft pushes you out of blocks.
   */
  unstuck() {
    if (this.flying || !this.insideBlock(this.x, this.y, this.z)) return;
    const bx = Math.floor(this.x) + 0.5, bz = Math.floor(this.z) + 0.5;
    let best = null, bestD = Infinity;
    for (let dy = 0; dy <= 2; dy++) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = dx === 0 && dz === 0 ? this.x : bx + dx, z = dx === 0 && dz === 0 ? this.z : bz + dz;
        const y = dy === 0 ? this.y : Math.floor(this.y + EPS) + dy;
        if (this.insideBlock(x, y, z)) continue;
        const d = (x - this.x) ** 2 + (y - this.y) ** 2 * 1.5 + (z - this.z) ** 2;
        if (d < bestD) { bestD = d; best = [x, y, z]; }
      }
    }
    if (!best) return;
    [this.x, this.y, this.z] = best;
    this.vy = 0;
  }

  update(dt) {
    if (this.frozen || !this.groundLoaded()) return; // wait in the air until the world is there
    this.unstuck();
    if (!this.canFly) this.flying = false;
    // Sub-steps keep collision stable on slow frames
    const steps = Math.ceil(dt / 0.02);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h);
  }

  step(dt) {
    const k = this.keys;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const sneaking = k.has('ShiftLeft');
    const sprinting = this.sprinting && fwd > 0 && !sneaking;

    const liquidAt = (dy) => this.world.isLiquid(Math.floor(this.x), Math.floor(this.y + dy), Math.floor(this.z));
    this.inLiquid = liquidAt(0.4);
    // Sprint in water at least ~2 blocks deep to swim; keep swimming while sprinting and still in the water.
    // Standing up needs room for the full height (in a 1 block high tunnel you keep swimming).
    const swimKey = this.sprinting && fwd > 0 && !this.flying;   // Shift while swimming dives instead of stopping
    if (!this.swimming) {
      this.swimming = swimKey && !sneaking && this.inLiquid && (liquidAt(1.0) || liquidAt(-0.6));
    } else if (!(swimKey && (liquidAt(0.3) || liquidAt(0))) && !this.insideBlock(this.x, this.y, this.z, HEIGHT)) {
      this.swimming = false;
    }

    // Wished direction from yaw: forward = (-sin, cos), right = (-cos, -sin)
    const yr = this.yaw * Math.PI / 180;
    const fx = -Math.sin(yr), fz = Math.cos(yr);
    const rx = -Math.cos(yr), rz = -Math.sin(yr);
    let wx = fx * fwd + rx * side, wz = fz * fwd + rz * side;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    let speed = sprinting ? SPRINT : sneaking && !this.flying ? SNEAK : WALK;
    if (this.flying) speed = sprinting ? 21.6 : 10.9;
    if (this.inLiquid) speed *= 0.5;
    // Swimming goes where you look (look down to dive), the forward part tilted by the pitch
    let wy = 0;
    if (this.swimming) {
      const pr = this.pitch * Math.PI / 180;
      wx *= Math.cos(pr); wz *= Math.cos(pr); wy = -Math.sin(pr);
      speed = SWIM;
    }
    const accel = this.onGround ? 14 : this.inLiquid ? 6 : 8;
    const t = Math.min(1, accel * dt);
    this.vx += (wx * speed - this.vx) * t;
    this.vz += (wz * speed - this.vz) * t;

    if (this.flying) {
      const up = (k.has('Space') ? 1 : 0) - (sneaking ? 1 : 0);
      this.vy += (up * 7.5 - this.vy) * Math.min(1, 10 * dt);
    } else if (this.swimming) {
      const up = (k.has('Space') ? 1 : 0) - (sneaking ? 1 : 0);
      if (liquidAt(0.3)) this.vy += ((wy + up * 0.6) * SWIM - this.vy) * Math.min(1, 6 * dt);
      else this.vy -= GRAVITY * dt;   // body out of the water: back down to the surface
    } else if (this.inLiquid) {
      this.vy -= GRAVITY * 0.15 * dt;
      this.vy *= Math.pow(0.2, dt);
      if (k.has('Space')) this.vy = Math.min(this.vy + 20 * dt, 3.5);
    } else {
      this.vy -= GRAVITY * dt;
      if (k.has('Space') && this.onGround) this.vy = JUMP_SPEED;
    }
    this.vy = Math.max(this.vy, -60);

    // Sneaking keeps you from walking off edges
    let dx = (this.vx + this.kbx) * dt, dz = (this.vz + this.kbz) * dt;
    const fade = Math.exp(-dt * (this.onGround ? 12 : 3));
    this.kbx *= fade; this.kbz *= fade;
    if (sneaking && this.onGround && !this.flying) {
      if (!this.hasGroundBelow(this.x + dx, this.z)) dx = 0;
      if (!this.hasGroundBelow(this.x, this.z + dz)) dz = 0;
      if (!this.hasGroundBelow(this.x + dx, this.z + dz)) { dx = 0; dz = 0; }
    }

    const wasOnGround = this.onGround;
    this.onGround = false;
    const dy = this.vy * dt;
    const movedY = this.moveAxis(1, dy);
    if (blocked(movedY, dy)) {
      if (dy < 0) { this.onGround = true; this.flying = false; }
      this.vy = 0;
    }

    // Horizontal move with automatic step-up (slabs, small ledges)
    const sx = this.x, sy = this.y, sz = this.z;
    const mx = this.moveAxis(0, dx);
    const mz = this.moveAxis(2, dz);
    if ((blocked(mx, dx) || blocked(mz, dz)) && (wasOnGround || this.onGround)) {
      const blockedX = this.x, blockedY = this.y, blockedZ = this.z;
      this.x = sx; this.y = sy; this.z = sz;
      const up = this.moveAxis(1, STEP);
      this.moveAxis(0, dx);
      this.moveAxis(2, dz);
      this.moveAxis(1, -up);
      const gained = Math.hypot(this.x - sx, this.z - sz);
      const before = Math.hypot(blockedX - sx, blockedZ - sz);
      if (gained <= before + EPS) {
        this.x = blockedX; this.y = blockedY; this.z = blockedZ;
      } else {
        this.onGround = true;
      }
    }
    // Auto-jump (like Minecraft's option): walking into a 1-block step jumps up
    if ((blocked(mx, dx) || blocked(mz, dz)) && wasOnGround && len > 0 && !sneaking && !this.inLiquid
        && this.autoJump && this.vy <= 0) {
      const px = Math.floor(this.x + wx * 0.6), pz = Math.floor(this.z + wz * 0.6), by = Math.floor(this.y + 0.01);
      const top = (x, y, z) => { const b = this.world.collisionBox(x, y, z); return b ? b[4] : 0; };
      const h = top(px, by, pz);
      const free = top(px, by + 1, pz) === 0 && top(px, by + 2, pz) === 0
        && top(Math.floor(this.x), by + 2, Math.floor(this.z)) === 0;
      if (h > STEP && h <= 1 && free) this.vy = JUMP_SPEED;
    }
    // Swimming into a ledge pushes you up out of the water (like Minecraft), so you can climb onto the shore
    const touchingLiquid = this.inLiquid || this.world.isLiquid(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    if ((blocked(mx, dx) || blocked(mz, dz)) && touchingLiquid && len > 0 && !this.flying
        && !this.insideBlock(this.x, this.y + 0.6, this.z)) {
      this.vy = Math.max(this.vy, JUMP_SPEED);
    }
    if (blocked(mx, dx) && Math.abs(this.x - sx) < Math.abs(dx) - EPS) this.vx = 0;
    if (blocked(mz, dz) && Math.abs(this.z - sz) < Math.abs(dz) - EPS) this.vz = 0;

    // Fell out of the world: back up
    if (this.y < this.world.minY - 64) this.y = this.world.maxY;
  }

  hasGroundBelow(x, z) {
    const y = this.y - 0.05;
    const x0 = Math.floor(x - HALF_W + EPS), x1 = Math.floor(x + HALF_W - EPS);
    const z0 = Math.floor(z - HALF_W + EPS), z1 = Math.floor(z + HALF_W - EPS);
    const by = Math.floor(y);
    for (let bx = x0; bx <= x1; bx++)
      for (let bz = z0; bz <= z1; bz++) {
        const b = this.world.collisionBox(bx, by, bz);
        if (b && by + b[4] >= y - 0.6) return true;
      }
    return false;
  }

  /** Move along one axis (0=x, 1=y, 2=z) and stop at blocks. Returns distance actually moved. */
  moveAxis(axis, delta) {
    if (delta === 0) return 0;
    const pos = [this.x, this.y, this.z];
    const start = pos[axis];
    pos[axis] += delta;

    const minX = pos[0] - HALF_W, maxX = pos[0] + HALF_W;
    const minY = pos[1], maxY = pos[1] + this.height;
    const minZ = pos[2] - HALF_W, maxZ = pos[2] + HALF_W;

    const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY - EPS);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
    // Our box before this move: blocks we are already inside don't stop us (so we can walk out)
    const sx0 = this.x - HALF_W, sx1 = this.x + HALF_W, sy0 = this.y, sy1 = this.y + this.height;
    const sz0 = this.z - HALF_W, sz1 = this.z + HALF_W;

    for (let bx = x0; bx <= x1; bx++) {
      for (let by = y0; by <= y1; by++) {
        for (let bz = z0; bz <= z1; bz++) {
          const list = this.world.collisionBoxes(bx, by, bz);
          if (!list) continue;
          for (const b of list) {
            // Block shape in world coordinates (stairs have two boxes, so you can walk up them)
            const bx0 = bx + b[0], bx1 = bx + b[3], by0 = by + b[1], by1 = by + b[4], bz0 = bz + b[2], bz1 = bz + b[5];
            if (maxX <= bx0 + EPS || minX >= bx1 - EPS) continue;
            if (maxY <= by0 + EPS || minY >= by1 - EPS) continue;
            if (maxZ <= bz0 + EPS || minZ >= bz1 - EPS) continue;
            if (sx1 > bx0 + EPS && sx0 < bx1 - EPS && sy1 > by0 + EPS && sy0 < by1 - EPS
              && sz1 > bz0 + EPS && sz0 < bz1 - EPS) continue;
            if (axis === 0) pos[0] = delta > 0 ? Math.min(pos[0], bx0 - HALF_W - EPS) : Math.max(pos[0], bx1 + HALF_W + EPS);
            if (axis === 1) pos[1] = delta > 0 ? Math.min(pos[1], by0 - this.height - EPS) : Math.max(pos[1], by1 + EPS);
            if (axis === 2) pos[2] = delta > 0 ? Math.min(pos[2], bz0 - HALF_W - EPS) : Math.max(pos[2], bz1 + HALF_W + EPS);
          }
        }
      }
    }
    // The world border is a wall too
    if (this.border && axis !== 1) {
      const c = axis === 0 ? this.border.x : this.border.z, half = this.border.size / 2;
      const lo = c - half + HALF_W, hi = c + half - HALF_W;
      if (delta > 0 && pos[axis] > hi) pos[axis] = hi;
      if (delta < 0 && pos[axis] < lo) pos[axis] = lo;
    }
    // Never get pushed backwards by a block we were already stuck in
    if (delta > 0) pos[axis] = Math.max(start, pos[axis]);
    else pos[axis] = Math.min(start, pos[axis]);

    this.x = pos[0]; this.y = pos[1]; this.z = pos[2];
    return pos[axis] - start;
  }
}
