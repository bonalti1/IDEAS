// Who stands behind the plans, on the welcome and Send screens. Placeholders are marked
// PLACEHOLDER: Rolando supplies the real names, photos and links before launch.
import { CHECK_GROUPS } from './audit.js'

export const TRUST = {
  team: 'Plans by the South Texas Builders design team',
  drafter: {
    name: 'Your drafter', // PLACEHOLDER: the lead drafter's name
    title: 'Lead drafter, South Texas Builders',
    photo: null, // PLACEHOLDER: a square photo URL; a monogram shows until then
    placeholder: true,
  },
  // the audit's own count, so this line never promises more than the code checks
  checked: `Every plan is checked against ${CHECK_GROUPS.length} IRC planning checks before you see it: doors and reach, egress windows, 42" halls, closets, bath clearances, the garage and its driveway, the kitchen triangle, the suite, no voids. A licensed review comes with the drafter's sheet set.`,
  builtHomes: { label: 'See homes we have built', url: 'https://south-texasbuilders.com/' }, // PLACEHOLDER: the gallery page
  // what happens after the draft, with the dates the office keeps to
  next: [
    { when: 'Today', what: 'Your draft, checked against the code, with a price range.' },
    { when: 'Within 1 business day', what: 'A drafter reviews the plan on your lot and approves it or sends it back with a note.' }, // PLACEHOLDER: Rolando confirms the timing
    { when: 'Within 5 business days', what: 'The full sheet set from Revit: plans, elevations, roof, foundation, electrical, code review.' }, // PLACEHOLDER: Rolando confirms the timing
    { when: 'Then', what: 'A meeting at the office to walk the plan and the quote.' }, // PLACEHOLDER: confirm the timing
  ],
}

/** The initials for the monogram when there is no photo. */
export const monogram = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'STB'
