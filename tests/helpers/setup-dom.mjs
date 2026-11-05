export function setupDOM() {
  const nodes = new Map(), frames = new Map(), documentListeners = new Map();
  let nextFrame = 0, time = 0, reduced = false, mediaListener = null;
  const document = {hidden: false, activeElement: null};
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.attributes = new Map();
      this.listeners = new Map(); this.dataset = {}; this.style = {}; this.textContent = "";
      this.hidden = false; this.disabled = false; this.open = false; this.isConnected = true;
      this.visible = true; this.ownerDocument = document;
    }
    set id(value) { this._id = value; nodes.set(value, this); }
    get id() { return this._id; }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(value => value !== callback)); }
    async dispatch(name, event = {}) {
      const input = {preventDefault() {}, ...event};
      for (const callback of this.listeners.get(name) || []) await callback(input);
    }
    click() { return this.disabled ? Promise.resolve(false) : this.dispatch("click"); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch("close"); }
    remove() { this.isConnected = false; }
    getClientRects() { return this.visible ? [{}] : []; }
  }
  document.body = new Element("body");
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_namespace, tag) => new Element(tag);
  document.getElementById = id => nodes.get(id) ?? null;
  document.addEventListener = (name, callback) => {
    if (!documentListeners.has(name)) documentListeners.set(name, []);
    documentListeners.get(name).push(callback);
  };
  document.removeEventListener = (name, callback) => documentListeners.set(name,
    (documentListeners.get(name) || []).filter(value => value !== callback));
  const motion = {
    get matches() { return reduced; },
    addEventListener(_name, callback) { mediaListener = callback; },
    removeEventListener(_name, callback) { if (mediaListener === callback) mediaListener = null; },
  };
  const window = {
    matchMedia: () => motion,
    requestAnimationFrame(callback) { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  return {document, window, nodes, frames, now: () => time,
    make: tag => new Element(tag),
    advance(ms) {
      time += ms;
      const callbacks = [...frames.values()]; frames.clear();
      for (const callback of callbacks) callback(time);
    },
    reduced(value) { reduced = value; mediaListener?.(); },
    hide(value) { document.hidden = value; for (const callback of documentListeners.get("visibilitychange") || []) callback(); },
  };
}
