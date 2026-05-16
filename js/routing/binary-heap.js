/* Min-binary-heap. The A* router pulls the cheapest-f-score node from this
   each iteration. Items are stored as { item, score }; pop() returns the item
   with the lowest score. */

export class BinaryHeap {
  constructor() {
    this._items = [];
    this._scores = [];
  }

  get size() {
    return this._items.length;
  }

  push(item, score) {
    this._items.push(item);
    this._scores.push(score);
    this._bubbleUp(this._items.length - 1);
  }

  pop() {
    if (this._items.length === 0) return undefined;
    const top = this._items[0];
    const last = this._items.pop();
    const lastScore = this._scores.pop();
    if (this._items.length > 0) {
      this._items[0] = last;
      this._scores[0] = lastScore;
      this._sinkDown(0);
    }
    return top;
  }

  peek() {
    return this._items[0];
  }

  _bubbleUp(i) {
    const items = this._items;
    const scores = this._scores;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (scores[i] >= scores[parent]) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      [scores[i], scores[parent]] = [scores[parent], scores[i]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const items = this._items;
    const scores = this._scores;
    const n = items.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < n && scores[left] < scores[smallest]) smallest = left;
      if (right < n && scores[right] < scores[smallest]) smallest = right;
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest], items[i]];
      [scores[i], scores[smallest]] = [scores[smallest], scores[i]];
      i = smallest;
    }
  }
}
