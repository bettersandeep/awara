// The tiles a walking sprite steps through, from `from` to `to` (both included).
// Breadth-first over walkable tiles, so a walk goes around walls. When no path
// exists (for example the narrator moved a sprite past a wall), it steps in a
// straight line instead, so the sprite still arrives.
export function findPath(map, isWalkable, from, to) {
  const key = (cell) => cell.y * map.w + cell.x;
  const cameFrom = new Map([[key(from), null]]); // tile key -> the cell it was reached from
  // Each tile is queued at most once, so the search ends after map.w * map.h cells.
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell.x === to.x && cell.y === to.y) {
      const path = [];
      for (let c = cell; c; c = cameFrom.get(key(c))) path.unshift(c);
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const inside = next.x >= 0 && next.y >= 0 && next.x < map.w && next.y < map.h;
      const isGoal = next.x === to.x && next.y === to.y;
      if (!inside || cameFrom.has(key(next)) || (!isGoal && !isWalkable(next.x, next.y))) continue;
      cameFrom.set(key(next), cell);
      queue.push(next);
    }
  }
  return straightLine(from, to);
}

function straightLine(from, to) {
  const path = [{ ...from }];
  const cell = { ...from };
  while (cell.x !== to.x || cell.y !== to.y) {
    if (cell.x !== to.x) cell.x += Math.sign(to.x - cell.x);
    else cell.y += Math.sign(to.y - cell.y);
    path.push({ ...cell });
  }
  return path;
}
