---
type: llm
weight: 2
focus: { source: file, path: redesign/PRD.md }
---
This is the first requirements document for rebuilding "Shelf", a small reading-list app. The
repository's README says its users are Mara, the organiser of the Thursday Book Club, who keeps
the shared list, picks the next book and wants to see what the club has read; and the club
members (about twelve people) who check what is being read next, suggest books and mark books as
finished. Its open issues include duplicate "read" marks, inconsistent adding of books, an
abandoned reading-stats feature, hardcoded paths, no view of suggested-but-not-chosen books, and
manual backups.

Score 1 only if ALL of these hold: (a) it states the problem or purpose and names both user
groups (the organiser and the club members) with what each needs; (b) it has user stories, each
with acceptance written as "done when" lines or given/when/then; (c) it has constraints and
explicit non-goals; (d) it contains NO decision about technology, framework, programming
language, database, hosting, architecture, module structure, API shape or screen layout (a
sentence like "stored in JSON" or "a React front end" or "a REST API" or a wireframe description
is a violation; plain statements of need such as "works on a phone" or "data survives a machine
move" are fine). Score 0 if any of (a) to (c) is missing or any technology, architecture or
screen-layout decision appears.
