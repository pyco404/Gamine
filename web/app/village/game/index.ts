// Adapted from Agent Quest (MIT, see ./LICENSE).
import * as Phaser from "phaser";
import type { ViewMode } from "./presentation";
import type { Point } from "./roads";
import type { Resident } from "../residents";
import type { BuildingLabel } from "./building";
import type { Painter } from "./hero";
import type { VillageMap } from "./map";
import { VOID } from "./palette";
import { VillageScene, type VillageEvents } from "./scene";
import { prepareWorldMap, type WorldSnapshot } from "../../../lib/world/model";
import type { WorldTarget } from "./projected-picking";

export type { BuildingLabel } from "./building";

export type WorldCameraControls = {
  zoom: (step: 1 | -1) => void;
  lookAt: (point: Point) => void;
  view: (mode: ViewMode) => void;
  follow: (id: string | null) => void;
};

export type VillageHandle = {
  snapshot: () => WorldSnapshot | null;
  agents: () => WorldSnapshot["agents"];
  setVisibleAgents: (ids: ReadonlySet<string> | null) => void;
  /** An agent's name tag as Top would show it, for the world camera to draw. */
  nameTag: (id: string) => ReturnType<VillageScene["nameTag"]>;
  /** Live Bluff & Fold matches, for the world camera to draw: rings on the ground, tables and scores. */
  matchRings: () => ReturnType<VillageScene["matchRings"]>;
  matchTables: () => ReturnType<VillageScene["matchTables"]>;
  playback: (id: string) => ReturnType<VillageScene["playback"]>;
  /** Where the world camera is looking, so the nearest matches are drawn in full. */
  setViewCentre: (p: Point | null) => void;
  inspectAgent: (id: string) => ReturnType<VillageScene["inspectAgent"]>;
  /** Draws a live agent's own Top character onto another view's canvas; false if it has none. */
  /** `yaw` is the world camera's: an agent shows the side of itself that faces that camera. */
  paintAgent: (id: string, ctx: CanvasRenderingContext2D, x: number, y: number, k: number, paint: (ctx: CanvasRenderingContext2D) => Painter, yaw?: number) => boolean;
  setWorldCamera: (camera: WorldCameraControls | null) => void;
  activateWorldTarget: (target: WorldTarget) => void;
  setResidents: (residents: Resident[]) => void;
  /** `pan` brings the camera to them: for a selection made outside the canvas. */
  select: (id: string | null, pan?: boolean) => void;
  /** How much of the canvas the bar and the page panel cover, in CSS pixels. */
  setInsets: (inset: { top: number; right: number; bottom: number }) => void;
  setNotes: (notes: Record<string, { text: string; lively: boolean }>) => void;
  setNight: (on: boolean) => void;
  /** The signed-in owner's agents, marked in gold. */
  setMine: (ids: ReadonlySet<string>) => void;
  /** Agent route observes its owner through the same world camera. */
  setObservation: (on: boolean) => void;
  /** Pans to the owner's next agent; false when none of theirs is in the village. */
  findMine: () => boolean;
  zoom: (step: 1 | -1) => void;
  view: (mode: ViewMode) => void;
  lookAt: (point: Point) => void;
  destroy: () => void;
};

/** The canvas's backing store, as a multiple of its CSS size: physical pixels, capped to keep memory bounded. */
const pixelRatio = () => Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

/**
 * Starts the village in `container`. The only way in for the rest of the app:
 * everything Phaser stays behind this module, which the page loads on demand,
 * so the engine is never part of the server render or another page's bundle.
 *
 * The canvas is sized in physical pixels and zoomed back to CSS pixels, because
 * Phaser sizes it in CSS pixels on its own and a high-density screen then
 * shows the art blurred.
 */
