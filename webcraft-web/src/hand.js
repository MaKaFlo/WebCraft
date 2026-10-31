// First person: your arm and the item you hold, drawn on top of the world, with swing animation.
import * as THREE from 'three';
import { dimUnlit } from './sky.js';
import { itemModel } from './models.js';
import { firstPersonArm, shieldModel } from './skins.js';

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
const BOW = /^bow$|crossbow/;

/** What kind of "hold right click" animation an item has. */
/** Thrown with right click (an arm swing, no holding): snowballs, eggs, ender pearls, splash potions ... */
export const THROWN = /^(snowball|egg|blue_egg|brown_egg|ender_pearl|ender_eye|splash_potion|lingering_potion|experience_bottle|wind_charge)$/;

/**
 * The picture of a bow or crossbow while it is drawn, like Minecraft's item models: bow after 0.65 / 0.9 of a full
 * draw (1 s), crossbow after 0.58 / 1.0 of its load time (1.25 s). Others keep their own picture.
 */
export function drawnPicture(key, seconds) {
  if (key === 'bow') return seconds >= 0.9 ? 'bow_pulling_2' : seconds >= 0.65 ? 'bow_pulling_1' : 'bow_pulling_0';
  if (key === 'crossbow') { const f = seconds / 1.25; return f >= 1 ? 'crossbow_pulling_2' : f >= 0.58 ? 'crossbow_pulling_1' : 'crossbow_pulling_0'; }
  return key;
}

