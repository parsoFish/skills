---
type: llm
weight: 2
focus: { source: file, path: redesign/reviews/01-prd-1/index.html }
---
This is the HTML of the first review page for rebuilding "Shelf", a small reading-list app for a
book club. The repository's README describes its features: adding a book (two inconsistent ways),
the shared list and the "next up" pick, marking a book as read (with a duplicate-marks bug), an
abandoned reading-stats feature, hardcoded paths in config.json, no view of suggested-but-not-chosen
books, and manual backups. Its users are Mara, the club organiser, and about twelve club members.

Score 1 only if ALL of these hold: (a) the page is about Shelf as it exists and what its people
need: it names at least three of the actual features above (adding a book, the list or next pick,
marking read, the stats feature, backups, suggestions) as things to keep, rework, merge, drop or
decide on, or as user stories or requirements about them; (b) it asks the person questions with
options and a recommended option, or gives rows a default verdict, so the person can answer by
touching only exceptions; (c) it contains NO decision about the new system's technology,
framework, programming language, database, hosting, architecture, module structure, API shape or
screen layout (a sentence like "rebuild as a React app", "store it in SQLite", "a REST API" or a
wireframe of the new screens is a violation; plain statements of need such as "works on a phone"
or "data survives a machine move" are fine). Score 0 if the page is an unedited template (a
placeholder question, a placeholder drawing), if it does not refer to Shelf's actual features, or
if any technology, architecture or screen-layout decision for the new system appears.
