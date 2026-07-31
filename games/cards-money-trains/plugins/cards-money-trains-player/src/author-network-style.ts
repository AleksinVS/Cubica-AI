/**
 * Visual language of the author's transport network: rails, sleepers and
 * station marks.
 *
 * Why this module exists. The delivery map is the clean author board
 * (`draft/trains/Игровая Карта.png`): it carries countries, the printed grey
 * station icons and the two half-stop marks, but no railway. The whole
 * transport network — the ten roads the author drew for the first turn and
 * every road built, closed or split later — is painted by the player from
 * runtime-owned data. The picture therefore never becomes the source of
 * gameplay truth, and a closed road disappears instead of being covered up.
 *
 * Because the network is now drawn rather than baked, its appearance has to
 * reproduce the author's own drawing. Every number below is *measured* from
 * the author's reference image `draft/trains/Начальная транспортная сеть.png`
 * in canonical design pixels (the 5079×3627 plane shared by the manifest, the
 * review annotations and this renderer), not chosen by eye:
 *
 * - road 6 ↔ 9¾ is exactly horizontal on the reference, so a vertical cut
 *   across it measures the two rails directly: their centres are 18.6 px
 *   apart and each rail is 5.1 px wide at half depth of colour;
 * - scanning along the same road, the sleepers form a regular rhythm with a
 *   17.5 px step; each sleeper is 4 px thick and 27.6 px long, so it
 *   protrudes slightly past both rails, exactly as on the printed board;
 * - the ink of the rails is the average colour of the darkest fifth of the
 *   rail pixels, #553418;
 * - the connected station mark is a ten-tooth gear: teeth tips at radius
 *   58.8, tooth roots at 48.8, a light inner disc of radius 33.3; its green is
 *   the median colour of the ring, #427246, and the disc is #d8cab6;
 * - the two half-stops (9¾ and π) are plain discs of radius 30 in the same
 *   green.
 *
 * The measurement is reproducible: `tools/measure-author-network-style.mjs`
 * re-derives every value from the reference image and compares it with the
 * table below, and `tools/render-initial-network-check.mjs` redraws the whole
 * initial network with these very shapes and compares the result with the
 * author's image pixel by pixel.
 *
 * The module is deliberately pure geometry: it returns plain point lists and
 * never touches Phaser. The scene draws the shapes on the GPU, the check tool
 * writes the same shapes into SVG, so the picture that is verified offline is
 * the picture the player shows.
 */

/** A point in the canonical 5079×3627 design plane. */
export type NetworkPoint = {
  readonly x: number;
  readonly y: number;
};

/** A straight piece of a drawn shape, from one point to another. */
export type NetworkSegment = {
  readonly from: NetworkPoint;
  readonly to: NetworkPoint;
};

/**
 * Measured dimensions of one railway track. All values are canonical design
 * pixels; see the module header for how each of them was obtained.
 */
export type RailwayTrackStyle = {
  /** Distance from the track centre line to the centre of one rail. */
  readonly railOffset: number;
  /** Stroke width of a single rail. */
  readonly railWidth: number;
  /** Stroke width of a single sleeper (the cross tie under both rails). */
  readonly sleeperWidth: number;
  /** Half the length of a sleeper; it protrudes past both rails. */
  readonly sleeperHalfLength: number;
  /** Distance between the centres of two neighbouring sleepers. */
  readonly sleeperSpacing: number;
};

/**
 * Measured dimensions of the station and half-stop marks printed on the
 * author board.
 */
export type StationMarkStyle = {
  /** Number of gear teeth on a terminal mark. */
  readonly teeth: number;
  /** Radius of the tooth roots. */
  readonly rootRadius: number;
  /** Radius of the tooth tips. */
  readonly tipRadius: number;
  /** Radius of the light disc that carries the printed number. */
  readonly discRadius: number;
  /** Radius of a half-stop mark, drawn as a plain disc. */
  readonly waypointRadius: number;
};

export const AUTHOR_TRACK_STYLE: RailwayTrackStyle = {
  railOffset: 9.3,
  railWidth: 5.1,
  sleeperWidth: 4,
  sleeperHalfLength: 13.8,
  sleeperSpacing: 17.5
};

export const AUTHOR_STATION_STYLE: StationMarkStyle = {
  teeth: 10,
  rootRadius: 48.8,
  tipRadius: 58.8,
  discRadius: 33.3,
  waypointRadius: 30
};

/** Ink of the rails and sleepers on the author board. */
export const AUTHOR_TRACK_INK = 0x553418;
/** Green of a station that is part of the open network. */
export const AUTHOR_STATION_GREEN = 0x427246;
/** Light disc under the printed station number. */
export const AUTHOR_STATION_DISC = 0xd8cab6;
/** Ink of the printed station number. */
export const AUTHOR_STATION_LABEL_INK = 0x685642;
/**
 * Height of a printed digit, measured on station 6. A Georgia-like serif face
 * renders a digit at roughly 0.72 of its font size, which puts the font size
 * at 46 px.
 */