export function useKind(key) {
  if (!key) return null;
  if (DRINK.test(key)) return 'drink';
  if (FOOD.test(key)) return 'eat';
  if (BOW.test(key)) return 'bow';
  if (key === 'trident') return 'trident';
  if (/_spear$/.test(key)) return 'spear';
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
    // The off hand: its item on the left, like Minecraft (no arm when it is empty)
    this.offRoot = new THREE.Group();
    this.scene.add(this.offRoot);
    this.offKey = null;
    this.offModel = null;
    this.offEquipT = 0;
    this.blocking = null;       // 'R' / 'L': that hand holds its shield up
    this.blockT = 0;
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

  /** key: the item in hand; shown: the picture to draw (e.g. the drawn bow), without a new equip movement. */
  setItem(palette, key, shown = key) {
    if (key === this.itemKey && shown === this.shownKey && palette === this.palette) return;
    if (this.itemKey !== key) this.equipT = 0.2;
    this.itemKey = key;
    this.shownKey = shown;
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
        this.skinArm = firstPersonArm(this.skin, this.slim);
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
    const m = this.heldModel(this.shownKey ?? this.itemKey, false);
    this.itemModel = m;
    this.itemHolder.add(m);
  }

  /** The model of a held item, placed for the right hand (left: mirrored for the off hand). */
  heldModel(key, left) {
    const shield = key === 'shield' && shieldModel(true);
    if (shield) {
      // Low at the side, picture toward you, turned a little inward
      shield.scale.setScalar(0.62);
      shield.position.set(left ? -0.02 : 0.02, -0.08, 0);
      shield.rotation.y = left ? 0.35 : -0.35;
      return shield;
    }
    // Minecraft's "firstperson_righthand" display: items and tools turned -90 deg around y and 25 deg around z,
    // moved by (1.13, 3.2, 1.13)/16 and scaled 0.68; blocks turned 45 deg and scaled 0.4 (models are 1 block big)
    const m = itemModel(this.palette, key, 0.4, 0.68);
    if (m.userData.flat) {
      m.rotation.set(0, -Math.PI / 2, 25 * Math.PI / 180);
      m.position.set(1.13 / 16, 3.2 / 16, 1.13 / 16);
    } else {
      m.rotation.set(0, Math.PI / 4, 0);
    }
    if (left) {
      // Mirror image of the right hand
      const g = new THREE.Group();
      g.add(m);
      g.scale.x = -1;
      return g;
    }
    return m;
  }

  /** The item in the off hand (null: nothing shown on the left). */
  setOffItem(palette, key) {
    if (key === this.offKey && palette === this.palette) return;
    if (key !== this.offKey) this.offEquipT = 0.2;
    this.offKey = key;
    if (this.offModel) {
      this.offRoot.remove(this.offModel);
      this.offModel.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && !o.material.userData.shared && !o.material.userData.keepMap) { o.material.map?.dispose(); o.material.dispose(); }
      });
      this.offModel = null;
    }
    if (!key || !palette) return;
    this.palette = palette;
    this.offModel = this.heldModel(key, true);
    this.offRoot.add(this.offModel);
  }

  /** 'R' or 'L' while that hand's shield is raised, else null. */
  setBlocking(side) {
    this.blocking = side;
  }

  /** Own skin (texture hash from the server, null: Steve); the arm is rebuilt once its picture is there. */
  setSkin(hash, slim) {
    this.skin = hash || null;
    this.slim = !!slim;
    this.dropSkinArm();
    this.rebuildItem();
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
    // Shield up: it moves in front of you within 0.1 s and down again when you let go
    this.blockT = Math.max(0, Math.min(1, this.blockT + (this.blocking ? dt : -dt) / 0.1));
    this.offEquipT = Math.max(0, this.offEquipT - dt);
    const bl = this.blocking === 'L' || (!this.blocking && this.lastBlock === 'L') ? this.blockT : 0;
    const br = this.blocking === 'R' || (!this.blocking && this.lastBlock === 'R') ? this.blockT : 0;
    if (this.blocking) this.lastBlock = this.blocking;
    this.offRoot.position.set(-ROOT_POS[0] - bx + 0.26 * bl, ROOT_POS[1] + by - this.offEquipT * 1.2 + 0.2 * bl, ROOT_POS[2] + 0.1 * bl);
    this.offRoot.rotation.set(0, -ROOT_YAW - 0.35 * bl, 0);
    if (br) {
      this.root.position.x -= 0.26 * br;
      this.root.position.y += 0.2 * br;
      this.root.position.z += 0.1 * br;
      this.root.rotation.y += 0.35 * br;
    }
    if (this.using) {
      this.useT += dt;
      const k = Math.min(1, this.useT / 0.2);           // move the item to the mouth first
      if (this.using === 'eat' || this.using === 'drink') {
        const bob = this.useT > 0.2 ? Math.abs(Math.sin(this.useT * 13)) * 0.04 : 0;
        this.root.position.set(0.56 - 0.5 * k, -0.52 + 0.12 * k + bob, -0.72 + 0.12 * k);
        this.root.rotation.set(this.using === 'drink' ? 0.5 * k : 0.15 * k, 0.12 + 0.9 * k, -0.15 * k);
      } else if (this.using === 'trident') {
        // Minecraft's trident: lifted over the shoulder ready to throw, prongs forward, pulled back for 0.5 s, then it trembles
        const pull = Math.min(1, this.useT / 0.5);
        const shake = pull >= 1 ? Math.sin(this.useT * 26) * 0.006 : 0;
        this.root.position.set(0.56 - 0.1 * k, -0.52 + 0.3 * k + shake, -0.72 + 0.1 * k + 0.2 * pull);
        this.root.rotation.set(-0.6 * k, 0.12 + 0.2 * k, 0.15 * k);
      } else if (this.using === 'spear') {
        // Spear: held low like a lance, tip forward, drawn back a little while charging
        const pull = Math.min(1, this.useT / 0.5);
        this.root.position.set(0.56 - 0.18 * k, -0.52 - 0.04 * k, -0.72 + 0.1 * pull);
        this.root.rotation.set(-1.05 * k, 0.12 + 0.35 * k, -0.2 * k);
      } else if (this.using === 'bow') {
        const pull = Math.min(1, this.useT / 1.0);       // full draw after 1 s like Minecraft
        const shake = pull >= 1 ? Math.sin(this.useT * 40) * 0.004 : 0;
        this.root.position.set(0.56 - 0.3 * k + shake, -0.52 + 0.1 * k, -0.72 + 0.1 * pull);
        this.root.rotation.set(0, 0.12 + 0.7 * k, 0.25 * k);
      }
    }
  }

  /** One eye of the 3D glasses: the hand scene from that eye's camera (showHand false: only the HUD in it). */
  renderWith(renderer, camera, brightness, showHand) {
    this.root.visible = showHand;
    dimUnlit(this.scene, brightness);
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    this.root.visible = true;
  }

  render(renderer, brightness = 1) {
    dimUnlit(this.scene, brightness);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
