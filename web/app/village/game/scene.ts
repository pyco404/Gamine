import { worldPerformance } from "../../../lib/world/render-performance";
// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import { standee, standingVisible } from "./billboard";
import { AGENT_ZOOM, DISTRICT_ZOOM, FLOOR_RATIO, MAX_ZOOM, followAmount, framedCentre, viewMode, type ViewMode, type WorldView } from "./presentation";
import { inMatch, type Place, type Resident } from "../residents";
import { duelPhase, meetingSpot, pathSpots, ringsInFull, WATCH_RADIUS, type Spot } from "./duels";
import { Building, type BuildingLabel } from "./building";
import { Ground } from "./ground";
import { drawGardens, GARDEN_PONDS } from "./gardens";
import { LANDSCAPE_BOXES, MOUNTAIN_BOXES } from "./landscape";
import { drawScenery } from "./scenery";
import { ActivitySimulation, ACTIVITY_CONFIG, describeActivity } from "./activities";
import type { ActivityState } from "./activities";
import { ACTIVITY_DESTINATIONS } from "./activity-destinations";
import { drawDistrictProps, drawDistrictTerrain } from "./district-scenery";
import { Hero, type Painter } from "./hero";
import { CardTable } from "./table";
import { drawDressing, drawSolarLights, loadDressing, overRoad } from "./dressing";
import { loadShips, sailShips } from "./ships";
import { buildArenaArt, drawArena, loadArena, type ArenaHandle } from "./arena";
import { ARENA_FIELD, inTown, NEW_TOWN_SITES, RESERVED, ROADS, SITES, SQUARE, townBounds } from "./town";
import { CROSSROADS, inNewTown, onOldGround, PIER, WORLD } from "./world";
import { ARENA_TORCHES } from "../../../lib/world/arena-geometry";
import type { WorldTarget } from "./projected-picking";
import { nightOf, num, VOID, warm } from "./palette";
import { chunkKey, chunksIn, chunkTrees, CHUNK, type ForestRules, type Tree } from "./forest";
import { drawMap, loadMap, type VillageMap } from "./map";
import { canopy, NEW_TOWN, openPlots, overlaps, PIECE_ART, plotClearing, type Box, type Plot } from "./growth";
import { Roads, type Point } from "./roads";
import { referenceArt } from "./reference-art";
import { directionalSet, directionalSources } from "../../../lib/world/directional-art";
import { applySolidAppearance as asSolid } from "../../../lib/world/solid-appearance";
import { byRiver, RIVER_BANKS } from "./river";
import { drawRiver } from "./river-scenery";
import { crispText, MONO } from "./text";
import { layOutNames, namesInView, type NameLabel } from "./labels";
import { agentPopulation, allocateHomes, clearRoute, neighbourhoodSpots } from "./population";
import { playhead } from "@/lib/playhead";
import { sound } from "@/lib/sound";
import { createWorldModel, plotObjects, treeObject, worldObject, type ArtFrame, type ArtRef, type TopGround, type WorldModel, type WorldObject, type WorldSnapshot, pictureObject } from "../../../lib/world/model";

/** A match being played in the arena: its two sides, the table between them, the running score over it, and the timer that drives both. */
type Brawl = { a: string; b: string; score: Phaser.GameObjects.Text; table: CardTable; ticker: Phaser.Time.TimerEvent };

/**
 * A match out in the village (duels.ts): where its two sides meet, the ring
 * drawn there, when both had arrived - the replay runs from then - and
 * whether its ring is one of those drawn in full.
 */
type Duel = {
  spot: Spot;
  /** The ring and its far-off marker; neither for the Arena's match, which has the Arena. */
  ring: Phaser.GameObjects.Graphics | null;
  marker: Phaser.GameObjects.Text | null;
  metAt: number | null;
  full: boolean;
  /** The Arena's one match (arena.ts), and its match id: the shell is told when it has played out. */
  arena: string | null;
};
/** What the scene keys a match's playing by: the Arena's showing of it, or the match. */
const keyOf = (m: { id: string; key?: string }) => m.key ?? m.id;
/** A ring's size on the ground, round the two sides and the table between them. */
const RING = { width: 156, height: 48 };
/** No ring goes this close to a building's door, where its agents queue. */
const DOOR_CLEARANCE = 120;

/** Agent Quest's own hero size; the map's saved 0.4 leaves them too small to tell apart. */
const HERO_SCALE = 0.55;
/** Space between heroes waiting at a hall. */
const GRID_X = 50;
const GRID_Y = 42;
/** A match takes two spots facing each other, this far apart. */
const PAIR_GAP = 72;
/** The Arena's one match stands in the middle of the sand (town.ts); a replay's stand-ins come in by the south gate. */
const ARENA_SPOT = { x: ARENA_FIELD.x, y: ARENA_FIELD.y };
const ARENA_GATE = { x: ARENA_FIELD.x, y: 1010 };
/** How long an agent called to a match takes to get there, from wherever it is. */
const ARRIVE_MS = 2500;
/** How far a drag goes before it is a drag and not a tap. */
const DRAG = 8;

/** House construction errands use the existing unhurried walking pace. */
const STROLL_PACE = 0.7;
/** Within this of a road, a walk keeps to the roads; beyond it, it crosses open ground. */
const NEAR_ROAD = 110;
/** The widest the camera ever looks, in world pixels: the world runs on much further than anyone needs to see at once. */
const MAX_VIEW = 5200;
/** How far past the camera's view the forest is made, and how far before it is destroyed again, in chunks. */
const FOREST_NEAR = 1;
const FOREST_FAR = 2;
/** How many of the forest's chunks are made in one frame, at most. */
const FOREST_PER_FRAME = 4;
/** How far below its chunk a tree's canopy can still show: a tree's foot is its lowest point, its crown well above. */
const FOREST_REACH = 140;
/** How far the forest's canopies keep off a road's edge. */
const FOREST_VERGE = 10;

/** How long a structure takes to rise when it opens while someone is watching, and how long its builder stays at it. */
const RISE_MS = 6_000;
const BUILD_MS = 18_000;

const COLOUR = { text: "#ede6d6", accent: "#e8b84b", live: "#6f9e5c", loss: "#d4745a", muted: "#a79f90" };

export type VillageEvents = {
  ready: () => void;
  view?: (view: WorldView) => void;
  selectAgent: (id: string | null) => void;
  selectBuilding: (id: string) => void;
  /** The Arena's match, by id, has played out in full. */
  arenaDone: (matchId: string) => void;
};

export type SceneOptions = {
  base: string;
  buildings: BuildingLabel[];
  still: boolean;
  /** The CSS font-family of the HUD's pixel face, for building names. */
  nameFont: string;
  events: VillageEvents;
};

/** The render scale the game runs at: the canvas is sized in physical pixels and zoomed back down. */
export const renderScale = (scene: Phaser.Scene) => (scene.game.scale.zoom > 0 ? 1 / scene.game.scale.zoom : 1);

export class VillageScene extends Phaser.Scene {
  private sharedWorld: WorldModel | null = null;
  private projectedForest: WorldObject[] = [];
  private forestQueue: { cx: number; cy: number }[] | null = null;
  private projectionRevision = 0;
  private measuredRevision = -1;
  private projectionPopulation = -1;
  private projectionWorld: WorldModel | null = null;
  /** Top's own fixed pictures and ground, captured once its world is drawn (captureTop). */
  private topPictures: WorldObject[] = [];
  private topGround: TopGround | null = null;
  private roads!: Roads;
  private doors = new Map<string, Point>();
  private buildings = new Map<string, Building>();
  private notes: Record<string, { text: string; lively: boolean }> = {};
  private night: Phaser.GameObjects.Rectangle | null = null;
  private isNight = false;
  private solarLights: { setNight: (on: boolean) => void } | null = null;
  private arena: ArenaHandle | null = null;
  /** Whether someone has panned or zoomed since the village was last framed: a resize then keeps their view. */
  private moved = false;
  private observing = false;
  private heroes = new Map<string, Hero>();
  private residents = new Map<string, Resident>();
  /** Who is at each place, in the order they arrived, so a newcomer joins the end rather than reshuffling everyone. */
  private order = new Map<Place, string[]>();
  /** Where each hero was last sent, so an update only moves those whose spot changed. */
  private targets = new Map<string, string>();
  private ground!: Ground;
  private fixedFootprints: { x: number; y: number; width: number; height: number }[] = [];
  private fixedBlocks: Box[] = [];
  private neighbourhoodHomes = new Map<string, Point>();
  private neighbourhoodPlaces: Point[] = [];
  /** Where retiring agents leave and new ones arrive: the map's own spawn point is in the lake, so the dry ground nearest it. */
  private gate: Point = { x: 0, y: 0 };
  /** Each resident's resting spot, updated when its hall/neighbourhood changes. */
  private home = new Map<string, Point & { facing?: "left" | "right" }>();
  /** Residents away from home. Activity work/rest uses one shared tick, not per-agent timers. */
  private strolling = new Set<string>();
  private activities: ActivitySimulation | null = null;
  /** Only the occasional house construction animation uses a delayed callback. */
  private routine = new Map<string, Phaser.Time.TimerEvent>();
  private construction = new Set<string>();
  /** Dry pier planks over the southern lake remain valid walking ground. */
  private dock: { x: number; y: number; halfWidth: number; halfHeight: number } | null = null;
  /** The forest's chunks now made, each its trees and the sprite drawn for each (forest.ts). */
  private chunks = new Map<string, { tree: Tree; sprite: Phaser.GameObjects.Image }[]>();
  private forestRules: ForestRules | null = null;
  private forestAt = "";
  private navigationChunks = new Set<string>();
  private pending: Resident[] | null = null;
  /** The map's trees, so the village can clear them as it grows (growth.ts). */
  private trees: { d: { k: string; x: number; y: number; s: number }; sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite }[] = [];
  /** Which trees have been taken down, and which plots stand. */
  private cleared = new Set<number>();
  private grown = new Set<string>();
  /** The highest real-agent count seen by this scene; opened districts do not close while watching. */
  private population = -1;
  /** Whether the village has been drawn at a count yet: only plots opening after that go up in front of the watcher. */
  private grownOnce = false;
  private placed = false;
  private selected: string | null = null;
  private dragged = false;
  private rotationEnabled = false;
  private following: string | null = null;
  private cameraTravel: Phaser.Tweens.Tween | null = null;
  private lastView = 0;
  /** How much of the canvas the bar and the page panel cover, in CSS pixels: the village is framed in the rest. */
  private inset = { top: 0, right: 0, bottom: 0 };

