<template>
  <Teleport to="body">
    <div v-if="tree" class="modal-backdrop" @click.self="cancel">
      <div class="modal-card">
        <!-- Header -->
        <div class="modal-header">
          <div class="modal-title">
            <span class="hud-label">{{ tree.measured_at ? 'AGGIORNA RILIEVO' : 'RILIEVO ALBERO' }}</span>
            <div class="tree-id-row">
              <span class="species-icon">{{ speciesIcon }}</span>
              <span class="tree-id">{{ tree.id }}</span>
              <span class="species-label">{{ tree.species.toUpperCase() }}</span>
              <span v-if="tree.measured_at" class="remeasure-badge">AGGIORNA</span>
            </div>
          </div>
          <button class="close-btn" @click="cancel">✕</button>
        </div>

        <!-- Reference values -->
        <div class="ref-values">
          <div class="ref-item">
            <span class="hud-label">Altezza attuale</span>
            <span class="ref-value">{{ tree.height_m }} m</span>
          </div>
          <div class="ref-item">
            <span class="hud-label">DBH attuale</span>
            <span class="ref-value">{{ tree.diameter_cm }} cm</span>
          </div>
        </div>

        <!-- Form -->
        <div class="modal-form">
          <!-- Height -->
          <div class="form-group">
            <label class="form-label hud-label" for="m-height">Altezza (m)</label>
            <input
              id="m-height"
              type="number"
              step="0.1"
              min="0.1"
              max="100"
              v-model.number="form.height"
              placeholder="es. 14.5"
              :class="{ error: errors.height, warn: !errors.height && warnings.height }"
            />
            <span class="field-error" v-if="errors.height">{{ errors.height }}</span>
            <span class="field-warn" v-else-if="warnings.height">⚠ {{ warnings.height }}</span>
          </div>

          <!-- Diameter -->
          <div class="form-group">
            <label class="form-label hud-label" for="m-diam">
              DBH — Diametro a petto d'uomo (cm)
            </label>
            <input
              id="m-diam"
              type="number"
              step="0.5"
              min="0.5"
              max="500"
              v-model.number="form.diameter"
              placeholder="es. 32.5"
              :class="{ error: errors.diameter, warn: !errors.diameter && warnings.diameter }"
            />
            <span class="field-error" v-if="errors.diameter">{{ errors.diameter }}</span>
            <span class="field-warn" v-else-if="warnings.diameter">⚠ {{ warnings.diameter }}</span>
          </div>

          <!-- Health -->
          <div class="form-group">
            <label class="form-label hud-label">Stato di salute</label>
            <div class="health-chips">
              <button
                v-for="h in healthOptions"
                :key="h.value"
                class="health-chip"
                :class="[`health-${h.value}`, { selected: form.health === h.value }]"
                @click="form.health = h.value"
                type="button"
              >
                <span class="chip-num">{{ h.value }}</span>
                <span class="chip-label">{{ h.label }}</span>
              </button>
            </div>
            <span class="field-error" v-if="errors.health">{{ errors.health }}</span>
          </div>
        </div>

        <!-- Actions -->
        <div class="modal-actions">
          <button class="btn-cancel" @click="cancel">ANNULLA</button>
          <button class="btn-save" @click="save">SALVA</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { usePlotStore } from '../store/plot.js'

const store = usePlotStore()

const tree = computed(() => store.selectedTree)

// Hard limits — applies to all species
const LIMITS = {
  height: { min: 0.1, max: 100 },
  diameter: { min: 0.5, max: 500 },
}

// Soft thresholds per species — triggers a warning but does not block save
const SPECIES_WARN = {
  pino:     { height: 50, diameter: 200 },
  quercia:  { height: 45, diameter: 350 },
  cipresso: { height: 55, diameter: 150 },
}

const speciesIcon = computed(() => {
  if (!tree.value) return '🌲'
  const icons = { pino: '🌲', quercia: '🌳', cipresso: '🌴' }
  return icons[tree.value.species] || '🌲'
})

const healthOptions = [
  { value: 1, label: 'Pessimo' },
  { value: 2, label: 'Scarso' },
  { value: 3, label: 'Discreto' },
  { value: 4, label: 'Buono' },
  { value: 5, label: 'Ottimo' },
]

const form = reactive({
  height: null,
  diameter: null,
  health: null,
})

const errors = reactive({
  height: '',
  diameter: '',
  health: '',
})

const warnings = reactive({
  height: '',
  diameter: '',
})

// Reset form when a new tree is selected
watch(
  () => store.selectedTree,
  (t) => {
    if (t) {
      form.height = t.measured_height_m ?? null
      form.diameter = t.measured_diameter_cm ?? null
      form.health = t.measured_health ?? null
      errors.height = ''
      errors.diameter = ''
      errors.health = ''
      warnings.height = ''
      warnings.diameter = ''
    }
  },
  { immediate: true }
)

