// Reads a product-requirements document as data, so review pages and checks work from the document itself and
// nothing is retyped.
//
//   node prd.mjs check <file>...     print what does not hold together; exit 1 if anything
//   node prd.mjs counts <file>       stories by tier, and requirements
//
// The grammar is exported as GRAMMAR; the same text is quoted by the skill's reference.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GRAMMAR = [
  "Headings: `## Section` and `### Group` organise the document; other lines are prose.",
  "Ids match /^[A-Z][A-Z0-9]*-\\d+$/. Stories are S-01, S-02 …; requirements are R-01, R-02 …",
  "(a prefix per track, such as CS-01 and CR-01, when two tracks share a page). Each id is used once.",
  "",
  "A story, one list item, with its fields indented two spaces beneath it:",
  "  - **S-01** `must` As an operator I want one place to say what I want done.",
  "    Done when: there is one place, and nothing asks me to pick a kind first.",
  "    From: where the story came from (optional)",
  "    Changed: what changed since the last version (optional)",
  "  The tier is `must`, `should` or `later`. A ⇄ after the tier means the other side of the story lives in a companion document.",
  "",
  "A requirement, one list item, with its acceptance lines indented beneath it:",
  "  - **R-01** What must hold. *Serves S-01, S-04.*",
  "    - Given a situation, when something happens, then this is the outcome.",
  "",
  "Checks: every story has a Done when; every `must` and `should` story is served by a requirement (`later` need not be);",
  "every requirement serves only stories that exist and has at least one Given/when/then line; no id repeats.",
].join("\n");

const ID = "[A-Z][A-Z0-9]*-\\d+";
const STORY = new RegExp(`^- \\*\\*(${ID})\\*\\* \`(must|should|later)\`( ⇄)? (.*)$`);
const REQUIREMENT = new RegExp(`^- \\*\\*(${ID})\\*\\* (.*?) \\*Serves (.*?)\\.\\*$`);
const ITEM_LIKE = /^- \*\*[A-Za-z][A-Za-z0-9]*-\d+\*\*/; // an id-shaped bold lead: an item that failed its grammar, not prose
const FIELD = /^ {2}(Done when|From|Changed): (.*)$/;
const ACCEPTANCE = /^ {2}- (Given .*)$/;
const FIELD_KEYS = { "Done when": "doneWhen", From: "from", Changed: "changed" };
const SNIPPET = 60;

/** A PRD as data: { sections: [{ title, prose, groups: [{ title, stories, requirements }] }], stories, requirements, malformed }. */
export const parsePrd = (markdown) => {
  const sections = [];
  const malformed = [];
  let item = null;
  const group = () => {
    const section = sections.at(-1);
    if (!section.groups.length) section.groups.push({ title: "", stories: [], requirements: [] });
    return section.groups.at(-1);
  };
  markdown.split(/\r?\n/).forEach((line, index) => {
    const head = line.match(/^## (.+)$/);
    if (head) { sections.push({ title: head[1], prose: [], groups: [] }); item = null; return; }
    if (!sections.length) return;
    const sub = line.match(/^### (.+)$/);
    if (sub) { sections.at(-1).groups.push({ title: sub[1], stories: [], requirements: [] }); item = null; return; }
    const story = line.match(STORY);
    if (story) {
      item = { id: story[1], priority: story[2], both: Boolean(story[3]), text: story[4], doneWhen: "", from: "", changed: "" };
      group().stories.push(item);
      return;
    }
    const requirement = line.match(REQUIREMENT);
    if (requirement) {
      item = { id: requirement[1], text: requirement[2], serves: requirement[3].split(",").map((s) => s.trim()).filter(Boolean), acceptance: [] };
      group().requirements.push(item);
      return;
    }
    const field = item && line.match(FIELD);
    if (field) { item[FIELD_KEYS[field[1]]] = field[2]; return; }
    const acceptance = item && line.match(ACCEPTANCE);
    if (acceptance) { item.acceptance.push(acceptance[1]); return; }
    if (line.trim() === "" && item) return;
    item = null;
    if (ITEM_LIKE.test(line)) malformed.push({ line: index + 1, text: line });
    sections.at(-1).prose.push(line);
  });
  const flat = (key) => sections.flatMap((s) => s.groups.flatMap((g) => g[key]));
  return { sections, stories: flat("stories"), requirements: flat("requirements"), malformed };
};

export const storiesOf = (prd) => prd.stories;
export const requirementsOf = (prd) => prd.requirements;

const repeated = (ids) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];

/** What is wrong with a parsed PRD, as sentences. Empty when every story and requirement holds together. */
export const checkPrd = (prd) => {
  const { stories, requirements } = prd;
  const storyIds = new Set(stories.map((s) => s.id));
  const requirementIds = new Set(requirements.map((r) => r.id));
  const served = new Set(requirements.flatMap((r) => r.serves));
  return [
    ...prd.malformed.map((m) => `line ${m.line} looks like a story or a requirement but does not match the grammar: ${m.text.slice(0, SNIPPET)}`),
    ...repeated(stories.map((s) => s.id)).map((id) => `story ${id} appears twice`),
    ...repeated(requirements.map((r) => r.id)).map((id) => `requirement ${id} appears twice`),
    ...[...storyIds].filter((id) => requirementIds.has(id)).map((id) => `id ${id} is used by both a story and a requirement`),
    ...stories.filter((s) => !s.doneWhen).map((s) => `story ${s.id} has no done-when`),
    ...requirements.filter((r) => r.acceptance.length === 0).map((r) => `requirement ${r.id} has no given/when/then`),
    ...requirements.flatMap((r) => r.serves.filter((id) => !storyIds.has(id)).map((id) => `requirement ${r.id} serves ${id}, which is not a story in this PRD`)),
    ...stories.filter((s) => s.priority !== "later" && !served.has(s.id)).map((s) => `story ${s.id} (${s.priority}) is served by no requirement`),
  ];
};

const TIERS = ["must", "should", "later"];
const USAGE = "usage: node prd.mjs check <file>...  |  node prd.mjs counts <file>";

const readPrd = (file) => {
  try { return parsePrd(readFileSync(file, "utf8")); } catch (error) { throw new Error(`prd: cannot read ${file}: ${error.message}`); }
};

/** The CLI as a function: returns the exit code (0 fine, 1 problems found, 2 could not run). */
export const run = (argv, { out = console.log, err = console.error } = {}) => {
  const [verb, ...files] = argv;
  const wanted = verb === "check" ? files.length >= 1 : verb === "counts" ? files.length === 1 : false;
  if (!wanted) { err(USAGE); return 2; }
  try {
    const parsed = files.map((file) => [file, readPrd(file)]);
    if (verb === "counts") {
      const [[file, prd]] = parsed;
      const tiers = TIERS.map((t) => `${t} ${prd.stories.filter((s) => s.priority === t).length}`).join(", ");
      out(`${file}: stories ${prd.stories.length} (${tiers}); requirements ${prd.requirements.length}`);
      return 0;
    }
    let problems = 0;
    for (const [file, prd] of parsed) {
      const found = checkPrd(prd);
      problems += found.length;
      out(`${file}: ${prd.stories.length} stories, ${prd.requirements.length} requirements: ${found.length ? `${found.length} problem(s)` : "holds together"}`);
      for (const problem of found) out(`  ${problem}`);
    }
    return problems ? 1 : 0;
  } catch (error) {
    err(error.message);
    return 2;
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = run(process.argv.slice(2));
