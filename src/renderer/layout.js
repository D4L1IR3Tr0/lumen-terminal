// Tiling layout: a binary tree of splits whose leaves are pane ids.
//   leaf  = { type: 'leaf', pane: 'p1' }
//   split = { type: 'split', dir: 'h' | 'v', ratio: 0.5, a: node, b: node }
// 'h' puts a and b side by side, 'v' stacks them.
(function () {
  const leaf = pane => ({ type: 'leaf', pane });

  function findPath(node, pane, path = []) {
    if (!node) return null;
    if (node.type === 'leaf') return node.pane === pane ? path : null;
    return findPath(node.a, pane, [...path, { node, side: 'a' }]) || findPath(node.b, pane, [...path, { node, side: 'b' }]);
  }

  function leaves(node, out = []) {
    if (!node) return out;
    if (node.type === 'leaf') out.push(node.pane);
    else { leaves(node.a, out); leaves(node.b, out); }
    return out;
  }

  // Replaces the leaf `target` with a split holding the old pane and `pane`.
  function split(root, target, pane, dir, before = false) {
    if (!root) return leaf(pane);
    const fresh = leaf(pane);
    const replace = node => {
      if (node.type === 'leaf') {
        if (node.pane !== target) return node;
        return { type: 'split', dir, ratio: 0.5, a: before ? fresh : node, b: before ? node : fresh };
      }
      return { ...node, a: replace(node.a), b: replace(node.b) };
    };
    return replace(root);
  }

  function remove(root, pane) {
    if (!root) return null;
    if (root.type === 'leaf') return root.pane === pane ? null : root;
    const a = remove(root.a, pane);
    const b = remove(root.b, pane);
    if (!a) return b;
    if (!b) return a;
    return { ...root, a, b };
  }

  function swap(root, p1, p2) {
    const walk = node => {
      if (node.type === 'leaf') {
        if (node.pane === p1) return leaf(p2);
        if (node.pane === p2) return leaf(p1);
        return node;
      }
      return { ...node, a: walk(node.a), b: walk(node.b) };
    };
    return walk(root);
  }

  // Computes pane rectangles and the draggable gutters between them.
  function compute(root, width, height, gap) {
    const rects = new Map();
    const gutters = [];
    const walk = (node, x, y, w, h) => {
      if (node.type === 'leaf') {
        rects.set(node.pane, { x, y, w, h });
        return;
      }
      if (node.dir === 'h') {
        const aw = Math.round((w - gap) * node.ratio);
        walk(node.a, x, y, aw, h);
        walk(node.b, x + aw + gap, y, w - aw - gap, h);
        gutters.push({ node, dir: 'h', x: x + aw, y, w: gap, h, origin: x, span: w - gap });
      } else {
        const ah = Math.round((h - gap) * node.ratio);
        walk(node.a, x, y, w, ah);
        walk(node.b, x, y + ah + gap, w, h - ah - gap);
        gutters.push({ node, dir: 'v', x, y: y + ah, w, h: gap, origin: y, span: h - gap });
      }
    };
    if (root) walk(root, gap, gap, width - gap * 2, height - gap * 2);
    return { rects, gutters };
  }

  // Finds the closest pane in a direction from `from`, preferring panes that overlap on the other axis.
  function neighbor(rects, from, dir) {
    const r = rects.get(from);
    if (!r) return null;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let best = null;
    let bestScore = Infinity;
    for (const [id, o] of rects) {
      if (id === from) continue;
      let dist, overlap;
      if (dir === 'left') { dist = r.x - (o.x + o.w); overlap = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y); }
      else if (dir === 'right') { dist = o.x - (r.x + r.w); overlap = Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y); }
      else if (dir === 'up') { dist = r.y - (o.y + o.h); overlap = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x); }
      else { dist = o.y - (r.y + r.h); overlap = Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x); }
      if (dist < -1) continue;
      const ox = o.x + o.w / 2;
      const oy = o.y + o.h / 2;
      const off = dir === 'left' || dir === 'right' ? Math.abs(oy - cy) : Math.abs(ox - cx);
      const score = dist * 10 + off + (overlap > 0 ? 0 : 100000);
      if (score < bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  // Nudges the closest ancestor split on the matching axis.
  function resize(root, pane, dir, step = 0.04) {
    const path = findPath(root, pane);
    if (!path) return;
    const axis = dir === 'left' || dir === 'right' ? 'h' : 'v';
    for (let i = path.length - 1; i >= 0; i--) {
      const { node } = path[i];
      if (node.dir !== axis) continue;
      const delta = dir === 'right' || dir === 'down' ? step : -step;
      node.ratio = Math.min(0.9, Math.max(0.1, node.ratio + delta));
      return;
    }
  }

  window.Layout = { leaf, split, remove, swap, leaves, compute, neighbor, resize, findPath };
})();
