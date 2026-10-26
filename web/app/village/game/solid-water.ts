import { worldPerformance } from "../../../lib/world/render-performance";
import type { TopGround } from "../../../lib/world/model";
import { cameraAngle, type Projection } from "../../../lib/world/projection";
import { ROUGH_SEA } from "../../../lib/world/landscape";
import { RIVER_BRIDGES } from "../../../lib/world/river";
import type { ProjectionCamera } from "./projected-art";

/**
 * Living water over the baked ground (docs/world-solids.md): one fragment pass a frame, in pixel
 * cells laid on the ground plane, on its own canvas stacked between the ground canvas and the
 * scenery canvas, so bridges, piers, banks and trees stay over it and nothing is read back. Where the water is comes from the ground's own pixels, measured
 * once; nothing about water geometry is rebuilt per frame, and the camera is only uniforms.
 *
 *   river  - current streaks moving along the channel (riverCentre's own tangent, north into the
 *            lake), faster mid-stream and through the crossings, each lane its own pace
 *   still  - ponds, the lake and the sea: slow drifting glints and now and then a ripple ring
 *   shores - a little foam flicker where water meets land
 *
 * Elevation-ready: a stretch's surface height and flow are its own uniforms in the shader's terms,
 * so streams and falls can be added as further regions without replacing this pass.
 */

