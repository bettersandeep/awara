// The ground to draw under an unwalkable tile, because a tree does not fill its
// cell: the most common walkable tile around it, else the most common one on the
// map. Null when the map has no walkable tile.
export function groundAt(catalog, map, x, y) {
  const counts = new Map(); // tile key -> cells
  const count = (key) => catalog.tiles[key]?.walkable && counts.set(key, (counts.get(key) ?? 0) + 1);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) count(map.tiles[y + dy]?.[x + dx]);
  if (counts.size === 0) for (const row of map.tiles) row.forEach(count);
  let ground = null;
  for (const [key, cells] of counts) if (!ground || cells > counts.get(ground)) ground = key;
  return ground;
}