export async function startVillage(
  container: HTMLElement,
  opts: { base: string; buildings: BuildingLabel[]; still: boolean; nameFont: string; events: VillageEvents },
): Promise<VillageHandle> {
  const res = await fetch(`${opts.base}/map.json`);
  if (!res.ok) throw new Error(`village map: ${res.status}`);
  // Agent Quest's map brings Old Town's ground, its in-town trees and its props; the world round it is
  // laid out here (world.ts): its size, plain grass under everything, the small lake, the crossroads' plazas.
  const imported = (await res.json()) as VillageMap;
  const map = prepareWorldMap(imported);

  const scene = new VillageScene(map, opts);
  const size = () => {
    const r = pixelRatio();
    return { r, width: Math.max(1, Math.floor(container.clientWidth * r)), height: Math.max(1, Math.floor(container.clientHeight * r)) };
  };
  const initial = size();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    backgroundColor: VOID,
    // Nearest-neighbour everywhere: it is pixel art.
    pixelArt: true,
    banner: false,
    scene: [scene],
    scale: { mode: Phaser.Scale.NONE, width: initial.width, height: initial.height, zoom: 1 / initial.r },
    // Only what happens on the canvas itself: by default Phaser also listens on the window, so letting go of
    // a button or a page card that lies over a building would count as a tap on the building.
    input: { mouse: true, touch: true, windowEvents: false },
  });

  const resize = () => {
    const s = size();
    if (game.scale.zoom !== 1 / s.r) game.scale.setZoom(1 / s.r);
    game.scale.resize(s.width, s.height);
    // Phaser keeps the canvas's CSS size from before when the density and the size change together - a
    // phone turned desktop in the browser's device mode - and the village is drawn squashed into a corner.
    // Its on-screen size is always the container's.
    game.canvas.style.width = `${container.clientWidth}px`;
    game.canvas.style.height = `${container.clientHeight}px`;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  // A change of device can move the density without the container's size changing, or before it does.
  window.addEventListener("resize", resize);
  // A window dragged to a screen of another density changes the ratio and not the size.
  let density: MediaQueryList | null = null;
  const watchDensity = () => {
    density = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener("change", onDensity, { once: true });
  };
  const onDensity = () => {
    resize();
    watchDensity();
  };
  watchDensity();

  let worldCamera: WorldCameraControls | null = null;
  return {
    snapshot: () => scene.worldSnapshot(),
    agents: () => scene.agentSnapshot(),
    setVisibleAgents: (ids) => scene.setVisibleAgents(ids),
    nameTag: (id) => scene.nameTag(id),
    matchRings: () => scene.matchRings(),
    matchTables: () => scene.matchTables(),
    playback: (id) => scene.playback(id),
    setViewCentre: (p) => scene.setViewCentre(p),
    inspectAgent: (id) => scene.inspectAgent(id),
    paintAgent: (id, ctx, x, y, k, paint, yaw) => scene.paintAgent(id, ctx, x, y, k, paint, yaw),
    setWorldCamera: (camera) => {
      if (Boolean(camera) !== Boolean(worldCamera)) scene.input?.resetPointers();
      worldCamera = camera;
      if (camera && scene.selectedAgentId()) camera.follow(scene.selectedAgentId());
      scene.setRotationEnabled(camera !== null);
      scene.input.enabled = false;
      // Phaser supplies simulation and captured art; only WorldCamera presents the world.
      scene.sys.settings.visible = false;
    },
    activateWorldTarget: (target) => scene.activateWorldTarget(target),
    setResidents: (r) => scene.setResidents(r),
    select: (id, pan = false) => {
      scene.select(id, pan);
      if (pan || !id) worldCamera?.follow(scene.selectedAgentId());
    },
    setInsets: (inset) => scene.setInsets(inset),
    setNotes: (notes) => scene.setNotes(notes),
    setNight: (on) => scene.setNight(on),
    setMine: (ids) => scene.setMine(ids),
    setObservation: (on) => scene.setObservation(on),
    findMine: () => {
      const found = scene.findMine();
      if (found) worldCamera?.follow(scene.selectedAgentId());
      return found;
    },
    zoom: (step) => worldCamera ? worldCamera.zoom(step) : scene.zoomBy(step),
    view: (mode) => worldCamera ? worldCamera.view(mode) : scene.showView(mode),
    lookAt: (point) => worldCamera ? worldCamera.lookAt(point) : scene.lookAt(point),
    destroy: () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
      density?.removeEventListener("change", onDensity);
      game.destroy(true);
    },
  };
}