function validate() {
  let valid = true
  errors.height = ''
  errors.diameter = ''
  errors.health = ''
  warnings.height = ''
  warnings.diameter = ''

  const sp = tree.value?.species ?? 'pino'
  const warnLimits = SPECIES_WARN[sp] ?? SPECIES_WARN.pino

  // Height
  if (form.height === null || form.height === '' || isNaN(form.height)) {
    errors.height = 'Inserire altezza'
    valid = false
  } else if (form.height < LIMITS.height.min) {
    errors.height = `Minimo ${LIMITS.height.min} m`
    valid = false
  } else if (form.height > LIMITS.height.max) {
    errors.height = `Massimo ${LIMITS.height.max} m — nessun albero supera questa altezza`
    valid = false
  } else if (form.height > warnLimits.height) {
    warnings.height = `Valore insolito per ${sp}: altezza tipica < ${warnLimits.height} m`
  }

  // DBH
  if (form.diameter === null || form.diameter === '' || isNaN(form.diameter)) {
    errors.diameter = 'Inserire DBH'
    valid = false
  } else if (form.diameter < LIMITS.diameter.min) {
    errors.diameter = `Minimo ${LIMITS.diameter.min} cm`
    valid = false
  } else if (form.diameter > LIMITS.diameter.max) {
    errors.diameter = `Massimo ${LIMITS.diameter.max} cm`
    valid = false
  } else if (form.diameter > warnLimits.diameter) {
    warnings.diameter = `DBH insolito per ${sp}: tipicamente < ${warnLimits.diameter} cm`
  }

  // Cross-check: tree should be taller than its trunk radius
  if (valid && form.height !== null && form.diameter !== null) {
    const trunkRadiusM = form.diameter / 200
    if (form.height < trunkRadiusM * 2) {
      errors.height = `Altezza (${form.height} m) incompatibile con DBH (${form.diameter} cm)`
      valid = false
    }
  }

  // Health
  if (!form.health) {
    errors.health = 'Selezionare stato di salute'
    valid = false
  }

  return valid
}

function save() {
  if (!validate()) return
  if (!tree.value) return

  store.updateMeasurement(tree.value.id, {
    height_m:    Number(form.height),
    diameter_cm: Number(form.diameter),
    health:      Number(form.health),
  })

  store.measureModalOpen = false
}

function cancel() {
  store.measureModalOpen = false
}
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 9, 21, 0.95);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
}

.modal-card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 2px;
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 0;
  box-shadow: 0 0 40px rgba(0, 229, 255, 0.08);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-id-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.species-icon {
  font-size: 28px;
  line-height: 1;
}

.tree-id {
  font-size: 22px;
  color: var(--cyan);
  font-weight: bold;
  letter-spacing: 2px;
}

.species-label {
  font-size: 12px;
  color: var(--dim);
  letter-spacing: 2px;
}

.remeasure-badge {
  font-size: 9px;
  letter-spacing: 2px;
  color: #22ee77;
  border: 1px solid #22ee77;
  padding: 1px 6px;
  border-radius: 2px;
  align-self: center;
}

.close-btn {
  border: 1px solid var(--dim);
  color: var(--dim);
  padding: 4px 8px;
  font-size: 14px;
  letter-spacing: 0;
  text-transform: none;
}

.ref-values {
  display: flex;
  gap: 24px;
  padding: 10px 16px;
  background: rgba(0, 229, 255, 0.03);
  border-bottom: 1px solid var(--border);
}

.ref-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ref-value {
  font-size: 17px;
  color: var(--dim);
  letter-spacing: 1px;
}

.modal-form {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 10px;
  letter-spacing: 2px;
}

input.error {
  border-color: #ff4444;
}

input.warn {
  border-color: #ffaa00;
}

.field-error {
  font-size: 11px;
  color: #ff4444;
  letter-spacing: 1px;
}

.field-warn {
  font-size: 11px;
  color: #ffaa00;
  letter-spacing: 0.5px;
}

.health-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.health-chip {
  flex: 1;
  min-width: 52px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 4px;
  border: 1px solid var(--dim);
  color: var(--dim);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: transparent;
  text-transform: none;
  letter-spacing: 0;
  gap: 3px;
}

.health-chip .chip-num {
  font-size: 18px;
  font-weight: bold;
  line-height: 1;
}

.health-chip .chip-label {
  font-size: 9px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* Health colors */
.health-chip.health-1 { border-color: #cc2222; }
.health-chip.health-2 { border-color: #cc6600; }
.health-chip.health-3 { border-color: #ccaa00; }
.health-chip.health-4 { border-color: #22aa22; }
.health-chip.health-5 { border-color: var(--cyan); }

.health-chip.health-1.selected {
  background: rgba(204, 34, 34, 0.15);
  color: #ff4444;
  border-color: #ff4444;
  box-shadow: 0 0 8px rgba(255, 68, 68, 0.3);
}

.health-chip.health-2.selected {
  background: rgba(204, 102, 0, 0.15);
  color: #ff8800;
  border-color: #ff8800;
  box-shadow: 0 0 8px rgba(255, 136, 0, 0.3);
}

.health-chip.health-3.selected {
  background: rgba(204, 170, 0, 0.15);
  color: #ffcc00;
  border-color: #ffcc00;
  box-shadow: 0 0 8px rgba(255, 204, 0, 0.3);
}

.health-chip.health-4.selected {
  background: rgba(34, 170, 34, 0.15);
  color: #44dd44;
  border-color: #44dd44;
  box-shadow: 0 0 8px rgba(68, 221, 68, 0.3);
}

.health-chip.health-5.selected {
  background: rgba(0, 229, 255, 0.12);
  color: var(--cyan);
  border-color: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
}

.modal-actions {
  display: flex;
  gap: 10px;
  padding: 14px 16px;
  border-top: 1px solid var(--border);
}

.btn-cancel {
  flex: 1;
  border-color: var(--dim);
  color: var(--dim);
  padding: 10px;
}

.btn-cancel:hover {
  border-color: var(--text);
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
  box-shadow: none;
}

.btn-save {
  flex: 2;
  border-color: var(--cyan);
  color: var(--cyan);
  padding: 10px;
  font-size: 13px;
  letter-spacing: 2px;
}

.btn-save:hover,
.btn-save:active {
  background: rgba(0, 229, 255, 0.15);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.4);
}
</style>
