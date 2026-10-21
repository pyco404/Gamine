"use client";

import { worldPerformance } from "../../lib/world/render-performance";
import { projectedObjectFaces } from "../../lib/world/object-geometry";

import { useEffect, useRef, type RefObject } from "react";
import { CloseIcon } from "@/app/icons";
import type { VillageHandle } from "./game";
import { renderProjectedWorld, type ProjectedLayer, type ProjectionCamera } from "./game/projected-art";
import { dragCamera, easeCamera, frameProjection, MAX_TILT, MIN_TILT, project, unprojectGround, yawDelta } from "../../lib/world/projection";
import { VOID, nightOf } from "./game/palette";

/** The village's monospace, as Top's labels use; game/text.ts imports Phaser, which cannot load here. */
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';
import { loadProjectedMaterials } from "./game/projected-materials";
import { solidRevision } from "./game/solid-renderer";
import { createWater } from "./game/solid-water";
import { drawSeaLife } from "./game/sea-life";
import { canvasPainter } from "./game/projected-agents";
import { agentBox, inside, worldPicker, type ScreenBox, type WorldTarget } from "./game/projected-picking";
import type { WorldSnapshot } from "../../lib/world/model";
import { agentInViewport, agentScale } from "../../lib/world/agent-render";
import { COLOSSEUM } from "../../lib/world/arena-geometry";

type Props = {
  village: RefObject<VillageHandle | null>;
  observing: boolean;
  scrolls: RefObject<HTMLDivElement | null> | null;
  /** What an open page covers: right on a desktop, bottom on a phone. The world frames itself in the rest. */
  inset: { right: number; bottom: number };
  /** Whether the camera help is open; the shell's bottom strip has the button that reopens it. */
  help: boolean;
  onHelp: (open: boolean) => void;
};
type Pointer = { x: number; y: number; startX: number; startY: number; allowed: boolean; dragging: boolean; pan: boolean; target: WorldTarget | null };
type Hit = { target: WorldTarget; box: ScreenBox };
const DRAG = 8;
/**
 * First load and Reset look into town from just east of south: the Arena entrance faces the viewer,
 * with a 30-degree elevation retaining seating and street depth. Keep the existing town scale,
 * about 3,000 world units across desktop; phones retain their existing minimum zoom.
 */
const HOME = { angle: { yaw: Math.PI / 10, tilt: Math.PI / 6 }, focus: { x: COLOSSEUM.x, y: COLOSSEUM.y + 90 }, span: 3000 };
const homeScale = (width: number) => Math.max(0.3, Math.min(1.2, width / HOME.span));

