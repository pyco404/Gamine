// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import { FLOOR_RATIO } from "./presentation";
import { groundShadow } from "./billboard";
import type { Look } from "../residents";
import type { Point } from "./roads";
import { crispText, MONO } from "./text";
import { shortName, type NameLabel, type Placement } from "./labels";
import { sound } from "@/lib/sound";
import { WEAPONS, weaponTexture, type WeaponName } from "./weapons";
import type { ActivityState } from "./activities";
import { motionPosition, type WorldActivity } from "../../../lib/world/simulation";
import { shownSide, type Side } from "../../../lib/world/facing";

/** The few drawing calls the body and its props use: Phaser's Graphics, or a 2D canvas adapter (projected-agents.ts). */
export type Painter = {
  fillStyle(colour: number, alpha?: number): Painter;
  fillRect(x: number, y: number, w: number, h: number): Painter;
  lineStyle(width: number, colour: number, alpha?: number): Painter;
  lineBetween(x1: number, y1: number, x2: number, y2: number): Painter;
  strokeRect(x: number, y: number, w: number, h: number): Painter;
  strokeEllipse(x: number, y: number, w: number, h: number): Painter;
};

/** The points to walk from one place to another, starting where the walker stands. */
export type Router = (from: Point, to: Point) => Point[];

/** Walking speed in world pixels a second: an unhurried pace, so the village is easy to follow. */
const SPEED = 95;
/** Ground covered by one run cycle, so the legs keep pace with the walk. */
const STRIDE = 60;
const HALO = "hero-halo";
/** Where the water comes to on a swimmer, in the sheet's own 192-pixel frame: chest-high, so head and shoulders show. */
const WATERLINE = 108;
const FRAME = 192;

/**
 * Frames in each unit's sheet: one row per animation, 192 px frames. The
 * archer has no walk cycle in the pack, so it runs on its second idle row
 * rather than on a row that fires arrows.
 */
const FRAMES: Record<Look["unit"], { idle: number[]; run: number[]; strike: number[] }> = {
  // The first attack row: a sword swing, a tool swung like one, a close-range shot.
  warrior: { idle: [0, 1, 2, 3, 4, 5], run: [6, 7, 8, 9, 10, 11], strike: [12, 13, 14, 15, 16, 17] },
  archer: { idle: [0, 1, 2, 3, 4, 5], run: [8, 9, 10, 11, 12, 13], strike: [16, 17, 18, 19, 20, 21] },
  pawn: { idle: [0, 1, 2, 3, 4, 5], run: [6, 7, 8, 9, 10, 11], strike: [12, 13, 14, 15, 16, 17] },
};

export const heroTexture = (look: Look) => `hero-${look.unit}-${look.colour}`;

function ensureAnims(scene: Phaser.Scene, look: Look): { idle: string; run: string; strike: string } {
  const texture = heroTexture(look);
  const frames = FRAMES[look.unit];
  const idle = `${texture}:idle`;
  const run = `${texture}:run`;
  const strike = `${texture}:strike`;
  if (!scene.anims.exists(strike)) {
    scene.anims.create({ key: strike, frames: scene.anims.generateFrameNumbers(texture, { frames: frames.strike }), frameRate: 16, repeat: 0 });
  }
  if (!scene.anims.exists(idle)) {
    scene.anims.create({ key: idle, frames: scene.anims.generateFrameNumbers(texture, { frames: frames.idle }), frameRate: 8, repeat: -1 });
  }
  if (!scene.anims.exists(run)) {
    scene.anims.create({
      key: run,
      frames: scene.anims.generateFrameNumbers(texture, { frames: frames.run }),
      frameRate: frames.run.length * (SPEED / STRIDE),
      repeat: -1,
    });
  }
  return { idle, run, strike };
}

