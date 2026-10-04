/**
 * Solar position (NOAA simplified algorithm, ±0.5° — ample for design studies).
 * Times are local solar-standard time for the given UTC offset.
 */
export interface SunPosition {
  /** Degrees above the horizon. */
  altitude: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
}

const rad = Math.PI / 180;

export function sunPosition(lat: number, lon: number, month: number, day: number, hour: number, utcOffset = Math.round(lon / 15)): SunPosition {
  const date = new Date(Date.UTC(2026, month - 1, day));
  const start = Date.UTC(2026, 0, 0);
  const doy = Math.floor((date.getTime() - start) / 86400000);
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const timeOffset = eqTime + 4 * lon - 60 * utcOffset;
  const tst = hour * 60 + timeOffset;
  const ha = (tst / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZen = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const altitude = 90 - zen / rad;
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(phi) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(phi) * Math.sin(zen) || 1e-9)))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { altitude, azimuth: az };
}

/** Unit vector pointing *towards* the sun in plan space (x east, y north on the drawing, z up), accounting for plan north rotation. */
export function sunVector(pos: SunPosition, northAngle: number): { x: number; y: number; z: number } {
  const az = (pos.azimuth + northAngle) * rad;
  const alt = pos.altitude * rad;
  return { x: Math.sin(az) * Math.cos(alt), y: Math.cos(az) * Math.cos(alt), z: Math.sin(alt) };
}

export function sunriseSunset(lat: number, lon: number, month: number, day: number): { sunrise: number; sunset: number } {
  let sunrise = 6, sunset = 18;
  for (let h = 3; h <= 12; h += 0.05) if (sunPosition(lat, lon, month, day, h).altitude > -0.83) { sunrise = h; break; }
  for (let h = 21; h >= 12; h -= 0.05) if (sunPosition(lat, lon, month, day, h).altitude > -0.83) { sunset = h; break; }
  return { sunrise, sunset };
}

export const CITIES = [
  { city: 'Mumbai', country: 'India', lat: 19.076, lon: 72.8777 },
  { city: 'Goa', country: 'India', lat: 15.2993, lon: 74.124 },
  { city: 'Pune', country: 'India', lat: 18.5204, lon: 73.8567 },
  { city: 'Bengaluru', country: 'India', lat: 12.9716, lon: 77.5946 },
  { city: 'Delhi', country: 'India', lat: 28.6139, lon: 77.209 },
  { city: 'Chennai', country: 'India', lat: 13.0827, lon: 80.2707 },
  { city: 'Hyderabad', country: 'India', lat: 17.385, lon: 78.4867 },
  { city: 'Ahmedabad', country: 'India', lat: 23.0225, lon: 72.5714 },
  { city: 'Alibaug', country: 'India', lat: 18.6414, lon: 72.8722 },
  { city: 'Dubai', country: 'UAE', lat: 25.2048, lon: 55.2708 },
  { city: 'Singapore', country: 'Singapore', lat: 1.3521, lon: 103.8198 },
  { city: 'London', country: 'UK', lat: 51.5072, lon: -0.1276 },
  { city: 'New York', country: 'USA', lat: 40.7128, lon: -74.006 },
  { city: 'Los Angeles', country: 'USA', lat: 34.0522, lon: -118.2437 },
];
