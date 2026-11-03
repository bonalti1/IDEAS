// The ten home styles. Each has a roof silhouette for the picker card,
// a cost band ($/sf, rough South Texas custom build), and massing hints the
// mock layout engine uses. Real kits replace this in the backend phase.
export const STYLES = [
  { id: 'modern', name: 'Modern', blurb: 'Flat roofs, clean lines, big glass.', psf: 215, roof: 'flat', stories: 2 },
  { id: 'farmhouse', name: 'Modern Farmhouse', blurb: 'Gables, board and batten, deep porch.', psf: 190, roof: 'gable', stories: 1 },
  { id: 'spanish', name: 'Spanish', blurb: 'Stucco, clay tile, arches, courtyard.', psf: 205, roof: 'hip', stories: 1 },
  { id: 'hillcountry', name: 'Hill Country', blurb: 'Limestone, standing seam, wide eaves.', psf: 200, roof: 'gable', stories: 1 },
  { id: 'ranch', name: 'Ranch', blurb: 'Long, low, single story, easy living.', psf: 175, roof: 'hip', stories: 1 },
  { id: 'craftsman', name: 'Craftsman', blurb: 'Tapered columns, exposed rafters.', psf: 195, roof: 'gable', stories: 1 },
  { id: 'transitional', name: 'Transitional', blurb: 'Classic shape, modern finishes.', psf: 195, roof: 'hip', stories: 2 },
  { id: 'tuscan', name: 'Tuscan', blurb: 'Stone, tile, warm earth tones.', psf: 210, roof: 'hip', stories: 1 },
  { id: 'midcentury', name: 'Mid-Century', blurb: 'Low pitch, clerestories, breezeway.', psf: 205, roof: 'shed', stories: 1 },
  { id: 'coastal', name: 'Coastal', blurb: 'Raised, airy, metal roof, shutters.', psf: 200, roof: 'hip', stories: 2 },
]

export const CITIES = {
  palmview: { name: 'Palmview, TX', county: 'Hidalgo County', zoning: 'R-1 Single Family', minLot: 6000, maxCoverage: 0.5 },
}
