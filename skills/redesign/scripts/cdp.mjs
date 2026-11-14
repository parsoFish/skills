// A small DevTools-protocol driver: launch a Chromium-family browser headless, load a page under a device's
// emulation, click, and capture a PNG. No dependencies: the debugging socket is Node's own WebSocket.
//
// Headless browsers will not lay a page out narrower than a desktop minimum, have no touch and keep a desktop user
// agent, so `--window-size` gives a cropped desktop layout and not a phone. Emulation over the protocol sets the
// viewport, pixel ratio, touch and user agent before the page loads.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STARTUP_TIMEOUT_MS = 15000;
const STARTUP_POLL_MS = 100;
const LOAD_TIMEOUT_MS = 20000;
const CLICK_PAUSE_MS = 300;
// A page may save a click after a short debounce (the review client waits 500 ms); closing the tab sooner loses it.
const CLICK_SETTLE_MS = 1500;
const MAX_FULL_HEIGHT = 16000; // a capture taller than this fails in the browser; say so instead of truncating silently
const MAX_TOUCH_POINTS = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A connection: send(method, params, sessionId) resolves with the result; once(event, sessionId, ms) with the params, or null on timeout. */
export const connect = (url, WebSocketImpl = globalThis.WebSocket) => new Promise((resolve, reject) => {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  const waiters = [];
  let nextId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (!entry) return;
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
      return;
    }
    const i = waiters.findIndex((w) => w.event === message.method && w.sessionId === message.sessionId);
    if (i > -1) waiters.splice(i, 1)[0].resolve(message.params);
  });
  socket.addEventListener("close", () => {
    for (const entry of pending.values()) entry.reject(new Error(`${entry.method}: the browser's debugging connection closed`));
    pending.clear();
  });
  socket.addEventListener("error", () => reject(new Error("the browser's debugging socket failed")));
  socket.addEventListener("open", () => resolve({
    send: (method, params = {}, sessionId) => new Promise((res, rej) => {
      const id = ++nextId;
      pending.set(id, { resolve: res, reject: rej, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    }),
    once: (event, sessionId, timeoutMs) => new Promise((res) => {
      const waiter = { event, sessionId, resolve: res };
      waiters.push(waiter);
      setTimeout(() => { const i = waiters.indexOf(waiter); if (i > -1) { waiters.splice(i, 1); res(null); } }, timeoutMs);
    }),
    close: () => socket.close(),
  }));
});

/** The emulation calls for one device, as [method, params] pairs, to run before the page loads. */
export const deviceCommands = (device) => [
  ["Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: device.scale, mobile: device.mobile }],
  ...(device.mobile ? [
    ["Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: MAX_TOUCH_POINTS }],
    ["Emulation.setUserAgentOverride", { userAgent: device.userAgent, platform: device.platform }],
  ] : []),
];

/** A page-side expression that clicks the first match and says whether there was one. */
export const clickExpression = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { found: false };
  if (el.scrollIntoView) el.scrollIntoView({ block: "center" });
  el.click();
  return { found: true };
})()`;

/** The capture rectangle for the whole page, from Page.getLayoutMetrics. */
export const fullClip = (metrics, width) => {
  const size = metrics.cssContentSize ?? metrics.contentSize;
  return { x: 0, y: 0, width, height: Math.min(Math.ceil(size.height), MAX_FULL_HEIGHT), scale: 1 };
};

/** The two lines the browser writes when its debugging port is ready; null while the file is incomplete. */
export const parseDevToolsActivePort = (text) => {
  const [port, socketPath] = text.split(/\r?\n/);
  if (!/^\d+$/.test(port ?? "") || !socketPath?.startsWith("/")) return null;
  return { port: Number(port), url: `ws://127.0.0.1:${port}${socketPath}` };
};

export const browserArgs = (profile, { noSandbox = false } = {}) => [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  ...(noSandbox ? ["--no-sandbox"] : []), "about:blank",
];

/** Starts the browser with its own throwaway profile and connects. Returns { cdp, close }; close() always removes the profile. */
export const launchBrowser = async (browser, { startupTimeoutMs = STARTUP_TIMEOUT_MS } = {}) => {
  const profile = mkdtempSync(join(tmpdir(), "redesign-profile-"));
  // A sandboxed browser cannot start as root (a container); that is the one case the flag is for.
  const child = spawn(browser, browserArgs(profile, { noSandbox: process.getuid?.() === 0 }), { stdio: "ignore" });
  let failure = null;
  child.on("error", (error) => { failure = `could not start ${browser}: ${error.message}`; });
  child.on("exit", (code) => { failure ??= `${browser} exited with code ${code} before it opened its debugging port`; });
  const close = async () => {
    child.kill();
    await sleep(300); // the browser holds the profile open until it is gone
    try { rmSync(profile, { recursive: true, force: true }); } catch (error) { console.error(`check: could not remove the temporary browser profile ${profile}: ${error.message}`); }
  };
  try {
    let endpoint = null;
    for (let waited = 0; !endpoint; waited += STARTUP_POLL_MS) {
      if (failure) throw new Error(failure);
      if (waited >= startupTimeoutMs) throw new Error(`${browser} did not open its debugging port within ${startupTimeoutMs / 1000} s`);
      await sleep(STARTUP_POLL_MS);
      try { endpoint = parseDevToolsActivePort(readFileSync(join(profile, "DevToolsActivePort"), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return { cdp: await connect(endpoint.url), close };
  } catch (error) {
    await close();
    throw error;
  }
};

/**
 * One page, loaded under one device's emulation, clicked as asked, measured and written to `file` as a PNG.
 * Returns what the page reports about its width: { innerWidth, scrollWidth }.
 */
export const capture = async (cdp, { url, device, file, waitMs, clicks = [], full = false, loadTimeoutMs = LOAD_TIMEOUT_MS }) => {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await cdp.send("Page.enable", {}, sessionId);
    for (const [method, params] of deviceCommands(device)) await cdp.send(method, params, sessionId);
    const loaded = cdp.once("Page.loadEventFired", sessionId, loadTimeoutMs);
    const { errorText } = await cdp.send("Page.navigate", { url }, sessionId);
    if (errorText) throw new Error(`could not load ${url}: ${errorText}`);
    if (!(await loaded)) throw new Error(`${url} did not finish loading within ${loadTimeoutMs / 1000} s`);
    await sleep(waitMs);
    for (const selector of clicks) {
      const { result } = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: clickExpression(selector) }, sessionId);
      if (!result.value?.found) throw new Error(`--click: no element matches ${JSON.stringify(selector)} on ${url}`);
      await sleep(CLICK_PAUSE_MS);
    }
    if (clicks.length) await sleep(CLICK_SETTLE_MS);
    const { result } = await cdp.send("Runtime.evaluate", { returnByValue: true, expression:
      "({ innerWidth: window.innerWidth, scrollWidth: document.documentElement.scrollWidth })" }, sessionId);
    const shot = { format: "png" };
    if (full) {
      shot.clip = fullClip(await cdp.send("Page.getLayoutMetrics", {}, sessionId), device.width);
      shot.captureBeyondViewport = true;
    }
    const { data } = await cdp.send("Page.captureScreenshot", shot, sessionId);
    writeFileSync(file, Buffer.from(data, "base64"));
    return result.value;
  } finally {
    await cdp.send("Target.closeTarget", { targetId });
  }
};