const MASK_UNITS = 4;
const VERTEX = `#version 300 es
layout(location=0) in vec2 a_px;
uniform vec2 u_size;
out vec2 v_px;
void main() { v_px = a_px * u_size; gl_Position = vec4(a_px.x * 2.0 - 1.0, 1.0 - a_px.y * 2.0, 0.0, 1.0); }`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform highp sampler2D u_mask;
uniform vec4 u_cam;      // yaw, tilt, centre x, centre y
uniform vec4 u_screen;   // scale, width, height, seconds
uniform vec4 u_frame;    // mask origin x, y, world units per texel, 0
uniform vec4 u_sea;      // the lake the river runs into: x, y, rx, ry
uniform vec2 u_bridges[48];
uniform int u_bridgeCount;
in vec2 v_px;
out vec4 colour;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wet(vec2 w) {
  ivec2 m = ivec2(floor((w - u_frame.xy) / u_frame.z));
  ivec2 size = textureSize(u_mask, 0);
  if (m.x < 0 || m.y < 0 || m.x >= size.x || m.y >= size.y) return 0.0;
  return texelFetch(u_mask, m, 0).r;
}
vec4 over(vec4 base, vec3 c, float a) { return vec4(c * a + base.rgb * (1.0 - a), a + base.a * (1.0 - a)); }
void main() {
  float yaw = u_cam.x, tilt = u_cam.y, t = u_screen.w;
  vec2 q = (v_px - u_screen.yz * 0.5) / u_screen.x + u_cam.zw;
  float along = q.y / sin(tilt);
  vec2 w = vec2(q.x * cos(yaw) + along * sin(yaw), -q.x * sin(yaw) + along * cos(yaw));
  if (wet(w) < 0.5) discard;
  // Every effect is decided per 4-unit cell, so it reads as crisp pixels laid on the water.
  vec2 cell = floor(w / 4.0), at = cell * 4.0 + 2.0;
  vec4 c = vec4(0.0);
  float shore = 1.0 - min(min(wet(at + vec2(6.0, 0.0)), wet(at - vec2(6.0, 0.0))), min(wet(at + vec2(0.0, 6.0)), wet(at - vec2(0.0, 6.0))));
  float centre = 2336.0 + sin(at.y / 440.0) * 96.0;
  vec2 sea = (at - u_sea.xy) / u_sea.zw;
  bool river = abs(at.x - centre) < 190.0 && dot(sea, sea) > 1.15 && at.y > u_sea.y;
  if (river) {
    // Downstream is north, along the channel's own bend.
    vec2 dir = -normalize(vec2(96.0 / 440.0 * cos(at.y / 440.0), 1.0)), side = vec2(-dir.y, dir.x);
    float off = (at.x - centre) / 150.0, speed = 30.0 * (1.0 - 0.55 * off * off);
    for (int i = 0; i < 48; i++) { if (i >= u_bridgeCount) break; float d = distance(at, u_bridges[i]); speed *= 1.0 + 0.7 * smoothstep(110.0, 20.0, d); }
    float lane = floor(dot(at, side) / 4.0);
    float pace = speed * (0.7 + 0.6 * hash(vec2(lane, 3.1)));
    float s = dot(at, dir) - t * pace + hash(vec2(lane, 9.7)) * 97.0;
    // Streaks three to five cells long, a light one now and then a dark trough behind it.
    float dash = floor(s / 30.0), within = fract(s / 30.0), keep = hash(vec2(lane, dash));
    if (keep > 0.62 && within < 0.22 + 0.2 * hash(vec2(dash, lane))) c = over(c, vec3(0.66, 0.86, 0.94), 0.62);
    else if (keep > 0.62 && within > 0.48 && within < 0.62) c = over(c, vec3(0.12, 0.36, 0.53), 0.45);
  } else {
    // Still water: gentle glints drifting, and an occasional ring spreading and fading.
    float v = sin(at.x * 0.045 + t * 0.55) + sin(at.y * 0.06 - t * 0.38) + sin((at.x + at.y) * 0.027 + t * 0.21);
    float h = hash(cell);
    if (v > 2.15 && h > 0.25) c = over(c, vec3(0.64, 0.86, 0.93), 0.5);
    else if (h > 0.985 && fract(t * 0.2 + h * 7.0) < 0.25) c = over(c, vec3(0.86, 0.95, 0.97), 0.6);
    vec2 g = floor(at / 170.0), gh = vec2(hash(g), hash(g + 17.0));
    float age = mod(t + gh.x * 9.0, 9.0);
    if (gh.y > 0.3 && age < 4.0) {
      vec2 o = g * 170.0 + 30.0 + vec2(hash(g + 3.0), hash(g + 5.0)) * 110.0;
      if (wet(o) > 0.5 && abs(distance(at, o) - age * 9.0) < 2.5) c = over(c, vec3(0.8, 0.93, 0.97), 0.65 * (1.0 - age / 4.0));
    }
  }
  if (shore > 0.5 && hash(cell + floor(t * 2.5)) > 0.62) c = over(c, vec3(0.85, 0.95, 0.95), 0.5);
  if (c.a <= 0.0) discard;
  colour = c;
}`;

/** The water pass on its own on-page canvas, or null where WebGL2 is unavailable. */
export function createWater(canvas: HTMLCanvasElement): WaterPass | null {
  try {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true });
    // A full-screen water shader is expensive on a CPU-backed WebGL context.
    // WorldCamera supplies small pixel ripples instead; native GPUs keep this pass.
    if (gl) {
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      if (/swiftshader|llvmpipe|softpipe|software|microsoft basic/i.test(renderer)) return null;
    }
    return gl ? new WaterPass(gl, canvas) : null;
  } catch { return null; }
}

export class WaterPass {
  private program: WebGLProgram;
  private quad: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private mask: WebGLTexture | null = null;
  private maskOf: unknown = null;
  private buffer: WebGLBuffer | null = null;
  private readonly bridges = RIVER_BRIDGES.slice(0, 48);
  private readonly bridgeData = new Float32Array(this.bridges.flatMap((p) => [p.x, p.y]).concat(new Array((48 - this.bridges.length) * 2).fill(-1e6)));
  private frame = { x0: 0, y0: 0, units: MASK_UNITS };

  constructor(private gl: WebGL2RenderingContext, private canvas: HTMLCanvasElement) {
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "water shader");
      return s;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, VERTEX)); gl.attachShader(this.program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "water program");
    for (const n of ["u_mask", "u_cam", "u_screen", "u_frame", "u_sea", "u_bridges", "u_bridgeCount", "u_size"]) this.u[n] = gl.getUniformLocation(this.program, n);
    this.quad = gl.createVertexArray()!;
    gl.bindVertexArray(this.quad);
    this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Measures where the water is from the ground's own pixels, once per ground image. */
  private measure(ground: TopGround): void {
    if (this.maskOf === ground.image) return;
    const started = worldPerformance.start();
    const w = Math.ceil(ground.width / MASK_UNITS), h = Math.ceil(ground.height / MASK_UNITS);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!; g.imageSmoothingEnabled = false;
    g.drawImage(ground.image as CanvasImageSource, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, wet = new Uint8Array(w * h);
    // Water is the ground's blue: well bluer than it is red, and not grey stone or pale sky-white paving.
    for (let i = 0; i < w * h; i++) {
      const r = px[i * 4]!, gr = px[i * 4 + 1]!, b = px[i * 4 + 2]!;
      wet[i] = b > r + 40 && b > gr - 6 && b > 70 && b < 235 ? 255 : 0;
    }
    const gl = this.gl;
    this.mask ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, wet);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    this.frame = { x0: ground.x0, y0: ground.y0, units: ground.width / w };
    this.maskOf = ground.image;
    worldPerformance.endStage("waterMask", started);
  }

  /** Release GPU resources without losing a context reused by React's development remount. */
  dispose(): void {
    const gl = this.gl;
    for (const shader of gl.getAttachedShaders(this.program) ?? []) gl.deleteShader(shader);
    gl.deleteTexture(this.mask); gl.deleteBuffer(this.buffer); gl.deleteVertexArray(this.quad); gl.deleteProgram(this.program);
    this.mask = null; this.maskOf = null; this.buffer = null;
  }

  /** Paints this frame's water on its own canvas; with no ground yet, clears it. */
  clear(): void { const gl = this.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  draw(ground: TopGround, view: Projection, camera: ProjectionCamera, width: number, height: number, ratio: number, seconds: number): void {
    this.measure(ground);
    const started = worldPerformance.start(), gl = this.gl, angle = cameraAngle(view);
    const pw = Math.max(1, Math.round(width * ratio)), ph = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    gl.viewport(0, 0, pw, ph); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mask); gl.uniform1i(this.u.u_mask!, 1);
    gl.uniform4f(this.u.u_cam!, angle.yaw, angle.tilt, camera.x, camera.y);
    gl.uniform4f(this.u.u_screen!, camera.scale, width, height, seconds);
    gl.uniform4f(this.u.u_frame!, this.frame.x0, this.frame.y0, this.frame.units, 0);
    gl.uniform4f(this.u.u_sea!, ROUGH_SEA.x, ROUGH_SEA.y, ROUGH_SEA.rx, ROUGH_SEA.ry);
    gl.uniform2fv(this.u.u_bridges!, this.bridgeData);
    gl.uniform1i(this.u.u_bridgeCount!, this.bridges.length);
    gl.uniform2f(this.u.u_size!, width, height);
    gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.bindVertexArray(null);
    worldPerformance.endStage("water", started);
  }
}
