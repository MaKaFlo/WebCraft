// First person: your arm and the item you hold, drawn on top of the world, with swing animation.
import * as THREE from 'three';
import { dimUnlit } from './sky.js';
import { itemModel } from './models.js';
import { firstPersonArm } from './skins.js';

const SWING_TIME = 0.28;
const ROOT_POS = [0.56, -0.52, -0.72], ROOT_YAW = 0.12;   // where the hand sits without swing or bob

// Minecraft's empty hand (ItemInHandRenderer.renderPlayerArm, right arm, no swing): these steps, in this order,
// put the arm of the player model (model space, pivot included) in front of the camera. Relative to our root.
const deg = (x) => x * Math.PI / 180;
const ARM_MATRIX = new THREE.Matrix4().makeRotationY(ROOT_YAW).setPosition(...ROOT_POS).invert();
for (const step of [
  new THREE.Matrix4().makeTranslation(0.64, -0.6, -0.72), new THREE.Matrix4().makeRotationY(deg(45)),
  new THREE.Matrix4().makeTranslation(-1, 3.6, 3.5), new THREE.Matrix4().makeRotationZ(deg(120)),
  new THREE.Matrix4().makeRotationX(deg(200)), new THREE.Matrix4().makeRotationY(deg(-135)),
  new THREE.Matrix4().makeTranslation(5.6, 0, 0),
]) ARM_MATRIX.multiply(step);
const FOOD = /apple|bread|^cooked_|beef$|porkchop|mutton|^chicken$|^rabbit$|^cod$|^salmon$|tropical_fish|pufferfish|carrot$|potato$|beetroot$|cookie|melon_slice|pie$|stew$|soup$|berries|chorus_fruit|dried_kelp$|spider_eye|rotten_flesh|^cake$/;
const DRINK = /potion$|milk_bucket|honey_bottle|ominous_bottle/;
const BOW = /^bow$|crossbow|trident|spear$/;

/** What kind of "hold right click" animation an item has. */
export function useKind(key) {
  if (!key) return null;
  if (DRINK.test(key)) return 'drink';
  if (FOOD.test(key)) return 'eat';
  if (BOW.test(key)) return 'bow';
  return null;
}