/** The application's persistent visual world, independent of the active route. */
export function WorldCamera({ village, observing, scrolls, inset, help, onHelp }: Props) {
  worldPerformance.count("reactRenders");
  const canvas = useRef<HTMLCanvasElement>(null);
  // Stacked under and over the main canvas, composited by the browser with nothing read back:
  // the baked ground, the live water on it, then (main) scenery and agents, the night's tint, and labels.
  const groundCanvas = useRef<HTMLCanvasElement>(null), waterCanvas = useRef<HTMLCanvasElement>(null);
  const nightLayer = useRef<HTMLDivElement>(null), labelCanvas = useRef<HTMLCanvasElement>(null);
  const options = useRef({ observing, scrolls, inset }); options.current = { observing, scrolls, inset };
  const fit = useRef<(whole?: boolean) => void>(() => {});
  const reset = useRef<() => void>(() => {});

  useEffect(() => {
    const el = canvas.current, handle = village.current, still = groundCanvas.current, labelsEl = labelCanvas.current;
    if (!el || !handle || !still || !labelsEl) return;
    const ctx = el.getContext("2d"), layer = still.getContext("2d"), lctx = labelsEl.getContext("2d");
    if (!ctx || !layer || !lctx) return;
    // The bake, in two: the ground (its own canvas, under the water's) and the upright scenery over a
    // clear background, drawn onto the main canvas each frame under the agents.
    const upright = document.createElement("canvas"), uprightLayer = upright.getContext("2d")!;
    const water = waterCanvas.current ? createWater(waterCanvas.current) : null, waterOn = new URLSearchParams(window.location.search).get("water") !== "0";
    let snapshot: WorldSnapshot | null = null, camera: ProjectionCamera | null = null;
    let angle = { ...HOME.angle }, target = { ...angle };
    let focus: { x: number; y: number } | null = null, scaleTarget: number | null = null, following: string | null = null;
    // Screen pixels the focus sits left/up of the canvas centre, so it stays in the part a page leaves
    // uncovered. Presentation only: focus, zoom and angle are the same camera on every route.
    const shift = { x: 0, y: 0 };
    let lastRead = -Infinity, lastDraw = -Infinity, lastFrame = 0, revision = -1, dirty = true, raf = 0, width = 0, height = 0, ratio = 1;
    let artwork: ReturnType<typeof loadProjectedMaterials> | null = null;
    let scenery: ProjectedLayer[] = [], retained = new Set<string>();
    // Scenery is baked into `still` once per camera change. Between changes only the layers whose
    // screen boxes meet a live actor are drawn again, over it, in painter order with the actors.
    // `baked` is the camera they were baked at; `cells` indexes their boxes; `always` have none.
    let solids = -1;
    let baked: ProjectionCamera | null = null, cells = new Map<number, number[]>(), always: number[] = [], boxes: ScreenBox[] = [];
    const CELL = 96, cellKey = (cx: number, cy: number) => cx * 65536 + cy;
    const debug = new URLSearchParams(window.location.search).has("debugAgents");
    worldPerformance.enabled = new URLSearchParams(window.location.search).has("debugWorldPerf");
    if (worldPerformance.enabled) Object.assign(window,{__worldRenderPerf:worldPerformance,
      __worldPerfCamera:(yaw:number,tilt=angle.tilt)=>{target={yaw,tilt:Math.max(MIN_TILT,Math.min(MAX_TILT,tilt))};dirty=true;},
      __worldPerfFocus:(x:number,y:number,scale?:number)=>{following=null;focus={x,y};if(scale)scaleTarget=scale;dirty=true;}});
    let pickWorld: (p: { x: number; y: number }) => WorldTarget | null = () => null;
    let agentHits: Hit[] = [], labelHits: Hit[] = [];
    const pick = (point: { x: number; y: number }) => {
      for (const hits of [labelHits, agentHits]) for (let i = hits.length - 1; i >= 0; i--) if (inside(point, hits[i]!.box)) return hits[i]!.target;
      return pickWorld(point);
    };
    const worldCentre = () => {
      const b = snapshot!.world.bounds;
      return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    };
    const framedScale = (overview = false, at = angle) => frameProjection(at, snapshot!.world.bounds, width, height, snapshot!.world.slabDepth, overview ? "overview" : "immersive").scale;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      width = rect.width; height = rect.height; ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = still.width = upright.width = labelsEl.width = Math.max(1, Math.round(width * ratio));
      el.height = still.height = upright.height = labelsEl.height = Math.max(1, Math.round(height * ratio)); dirty = true;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const changeZoom = (factor: number, x = width / 2, y = height / 2) => {
      if (!camera || !focus) return;
      const before = camera.scale, next = Math.max(0.035, Math.min(3.5, before * factor));
      scaleTarget = next;
      const delta = unprojectGround(angle, { x: (x - width / 2 + shift.x) * (1 / before - 1 / next), y: (y - height / 2 + shift.y) * (1 / before - 1 / next) });
      focus.x += delta.x; focus.y += delta.y; camera.scale = next; dirty = true;
    };
    const pan = (dx: number, dy: number) => {
      if (!camera || !focus) return;
      if (options.current.observing) return;
      following = null;
      const delta = unprojectGround(angle, { x: -dx / camera.scale, y: -dy / camera.scale });
      focus.x += delta.x; focus.y += delta.y; dirty = true;
    };
    fit.current = (overview = false) => {
      if (!snapshot) return;
      following = null; focus = worldCentre(); scaleTarget = framedScale(overview); dirty = true;
    };
    reset.current = () => {
      following = null; target = { ...HOME.angle }; focus = { ...HOME.focus }; scaleTarget = homeScale(width); dirty = true;
    };
    handle.setWorldCamera({
      zoom: (step) => changeZoom(step > 0 ? 1.25 : 0.8),
      lookAt: (point) => { following = null; focus = { ...point }; dirty = true; },
      view: (mode) => {
        if (mode === "world") fit.current(true);
        else if (camera) changeZoom((mode === "agent" ? 2.4 : 1.05) / camera.scale);
      },
      follow: (id) => {
        following = id;
        if (id) scaleTarget = Math.max(scaleTarget ?? 0, 0.8);
        dirty = true;
      },
    });
    const pointers = new Map<number, Pointer>();
    let pinch = 0;
    const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 1) return;
      const next = local(e), hit = pick(next), wantsPan = e.shiftKey || e.button === 1;
      pointers.set(e.pointerId, { ...next, startX: next.x, startY: next.y, target: hit, allowed: !hit || wantsPan, dragging: false, pan: wantsPan });
      el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
      if (e.button === 1) e.preventDefault();
      const [a, b] = [...pointers.values()];
      pinch = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      if (a && b) for (const p of pointers.values()) p.dragging = true;
    };
    const move = (e: PointerEvent) => {
      worldPerformance.count("pointerMoves");
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const next = local(e), dx = next.x - p.x, dy = next.y - p.y;
      p.x = next.x; p.y = next.y;
      const [a, b] = [...pointers.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (!options.current.observing) following = null;
        if (pinch > 0) changeZoom(distance / pinch, options.current.observing ? width / 2 : (a.x + b.x) / 2, options.current.observing ? height / 2 : (a.y + b.y) / 2);
        pan(dx / 2, dy / 2); pinch = distance;
        for (const pointer of pointers.values()) pointer.dragging = true;
        e.preventDefault(); return;
      }
      if (!p.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) < DRAG) return;
      p.dragging = true;
      if (!p.allowed || !camera || !focus) return;
      e.preventDefault();
      if (!options.current.observing) following = null;
      if (p.pan) pan(dx, dy);
      else target = dragCamera(target, dx, dy);
      dirty = true;
    };
    const release = (e: PointerEvent, cancel = false) => {
      const p = pointers.get(e.pointerId);
      pointers.delete(e.pointerId); pinch = 0;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!p || cancel || p.dragging || e.button !== 0) return;
      const at = local(e), hit = pick(at);
      if (Math.hypot(at.x - p.startX, at.y - p.startY) < DRAG && hit && hit.kind === p.target?.kind && hit.id === p.target.id) handle.activateWorldTarget(hit);
    };
    const up = (e: PointerEvent) => release(e);
    const cancel = (e: PointerEvent) => release(e, true);
    const blur = () => { for (const id of [...pointers.keys()]) release({ pointerId: id } as PointerEvent, true); };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1);
      const { observing, scrolls } = options.current;
      // Over a page's exposed margins, wheel reads that page. Ctrl/pinch still zooms.
      if (scrolls && !e.ctrlKey && !e.metaKey) { scrolls.current?.scrollBy({ top: delta }); return; }
      if (!observing) following = null;
      const rect = el.getBoundingClientRect();
      changeZoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), observing ? width / 2 : e.clientX - rect.left, observing ? height / 2 : e.clientY - rect.top);
    };
    const key = (e: KeyboardEvent) => {
      if (!camera || !focus) return;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = 60;
      else if (e.key === "ArrowRight") dx = -60;
      else if (e.key === "ArrowUp") dy = 60;
      else if (e.key === "ArrowDown") dy = -60;
      else if (e.key === "+" || e.key === "=") changeZoom(1.25);
      else if (e.key === "-") changeZoom(0.8);
      else if (e.key === "0") fit.current();
      else return;
      if (dx || dy) pan(dx, dy);
      e.preventDefault(); dirty = true;
    };
    // Only the world canvas starts gestures; overlaid controls keep their own events.
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    el.addEventListener("lostpointercapture", cancel); window.addEventListener("blur", blur);
    el.addEventListener("wheel", wheel, { passive: false }); el.addEventListener("keydown", key);
    const frame = (now: number) => {
      const seconds = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
      if (Math.abs(yawDelta(angle.yaw, target.yaw)) + Math.abs(angle.tilt - target.tilt) > 0.00001) {
        angle = easeCamera(angle, target, seconds); dirty = true;
      }
      const readStarted = worldPerformance.start();
      const read = now - lastRead >= 100;
      if (read) { snapshot = handle.snapshot(); lastRead = now; }
      if (snapshot && width > 0 && height > 0 && now - lastDraw >= 32) {
        worldPerformance.begin(now);
        worldPerformance.endStage("snapshot",readStarted);
        // Positions follow the simulation at the paint rate; scenery snapshots can stay throttled.
        const agentReadStarted=worldPerformance.start();
        snapshot.agents = handle.agents();
        worldPerformance.endStage("agentSnapshot",agentReadStarted);
        worldPerformance.count("activeAgents",snapshot.agents.length);
        focus ??= { ...HOME.focus };
        if (following) {
          const agent = snapshot.agents.find((a) => a.id === `agent:${following}`);
          if (agent) {
            const amount = 1 - Math.exp(-seconds * 10);
            focus.x += (agent.x - focus.x) * amount; focus.y += (agent.y - focus.y) * amount;
            dirty = true;
          } else following = null;
        }
        const centre = project(angle, focus);
        // Keep absolute zoom across route overlays, viewport changes and rotations.
        // Only the first framing and explicit Reset/Whole world choose a new one.
        scaleTarget ??= homeScale(width);
        const scale = Math.max(0.035, Math.min(3.5, scaleTarget));
        const covered = options.current.inset, ease = 1 - Math.exp(-seconds * 10);
        const toward = { x: Math.min(covered.right, width * 0.6) / 2, y: Math.min(covered.bottom, height * 0.7) / 2 };
        if (Math.abs(toward.x - shift.x) + Math.abs(toward.y - shift.y) > 0.5) {
          shift.x += (toward.x - shift.x) * ease; shift.y += (toward.y - shift.y) * ease; dirty = true;
        } else if (shift.x !== toward.x || shift.y !== toward.y) { shift.x = toward.x; shift.y = toward.y; dirty = true; }
        const zoomed = camera ? camera.scale + (scale - camera.scale) * (1 - Math.exp(-seconds * 14)) : scale;
        camera = { x: centre.x + shift.x / zoomed, y: centre.y + shift.y / zoomed, scale: zoomed };
        const view = angle;
        const drawScenery = (part: ProjectedLayer, at: ProjectionCamera = baked ?? camera!) => {
          if(part.drawScreen){part.drawScreen(at,width,height);return;}
          ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(at.scale, at.scale); ctx.translate(-at.x, -at.y);
          part.draw(); ctx.restore();
        };
        if (dirty || revision !== snapshot.revision || solids !== solidRevision()) {
          solids = solidRevision();
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
          artwork ??= loadProjectedMaterials(snapshot.world, () => { dirty = true; });
          scenery = [];
          // Cache the ground separately. Upright scenery joins live actors in one painter order.
          const sceneryStarted=worldPerformance.start();
          renderProjectedWorld(ctx, snapshot.world, view, camera, width, height, artwork.materials, { ground: snapshot.ground, art: snapshot.art }, (part) => scenery.push(part));
          worldPerformance.endStage("scenery",sceneryStarted);
          const scenerySortStarted=worldPerformance.start();
          scenery.sort((a, b) => a.depth - b.depth);
          worldPerformance.endStage("scenerySort",scenerySortStarted);
          const bakeStarted=worldPerformance.start();
          baked = { ...camera };
          layer.setTransform(1, 0, 0, 1, 0, 0); layer.clearRect(0, 0, still.width, still.height); layer.drawImage(el, 0, 0);
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, el.width, el.height); ctx.restore();
          ctx.imageSmoothingEnabled = false;
          for (const part of scenery) drawScenery(part, baked);
          uprightLayer.setTransform(1, 0, 0, 1, 0, 0); uprightLayer.clearRect(0, 0, upright.width, upright.height); uprightLayer.drawImage(el, 0, 0);
          cells = new Map(); always = []; boxes = [];
          for (const [i, part] of scenery.entries()) {
            const b = part.bounds;
            if (!b) { always.push(i); boxes.push({ x: 0, y: 0, width: 0, height: 0 }); continue; }
            const box = { x: width / 2 + (b.x0 - baked.x) * baked.scale, y: height / 2 + (b.y0 - baked.y) * baked.scale,
              width: (b.x1 - b.x0) * baked.scale, height: (b.y1 - b.y0) * baked.scale };
            boxes.push(box);
            if (box.x > width || box.y > height || box.x + box.width < 0 || box.y + box.height < 0) continue;
            for (let cx = Math.floor(Math.max(0, box.x) / CELL); cx <= Math.floor(Math.min(width, box.x + box.width) / CELL); cx++)
              for (let cy = Math.floor(Math.max(0, box.y) / CELL); cy <= Math.floor(Math.min(height, box.y + box.height) / CELL); cy++) {
                const key = cellKey(cx, cy), list = cells.get(key);
                if (list) list.push(i); else cells.set(key, [i]);
              }
          }
          worldPerformance.endStage("bake",bakeStarted);
          // Keep a frozen pose for hit testing. Only a click/gesture start needs the
          // projected hit polygons; dragging must not rebuild them every paint.
          const pickView={...view},pickCamera={...camera},pickSnapshot=snapshot,pickWidth=width,pickHeight=height;
          let prepared:ReturnType<typeof worldPicker>|null=null;
          pickWorld=point=>{
            if(!prepared){const started=worldPerformance.start();prepared=worldPicker(pickView,pickSnapshot.world.objects,pickCamera,pickWidth,pickHeight,pickSnapshot.art);worldPerformance.endStage("picking",started);worldPerformance.count("pickBuilds");}
            return prepared(point);
          };
          revision = snapshot.revision; dirty = Math.abs(scale - camera.scale) > 0.00001;
        }
        worldPerformance.count("visibleObjects",scenery.length);
        const compositeStarted=worldPerformance.start();
        lastDraw = now;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, el.width, el.height);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        // Water moves every frame, on its own canvas between the ground's and this one.
        if (water) { if (waterOn && snapshot.ground && baked) water.draw(snapshot.ground, view, baked, width, height, ratio, now / 1000); else water.clear(); }
        // Bluff & Fold out in the village: the scene draws its rings in full nearest where this camera looks.
        handle.setViewCentre(focus);
        const toScreen = (p: { x: number; y: number }, z = 0) => {
          const q = project(view, p, z);
          return { x: width / 2 + (q.x - camera!.x) * camera!.scale, y: height / 2 + (q.y - camera!.y) * camera!.scale };
        };
        // The lake's fish, turtles and rays swim on the water, under the scenery and the agents.
        drawSeaLife(ctx, toScreen, waterOn ? now / 1000 : 0, width, height);
        {
          // Each match's ring, flat on the ground under its players, as Top draws it.
          const o = toScreen({ x: 0, y: 0 }), ex = toScreen({ x: 1, y: 0 }), ey = toScreen({ x: 0, y: 1 });
          for (const r of handle.matchRings()) {
            ctx.save(); ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
            ctx.globalAlpha = r.alpha;
            ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(12,16,24,0.3)"; ctx.fill();
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(232,184,75,0.9)"; ctx.stroke();
            ctx.beginPath(); ctx.ellipse(r.x, r.y, r.rx - 5, r.ry - 3, 0, 0, Math.PI * 2);
            ctx.lineWidth = 1; ctx.strokeStyle = "rgba(92,74,34,0.9)"; ctx.stroke();
            ctx.restore();
          }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(upright, 0, 0); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        // Live agents as their own Top characters, standing on their projected feet, back to front.
        const k = agentScale(camera.scale), nextRetained = new Set<string>();
        const diagnostics: Record<string, unknown>[] = [];
        const shown = [];
        for (const agent of snapshot.agents) {
          const p = project(view, agent, agent.elevation);
          const x = width / 2 + (p.x - camera.x) * camera.scale, y = height / 2 + (p.y - camera.y) * camera.scale;
          const visible = agentInViewport(x, y, camera.scale, width, height, retained.has(agent.id));
          if (debug) diagnostics.push({ id: agent.id, worldX: agent.x, worldY: agent.y, screenX: x, screenY: y, depth: p.depth,
            state: visible ? "composited" : "offscreen", reason: visible ? "pixel occlusion by scenery in front" : "outside padded screen bounds", source: handle.inspectAgent(agent.id) });
          if (!visible) continue;
          nextRetained.add(agent.id);
          shown.push({ agent, x, y, depth: p.depth });
        }
        retained = nextRetained; handle.setVisibleAgents(retained);
        shown.sort((a, b) => a.depth - b.depth || a.agent.id.localeCompare(b.agent.id));
        agentHits = shown.map(({ agent, x, y }) => ({ target: { kind: "agent" as const, id: agent.id }, box: agentBox({ x, y }, camera!.scale) }));
        // Card tables stand between their players, drawn just after the nearer of the two.
        const tables = handle.matchTables().map((t) => ({ ...t, sa: toScreen(t.a), sb: toScreen(t.b),
          depth: Math.max(project(view, t.a).depth, project(view, t.b).depth) + 0.5 }));
        let at = 0, fallbacks = 0, ti = 0;
        tables.sort((a, b) => a.depth - b.depth);
        // The scenery to draw again over this frame's actors: every layer whose box meets an agent
        // or a table and could stand in front of it. The rest is already right in `still`.
        const chosen = new Set<number>(always);
        const meet = (box: ScreenBox, depth: number) => {
          for (let cx = Math.floor(Math.max(0, box.x) / CELL); cx <= Math.floor(Math.min(width, box.x + box.width) / CELL); cx++)
            for (let cy = Math.floor(Math.max(0, box.y) / CELL); cy <= Math.floor(Math.min(height, box.y + box.height) / CELL); cy++)
              for (const i of cells.get(cellKey(cx, cy)) ?? []) {
                if (chosen.has(i) || scenery[i]!.depth <= depth) continue;
                const b = boxes[i]!;
                if (b.x < box.x + box.width && box.x < b.x + b.width && b.y < box.y + box.height && box.y < b.y + b.height) chosen.add(i);
              }
        };
        for (const t of tables) meet({ x: Math.min(t.sa.x, t.sb.x) - 48 * k, y: Math.min(t.sa.y, t.sb.y) - 60 * k, width: Math.abs(t.sa.x - t.sb.x) + 96 * k, height: Math.abs(t.sa.y - t.sb.y) + 72 * k }, t.depth);
        // As wide as anything an agent paints: weapon, lunge, shadow and the ring round your own.
        for (const { x, y, depth } of shown) meet({ x: x - 34 * k, y: y - 104 * k, width: 68 * k, height: 112 * k }, depth);
        const occluders = [...chosen].sort((a, b) => a - b).map((i) => scenery[i]!);
        worldPerformance.count("occluders", occluders.length);
        const drawTablesTo = (depth: number) => {
          while (ti < tables.length && tables[ti]!.depth <= depth) {
            const t = tables[ti++]!;
            while (at < occluders.length && occluders[at]!.depth <= t.depth) drawScenery(occluders[at++]!);
            t.paint(ctx, t.sa, t.sb, k, toScreen);
          }
        };
        for (const { agent, x, y, depth } of shown) {
          drawTablesTo(depth);
          while (at < occluders.length && occluders[at]!.depth <= depth) drawScenery(occluders[at++]!);
          if (agent.metadata?.mine) {
            ctx.strokeStyle = "#f3cf70"; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(x, y, 18 * k, 6 * k, 0, 0, Math.PI * 2); ctx.stroke();
          }
          if (!handle.paintAgent(agent.id, ctx, x, y, k, canvasPainter, view.yaw)) {
            fallbacks++;
            ctx.fillStyle = agent.metadata?.mine ? "#f3cf70" : "#c9e7d5"; ctx.strokeStyle = "#243e35"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y - 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        drawTablesTo(Infinity);
        while (at < occluders.length) drawScenery(occluders[at++]!);
        if (debug) {
          Object.assign(window, { __agentRenderDebug: { at: now, agents: diagnostics, painted: shown.length, total: snapshot.agents.length, fallbacks,
            camera: { ...camera, ...view }, order: "ground, scenery and agents by camera depth, labels" } });
        }
        if (nightLayer.current) nightLayer.current.style.opacity = snapshot.night ? "1" : "0";
        worldPerformance.endStage("composite",compositeStarted);
        const labelStarted=worldPerformance.start();
        lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, labelsEl.width, labelsEl.height); lctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        // Agents' names over their heads, as Top shows them: your own (gold) and players' always, house
        // agents while walking or hovered. Yours and the selected one first; none overlaps another.
        {
          lctx.save();
          lctx.font = `bold 12px ${MONO}`; lctx.textAlign = "center"; lctx.textBaseline = "bottom"; lctx.lineJoin = "round";
          const tags = shown.flatMap(({ agent, x, y }) => {
            const tag = handle.nameTag(agent.id);
            return tag && tag.shown && tag.text ? [{ ...tag, x, y: y - 42 * k - 3 }] : [];
          }).sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.selected) - Number(a.selected) || a.y - b.y);
          const taken: { x0: number; x1: number; y0: number; y1: number }[] = [];
          for (const t of tags) {
            const w = lctx.measureText(t.text).width, box = { x0: t.x - w / 2 - 3, x1: t.x + w / 2 + 3, y0: t.y - 14, y1: t.y + 1 };
            if (!t.mine && taken.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
            taken.push(box);
            lctx.lineWidth = t.selected ? 5 : 3; lctx.strokeStyle = t.selected ? "#5c4a22" : "#000";
            lctx.strokeText(t.text, t.x, t.y); lctx.fillStyle = t.colour; lctx.fillText(t.text, t.x, t.y);
          }
          lctx.restore();
        }
        // Labels are bounded to landmarks and avoid DOM nodes for objects/agents.
        const labels = snapshot.world.objects.filter((o) => o.id.startsWith("site:") || o.type === "mountain" || o.metadata?.landmark).sort((a, b) => Number(b.type === "arena") - Number(a.type === "arena"));
        lctx.font = "11px monospace"; lctx.textAlign = "center";
        const placed: { x: number; y: number; w: number }[] = [];
        labelHits = [];
        for (const o of labels) {
          // Labels face the reader; their anchors follow the real roof, not an upright source sprite.
          // The Arena's name stays on its north rim, leaving its faded floor logo clear.
          const ref = o.directionalAssets?.front ?? o.metadata?.art;
          const faces = o.type === "arena" ? [] : projectedObjectFaces(view, o, ref ? snapshot.art?.(ref) ?? undefined : undefined);
          const p = o.type === "arena" ? project(view, { x: o.x, y: o.y - o.depth / 2 }, o.elevation + o.height + 12)
            : { x: project(view, o).x, y: Math.min(...faces.flatMap(f => f.points.map(p => p.y))) - 12 };
          const x = width / 2 + (p.x - camera.x) * camera.scale;
          let y = height / 2 + (p.y - camera.y) * camera.scale;
          if (x < 20 || x > width - 20 || y < 16 || y > height - 30) continue;
          const text = o.metadata?.label ?? o.id, w = lctx.measureText(text).width;
          const anchor = y;
          for (let row = 0; row < 6 && placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 8 && Math.abs(p.y - y) < 20); row++) y -= 21;
          if (y < 16 || placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 8 && Math.abs(p.y - y) < 20)) continue;
          placed.push({ x, y, w });
          if (y !== anchor) { lctx.strokeStyle = "#d7c78b88"; lctx.beginPath(); lctx.moveTo(x, anchor); lctx.lineTo(x, y); lctx.stroke(); }
          if (o.id.startsWith("site:") && (o.type === "arena" || o.type === "building")) {
            labelHits.push({ target: { kind: "building", id: o.id.slice(5) }, box: { x: x - w / 2 - 5, y: y - 12, width: w + 10, height: 17 } });
          }
          lctx.fillStyle = "#182c24e8"; lctx.fillRect(x - w / 2 - 5, y - 12, w + 10, 17);
          lctx.fillStyle = "#e8d89d"; lctx.fillText(text, x, y);
        }
        if (snapshot.forestPending) { lctx.fillStyle = "#e8d89d"; lctx.fillText("Preparing woodland…", width / 2, height - 18); }
        if (debug) {
          lctx.save(); lctx.font = "10px monospace"; lctx.textAlign = "left";
          lctx.fillStyle = "#102019ee"; lctx.fillRect(12, height - 175, Math.min(width - 24, 650), 145);
          lctx.fillStyle = "#e8d89d";
          lctx.fillText(`Agents ${shown.length}/${snapshot.agents.length}, fallback ${fallbacks}; depth compositing, padded viewport`, 20, height - 157);
          diagnostics.filter((d) => d.state === "composited").slice(0, 6).forEach((d, i) => lctx.fillText(`${d.id} world ${Math.round(d.worldX as number)},${Math.round(d.worldY as number)} screen ${Math.round(d.screenX as number)},${Math.round(d.screenY as number)} depth ${Math.round(d.depth as number)} ${d.state}`, 20, height - 139 + i * 18));
          lctx.restore();
        }
        worldPerformance.endStage("labels",labelStarted);
        el.dataset.focusX = String(focus.x); el.dataset.focusY = String(focus.y); el.dataset.following = following ?? "";
        el.dataset.yaw = String(angle.yaw); el.dataset.tilt = String(angle.tilt); el.dataset.zoom = String(camera.scale);
        worldPerformance.end();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); handle.setViewCentre(null); artwork?.dispose(); handle.setVisibleAgents(null); handle.setWorldCamera(null);
      if (debug) Reflect.deleteProperty(window, "__agentRenderDebug");
      if(worldPerformance.enabled){worldPerformance.enabled=false;Reflect.deleteProperty(window,"__worldRenderPerf");Reflect.deleteProperty(window,"__worldPerfCamera");}
      blur();
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
      el.removeEventListener("lostpointercapture", cancel); window.removeEventListener("blur", blur);
      el.removeEventListener("wheel", wheel); el.removeEventListener("keydown", key);
    };
  }, [village]);

  return <>
    <canvas ref={groundCanvas} aria-hidden className="pointer-events-none absolute left-0 top-14" style={{ backgroundColor: VOID, width: "100%", height: "calc(100% - 56px)" }} />
    <canvas ref={waterCanvas} aria-hidden className="pointer-events-none absolute left-0 top-14" style={{ width: "100%", height: "calc(100% - 56px)", imageRendering: "pixelated" }} />
    <canvas ref={canvas} tabIndex={0} aria-label="Explore the Gamine world. Drag empty ground to rotate, Shift-drag or arrow keys to pan, scroll or pinch to zoom. Tap agents or buildings to open them."
      className="absolute left-0 top-14 cursor-grab touch-none active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-accent"
      style={{ width: "100%", height: "calc(100% - 56px)" }} />
    <div ref={nightLayer} aria-hidden className="pointer-events-none absolute left-0 top-14" style={{ width: "100%", height: "calc(100% - 56px)", backgroundColor: nightOf("#ffffff"), mixBlendMode: "multiply", opacity: 0 }} />
    <canvas ref={labelCanvas} aria-hidden className="pointer-events-none absolute left-0 top-14" style={{ width: "100%", height: "calc(100% - 56px)" }} />
    {!scrolls && !observing && help ? <aside className="absolute left-3 z-10 max-w-[min(310px,calc(100%-6rem))] rounded-panel border border-hud-line bg-hud p-3 pr-8 text-[11px] text-text" style={{ bottom: 100 }} aria-label="World camera controls">
      <button type="button" onClick={() => onHelp(false)} aria-label="Close camera help" className="absolute right-1.5 top-1.5 rounded p-1 text-muted hover:text-accent">
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
      <p className="text-accent">World</p>
      <p className="mt-1 text-muted">Drag empty ground to rotate · drag up to look down</p>
      <p className="mt-1 text-muted">Scroll or pinch to zoom · Shift-drag or two-finger drag to pan</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => reset.current()} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Reset camera</button>
        <button type="button" onClick={() => fit.current(true)} className="rounded border border-hud-line px-2 py-1 hover:border-accent">Whole world</button>
      </div>
    </aside> : null}
  </>;
}