  constructor(
    private map: VillageMap,
    private opts: SceneOptions,
  ) {
    super({ key: "village" });
  }

  setRotationEnabled(on: boolean): void { this.rotationEnabled = on; }

  selectedAgentId(): string | null { return this.selected; }

  /** Both renderers use the original scene's selection and navigation callbacks. */
  activateWorldTarget(target: WorldTarget): void {
    if (target.kind === "building") {
      if (this.buildings.has(target.id)) this.opts.events.selectBuilding(target.id);
    } else {
      const id = target.id.replace(/^agent:/, ""), resident = this.residents.get(id);
      if (!resident || !this.heroes.has(id)) return;
      this.select(id, true);
      this.opts.events.selectAgent(resident.standIn ?? id);
    }
  }

  preload(): void {
    this.load.setPath(`${this.opts.base}/`);
    // The map's own buildings are not loaded: the town's plan (town.ts) says how each is drawn.
    loadMap(this, { ...this.map, textures: this.map.textures.filter((t) => !t.key.startsWith("building-")) });
    this.load.setPath("");
    for (const b of this.opts.buildings) {
      const site = SITES[b.id];
      if (!site) continue;
      if (b.id === "arena") continue; // The oval shares runtime art and collision geometry.
      const art = referenceArt(site.art);
      if (site.sheet) this.load.spritesheet(`building-${b.id}`, art, { frameWidth: site.sheet.width, frameHeight: site.sheet.height });
      else this.load.image(`building-${b.id}`, art);
      for (const view of directionalSources(`building-${b.id}`, art)) this.load.image(view.key, view.url);
    }
    loadDressing(this);
    // What the village grows with: New Town's buildings, lamps and planters (growth.ts).
    for (const image of new Set(NEW_TOWN.plots.flatMap((p) => p.pieces.map((x) => x.image)))) {
      const key = `growth-${image}`;
      const size: { src: string; width: number; height: number; frames?: number } = PIECE_ART[image];
      if (size.frames) this.load.spritesheet(key, warm(size.src), { frameWidth: size.width, frameHeight: size.height });
      else {
        const url = referenceArt(warm(size.src));
        this.load.image(key, url);
        for (const view of directionalSources(key, url)) this.load.image(view.key, view.url);
      }
    }
    loadArena(this);
    loadShips(this);
  }

  create(): void {
    buildArenaArt(this);
    this.sharedWorld = createWorldModel(this.map, (key) => {
      if (!this.textures.exists(key)) return null;
      const frame = this.textures.getFrame(key);
      return frame ? { width: frame.realWidth, height: frame.realHeight } : null;
    }, Object.fromEntries(this.opts.buildings.map((b) => [b.id, b.label])));
    this.map = this.sharedWorld.map;
    this.cameras.main.setBackgroundColor(VOID);
    // The dressing (dressing.ts), then the map with the town's roads (town.ts) in place of its own: its
    // forest, less what stands where the town is - its buildings, their props, its roads.
    const dressing = drawDressing(this, this.opts.still, this.sharedWorld.pieces);
    const districts = drawDistrictProps(this, this.sharedWorld.districtPieces);
    const solids = [...dressing.solids, ...districts.solids];
    const taken = this.sharedWorld.lots;
    this.trees = drawMap(this, this.sharedWorld.map);
    drawDistrictTerrain(this);
    drawGardens(this, taken);
    drawScenery(this, this.opts.still);
    drawRiver(this, this.opts.still);

    for (const def of this.opts.buildings) {
      const site = this.sharedWorld.sites[def.id];
      if (!site) continue;
      const click = () => {
        if (!this.dragged) this.opts.events.selectBuilding(def.id);
      };
      const building = new Building(this, def, site, click, this.opts.nameFont, this.opts.still);
      this.doors.set(def.id, building.door);
      this.buildings.set(def.id, building);
    }
    this.roads = new Roads(
      [...this.sharedWorld.map.paths.map((p) => p.points.map(([x, y]) => ({ x, y }))), ...this.sharedWorld.hiddenRoads],
      [...this.doors.values()],
    );
    // A building is solid as its picture's box, but the arena as its walls: agents fight inside it.
    const footprints = [...this.buildings].filter(([id]) => !SITES[id]?.blocks).map(([, b]) => b.footprint);
    const blocks = Object.values(SITES).flatMap((s) => s.blocks ?? []);
    this.fixedFootprints = [...footprints, ...solids];
    this.fixedBlocks = [...blocks, ...GARDEN_PONDS, ...MOUNTAIN_BOXES];
    this.ground = new Ground(this.map, this.fixedFootprints, this.fixedBlocks, RESERVED);
    this.ground.blockTrunks(this.trees.map((t) => t.d));
    // Where a match out in the village may meet: along every path.
    this.ringSpots = pathSpots(ROADS);
    // Open ground for a ring when the paths are full: Old Town's and New Town's, not the Wilds'.
    this.ringClearings = this.ground.anywhere.filter((p) => inTown(p) || inNewTown(p));
    this.gate = this.ground.nearestDry(this.map.spawn);
    this.sharedWorld = { ...this.sharedWorld, objects: this.sharedWorld.objects.map((o) => o.id === "movement:spawn" ? { ...o, x: this.gate.x, y: this.gate.y } : o) };

    // The existing southern pier remains walkable; routine activities do not send agents swimming.
    this.dock = { x: PIER.x, y: PIER.y + 20, halfWidth: 22, halfHeight: 70 };

    // One sailboat on the lake, clear of the pier.
    sailShips(this, this.ground, { count: 1, still: this.opts.still, moored: null, rocks: [], dock: PIER });

    // The forest beyond Old Town (forest.ts): made a chunk at a time round the camera, and destroyed away from it.
    this.forestRules = {
      inOldTown: (p) => onOldGround(p),
      // A small verge either side of every road, so the forest reads as cut back from it.
      onRoad: (p, s) => overRoad({ k: "tree", x: p.x, y: p.y, s }, ROADS, FOREST_VERGE) || CROSSROADS.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 110),
      taken: [...taken, ...this.newTownLots(), ...GARDEN_PONDS, ...LANDSCAPE_BOXES, ...RIVER_BANKS],
      cleared: [],
    };
    this.events.on("update", () => this.tendForest());
    this.activities = new ActivitySimulation(ACTIVITY_DESTINATIONS, {
      position: (id) => this.heroes.get(id) ?? null,
      prepare: (id, to) => {
        const hero = this.heroes.get(id);
        if (!hero) return null;
        const path = this.route(hero, to), end = path.at(-1);
        // A* may reject a route or choose a dry substitute. Stay within the work site's area.
        return path.length >= 2 && end && Math.hypot(end.x - to.x, end.y - to.y) <= 96 &&
          clearRoute(path, (p) => this.ground.walkable(p) || this.onDock(p)) ? path : null;
      },
      travel: (id, path, arrived) => this.heroes.get(id)?.walkTo(path.at(-1)!, undefined,
        { path, pace: ACTIVITY_CONFIG.pace, then: arrived }),
      rest: (id, resting) => this.heroes.get(id)?.setResting(resting),
    });

    // Night: the palette's own (palette.ts nightOf) - every colour multiplied darker and a little cooler,
    // so the same hues hold - over the world, under the names so they still read.
    const w = WORLD.x1 - WORLD.x0;
    const h = WORLD.y1 - WORLD.y0;
    this.night = this.add
      .rectangle(WORLD.x0 + w / 2, WORLD.y0 + h / 2, w * 2, h * 2, num(nightOf("#ffffff")), 1)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setDepth(9_000);
    this.night.setVisible(this.isNight);
    this.solarLights = drawSolarLights(this, this.opts.still);
    this.solarLights.setNight(this.isNight);
    this.arena = drawArena(this, this.opts.still);
    this.arena.setNight(this.isNight);
    this.captureTop();

