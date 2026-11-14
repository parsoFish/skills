import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkPrd, GRAMMAR, parsePrd, requirementsOf, run, storiesOf } from "./prd.mjs";

const PRD = `# A product: product requirements

## 1. What it is

One paragraph of prose.

## 2. Stories

### The router

- **R-01** \`must\` As an operator I want one place to say what I want done.
  Done when: there is one place, and nothing asks me to pick a kind of session first.
- **C-02** \`should\` ⇄ As an operator I want to be told when a feature I requested is ready.
  Done when: ready work is an inbox item.
  Changed: it arrives in the inbox, not as its own notification.
- **C-28** \`later\` As a developer I want a continuous self-evaluation.
  Done when: the app keeps a running read of what is asked of it.

## 3. Requirements

### The router

- **HR-01** There is one way in. *Serves R-01, C-02.*
  - Given the operator wants anything done, when they say it, then the router takes it.
  - Given work is ready, when it ships, then it is an inbox item.
`;

test("a PRD is read into stories and requirements, in the document's words", () => {
  const prd = parsePrd(PRD);
  assert.deepEqual(prd.sections.map((s) => s.title), ["1. What it is", "2. Stories", "3. Requirements"]);
  assert.deepEqual(prd.sections[0].prose.filter(Boolean), ["One paragraph of prose."]);
  assert.deepEqual(storiesOf(prd)[1], {
    id: "C-02", priority: "should", both: true, text: "As an operator I want to be told when a feature I requested is ready.",
    doneWhen: "ready work is an inbox item.", from: "", changed: "it arrives in the inbox, not as its own notification.",
  });
  assert.deepEqual(requirementsOf(prd), [{
    id: "HR-01", text: "There is one way in.", serves: ["R-01", "C-02"],
    acceptance: ["Given the operator wants anything done, when they say it, then the router takes it.", "Given work is ready, when it ships, then it is an inbox item."],
  }]);
  assert.equal(prd.sections[1].groups[0].title, "The router");
  assert.equal(prd.stories.length, 3);
});

test("ids of any prefix are accepted, not a fixed list of letters", () => {
  const prd = parsePrd("## S\n\n- **UX2-10** `must` A story.\n  Done when: yes.\n- **API-3** A rule. *Serves UX2-10.*\n  - Given a, when b, then c.\n");
  assert.deepEqual(prd.stories.map((s) => s.id), ["UX2-10"]);
  assert.deepEqual(prd.requirements.map((r) => r.id), ["API-3"]);
  assert.deepEqual(checkPrd(prd), []);
});

test("a PRD that holds together has nothing to report; a later story needs no requirement yet", () => {
  assert.deepEqual(checkPrd(parsePrd(PRD)), []);
});

test("the check names a story no requirement serves, a requirement serving a missing story, and a story with no done-when", () => {
  const broken = PRD
    .replace("*Serves R-01, C-02.*", "*Serves R-01, X-09.*")
    .replace("  Done when: there is one place, and nothing asks me to pick a kind of session first.\n", "");
  assert.deepEqual(checkPrd(parsePrd(broken)), [
    "story R-01 has no done-when",
    "requirement HR-01 serves X-09, which is not a story in this PRD",
    "story C-02 (should) is served by no requirement",
  ]);
});

test("a requirement with no given/when/then line is reported", () => {
  const broken = PRD.replace(/ {2}- Given .*\n/g, "");
  assert.deepEqual(checkPrd(parsePrd(broken)), ["requirement HR-01 has no given/when/then"]);
});

test("a duplicate story id, a duplicate requirement id, and an id shared by both are each reported", () => {
  const twice = PRD + "\n- **R-01** `must` Again.\n  Done when: x.\n- **HR-01** Again. *Serves R-01.*\n  - Given a, when b, then c.\n- **R-01** Shared. *Serves C-02.*\n  - Given a, when b, then c.\n";
  const found = checkPrd(parsePrd(twice));
  assert.ok(found.includes("story R-01 appears twice"));
  assert.ok(found.includes("requirement HR-01 appears twice"));
  assert.ok(found.includes("id R-01 is used by both a story and a requirement"));
});

test("a line that looks like an item but breaks the grammar is reported with its line number", () => {
  const found = checkPrd(parsePrd("## S\n\n- **R-01** must A story with no backticks.\n  Done when: x.\n"));
  assert.equal(found.length, 1);
  assert.match(found[0], /^line 3 looks like a story or a requirement but does not match the grammar: - \*\*R-01\*\* must/);
});

test("a bold bullet that is not an id is plain prose, not a malformed item", () => {
  const prd = parsePrd("## S\n\n- **Note** this is prose.\n");
  assert.deepEqual(checkPrd(prd), []);
});

test("the grammar text is exported and names every field", () => {
  for (const word of ["must", "should", "later", "Done when", "From", "Changed", "Serves", "Given", "⇄"]) assert.ok(GRAMMAR.includes(word), word);
});

test("run: check prints problems and returns 1; a clean file returns 0; counts reports tiers", () => {
  const dir = mkdtempSync(join(tmpdir(), "prd-"));
  const good = join(dir, "good.md");
  const bad = join(dir, "bad.md");
  writeFileSync(good, PRD);
  writeFileSync(bad, PRD.replace("*Serves R-01, C-02.*", "*Serves R-01.*"));
  const capture = () => { const lines = []; return { lines, out: (l) => lines.push(l) }; };
  const a = capture();
  assert.equal(run(["check", good], a), 0);
  assert.match(a.lines[0], /3 stories, 1 requirements: holds together/);
  const b = capture();
  assert.equal(run(["check", good, bad], b), 1);
  assert.ok(b.lines.some((l) => l.includes("story C-02 (should) is served by no requirement")));
  const c = capture();
  assert.equal(run(["counts", good], c), 0);
  assert.equal(c.lines[0], `${good}: stories 3 (must 1, should 1, later 1); requirements 1`);
});

test("run: a missing file, no files and an unknown verb are usage errors (2) with a sentence", () => {
  const errors = [];
  const err = (l) => errors.push(l);
  assert.equal(run(["check", "/no/such/file.md"], { out() {}, err }), 2);
  assert.equal(run(["check"], { out() {}, err }), 2);
  assert.equal(run(["bogus", "x"], { out() {}, err }), 2);
  assert.equal(run(["counts", "a", "b"], { out() {}, err }), 2);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /cannot read/);
  assert.match(errors[2], /usage:/);
});

test("the CLI runs as a script and exits with the verdict", () => {
  const dir = mkdtempSync(join(tmpdir(), "prd-"));
  const file = join(dir, "p.md");
  writeFileSync(file, PRD.replace("*Serves R-01, C-02.*", "*Serves R-01.*"));
  const script = fileURLToPath(new URL("./prd.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script, "check", file], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /served by no requirement/);
});
