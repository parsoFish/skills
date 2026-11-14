// Looks at a review page, or any page, the way a person would: shoots it at desktop and phone sizes and fails when
// the page scrolls sideways.
//   node check.mjs <url-or-round> [--devices desktop,phone] [--out <dir>] [--full] [--click <selector>]...
//                  [--wait <ms>] [--browser <path>] [--workspace <dir>]
// A round id (such as 02-arch-2) is resolved through reviews/.server.json. Shots go to
// reviews/<round>/_shots/<device>.png (reviews/_shots for a URL). Exit 0 all good, 1 an overflow or a failed shot,
// 2 the command could not run (bad option, no server, no browser). The browser is driven by cdp.mjs.
import { statSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cdpDriver from "./cdp.mjs";

export const DEVICES = {
  desktop: { width: 1440, height: 900, scale: 1, mobile: false },
  "desktop-tall": { width: 1440, height: 2800, scale: 1, mobile: false },
  phone: { width: 412, height: 915, scale: 2, mobile: true, platform: "Android", userAgent: "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" },
  "phone-small": { width: 360, height: 740, scale: 2, mobile: true, platform: "Android", userAgent: "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" },
};
export const DEFAULT_DEVICES = ["desktop", "phone"];

// Looked up on PATH in this order, then in the install locations of the platform.
export const BROWSER_COMMANDS = ["chromium", "chromium-browser", "google-chrome", "chrome", "msedge", "brave"];
// %NAME% is an environment variable; a location whose variable is unset is skipped.
export const INSTALL_LOCATIONS = {
  linux: ["/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge", "/snap/bin/chromium", "/opt/google/chrome/chrome", "/opt/brave.com/brave/brave"],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  win32: [
    "%ProgramFiles%/Google/Chrome/Application/chrome.exe", "%ProgramFiles(x86)%/Google/Chrome/Application/chrome.exe",
    "%LocalAppData%/Google/Chrome/Application/chrome.exe", "%ProgramFiles(x86)%/Microsoft/Edge/Application/msedge.exe",
    "%ProgramFiles%/Microsoft/Edge/Application/msedge.exe", "%ProgramFiles%/BraveSoftware/Brave-Browser/Application/brave.exe",
  ],
};

const BROWSER_ENV = "REDESIGN_BROWSER";
const DEFAULT_WAIT_MS = 1000;
const OVERFLOW_TOLERANCE_PX = 1; // sub-pixel rounding between innerWidth and scrollWidth
const ROUND_ID = /^\d{2}-[a-z][a-z0-9]*-\d+$/;
const URL_TARGET = /^https?:\/\//;
const USAGE = "usage: node check.mjs <url-or-round> [--devices desktop,phone] [--out <dir>] [--full] [--click <selector>]... [--wait <ms>] [--browser <path>] [--workspace <dir>]";

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Every place a browser might be, best first, without checking any: PATH command by command, then install locations. */
export const browserCandidates = ({ env = process.env, platform = process.platform, pathEnv = env.PATH ?? env.Path ?? "" } = {}) => {
  const dirs = pathEnv.split(platform === "win32" ? ";" : ":").filter(Boolean).map((d) => d.replace(/[\\/]+$/, ""));
  const suffix = platform === "win32" ? ".exe" : "";
  const onPath = BROWSER_COMMANDS.flatMap((name) => dirs.map((dir) => `${dir}/${name}${suffix}`));
  const known = (INSTALL_LOCATIONS[platform] ?? []).flatMap((location) => {
    const names = [...location.matchAll(/%([^%]+)%/g)].map((m) => m[1]);
    return names.every((n) => env[n]) ? [location.replace(/%([^%]+)%/g, (_, n) => env[n].replace(/[\\/]+$/, ""))] : [];
  });
  return [...onPath, ...known];
};

/** The browser to drive: --browser, else REDESIGN_BROWSER, else the first candidate that exists. An explicit path that is missing fails. */
export const findBrowser = ({ flag = null, env = process.env, platform = process.platform, pathEnv, exists = isFile } = {}) => {
  const explicit = flag ?? env[BROWSER_ENV];
  if (explicit) {
    if (!exists(explicit)) throw new Error(`${flag ? "--browser" : BROWSER_ENV} is ${explicit}, but there is no browser file there; fix the path or leave it unset to search`);
    return explicit;
  }
  const found = browserCandidates({ env, platform, ...(pathEnv === undefined ? {} : { pathEnv }) }).find(exists);
  if (found) return found;
  throw new Error(`no Chromium-based browser found. Looked for ${BROWSER_COMMANDS.join(", ")} on PATH and in ${(INSTALL_LOCATIONS[platform] ?? []).length} usual install locations for ${platform}. Install one, or pass --browser <path> or set ${BROWSER_ENV}.`);
};

/**
 * Whether a page scrolls sideways at this width, and the sentence that says so. A phone browser widens its layout
 * viewport to fit wide content, which would raise innerWidth with it and hide the overflow, so the device's own
 * width (`viewportWidth`), when given, caps the comparison.
 */
export const overflowVerdict = ({ device, innerWidth, scrollWidth, viewportWidth = innerWidth }) => {
  const width = Math.min(innerWidth, viewportWidth);
  const overflows = scrollWidth > width + OVERFLOW_TOLERANCE_PX;
  return { overflows, message: overflows ? `horizontal overflow on ${device}: the page is ${scrollWidth} px wide in a ${width} px viewport` : "ok" };
};

/** The command line as data. Throws a sentence on anything it cannot use. */
export const parseArgs = (argv) => {
  const args = { target: null, devices: DEFAULT_DEVICES, out: null, full: false, clicks: [], wait: null, browser: null, workspace: null };
  const value = (i, flag) => {
    if (argv[i + 1] === undefined || argv[i + 1] === "" || argv[i + 1].startsWith("--")) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") args.full = true;
    else if (a === "--devices") args.devices = value(i++, a).split(",").filter(Boolean);
    else if (a === "--out") args.out = value(i++, a);
    else if (a === "--click") args.clicks = [...args.clicks, value(i++, a)];
    else if (a === "--browser") args.browser = value(i++, a);
    else if (a === "--workspace") args.workspace = value(i++, a);
    else if (a === "--wait") {
      const n = Number(value(i++, a));
      if (!Number.isFinite(n) || n < 0) throw new Error("--wait needs a number of milliseconds");
      args.wait = n;
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}\n${USAGE}`);
    else if (args.target === null) args.target = a;
    else throw new Error(`one target only (a URL or a round id), got ${args.target} and ${a}`);
  }
  if (args.target === null) throw new Error(USAGE);
  const unknown = args.devices.filter((n) => !DEVICES[n]);
  if (unknown.length || !args.devices.length) throw new Error(`no device "${unknown.join(", ")}": choose from ${Object.keys(DEVICES).join(", ")}`);
  return args;
};

/** The page address: a URL as given; a round id through the server recorded in reviews/.server.json. */
export const resolveUrl = (target, { workspace }) => {
  if (URL_TARGET.test(target)) return target;
  if (!ROUND_ID.test(target)) throw new Error(`${target} is neither a URL nor a round id like 02-arch-2`);
  const file = join(workspace, "reviews", ".server.json");
  let text;
  try { text = readFileSync(file, "utf8"); } catch (error) {
    if (error.code === "ENOENT") throw new Error(`no review server is recorded in ${file}; start one with serve.mjs --detach, or pass the page's URL`);
    throw error;
  }
  let record;
  try { record = JSON.parse(text); } catch { throw new Error(`${file} is not valid JSON; restart the server with serve.mjs --detach`); }
  if (typeof record?.url !== "string") throw new Error(`${file} has no url; restart the server with serve.mjs --detach`);
  return `${record.url.replace(/\/*$/, "/")}${target}/`;
};

/** The CLI as a function; `driver` is cdp.mjs unless a test supplies a stand-in. Returns the exit code. */
export const run = async (argv, { out = console.log, err = console.error, driver = cdpDriver, env = process.env } = {}) => {
  let args, url, browser;
  const workspaceOf = (a) => a.workspace ?? process.cwd();
  try {
    args = parseArgs(argv);
    url = resolveUrl(args.target, { workspace: workspaceOf(args) });
    browser = findBrowser({ flag: args.browser, env });
  } catch (error) {
    err(`check: ${error.message}`);
    return 2;
  }
  const dir = args.out ?? (ROUND_ID.test(args.target) ? join(workspaceOf(args), "reviews", args.target, "_shots") : join(workspaceOf(args), "reviews", "_shots"));
  mkdirSync(dir, { recursive: true });
  let session;
  try { session = await driver.launchBrowser(browser); } catch (error) { err(`check: ${error.message}`); return 2; }
  let failed = 0;
  try {
    for (const name of args.devices) {
      const file = join(dir, `${name}.png`);
      try {
        const page = await driver.capture(session.cdp, { url, device: DEVICES[name], file, waitMs: args.wait ?? DEFAULT_WAIT_MS, clicks: args.clicks, full: args.full });
        const verdict = overflowVerdict({ device: name, ...page, viewportWidth: DEVICES[name].width });
        out(`${name}: ${file} (${DEVICES[name].width} px wide) ${verdict.overflows ? `FAIL ${verdict.message}` : verdict.message}`);
        if (verdict.overflows) failed++;
      } catch (error) {
        err(`${name}: failed: ${error.message}`);
        failed++;
      }
    }
  } finally {
    await session.close();
  }
  out(`${args.devices.length - failed} of ${args.devices.length} shots clean`);
  return failed ? 1 : 0;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await run(process.argv.slice(2));
