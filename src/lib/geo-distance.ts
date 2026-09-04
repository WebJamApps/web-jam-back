// src/lib/geo-distance.ts — web-jam-back#1060
//
// Geographic distance and family proximity derivation for venues
// (per book-gig-skill-design-2026-08-16.md, decisions D-31 and D-36, and section 11).
//
// 1. Distance in kilometres from 106 Eagle Drive, Salem, VA to the venue,
//    computed via the Haversine formula from stored address/city/usState/zipCode.
// 2. Proximity boolean (familyNearby): true when the venue sits within 20 miles
//    (32.18688 km) of any of the 7 family anchor cities (Salem, Roanoke, Martinsville,
//    Lynchburg, Gastonia, Rock Hill, or Harrisonburg), false otherwise.

export interface LocatableVenue {
  address?: string;
  city?: string;
  usState?: string;
  zipCode?: string;
  [key: string]: unknown;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

export const SALEM_HOME_ANCHOR: Coordinates & { address: string } = {
  address: '106 Eagle Drive, Salem, VA 24153',
  lat: 37.2622,
  lon: -80.0612,
};

export const FAMILY_ANCHOR_CITIES: Record<string, Coordinates> = {
  Salem: { lat: 37.2932, lon: -80.0557 },
  Roanoke: { lat: 37.271, lon: -79.9414 },
  Martinsville: { lat: 36.6915, lon: -79.8725 },
  Lynchburg: { lat: 37.4138, lon: -79.1422 },
  Gastonia: { lat: 35.2623, lon: -81.1838 },
  'Rock Hill': { lat: 34.9249, lon: -81.0251 },
  Harrisonburg: { lat: 38.4493, lon: -78.8689 },
};

export const FAMILY_RADIUS_MILES = 20;
export const EARTH_RADIUS_KM = 6371;
export const KM_PER_MILE = 1.609344;

export const ZIP_COORDINATES: Record<string, [number, number]> = {
  '22801': [38.4285, -78.871],
  '22802': [38.4541, -78.8491],
  '22901': [38.0677, -78.4884],
  '22902': [38.0146, -78.4783],
  '22903': [38.0258, -78.504],
  '22932': [38.0913, -78.6937],
  '22980': [38.0875, -78.9194],
  '24011': [37.2711, -79.9417],
  '24012': [37.3057, -79.9251],
  '24013': [37.2645, -79.9237],
  '24014': [37.238, -79.933],
  '24015': [37.2573, -79.9799],
  '24016': [37.2698, -79.9515],
  '24017': [37.2963, -79.9861],
  '24018': [37.2276, -80.0239],
  '24019': [37.3408, -79.9486],
  '24055': [36.7551, -79.9938],
  '24060': [37.2285, -80.4265],
  '24061': [37.2269, -80.4223],
  '24064': [37.3677, -79.7641],
  '24070': [37.3433, -80.2057],
  '24073': [37.1584, -80.4347],
  '24078': [36.7274, -79.9134],
  '24083': [37.4137, -79.9147],
  '24085': [37.6729, -79.826],
  '24091': [36.9166, -80.3221],
  '24104': [37.1074, -79.5213],
  '24112': [36.6899, -79.8633],
  '24121': [37.1676, -79.6396],
  '24136': [37.3206, -80.6092],
  '24141': [37.13, -80.5572],
  '24151': [36.9828, -79.8826],
  '24153': [37.2963, -80.0746],
  '24165': [36.598, -80.0433],
  '24168': [36.7388, -79.9484],
  '24171': [36.6478, -80.2394],
  '24179': [37.2776, -79.8002],
  '24184': [37.0766, -79.7599],
  '24301': [37.0532, -80.7631],
  '24354': [36.8314, -81.5375],
  '24401': [38.1352, -79.0756],
  '24441': [38.2215, -78.8343],
  '24471': [38.3033, -78.7971],
  '24501': [37.38, -79.1701],
  '24502': [37.3558, -79.2213],
  '24503': [37.4371, -79.2163],
  '24504': [37.392, -79.1084],
  '24505': [37.4093, -79.1172],
  '24521': [37.5959, -79.0643],
  '24522': [37.361, -78.8299],
  '24523': [37.3268, -79.5207],
  '24541': [36.5803, -79.4661],
  '24551': [37.3568, -79.2967],
  '24572': [37.46, -79.1154],
  '24578': [37.6579, -79.5399],
  '24588': [37.2744, -79.1239],
  '27027': [36.4323, -79.9764],
  '27101': [36.1005, -80.2316],
  '27215': [36.0682, -79.4683],
  '27260': [35.9559, -79.9986],
  '27357': [36.2566, -79.9743],
  '27401': [36.0711, -79.7793],
  '28012': [35.2294, -81.0458],
  '28052': [35.236, -81.2116],
  '28054': [35.2452, -81.1692],
  '28056': [35.222, -81.1486],
  '28202': [35.2136, -80.8416],
  '28217': [35.1673, -80.895],
  '28711': [35.6184, -82.3226],
  '29708': [35.047, -80.9897],
  '29715': [35.0121, -80.9146],
  '29730': [34.9145, -81.0002],
  '29732': [34.9695, -81.0466],
};

export const CITY_COORDINATES: Record<string, [number, number]> = {
  'bassett': [36.7551, -79.9938],
  'bassett, va': [36.7551, -79.9938],
  'belmont': [35.2294, -81.0458],
  'belmont, nc': [35.2294, -81.0458],
  'black mountain': [35.6184, -82.3226],
  'black mountain, nc': [35.6184, -82.3226],
  'blacksburg': [37.2285, -80.4265],
  'blacksburg, va': [37.2285, -80.4265],
  'blue ridge': [37.3677, -79.7641],
  'blue ridge, va': [37.3677, -79.7641],
  'catawba': [37.3433, -80.2057],
  'catawba, va': [37.3433, -80.2057],
  'cave spring': [37.2698, -79.9515],
  'cave spring, va': [37.2698, -79.9515],
  'charlotte': [35.1673, -80.895],
  'charlotte, nc': [35.1673, -80.895],
  'charlottesville': [38.0146, -78.4783],
  'charlottesville, va': [38.0146, -78.4783],
  'christiansburg': [37.1584, -80.4347],
  'christiansburg, va': [37.1584, -80.4347],
  'collinsville': [36.7274, -79.9134],
  'collinsville, va': [36.7274, -79.9134],
  'daleville': [37.4137, -79.9147],
  'daleville, va': [37.4137, -79.9147],
  'danville': [36.5803, -79.4661],
  'danville, va': [36.5803, -79.4661],
  'eagle rock': [37.6729, -79.826],
  'eagle rock, va': [37.6729, -79.826],
  'floyd': [36.9166, -80.3221],
  'floyd, va': [36.9166, -80.3221],
  'forest': [37.3568, -79.2967],
  'forest, va': [37.3568, -79.2967],
  'fort mill': [35.0121, -80.9146],
  'fort mill, sc': [35.0121, -80.9146],
  'gastonia': [35.236, -81.2116],
  'gastonia, nc': [35.236, -81.2116],
  'grottoes': [38.2215, -78.8343],
  'grottoes, va': [38.2215, -78.8343],
  'harrisonburg': [38.4285, -78.871],
  'harrisonburg, va': [38.4285, -78.871],
  'lynchburg': [37.4093, -79.1172],
  'lynchburg, va': [37.4093, -79.1172],
  'marion': [36.8314, -81.5375],
  'marion, va': [36.8314, -81.5375],
  'martinsville': [36.6899, -79.8633],
  'martinsville, va': [36.6899, -79.8633],
  'mayodan': [36.4323, -79.9764],
  'mayodan, nc': [36.4323, -79.9764],
  'moneta': [37.1676, -79.6396],
  'moneta, va': [37.1676, -79.6396],
  'natural bridge': [37.6579, -79.5399],
  'natural bridge, va': [37.6579, -79.5399],
  'pembroke': [37.3206, -80.6092],
  'pembroke, va': [37.3206, -80.6092],
  'port republic': [38.3033, -78.7971],
  'port republic, va': [38.3033, -78.7971],
  'pulaski': [37.0532, -80.7631],
  'pulaski, va': [37.0532, -80.7631],
  'radford': [37.13, -80.5572],
  'radford, va': [37.13, -80.5572],
  'roanoke': [37.2645, -79.9237],
  'roanoke, va': [37.2645, -79.9237],
  'rock hill': [34.9145, -81.0002],
  'rock hill, sc': [34.9145, -81.0002],
  'rocky mount': [36.9828, -79.8826],
  'rocky mount, va': [36.9828, -79.8826],
  'salem': [37.2963, -80.0746],
  'salem, va': [37.2963, -80.0746],
  'spencer': [36.598, -80.0433],
  'spencer, va': [36.598, -80.0433],
  'stokesdale': [36.2566, -79.9743],
  'stokesdale, nc': [36.2566, -79.9743],
  'tega cay': [35.047, -80.9897],
  'tega cay, sc': [35.047, -80.9897],
  'vinton': [37.2776, -79.8002],
  'vinton, va': [37.2776, -79.8002],
  'winston-salem': [36.1005, -80.2316],
  'winston-salem, nc': [36.1005, -80.2316],
  'wirtz': [37.0766, -79.7599],
  'wirtz, va': [37.0766, -79.7599],
};

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function haversineDistanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineDistanceKm(lat1, lon1, lat2, lon2) / KM_PER_MILE;
}

