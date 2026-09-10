"use strict";
// Minimal DOM adapter for controller behavior; all report calculations run unmodified.
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ""; this.hidden = false; this.disabled = false; this.className = ""; this._text = "";
    this.classList = { toggle: (name, on) => { const values = new Set(this.className.split(" ").filter(Boolean)); if (on) values.add(name); else values.delete(name); this.className = [...values].join(" "); } }; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this._text = ""; this.children = items; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  fire(name) { if (!this.disabled) for (const handler of this.listeners[name] || []) handler({ preventDefault() {} }); }
}
function documentFor(ids) {
  const elements = new Map(ids.map((id) => [id, new Element()]));
  return { createElement: (tag) => new Element(tag), getElementById: (id) => {
    if (!elements.has(id)) throw new Error(`Unexpected element ${id}`); return elements.get(id);
  } };
}
module.exports = { Element, documentFor };
