import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BROWSER_COMMANDS, DEFAULT_DEVICES, DEVICES, INSTALL_LOCATIONS, browserCandidates, findBrowser, overflowVerdict,
  parseArgs, resolveUrl, run,
} from "./check.mjs";

const workspaceWithServer = (url = "http://127.0.0.1:7801/") => {
  const dir = mkdtempSync(join(tmpdir(), "check-"));
  mkdirSync(join(dir, "reviews"));
  writeFileSync(join(dir, "reviews", ".server.json"), JSON.stringify({ pid: 1, port: 7801, url, startedAt: "x" }));
  return dir;
};

test("devices: a data table whose entries all carry a size, a pixel ratio and a mobile flag; phones carry touch identity", () => {
  assert.deepEqual(Object.keys(DEVICES), ["desktop", "desktop-tall", "phone", "phone-small"]);
  for (const [name, d] of Object.entries(DEVICES)) {
    for (const key of ["width", "height", "scale"]) assert.ok(Number.isFinite(d[key]) && d[key] > 0, `${name}.${key}`);
    assert.equal(typeof d.mobile, "boolean", name);
    if (d.mobile) {
      assert.match(d.userAgent, /Mobile/, name);
      assert.equal(d.platform, "Android");
      assert.doesNotMatch(d.userAgent, /Pixel|Samsung|iPhone/, "a generic device, not a named model");
    }
  }
  assert.equal(DEVICES.phone.width, 412);
  assert.equal(DEVICES["phone-small"].width, 360);
  assert.ok(DEFAULT_DEVICES.every((n) => DEVICES[n]));
});

