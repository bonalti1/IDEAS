// The ten home styles. Each has a roof silhouette for the picker card,
// a cost band ($/sf, rough South Texas custom build), and a kit. Only the
// farmhouse has a real kit so far (src/kits); the others borrow its room
// templates until their own sets are extracted.
import { KIT as FARMHOUSE } from '../../kits/modern-farmhouse.js'
import { GENERATED } from '../../kits/generated.js'

const BASE_STYLES = [
  { id: 'modern', name: 'Modern', blurb: 'Flat roofs, clean lines, big glass.', roof: 'flat', stories: 2 },
  { id: 'farmhouse', name: 'Modern Farmhouse', blurb: 'Gables, board and batten, deep porch.', roof: 'gable', stories: 1, kit: FARMHOUSE, ready: true },
  { id: 'spanish', name: 'Spanish', blurb: 'Stucco, clay tile, arches, courtyard.', roof: 'hip', stories: 1 },
  { id: 'hillcountry', name: 'Hill Country', blurb: 'Limestone, standing seam, wide eaves.', roof: 'gable', stories: 1 },
  { id: 'ranch', name: 'Ranch', blurb: 'Long, low, single story, easy living.', roof: 'hip', stories: 1 },
  { id: 'craftsman', name: 'Craftsman', blurb: 'Tapered columns, exposed rafters.', roof: 'gable', stories: 1 },
  { id: 'transitional', name: 'Transitional', blurb: 'Classic shape, modern finishes.', roof: 'hip', stories: 2 },
  { id: 'tuscan', name: 'Tuscan', blurb: 'Stone, tile, warm earth tones.', roof: 'hip', stories: 1 },
  { id: 'midcentury', name: 'Mid-Century', blurb: 'Low pitch, clerestories, breezeway.', roof: 'shed', stories: 1 },
  { id: 'coastal', name: 'Coastal', blurb: 'Raised, airy, metal roof, shutters.', roof: 'hip', stories: 2 },
]

// a style is ready when it has a kit: the traced farmhouse, or one generated from a drafter's IFC export
export const STYLES = BASE_STYLES.map((st) => (GENERATED[st.id] ? { ...st, kit: GENERATED[st.id], ready: true } : st))
