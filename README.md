# ota-pdf-render

A small program that draws a page of a PDF, or part of one, to a PNG using [MuPDF](https://mupdf.com/)
(the [`mupdf`](https://www.npmjs.com/package/mupdf) npm package). It keeps the pages it has read in memory, so a second
picture of the same page only has to draw.

One-Touch Automation's internal software starts it as a background process and sends it messages; this repository is
the complete source of that program, published under the GNU Affero General Public License v3.0 or later (see
`LICENSE`), as MuPDF's licence asks.

## Messages (Node.js IPC)

- `{ id, op: 'render', key, file?, pageIndex, dpi, box?, out }`: draws page `pageIndex` of the PDF kept under `key`
  (read from `file` first when it is not kept) at `dpi`, the whole page or `box` (`[x, y, w, h]` in pixels at that dpi),
  on white, into the PNG file `out`. Replies `{ id, ok, w, h }`, `{ id, need: true }` (not kept and no file), or
  `{ id, error }`.
- `{ id, op: 'drop', key }`: forgets a page.

`RENDER_KEEP` (default 2) sets how many pages it keeps.

## Running it

```js
const { fork } = require('child_process')
const worker = fork('worker.mjs', [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' })
worker.on('message', (m) => console.log(m))
worker.send({ id: 1, op: 'render', key: 'plan', file: 'plan.pdf', pageIndex: 0, dpi: 72, out: 'plan.png' })
```

Requires Node.js 20 or later and `npm install mupdf`.
