// OP
import { getStartPositionsForPlayerCount, validateMap } from '../utils/mapValidation.js';

/**
 * Horizontale „8“: x ~ sin(t), y ~ sin(2t), symmetrisch um (1600, 900).
 */
function buildForestFigure8ControlPoints(n = 28) {
  const ax = 900;
  const ay = 455;
  const cx = 1600;
  const cy = 900;
  const pts = [];
  const tStart = -Math.PI / 4;
  for (let i = 0; i < n; i++) {
    const t = tStart + (i / n) * Math.PI * 2;
    pts.push({ x: cx + ax * Math.sin(t), y: cy + ay * Math.sin(2 * t) });
  }
  return pts;
}

const FOREST_FIGURE8_CP = buildForestFigure8ControlPoints(28);
const FOREST_START_ANGLE = Math.atan2(
  FOREST_FIGURE8_CP[1].y - FOREST_FIGURE8_CP[0].y,
  FOREST_FIGURE8_CP[1].x - FOREST_FIGURE8_CP[0].x
);

/** Dichte Wegpunkte auf derselben Achter-Kurve — KI folgt der Fahrtrichtung. */
function buildForestBotWaypoints(count = 84) {
  const ax = 900;
  const ay = 455;
  const cx = 1600;
  const cy = 900;
  const pts = [];
  const tStart = -Math.PI / 4;
  for (let i = 0; i < count; i++) {
    const t = tStart + (i / count) * Math.PI * 2;
    pts.push({ x: cx + ax * Math.sin(t), y: cy + ay * Math.sin(2 * t) });
  }
  return pts;
}

const FOREST_BOT_WAYPOINTS = buildForestBotWaypoints(84);

/**
 * ZENTRALER MAP STORE (DESIGN OVERHAUL)
 */
export const defaultMap = {
  id: 'sand-circuit',
  mapId: 'sand-circuit',
  name: 'Sand Circuit',
  difficulty: 'Leicht',
  width: 3200,
  height: 1800,
  startPos: { x: 1200, y: 400, angle: Math.PI },
  startPositions: [
    { x: 1300, y: 350, angle: Math.PI },
    { x: 1300, y: 450, angle: Math.PI },
    { x: 1400, y: 350, angle: Math.PI },
    { x: 1400, y: 450, angle: Math.PI }
  ],
  sectorCheckpoints: [],
  finishLine: { x: 1200, y: 400, width: 88, height: 340 },
  checkpoints: [
    { x: 800, y: 900, width: 300, height: 1800 },
    { x: 1600, y: 1400, width: 3200, height: 300 },
    { x: 2400, y: 900, width: 300, height: 1800 },
    { x: 1600, y: 400, width: 3200, height: 300 }
  ],
  trackColor: '#333333',
  bgColor: '#d4c090'
};

export class MapSelection {
  constructor(gameManager) {
    this.gameManager = gameManager;

    this.maps = [
      defaultMap,
      {
        id: 'forest-loop',
        mapId: 'forest-loop',
        name: 'Forest Loop (Beta)',
        difficulty: 'Mittel',
        width: 3200,
        height: 1800,
        controlPoints: FOREST_FIGURE8_CP,
        botWaypoints: FOREST_BOT_WAYPOINTS,
        sectorCheckpoints: [],
        finishLine: {
          x: FOREST_FIGURE8_CP[0].x,
          y: FOREST_FIGURE8_CP[0].y,
          width: 95,
          height: 380,
          angle: FOREST_START_ANGLE
        },
        checkpoints: [
          { x: 700, y: 900, width: 400, height: 1700 },
          {
            x: FOREST_FIGURE8_CP[0].x,
            y: FOREST_FIGURE8_CP[0].y,
            width: 95,
            height: 380,
            angle: FOREST_START_ANGLE
          }
        ],
        startPos: {
          x: FOREST_FIGURE8_CP[0].x,
          y: FOREST_FIGURE8_CP[0].y,
          angle: FOREST_START_ANGLE
        },
        startPositions: getStartPositionsForPlayerCount(
          {
            startPos: {
              x: FOREST_FIGURE8_CP[0].x - Math.cos(FOREST_START_ANGLE) * 130,
              y: FOREST_FIGURE8_CP[0].y - Math.sin(FOREST_START_ANGLE) * 130,
              angle: FOREST_START_ANGLE
            }
          },
          4
        ),
        trackColor: '#333333',
        bgColor: '#3f6212'
      }
    ];

    this.maps = this.maps.map((m) => {
      if (!validateMap(m)) return { ...defaultMap, ...m };
      return m;
    });
  }

  getMapById(id) {
    return this.maps.find((m) => m.id === id || m.mapId === id) || defaultMap;
  }
}
