// OP
/**
 * Map validation & normalization for race start.
 * Simple and robust.
 */

export function buildStartPositionsFromGrid(start, count = 4) {
  if (!start || count < 1) return [];
  const positions = [];
  const angle = start.angle || 0;
  const perpAngle = angle + Math.PI / 2;
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / 2);
    const col = index % 2;
    const lateralOffset = (col - 0.5) * 60;
    const longitudinalOffset = row * -60;
    positions.push({
      x: start.x + Math.cos(perpAngle) * lateralOffset + Math.cos(angle) * longitudinalOffset,
      y: start.y + Math.sin(perpAngle) * lateralOffset + Math.sin(angle) * longitudinalOffset,
      angle: angle
    });
  }
  return positions;
}

/**
 * Startplätze für beliebig viele Spieler — explizite Liste oder Grid aus startPos / erstem Slot.
 */
export function getStartPositionsForPlayerCount(mapData, count) {
  if (!mapData || count < 1) return [];
  const explicit = mapData.startPositions;
  if (Array.isArray(explicit) && explicit.length >= count) {
    return explicit.slice(0, count);
  }
  const anchor = mapData.startPos || (Array.isArray(explicit) && explicit.length > 0 ? explicit[0] : null);
  if (anchor) {
    return buildStartPositionsFromGrid(anchor, count);
  }
  if (Array.isArray(explicit) && explicit.length > 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({ ...explicit[i % explicit.length] });
    }
    return out;
  }
  return [];
}

export function validateMap(map) {
  console.log(`[MAP VALIDATION] Checking map: ${map ? (map.mapId || map.id) : 'null'}`);
  if (!map) return false;
  
  const id = map.mapId || map.id;
  const hasStart = !!(
    map.startPos ||
    (map.startPositions && map.startPositions.length >= 1)
  );
  const hasCheckpoints = map.checkpoints && map.checkpoints.length >= 2;
  const hasWaypoints = (map.botWaypoints && map.botWaypoints.length >= 3) || (map.controlPoints && map.controlPoints.length >= 3) || id === 'sand-circuit';

  const isValid = !!(id && hasStart && hasCheckpoints && hasWaypoints);
  
  if (!isValid) {
    console.warn(`[MAP VALIDATION] Result: FAIL for ${id}. Missing fields:`, {
        id: !!id,
        hasStart,
        hasCheckpoints,
        hasWaypoints
    });
  } else {
    console.log(`[MAP VALIDATION] Result: OK for ${id}`);
  }

  return isValid;
}

// Keep generateSplinePath for BotManager
export function generateSplinePath(controlPoints, segments = 20) {
  if (!controlPoints || controlPoints.length === 0) return [];
  const path = [];
  const n = controlPoints.length;
  for (let i = 0; i < n; i++) {
    const p0 = controlPoints[(i - 1 + n) % n];
    const p1 = controlPoints[i];
    const p2 = controlPoints[(i + 1) % n];
    const p3 = controlPoints[(i + 2) % n];

    for (let t = 0; t < 1; t += 1 / segments) {
      const t2 = t * t;
      const t3 = t2 * t;
      const f1 = -0.5 * t3 + t2 - 0.5 * t;
      const f2 = 1.5 * t3 - 2.5 * t2 + 1.0;
      const f3 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
      const f4 = 0.5 * t3 - 0.5 * t2;
      path.push({
        x: p0.x * f1 + p1.x * f2 + p2.x * f3 + p3.x * f4,
        y: p0.y * f1 + p1.y * f2 + p2.y * f3 + p3.y * f4
      });
    }
  }
  return path;
}
