// The tiles a walking sprite steps through, from `from` to `to` (both included).
// Breadth-first over walkable tiles, so a walk goes around walls. When no path
// exists (for example the narrator moved a sprite past a wall), it steps in a
// straight line instead, so the sprite still arrives.
const MAX_PATH_SEARCH = 4000; // cells; a 60x40 map has 2400

export function findPath(map, isWalkable, from, to) {
  if (from.x === to.x && from.y === to.y) return [from];
  const key = (x, y) => y * map.w + x;
  const cameFrom = new Map([[key(from.x, from.y), null]]);
  const queue = [from];
  for (let head = 0; head < queue.length && head < MAX_PATH_SEARCH; head++) {
    const cell = queue[head];
    if (cell.x === to.x && cell.y === to.y) return walkBack(cameFrom, key, cell, map.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      if (x < 0 || y < 0 || x >= map.w || y >= map.h || cameFrom.has(key(x, y))) continue;
      const isGoal = x === to.x && y === to.y;
      if (!isGoal && !isWalkable(x, y)) continue;
      cameFrom.set(key(x, y), key(cell.x, cell.y));
      queue.push({ x, y });
    }
  }
  return straightLine(from, to);
}

function walkBack(cameFrom, key, end, width) {
  const path = [];
  for (let k = key(end.x, end.y); k !== null; k = cameFrom.get(k)) path.push({ x: k % width, y: Math.floor(k / width) });
  return path.reverse();
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