test("browserCandidates: command by command across PATH, in the named order, then the install locations", () => {
  const found = browserCandidates({ env: {}, platform: "linux", pathEnv: "/a:/b" });
  assert.deepEqual(BROWSER_COMMANDS.slice(0, 3), ["chromium", "chromium-browser", "google-chrome"]);
  assert.deepEqual(BROWSER_COMMANDS, ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge", "brave"]);
  assert.deepEqual(found.slice(0, 4), ["/a/chromium", "/b/chromium", "/a/chromium-browser", "/b/chromium-browser"]);
  const lastOnPath = found.indexOf("/b/brave");
  assert.ok(lastOnPath > -1);
  assert.deepEqual(found.slice(lastOnPath + 1), INSTALL_LOCATIONS.linux);
});

test("browserCandidates: windows adds .exe, expands install locations from the environment and skips unset variables", () => {
  const found = browserCandidates({ env: { ProgramFiles: "C:/PF" }, platform: "win32", pathEnv: "C:/bin" });
  assert.equal(found[0], "C:/bin/chromium.exe");
  assert.ok(found.some((p) => p.startsWith("C:/PF/")));
  assert.ok(found.every((p) => !p.includes("%")));
});

test("the install-location table covers macOS, Linux and Windows", () => {
  for (const platform of ["darwin", "linux", "win32"]) assert.ok(INSTALL_LOCATIONS[platform].length > 0, platform);
});

test("findBrowser: --browser beats REDESIGN_BROWSER beats PATH; an explicit path that is missing fails and does not fall through", () => {
  const exists = (p) => ["/flag/b", "/env/b", "/bin/chromium"].includes(p);
  const base = { platform: "linux", pathEnv: "/bin", exists };
  assert.equal(findBrowser({ ...base, flag: "/flag/b", env: { REDESIGN_BROWSER: "/env/b" } }), "/flag/b");
  assert.equal(findBrowser({ ...base, env: { REDESIGN_BROWSER: "/env/b" } }), "/env/b");
  assert.equal(findBrowser({ ...base, env: {} }), "/bin/chromium");
  assert.throws(() => findBrowser({ ...base, flag: "/gone", env: {} }), /--browser.*\/gone/);
  assert.throws(() => findBrowser({ ...base, env: { REDESIGN_BROWSER: "/gone" } }), /REDESIGN_BROWSER.*\/gone/);
});

test("findBrowser: the failure names every command it looked for and how to fix it", () => {
  assert.throws(() => findBrowser({ env: {}, platform: "linux", pathEnv: "/bin", exists: () => false }), (error) => {
    for (const name of BROWSER_COMMANDS) assert.ok(error.message.includes(name), name);
    assert.match(error.message, /--browser/);
    assert.match(error.message, /REDESIGN_BROWSER/);
    return true;
  });
});

test("overflowVerdict: a page wider than the viewport fails and names the device and width; one pixel of rounding does not", () => {
  const bad = overflowVerdict({ device: "phone", innerWidth: 412, scrollWidth: 530 });
  assert.equal(bad.overflows, true);
  assert.match(bad.message, /phone/);
  assert.match(bad.message, /412/);
  assert.match(bad.message, /530/);
  assert.equal(overflowVerdict({ device: "phone", innerWidth: 412, scrollWidth: 413 }).overflows, false);
  assert.equal(overflowVerdict({ device: "desktop", innerWidth: 1440, scrollWidth: 1440 }).overflows, false);
  // A phone browser widens its layout viewport to fit wide content: innerWidth follows the content, the device width does not.
  const widened = overflowVerdict({ device: "phone", innerWidth: 908, scrollWidth: 908, viewportWidth: 412 });
  assert.equal(widened.overflows, true);
  assert.match(widened.message, /908.*412/);
});

test("parseArgs: defaults, then every flag; --click repeats in order", () => {
  assert.deepEqual(parseArgs(["01-prd-1"]), { target: "01-prd-1", devices: DEFAULT_DEVICES, out: null, full: false, clicks: [], wait: null, browser: null, workspace: null });
  const args = parseArgs(["http://x/", "--devices", "phone,desktop-tall", "--out", "o", "--full", "--click", "#a", "--click", "#b", "--wait", "250", "--browser", "/b", "--workspace", "/w"]);
  assert.deepEqual(args, { target: "http://x/", devices: ["phone", "desktop-tall"], out: "o", full: true, clicks: ["#a", "#b"], wait: 250, browser: "/b", workspace: "/w" });
});

test("parseArgs: refuses what it cannot use, with a sentence", () => {
  assert.throws(() => parseArgs([]), /usage:/);
  assert.throws(() => parseArgs(["a", "b"]), /one target/);
  assert.throws(() => parseArgs(["a", "--devices", "tablet"]), /no device "tablet".*desktop, desktop-tall, phone, phone-small/);
  assert.throws(() => parseArgs(["a", "--wait", "soon"]), /--wait needs a number/);
  assert.throws(() => parseArgs(["a", "--out"]), /--out needs a value/);
  assert.throws(() => parseArgs(["a", "--nope"]), /unknown option --nope/);
});

test("resolveUrl: a URL is used as it is; a round id is joined to the server in reviews/.server.json", () => {
  assert.equal(resolveUrl("http://127.0.0.1:9/x/#tab", { workspace: "/nowhere" }), "http://127.0.0.1:9/x/#tab");
  const dir = workspaceWithServer("http://127.0.0.1:7801/");
  assert.equal(resolveUrl("02-arch-2", { workspace: dir }), "http://127.0.0.1:7801/02-arch-2/");
  const noSlash = workspaceWithServer("http://127.0.0.1:7802");
  assert.equal(resolveUrl("02-arch-2", { workspace: noSlash }), "http://127.0.0.1:7802/02-arch-2/");
});

test("resolveUrl: no server file, a broken one, or something that is neither a URL nor a round id fail with a sentence", () => {
  const empty = mkdtempSync(join(tmpdir(), "check-"));
  assert.throws(() => resolveUrl("02-arch-2", { workspace: empty }), /no review server is recorded.*serve\.mjs/);
  const broken = mkdtempSync(join(tmpdir(), "check-"));
  mkdirSync(join(broken, "reviews"));
  writeFileSync(join(broken, "reviews", ".server.json"), "{nope");
  assert.throws(() => resolveUrl("02-arch-2", { workspace: broken }), /\.server\.json.*not valid JSON/);
  assert.throws(() => resolveUrl("whatever", { workspace: empty }), /neither a URL nor a round id/);
});

// A driver that records what it was asked and reports a width per device, so the whole run is exercised without a browser.
const fakeDriver = (widths) => {
  const calls = { launched: null, captures: [], closed: false };
  return {
    calls,
    launchBrowser: async (browser) => { calls.launched = browser; return { cdp: {}, close: async () => { calls.closed = true; } }; },
    capture: async (_cdp, options) => { calls.captures.push(options); return widths[options.device.width] ?? { innerWidth: options.device.width, scrollWidth: options.device.width }; },
  };
};
const collect = () => { const out = []; const err = []; return { out, err, io: { out: (l) => out.push(l), err: (l) => err.push(l) } }; };

test("run: shoots each device in order into the out directory, one line per shot, exit 0 when nothing overflows", async () => {
  const dir = workspaceWithServer();
  const driver = fakeDriver({});
  const { out, io } = collect();
  const code = await run(["02-arch-2", "--devices", "desktop,phone", "--click", "#t", "--full", "--wait", "5", "--browser", process.execPath, "--workspace", dir], { ...io, driver });
  assert.equal(code, 0);
  assert.deepEqual(driver.calls.captures.map((c) => c.device.width), [1440, 412]);
  assert.equal(driver.calls.captures[0].url, "http://127.0.0.1:7801/02-arch-2/");
  assert.deepEqual(driver.calls.captures[0].clicks, ["#t"]);
  assert.equal(driver.calls.captures[0].full, true);
  assert.equal(driver.calls.captures[0].waitMs, 5);
  assert.equal(driver.calls.captures[0].file, join(dir, "reviews", "02-arch-2", "_shots", "desktop.png"));
  assert.equal(out.length, 2 + 1);
  assert.match(out[0], /desktop.*desktop\.png.*ok/);
  assert.equal(driver.calls.closed, true);
});

test("run: a horizontal overflow is a failure naming the device and width, and exit 1", async () => {
  const dir = workspaceWithServer();
  const driver = fakeDriver({ 412: { innerWidth: 530, scrollWidth: 530 } });
  const { out, io } = collect();
  const code = await run(["02-arch-2", "--devices", "desktop,phone", "--browser", process.execPath, "--workspace", dir], { ...io, driver });
  assert.equal(code, 1);
  assert.ok(out.some((l) => /phone.*FAIL.*530.*412/.test(l)));
  assert.equal(driver.calls.captures.length, 2, "the other device is still shot");
});

test("run: a capture that throws is reported against its device, the rest carry on, exit 1", async () => {
  const dir = workspaceWithServer();
  const driver = fakeDriver({});
  const original = driver.capture;
  driver.capture = async (cdp, options) => { if (options.device.width === 1440) throw new Error("--click: no element matches \"#t\""); return original(cdp, options); };
  const { out, err, io } = collect();
  const code = await run(["02-arch-2", "--devices", "desktop,phone", "--browser", process.execPath, "--workspace", dir], { ...io, driver });
  assert.equal(code, 1);
  assert.ok(err.some((l) => /desktop.*no element matches/.test(l)));
  assert.ok(out.some((l) => /phone.*ok/.test(l)));
  assert.equal(driver.calls.closed, true);
});

test("run: a URL target writes to reviews/_shots; usage and lookup problems exit 2 before any browser starts", async () => {
  const dir = workspaceWithServer();
  const driver = fakeDriver({});
  const { io } = collect();
  assert.equal(await run(["http://127.0.0.1:1/p/", "--devices", "phone", "--browser", process.execPath, "--workspace", dir], { ...io, driver }), 0);
  assert.equal(driver.calls.captures[0].file, join(dir, "reviews", "_shots", "phone.png"));
  const untouched = fakeDriver({});
  const bad = collect();
  assert.equal(await run(["--devices", "tablet", "x"], { ...bad.io, driver: untouched }), 2);
  assert.equal(await run(["02-arch-2", "--workspace", mkdtempSync(join(tmpdir(), "check-")), "--browser", process.execPath], { ...bad.io, driver: untouched }), 2);
  assert.equal(await run(["02-arch-2", "--workspace", dir, "--browser", "/no/such/browser"], { ...bad.io, driver: untouched }), 2);
  assert.equal(untouched.calls.launched, null);
  assert.equal(bad.err.length, 3);
});

test("the CLI runs as a script and exits 2 with a sentence on bad input", () => {
  const script = fileURLToPath(new URL("./check.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "x", "--devices", "tablet"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no device "tablet"/);
});
