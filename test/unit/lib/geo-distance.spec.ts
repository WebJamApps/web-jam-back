// test/unit/lib/geo-distance.spec.ts — web-jam-back#1060
import {
  haversineDistanceKm,
  haversineDistanceMiles,
  resolveCoordinates,
  computeDistanceKm,
  isFamilyNearby,
  SALEM_HOME_ANCHOR,
  FAMILY_ANCHOR_CITIES,
  FAMILY_RADIUS_MILES,
} from '#src/lib/geo-distance.js';

describe('geo-distance (#1060)', () => {
  describe('constants & anchors', () => {
    it('defines the Salem home anchor at 106 Eagle Drive', () => {
      expect(SALEM_HOME_ANCHOR.address).toContain('106 Eagle Drive');
      expect(SALEM_HOME_ANCHOR.lat).toBeCloseTo(37.2622, 4);
      expect(SALEM_HOME_ANCHOR.lon).toBeCloseTo(-80.0612, 4);
    });

    it('defines all 7 family anchor cities with a 20-mile radius', () => {
      expect(FAMILY_RADIUS_MILES).toBe(20);
      const expectedCities = ['Salem', 'Roanoke', 'Martinsville', 'Lynchburg', 'Gastonia', 'Rock Hill', 'Harrisonburg'];
      expect(Object.keys(FAMILY_ANCHOR_CITIES)).toEqual(expectedCities);
      for (const city of expectedCities) {
        expect(FAMILY_ANCHOR_CITIES[city].lat).toBeTypeOf('number');
        expect(FAMILY_ANCHOR_CITIES[city].lon).toBeTypeOf('number');
      }
    });
  });

  describe('haversineDistanceKm and haversineDistanceMiles', () => {
    it('returns 0 for identical coordinates', () => {
      expect(haversineDistanceKm(37.2622, -80.0612, 37.2622, -80.0612)).toBe(0);
      expect(haversineDistanceMiles(37.2622, -80.0612, 37.2622, -80.0612)).toBe(0);
    });

    it('computes known distance between Salem and Roanoke (~10.4 km / ~6.5 miles)', () => {
      const salem = FAMILY_ANCHOR_CITIES.Salem;
      const roanoke = FAMILY_ANCHOR_CITIES.Roanoke;
      const km = haversineDistanceKm(salem.lat, salem.lon, roanoke.lat, roanoke.lon);
      const miles = haversineDistanceMiles(salem.lat, salem.lon, roanoke.lat, roanoke.lon);
      expect(km).toBeGreaterThan(9);
      expect(km).toBeLessThan(12);
      expect(miles).toBeGreaterThan(5.5);
      expect(miles).toBeLessThan(7.5);
    });
  });

  describe('resolveCoordinates', () => {
    it('resolves coordinates via 5-digit zip code', () => {
      const coords = resolveCoordinates({ zipCode: '24153' });
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBe(37.2963);
      expect(coords?.lon).toBe(-80.0746);
    });

    it('resolves coordinates via 9-digit zip code (ZIP+4)', () => {
      const coords = resolveCoordinates({ zipCode: '24153-1234' });
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBe(37.2963);
      expect(coords?.lon).toBe(-80.0746);
    });

    it('falls back to city + usState when zipCode is absent', () => {
      const coords = resolveCoordinates({ city: 'Roanoke', usState: 'VA' });
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBe(37.2645);
      expect(coords?.lon).toBe(-79.9237);
    });

    it('falls back to city alone when usState is absent', () => {
      const coords = resolveCoordinates({ city: 'Salem' });
      expect(coords).not.toBeNull();
      expect(coords?.lat).toBe(37.2963);
      expect(coords?.lon).toBe(-80.0746);
    });

    it('returns null for unknown zip code or unknown city', () => {
      expect(resolveCoordinates({ zipCode: '99999' })).toBeNull();
      expect(resolveCoordinates({ city: 'Atlantis', usState: 'Ocean' })).toBeNull();
      expect(resolveCoordinates({ city: 'Atlantis' })).toBeNull();
    });

    it('returns null for empty or nullish venue input', () => {
      expect(resolveCoordinates(null)).toBeNull();
      expect(resolveCoordinates(undefined)).toBeNull();
      expect(resolveCoordinates({})).toBeNull();
    });
  });

  describe('computeDistanceKm', () => {
    it('computes distance from 106 Eagle Drive for a venue in Salem (~4.0 km)', () => {
      const dist = computeDistanceKm({ zipCode: '24153', city: 'Salem', usState: 'VA' });
      expect(dist).toBe(4);
    });

    it('computes distance to Harrisonburg (~166.6 km)', () => {
      const dist = computeDistanceKm({ zipCode: '22801', city: 'Harrisonburg', usState: 'VA' });
      expect(dist).toBe(166.6);
    });

    it('computes distance to southwest Charlotte (~244.7 km)', () => {
      const dist = computeDistanceKm({ zipCode: '28217', city: 'Charlotte', usState: 'NC' });
      expect(dist).toBe(244.7);
    });

    it('returns null when coordinates cannot be resolved', () => {
      expect(computeDistanceKm(null)).toBeNull();
      expect(computeDistanceKm({})).toBeNull();
      expect(computeDistanceKm({ zipCode: '00000' })).toBeNull();
    });
  });

  describe('isFamilyNearby', () => {
    it('returns true for venues in the 7 named family anchor cities', () => {
      expect(isFamilyNearby({ zipCode: '24153', city: 'Salem', usState: 'VA' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '24011', city: 'Roanoke', usState: 'VA' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '24112', city: 'Martinsville', usState: 'VA' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '24504', city: 'Lynchburg', usState: 'VA' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '28052', city: 'Gastonia', usState: 'NC' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '29730', city: 'Rock Hill', usState: 'SC' })).toBe(true);
      expect(isFamilyNearby({ zipCode: '22801', city: 'Harrisonburg', usState: 'VA' })).toBe(true);
    });

    it('returns true for venues within 20 miles of family anchor cities', () => {
      // Port Republic (24471) is ~10.8 miles from Harrisonburg
      expect(isFamilyNearby({ zipCode: '24471', city: 'Port Republic', usState: 'VA' })).toBe(true);
      // Blue Ridge (24064) is ~11.8 miles from Roanoke
      expect(isFamilyNearby({ zipCode: '24064', city: 'Blue Ridge', usState: 'VA' })).toBe(true);
      // Southwest Charlotte (28217) is ~17.6 miles from Gastonia & ~18.3 miles from Rock Hill
      expect(isFamilyNearby({ zipCode: '28217', city: 'Charlotte', usState: 'NC' })).toBe(true);
    });

    it('returns false for venues outside the 20-mile radius of all 7 anchors', () => {
      // Hungry Mother State Park in Marion, VA (24354): ~88 miles from Salem
      expect(isFamilyNearby({ zipCode: '24354', city: 'Marion', usState: 'VA' })).toBe(false);
      // Blacksburg, VA (24060): ~20.9 miles from Salem (> 20 miles)
      expect(isFamilyNearby({ zipCode: '24060', city: 'Blacksburg', usState: 'VA' })).toBe(false);
      // Radford, VA (24141): ~29.8 miles from Salem
      expect(isFamilyNearby({ zipCode: '24141', city: 'Radford', usState: 'VA' })).toBe(false);
      // Christiansburg, VA (24073): ~22.8 miles from Salem
      expect(isFamilyNearby({ zipCode: '24073', city: 'Christiansburg', usState: 'VA' })).toBe(false);
      // Winston-Salem, NC (27101): ~45.5 miles from Martinsville
      expect(isFamilyNearby({ zipCode: '27101', city: 'Winston-Salem', usState: 'NC' })).toBe(false);
      // Stokesdale, NC (27357): ~30.6 miles from Martinsville
      expect(isFamilyNearby({ zipCode: '27357', city: 'Stokesdale', usState: 'NC' })).toBe(false);
      // Charlottesville (22902): ~36.8 miles from Harrisonburg
      expect(isFamilyNearby({ zipCode: '22902', city: 'Charlottesville', usState: 'VA' })).toBe(false);
    });

    it('returns false when venue coordinates cannot be resolved', () => {
      expect(isFamilyNearby(null)).toBe(false);
      expect(isFamilyNearby(undefined)).toBe(false);
      expect(isFamilyNearby({})).toBe(false);
      expect(isFamilyNearby({ zipCode: '00000' })).toBe(false);
    });
  });
});
