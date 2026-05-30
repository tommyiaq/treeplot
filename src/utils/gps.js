const R_EARTH = 6371000 // meters

/**
 * Calculate the great-circle distance between two lat/lon points using the Haversine formula.
 * @param {{ lat: number, lon: number }} pos1
 * @param {{ lat: number, lon: number }} pos2
 * @returns {number} distance in meters
 */
export function haversineDistance(pos1, pos2) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(pos2.lat - pos1.lat)
  const dLon = toRad(pos2.lon - pos1.lon)
  const lat1 = toRad(pos1.lat)
  const lat2 = toRad(pos2.lat)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R_EARTH * c
}

/**
 * Convert lat/lon to local X/Z coordinates in meters relative to a center point.
 * X = east (positive), Z = south (positive; Three.js -Z is north).
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} lat
 * @param {number} lon
 * @returns {{ x: number, z: number }}
 */
export function latLonToXZ(centerLat, centerLon, lat, lon) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const centerLatRad = toRad(centerLat)
  const x = (lon - centerLon) * Math.cos(centerLatRad) * R_EARTH * (Math.PI / 180)
  const z = -(lat - centerLat) * R_EARTH * (Math.PI / 180)
  return { x, z }
}

/**
 * Convert local X/Z meters back to lat/lon.
 * @param {number} centerLat
 * @param {number} centerLon
 * @param {number} x meters east
 * @param {number} z meters south (Three.js convention)
 * @returns {{ lat: number, lon: number }}
 */
export function xzToLatLon(centerLat, centerLon, x, z) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const centerLatRad = toRad(centerLat)
  const lat = centerLat + (-z) / (R_EARTH * (Math.PI / 180))
  const lon = centerLon + x / (Math.cos(centerLatRad) * R_EARTH * (Math.PI / 180))
  return { lat, lon }
}

/**
 * Compute compass bearing (degrees 0–360) from one lat/lon point to another.
 * @param {{ lat: number, lon: number }} from
 * @param {{ lat: number, lon: number }} to
 * @returns {number} bearing in degrees
 */
export function compassBearing(from, to) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const toDeg = (rad) => (rad * 180) / Math.PI

  const dLon = toRad(to.lon - from.lon)
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)

  const y = Math.sin(dLon) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)

  const bearing = toDeg(Math.atan2(y, x))
  return (bearing + 360) % 360
}

/**
 * Convert a bearing in degrees to a cardinal direction string.
 * @param {number} bearing degrees 0–360
 * @returns {string} e.g. 'N', 'NE', 'E', etc.
 */
export function cardinalDirection(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const index = Math.round(((bearing % 360) + 360) % 360 / 45) % 8
  return dirs[index]
}
