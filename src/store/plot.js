import { defineStore } from 'pinia'
import { haversineDistance } from '../utils/gps.js'
import { loadPlot } from '../utils/loadPlot.js'

const LS_KEY = 'treeplot_v2'

export const usePlotStore = defineStore('plot', {
  state: () => ({
    trees: [],
    plotCenter: null,       // { lat, lon, name }
    plotName: 'Demo',
    userPosition: null,     // { lat, lon }
    userHeading: 0,
    selectedTree: null,
    chatMessages: [],
    llmStatus: 'idle',      // 'idle' | 'loading' | 'ready' | 'error'
    llmProgress: 0,
    llmProgressMsg: '',
    gpsWaiting: false,
    measureModalOpen: false,
    availablePlots: [],     // [{ id, count }] from listPlots()
    currentAdsId: '1',
  }),

  getters: {
    measuredCount: (state) => state.trees.filter((t) => t.measured_at !== null).length,

    unmeasuredCount: (state) => state.trees.filter((t) => t.measured_at === null).length,

    nearbyTrees: (state) => {
      // No GPS → treat all trees as "nearby" so the UI stays usable
      if (!state.userPosition) return state.trees
      return state.trees.filter((t) => {
        const d = haversineDistance(state.userPosition, { lat: t.lat, lon: t.lon })
        return d <= 5
      })
    },

    tappableTrees: (state) => {
      if (!state.userPosition) return state.trees
      return state.trees.filter((t) => {
        const d = haversineDistance(state.userPosition, { lat: t.lat, lon: t.lon })
        return d <= 5
      })
    },

    progressPercent: (state) => {
      if (state.trees.length === 0) return 0
      const measured = state.trees.filter((t) => t.measured_at !== null).length
      return (measured / state.trees.length) * 100
    },
  },

  actions: {
    /**
     * Load trees into the store and optionally set the plot center.
     * @param {Array} trees
     * @param {{ lat: number, lon: number, name: string }|null} center
     * @param {string} name
     */
    loadTrees(trees, center, name) {
      this.trees = trees
      if (center) this.plotCenter = center
      if (name) this.plotName = name
      this.saveToLocalStorage()
    },

    async changePlot(adsId) {
      this.currentAdsId = String(adsId)
      this.selectedTree = null
      this.chatMessages = []
      this.gpsWaiting = true
      try {
        const trees = await loadPlot(this.currentAdsId)
        const name = `ADS_${this.currentAdsId}`
        this.loadTrees(trees, { lat: 43.46878, lon: 11.15117, name }, name)
      } finally {
        this.gpsWaiting = false
      }
    },

    /**
     * Record a field measurement for a tree.
     * @param {string} id
     * @param {{ height_m: number, diameter_cm: number, health: number }} data
     */
    updateMeasurement(id, { height_m, diameter_cm, health }) {
      const tree = this.trees.find((t) => t.id === id)
      if (!tree) return
      tree.measured_height_m = height_m
      tree.measured_diameter_cm = diameter_cm
      tree.measured_health = health
      tree.measured_at = new Date().toISOString()
      this.saveToLocalStorage()
    },

    /**
     * Update the user's GPS position.
     * @param {number} lat
     * @param {number} lon
     */
    setUserPosition(lat, lon) {
      this.userPosition = {
        lat: parseFloat(lat.toFixed(8)),
        lon: parseFloat(lon.toFixed(8)),
      }
    },

    /**
     * Set the user's compass heading.
     * @param {number} heading degrees 0–360
     */
    setUserHeading(heading) {
      this.userHeading = heading
    },

    /**
     * Select a tree (opens MeasureModal) or clear the selection.
     * @param {object|null} tree
     */
    setSelectedTree(tree) {
      this.selectedTree = tree
    },

    /**
     * Append a message to the chat history.
     * @param {'user'|'assistant'|'system'} role
     * @param {string} content
     */
    addChatMessage(role, content) {
      this.chatMessages.push({ role, content, timestamp: Date.now() })
    },

    /**
     * Persist tree data and center to localStorage.
     */
    saveToLocalStorage() {
      try {
        const payload = {
          trees: this.trees,
          plotCenter: this.plotCenter,
          plotName: this.plotName,
        }
        localStorage.setItem(LS_KEY, JSON.stringify(payload))
      } catch (e) {
        console.warn('[store] Failed to save to localStorage:', e)
      }
    },

    /**
     * Restore tree data and center from localStorage.
     * @returns {boolean} true if data was restored
     */
    loadFromLocalStorage() {
      try {
        const raw = localStorage.getItem(LS_KEY)
        if (!raw) return false
        const payload = JSON.parse(raw)
        if (payload.trees && Array.isArray(payload.trees)) {
          this.trees = payload.trees
        }
        if (payload.plotCenter) {
          this.plotCenter = payload.plotCenter
        }
        if (payload.plotName) {
          this.plotName = payload.plotName
        }
        return true
      } catch (e) {
        console.warn('[store] Failed to load from localStorage:', e)
        return false
      }
    },

    /**
     * Generate and download a CSV file with all tree data.
     */
    exportCsv() {
      const header = 'id,species,lat,lon,height_m,diameter_cm,measured_height_m,measured_diameter_cm,measured_health,measured_at'
      const rows = this.trees.map((t) => {
        return [
          t.id,
          t.species,
          t.lat,
          t.lon,
          t.height_m,
          t.diameter_cm,
          t.measured_height_m ?? '',
          t.measured_diameter_cm ?? '',
          t.measured_health ?? '',
          t.measured_at ?? '',
        ].join(',')
      })
      const csvContent = [header, ...rows].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const centerStr =
        this.plotCenter
          ? `${this.plotCenter.lat.toFixed(6)}_${this.plotCenter.lon.toFixed(6)}`
          : 'export'
      link.href = url
      link.download = `treeplot_${this.plotName}_${centerStr}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
  },
})
