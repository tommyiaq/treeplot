<template>
  <div class="topbar">
    <div class="topbar-section topbar-left">
      <span class="gps-icon" :class="{ active: gpsActive }">⬡</span>
      <span class="gps-status hud-label">{{ gpsStatusText }}</span>
    </div>
    <div class="topbar-section topbar-center">
      <select
        v-if="store.availablePlots.length"
        class="plot-select"
        :value="store.currentAdsId"
        @change="onPlotChange"
      >
        <option
          v-for="p in store.availablePlots"
          :key="p.id"
          :value="p.id"
        >ADS {{ p.id }} ({{ p.count }})</option>
      </select>
      <span v-else class="plot-name">{{ store.plotName.toUpperCase() }}</span>
    </div>
    <div class="topbar-section topbar-right">
      <span class="progress-badge">
        <span class="progress-count">{{ store.measuredCount }}</span>
        <span class="progress-sep">/</span>
        <span class="progress-total">{{ store.trees.length }}</span>
        <span class="progress-check"> ✓</span>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { usePlotStore } from '../store/plot.js'

const store = usePlotStore()

const gpsActive = computed(() => store.userPosition !== null)

function onPlotChange(e) {
  store.changePlot(e.target.value)
}

const gpsStatusText = computed(() => {
  if (!store.userPosition) {
    return store.gpsWaiting ? 'GPS: acquisizione...' : 'GPS: non disponibile'
  }
  const pos = store.userPosition
  return `GPS: ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}`
})
</script>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  min-height: 44px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  flex-shrink: 0;
  position: relative;
  z-index: 10;
}

.topbar-section {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
}

.topbar-left {
  justify-content: flex-start;
}

.topbar-center {
  justify-content: center;
  flex: 2;
}

.topbar-right {
  justify-content: flex-end;
}

.gps-icon {
  font-size: 16px;
  color: var(--dim);
  transition: color 0.3s ease;
  line-height: 1;
}

.gps-icon.active {
  color: var(--teal);
  animation: glow-pulse 2s ease-in-out infinite;
}

.gps-status {
  font-size: 10px;
  color: var(--dim);
  letter-spacing: 1px;
}

.plot-name {
  font-size: 13px;
  font-weight: bold;
  color: var(--cyan);
  letter-spacing: 2px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.plot-select {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--cyan);
  font-family: inherit;
  font-size: 12px;
  font-weight: bold;
  letter-spacing: 1px;
  padding: 3px 6px;
  border-radius: 2px;
  cursor: pointer;
  max-width: 160px;
  outline: none;
}
.plot-select:focus { border-color: var(--cyan); }
.plot-select option { background: #020915; color: var(--text); }

.progress-badge {
  font-size: 13px;
  letter-spacing: 1px;
}

.progress-count {
  color: var(--teal);
  font-size: 15px;
  font-weight: bold;
}

.progress-sep {
  color: var(--dim);
  margin: 0 1px;
}

.progress-total {
  color: var(--text);
  font-size: 13px;
}

.progress-check {
  color: var(--teal);
  font-size: 12px;
}
</style>
