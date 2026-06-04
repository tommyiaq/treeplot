<template>
  <div id="app-root">
    <TopBar />
    <TreeMap @load-csv="triggerCsvInput" />
    <ChatPanel />

    <!-- Measurement modal — only opened explicitly via chat "Mostra form" button -->
    <MeasureModal v-if="store.measureModalOpen && store.selectedTree" />

    <!-- Hidden file input for CSV loading -->
    <input
      ref="csvInputRef"
      type="file"
      accept=".csv"
      style="display: none"
      @change="onCsvFileSelected"
    />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { usePlotStore } from './store/plot.js'

import { loadPlot, listPlots } from './utils/loadPlot.js'
import TopBar from './components/TopBar.vue'
import TreeMap from './components/TreeMap.vue'
import ChatPanel from './components/ChatPanel.vue'
import MeasureModal from './components/MeasureModal.vue'

const store = usePlotStore()
const csvInputRef = ref(null)

// ──────────────────────────────────────────────
// Startup: restore from localStorage or wait for GPS
// ──────────────────────────────────────────────
const PLOT_CENTER = { lat: 43.46849, lon: 11.15101 }

onMounted(async () => {
  // Load plot list (needed for dropdown regardless of saved state)
  listPlots().then(plots => { store.availablePlots = plots }).catch(() => {})

  const restored = store.loadFromLocalStorage()
  if (restored && store.trees.length > 0) return // saved data found

  store.gpsWaiting = true
  try {
    const trees = await loadPlot('1')
    store.loadTrees(trees, { ...PLOT_CENTER, name: 'ADS_1' }, 'ADS_1')
  } catch (err) {
    console.error('[App] Failed to load plot:', err)
    store.addChatMessage('assistant', '⚠ Impossibile caricare il rilievo. Ricarica la pagina.')
  } finally {
    store.gpsWaiting = false
  }
})

// ──────────────────────────────────────────────
// CSV handling
// ──────────────────────────────────────────────
function triggerCsvInput() {
  if (csvInputRef.value) {
    csvInputRef.value.value = '' // reset so same file can be re-selected
    csvInputRef.value.click()
  }
}

function onCsvFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    const text = e.target.result
    parseCsv(text, file.name)
  }
  reader.onerror = () => {
    console.error('[CSV] Failed to read file')
    store.addChatMessage('system', 'Errore nella lettura del file CSV.')
  }
  reader.readAsText(file, 'UTF-8')
}

/**
 * Parse a CSV file and load trees into the store.
 * Filename pattern for center coords: (-?\d+\.?\d+)_(-?\d+\.?\d+).csv
 * @param {string} text
 * @param {string} filename
 */
function parseCsv(text, filename) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) {
    store.addChatMessage('system', 'CSV non valido: file vuoto o intestazione mancante.')
    return
  }

  // Extract center from filename
  let center = null
  let plotName = 'Plot'
  const centerMatch = filename.match(/(-?\d+\.?\d+)_(-?\d+\.?\d+)\.csv$/i)
  if (centerMatch) {
    center = {
      lat: parseFloat(centerMatch[1]),
      lon: parseFloat(centerMatch[2]),
      name: filename.replace(/\.csv$/i, ''),
    }
    plotName = filename.replace(/\.csv$/i, '')
  }

  // Parse header
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())

  const getIdx = (names) => {
    for (const n of names) {
      const idx = header.indexOf(n)
      if (idx !== -1) return idx
    }
    return -1
  }

  const idxId = getIdx(['id'])
  const idxSpecies = getIdx(['species', 'specie'])
  const idxLat = getIdx(['lat', 'latitude'])
  const idxLon = getIdx(['lon', 'longitude', 'lng'])
  const idxHeight = getIdx(['height_m', 'height', 'altezza_m'])
  const idxDiam = getIdx(['diameter_cm', 'diameter', 'dbh_cm', 'dbh'])
  const idxMHeight = getIdx(['measured_height_m'])
  const idxMDiam = getIdx(['measured_diameter_cm'])
  const idxMHealth = getIdx(['measured_health'])
  const idxMAt = getIdx(['measured_at'])

  const trees = []
  let parseErrors = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cols = line.split(',')

    const safeGet = (idx) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : '')
    const safeNum = (idx) => {
      const v = safeGet(idx)
      return v === '' ? null : parseFloat(v)
    }
    const safeStr = (idx) => {
      const v = safeGet(idx)
      return v === '' ? null : v
    }

    const lat = safeNum(idxLat)
    const lon = safeNum(idxLon)

    if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) {
      parseErrors++
      continue
    }

    const species = safeGet(idxSpecies) || 'pino'
    const validSpecies = ['pino', 'quercia', 'cipresso']

    trees.push({
      id: safeGet(idxId) || `T${String(i).padStart(3, '0')}`,
      species: validSpecies.includes(species.toLowerCase()) ? species.toLowerCase() : 'pino',
      lat: parseFloat(lat.toFixed(8)),
      lon: parseFloat(lon.toFixed(8)),
      height_m: safeNum(idxHeight) ?? 15,
      diameter_cm: safeNum(idxDiam) ?? 30,
      measured_height_m: safeNum(idxMHeight),
      measured_diameter_cm: safeNum(idxMDiam),
      measured_health: safeNum(idxMHealth),
      measured_at: safeStr(idxMAt),
    })
  }

  if (trees.length === 0) {
    store.addChatMessage(
      'system',
      `CSV non valido: nessuna riga valida trovata. ${parseErrors} errori.`
    )
    return
  }

  // If no center extracted from filename, use average of tree positions
  if (!center) {
    const avgLat = trees.reduce((s, t) => s + t.lat, 0) / trees.length
    const avgLon = trees.reduce((s, t) => s + t.lon, 0) / trees.length
    center = { lat: avgLat, lon: avgLon, name: plotName }
  }

  store.loadTrees(trees, center, plotName)
  store.addChatMessage(
    'system',
    `CSV caricato: ${trees.length} alberi. Centro: ${center.lat.toFixed(6)}, ${center.lon.toFixed(6)}.`
  )
}
</script>

<style scoped>
#app-root {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}
</style>
