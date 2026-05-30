import { xzToLatLon } from './gps.js'

// Box-Muller: standard normal sample
function randNormal() {
  let u, v
  do { u = Math.random() } while (u === 0)
  do { v = Math.random() } while (v === 0)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

const SPECIES = ['pino', 'quercia', 'cipresso']

// Even-aged (coetanea) forest parameters:
// DBH ~ N(40, 8) in [10, 60] cm
// H = 1.1 * DBH - 4 + N(0, 2)  →  correlated with DBH, in [5, 60] m
const DBH_MEAN = 40
const DBH_SD   = 8
const DBH_MIN  = 10
const DBH_MAX  = 60

const H_SLOPE  = 1.1
const H_INTER  = -4   // so at DBH=40: H = 44-4 = 40
const H_NOISE  = 2    // residual SD around the linear trend
const H_MIN    = 5
const H_MAX    = 60

function formatId(n) {
  return 'T' + String(n).padStart(3, '0')
}

/**
 * Generate exactly 50 mock trees for a coetanea mixed forest.
 * DBH and height are correlated (linear allometric relationship).
 * Trees are spread within 0.5–12.5m of the plot center.
 * @param {number} centerLat
 * @param {number} centerLon
 * @returns {Array}
 */
export function generateMockTrees(centerLat, centerLon) {
  const trees = []
  const positions = []

  let idx = 0

  while (trees.length < 50) {
    let placed = false

    for (let attempt = 0; attempt < 15; attempt++) {
      // Random polar position within plot
      const r = 0.5 + Math.random() * 12.0
      const angle = Math.random() * 2 * Math.PI
      const x = r * Math.cos(angle)
      const z = r * Math.sin(angle)

      const tooClose = positions.some((p) => {
        const dx = p.x - x, dz = p.z - z
        return dx * dx + dz * dz < 1.0
      })
      if (tooClose) continue

      // Correlated DBH / height (coetanea allometric model)
      const diameter_cm = clamp(
        Math.round((DBH_MEAN + randNormal() * DBH_SD) * 10) / 10,
        DBH_MIN, DBH_MAX
      )
      const height_m = clamp(
        Math.round((H_SLOPE * diameter_cm + H_INTER + randNormal() * H_NOISE) * 10) / 10,
        H_MIN, H_MAX
      )

      const { lat, lon } = xzToLatLon(centerLat, centerLon, x, z)
      const species = SPECIES[idx % 3]

      trees.push({
        id: formatId(idx + 1),
        species,
        lat: parseFloat(lat.toFixed(8)),
        lon: parseFloat(lon.toFixed(8)),
        height_m,
        diameter_cm,
        measured_height_m: null,
        measured_diameter_cm: null,
        measured_health: null,
        measured_at: null,
      })

      positions.push({ x, z })
      idx++
      placed = true
      break
    }

    if (!placed) {
      // Fallback without collision check (rare)
      const r = 0.5 + Math.random() * 12.0
      const angle = Math.random() * 2 * Math.PI
      const x = r * Math.cos(angle)
      const z = r * Math.sin(angle)
      const diameter_cm = clamp(
        Math.round((DBH_MEAN + randNormal() * DBH_SD) * 10) / 10,
        DBH_MIN, DBH_MAX
      )
      const height_m = clamp(
        Math.round((H_SLOPE * diameter_cm + H_INTER + randNormal() * H_NOISE) * 10) / 10,
        H_MIN, H_MAX
      )
      const { lat, lon } = xzToLatLon(centerLat, centerLon, x, z)
      const species = SPECIES[idx % 3]

      trees.push({
        id: formatId(idx + 1),
        species,
        lat: parseFloat(lat.toFixed(8)),
        lon: parseFloat(lon.toFixed(8)),
        height_m,
        diameter_cm,
        measured_height_m: null,
        measured_diameter_cm: null,
        measured_health: null,
        measured_at: null,
      })

      positions.push({ x, z })
      idx++
    }
  }

  return trees
}
