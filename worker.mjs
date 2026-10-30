// SPDX-License-Identifier: AGPL-3.0-or-later
//
// render-mupdf/worker.mjs — draws a page of a PDF, or a part of it, to a PNG with MuPDF (the `mupdf` package, AGPL), in
// a process of its own that the One-Touch bridge starts and talks to. It keeps the last pages it read in memory, so the
// next picture of the same page (a zoom close-up) only draws: no reading the PDF again.
//
// This file is the whole program and is published under the AGPL with MuPDF, at
// https://github.com/One-Touch-Automation/ota-pdf-render (public; push it there whenever this file changes). It holds
// nothing but "draw this part of this PDF". The bridge (lib/doc-builder/render-mupdf/index.js) only sends it messages.
//
// Messages: { id, op: 'render', key, file?, pageIndex, dpi, box?, out } → draws page `pageIndex` of the PDF kept under
// `key` (read from `file` first when it is not kept) at `dpi`, the whole page or `box` ([x, y, w, h] in pixels at that
// dpi, from the page's top left), white behind, into the PNG `out`. → { id, ok, w, h } | { id, need: true } (not kept and
// no file) | { id, error }. { id, op: 'drop', key } forgets a page.
import fs from 'fs'
import * as mupdf from 'mupdf'

const KEEP = Math.max(1, Number(process.env.RENDER_KEEP) || 2)   // pages kept read (each can be a few hundred MB)
const kept = new Map()   // key → { doc, page, list, bounds }, oldest first

function forget(key) {
  const k = kept.get(key)
  if (!k) return
  kept.delete(key)
  for (const o of [k.list, k.page, k.doc]) { try { o.destroy() } catch (_) { /* already gone */ } }
}

const same = (a, b) => a && b && a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < 0.01)

function load(key, file, pageIndex) {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf')
  const page = doc.loadPage(pageIndex)
  // the bridge measures a page on its media box: a page cut by a different crop box is drawn by the other renderer
  const po = page.getObject ? page.getObject() : null
  if (po) {
    const box = (name) => { const v = po.getInheritable(name); return v && v.isArray() ? [0, 1, 2, 3].map((i) => v.get(i).asNumber()) : null }
    const mb = box('MediaBox'), cb = box('CropBox')
    if (cb && mb && !same(cb, mb)) { page.destroy(); doc.destroy(); throw new Error('cropbox') }
  }
  const list = page.toDisplayList()
  kept.set(key, { doc, page, list, bounds: page.getBounds() })
  while (kept.size > KEEP) forget(kept.keys().next().value)
  return kept.get(key)
}

function render({ key, file, pageIndex = 0, dpi = 110, box = null, out }) {
  let k = kept.get(key)
  if (!k) { if (!file) return { need: true }; k = load(key, file, pageIndex) }
  else { kept.delete(key); kept.set(key, k) }   // the newest
  const s = dpi / 72
  const [bx0, by0, bx1, by1] = k.bounds
  const W = Math.max(1, Math.ceil((bx1 - bx0) * s)), H = Math.max(1, Math.ceil((by1 - by0) * s))
  const area = box ? [box[0], box[1], box[0] + Math.max(1, box[2]), box[1] + Math.max(1, box[3])] : [0, 0, W, H]
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, area, false)
  pix.clear(255)
  const dev = new mupdf.DrawDevice(mupdf.Matrix.concat(mupdf.Matrix.translate(-bx0, -by0), mupdf.Matrix.scale(s, s)), pix)
  try { k.list.run(dev, mupdf.Matrix.identity); dev.close() } finally { dev.destroy() }
  const png = pix.asPNG()
  const w = pix.getWidth(), h = pix.getHeight()
  pix.destroy()
  fs.writeFileSync(out, png)
  return { ok: true, w, h }
}

process.on('message', (m) => {
  if (!m || m.id == null) return
  let reply
  try {
    if (m.op === 'render') reply = render(m)
    else if (m.op === 'drop') { forget(m.key); reply = { ok: true } }
    else reply = { error: `no such job: ${m.op}` }
  } catch (e) { reply = { error: (e && e.message) || String(e) } }
  process.send({ id: m.id, ...reply })
})
// the bridge gone (a restart, a deploy): nobody waits for a picture, so stop
process.on('disconnect', () => process.exit(0))
