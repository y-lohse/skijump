// THROWAWAY PROTOTYPE — deliberately self-contained, no persistence.
"use strict";
const $ = (id) => document.getElementById(id);
const canvas = $("scene"),
  ctx = canvas.getContext("2d");
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lerp = (a, b, t) => a + (b - a) * t;
const rad = Math.PI / 180;
const FLIGHT_RATE = 0.5;
const LANDING_REPLAY_SECONDS = 2.2;
let W = 0,
  H = 0,
  state,
  introOpen = false,
  lastFrame = 0;
const pointer = {
  down: false,
  id: null,
  x: 0,
  y: 0,
  lastT: 0,
  swipeStart: null,
  samples: [],
  vx: 0,
  vy: 0,
};
function resize() {
  const r = $("game").getBoundingClientRect();
  W = r.width;
  H = r.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();
function reset() {
  pointer.down = false;
  pointer.id = null;
  pointer.samples = [];
  pointer.swipeStart = null;
  const angle = Math.random() * Math.PI * 2;
  state = {
    phase: "ready",
    t: 0,
    physicsT: 0,
    z: -92,
    y: 65,
    speed: 9,
    vy: 0,
    x: 0,
    yaw: 0,
    yawRate: 0,
    v: 0,
    inputV: 0,
    steer: 0,
    jitter: 0,
    edgeTime: null,
    launch: null,
    released: false,
    tapTime: null,
    touchdown: null,
    windAngle: angle,
    baseAngle: angle,
    baseWind: 1 + Math.random() * 4,
    wind: 0,
    windIntegral: 0,
    flightTime: 0,
    seed: Math.random() * 100,
    fall: false,
  };
  updateWind();
  $("results").hidden = true;
  $("takeoffNote").textContent = "";
  $("startZone").innerHTML = "<b>HOLD TO START</b>";
}
// Height in world metres. The landing hill progressively flattens into an outrun.
function ground(z) {
  if (z <= 0) return 42 - z * 0.25;
  if (z < 165) return 39 - 0.48 * z + 0.0013 * z * z;
  return 39 - 0.48 * 165 + 0.0013 * 165 * 165 - 0.051 * (z - 165);
}
function updateWind() {
  const t = state.physicsT,
    seed = state.seed;
  state.windAngle =
    state.baseAngle +
    0.19 * Math.sin(t * 0.63 + seed) +
    0.09 * Math.sin(t * 1.17 + seed * 2);
  state.wind = Math.max(
    0,
    state.baseWind +
      0.38 * Math.sin(t * 0.77 + seed) +
      0.16 * Math.sin(t * 1.43),
  );
  state.headwind = Math.cos(state.windAngle) * state.wind;
  state.crosswind = Math.sin(state.windAngle) * state.wind;
}
function local(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: clamp(e.clientX - r.left, 0, W),
    y: clamp(e.clientY - r.top, 0, H),
  };
}
$("begin").onclick = () => {
  introOpen = false;
  $("intro").hidden = true;
};
$("help").onclick = () => {
  if (state.phase !== "ready" && state.phase !== "result") return;
  introOpen = true;
  $("intro").hidden = false;
};
// iOS can recognize native long-press gestures despite cancelled pointer events.
function preventNativeGesture(event) {
  if (event.target.closest("button, .panel")) return;
  if (event.cancelable) event.preventDefault();
}
for (const type of ["touchstart", "touchmove", "contextmenu"]) {
  $("game").addEventListener(type, preventNativeGesture, { passive: false });
}
function setFlightInput() {
  state.inputV = clamp((H * 0.84 - pointer.y) / (H * 0.68), 0, 1);
  state.steer = clamp((0.5 - pointer.x / W) / 0.38, -1, 1);
}
$("game").addEventListener("pointerdown", (e) => {
  if (
    e.target.closest("button,.panel") ||
    introOpen ||
    pointer.down ||
    (e.pointerType === "mouse" && e.button !== 0)
  )
    return;
  if (state.phase === "result") return;
  const pos = local(e);
  if (state.phase === "ready" && pos.y < H * 0.78) return;
  e.preventDefault();
  $("game").setPointerCapture(e.pointerId);
  Object.assign(pointer, {
    down: true,
    id: e.pointerId,
    ...pos,
    lastT: state.t,
    swipeStart: null,
    samples: [{ t: state.t, x: pos.x / H, y: pos.y / H }],
    vx: 0,
    vy: 0,
  });
  if (state.phase === "ready") {
    state.phase = "run";
  } else if (
    (state.phase === "flight" || state.phase === "landing") &&
    state.released &&
    state.tapTime === null &&
    (!state.touchdown || state.t - state.touchdown.time <= 0.15)
  ) {
    state.tapTime = state.t;
    // A landing tap is not a new flight-control gesture.
  }
});
$("game").addEventListener("pointermove", (e) => {
  if (!pointer.down || e.pointerId !== pointer.id) return;
  e.preventDefault();
  const pos = local(e),
    dt = Math.max(0.008, state.t - pointer.lastT);
  const dx = (pos.x - pointer.x) / W,
    dy = (pos.y - pointer.y) / H;
  const vx = dx / dt,
    vy = dy / dt;
  if (state.phase === "run" && pointer.swipeStart === null && dy < -0.002) {
    pointer.swipeStart = pointer.samples.at(-1)?.t ?? state.t;
  }
  if (state.phase === "flight" && !state.released) {
    // Acceleration and reversals, rather than position noise, destabilize the jumper.
    const acceleration = Math.hypot(vx - pointer.vx, vy - pointer.vy) / dt;
    if (acceleration > 35) {
      const kick = clamp((acceleration - 35) * dt * 0.02, 0, 0.08);
      state.jitter = clamp(state.jitter + kick, 0, 1);
      state.yawRate += (dx !== 0 ? Math.sign(dx) : Math.sign(dy)) * kick * 0.4;
    }
  }
  Object.assign(pointer, { ...pos, lastT: state.t, vx, vy });
  if (state.phase === "run") recordSwipeSample();
  if (state.phase === "flight" && !state.released) setFlightInput();
});
function release(e) {
  if (e && e.pointerId !== pointer.id) return;
  pointer.down = false;
  pointer.id = null;
  if (state.phase === "flight" || state.phase === "landing") {
    state.released = true;
    state.inputV = state.v;
    state.steer = 0;
  }
}
$("game").addEventListener("pointerup", release);
$("game").addEventListener("pointercancel", release);
$("game").addEventListener("lostpointercapture", (e) => {
  if (pointer.down) release(e);
});
window.addEventListener("blur", () => release());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) release();
  lastFrame = 0;
});
function recordSwipeSample() {
  if (!pointer.down) return;
  pointer.samples.push({ t: state.t, x: pointer.x / H, y: pointer.y / H });
  // Keep one sample before the window so crossing segments can be clipped.
  while (pointer.samples.length > 2 && pointer.samples[1].t < state.t - 1) {
    pointer.samples.shift();
  }
}
function measureSwipe() {
  const end = state.edgeTime;
  const start = Math.max(end - 1, pointer.swipeStart ?? end);
  const duration = clamp(end - start, 1 / 120, 1);
  let upward = 0,
    path = 0;
  if (pointer.down && pointer.swipeStart !== null) {
    for (let i = 1; i < pointer.samples.length; i++) {
      const a = pointer.samples[i - 1],
        b = pointer.samples[i];
      if (b.t < start || a.t > end) continue;
      const span = b.t - a.t;
      const fraction =
        span > 0
          ? clamp((Math.min(b.t, end) - Math.max(a.t, start)) / span, 0, 1)
          : 1;
      const dx = (b.x - a.x) * fraction,
        dy = (a.y - b.y) * fraction;
      upward += dy;
      path += Math.hypot(dx, dy);
    }
  }
  const distance = Math.max(0, upward);
  const distanceScore = clamp(distance / 0.75, 0, 1);
  // Net vertical progress versus the entire path penalizes diagonals and reversals.
  const precision = path > 0 ? clamp(distance / path, 0, 1) ** 2 : 0;
  // 200 ms earns full speed credit; pauses before the lip remain in the duration.
  const speedScore = distance > 0 ? clamp(0.2 / duration, 0, 1) : 0;
  return {
    distance,
    distanceScore,
    precision,
    duration,
    speedScore,
    power: distanceScore * precision * speedScore,
  };
}
function takeoff() {
  state.launch = measureSwipe();
  state.phase = "flight";
  state.vy =
    -state.speed * 0.12 +
    (state.launch.power > 0 ? 2 : 0) +
    state.launch.power * 9;
  // Keep the current ski opening; the flight smoother follows the held finger.
  if (pointer.down) setFlightInput();
  else {
    state.released = true;
    state.inputV = state.v;
    state.steer = 0;
  }
}
function timeToEdge() {
  return (
    (-state.speed + Math.sqrt(state.speed ** 2 + 6 * Math.max(0, -state.z))) / 3
  );
}
function touchdown(previous, dt) {
  const nowClearance = state.y - ground(state.z);
  const beforeClearance = previous.y - ground(previous.z);
  const fraction = clamp(
    beforeClearance / (beforeClearance - nowClearance),
    0,
    1,
  );
  const z = lerp(previous.z, state.z, fraction);
  state.z = z;
  state.y = ground(z);
  state.touchdown = {
    time: state.t - dt + dt * fraction,
    z,
    yaw: state.yaw,
    v: state.v,
  };
  state.fall = Math.abs(state.yaw) > 9 * rad || state.v > 0.14;
  state.phase = "landing";
}
function score() {
  const td = state.touchdown;
  const distance = Math.max(0, Math.floor(td.z * 2) / 2);
  const distancePoints = 60 + (distance - 120) * 1.8;
  const offset = state.tapTime === null ? null : state.tapTime - td.time;
  const tapQuality =
    offset === null ? 0 : clamp(1 - Math.abs(offset) / 0.15, 0, 1);
  const yawQuality = clamp(1 - Math.abs(td.yaw) / (9 * rad), 0, 1);
  const vQuality = clamp(1 - td.v / 0.14, 0, 1);
  const flightQuality = clamp(1 - state.jitter, 0, 1);
  const style = state.fall
    ? 12 + 6 * flightQuality
    : 30 + 12 * tapQuality + 9 * yawQuality + 9 * vQuality;
  const averageWind = state.windIntegral / Math.max(state.flightTime, 0.01);
  const windPoints = -averageWind * (averageWind >= 0 ? 7.2 : 10.8);
  const total = Math.max(0, distancePoints + style + windPoints);
  const reason = [
    Math.abs(td.yaw) > 9 * rad ? "too much yaw" : "",
    td.v > 0.14 ? "skis too open" : "",
  ]
    .filter(Boolean)
    .join(" + ");
  const title = state.fall
    ? "Lost the landing."
    : tapQuality > 0.75 && yawQuality > 0.8 && vQuality > 0.8
      ? "Stuck it."
      : "On your feet.";
  const row = (a, b) =>
    `<div class="scoreRow"><span>${a}</span><b>${b}</b></div>`;
  $("results").innerHTML =
    `<div class="eyebrow">JUMP COMPLETE / K120</div><h2>${title}</h2><div class="score">${total.toFixed(1)} <small>PTS</small></div>
    ${row(`Distance · ${distance.toFixed(1)} m`, distancePoints.toFixed(1))}<p class="detail">60 + (${distance.toFixed(1)} − 120) × 1.8 pts/m</p>
    ${row("Landing / style · out of 60", style.toFixed(1))}<p class="detail">${state.fall ? `FALL: ${reason}. Style = 12 + up to 6 for stability.` : `Base 30 + tap ${(12 * tapQuality).toFixed(1)}/12 + alignment ${(9 * yawQuality).toFixed(1)}/9 + parallel skis ${(9 * vQuality).toFixed(1)}/9.`}<br>Yaw ${Math.abs(td.yaw / rad).toFixed(1)}° · V ${(td.v * 40).toFixed(1)}° · ${offset === null ? "no landing tap" : `tap ${Math.abs(offset * 1000).toFixed(0)} ms ${offset < 0 ? "early" : "late"}`}.</p>
    ${row("Wind compensation", `${windPoints >= 0 ? "+" : ""}${windPoints.toFixed(1)}`)}<p class="detail">Mean ${Math.abs(averageWind).toFixed(2)} m/s ${averageWind >= 0 ? "headwind × −7.2" : "tailwind × +10.8"}.</p>
    ${row("Takeoff power", `${Math.round(state.launch.power * 100)}%`)}<p class="detail">Distance ${Math.round(state.launch.distanceScore * 100)}% × vertical precision ${Math.round(state.launch.precision * 100)}% × speed ${Math.round(state.launch.speedScore * 100)}%.<br>${Math.round(state.launch.distance * 100)}% screen height · ${state.launch.duration.toFixed(2)} s swipe window.</p>
    <button id="again">Jump again ↻</button>`;
  $("results").hidden = false;
  $("again").onclick = reset;
  state.phase = "result";
}
function update(dt) {
  if (introOpen || state.phase === "result") return;
  // Split the step at the lip so takeoff and its swipe window use the exact edge time.
  if (state.phase === "run") {
    const untilEdge = timeToEdge();
    if (untilEdge > 1e-9 && untilEdge < dt - 1e-9) {
      update(untilEdge);
      update(dt - untilEdge);
      return;
    }
  }
  const simDt = dt * (state.phase === "flight" ? FLIGHT_RATE : 1);
  state.t += dt;
  state.physicsT += simDt;
  // Preview wind is stable until the player starts the run.
  if (state.phase !== "ready") updateWind();
  if (state.phase === "run") {
    state.z += state.speed * dt + 1.5 * dt * dt;
    state.speed += 3 * dt;
    state.y = ground(Math.min(0, state.z));
    recordSwipeSample();
    if (state.z >= -1e-8) {
      state.z = 0;
      state.y = 42;
      state.edgeTime = state.t;
      takeoff();
    }
  } else if (state.phase === "flight") {
    const previous = { z: state.z, y: state.y };
    state.v = lerp(state.v, state.inputV, 1 - Math.exp(-simDt * 12));
    state.jitter *= Math.exp(-simDt * 0.9);
    const area = 0.15 + state.v * 0.85;
    state.yawRate +=
      (state.steer * 0.95 +
        state.crosswind * area * 0.045 -
        state.yawRate * 2.7) *
      simDt;
    state.yaw = clamp(state.yaw + state.yawRate * simDt, -50 * rad, 50 * rad);
    state.x += Math.sin(state.yaw) * state.speed * simDt * 0.3;
    state.speed = clamp(
      state.speed +
        (-state.headwind * area * 0.09 -
          state.v * 0.18 -
          Math.abs(state.yaw) * 0.55) *
          simDt,
      13,
      34,
    );
    const lift = 3.4 * state.v + state.headwind * area * 0.26;
    state.vy -= clamp(9.0 - lift + Math.abs(state.yaw) * 2.0, 3, 12) * simDt;
    state.y += state.vy * simDt;
    state.z += state.speed * Math.cos(state.yaw) * simDt;
    state.flightTime += simDt;
    state.windIntegral += state.headwind * simDt;
    // Contact/tap timestamps stay on the real-time clock, not the flight clock.
    if (state.y <= ground(state.z)) touchdown(previous, dt);
  } else if (state.phase === "landing") {
    state.speed *= Math.exp(-dt * (state.fall ? 2.2 : 0.65));
    state.z += state.speed * dt * FLIGHT_RATE;
    state.y = ground(state.z);
    if (state.t - state.touchdown.time >= LANDING_REPLAY_SECONDS) score();
  }
}
function hud() {
  const s = state,
    flying = s.phase === "flight",
    run = s.phase === "run";
  $("phase").textContent = {
    ready: "",
    run: "",
    flight: "",
    landing: "",
    result: "",
  }[s.phase];
  $("distance").textContent =
    `${Math.max(0, s.touchdown?.z ?? s.z).toFixed(0)} m`;
  $("windSpeed").textContent = `${s.wind.toFixed(1)} m/s`;
  $("windArrow").style.transform = `rotate(${-s.windAngle / rad}deg)`;
  const from = (((s.windAngle / rad) % 360) + 360) % 360;
  $("windLabel").textContent =
    `${Math.abs(s.headwind) > Math.abs(s.crosswind) ? (s.headwind > 0 ? "HEADWIND" : "TAILWIND") : s.crosswind > 0 ? "FROM LEFT" : "FROM RIGHT"} · ${from.toFixed(0)}°`;
  const clearance = Math.max(0, s.y - ground(s.z));
  $("heightText").textContent = flying ? `${clearance.toFixed(1)} m` : "—";
  $("heightFill").style.height = `${clamp(clearance / 24, 0, 1) * 100}%`;
  $("heightFill").style.background = clearance < 5 ? "#e27639" : "#235d70";
  $("edgeDot").style.top = `${clamp(25 - (s.z / 92) * 70, 0, 95)}%`;
  $("edgeText").textContent =
    s.z <= 0 ? `${Math.abs(s.z).toFixed(0)} m to lip` : "OFF RAMP";

  $("startZone").hidden = s.phase !== "ready";
  $("edgeGauge").hidden = !(run || s.phase === "ready");
  $("heightGauge").hidden = !flying;
  $("vRead").textContent = `${(s.v * 40).toFixed(0)}°`;
  $("yawRead").textContent = `${(s.yaw / rad).toFixed(1)}°`;
  $("vRead").style.color = s.v > 0.14 ? "#f3c883" : "#cbf7b4";
  $("yawRead").style.color = Math.abs(s.yaw) > 9 * rad ? "#ff9876" : "#cbf7b4";
  $("balance").textContent = s.jitter > 0.25 ? "UNSETTLED" : "STEADY";
  let cue = "";
  if (s.phase === "landing") {
    const elapsed = s.t - s.touchdown.time;
    const tapError =
      s.tapTime === null ? Infinity : Math.abs(s.tapTime - s.touchdown.time);
    cue = s.fall
      ? "FALL"
      : elapsed < 0.15
        ? "TOUCHDOWN"
        : tapError < 0.04 &&
            Math.abs(s.touchdown.yaw) < 1.8 * rad &&
            s.touchdown.v < 0.028
          ? "PERFECT LANDING"
          : tapError <= 0.15
            ? "LANDED"
            : "LANDED · MISSED TAP";
  }
  $("cue").classList.toggle("fall", s.fall);
  $("cue").textContent = cue;
  $("help").hidden = run || flying || s.phase === "landing";
}
// Lightweight perspective projection: x lateral, y altitude, z down the hill.
let cam;
function project(x, y, z) {
  const dz = z - cam.z;
  if (dz <= 0.8) return null;
  const scale = (W * 1.02) / dz;
  return {
    x: W / 2 + (x - cam.x) * scale,
    y: H * 0.37 - ((y - cam.y) / dz + cam.tilt) * W * 1.02,
    scale,
  };
}
function poly(points, fill, stroke, width = 1) {
  if (points.some((p) => !p)) return;
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
function line(a, b, color, width) {
  if (!a || !b) return;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
}
function render() {
  const s = state;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#315c72");
  sky.addColorStop(0.47, "#c5e1e7");
  sky.addColorStop(1, "#eef6f6");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ecf6e788";
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.18, 28, 0, Math.PI * 2);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    const points = [{ x: -20, y: H * 0.51 }];
    for (let i = 0; i < 12; i++)
      points.push({
        x: (i * W) / 10 - W * 0.05,
        y:
          H * (0.3 + layer * 0.055) -
          Math.sin(i * 2.3 + layer * 1.8) * H * 0.04,
      });
    points.push({ x: W + 30, y: H * 0.65 }, { x: -20, y: H * 0.65 });
    poly(points, ["#85adbc", "#7098aa", "#557e91"][layer]);
  }
  cam = { z: s.z - 19, x: s.x * 0.62, y: s.y + 9, tilt: 0.36 };
  const start = Math.floor((cam.z + 2) / 4) * 4;
  for (let z = start + 340; z >= start; z -= 4) {
    const a = Math.max(z, cam.z + 1),
      b = z + 4;
    if (b <= cam.z + 1) continue;
    const ga = ground(a),
      gb = ground(b);
    poly(
      [
        project(-150, ga - 0.6, a),
        project(150, ga - 0.6, a),
        project(150, gb - 0.6, b),
        project(-150, gb - 0.6, b),
      ],
      z % 8 === 0 ? "#d6e7eb" : "#d2e3e8",
    );
    if (a >= 0) {
      poly(
        [
          project(-15, ga, a),
          project(15, ga, a),
          project(15, gb, b),
          project(-15, gb, b),
        ],
        z % 8 === 0 ? "#f0f6f5" : "#eaf2f2",
      );
      for (const side of [-1, 1])
        line(
          project(side * 15, ga + 0.04, a),
          project(side * 15, gb + 0.04, b),
          "#8eb9c4",
          2,
        );
    } else if (b <= 0) {
      poly(
        [
          project(-4, ga + 0.02, a),
          project(4, ga + 0.02, a),
          project(4, gb + 0.02, b),
          project(-4, gb + 0.02, b),
        ],
        "#f4f9f6",
      );
      for (const x of [-3.9, 3.9])
        line(project(x, ga + 0.5, a), project(x, gb + 0.5, b), "#315466", 3);
      for (const x of [-0.52, 0.52])
        line(project(x, ga + 0.06, a), project(x, gb + 0.06, b), "#8aafb9", 2);
    }
  }
  for (let z = 240; z >= Math.max(10, cam.z + 4); z -= 10) {
    const g = ground(z),
      major = z % 20 === 0;
    if (major) {
      line(
        project(-15, g + 0.08, z),
        project(15, g + 0.08, z),
        z === 120 ? "#e37d52" : "#c1d7db",
        z === 120 ? 3 : 1,
      );
      const p = project(17, g + 0.1, z);
      if (p) {
        ctx.fillStyle = "#527d8e";
        ctx.font = `bold ${clamp(p.scale * 1.1, 8, 23)}px system-ui`;
        ctx.fillText(z === 120 ? "K120" : String(z), p.x, p.y);
      }
    }
    for (const side of [-1, 1]) {
      const x = side * (24 + 4 * Math.sin(z * 2));
      poly(
        [project(x - 2, g, z), project(x + 2, g, z), project(x, g + 8, z)],
        "#3b6876",
      );
      line(
        project(side * 15, g, z),
        project(side * 15, g + 1, z),
        "#e77f53",
        2,
      );
    }
  }
  if (cam.z < 0) {
    poly(
      [
        project(-4, 42, 0),
        project(4, 42, 0),
        project(4, 39, 0),
        project(-4, 39, 0),
      ],
      "#7397a4",
    );
    line(project(-4, 42.1, 0), project(4, 42.1, 0), "#ff9554", 5);
  }
  // Ground shadow makes height readable independently of the numerical gauge.
  const shadow = project(s.x, ground(s.z) + 0.08, s.z);
  if (shadow) {
    ctx.save();
    ctx.translate(shadow.x, shadow.y);
    ctx.scale(1, 0.32);
    ctx.fillStyle = "#34546630";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawJumper();
  if (pointer.down && !introOpen && s.phase !== "result") {
    ctx.beginPath();
    ctx.arc(pointer.x, pointer.y, 17, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff88";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const vignette = ctx.createLinearGradient(0, H * 0.76, 0, H);
  vignette.addColorStop(0, "#10293600");
  vignette.addColorStop(1, "#10293655");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, H * 0.76, W, H * 0.24);
}
function drawJumper() {
  const s = state,
    p = project(s.x, s.y + 0.1, s.z);
  if (!p) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  const landedFor = s.touchdown ? Math.max(0, s.t - s.touchdown.time) : 0;
  const impact = s.touchdown
    ? Math.sin(clamp(landedFor / 0.45, 0, 1) * Math.PI)
    : 0;
  ctx.translate(0, s.fall ? 13 * clamp(landedFor / 0.4, 0, 1) : 5 * impact);
  ctx.rotate(s.fall ? 1.35 * clamp(landedFor / 0.4, 0, 1) : -s.yaw * 0.8);
  if (!s.fall) ctx.scale(1, 1 - 0.16 * impact);
  const size = clamp(W / 390, 0.8, 1.4);
  ctx.scale(size, size);
  const flying = s.phase === "flight";
  // Tips open away from one another; total displayed V angle is up to 40 degrees.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 8, 4);
    ctx.rotate(side * s.v * 20 * rad);
    ctx.fillStyle = "#c8f49d";
    ctx.strokeStyle = "#22404a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-4, -55, 8, 84, 4);
    ctx.fill();
    ctx.stroke();
    line({ x: 0, y: -42 }, { x: 0, y: -16 }, "#578861", 2);
    ctx.restore();
  }
  line({ x: -8, y: 8 }, { x: -7, y: -15 }, "#163948", 7);
  line({ x: 8, y: 8 }, { x: 7, y: -15 }, "#163948", 7);
  ctx.fillStyle = "#f17b4d";
  ctx.beginPath();
  ctx.roundRect(-13, -43, 26, 33, 8);
  ctx.fill();
  line(
    { x: -12, y: -35 },
    { x: flying ? -22 : -17, y: flying ? -7 : -22 },
    "#fba27a",
    6,
  );
  line(
    { x: 12, y: -35 },
    { x: flying ? 22 : 17, y: flying ? -7 : -22 },
    "#fba27a",
    6,
  );
  ctx.fillStyle = "#edf5ed";
  ctx.beginPath();
  ctx.ellipse(0, -48, 11, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  line({ x: -7, y: -50 }, { x: 7, y: -50 }, "#214755", 4);
  ctx.fillStyle = "#fff1dc";
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("07", 0, -23);
  ctx.restore();
}
function frame(now) {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
  lastFrame = now;
  // Bounded substeps avoid collision tunnelling on slower phones.
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  for (let i = 0; i < steps; i++) update(dt / steps);
  render();
  hud();
  requestAnimationFrame(frame);
}
reset();
requestAnimationFrame(frame);