export const AUTHOR_STATION_LABEL_SIZE = 46;

/**
 * The short mark printed inside a station on the author board.
 *
 * Two points carry a printed sign rather than a number, and the manifest
 * spells their identifiers out in full. The board shows the signs themselves,
 * so the renderer and the offline check share this one mapping.
 */
export const printedNodeLabel = (nodeId: string, label: string): string => {
  if (nodeId === "terminal-3-14") return "π";
  if (nodeId === "waypoint-9-3-4") return "9¾";
  return label;
};

/** Rails and sleepers of one track, ready to be stroked. */
export type RailwayTrackShapes = {
  /** Two rail polylines, one on each side of the centre line. */
  readonly rails: readonly (readonly NetworkPoint[])[];
  /** Cross ties, in the order they appear along the track. */
  readonly sleepers: readonly NetworkSegment[];
};

/**
 * Build the rails and sleepers of a track that follows `centreLine`.
 *
 * The sleeper rhythm is accumulated over the whole polyline instead of being
 * restarted at every vertex: a road planned through several map regions has
 * technical vertices that carry no visual meaning, and restarting the rhythm
 * there would produce a visible stutter that the author's drawing does not
 * have.
 *
 * Repeated points (a legal but empty piece of route data) are skipped rather
 * than treated as a zero-length segment, which would divide by zero.
 */
export const railwayTrackShapes = (
  centreLine: readonly NetworkPoint[],
  style: RailwayTrackStyle = AUTHOR_TRACK_STYLE
): RailwayTrackShapes => {
  const rails: NetworkPoint[][] = [[], []];
  const sleepers: NetworkSegment[] = [];
  let traversedLength = 0;
  // The first sleeper sits half a step in, so a short road still shows the
  // rhythm symmetrically instead of starting with a tie at the station edge.
  let nextSleeperDistance = style.sleeperSpacing / 2;

  for (let index = 1; index < centreLine.length; index += 1) {
    const from = centreLine[index - 1];
    const to = centreLine[index];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    // Unit normal (perpendicular) of this segment: it offsets the rails and
    // orients every sleeper across the track.
    const normalX = -dy / length;
    const normalY = dx / length;

    // Both ends of every segment are kept, so a bend joins the two offset
    // pieces with a short link instead of leaving a notch in the rail. On a
    // straight author road the link has zero length and changes nothing.
    rails.forEach((rail, railIndex) => {
      const offset = railIndex === 0 ? -style.railOffset : style.railOffset;
      rail.push({
        x: from.x + normalX * offset,
        y: from.y + normalY * offset
      });
      rail.push({
        x: to.x + normalX * offset,
        y: to.y + normalY * offset
      });
    });

    while (nextSleeperDistance < traversedLength + length) {
      const distance = nextSleeperDistance - traversedLength;
      const centreX = from.x + (dx * distance) / length;
      const centreY = from.y + (dy * distance) / length;
      sleepers.push({
        from: {
          x: centreX - normalX * style.sleeperHalfLength,
          y: centreY - normalY * style.sleeperHalfLength
        },
        to: {
          x: centreX + normalX * style.sleeperHalfLength,
          y: centreY + normalY * style.sleeperHalfLength
        }
      });
      nextSleeperDistance += style.sleeperSpacing;
    }
    traversedLength += length;
  }

  return { rails, sleepers };
};

/**
 * Outline of a terminal gear mark centred at `centre`.
 *
 * Each tooth is symmetric around its own centre: it leaves the root radius,
 * holds the tip radius across the middle, and returns to the root before the
 * gap that separates it from the next tooth. The proportions repeat the
 * printed icon — at half the tooth height the metal takes a little more than
 * half of the circle, which is what the reference measures.
 *
 * The teeth are not placed at an arbitrary angle. On the author board a tooth
 * points straight up, which the measurement confirms on every station mark
 * (the angular rhythm of the green ring has its peak exactly there). Getting
 * this wrong is visible: the drawn mark sits on top of the grey icon printed
 * on the map, and a shifted tooth lets the grey one show through the gaps.
 */
export const stationGearOutline = (
  centre: NetworkPoint,
  style: StationMarkStyle = AUTHOR_STATION_STYLE
): readonly NetworkPoint[] => {
  const outline: NetworkPoint[] = [];
  const step = (Math.PI * 2) / style.teeth;
  for (let tooth = 0; tooth < style.teeth; tooth += 1) {
    const toothCentre = tooth * step - Math.PI / 2;
    const vertices = [
      { angle: toothCentre - step * 0.39, radius: style.rootRadius },
      { angle: toothCentre - step * 0.2, radius: style.tipRadius },
      { angle: toothCentre + step * 0.2, radius: style.tipRadius },
      { angle: toothCentre + step * 0.39, radius: style.rootRadius }
    ];
    for (const vertex of vertices) {
      outline.push({
        x: centre.x + Math.cos(vertex.angle) * vertex.radius,
        y: centre.y + Math.sin(vertex.angle) * vertex.radius
      });
    }
  }
  return outline;
};
