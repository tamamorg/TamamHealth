// Offline SVG map projection for South Sudan: one uniform (aspect-preserving)
// equirectangular transform over the real ADM1 bounding box, centred in the
// viewBox. Boundary polygons, facility markers and state labels must all go
// through the same projector, otherwise the data drifts off the geography.

import { SOUTH_SUDAN_BBOX, type GeoState } from '@/data/south-sudan-geo';

export interface Projected {
  x: number;
  y: number;
}

export interface Projector {
  project(lat: number, lng: number): Projected;
  ringPath(ring: Array<[number, number]>, close?: boolean): string;
  centroid(state: GeoState): Projected;
}

/* `pad` is the minimum inset on the constrained axis; the slack on the other
   axis is split evenly, so the map stays centred at any viewBox ratio. */
export function makeProjector(width: number, height: number, pad: number): Projector {
  const { minLng, maxLng, minLat, maxLat } = SOUTH_SUDAN_BBOX;
  const scale = Math.min(
    (width - 2 * pad) / (maxLng - minLng),
    (height - 2 * pad) / (maxLat - minLat),
  );
  const originX = (width - (maxLng - minLng) * scale) / 2;
  const originY = (height - (maxLat - minLat) * scale) / 2;

  function project(lat: number, lng: number): Projected {
    return {
      x: originX + (lng - minLng) * scale,
      y: originY + (maxLat - lat) * scale,
    };
  }

  // Rings are [lng, lat] pairs. Coordinates are fixed to 1dp to keep the
  // emitted `d` attribute small; `close` off draws an open polyline (rivers).
  function ringPath(ring: Array<[number, number]>, close = true): string {
    const d = ring
      .map(([lng, lat], i) => {
        const p = project(lat, lng);
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ');
    return close ? `${d} Z` : d;
  }

  function centroid(state: GeoState): Projected {
    // Label anchor: mean of the largest ring's vertices — good enough at this scale.
    const ring = state.rings.reduce((a, b) => (b.length > a.length ? b : a), state.rings[0]);
    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return project(lat, lng);
  }

  return { project, ringPath, centroid };
}
