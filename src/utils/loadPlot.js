// Lightweight inline DBF parser + forestry plot loader.
// No external dependencies — reads binary dBASE III format directly.

const PLOT_CENTER = { lat: 43.46878, lon: 11.15117 }

// ── Species normaliser ──────────────────────────────────────────────────────
const CONIFER_RE  = /pino|pinus|picea|abete|larix|larice|douglasia|pseudotsuga|cedro|cedrus|abies/i
const CYPRESS_RE  = /cipresso|chamaecyparis/i

function mapSpecies(raw) {
  if (!raw) return 'quercia'
  if (CYPRESS_RE.test(raw)) return 'cipresso'
  if (CONIFER_RE.test(raw)) return 'pino'
  return 'quercia'
}

// ── Polar offset (azimuth + distance → lat/lon) ─────────────────────────────
function polarToLatLon(centerLat, centerLon, distM, azimuthDeg) {
  const R   = 6371000
  const lat1 = centerLat * (Math.PI / 180)
  const az   = azimuthDeg  * (Math.PI / 180)
  const d    = distM / R
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(az)
  )
  const lon2 =
    (centerLon * (Math.PI / 180)) +
    Math.atan2(
      Math.sin(az) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    )
  return { lat: lat2 * (180 / Math.PI), lon: lon2 * (180 / Math.PI) }
}

// ── DBF binary parser ───────────────────────────────────────────────────────
function parseDbf(bytes) {
  const view = new DataView(bytes.buffer ?? bytes)

  const numRecords = view.getUint32(4, true)
  const headerSize = view.getUint16(8, true)
  const recordSize = view.getUint16(10, true)

  // Parse field descriptors (32 bytes each, starting at offset 32, ending at 0x0D)
  const fields = []
  let off = 32
  const headerBytes = new Uint8Array(bytes.buffer ?? bytes)
  while (headerBytes[off] !== 0x0D && off < headerSize) {
    const name   = String.fromCharCode(...headerBytes.slice(off, off + 11)).replace(/\0/g, '').trim()
    const type   = String.fromCharCode(headerBytes[off + 11])
    const length = headerBytes[off + 16]
    fields.push({ name, type, length })
    off += 32
  }

  const decoder = new TextDecoder('utf-8')
  const records = []

  for (let i = 0; i < numRecords; i++) {
    const recStart = headerSize + i * recordSize
    if (headerBytes[recStart] === 0x2A) continue // deleted record

    const row = {}
    let colOff = 1 // skip deletion flag byte
    for (const f of fields) {
      const raw = decoder.decode(headerBytes.slice(recStart + colOff, recStart + colOff + f.length)).trim()
      row[f.name] = raw
      colOff += f.length
    }
    records.push(row)
  }

  return records
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Load trees for a specific ADS plot from vive.dbf.
 * @param {string|number} adsId - ADS identifier to filter (default '1')
 * @returns {Promise<Array>} array of tree objects in the app's format
 */
export async function loadPlot(adsId = '1') {
  const res = await fetch('/real_plot/vive.dbf')
  if (!res.ok) throw new Error(`Failed to load vive.dbf: ${res.status}`)

  const buffer = await res.arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  const rows   = parseDbf(bytes)

  const targetAds = String(adsId)

  return rows
    .filter(r => r.ADS === targetAds)
    .map(r => {
      const dist    = parseFloat(r['DIST.TOP'])
      const azimuth = parseFloat(r.AZIMUTH)
      const height  = parseFloat(r.H_T)
      const diam    = parseFloat(r.DBH)

      const pos = (isFinite(dist) && isFinite(azimuth))
        ? polarToLatLon(PLOT_CENTER.lat, PLOT_CENTER.lon, dist, azimuth)
        : { ...PLOT_CENTER }

      const rc = (v) => { const n = parseFloat(v); return isFinite(n) && n > 0 ? n : null }
      const hIns = parseFloat(r.H_INS)

      return {
        id:                  `T${String(r.ID).padStart(3, '0')}`,
        species:             mapSpecies(r.SPECIE),
        specie_raw:          r.SPECIE,
        lat:                 pos.lat,
        lon:                 pos.lon,
        height_m:            isFinite(height) && height > 0 ? height : null,
        diameter_cm:         isFinite(diam)   && diam   > 0 ? diam   : null,
        h_ins:               isFinite(hIns)   && hIns   > 0 ? hIns   : null,
        rc_n:                rc(r.RC_N),
        rc_e:                rc(r.RC_E),
        rc_s:                rc(r.RC_S),
        rc_o:                rc(r.RC_O),
        measured_at:         null,
        measured_height_m:   null,
        measured_diameter_cm:null,
        health:              null,
      }
    })
}

/**
 * Return available ADS plot IDs from vive.dbf.
 */
export async function listPlots() {
  const res = await fetch('/real_plot/vive.dbf')
  if (!res.ok) throw new Error(`Failed to load vive.dbf: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const rows  = parseDbf(bytes)
  const counts = {}
  for (const r of rows) counts[r.ADS] = (counts[r.ADS] || 0) + 1
  return Object.entries(counts)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => Number(a.id) - Number(b.id))
}