export function resolveCoordinates(venue?: LocatableVenue | null): Coordinates | null {
  if (!venue) return null;
  const zip = typeof venue.zipCode === 'string' ? venue.zipCode.trim() : '';
  if (zip) {
    const zip5 = zip.slice(0, 5);
    if (Object.prototype.hasOwnProperty.call(ZIP_COORDINATES, zip5)) {
      const [lat, lon] = ZIP_COORDINATES[zip5];
      return { lat, lon };
    }
  }

  const city = typeof venue.city === 'string' ? venue.city.trim().toLowerCase() : '';
  const state = typeof venue.usState === 'string' ? venue.usState.trim().toLowerCase() : '';

  if (city && state) {
    const cityStateKey = `${city}, ${state}`;
    if (Object.prototype.hasOwnProperty.call(CITY_COORDINATES, cityStateKey)) {
      const [lat, lon] = CITY_COORDINATES[cityStateKey];
      return { lat, lon };
    }
  }

  if (city && Object.prototype.hasOwnProperty.call(CITY_COORDINATES, city)) {
    const [lat, lon] = CITY_COORDINATES[city];
    return { lat, lon };
  }

  return null;
}

export function computeDistanceKm(venue?: LocatableVenue | null): number | null {
  const coords = resolveCoordinates(venue);
  if (!coords) return null;
  const km = haversineDistanceKm(SALEM_HOME_ANCHOR.lat, SALEM_HOME_ANCHOR.lon, coords.lat, coords.lon);
  return Math.round(km * 10) / 10;
}

export function isFamilyNearby(venue?: LocatableVenue | null): boolean {
  const coords = resolveCoordinates(venue);
  if (!coords) return false;
  return Object.values(FAMILY_ANCHOR_CITIES).some(
    (anchor) => haversineDistanceMiles(coords.lat, coords.lon, anchor.lat, anchor.lon) <= FAMILY_RADIUS_MILES,
  );
}
