// Who stands behind the plans, on the welcome and Send screens. Verified against STB's site (round 8,
// decisions G1–G3). The drafter's name and photo stay behind `placeholder: true` (the monogram and "the
// STB design team" show) until Rolando OKs showing him.
import { CHECK_GROUPS } from './audit.js'

// the same sentence with the count left open, so the Spanish one carries the same number
export const CHECKED = `Every plan is checked against {count} IRC planning checks before you see it: doors and reach, egress windows, 42" halls, closets, bath clearances, the garage and its driveway, the kitchen triangle, the suite, no voids. A licensed review comes with the drafter's sheet set.`

export const TRUST = {
  team: 'Plans by the South Texas Builders design team',
  drafter: {
    name: 'Leroy Flores', // STB team page: south-texasbuilders.com/team/leroy-flores/
    title: 'Lead Drafter, South Texas Builders',
    // copied into public/team/ (never hotlinked: the site's Astro image names change); the monogram shows while
    // placeholder is true or the file is missing
    photo: '/team/leroy-flores.webp',
    placeholder: true, // flip when Rolando OKs showing his name and face
    placeholderName: 'The STB design team',
  },
  // the audit's own count, so this line never promises more than the code checks
  checked: CHECKED.replace('{count}', CHECK_GROUPS.length),
  builtHomes: { label: 'See homes we have built', url: 'https://south-texasbuilders.com/our-homes/' },
  // what the app says about cost: nothing but this (round 8, P0b)
  cost: 'What it costs: we go over cost with you at your meeting with the South Texas Builders office.',
  costLine: 'We go over cost with you at your meeting with the South Texas Builders office.', // the same sentence under its own heading
  phone: '(956) 594-6936',
  // what happens after the draft, with the dates the office keeps to
  next: [
    { when: 'Today', what: 'Your draft, checked against the code.' },
    { when: 'Within 1 business day', what: 'A drafter reviews the plan on your lot and contacts you.' }, // STB: "We reply within one business day"
    { when: 'Within 10 business days (about 2 weeks)', what: 'The full sheet set from Revit: plans, elevations, roof, foundation, electrical, code review.' }, // STB: about 2 weeks for final plans and construction documents
    { when: 'Then', what: 'A meeting at the office to walk the plan and the cost, and the permit, about 2 weeks depending on the city; we submit it for you.' },
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