    this.setUpCamera();
    this.setNotes(this.notes);
    this.opts.events.ready();
    if (this.pending) this.setResidents(this.pending);
  }

  // --- Growth -------------------------------------------------------------

  /** Read-only projections observe the live scene; they never create another simulation. */
  /**
   * Top is the source of truth for every other view. Once its fixed world is drawn - before any
   * agent, forest chunk or boat - every standing picture it placed is recorded with its exact
   * texture, frame, natural size and foot, and its whole ground layer (terrain, roads, plazas,
   * water, banks, beds, flowers, shadows) is rendered once to an image laid on the ground plane.
   * Other views then show the same world by construction rather than by a parallel layout.
   */
  private readonly frameArt = new Map<string, ArtFrame>();

  private captureTop(): void {
    worldPerformance.count("phaserCaptures");
    // The arena keeps its own 3D form on the shared footprint; boats sail; glows and shadows are effects.
    const skip = new Set(["building-arena", "ac-oval-front", "ac-oval-crowd", "ac-oval-cheer", "dress-ship", "dress-solar-glow", "world-pixel-shadow",
      // The lake's animals swim: the world camera draws them live (sea-life.ts), not in the still ground.
      "sea-fish", "sea-turtle", "sea-ray"]);
    const labels = new Map(this.sharedWorld!.objects.filter((o) => o.id.startsWith("site:")).map((o) => [o.id, o.metadata?.label]));
    const flatKey = /farm-bed|plot|yard|planter/i;
    this.topPictures = [];
    for (const [i, obj] of this.children.list.entries()) {
      if (!(obj instanceof Phaser.GameObjects.Image || obj instanceof Phaser.GameObjects.Sprite)) continue;
      if (!obj.visible || obj.alpha === 0 || obj.depth < WORLD.y0 || obj.depth >= 9_000 || skip.has(obj.texture.key)) continue;
      const key = obj.texture.key;
      const width = obj.displayWidth, height = obj.displayHeight * (obj.getData("standee") ? FLOOR_RATIO : 1);
      const foot = { x: obj.x + obj.displayWidth * (0.5 - obj.originX), y: obj.y + obj.displayHeight * (1 - obj.originY) };
      const site = /^building-(.+)$/.exec(key)?.[1];
      const o = pictureObject(site ? `site:${site}` : `top:${i}:${key}`, { key, frame: obj.frame.name, flipX: obj.flipX }, foot, width, height, flatKey.test(key));
      this.withViews(o);
      asSolid(o);
      if (site) { o.type = "building"; o.metadata!.label = labels.get(`site:${site}`) ?? site; }
      if (key === "wild-mountain") { o.metadata!.label = "Mountain"; o.metadata!.landmark = true; }
      this.topPictures.push(o);
    }
    // Top draws these as shapes rather than pictures; they come from the same shared positions.
    for (const [i, p] of ARENA_TORCHES.entries()) this.topPictures.push({ ...worldObject(`torch:${i}`, "prop", p.x, p.y, 10, 8, 46), metadata: { texture: "torch" } });
    // Ground: every visible layer below the standing art, through a camera that sees the whole world from above.
    const scale = 0.5, w = WORLD.x1 - WORLD.x0, h = WORLD.y1 - WORLD.y0;
    type Layer = Phaser.GameObjects.GameObject & { depth: number; visible?: boolean; mask?: unknown; texture?: { key: string } };
    const layers = (this.children.list as Layer[]).filter((o) => o.depth < WORLD.y0 && o.visible !== false && !o.mask && !skip.has(o.texture?.key ?? ""))
      .sort((a, b) => a.depth - b.depth);
    const texture = this.textures.addDynamicTexture("top-ground", Math.ceil(w * scale), Math.ceil(h * scale));
    if (!texture) return;
    texture.camera.setZoom(scale);
    texture.camera.centerOn(WORLD.x0 + w / 2, WORLD.y0 + h / 2);
    texture.draw(layers);
    texture.render();
    texture.snapshot((image) => {
      if (image instanceof HTMLImageElement) {
        this.topGround = { image, x0: WORLD.x0, y0: WORLD.y0, width: w, height: h };
        this.projectionRevision++;
      }
      this.textures.remove("top-ground");
    });
  }

  /** Where another view's camera is looking, so the matches nearest it are the ones drawn in full. */
  private viewCentre: Point | null = null;
  setViewCentre(p: Point | null): void { this.viewCentre = p; }

  /** Each Bluff & Fold ring out in the village, as it lies on the ground, for another view. */
  matchRings(): { x: number; y: number; rx: number; ry: number; alpha: number }[] {
    return [...this.duels.values()].filter((d) => d.ring && d.full && d.ring.visible)
      .map((d) => ({ x: d.spot.x, y: d.spot.y + 12, rx: RING.width / 2, ry: RING.height / 2, alpha: d.ring!.alpha }));
  }

  /**
   * Each match being played, for another view: its two players' ground points, and a painter
   * that draws its card table between them and its score over them, given where each player's
   * feet are on that view's screen.
   */
  matchTables(): { a: Point; b: Point; paint: (ctx: CanvasRenderingContext2D, a: Point, b: Point, k: number, projectWorld: (p: Point, z: number) => Point) => void }[] {
    const out: ReturnType<VillageScene["matchTables"]> = [];
    for (const brawl of this.brawls.values()) {
      const ha = this.heroes.get(brawl.a), hb = this.heroes.get(brawl.b);
      if (!ha || !hb) continue;
      out.push({ a: { x: ha.x, y: ha.y }, b: { x: hb.x, y: hb.y }, paint: (ctx, a, b, k, projectWorld) => {
        brawl.table.paintTo(ctx, a, b, k, projectWorld);
        const score = brawl.score;
        if (!score.active || !score.visible || !score.text) return;
        ctx.save();
        ctx.font = `bold 13px ${MONO}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        const x = (a.x + b.x) / 2, y = Math.min(a.y, b.y) - 76 * Math.max(k, 0.6);
        ctx.lineWidth = 4; ctx.strokeStyle = "#000"; ctx.strokeText(score.text, x, y);
        ctx.fillStyle = String(score.style.color); ctx.fillText(score.text, x, y);
        ctx.restore();
      } });
    }
    return out;
  }

  /** Gives a pictured structure its back, left and right views and how it stands, where they exist. */
  private withViews(o: WorldObject): WorldObject {
    if (!o.directionalAssets) return o;
    const { assets, structure } = directionalSet(o.directionalAssets.front!, (k) => this.textures.exists(k));
    o.directionalAssets = assets;
    if (structure) o.structure = structure;
    return o;
  }

  /** Draws a live agent's own Top character onto another view's canvas; false if it has none. */
  paintAgent(id: string, ctx: CanvasRenderingContext2D, x: number, y: number, k: number, paint: (ctx: CanvasRenderingContext2D) => Painter, yaw = 0): boolean {
    const hero = this.heroes.get(id.replace(/^agent:/, ""));
    if (!hero) return false;
    return hero.paintTo(ctx, x, y, k, paint, yaw);
  }

  private visibleAgents: ReadonlySet<string> | null = null;
  setVisibleAgents(ids: ReadonlySet<string> | null): void { this.visibleAgents = ids; }
  inspectAgent(id: string) { return this.heroes.get(id.replace(/^agent:/, ""))?.renderState() ?? null; }
  /** Each agent's name tag, as Top would show it (Hero.nameTag). */
  nameTag(id: string) { return this.heroes.get(id.replace(/^agent:/, ""))?.nameTag() ?? null; }

  agentSnapshot(): WorldSnapshot["agents"] {
    return [...this.heroes].map(([id, h]) => ({ ...worldObject(`agent:${id}`, "agent", h.x, h.y, 20, 14, 38),
      metadata: { label: this.residents.get(id)?.name, mine: this.mine.has(id) } }));
  }

  worldSnapshot(): WorldSnapshot | null {
    if (!this.sharedWorld || !this.forestRules) return null;
    if (this.projectionPopulation !== this.grown.size) {
      this.projectionPopulation = this.grown.size;
      this.projectedForest = [];
      this.forestQueue = chunksIn(this.sharedWorld.bounds);
      this.projectionWorld = null;
    }
    // Generate the identical seeded forest independently of Top's streamed sprite visibility.
    // Bound main-thread work per snapshot, then retain the full geometry across view switches.
    const fresh = this.forestQueue?.splice(0, 3) ?? [];
    worldPerformance.count("forestChunks",fresh.length);
    for (const c of fresh) this.projectedForest.push(...chunkTrees(c.cx, c.cy, this.forestRules).map(treeObject));
    if (!this.projectionWorld || fresh.length) {
      worldPerformance.count("worldBuilds");
      const plots = NEW_TOWN.plots.filter((p) => this.grown.has(p.id));
      const clearings = plots.map((p) => plotClearing(p, 180));
      // Top's captured pictures replace the model's own sprite placements; the model keeps what Top
      // draws as shapes rather than pictures (arena, bridges, fences, surfaces) and the activity spots.
      // Bridge decks are part of Top's ground layer, so the model's raised deck would draw them twice.
      const kept = new Set(["arena", "road", "water", "pond", "plaza", "movement"]);
      const source = this.topPictures.length
        ? [...this.sharedWorld.objects.filter((o) => kept.has(o.type) || o.metadata?.texture === "fence"), ...this.topPictures]
        : this.sharedWorld.objects;
      const base = source.map((o) => asSolid(o)).filter((o) => o.type !== "tree" || !clearings.some((b) => {
        const p = o.metadata?.topAnchor ?? o;
        const s = o.width / 192;
        return overlaps(canopy({ ...p, s }), b);
      }));
      this.projectionWorld = { ...this.sharedWorld, objects: [...base, ...plots.flatMap(plotObjects).map((o) => asSolid(this.withViews(o))), ...this.projectedForest] };
      this.projectionRevision++;
    }
    const agents = this.agentSnapshot();
    const art = (ref: ArtRef): ArtFrame | null => {
      if (!this.textures.exists(ref.key)) return null;
      const f = this.textures.getFrame(ref.key, ref.frame);
      if (!f) return null;
      const key = `${ref.key}:${ref.frame}`, image = f.source.image as CanvasImageSource;
      const cached = this.frameArt.get(key);
      if (cached?.image === image) return cached;
      worldPerformance.count("textureDecodes");
      const frame: ArtFrame = { image, x: f.cutX, y: f.cutY, width: f.cutWidth, height: f.cutHeight };
      const canvas = document.createElement("canvas"); canvas.width = frame.width; canvas.height = frame.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
      const pixels = ctx.getImageData(0, 0, frame.width, frame.height).data;
      let x0 = frame.width, y0 = frame.height, x1 = -1, y1 = -1;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        if (pixels[(y * frame.width + x) * 4 + 3]! < 32) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      if (x1 >= x0) frame.content = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
      this.frameArt.set(key, frame);
      return frame;
    };
    // Measure every side's picture once per world, not the first time a rotation turns it into view.
    if (this.measuredRevision !== this.projectionRevision) {
      this.measuredRevision = this.projectionRevision;
      for (const o of this.projectionWorld.objects) for (const ref of Object.values(o.directionalAssets ?? {})) if (ref) art(ref);
    }
    return { world: this.projectionWorld, revision: this.projectionRevision, agents, night: this.isNight, forestPending: !!this.forestQueue?.length,
      ground: this.topGround, art };
  }

  /**
   * The village grows with real agents across all tokens (growth.ts): each plot that has opened
   * is built, and the trees on its ground come down. The first count a page
   * hears is the village as it stands, drawn at once. A plot that opens while
   * someone is watching goes up in front of them: a house agent walks over
   * and stands at it while it rises. Presentation only.
   */
  private growPopulation(count: number): void {
    if (count <= this.population) return;
    this.population = count;
    const live = this.grownOnce && !this.opts.still;
    this.grownOnce = true;
    const fresh = openPlots(NEW_TOWN, count).filter((p) => !this.grown.has(p.id));
    for (const plot of fresh) {
      this.grown.add(plot.id);
      const pieces = this.build(plot);
      // Its ground is cleared for good: the forest never grows a tree there again (forest.ts), and the
      // trees standing there now come down.
      const clearing = plotClearing(plot, 180);
      if (this.forestRules) this.forestRules = { ...this.forestRules, cleared: [...this.forestRules.cleared, clearing] };
      for (const chunk of this.chunks.values()) {
        for (const t of chunk) {
          if (!t.sprite.active || !overlaps(canopy(t.tree), clearing)) continue;
          const sprite = t.sprite;
          if (live) this.tweens.add({ targets: sprite, alpha: 0, duration: 1_500, onComplete: () => sprite.destroy() });
          else sprite.destroy();
        }
      }
      for (const t of this.trees) if (overlaps(canopy(t.d), clearing)) standingVisible(t.sprite, false);
      if (live) this.rise(plot, pieces);
    }
    if (fresh.length > 0) this.refreshNeighbourhoods();
    // The land has grown: frame it all, unless someone has moved the view, which is theirs.
    if (fresh.length > 0 && !this.moved) this.fit();
  }

  /** New buildings are solid, and their dry forecourts become residential destinations. */
  private refreshNeighbourhoods(): void {
    const plots = NEW_TOWN.plots.filter((p) => this.grown.has(p.id));
    const footprints = plots.flatMap((plot) => plot.pieces.filter((p) => p.image !== "planter").map((p) => {
      const art = PIECE_ART[p.image];
      return { x: p.x, y: p.y + art.height * p.scale * (1 - art.foot), width: art.width * p.scale, height: art.height * p.scale };
    }));
    this.ground = new Ground(this.map, [...this.fixedFootprints, ...footprints], this.fixedBlocks, RESERVED);
    this.navigationChunks.clear();
    this.ground.blockTrunks(this.trees.filter((t) => t.sprite.visible).map((t) => t.d));
    this.ringClearings = this.ground.anywhere.filter((p) => inTown(p) || inNewTown(p));
    const clear = (p: Point) => this.ground.walkable(p) && !RESERVED.some((b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1);
    this.neighbourhoodPlaces = neighbourhoodSpots(plots, clear);
  }

  /** New Town's ground nothing grows on: its fixed buildings and their forecourts (the plots clear their own as they open). */
  private newTownLots(): Box[] {
    return [...NEW_TOWN_SITES].flatMap((id) => {
      const s = SITES[id];
      return s ? [{ x0: s.x - 160, y0: s.y - 230, x1: s.x + 160, y1: s.y + 90 }] : [];
    });
  }

  /**
   * The forest round the camera (forest.ts): every chunk the view comes near
   * is made, and every chunk it has left far behind is destroyed - its
   * sprites gone, not hidden - and made again, the same, if it comes back.
   * The Wilds are thick, so only the chunks in view are drawn: those made
   * ahead of the camera wait hidden, and a few are made a frame, nearest
   * first, so zooming out never stalls a phone on a whole ring of them.
   */
  private tendForest(): void {
    const rules = this.forestRules;
    if (!rules) return;
    const v = this.cameras.main.worldView;
    // In view: a tree's canopy rises above its foot, so a chunk just below the view can show in it.
    const seen: Box = { x0: v.x - 80, y0: v.y - 40, x1: v.right + 80, y1: v.bottom + FOREST_REACH };
    const at = [seen.x0, seen.y0, seen.x1, seen.y1].map((n) => Math.floor(n / CHUNK)).join();
    if (at === this.forestAt) return;
    const grow = (n: number): Box => ({ x0: v.x - n * CHUNK, y0: v.y - n * CHUNK, x1: v.right + n * CHUNK, y1: v.bottom + n * CHUNK });
    const shown = new Set(chunksIn(seen).map((c) => chunkKey(c.cx, c.cy)));
    const keep = new Set(chunksIn(grow(FOREST_FAR)).map((c) => chunkKey(c.cx, c.cy)));
    for (const [key, trees] of this.chunks) {
      if (keep.has(key)) continue;
      for (const t of trees) t.sprite.destroy();
      this.chunks.delete(key);
    }
    const mid = { x: (v.x + v.right) / 2 / CHUNK, y: (v.y + v.bottom) / 2 / CHUNK };
    const missing = chunksIn(grow(FOREST_NEAR))
      .filter(({ cx, cy }) => !this.chunks.has(chunkKey(cx, cy)))
      .sort((a, b) => Math.hypot(a.cx + 0.5 - mid.x, a.cy + 0.5 - mid.y) - Math.hypot(b.cx + 0.5 - mid.x, b.cy + 0.5 - mid.y));
    for (const { cx, cy } of missing.slice(0, FOREST_PER_FRAME)) {
      this.chunks.set(
        chunkKey(cx, cy),
        chunkTrees(cx, cy, rules).map((tree) => {
          const sprite = this.add.image(tree.x, tree.y, tree.k, tree.f).setOrigin(0.5, 1).setScale(tree.s);
          sprite.setDepth(tree.y);
          standee(sprite, true);
          return { tree, sprite };
        }),
      );
    }
    for (const [key, trees] of this.chunks) {
      const on = shown.has(key);
      for (const t of trees) if (t.sprite.active && t.sprite.visible !== on) standingVisible(t.sprite, on);
    }
    // Done for this view only once every chunk near it is made; until then, a few more next frame.
    if (missing.length <= FOREST_PER_FRAME) this.forestAt = at;
    this.debugCount();
  }

  /** In development, what the forest holds now, for checking memory on a phone-sized run. Never in a production build. */
  private debugCount(): void {
    if (process.env.NODE_ENV === "production") return;
    let trees = 0;
    for (const c of this.chunks.values()) trees += c.length;
    let drawn = 0;
    for (const c of this.chunks.values()) for (const t of c) if (t.sprite.visible) drawn++;
    (window as unknown as { __village?: object }).__village = {
      chunks: this.chunks.size, trees, drawn, objects: this.children.length, textures: this.textures.getTextureKeys().length,
      camera: { zoom: this.cameras.main.zoomX / renderScale(this), floorRatio: this.cameras.main.zoomY / this.cameras.main.zoomX, x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y, following: this.following, selected: this.selected },
      sample: [...this.heroes.entries()].slice(0, 8).map(([id, hero]) => ({ id, x: hero.x, y: hero.y,
        activity: this.residents.get(id) ? this.activityState(this.residents.get(id)!, this.time.now) : null,
        recent: this.activities?.recent(id) })),
      activities: [...this.heroes.keys()].reduce((counts, id) => {
        const state = this.residents.get(id) ? this.activityState(this.residents.get(id)!, this.time.now) : null;
        if (state) { counts[state.activity] = (counts[state.activity] ?? 0) + 1; counts[state.phase] = (counts[state.phase] ?? 0) + 1; }
        return counts;
      }, {} as Record<string, number>),
      agents: this.heroes.size, population: this.population, plots: this.grown.size, neighbourhoodHomes: this.neighbourhoodHomes.size,
    };
  }

  /** Draws a plot's pieces at the depth of their feet, like everything else on the ground. */
  private build(plot: Plot): (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[] {
    return plot.pieces.flatMap((p) => {
      const key = `growth-${p.image}`;
      if (!this.textures.exists(key)) return [];
      const size: { foot: number; frames?: number } = PIECE_ART[p.image];
      const obj = size.frames ? this.add.sprite(p.x, p.y, key, 0) : this.add.image(p.x, p.y, key);
      obj.setOrigin(0.5, size.foot).setScale(p.scale).setFlipX(p.flip ?? false).setDepth(p.y);
      if (size.frames && obj instanceof Phaser.GameObjects.Sprite && !this.opts.still) {
        const anim = `${key}:loop`;
        if (!this.anims.exists(anim)) this.anims.create({ key: anim, frames: this.anims.generateFrameNumbers(key, {}), frameRate: 6, repeat: -1 });
        obj.play(anim);
      }
      if (!["Plot", "Yard", "planter"].includes(p.image)) standee(obj, p.image !== "lamp");
      return [obj];
    });
  }

  /** A plot going up: a house agent comes to build it, and it rises out of the ground. */
  private rise(plot: Plot, pieces: (Phaser.GameObjects.Image | Phaser.GameObjects.Sprite)[]): void {
    for (const obj of pieces) {
      const full = obj.scaleY;
      obj.setScale(obj.scaleX, 0).setAlpha(0.6);
      this.tweens.add({ targets: obj, scaleY: full, alpha: 1, duration: RISE_MS, ease: "Sine.easeOut" });
    }
    const builder = this.builder();
    if (!builder) return;
    const hero = this.heroes.get(builder)!;
    this.stopRoutine(builder);
    this.construction.add(builder);
    this.roam(builder, true);
    hero.walkTo(plot.door, undefined, {
      pace: STROLL_PACE,
      then: () => this.after(builder, BUILD_MS, () => this.goHome(builder, hero)),
    });
  }

  /** A house agent waiting at its hall and not already out: the one to send to a new plot. */
  private builder(): string | null {
    for (const [id, r] of this.residents) {
      if (r.house && this.heroes.has(id) && this.isHall(r.place) && !this.construction.has(id) && this.activityState(r, this.time.now)?.phase === "resting" && id !== this.selected) return id;
    }
    return null;
  }

  // --- Camera -------------------------------------------------------------

  /** The part of the world with the buildings and the people in front of them, and whatever the village has grown into. */
  private villageBounds(): Phaser.Geom.Rectangle {
    // Arrive in the landscaped town centre. Outlying districts stay a pan
    // away, rather than shrinking every landmark as the holder count grows.
    const b = townBounds();
    return new Phaser.Geom.Rectangle(b.x0 - 160, b.y0 - 100, b.x1 - b.x0 + 320, b.y1 - b.y0 + 330);
  }

  /**
   * Never so far out that the world stops covering the whole canvas: the
   * village is the page's background, edge to edge, on a screen of any shape.
   * On a tall enough window this outranks maxZoom.
   */
  private minZoom(): number {
    const cam = this.cameras.main;
    // The world is larger than anyone needs to see at once: no further out than MAX_VIEW across.
    return Math.max(cam.width / (WORLD.x1 - WORLD.x0), cam.height / ((WORLD.y1 - WORLD.y0) * FLOOR_RATIO), cam.width / MAX_VIEW);
  }

  /**
   * The camera never looks past the world's edge, so there is never an empty
   * strip beside the map. Framing around a panel gives way to this: near an
   * edge, the village sits as close to the middle of the open part as the
   * world allows.
   */
  private updateBounds(): void {
    this.cameras.main.setBounds(WORLD.x0, WORLD.y0, WORLD.x1 - WORLD.x0, WORLD.y1 - WORLD.y0);
    this.rescaleLabels();
  }

  /** Building names keep a readable size on screen however far out the village is zoomed, as a game's map labels do. */
  private rescaleLabels(): void {
    // Capped so the longest name ("Rulebook House") still fits between its neighbours on a phone.
    const scale = Phaser.Math.Clamp((0.85 * renderScale(this)) / this.cameras.main.zoomX, 0.35, 1.45);
    for (const b of this.buildings.values()) b.setLabelScale(scale);
    for (const h of this.heroes.values()) h.setLabelScale(this.heroLabelScale());
  }

  /** Agents' names keep a readable size too, up to a point: past it, they would crowd the whole map. */
  private heroLabelScale(): number {
    return Phaser.Math.Clamp((0.9 * renderScale(this)) / this.cameras.main.zoomX, 0.45, 1.8);
  }

  private maxZoom(): number {
    return MAX_ZOOM * renderScale(this);
  }

  /** The canvas's uncovered part, in canvas pixels: its size, and how far its centre sits from the canvas's. */
  private visible(): { width: number; height: number; dx: number; dy: number } {
    const cam = this.cameras.main;
    const r = renderScale(this);
    const top = this.inset.top * r;
    const right = this.inset.right * r;
    const bottom = this.inset.bottom * r;
    return { width: Math.max(1, cam.width - right), height: Math.max(1, cam.height - top - bottom), dx: right / 2, dy: (bottom - top) / 2 };
  }

  /** Upright art keeps its size while the floor is foreshortened. Logical coordinates never change. */
  private setZoom(zoom: number): void {
    const x = Phaser.Math.Clamp(zoom, this.minZoom(), this.maxZoom());
    this.cameras.main.setZoom(x, x * FLOOR_RATIO);
    this.rescaleLabels();
  }

  private centreOn(x: number, y: number): void {
    const { dx, dy } = this.visible();
    const target = framedCentre({ x, y }, dx, dy, this.cameras.main.zoomX);
    this.cameras.main.centerOn(target.x, target.y);
  }

  private worldZoom(): number {
    const v = this.villageBounds();
    const { width, height } = this.visible();
    let zoom = Math.min(width / v.width, height / (v.height * FLOOR_RATIO));
    if (height > width) zoom = Math.max(zoom, width / 1100);
    return zoom;
  }

  private fit(): void {
    this.moved = false;
    this.setZoom(this.worldZoom());
    this.updateBounds();
    const v = this.villageBounds();
    this.centreOn(v.centerX, v.centerY);
  }

  /** Dragging, pinching and wheel zoom hand control back to the visitor. */
  private releaseCamera(): void {
    this.cameraTravel?.stop();
    this.cameraTravel = null;
    this.following = null;
  }

  /** Pan and zoom together; recompute a moving agent's endpoint during the transition. */
  private travelTo(point: Point, zoom: number): void {
    this.cameraTravel?.stop();
    this.cameraTravel = null;
    this.moved = true;
    const cam = this.cameras.main;
    const from = { x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoomX };
    const goal = Phaser.Math.Clamp(zoom, this.minZoom(), this.maxZoom());
    const step = { t: 0 };
    const paint = () => {
      this.setZoom(Phaser.Math.Linear(from.zoom, goal, step.t));
      const hero = this.following ? this.heroes.get(this.following) : null;
      const { dx, dy } = this.visible();
      const target = framedCentre(hero ?? point, dx, dy, cam.zoomX);
      cam.centerOn(Phaser.Math.Linear(from.x, target.x, step.t), Phaser.Math.Linear(from.y, target.y, step.t));
    };
    if (this.opts.still) { step.t = 1; paint(); return; }
    this.cameraTravel = this.tweens.add({ targets: step, t: 1, duration: 900, ease: "Sine.easeInOut", onUpdate: paint,
      onComplete: () => { this.cameraTravel = null; } });
  }

  showView(mode: ViewMode): void {
    if (this.observing && mode !== "agent") return;
    if (!this.roads) return;
    this.releaseCamera();
    if (mode === "agent" && this.selected && this.heroes.has(this.selected)) {
      this.following = this.selected;
      this.travelTo(this.heroes.get(this.selected)!, AGENT_ZOOM * renderScale(this));
    } else if (mode === "world") {
      const v = this.villageBounds();
      this.travelTo({ x: v.centerX, y: v.centerY }, this.worldZoom());
    } else this.travelTo({ x: this.cameras.main.midPoint.x, y: this.cameras.main.midPoint.y }, (mode === "agent" ? AGENT_ZOOM : DISTRICT_ZOOM) * renderScale(this));
  }

  lookAt(point: Point): void {
    if (this.observing) return;
    if (!this.roads) return;
    this.releaseCamera();
    this.travelTo(point, DISTRICT_ZOOM * renderScale(this));
  }

  private followCamera(delta: number): void {
    if (!this.following || this.cameraTravel) return;
    const hero = this.heroes.get(this.following);
    if (!hero) { this.releaseCamera(); return; }
    const cam = this.cameras.main;
    const { dx, dy } = this.visible();
    const target = framedCentre(hero, dx, dy, cam.zoomX);
    const amount = followAmount(delta, this.opts.still);
    cam.centerOn(Phaser.Math.Linear(cam.midPoint.x, target.x, amount), Phaser.Math.Linear(cam.midPoint.y, target.y, amount));
  }

  /** A small HUD snapshot, never a React node per resident. */
  private publishView(time: number): void {
    if (time - this.lastView < 200) return;
    this.lastView = time;
    this.debugCount();
    const cam = this.cameras.main, hero = this.selected ? this.heroes.get(this.selected) : null;
    const resident = this.selected ? this.residents.get(this.selected) : null;
    const activity = resident ? this.activityState(resident, time) : null;
    this.opts.events.view?.({
      mode: viewMode(cam.zoomX / renderScale(this), this.following !== null), following: this.following !== null,
      selected: hero && resident ? { id: resident.standIn ?? resident.id, name: resident.name, house: resident.house,
        activity: inMatch(resident.place) ? "Competing" : activity ? describeActivity(activity) : hero.idle ? "Resting" : "Walking",
        destination: inMatch(resident.place) ? "Arena / live match" : activity?.route ?? activity?.destination ?? "Home forecourt",
        activityState: activity ?? null, x: hero.x, y: hero.y } : null,
      bounds: { x: cam.worldView.x, y: cam.worldView.y, width: cam.worldView.width, height: cam.worldView.height },
    });
  }

  /** The bar, the panel or the tab bar moved: frame the village again in what they leave uncovered. */
  setInsets(inset: { top: number; right: number; bottom: number }): void {
    const i = this.inset;
    if (inset.top === i.top && inset.right === i.right && inset.bottom === i.bottom) return;
    this.inset = inset;
    if (this.roads && !this.moved) this.fit();
  }

  /** Zoom with the world point under (sx, sy) kept where it is on screen. */
  private zoomAround(sx: number, sy: number, zoom: number): void {
    this.releaseCamera();
    this.moved = true;
    const cam = this.cameras.main;
    const x = sx - cam.width / 2, y = sy - cam.height / 2;
    const before = { x: cam.midPoint.x + x / cam.zoomX, y: cam.midPoint.y + y / cam.zoomY };
    this.setZoom(zoom);
    this.updateBounds();
    cam.centerOn(before.x - x / cam.zoomX, before.y - y / cam.zoomY);
  }

  zoomBy(step: number): void {
    if (this.observing) return;
    if (!this.roads) return;
    const { width, height } = this.visible();
    this.zoomAround(width / 2, height / 2, this.cameras.main.zoomX * (step > 0 ? 1.25 : 0.8));
  }

  private setUpCamera(): void {
    const cam = this.cameras.main;
    this.fit();
    // A resize keeps what is being looked at rather than throwing away where
    // someone has panned or zoomed to; a big one scales the zoom with it.
    // A resize frames the village again - unless someone has moved the view, which it then keeps, still covering the canvas.
    let density = renderScale(this);
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      cam.setViewport(0, 0, size.width, size.height);
      // A new density changes what every zoom value means, so a view kept from before would be wrong: frame again.
      const now = renderScale(this);
      if (now !== density) {
        const zoom = cam.zoomX / density * now;
        density = now;
        if (!this.moved) return this.fit();
        this.setZoom(zoom);
        this.updateBounds();
        return;
      }
      if (!this.moved) return this.fit();
      const centre = cam.midPoint.clone();
      this.setZoom(cam.zoomX);
      this.updateBounds();
      cam.centerOn(centre.x, centre.y);
    });

    // Drag to look around, with a threshold so a tap still selects.
    let start = { x: 0, y: 0 };
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      start = { x: p.x, y: p.y };
      this.dragged = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (this.observing) return;
      if (!p.isDown || (this.input.pointer1.isDown && this.input.pointer2.isDown)) return;
      if (!this.dragged && Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > DRAG) this.dragged = this.moved = true;
      if (this.dragged) {
        if (this.rotationEnabled) return;
        this.releaseCamera();
        cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoomX;
        cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoomY;
      }
    });
    // A tap on nothing clears the selection.
    this.input.on("pointerup", (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.observing) return;
      if (!this.dragged && over.length === 0) { this.select(null, false); this.opts.events.selectAgent(null); }
    });

    // The page scrolls in its panel, so the wheel over the village is the village's: it zooms.
    this.input.on("wheel", (p: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.observing) return;
      this.zoomAround(p.x, p.y, cam.zoomX * Math.exp(-dy * 0.002));
    });

    // Names kept apart every frame: agents walk, and the camera moves and zooms. Rings too.
    this.events.on("update", (time: number, delta: number) => {
      if (!this.opts.still) this.activities?.tick(this.time.now);
      for (const [id, hero] of this.heroes) {
        const resident = this.residents.get(id);
        if (resident?.worldActivity && this.isHall(resident.place) && !this.construction.has(id)) {
          const now = resident.worldActivity.at + Math.max(0, performance.now() - (resident.worldReceivedAt ?? performance.now()));
          hero.observeActivity(resident.worldActivity, now);
        } else hero.setActivityPose(resident ? this.activities?.state(id, this.time.now) ?? null : null);
      }
      this.followCamera(delta);
      this.publishView(time);
      const view = this.cameras.main.worldView;
      for (const [id, hero] of this.heroes) {
        const visible = this.visibleAgents ? this.visibleAgents.has(`agent:${id}`) :
          hero.x >= view.x - 130 && hero.x <= view.right + 130 && hero.y >= view.y - 150 && hero.y <= view.bottom + 150;
        hero.setRenderVisible(visible);
        if (visible) hero.animateIdle(time);
      }
      this.frameDuels();
      this.layOutNames();
    });

    // Pinch to zoom on touch, about the point between the fingers.
    this.input.addPointer(1);
    let pinch = { dist: 0, zoom: 0 };
    this.events.on("update", () => {
      const [a, b] = [this.input.pointer1, this.input.pointer2];
      if (this.observing) return;
      if (!a.isDown || !b.isDown) {
        pinch.dist = 0;
        return;
      }
      this.dragged = true;
      const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
      if (pinch.dist === 0) pinch = { dist, zoom: cam.zoomX };
      else this.zoomAround((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.zoom * (dist / pinch.dist));
    });
  }

  /**
   * No two names overlap (labels.ts): building names stay put and win; agents'
   * names are nudged up or down, or hidden until hovered, nearest the middle of
   * the screen first.
   */
  private layOutNames(): void {
    const names: NameLabel[] = [];
    for (const [id, hero] of this.heroes) {
      const n = hero.nameLabel(id);
      if (n) names.push(n);
    }
    // Building names, and the running score over each match, stay put: agents' names move off them.
    const fixed = [...this.buildings.values()].map((b) => b.labelBounds());
    for (const b of this.brawls.values()) {
      if (!b.score.visible) continue;
      const r = b.score.getBounds();
      fixed.push({ x0: r.x, y0: r.y, x1: r.right, y1: r.bottom });
    }
    const view = this.cameras.main.worldView;
    const visible = namesInView(names, { x0: view.x, y0: view.y, x1: view.right, y1: view.bottom }, this.cameras.main.midPoint, this.cameras.main.zoomX / renderScale(this) < 0.75 ? 0 : 40);
    const visibleIds = new Set(visible.map((n) => n.id));
    for (const n of names) if (!visibleIds.has(n.id)) this.heroes.get(n.id)?.placeName({ dy: 0, shown: false });
    const placed = layOutNames(visible, fixed, this.cameras.main.midPoint);
    for (const [id, p] of placed) this.heroes.get(id)?.placeName(p);
  }

  // --- Residents ----------------------------------------------------------

  /** The lines under the buildings' names; lively ones, with someone there, in the live colour. */
  setNotes(notes: Record<string, { text: string; lively: boolean }>): void {
    this.notes = notes;
    for (const [id, b] of this.buildings) {
      const n = notes[id];
      if (n) b.setNote(n.text, n.lively ? COLOUR.live : COLOUR.text);
    }
  }

  setNight(on: boolean): void {
    this.isNight = on;
    this.night?.setVisible(on);
    this.solarLights?.setNight(on);
    this.arena?.setNight(on);
  }

  /** Marks the signed-in owner's agents; an empty set when nobody is signed in. */
  setMine(ids: ReadonlySet<string>): void {
    this.mine = new Set(ids);
    for (const [id, hero] of this.heroes) hero.setMine(this.mine.has(id));
  }

  setObservation(on: boolean): void {
    this.observing = on;
  }

  /** Brings the camera to the owner's next agent in the village, in turn; false when none is here. */
  findMine(): boolean {
    const here = [...this.mine].filter((id) => this.heroes.has(id));
    if (here.length === 0) return false;
    this.found = (this.found + 1) % here.length;
    this.select(here[this.found]!, true);
    return true;
  }

  select(id: string | null, pan: boolean): void {
    if (this.selected) this.heroes.get(this.selected)?.setSelected(false);
    const key = id && !this.heroes.has(id) ? [...this.residents.values()].find((r) => r.standIn === id)?.id ?? id : id;
    this.selected = key;
    const hero = key ? this.heroes.get(key) : undefined;
    hero?.setSelected(true);
    if (hero && pan) {
      this.following = key;
      this.travelTo(hero, AGENT_ZOOM * renderScale(this));
      hero.highlight();
    } else if (!key) this.releaseCamera();
  }

  setResidents(incoming: Resident[]): void {
    if (!this.roads) {
      this.pending = incoming;
      return;
    }
    this.pending = null;
    this.latest = incoming;
    this.growPopulation(agentPopulation(incoming));
    const people = incoming.filter((r) => !r.house && !r.standIn && r.place !== "gate");
    // The first twelve real residents per hall keep the central forecourt. Others live in new districts.
    const atHall = new Map<string, number>();
    const neighbours = people.filter((r) => {
      const n = (atHall.get(r.hall) ?? 0) + 1;
      atHall.set(r.hall, n);
      return n > 12 || this.neighbourhoodHomes.has(r.id);
    });
    const validHomes = new Map([...this.neighbourhoodHomes].filter(([, p]) => this.ground.walkable(p)));
    this.neighbourhoodHomes = allocateHomes(neighbours.map((r) => r.id), this.neighbourhoodPlaces, validHomes);
    const list = this.withHeld(incoming);
    const ids = new Set(list.map((r) => r.id));

    for (const [id, hero] of this.heroes) {
      if (ids.has(id)) continue;
      hero.leave();
      this.heroes.delete(id);
      this.residents.delete(id);
      this.targets.delete(id);
      this.unorder(id);
      this.stopRoutine(id);
      this.home.delete(id);
      if (this.selected === id) this.select(null, false);
    }

    const spawn = this.gate;
    for (const r of list) {
      const before = this.residents.get(r.id);
      let hero = this.heroes.get(r.id);
      if (!hero) {
        hero = new Hero(this, this.route, r.look, r.name, r.standIn ? ARENA_GATE : spawn, HERO_SCALE, {
          named: !r.house,
          nameColour: r.house ? COLOUR.text : COLOUR.accent,
          still: this.opts.still,
          onClick: () => {
            if (this.observing) return;
            if (!this.dragged) { this.select(r.id, true); this.opts.events.selectAgent(r.standIn ?? r.id); }
          },
          inWater: (p) => this.ground.inWater(p) && !this.onDock(p),
        });
        this.heroes.set(r.id, hero);
        hero.setLabelScale(this.heroLabelScale());
        if (this.mine.has(r.id)) hero.setMine(true);
        if (r.id === this.selected) hero.setSelected(true);
      } else {
        hero.setName(r.name);
      }
      // A match has played out when its sides stop playing it - back to a hall,
      // or straight into the next one: its result then, and not before.
      if (before?.match && inMatch(before.place) && (r.match ? keyOf(r.match) : null) !== keyOf(before.match)) {
        hero.float(...this.result(before.match));
        // The side that lost goes down, and gets up a few seconds later.
        if (before.match.net < 0) hero.knockDown();
        // Once a match, for the side that heard it first, and only when it ended in view.
        if (!this.heard.has(before.match.id) && this.cameras.main.worldView.contains(hero.x, hero.y)) {
          if (this.heard.size > 500) this.heard.clear();
          this.heard.add(before.match.id);
          sound.fanfare(before.match.net === 0);
        }
      }
      if (before?.place !== r.place) {
        this.unorder(r.id);
        const here = this.order.get(r.place) ?? [];
        here.push(r.id);
        this.order.set(r.place, here);
      }
      this.residents.set(r.id, r);
    }

    for (const [id, spot] of this.spots()) {
      const resident = this.residents.get(id)!;
      if (resident.worldActivity !== undefined && this.isHall(resident.place)) {
        this.activities?.remove(id);
        this.home.set(id, resident.worldActivity?.position ?? spot);
        this.roam(id, true);
        if (resident.worldActivity && !this.construction.has(id)) {
          const now = resident.worldActivity.at + Math.max(0, performance.now() - (resident.worldReceivedAt ?? performance.now()));
          this.heroes.get(id)!.observeActivity(resident.worldActivity, now);
        }
        continue;
      }
      const key = `${Math.round(spot.x)},${Math.round(spot.y)},${spot.facing ?? ""}`;
      if (this.targets.get(id) === key) continue;
      this.targets.set(id, key);
      const hero = this.heroes.get(id)!;
      const waiting = this.isHall(this.residents.get(id)?.place);
      if (waiting) {
        this.home.set(id, spot);
        if (this.activities?.has(id)) this.activities.add(id, spot, this.time.now);
      }
      else {
        // Matches and retirement always take priority over a world activity.
        this.stopRoutine(id);
        this.home.delete(id);
      }
      // An active routine uses its new home on return without restarting its journey.
      if (waiting && this.strolling.has(id)) continue;
      // The hall's grid reshuffles whenever someone comes or goes; stepping to a new spot is not a new
      // arrival, so it leaves a routine already under way alone rather than starting its wait over.
      const then = waiting ? () => this.routine.has(id) || this.standAWhile(id) : undefined;
      // The first time the village fills, everyone is already where they belong.
      // To a match, at a run: it lasts seconds, and the fight is the point.
      const toFight = inMatch(this.residents.get(id)?.place ?? "gate");
      if (this.placed) hero.walkTo(spot, spot.facing, { then, ...(toFight ? { within: ARRIVE_MS } : {}) });
      else {
        hero.standAt(spot, spot.facing);
        then?.();
      }
    }
    if (list.length > 0) this.placed = true;
    this.syncBrawls();
    this.debugCount();
  }

  // --- Autonomous world activities ------------------------------------------

  private isHall(place: Place | undefined): boolean {
    return place === "tavern" || place === "forge" || place === "castle";
  }

  /** The way from one point to another: by road inside the village, over dry ground out in the world. */
  private route = (from: Point, to: Point): Point[] => {
    // Collision is prepared from the same seed as rendered trees, even before a distant chunk is drawn.
    // Cache tile occupancy, not sprites, so following a walker never creates the entire forest.
    if (this.forestRules) for (const { cx, cy } of chunksIn({ x0: Math.min(from.x, to.x) - CHUNK, y0: Math.min(from.y, to.y) - CHUNK, x1: Math.max(from.x, to.x) + CHUNK, y1: Math.max(from.y, to.y) + CHUNK })) {
      const key = chunkKey(cx, cy);
      if (this.navigationChunks.has(key)) continue;
      this.navigationChunks.add(key);
      this.ground.blockTrunks(chunkTrees(cx, cy, this.forestRules).filter((t) => t.k.includes("tree")));
    }
    if (this.roads.near(from, NEAR_ROAD) && this.roads.near(to, NEAR_ROAD)) {
      const path = this.roads.route(from, to);
      if (clearRoute(path, (p) => this.ground.walkable(p) || this.onDock(p))) return path;
    }
    return this.ground.route(from, to);
  };

  private stopRoutine(id: string): void {
    this.construction.delete(id);
    this.routine.get(id)?.remove();
    this.routine.delete(id);
    this.activities?.remove(id);
    this.heroes.get(id)?.setResting(false);
    this.heroes.get(id)?.setActivityPose(null);
    this.roam(id, false);
  }

  /** While a resident is on an activity or construction errand, its name can show. */
  private roam(id: string, on: boolean): void {
    if (on) this.strolling.add(id);
    else this.strolling.delete(id);
    this.heroes.get(id)?.setRoaming(on);
  }

  private after(id: string, ms: number, then: () => void): void {
    this.routine.get(id)?.remove();
    this.routine.set(id, this.time.delayedCall(ms, () => {
      this.routine.delete(id);
      then();
    }));
  }

  /** Start once on arrival; feed refreshes update home without restarting the activity. */
  private standAWhile(id: string): void {
    if (this.opts.still || !this.isHall(this.residents.get(id)?.place) || this.residents.get(id)?.worldActivity !== undefined) return;
    const home = this.home.get(id);
    if (!home) return;
    this.activities?.add(id, home, this.time.now);
    this.roam(id, true);
  }

  private activityState(resident: Resident, time: number): ActivityState | null {
    if (inMatch(resident.place) || resident.place === "gate") return null;
    const snapshot = resident.worldActivity;
    if (!snapshot) return this.activities?.state(resident.id, time) ?? null;
    const now = snapshot.at + Math.max(0, performance.now() - (resident.worldReceivedAt ?? performance.now()));
    const state = snapshot.state;
    return { ...state, progress: state.completesAt ? Math.max(0, Math.min(snapshot.motion ? 0.95 : 1,
      (now - state.startedAt) / Math.max(1, state.completesAt - state.startedAt))) : 0 };
  }

  /** Back to its spot at the hall, and the routine starts over there. */
  private goHome(id: string, hero: Hero): void {
    hero.setResting(false);
    const home = this.home.get(id);
    if (!home) {
      this.construction.delete(id);
      return this.roam(id, false);
    }
    hero.walkTo(home, home.facing, {
      pace: STROLL_PACE,
      then: () => {
        this.construction.delete(id);
        this.roam(id, false);
        this.standAWhile(id);
      },
    });
  }

  /** Whether p is on the dock's planks, which lie over the water but are walked, not swum. */
  private onDock(p: Point): boolean {
    const d = this.dock;
    return d !== null && Math.abs(p.x - d.x) < d.halfWidth && Math.abs(p.y - d.y) < d.halfHeight;
  }

  private unorder(id: string): void {
    for (const who of this.order.values()) {
      const i = who.indexOf(id);
      if (i !== -1) who.splice(i, 1);
    }
  }

  private result(match: NonNullable<Resident["match"]>): [string, string] {
    if (match.net === 0) return ["level", COLOUR.muted];
    if (match.exhibition) return match.net > 0 ? ["won", COLOUR.live] : ["lost", COLOUR.loss];
    return match.net > 0 ? [`+${match.net}`, COLOUR.live] : [`−${Math.abs(match.net)}`, COLOUR.loss];
  }

  /** Where everyone should stand: a grid at each hall, facing pairs at the arena, a huddle at the gate. */
  private spots(): Map<string, Point & { facing?: "left" | "right" }> {
    const out = new Map<string, Point & { facing?: "left" | "right" }>();
    for (const [place, ids] of this.order) {
      if (ids.length === 0) continue;
      if (place === "gate") {
        ids.forEach((id, i) => out.set(id, { x: this.gate.x + ((i % 5) - 2) * 18, y: this.gate.y + Math.floor(i / 5) * 18 }));
        continue;
      }
      if (place === "duel" || place === "arena") {
        this.layOutDuels(ids, out);
        continue;
      }
      const door = this.doors.get(place);
      if (!door) continue;
      const central = ids.filter((id) => !this.neighbourhoodHomes.has(id));
      const cols = Math.ceil(Math.sqrt(central.length));
      central.forEach((id, i) => {
        out.set(id, this.ground.nearestDry({ x: door.x - ((cols - 1) * GRID_X) / 2 + (i % cols) * GRID_X, y: door.y + Math.floor(i / cols) * GRID_Y }));
      });
      for (const id of ids) {
        const home = this.neighbourhoodHomes.get(id);
        if (home) out.set(id, home);
      }
    }
    return out;
  }

  // --- Matches at the table -----------------------------------------------

  private brawls = new Map<string, Brawl>();
  /** The signed-in owner's agents, and which of them "find" went to last. */
  private mine = new Set<string>();
  private found = -1;
  /** Matches whose end has already been sounded: both sides leave the arena, but it ends once. */
  private heard = new Set<string>();

  /** A brawl for every match with both its sides in the arena, and none for a match that is over. */
  private syncBrawls(): void {
    const fights = new Map<string, [string, string]>();
    for (const r of this.residents.values()) {
      if (!inMatch(r.place) || r.match?.seat !== "A") continue;
      const o = this.residents.get(r.match.opponent.id);
      if (o?.place === r.place && o.match && keyOf(o.match) === keyOf(r.match)) fights.set(keyOf(r.match), [r.id, o.id]);
    }
    // A ring whose match is over for both its sides - one of them pulled into a newer match - goes.
    for (const id of this.duels.keys()) if (!fights.has(id)) this.removeDuel(id);
    for (const [id, b] of this.brawls) {
      if (fights.has(id)) continue;
      b.ticker.remove();
      b.score.destroy();
      b.table.destroy();
      this.brawls.delete(id);
    }
    for (const [id, [a, b]] of fights) if (!this.brawls.has(id)) this.startBrawl(id, a, b);
    // The crowd is on its feet while the Arena's match is on.
    this.arena?.setCheering([...this.duels.values()].some((d) => d.arena !== null && d.metAt !== null));
  }

  private startBrawl(id: string, a: string, b: string): void {
    const score = crispText(this, 0, 0, "", {
      fontSize: "15px",
      fontFamily: MONO,
      fontStyle: "bold",
      color: COLOUR.accent,
      stroke: "#000000",
      strokeThickness: 4,
    })
      .setOrigin(0.5, 1)
      .setDepth(19_000)
      .setVisible(false);
    const brawl: Brawl = {
      a,
      b,
      score,
      table: new CardTable(this, this.opts.still),
      // Often enough that a round's choices land in step with the live feed's.
      ticker: this.time.addEvent({ delay: 100, loop: true, callback: () => this.keepScore(id) }),
    };
    this.brawls.set(id, brawl);
    this.keepScore(id);
  }

  /**
   * The running score over the fighters: rounds won by each, left and right as
   * they stand, moving when a round's outcome shows on the live feed and not
   * before - the same clock (lib/playhead) - and the winner's side lit at the end.
   */
  private keepScore(id: string): void {
    const brawl = this.brawls.get(id);
    const ha = brawl && this.heroes.get(brawl.a);
    const hb = brawl && this.heroes.get(brawl.b);
    const clock = brawl && this.residents.get(brawl.a)?.match?.clock;
    if (!brawl || !ha || !hb) return;
    // Over them once they have squared up; not while they are still on their way.
    const together = ha.idle && hb.idle && Math.abs(ha.y - hb.y) < 10;
    // Out in the village the replay starts when both have arrived, whenever the server finished the match;
    // in the Arena it keeps the live feed's clock.
    const duel = this.duels.get(id);
    let startedAt = clock?.startedAt ?? 0;
    // The Arena's match, out in the village or in the Arena, plays from when both sides are in.
    if (duel) {
      if (together && duel.metAt === null) duel.metAt = Date.now();
      if (duelPhase(Date.now(), duel.metAt, clock?.playMs ?? null) === "done") return this.endDuel(id);
      if (!duel.full) {
        brawl.score.setVisible(false);
        brawl.table.hide();
        return;
      }
      startedAt = duel.metAt ?? 0;
    }
    brawl.score.setVisible(together && clock !== null && clock !== undefined);
    if (!together || !clock) return;
    const { round, phase, within } = playhead(clock.roundsWon.length, Date.now() - startedAt, clock.playMs);
    brawl.table.place({ x: ha.x, y: ha.y }, { x: hb.x, y: hb.y }, this.heroLabelScale());
    brawl.table.show(round, phase, within, clock.rounds[round] ?? null);
    const shown = phase === "outcome" || phase === "final" ? clock.roundsWon[round] : clock.roundsWon[round - 1];
    const won = shown ?? { A: 0, B: 0 };
    // Seat A stands on the left. At the end a star marks the side that took the match; a level match has none.
    const star = (s: "A" | "B") => (phase === "final" && won[s] > won[s === "A" ? "B" : "A"] ? "★" : "");
    const text = phase === "final" ? `${star("A")}${won.A} – ${won.B}${star("B")}` : `R${round + 1}  ${won.A} – ${won.B}`;
    // A replay in the Arena says so over the fighters, as the Arena's sign does.
    brawl.score.setText(this.residents.get(brawl.a)?.match?.replay ? `REPLAY  ${text}` : text);
    brawl.score.setColor(phase === "final" ? COLOUR.live : COLOUR.accent);
    brawl.score.setScale(this.heroLabelScale());
    // High enough to clear the choices said over each side's head.
    brawl.score.setPosition((ha.x + hb.x) / 2, Math.min(ha.y, hb.y) - 58);
  }

  // --- Duels ---------------------------------------------------------------

  /** Matches out in the village, by match id (duels.ts). */
  private duels = new Map<string, Duel>();
  /** Agents kept at their duel after the server has moved on, until its replay is done. */
  private held = new Map<string, Resident>();
  /** Duels already replayed: a match still in the page's list after its replay is not played again. */
  private replayed = new Set<string>();
  /** What the page last sent, to apply again when a duel lets its agents go. */
  private latest: Resident[] = [];
  /** The spots on the paths a ring may go (duels.ts), and the open ground in town for when the paths are full. */
  private ringSpots: Spot[] = [];
  private ringClearings: Spot[] = [];

  /**
   * The page's list, with each agent at a duel kept there until its replay is
   * done: the server's playback can end before the two sides have even met, and
   * the village plays the match out after, never cutting it short.
   */
  private withHeld(list: Resident[]): Resident[] {
    return list.map((r) => {
      if (r.match && this.replayed.has(keyOf(r.match))) return { ...r, place: r.hall, match: null };
      if (r.match) {
        if (r.place === "duel") this.held.set(r.id, r);
        else this.held.delete(r.id);
        return r;
      }
      const kept = this.held.get(r.id);
      if (!kept || r.place === "gate") {
        this.held.delete(r.id);
        return r;
      }
      return { ...r, place: "duel", match: kept.match };
    });
  }

  /** Whether a ring may go at p: clear ground for both sides, off the Arena's sand, away from every door. */
  private ringOpen = (p: Spot): boolean => {
    const half = PAIR_GAP / 2;
    if (![p, { x: p.x - half, y: p.y }, { x: p.x + half, y: p.y }].every((q) => this.ground.walkable(q))) return false;
    if (RESERVED.some((r) => p.x > r.x0 - 40 && p.x < r.x1 + 40 && p.y > r.y0 - 40 && p.y < r.y1 + 40)) return false;
    // Not on the fountain's plaza: a ring there would sit round the fountain.
    if (((p.x - SQUARE.x) / (SQUARE.rx + 90)) ** 2 + ((p.y - SQUARE.y) / (SQUARE.ry + 50)) ** 2 < 1) return false;
    return [...this.doors.values()].every((d) => Math.hypot(d.x - p.x, d.y - p.y) > DOOR_CLEARANCE);
  };

  /**
   * Each match out in the village at its meeting spot, and the Arena's in the
   * middle of the sand: seat A on the left, the two facing each other.
   */
  private layOutDuels(ids: string[], out: Map<string, Point & { facing?: "left" | "right" }>): void {
    const seen = new Set<string>();
    for (const id of ids) {
      const r = this.residents.get(id);
      const match = r?.match;
      if (!match || seen.has(keyOf(match))) continue;
      seen.add(keyOf(match));
      const other = match.opponent.id;
      const [a, b] = match.seat === "A" ? [id, other] : [other, id];
      const duel = this.duels.get(keyOf(match)) ?? (r.place === "arena" ? this.openArena(keyOf(match), match.id) : this.openDuel(keyOf(match), a, b));
      if (!duel) continue;
      out.set(a, { x: duel.spot.x - PAIR_GAP / 2, y: duel.spot.y, facing: "right" });
      if (ids.includes(b)) out.set(b, { x: duel.spot.x + PAIR_GAP / 2, y: duel.spot.y, facing: "left" });
    }
  }

  /** Where two agents meet, and the ring drawn there. */
  private openDuel(matchId: string, a: string, b: string): Duel | null {
    const at = (id: string) => this.heroes.get(id) ?? this.gate;
    const taken = [...this.duels.values()].filter((d) => d.arena === null).map((d) => d.spot);
    const spot = meetingSpot(at(a), at(b), this.ringSpots, taken, this.ringOpen, undefined, this.ringClearings);
    if (!spot) return null;
    const ring = this.add.graphics().setDepth(spot.y - 30).setAlpha(this.opts.still ? 1 : 0);
    const cy = spot.y + 12;
    ring.fillStyle(0x0c1018, 0.3).fillEllipse(spot.x, cy, RING.width, RING.height);
    ring.lineStyle(3, 0xe8b84b, 0.9).strokeEllipse(spot.x, cy, RING.width, RING.height);
    ring.lineStyle(1, 0x5c4a22, 0.9).strokeEllipse(spot.x, cy, RING.width - 10, RING.height - 6);
    if (!this.opts.still) this.tweens.add({ targets: ring, alpha: 1, duration: 400 });
    const marker = crispText(this, spot.x, spot.y - 24, "⚔", {
      fontSize: "16px",
      fontFamily: MONO,
      color: COLOUR.accent,
      stroke: "#000000",
      strokeThickness: 4,
    })
      .setOrigin(0.5, 1)
      .setDepth(19_000)
      .setVisible(false);
    const duel: Duel = { spot, ring, marker, metAt: null, full: true, arena: null };
    this.duels.set(matchId, duel);
    return duel;
  }

  /** The Arena's match: in the middle of the sand, always drawn in full, and no ring - the Arena is its ring. */
  private openArena(key: string, matchId: string): Duel {
    const duel: Duel = { spot: ARENA_SPOT, ring: null, marker: null, metAt: null, full: true, arena: matchId };
    this.duels.set(key, duel);
    return duel;
  }

  /** The replay is over: its ring fades, its two sides are let go, and the result shows over them. */
  private endDuel(id: string): void {
    const brawl = this.brawls.get(id);
    const arena = this.duels.get(id)?.arena ?? null;
    this.replayed.add(id);
    if (this.replayed.size > 500) this.replayed.clear();
    if (brawl) {
      this.held.delete(brawl.a);
      this.held.delete(brawl.b);
    }
    this.removeDuel(id);
    this.setResidents(this.latest);
    // The shell picks what the Arena shows next (arena.ts) and sends everyone again.
    if (arena) this.opts.events.arenaDone(arena);
  }

  private removeDuel(id: string): void {
    const duel = this.duels.get(id);
    if (!duel) return;
    this.duels.delete(id);
    duel.marker?.destroy();
    const ring = duel.ring;
    if (!ring) return;
    if (this.opts.still) ring.destroy();
    else this.tweens.add({ targets: ring, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
  }

  /**
   * Every frame: the RING_CAP rings nearest the middle of the screen drawn in
   * full and the rest as a marker; and idle agents near a ring in play turn to
   * watch it.
   */
  private frameDuels(): void {
    if (this.duels.size === 0) return;
    const full = ringsInFull(
      [...this.duels].filter(([, d]) => d.arena === null).map(([id, d]) => ({ id, ...d.spot })),
      this.viewCentre ?? this.cameras.main.midPoint,
    );
    const scale = this.heroLabelScale();
    for (const [id, d] of this.duels) {
      if (d.arena !== null) continue;
      d.full = full.has(id);
      d.ring?.setVisible(d.full);
      d.marker?.setVisible(!d.full).setScale(scale);
    }
    const watched = [...this.duels.values()].filter((d) => d.full && d.metAt !== null);
    if (watched.length === 0) return;
    for (const [id, hero] of this.heroes) {
      const r = this.residents.get(id);
      if (!r || inMatch(r.place) || r.place === "gate" || !hero.idle) continue;
      const ring = watched.find((d) => Math.hypot(d.spot.x - hero.x, d.spot.y - hero.y) < WATCH_RADIUS);
      if (ring) hero.face(ring.spot.x < hero.x ? "left" : "right");
    }
  }
}
