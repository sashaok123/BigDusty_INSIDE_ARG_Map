/* Tiny line-level diff for two text blobs. Two-pointer LCS, no library.
   Returns an array of {kind: 'same'|'add'|'del', leftText, rightText}. */

export function diffLines(a, b) {
  const A = String(a || '').split('\n');
  const B = String(b || '').split('\n');
  const n = A.length;
  const m = B.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (A[i] === B[j]) lcs[i][j] = lcs[i + 1][j + 1] + 1;
      else lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'same', leftText: A[i], rightText: B[j], leftLine: i + 1, rightLine: j + 1 });
      i += 1; j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'del', leftText: A[i], rightText: '', leftLine: i + 1, rightLine: null });
      i += 1;
    } else {
      out.push({ kind: 'add', leftText: '', rightText: B[j], leftLine: null, rightLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: 'del', leftText: A[i], rightText: '', leftLine: i + 1, rightLine: null });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: 'add', leftText: '', rightText: B[j], leftLine: null, rightLine: j + 1 });
    j += 1;
  }
  return collapseAddDelPairs(out);
}

function collapseAddDelPairs(rows) {
  const out = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (r.kind === 'del' && k + 1 < rows.length && rows[k + 1].kind === 'add') {
      const nx = rows[k + 1];
      out.push({
        kind: 'changed',
        leftText: r.leftText,
        rightText: nx.rightText,
        leftLine: r.leftLine,
        rightLine: nx.rightLine,
      });
      k += 1;
      continue;
    }
    out.push(r);
  }
  return out;
}

export function diffSummary(rows) {
  let same = 0; let add = 0; let del = 0; let changed = 0;
  for (const r of rows) {
    if (r.kind === 'same') same += 1;
    else if (r.kind === 'add') add += 1;
    else if (r.kind === 'del') del += 1;
    else if (r.kind === 'changed') changed += 1;
  }
  return { same, add, del, changed };
}
