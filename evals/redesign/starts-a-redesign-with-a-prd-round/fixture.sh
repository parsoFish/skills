#!/usr/bin/env bash
# Fixture repo for the redesign eval: a small legacy "shelf" app (reading list for a book club) that
# served as a proof of concept. It has a few obvious warts: two ways to add a book, a dead
# feature, and a config file with hardcoded paths. The README names who uses it and for what.
# Hermetic: no network, no installs.
set -e
mkdir -p bin src data
cat > README.md << 'MD'
# Shelf

Shelf is the reading list for the Thursday Book Club. It started as a weekend proof of concept
and has been in daily use by the club for about a year.

## Who uses it

- **Mara, the club organiser**, keeps the shared list: she adds the books members suggest, picks
  the book for the next meeting, and wants to see at a glance what the club has already read.
- **Club members (about twelve people)** open the list on their phones to see what we are reading
  next, suggest a book, and mark the ones they have finished so Mara knows who is keeping up.

## What it does

- Add a book (title, author, who suggested it) from the command line or the web form.
- List the books still to read, and the ones already read.
- Mark a book as read, per member.
- Pick the next book (Mara only; it moves a book to the top of the list).
- Run on Mara's home server: `node bin/shelf.js serve` starts the web form on port 8080.

## Notes

The web form is a single HTML page rendered by the server. Data lives in a JSON file. There is no
login: anyone on the home network can use it, which is fine for twelve friends.
MD
cat > TODO.md << 'MD'
# Open issues

1. Two members were marked as having read the same book twice after a double click.
2. Adding a book from the web form and from the CLI give slightly different results (the CLI
   lowercases the author, the form does not).
3. The "reading stats" feature never worked properly and nobody uses it. Remove or fix?
4. Hardcoded paths in `config.json` break when Mara moves the server to a new machine.
5. Members ask for a way to see which books are suggested but not yet chosen.
6. Backups are manual: Mara copies `books.json` by hand every few weeks.
MD
cat > config.json << 'JSON'
{
  "dataFile": "/home/mara/shelf/data/books.json",
  "backupDir": "/mnt/usb/shelf-backups",
  "port": 8080,
  "logFile": "/var/log/shelf.log"
}
JSON
cat > package.json << 'JSON'
{ "name": "shelf", "version": "0.3.1", "type": "module", "private": true }
JSON
cat > data/books.json << 'JSON'
[
  { "id": 1, "title": "The Remains of the Day", "author": "kazuo ishiguro", "suggestedBy": "Priya", "readBy": ["Mara", "Priya"] },
  { "id": 2, "title": "Piranesi", "author": "Susanna Clarke", "suggestedBy": "Tom", "readBy": [] }
]
JSON
cat > src/config.js << 'JS'
import { readFileSync } from 'node:fs';
export const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
JS
cat > src/store.js << 'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from './config.js';

export function load() {
  return JSON.parse(readFileSync(config.dataFile, 'utf8'));
}
export function save(books) {
  writeFileSync(config.dataFile, JSON.stringify(books, null, 2));
}
JS
cat > src/books.js << 'JS'
import { load, save } from './store.js';

// Way one of adding a book: used by the CLI (lowercases the author, see TODO 2).
export function addBook(title, author, suggestedBy) {
  const books = load();
  books.push({ id: books.length + 1, title, author: author.toLowerCase(), suggestedBy, readBy: [] });
  save(books);
}

// Way two of adding a book: used by the web form (keeps the author as typed).
export function addBookFromForm(form) {
  const books = load();
  const id = Math.max(0, ...books.map((b) => b.id)) + 1;
  books.push({ id, title: form.title, author: form.author, suggestedBy: form.who, readBy: [] });
  save(books);
}

export function markRead(id, member) {
  const books = load();
  const book = books.find((b) => b.id === id);
  book.readBy.push(member); // no duplicate check, see TODO 1
  save(books);
}

export function pickNext(id) {
  const books = load();
  const i = books.findIndex((b) => b.id === id);
  const [book] = books.splice(i, 1);
  books.unshift(book);
  save(books);
}

export const toRead = () => load().filter((b) => b.readBy.length === 0);
export const alreadyRead = () => load().filter((b) => b.readBy.length > 0);
JS
cat > src/stats.js << 'JS'
// Reading stats. Never finished; nothing calls this any more (see TODO 3).
import { load } from './store.js';

export function pagesPerMonth() {
  return load().map((b) => ({ title: b.title, pages: b.pages ?? 0 }));
}
JS
cat > src/server.js << 'JS'
import { createServer } from 'node:http';
import { config } from './config.js';
import { toRead, alreadyRead, addBookFromForm, markRead } from './books.js';

const page = () => `<html><body><h1>Shelf</h1>
<h2>To read</h2><ul>${toRead().map((b) => `<li>${b.title} - ${b.author}</li>`).join('')}</ul>
<h2>Read</h2><ul>${alreadyRead().map((b) => `<li>${b.title} (${b.readBy.join(', ')})</li>`).join('')}</ul>
<form method="post" action="/add"><input name="title"><input name="author"><input name="who"><button>Add</button></form>
</body></html>`;

export function serve() {
  createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/add') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        addBookFromForm(Object.fromEntries(new URLSearchParams(body)));
        res.writeHead(303, { location: '/' }).end();
      });
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/read/')) {
      const [, , id, member] = req.url.split('/');
      markRead(Number(id), member);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(page());
  }).listen(config.port);
}
JS
cat > bin/shelf.js << 'JS'
#!/usr/bin/env node
import { addBook, toRead, alreadyRead, markRead, pickNext } from '../src/books.js';
import { serve } from '../src/server.js';

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'add') addBook(args[0], args[1], args[2]);
else if (cmd === 'list') console.log(toRead().map((b) => b.title).join('\n'));
else if (cmd === 'read') markRead(Number(args[0]), args[1]);
else if (cmd === 'next') pickNext(Number(args[0]));
else if (cmd === 'done') console.log(alreadyRead().map((b) => b.title).join('\n'));
else if (cmd === 'serve') serve();
else console.log('usage: shelf add|list|read|next|done|serve');
JS
git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm "init: shelf proof of concept"