/** A soft white disc, drawn once and shared, pulsing behind whoever is selected. */
function ensureHalo(scene: Phaser.Scene): void {
  if (scene.textures.exists(HALO)) return;
  const size = 128;
  const tex = scene.textures.createCanvas(HALO, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.fillStyle = "#f2d682";
  for (let y = 0; y < size; y += 4) for (let x = 0; x < size; x += 4) {
    const radius = Math.hypot(x - size / 2, (y - size / 2) * 2);
    if (radius > 45 && radius < 56) ctx.fillRect(x, y, 4, 4);
  }
  tex.refresh();
}

export type HeroOptions = {
  /** Always shows its name. House agents show theirs only on hover or when selected, so the halls stay legible. */
  named: boolean;
  nameColour: string;
  /** Reduced motion: arrive rather than walk. */
  still: boolean;
  onClick: () => void;
  /** Whether a point is open water: standing in it, the hero swims. */
  inWater?: (p: Point) => boolean;
};

type View = Side;

/** How big an agent's head is, in world pixels: with its body and legs, about a knight's height. */
const HEAD = 30;
/** How high a step lifts it, and how far it rocks, as it walks. */
const HOP = 3;
const SWAY = 0.07;
/** How much of the character stays above the water while it swims. */
const ABOVE_WATER = 0.62;
/** Its legs, in world pixels: how long, how thick, how far apart, and how high a stride lifts a foot. */
const LEG = 9;
const LEG_W = 5;
const LEG_GAP = 4;
const LIFT = 4;
const LEG_COLOUR = 0x3a3142;
const BOOT_COLOUR = 0x1b1620;
/** Its body: how tall, how wide facing us and side on, and how far the head sits down over it. */
const TORSO = 10;
const TORSO_W = 12;
const TORSO_SIDE = 9;
const NECK = 5;
/** Its arms: how long, how thick, and how far a step swings one. */
const ARM = 9;
const ARM_W = 3;
const SWING = 3;
/**
 * How a weapon is held, in radians from upright: leaning a little out at rest,
 * swinging with the arm on the march, and brought down in a lunge. A lunge of
 * this many pixels is the full blow.
 */
const HOLD = 0.3;
const MARCH = 0.25;
const BLOW = 1.3;
const BLOW_AT = 12;

/** Knocked down by a lost match: how long the fall takes, how long it lies there, and how long getting up takes. */
const FALL_MS = 300;
const DOWN_MS = 2600;
const RISE_MS = 500;

/**
 * One agent in the village: its own character - the portrait it has on its
 * pages, as pixel art - walking, fighting and swimming, with its name over it.
 * The knight sheet still runs underneath, unseen: it holds the hit area and
 * stands in only for an agent that has no portrait.
 */
export class Hero {
  private static nextInstance = 0;
  private readonly instance = ++Hero.nextInstance;
  private sprite: Phaser.GameObjects.Sprite;
  private label: Phaser.GameObjects.Text;
  private anims: { idle: string; run: string; strike: string };
  /** How far a lunge has thrown the hero off its spot, in pixels. */
  lungeX = 0;
  private lungeTween: Phaser.Tweens.Tween | null = null;
  private halo: Phaser.GameObjects.Image | null = null;
  private haloTween: Phaser.Tweens.Tween | null = null;
  private walk: Phaser.Tweens.Tween | null = null;
  private hovered = false;
  private selected = false;
  /** On the way somewhere, or out on a stroll: then its name shows, as it does for players' agents always. */
  private walking = false;
  private roaming = false;
  /** The signed-in owner's own agent: a gold marker over it, and its name always shown in gold. */
  private mine = false;
  private marker: Phaser.GameObjects.Text | null = null;
  private markerTween: Phaser.Tweens.Tween | null = null;
  /** How far the marker has bobbed, in pixels. */
  markerBob = 0;
  private labelOffset: number;
  /** The name in full, "Pitchfork-1113": shown on hover or when selected. Otherwise the short one, "Pitchfork". */
  private fullName: string;
  /** Where the name would sit, before the layout (labels.ts) nudges it or hides it to keep names apart. */
  private nameSpot = { x: 0, y: 0 };
  private nameNudge = 0;
  private nameAllowed = true;
  /** The agent's character: its portrait, as pixel art, standing where a knight would. */
  private portrait: Phaser.GameObjects.Image | null = null;
  private shadow: Phaser.GameObjects.Image | null = null;
  private rendered = true;
  private poseAt = 0;
  private resting = false;
  private activity: ActivityState | null = null;
  private activityProp: Phaser.GameObjects.Graphics | null = null;
  private observingWorld = false;
  private sparringBeat: string | null = null;
  private pause: Phaser.Time.TimerEvent | null = null;
  /** Its body, arms and legs under the head, redrawn as it steps. */
  private limbs: Phaser.GameObjects.Graphics | null = null;
  /** What it carries (weapons.ts), and where its weapon hand is, in the body's own frame, and at what angle. */
  private weapon: Phaser.GameObjects.Image | null = null;
  private hand = { x: 0, y: 0, angle: 0 };
  /** What the body is dressed in: the head's own commonest colour, outlined in its dark. */
  private colours: { main: number; dark: number } | null = null;
  /** Where the character's feet are, below the sprite's middle: the knight sheet pads each figure well inside its frame. */
  private footOffset: number;
  /** How far over it has fallen, 0 standing to 1 flat, and which way: 1 over to the right, -1 to the left. */
  fall = 0;
  private fallSide: 1 | -1 = -1;
  private fallTween: Phaser.Tweens.TweenChain | null = null;
  /** A walk it was sent on while it lay there, taken once it is up. */
  private afterFall: (() => void) | null = null;
  /** When this walk began, for the rhythm of its steps. */
  private stepFrom = 0;
  /** Its three views - facing us, from the side (facing right), from behind - and which one shows. */
  private views: { front: string; side: string; back: string } | null = null;
  /**
   * Which way it faces in the world, named as Top sees it: front is south, back north, left west,
   * right east. A world camera turns this into the side it sees (shownTo); the camera never turns it.
   */
  private view: View = "front";
  /** The side the world camera last saw, kept through a few degrees past each diagonal. */
  private shown: View = "front";
  /** In the water: cut off at the chest, bobbing, with a ripple round it. */
  private swimming = false;
  private ripple: Phaser.GameObjects.Ellipse | null = null;
  private bobTween: Phaser.Tweens.Tween | null = null;
  /** How far the bob has lifted or dropped the swimmer, in pixels. */
  bob = 0;
  x: number;
  y: number;

  constructor(
    private scene: Phaser.Scene,
    private router: Router,
    look: Look,
    name: string,
    at: Point,
    private scale: number,
    private opts: HeroOptions,
  ) {
    this.x = at.x;
    this.y = at.y;
    this.anims = ensureAnims(scene, look);
    this.sprite = scene.add.sprite(at.x, at.y, heroTexture(look)).setScale(scale).play(this.anims.idle);
    // Stay visible while the portrait loads; a slow or unavailable API must never leave only a name.
    this.clickable(this.sprite);
    if (opts.still) this.sprite.anims.pause();

    // The sheets pad each figure generously, so the name sits well inside the frame.
    this.labelOffset = -this.sprite.displayHeight * 0.3;
    this.footOffset = this.sprite.displayHeight * 0.17;
    this.sprite.scaleY /= FLOOR_RATIO;
    this.shadow = groundShadow(scene, this.x, this.y + this.footOffset, HEAD * 0.85, HEAD * 0.25);
    this.fullName = name;
    this.label = crispText(scene, at.x, at.y + this.labelOffset, shortName(name), {
      fontSize: "12px",
      fontFamily: MONO,
      color: opts.nameColour,
      stroke: "#000000",
      strokeThickness: 3,
    }).setOrigin(0.5, 1);
    this.refreshLabel();
    this.place();
  }

  /** Keeps the name a readable size on screen as the camera zooms out; 1 at the village's own scale. */
  setLabelScale(scale: number): void {
    this.label.setScale(scale, scale / FLOOR_RATIO);
    this.marker?.setScale(scale, scale / FLOOR_RATIO);
    this.place();
  }

  /** Cull offscreen drawing and sprite animation; movement and API state keep running. */
  setRenderVisible(on: boolean): void {
    if (on === this.rendered) return;
    this.rendered = on;
    this.sprite.setVisible(on && !this.portrait);
    this.portrait?.setVisible(on);
    this.limbs?.setVisible(on && !this.swimming);
    this.shadow?.setVisible(on && !this.swimming);
    this.weapon?.setVisible(on && Boolean(this.portrait) && !this.swimming);
    this.activityProp?.setVisible(on);
    this.halo?.setVisible(on);
    this.marker?.setVisible(on && this.mine);
    this.ripple?.setVisible(on && this.swimming);
    if (on) { if (!this.opts.still) this.sprite.anims.resume(); this.place(); }
    else this.sprite.anims.pause();
    this.refreshLabel();
  }

  animateIdle(time: number): void {
    if (!this.rendered || !this.idle || this.opts.still || time - this.poseAt < 120) return;
    this.poseAt = time;
    this.place();
  }

  setResting(on: boolean): void {
    this.resting = on;
    this.place();
  }

  setActivityPose(state: ActivityState | null): void {
    this.activity = state;
    this.sparringPose(state, this.scene.time.now);
    if (!state) {
      this.activityProp?.clear(); this.observingWorld = false;
      if (this.sparringBeat) { this.sparringBeat = null; this.stopLunge(); }
    }
  }

  /** Observe an authoritative route; no input, client completion or new path is sent to the API. */
  observeActivity(snapshot: WorldActivity, now: number): void {
    if (!this.observingWorld) {
      this.walk?.stop(); this.walk = null; this.pause?.remove(); this.pause = null;
      this.stopLunge(); this.observingWorld = true;
    }
    const motion = snapshot.motion;
    const point = motion ? motionPosition(motion, now) : snapshot.position;
    const ahead = motion ? motionPosition(motion, now + 80) : point;
    const moving = !this.opts.still && Math.hypot(ahead.x - point.x, ahead.y - point.y) > 0.1;
    const wasWalking = this.walking;
    if (moving && !wasWalking) this.stepFrom = this.scene.time.now;
    this.setWalking(moving);
    if (moving !== wasWalking) this.sprite.play(moving ? this.anims.run : this.anims.idle, true);
    this.sprite.anims.timeScale = 0.85;
    const dx = ahead.x - point.x, dy = ahead.y - point.y;
    if (moving) this.turn(Math.abs(dy) > Math.abs(dx) * 1.2 ? (dy < 0 ? "back" : "front") : dx < 0 ? "left" : "right");
    this.x = point.x; this.y = point.y;
    this.activity = snapshot.state; this.resting = snapshot.state.phase === "resting";
    this.sparringPose(snapshot.state, now);
    // Offscreen positions still advance, while visible poses refresh at a bounded rate.
    if (this.rendered && (this.opts.still || this.scene.time.now - this.poseAt >= (moving ? 50 : 120))) {
      this.poseAt = this.scene.time.now; this.place();
    }
    if (this.opts.still) this.sprite.anims.pause();
  }

  /** Both the authoritative feed and local preview use the same alternating practice strikes. */
  private sparringPose(state: ActivityState | null, now: number): void {
    const bout = state?.sparring;
    if (bout && this.rendered && !this.opts.still && now < bout.endsAt) {
      const beat = Math.floor(Math.max(0, now - bout.startedAt) / 900);
      const key = `${bout.id}:${beat}`;
      const toward = bout.partnerPosition.x < this.x ? -1 : 1;
      this.face(toward < 0 ? "left" : "right");
      if (this.sparringBeat !== key) {
        this.sparringBeat = key;
        if (beat % 2 === bout.side) this.lunge(toward * 10);
        else this.recoil(-toward * 4);
      }
    } else if (this.sparringBeat) { this.sparringBeat = null; this.stopLunge(); }
  }

  highlight(): void {
    if (this.opts.still) return;
    const g = this.scene.add.graphics().setPosition(this.x, this.y + this.footOffset).setDepth(this.y + 200);
    g.fillStyle(0xf0ce79);
    for (const x of [-30, 24]) for (const y of [-16, 12]) {
      g.fillRect(x, y, 8, 3).fillRect(x, y, 3, 7);
    }
    this.scene.tweens.add({ targets: g, scaleX: 1.6, scaleY: 1.6, alpha: 0, duration: 1600, onComplete: () => g.destroy() });
  }

  /** Whichever the agent is drawn as answers the pointer: its name on hover, its page on a click. */
  private clickable(target: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    target.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 24 });
    target.on("pointerup", () => this.opts.onClick());
    target.on("pointerover", () => {
      this.hovered = true;
      this.refreshLabel();
    });
    target.on("pointerout", () => {
      this.hovered = false;
      this.refreshLabel();
    });
  }

  /** The agent becomes its character, once its portrait is made into textures: one for each way it can face. */
  setFace(views: { front: string; side: string; back: string }, colours: { main: number; dark: number }): void {
    if (this.portrait) return;
    this.views = views;
    this.colours = colours;
    this.sprite.setVisible(false);
    this.portrait = this.scene.add.image(this.x, this.y, views.front).setOrigin(0.5, 1).setDisplaySize(HEAD, HEAD / FLOOR_RATIO);
    this.clickable(this.portrait);
    this.turn(this.view);
    this.limbs = this.scene.add.graphics().setScale(1, 1 / FLOOR_RATIO);
    this.portrait.setVisible(this.rendered);
    this.limbs.setVisible(this.rendered);
    if (this.swimming) this.cropForWater(true);
    this.place();
  }

  /** Its weapon, held in its hand from now on. Shown only with a body to hold it: never on the stand-in knight. */
  setWeapon(name: WeaponName): void {
    if (this.weapon) return;
    const w = WEAPONS[name];
    this.weapon = this.scene.add.image(this.x, this.y, weaponTexture(name)).setOrigin(0.5, w.grip / w.h).setVisible(false);
    this.place();
  }

  /** No portrait to be had: the knight it has always been, then. */
  useSprite(): void {
    if (!this.portrait) this.sprite.setVisible(this.rendered);
  }

  private cropForWater(on: boolean): void {
    const p = this.portrait;
    if (!p) return;
    if (on) p.setCrop(0, 0, p.frame.width, p.frame.height * ABOVE_WATER);
    else p.setCrop();
    this.shadow?.setVisible(!on);
    this.limbs?.setVisible(!on);
    this.weapon?.setVisible(!on);
  }

  /**
   * The body under the head, standing on the ground at (x, ground): both legs,
   * side by side when standing and taking turns to lift as it walks, each with
   * a dark boot; the torso over them, lifted with each step; and the arms,
   * swinging against the legs, reaching out in a lunge.
   */
  private drawBody(x: number, ground: number, phase: number, hop: number, g: Painter | null = this.limbs): void {
    const c = this.colours;
    if (!g || !c) return;
    if (g === this.limbs) this.limbs.clear();
    const sideOn = this.view === "left" || this.view === "right";
    const toward = this.view === "left" ? -1 : 1;
    const top = Math.round(ground - LEG);
    for (const [side, lift] of [[-1, Math.max(0, Math.sin(phase))], [1, Math.max(0, -Math.sin(phase))]] as const) {
      const left = Math.round(x + side * (LEG_GAP / 2 + LEG_W / 2) - LEG_W / 2);
      const up = Math.round(lift * LIFT);
      // A lifted leg is shorter, its boot off the ground and a little forward.
      const forward = sideOn ? toward * Math.round(lift * 2) : 0;
      g.fillStyle(LEG_COLOUR, 1).fillRect(left, top, LEG_W, LEG - up - 2);
      // Side on, a boot points the way it walks; from the front or behind, it sits square under the leg.
      g.fillStyle(BOOT_COLOUR, 1).fillRect(left + forward - (sideOn && toward < 0 ? 1 : 0), top + LEG - up - 3, sideOn ? LEG_W + 1 : LEG_W, 3);
    }
    // The torso, outlined, over the tops of the legs.
    const w = sideOn ? TORSO_SIDE : TORSO_W;
    const chest = this.chest(ground, hop);
    const left = Math.round(x - w / 2);
    g.fillStyle(c.dark, 1).fillRect(left - 1, chest, w + 2, TORSO + 1);
    g.fillStyle(c.main, 1).fillRect(left, chest + 1, w, TORSO - 1);
    const swing = Math.sin(phase);
    const shoulder = chest + 2;
    // The weapon: upright and leaning out at rest, swinging with the arm on the march, brought down in a lunge.
    const blow = Math.min(1, Math.abs(this.lungeX) / BLOW_AT);
    if (sideOn) {
      // Side on, the near arm: swinging fore and aft from the shoulder, thrown forward in a lunge.
      const reach = this.lungeX !== 0 ? toward * (ARM - 2) : toward * swing * SWING;
      const length = this.lungeX !== 0 ? ARM - 3 : ARM;
      this.arm(x - toward, shoulder, reach, length, g);
      this.hand = { x: Math.round(x - toward + reach), y: shoulder + length, angle: toward * (HOLD + swing * MARCH + blow * BLOW) };
    } else {
      // Facing us or away, both arms at the sides: each shortens as it swings forward, against its leg.
      for (const side of [-1, 1] as const) this.arm(x + side * (w / 2 + ARM_W / 2), shoulder, 0, ARM - Math.round(Math.max(0, side * swing) * 2), g);
      // Carried in the hand on our right, leaning out.
      const length = ARM - Math.round(Math.max(0, swing) * 2);
      this.hand = { x: Math.round(x + w / 2 + ARM_W / 2), y: shoulder + length, angle: HOLD + swing * MARCH * 0.5 };
    }
  }

  /** Where the top of the torso is: over the legs, lifted a little on each step. */
  private chest(ground: number, hop: number): number {
    return Math.round(ground - LEG + 2 - hop) - TORSO;
  }

  /** One arm, from the shoulder at (x, y) down to a dark hand, `reach` pixels across and `length` down. */
  private arm(x: number, y: number, reach: number, length: number, g: Painter): void {
    const c = this.colours;
    if (!g || !c) return;
    const hx = Math.round(x + reach);
    const hy = y + length;
    g.lineStyle(ARM_W + 2, c.dark, 1).lineBetween(x, y, hx, hy);
    g.lineStyle(ARM_W, c.main, 1).lineBetween(x, y, hx, hy);
    g.fillStyle(c.dark, 1).fillRect(hx - 2, hy - 1, 4, 4);
  }

  /** Marks this as the signed-in owner's agent, or clears the mark. */
  setMine(on: boolean): void {
    if (on === this.mine) return;
    this.mine = on;
    this.markerTween?.stop();
    this.markerTween = null;
    this.marker?.destroy();
    this.marker = null;
    this.markerBob = 0;
    if (on) {
      this.marker = crispText(this.scene, this.x, this.y, "▼", {
        fontSize: "16px",
        fontFamily: MONO,
        color: "#e8b84b",
        stroke: "#000000",
        strokeThickness: 4,
      }).setOrigin(0.5, 1);
      if (!this.opts.still) {
        this.markerTween = this.scene.tweens.add({
          targets: this,
          markerBob: { from: 0, to: -5 },
          duration: 550,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: () => this.place(),
        });
      }
    }
    this.label.setColor(on ? "#e8b84b" : this.opts.nameColour);
    this.refreshLabel();
    this.place();
  }

  setName(name: string): void {
    this.fullName = name;
    this.refreshLabel();
  }

  /** Hovered, selected or the owner's own: its name shows even where it would overlap another. */
  private get nameForced(): boolean {
    return this.mine || this.hovered || this.selected;
  }

  /** The name as it would sit, for the layout to place; null when it would not show at all. */
  nameLabel(id: string): NameLabel | null {
    if (!this.rendered || !this.wantsName()) return null;
    return { id, x: this.nameSpot.x, y: this.nameSpot.y, width: this.label.displayWidth, height: this.label.displayHeight, forced: this.nameForced };
  }

  /** Where the layout put the name: nudged up or down, or hidden for another's. */
  placeName(p: Placement): void {
    if (p.dy === this.nameNudge && p.shown === this.nameAllowed) return;
    this.nameNudge = p.dy;
    this.nameAllowed = p.shown;
    this.refreshLabel();
    this.label.setPosition(this.nameSpot.x, this.nameSpot.y + this.nameNudge);
  }

  setSelected(selected: boolean): void {
    this.selected = selected;
    this.haloTween?.stop();
    this.haloTween = null;
    this.halo?.destroy();
    this.halo = null;
    if (selected) {
      ensureHalo(this.scene);
      const d = this.sprite.displayHeight * 0.7;
      this.halo = this.scene.add.image(this.x, this.y, HALO).setDisplaySize(d, d).setAlpha(0.35);
      const base = this.halo.scaleX;
      if (!this.opts.still) this.haloTween = this.scene.tweens.add({
        targets: this.halo,
        alpha: 0.75,
        scaleX: base * 1.25,
        scaleY: base * 1.25,
        duration: 650,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
    this.refreshLabel();
    this.place();
  }

  /** Out on a stroll - to the shore, the dock, the water - including the pauses along the way, so the name holds steady. */
  setRoaming(on: boolean): void {
    if (on === this.roaming) return;
    this.roaming = on;
    this.refreshLabel();
  }

  private setWalking(on: boolean): void {
    if (on === this.walking) return;
    this.walking = on;
    this.refreshLabel();
  }

  /** Whether its name would show at all, before names are kept apart. */
  /** The name tag as Top would show it, for another view to draw: its text, colour and whether it shows. */
  nameTag(): { text: string; colour: string; shown: boolean; mine: boolean; selected: boolean } {
    return { text: this.label.text, colour: this.mine ? "#f3cf70" : this.opts.nameColour, shown: this.wantsName(), mine: this.mine, selected: this.selected };
  }

  private wantsName(): boolean {
    // Standing at its hall, a house agent's name waits for the pointer: a dozen names there at once would bury the hall.
    return this.opts.named || this.mine || this.hovered || this.selected || this.walking || this.roaming;
  }

  private refreshLabel(): void {
    const text = this.hovered || this.selected ? this.fullName : shortName(this.fullName);
    if (this.label.text !== text) this.label.setText(text);
    this.label.setVisible(this.rendered && this.wantsName() && (this.nameAllowed || this.nameForced));
    this.label.setStroke(this.selected ? "#5c4a22" : "#000000", this.selected ? 5 : 3);
  }

  /** How far below the sprite's middle the water comes, in world pixels. */
  private waterline(): number {
    return (WATERLINE - FRAME / 2) * this.scale;
  }

  /**
   * Into the water or out of it. In, the frame is cut at the chest so the legs
   * are under the surface, a ripple rings the swimmer, and it bobs; either
   * way, a splash where it crossed the waterline.
   */
  private setSwimming(on: boolean): void {
    if (on === this.swimming) return;
    this.swimming = on;
    this.splash();
    if (on) {
      this.sprite.setCrop(0, 0, FRAME, WATERLINE);
      this.cropForWater(true);
      this.ripple = this.scene.add
        .ellipse(this.x, this.y + this.waterline(), 44 * this.scale * 1.6, 12 * this.scale * 1.6, 0xd8f4f2, 0.28)
        .setStrokeStyle(1.5, 0xffffff, 0.7);
      if (!this.opts.still) {
        this.bobTween = this.scene.tweens.add({
          targets: this,
          bob: { from: -1.5, to: 1.5 },
          duration: 900,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
          onUpdate: () => this.place(),
        });
      }
    } else {
      this.sprite.setCrop();
      this.cropForWater(false);
      this.bobTween?.stop();
      this.bobTween = null;
      this.bob = 0;
      this.ripple?.destroy();
      this.ripple = null;
    }
  }

  /** A ring spreading and fading on the water. */
  private splash(): void {
    // Heard only when it can be seen: a splash somewhere off screen would be a sound from nowhere.
    if (this.scene.cameras.main.worldView.contains(this.x, this.y)) sound.splash();
    if (this.opts.still) return;
    const ring = this.scene.add
      .ellipse(this.x, this.y + this.waterline(), 30 * this.scale * 1.6, 9 * this.scale * 1.6)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(this.sprite.depth + 0.2);
    this.scene.tweens.add({ targets: ring, scaleX: 2.6, scaleY: 2.6, alpha: 0, duration: 650, ease: "Quad.easeOut", onComplete: () => ring.destroy() });
  }

  /** Move the sprite and everything that follows it to (x, y), and sort by the feet. */
  private place(): void {
    if (!this.rendered) return;
    const wet = this.opts.inWater?.(this) ?? false;
    if (wet !== this.swimming) this.setSwimming(wet);
    const working = this.activity?.phase === "working" && !this.walking && !this.opts.still;
    const effort = this.effort();
    if (working && this.activity?.activity === "exploration") {
      this.turn((["front", "right", "back", "left"] as const)[Math.floor(this.scene.time.now / 2800) % 4]!);
    }
    const y = this.y + this.bob + (this.resting ? 4 : 0) + Math.max(0, effort) * 2;
    const x = this.x + this.lungeX;
    const baseline = y + this.footOffset;
    this.sprite.setPosition(x, baseline - this.footOffset / FLOOR_RATIO);
    // The character on its feet: stepping and rocking as it walks, standing square when it stops;
    // in the water, sunk to the chest at the waterline.
    let nameAt = baseline + (this.labelOffset - this.footOffset) / FLOOR_RATIO;
    if (this.portrait) {
      const { phase, hop } = this.gait();
      const ground = y + this.footOffset;
      // Standing on its body: the head sits down over the top of the torso, lifted with it on each step.
      // Knocked down, the whole figure turns over about its feet, head and body together.
      const neck = this.chest(0, hop) + NECK;
      const tilt = this.fall * this.fallSide * (Math.PI / 2);
      const foot = this.swimming
        ? { x, y: y + this.waterline() + HEAD * (1 - ABOVE_WATER) }
        : { x: x - neck * Math.sin(tilt), y: ground + neck * Math.cos(tilt) / FLOOR_RATIO };
      this.portrait.setPosition(foot.x, foot.y).setRotation(Math.sin(phase) * SWAY + effort * 0.1 + tilt);
      this.shadow?.setPosition(x + this.fallSide * this.fall * HEAD * 0.6, ground).setDisplaySize(HEAD * (0.85 - hop / (HOP * 5) + this.fall * 0.9), HEAD * 0.25);
      if (!this.swimming) {
        this.drawBody(0, 0, phase + effort, hop);
        this.limbs?.setPosition(Math.round(x), Math.round(ground)).setRotation(tilt);
        // The weapon in the hand, turning with the body when it is knocked over.
        if (this.weapon) {
          const cos = Math.cos(tilt);
          const sin = Math.sin(tilt);
          const hx = Math.round(x) + this.hand.x * cos - this.hand.y * sin;
          const hy = Math.round(ground) + (this.hand.x * sin + this.hand.y * cos) / FLOOR_RATIO;
          this.weapon.setScale(1, 1 / FLOOR_RATIO).setPosition(hx, hy).setRotation(this.hand.angle + tilt).setFlipX(this.view === "left").setVisible(!this.activity || this.activity.phase === "returning" || this.activity.activity === "sparring");
        }
      }
      // Lying down, the head is on its side: half its height above the ground rather than all of it.
      nameAt = (this.swimming ? y + this.waterline() - HEAD * ABOVE_WATER : foot.y - HEAD * (1 - 0.5 * this.fall) / FLOOR_RATIO) - 2;
    }
    this.nameSpot = { x, y: nameAt };
    this.label.setPosition(x, nameAt + this.nameNudge);
    // Over the name, bobbing, so an owner can find their agent in a crowd.
    const nameTop = this.label.visible ? this.label.displayHeight + 2 : 2;
    this.marker?.setPosition(x, nameAt + this.nameNudge - nameTop + this.markerBob).setDepth(10_001 + this.y);
    this.halo?.setPosition(this.x, this.y);
    // The frame's foot, as decorations and buildings sort, so all three interleave.
    const feet = this.y + this.footOffset;
    this.sprite.setDepth(feet + 0.5);
    this.halo?.setDepth(feet + 0.4);
    this.ripple?.setPosition(this.x, this.y + this.waterline()).setDepth(feet + 0.6);
    this.shadow?.setDepth(feet + 0.3);
    this.limbs?.setDepth(feet + 0.45);
    // In front of the body, except seen from behind, when the body is in front of it.
    this.weapon?.setDepth(feet + (this.view === "back" ? 0.44 : 0.47));
    this.portrait?.setDepth(feet + 0.5);
    this.drawActivityProp(feet, effort);
    // Names above everything in the village, so a building never hides one.
    this.label.setDepth(10_000 + feet);
  }

  /** Bending into farm or gathering work: -1..1, 0 when not working. */
  private effort(): number {
    const working = this.activity?.phase === "working" && !this.walking && !this.opts.still;
    return working && ["farming", "gathering"].includes(this.activity!.activity) ? Math.sin(this.scene.time.now / 240) : 0;
  }

  /** Where in its stride it is, and how far each step lifts it. */
  private gait(): { phase: number; hop: number } {
    const phase = this.walking && !this.swimming && !this.opts.still ? ((this.scene.time.now - this.stepFrom) / 1000) * (SPEED / STRIDE) * Math.PI * 2 : 0;
    const hop = Math.abs(Math.sin(phase)) * HOP + (!this.walking && !this.opts.still ? Math.sin(this.scene.time.now / 900) * 0.5 : 0);
    return { phase, hop };
  }

  /** Tiny native pixel props share the pose clock and are drawn only while visible. */
  private drawActivityProp(feet: number, effort: number): void {
    if (!this.activity || this.swimming) { this.activityProp?.clear(); return; }
    const state = this.activity;
    if (!state.carrying && !["working", "resting"].includes(state.phase)) { this.activityProp?.clear(); return; }
    const g = this.activityProp ??= this.scene.add.graphics();
    const density = this.scene.game.scale.zoom > 0 ? 1 / this.scene.game.scale.zoom : 1;
    const zoom = this.scene.cameras.main.zoomX / density;
    const scale = Math.min(1.8, Math.max(1, 0.9 / zoom));
    g.clear().setVisible(this.rendered).setPosition(Math.round(this.x), Math.round(feet)).setScale(scale, scale / FLOOR_RATIO).setDepth(feet + 0.55);
    // Even the distant world view keeps a small activity cue, with no detailed tool drawing.
    if (this.scene.cameras.main.worldView.width > 4200) {
      const colour = state.phase === "resting" ? 0xa9cbbb : state.activity === "sparring" ? 0xf1b36b : state.activity === "delivery" ? 0xe4bd76 : 0x8ec8a0;
      g.fillStyle(0x183c32).fillRect(10, -29, 8, 8);
      g.fillStyle(colour).fillRect(12, -27, 4, 4);
      return;
    }
    this.propShapes(g, effort);
  }

  /** The activity's prop, in the feet's own frame: a crate, hoe, basket, map, sparring ring or rest mat. */
  private propShapes(g: Painter, effort: number): void {
    const state = this.activity;
    if (!state || this.swimming) return;
    if (state.carrying) {
      g.fillStyle(0x39291e).fillRect(9, -20, 15, 13);
      g.fillStyle(0xc99553).fillRect(10, -19, 13, 11);
      g.fillStyle(0xf1d392).fillRect(15, -19, 3, 11).fillRect(10, -15, 13, 2);
    } else if (state.phase === "working" && state.activity === "farming") {
      const dy = Math.round(effort * 4);
      g.fillStyle(0x795231).fillRect(14, -20 + dy, 3, 21);
      g.fillStyle(0xd4d5ba).fillRect(10, -1 + dy, 13, 3);
      g.fillStyle(0xb29860).fillRect(20, 2, 3, 2).fillRect(7, 4, 3, 2);
    } else if (state.phase === "working" && state.activity === "gathering") {
      g.fillStyle(0x73512e).fillRect(11, -2, 15, 8);
      g.lineStyle(2, 0xdab675).strokeRect(12, -6, 12, 5);
      g.fillStyle(0x91bd62).fillRect(13, -4, 4, 4).fillRect(19, -3, 4, 3);
      if (effort > 0.3) g.fillStyle(0xe7d78c).fillRect(25, -16, 2, 7).fillRect(23, -14, 6, 2);
    } else if (state.phase === "working" && state.activity === "exploration") {
      g.fillStyle(0xe9dfaf).fillRect(10, -20, 13, 10);
      g.fillStyle(0x5d8b73).fillRect(13, -18, 3, 6).fillRect(16, -15, 5, 2);
    } else if (state.activity === "sparring" && state.phase === "working") {
      g.lineStyle(1, 0xdab675, 0.65).strokeEllipse(0, 1, 30, 10);
      if (state.sparring && Math.abs(this.lungeX) > 5) {
        const dx = this.lungeX < 0 ? -24 : 24;
        g.fillStyle(0xffe29a).fillRect(dx, -25, 2, 9).fillRect(dx - 3, -22, 8, 2);
      } else if (!state.sparring) {
        g.fillStyle(0xe2c489).fillRect(18, -28, 4, 4).fillRect(24, -28, 4, 4);
      }
    } else if (state.phase === "resting") {
      // A seat pad and slow, rising sleep pixels distinguish rest from simply standing.
      g.fillStyle(0x32675b, 0.8).fillRect(-13, 0, 26, 5);
      const lift = this.opts.still ? 0 : Math.floor(this.scene.time.now / 500) % 6;
      g.fillStyle(0xa9cbbb, 0.8).fillRect(23, -43 - lift, 7, 1).fillRect(27, -42 - lift, 2, 2).fillRect(23, -40 - lift, 7, 1);
    }
  }

  renderState() {
    return { instance: this.instance, sourceVisible: this.rendered, active: this.sprite.active,
      texture: (this.portrait ?? this.sprite).texture.key, frame: (this.portrait ?? this.sprite).frame.name,
      walking: this.walking, heading: this.view, shown: this.shown };
  }

  /**
   * Draws this character, exactly as Top composes it, onto another view's canvas: the portrait head
   * over its drawn body with its weapon and activity prop, or the sprite sheet's current frame.
   * `x, y` is where its feet stand on screen and `k` is screen pixels per world unit. Upright and
   * without Top's floor compression, like a standee. Reads state only; changes nothing in Top.
   */
  paintTo(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, paint: (ctx: CanvasRenderingContext2D) => Painter, yaw = 0): boolean {
    // The body, head and weapon are drawn as this camera sees them; the heading itself is unchanged.
    const own = this.view;
    this.view = this.shownTo(yaw);
    try { return this.paintSide(ctx, x, y, k, paint); } finally { this.view = own; }
  }

  /**
   * The side of itself this character shows a camera turned `yaw` about the world: its own heading
   * in that camera's frame. Moving the camera changes what is seen, never which way it faces.
   */
  private shownTo(yaw: number): View {
    return (this.shown = shownSide(this.view, yaw, this.shown));
  }

  private paintSide(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, paint: (ctx: CanvasRenderingContext2D) => Painter): boolean {
    const ready = (f: Phaser.Textures.Frame) => {
      const image = f?.source?.image as HTMLImageElement | HTMLCanvasElement | undefined;
      return !!image && image.width > 0 && image.height > 0 && (!(image instanceof HTMLImageElement) || image.complete && image.naturalWidth > 0);
    };
    const portrait = this.portrait && ready(this.portrait.frame) ? this.portrait : null;
    if (!portrait && !ready(this.sprite.frame)) return false;
    const frame = (f: Phaser.Textures.Frame, dx: number, dy: number, w: number, h: number) =>
      ctx.drawImage(f.source.image as CanvasImageSource, f.cutX, f.cutY, f.cutWidth, f.cutHeight, dx, dy, w, h);
    const effort = this.effort();
    const { phase, hop } = this.gait();
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y)); ctx.scale(k, k);
    ctx.imageSmoothingEnabled = false;
    const g = paint(ctx);
    if (!this.swimming) {
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath(); ctx.ellipse(0, 0, HEAD * 0.42, HEAD * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.translate(0, (this.resting ? 4 : 0) + Math.max(0, effort) * 2);
    if (portrait) {
      const weapon = this.weapon && !this.swimming && (!this.activity || this.activity.phase === "returning" || this.activity.activity === "sparring") ? this.weapon : null;
      const drawWeapon = () => {
        if (!weapon || !ready(weapon.frame)) return;
        const f = weapon.frame;
        ctx.save(); ctx.translate(this.hand.x, this.hand.y); ctx.rotate(this.hand.angle);
        if (this.view === "left") ctx.scale(-1, 1);
        frame(f, -f.cutWidth * weapon.originX, -f.cutHeight * weapon.originY, f.cutWidth, f.cutHeight);
        ctx.restore();
      };
      if (!this.swimming) {
        this.drawBody(0, 0, phase + effort, hop, g);
        // Cover the rear weapon with this body's pixels, never composite it behind the whole world.
        if (this.view === "back") { drawWeapon(); this.drawBody(0, 0, phase + effort, hop, g); }
        else drawWeapon();
      }
      // The head on the torso, lifted with each step; in water, the head alone above a ripple.
      const neck = this.swimming ? HEAD * (1 - ABOVE_WATER) : this.chest(0, hop) + NECK;
      ctx.save(); ctx.translate(0, neck); ctx.rotate(Math.sin(phase) * SWAY + effort * 0.1);
      if (this.view === "left") ctx.scale(-1, 1);
      const v = this.views, key = v && (this.view === "front" ? v.front : this.view === "back" ? v.back : v.side);
      const turned = key && key !== portrait.texture.key && this.scene.textures.exists(key) ? this.scene.textures.getFrame(key) : null;
      const f = turned && ready(turned) ? turned : portrait.frame;
      if (this.swimming) { ctx.beginPath(); ctx.rect(-HEAD, -HEAD, HEAD * 2, HEAD * ABOVE_WATER + HEAD * (1 - ABOVE_WATER)); ctx.clip(); }
      frame(f, -HEAD / 2, -HEAD, HEAD, HEAD);
      ctx.restore();
    } else {
      // The unit's sheet, on its current animation frame, centred above its padded feet.
      const f = this.sprite.frame;
      const w = this.sprite.displayWidth, h = this.sprite.displayHeight * FLOOR_RATIO;
      ctx.save(); ctx.translate(0, -this.footOffset);
      if (this.view === "left" || (this.view !== "right" && this.sprite.flipX)) ctx.scale(-1, 1);
      frame(f, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
    if (this.swimming) { ctx.fillStyle = "rgba(216,244,242,0.5)"; ctx.fillRect(-HEAD * 0.7, -1, HEAD * 1.4, 2); }
    else this.propShapes(g, effort);
    ctx.restore();
    return true;
  }

  /** Standing still, not on the way anywhere and not on the ground: free to fight. */
  get idle(): boolean {
    return this.walk === null && this.fallTween === null;
  }

  /**
   * Knocked flat by a lost match: over backwards, away from the way it faced,
   * a few seconds on the ground, and up again. Anywhere it is sent meanwhile
   * waits until it is on its feet.
   */
  knockDown(): void {
    if (this.opts.still || !this.portrait || this.swimming || this.fallTween) return;
    this.pause?.remove();
    this.pause = null;
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    this.setWalking(false);
    this.fallSide = this.view === "left" ? 1 : -1;
    this.scene.time.delayedCall(FALL_MS, () => this.dust());
    this.fallTween = this.scene.tweens.chain({
      targets: this,
      tweens: [
        { fall: 1, duration: FALL_MS, ease: "Quad.easeIn", onUpdate: () => this.place() },
        { fall: 1, duration: DOWN_MS },
        { fall: 0, duration: RISE_MS, ease: "Back.easeOut", onUpdate: () => this.place() },
      ],
      onComplete: () => this.getUp(),
    });
  }

  /** On its feet again, and off wherever it was sent while it lay there. */
  private getUp(): void {
    this.fallTween = null;
    this.fall = 0;
    this.place();
    const next = this.afterFall;
    this.afterFall = null;
    next?.();
  }

  /** A puff of dust either side of where it landed. */
  private dust(): void {
    if (!this.portrait) return;
    const at = { x: this.x + this.fallSide * HEAD * 0.7, y: this.y + this.footOffset };
    for (const dx of [-1, 1]) {
      const puff = this.scene.add.ellipse(at.x + dx * 8, at.y, 10, 5, 0xd8cbb0, 0.8).setDepth(this.y + this.footOffset + 1000);
      this.scene.tweens.add({ targets: puff, x: puff.x + dx * 12, scaleX: 2, scaleY: 1.6, alpha: 0, duration: 500, ease: "Quad.easeOut", onComplete: () => puff.destroy() });
    }
  }

  /**
   * Throw itself `dx` pixels at its opponent with a strike, and spring back:
   * one bump of a fight. `then` runs at the moment of contact.
   */
  lunge(dx: number, then?: () => void): void {
    if (this.opts.still || this.walk !== null || this.lungeTween !== null || this.fallTween !== null) return;
    this.face(dx < 0 ? "left" : "right");
    this.sprite.play(this.anims.strike, true);
    this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (this.walk === null) this.sprite.play(this.anims.idle, true);
    });
    this.lungeTween = this.scene.tweens.add({
      targets: this,
      lungeX: dx,
      duration: 150,
      ease: "Quad.easeIn",
      yoyo: true,
      hold: 60,
      onUpdate: () => this.place(),
      onYoyo: () => then?.(),
      onComplete: () => {
        this.lungeTween = null;
        this.lungeX = 0;
        this.place();
      },
    });
  }

  private stopLunge(): void {
    this.lungeTween?.stop();
    this.lungeTween = null;
    this.lungeX = 0;
  }

  /** Knocked back a step by a blow, and steadied again. */
  recoil(dx: number): void {
    if (this.opts.still || this.walk !== null || this.lungeTween !== null || this.fallTween !== null) return;
    this.lungeTween = this.scene.tweens.add({
      targets: this,
      lungeX: dx,
      duration: 90,
      ease: "Quad.easeOut",
      yoyo: true,
      onUpdate: () => this.place(),
      onComplete: () => {
        this.lungeTween = null;
        this.lungeX = 0;
        this.place();
      },
    });
  }

  /** Side on, toward one side: walking that way, or squared up to an opponent there. */
  face(side: "left" | "right"): void {
    this.sprite.setFlipX(side === "left");
    this.turn(side);
  }

  /** Which way the character shows: its face, its back, or its side, turned the way it goes. */
  private turn(view: "front" | "back" | "left" | "right"): void {
    this.view = view;
    const p = this.portrait;
    const v = this.views;
    if (!p || !v) return;
    const key = view === "front" ? v.front : view === "back" ? v.back : v.side;
    if (p.texture.key !== key) {
      p.setTexture(key);
      // A new texture resets the crop and the size: keep what the water and the scale had set.
      p.setDisplaySize(HEAD, HEAD / FLOOR_RATIO);
      if (this.swimming) this.cropForWater(true);
    }
    p.setFlipX(view === "left");
  }

  /** Be at (x, y) now, without walking there. */
  standAt(to: Point, facing?: "left" | "right"): void {
    this.pause?.remove();
    this.pause = null;
    this.resting = false;
    this.fallTween?.stop();
    this.fallTween = null;
    this.afterFall = null;
    this.fall = 0;
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    this.setWalking(false);
    this.sprite.anims.timeScale = 1;
    this.x = to.x;
    this.y = to.y;
    this.place();
    this.sprite.play(this.anims.idle, true);
    if (this.opts.still) this.sprite.anims.pause();
    // Without a facing it keeps the way it last turned: stopping is not turning to the viewer.
    if (facing) this.face(facing);
  }

  /**
   * Walk to (x, y) by the router's way - or in a straight line, for a swim -
   * then face `facing` if given and call `then`. `pace` is a share of full
   * speed: an errand is 1, a stroll less. A new walk replaces one under way,
   * and its `then` is dropped with it.
   */
  walkTo(to: Point, facing?: "left" | "right", how: { pace?: number; straight?: boolean; within?: number; pauses?: boolean; path?: readonly Point[]; then?: () => void } = {}): void {
    this.setActivityPose(null);
    if (this.opts.still) {
      this.standAt(to, facing);
      how.then?.();
      return;
    }
    if (this.fallTween) {
      this.afterFall = () => this.walkTo(to, facing, how);
      return;
    }
    this.pause?.remove();
    this.pause = null;
    this.resting = false;
    this.walk?.stop();
    this.walk = null;
    this.stopLunge();
    const from = { x: this.x, y: this.y };
    const full = how.path ?? (how.straight ? [from, to] : this.router(from, to));
    // `within` a time: hurry, however far it is - an agent called to a match that lasts seconds.
    let length = 0;
    for (let k = 1; k < full.length; k++) length += Math.hypot(full[k]!.x - full[k - 1]!.x, full[k]!.y - full[k - 1]!.y);
    const speed = Math.max(SPEED * (how.pace ?? 1), how.within ? (length / how.within) * 1000 : 0);
    const route = full.slice(1);
    const leg = () => {
      const next = route.shift();
      if (!next) {
        this.sprite.play(this.anims.idle, true);
        this.sprite.anims.timeScale = 1;
        this.setWalking(false);
        if (facing) this.face(facing);
        this.place();
        how.then?.();
        return;
      }
      const dx = next.x - this.x;
      const distance = Math.hypot(dx, next.y - this.y);
      if (distance < 5) {
        this.x = next.x;
        this.y = next.y;
        this.place();
        leg();
        return;
      }
      // Its back when going up the screen, its face when coming down, its side across.
      const dy = next.y - this.y;
      if (Math.abs(dy) > Math.abs(dx) * 1.2) {
        this.sprite.setFlipX(dx < 0);
        this.turn(dy < 0 ? "back" : "front");
      } else if (Math.abs(dx) > 5) this.face(dx < 0 ? "left" : "right");
      if (!this.walking) this.stepFrom = this.scene.time.now;
      this.setWalking(true);
      this.sprite.play(this.anims.run, true);
      // The legs keep pace with the ground, however fast it is covered.
      this.sprite.anims.timeScale = speed / SPEED;
      this.walk = this.scene.tweens.add({
        targets: this,
        x: next.x,
        y: next.y,
        duration: (distance / speed) * 1000,
        ease: "Linear",
        onUpdate: () => this.place(),
        onComplete: () => {
          this.walk = null;
          const after = route[0];
          const turning = after && dx * (after.x - next.x) + dy * (after.y - next.y) < distance * Math.hypot(after.x - next.x, after.y - next.y) * 0.65;
          if (how.pauses && !how.within && turning) {
            this.setWalking(false);
            this.sprite.play(this.anims.idle, true);
            this.pause = this.scene.time.delayedCall(450 + Math.random() * 500, () => { this.pause = null; leg(); });
          } else leg();
        },
      });
    };
    leg();
  }

  /** A few words rising off the hero and fading: a result, once it has played out. */
  float(text: string, colour: string): void {
    const t = crispText(this.scene, this.x, this.label.y - 4, text, {
      fontSize: "14px",
      fontFamily: MONO,
      fontStyle: "bold",
      color: colour,
      stroke: "#000000",
      strokeThickness: 3,
    })
      .setOrigin(0.5, 1)
      .setScale(1, 1 / FLOOR_RATIO)
      .setDepth(20_000);
    this.scene.tweens.add({
      targets: t,
      y: t.y - (this.opts.still ? 0 : 28),
      alpha: 0,
      delay: 900,
      duration: 1400,
      ease: "Sine.easeIn",
      onComplete: () => t.destroy(),
    });
  }

  /** Fade out and go, for an agent that has left the field. */
  leave(): void {
    this.pause?.remove();
    this.pause = null;
    this.walk?.stop();
    this.setSelected(false);
    this.scene.tweens.add({
      targets: [this.sprite, this.label, ...(this.portrait ? [this.portrait] : []), ...(this.shadow ? [this.shadow] : []), ...(this.limbs ? [this.limbs] : []), ...(this.weapon ? [this.weapon] : []), ...(this.ripple ? [this.ripple] : []), ...(this.activityProp ? [this.activityProp] : [])],
      alpha: 0,
      duration: this.opts.still ? 0 : 600,
      onComplete: () => this.destroy(),
    });
  }

  destroy(): void {
    this.pause?.remove();
    this.markerTween?.stop();
    this.marker?.destroy();
    this.walk?.stop();
    this.lungeTween?.stop();
    this.fallTween?.stop();
    this.haloTween?.stop();
    this.bobTween?.stop();
    this.halo?.destroy();
    this.ripple?.destroy();
    this.sprite.destroy();
    this.label.destroy();
    this.portrait?.destroy();
    this.shadow?.destroy();
    this.limbs?.destroy();
    this.weapon?.destroy();
    this.activityProp?.destroy();
  }
}