export class Hand {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.root = new THREE.Group();          // swings and bobs; sits where Minecraft puts the right hand
    this.scene.add(this.root);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.136, 0.136, 0.51), new THREE.MeshBasicMaterial({ color: 0xe0a070 }));
    arm.position.set(0, -0.02, 0.22);
    // Darker sides so it looks like a box and not a flat shape
    const shade = new THREE.Mesh(new THREE.BoxGeometry(0.137, 0.137, 0.511), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, side: THREE.BackSide }));
    arm.add(shade);
    this.arm = arm;
    this.itemHolder = new THREE.Group();
    this.root.add(arm, this.itemHolder);
    this.itemKey = null;
    this.itemModel = null;
    this.swingT = 0;
    this.equipT = 0;
    this.bob = 0;
    this.palette = null;
    this.using = null;          // 'eat' | 'drink' | 'bow' while right click is held
    this.useT = 0;
    this.crumbs = [];
    this.crumbGeo = new THREE.BoxGeometry(0.025, 0.025, 0.025);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  swing() {
    // Restart the swing unless it just started (holding the mouse while digging)
    if (this.swingT < SWING_TIME * 0.5) this.swingT = SWING_TIME;
  }

  setItem(palette, key) {
    if (key === this.itemKey && palette === this.palette) return;
    if (this.itemKey !== key) this.equipT = 0.2;
    this.itemKey = key;
    this.palette = palette;
    this.rebuildItem();
  }

  rebuildItem() {
    if (this.itemModel) {
      this.itemHolder.remove(this.itemModel);
      this.itemModel.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.material.userData.shared) { o.material.map?.dispose(); o.material.dispose(); }
      });
      this.itemModel = null;
    }
    this.arm.visible = !this.itemKey;
    if (this.skinArm) this.skinArm.visible = false;
    if (!this.itemKey || !this.palette) {
      // Empty hand: the arm of the skin where Minecraft puts it, else a plain arm from the bottom right corner
      if (this.skinArm === undefined && this.palette) {
        this.skinArm = firstPersonArm();
        if (this.skinArm) {
          this.skinArm.matrixAutoUpdate = false;
          this.skinArm.matrix.copy(ARM_MATRIX).multiply(new THREE.Matrix4().makeScale(1 / 16, 1 / 16, 1 / 16));
          this.root.add(this.skinArm);
        }
      }
      this.arm.visible = !this.skinArm;
      if (this.skinArm) this.skinArm.visible = true;
      this.arm.rotation.set(-1.0, 0.45, 0.15);
      this.arm.position.set(-0.02, -0.05, 0.1);
      return;
    }
    // Minecraft's "firstperson_righthand" display: items and tools turned -90 deg around y and 25 deg around z,
    // moved by (1.13, 3.2, 1.13)/16 and scaled 0.68; blocks turned 45 deg and scaled 0.4 (models are 1 block big)
    const m = itemModel(this.palette, this.itemKey, 0.4, 0.68);
    if (m.userData.flat) {
      m.rotation.set(0, -Math.PI / 2, 25 * Math.PI / 180);
      m.position.set(1.13 / 16, 3.2 / 16, 1.13 / 16);
    } else {
      m.rotation.set(0, Math.PI / 4, 0);
    }
    this.itemModel = m;
    this.itemHolder.add(m);
  }

  /** New textures: the skin arm is built again with the next empty hand. */
  dropSkinArm() {
    if (this.skinArm) this.root.remove(this.skinArm);
    this.skinArm = undefined;
  }

  /** Start/stop the eat/drink/bow animation. */
  setUsing(kind) {
    if (kind !== this.using) this.useT = 0;
    this.using = kind;
  }

  /** Little bits of the food fly away (colors from the item picture). */
  spawnCrumbs() {
    const m = this.itemModel;
    if (!m) return;
    let colors = [0x8a5a2a];
    const face = m.children?.[0]?.material?.map?.image;
    if (face && face.getContext) {
      const d = face.getContext('2d').getImageData(0, 0, face.width, face.height).data;
      colors = [];
      for (let i = 0; i < 6; i++) {
        const p = (Math.floor(Math.random() * face.width * face.height)) * 4;
        if (d[p + 3] > 100) colors.push((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
      }
      if (!colors.length) colors = [0x8a5a2a];
    }
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(this.crumbGeo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      c.position.set(-0.05 + Math.random() * 0.1, -0.12, -0.45);
      c.userData.v = new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, (Math.random() - 0.3) * 0.3);
      c.userData.life = 0.6;
      this.scene.add(c);
      this.crumbs.push(c);
    }
  }

  update(dt, moving) {
    for (const c of this.crumbs) {
      c.userData.life -= dt;
      c.userData.v.y -= 2.5 * dt;
      c.position.addScaledVector(c.userData.v, dt);
    }
    this.crumbs = this.crumbs.filter((c) => {
      if (c.userData.life > 0) return true;
      this.scene.remove(c);
      c.material.dispose();
      return false;
    });
    this.bob += dt * (moving ? 9 : 0);
    const bx = moving ? Math.sin(this.bob) * 0.025 : 0;
    const by = moving ? -Math.abs(Math.cos(this.bob)) * 0.025 : 0;
    this.swingT = Math.max(0, this.swingT - dt);
    this.equipT = Math.max(0, this.equipT - dt);
    const p = this.swingT > 0 ? 1 - this.swingT / SWING_TIME : 0;
    const s = Math.sin(p * Math.PI);
    const s2 = Math.sin(Math.sqrt(p) * Math.PI);
    this.root.position.set(ROOT_POS[0] + bx - s2 * 0.18, ROOT_POS[1] + by + s2 * 0.12 - this.equipT * 1.2, ROOT_POS[2] - s * 0.12);
    this.root.rotation.set(-s * 0.9, ROOT_YAW + s2 * 0.5, s * 0.25);
    if (this.using) {
      this.useT += dt;
      const k = Math.min(1, this.useT / 0.2);           // move the item to the mouth first
      if (this.using === 'eat' || this.using === 'drink') {
        const bob = this.useT > 0.2 ? Math.abs(Math.sin(this.useT * 13)) * 0.04 : 0;
        this.root.position.set(0.56 - 0.5 * k, -0.52 + 0.12 * k + bob, -0.72 + 0.12 * k);
        this.root.rotation.set(this.using === 'drink' ? 0.5 * k : 0.15 * k, 0.12 + 0.9 * k, -0.15 * k);
      } else if (this.using === 'bow') {
        const pull = Math.min(1, this.useT / 1.0);       // full draw after 1 s like Minecraft
        const shake = pull >= 1 ? Math.sin(this.useT * 40) * 0.004 : 0;
        this.root.position.set(0.56 - 0.3 * k + shake, -0.52 + 0.1 * k, -0.72 + 0.1 * pull);
        this.root.rotation.set(0, 0.12 + 0.7 * k, 0.25 * k);
      }
    }
  }

  render(renderer, brightness = 1) {
    dimUnlit(this.scene, brightness);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
