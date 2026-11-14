import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserArgs, clickExpression, connect, deviceCommands, fullClip, parseDevToolsActivePort,
} from "./cdp.mjs";

// A socket the test drives by hand, standing in for the browser's debugging socket.
class FakeSocket extends EventTarget {
  static last = null;
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    FakeSocket.last = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; }
  reply(message) { this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(message) })); }
}

test("connect: send resolves with the result of the matching id", async () => {
  const cdp = await connect("ws://x", FakeSocket);
  const socket = FakeSocket.last;
  const answer = cdp.send("Page.enable", { a: 1 }, "S1");
  assert.deepEqual(socket.sent[0], { id: 1, method: "Page.enable", params: { a: 1 }, sessionId: "S1" });
  socket.reply({ id: 1, result: { ok: true } });
  assert.deepEqual(await answer, { ok: true });
});

test("connect: a protocol error rejects with the method name and the browser's words", async () => {
  const cdp = await connect("ws://x", FakeSocket);
  const answer = cdp.send("Page.navigate");
  FakeSocket.last.reply({ id: 1, error: { message: "bad url" } });
  await assert.rejects(answer, /Page\.navigate: bad url/);
});

test("connect: once resolves with an event's params for its session, and with null on timeout", async () => {
  const cdp = await connect("ws://x", FakeSocket);
  const waiting = cdp.once("Page.loadEventFired", "S1", 1000);
  FakeSocket.last.reply({ method: "Page.loadEventFired", sessionId: "other", params: { t: 0 } });
  FakeSocket.last.reply({ method: "Page.loadEventFired", sessionId: "S1", params: { t: 5 } });
  assert.deepEqual(await waiting, { t: 5 });
  assert.equal(await cdp.once("Never.happens", "S1", 5), null);
});

test("connect: a closed socket rejects calls still waiting, with a sentence", async () => {
  const cdp = await connect("ws://x", FakeSocket);
  const answer = cdp.send("Page.enable");
  FakeSocket.last.dispatchEvent(new Event("close"));
  await assert.rejects(answer, /debugging connection closed/);
});

test("connect: a socket that fails to open rejects with a sentence", async () => {
  class Failing extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event("error"))); }
  }
  await assert.rejects(connect("ws://x", Failing), /debugging socket failed/);
});

test("deviceCommands: a phone gets mobile metrics, touch and a mobile user agent before load; a desktop only metrics", () => {
  const phone = deviceCommands({ width: 412, height: 915, scale: 2, mobile: true, userAgent: "UA", platform: "Android" });
  assert.deepEqual(phone.map(([m]) => m), ["Emulation.setDeviceMetricsOverride", "Emulation.setTouchEmulationEnabled", "Emulation.setUserAgentOverride"]);
  assert.deepEqual(phone[0][1], { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
  assert.deepEqual(phone[1][1], { enabled: true, maxTouchPoints: 5 });
  assert.deepEqual(phone[2][1], { userAgent: "UA", platform: "Android" });
  const desktop = deviceCommands({ width: 1440, height: 900, scale: 1, mobile: false });
  assert.deepEqual(desktop.map(([m]) => m), ["Emulation.setDeviceMetricsOverride"]);
});

test("clickExpression: quotes the selector safely and reports a missing element", () => {
  const expression = clickExpression(`a[href="x'y"]`);
  assert.ok(expression.includes(JSON.stringify(`a[href="x'y"]`)));
  const el = { clicked: 0, click() { this.clicked++; }, scrollIntoView() {} };
  const document = { querySelector: (s) => (s === "#ok" ? el : null) };
  const evaluate = (selector) => new Function("document", `return ${clickExpression(selector)}`)(document);
  assert.deepEqual(evaluate("#ok"), { found: true });
  assert.equal(el.clicked, 1);
  assert.deepEqual(evaluate("#missing"), { found: false });
});

test("fullClip: covers the content height at the viewport width, capped", () => {
  assert.deepEqual(fullClip({ cssContentSize: { width: 412, height: 3000.4 } }, 412), { x: 0, y: 0, width: 412, height: 3001, scale: 1 });
  assert.equal(fullClip({ cssContentSize: { width: 412, height: 99999 } }, 412).height, 16000);
  assert.deepEqual(fullClip({ contentSize: { width: 412, height: 500 } }, 412), { x: 0, y: 0, width: 412, height: 500, scale: 1 });
});

test("parseDevToolsActivePort: reads the port and the browser socket path, null while incomplete", () => {
  assert.deepEqual(parseDevToolsActivePort("9222\n/devtools/browser/abc\n"), { port: 9222, url: "ws://127.0.0.1:9222/devtools/browser/abc" });
  assert.equal(parseDevToolsActivePort("9222\n"), null);
  assert.equal(parseDevToolsActivePort(""), null);
});

test("browserArgs: headless, own profile, an ephemeral debugging port; no sandbox flag unless asked", () => {
  const args = browserArgs("/tmp/p");
  assert.ok(args.includes("--headless=new"));
  assert.ok(args.includes("--user-data-dir=/tmp/p"));
  assert.ok(args.includes("--remote-debugging-port=0"));
  assert.ok(!args.includes("--no-sandbox"));
  assert.ok(browserArgs("/tmp/p", { noSandbox: true }).includes("--no-sandbox"));
});
