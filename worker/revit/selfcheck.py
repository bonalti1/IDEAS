#!/usr/bin/env python3
"""
Dry run without Revit. Checks a design.json against the contract the build script
expects, applies kit.revit.json the same way the build script will, and, when a
template-names.json from list_names.py is given, says which names will fall back.

    python selfcheck.py design.json [--map kit.revit.json] [--names template-names.json] [--json]

Exit 0 when the design would build (fallbacks are warnings, not errors).
"""
import json, sys, os, math

def load(p):
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    design = load(argv[1])
    opts = {'--map': None, '--names': None}
    as_json = '--json' in argv
    for k in opts:
        if k in argv:
            opts[k] = argv[argv.index(k) + 1]
    here = os.path.dirname(os.path.abspath(__file__))
    map_path = opts['--map'] or os.path.join(here, '..', 'kit.revit.json')
    mapping = load(map_path) if os.path.exists(map_path) else {}
    names = load(opts['--names']) if opts['--names'] else None

    errors, warnings, fallbacks = [], [], []
    if design.get('contract') != 1:
        errors.append('contract is %r, the worker needs 1' % design.get('contract'))
    for key in ['rooms', 'walls', 'doors', 'windows', 'fixtures', 'sheets']:
        if not isinstance(design.get(key), list):
            errors.append('missing %s[]' % key)
    if errors:
        return finish(errors, warnings, fallbacks, {}, as_json)

    counts = {k: len(design[k]) for k in ['rooms', 'walls', 'doors', 'windows', 'fixtures', 'sheets']}
    counts['roofMasses'] = len((design.get('roof') or {}).get('masses') or [])
    counts['footprintPoints'] = len(design.get('footprint') or [])
    counts['slabs'] = len([r for r in (design.get('footprints') or ([design['footprint']] if design.get('footprint') else [])) if len(r) >= 3])
    if counts['walls'] == 0:
        errors.append('no walls')
    if counts['footprintPoints'] < 3:
        warnings.append('no footprint polygon: the slab will be skipped')
    short = [w['id'] for w in design['walls'] if math.hypot(w['b'][0] - w['a'][0], w['b'][1] - w['a'][1]) < 0.3]
    if short:
        warnings.append('%d walls under 0.3 ft are skipped: %s' % (len(short), ', '.join(short[:5])))
    for w in design['walls']:
        if w.get('plate', 0) - w.get('base', 0) <= 0:
            errors.append('wall %s has no height' % w['id'])
    # doors and windows need a wall within 1.5 ft of their centre
    def near_wall(x, z):
        best = 1e9
        for w in design['walls']:
            ax, az = w['a']; bx, bz = w['b']
            dx, dz = bx - ax, bz - az
            l2 = dx * dx + dz * dz or 1
            t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / l2))
            best = min(best, math.hypot(x - (ax + dx * t), z - (az + dz * t)))
        return best
    for d in design['doors']:
        if not d.get('cased') and near_wall(d['x'], d['z']) > 1.5:
            warnings.append('door %s has no wall within 1.5 ft; it will be skipped' % d['id'])
    for w in design['windows']:
        if not w.get('dormer') and near_wall(w['x'], w['z']) > 1.5:
            warnings.append('window %s has no wall within 1.5 ft; it will be skipped' % w['id'])

    def mapped(kind, name):
        return (mapping.get(kind) or {}).get(name) or name
    def check(kind, name, pool):
        if not name:
            return
        want = mapped(kind, name)
        if names is not None and pool is not None and want not in pool:
            rec = {'kind': kind, 'wanted': want, 'kitName': name}
            if rec not in fallbacks:
                fallbacks.append(rec)
    pools = None
    if names:
        pools = {
            'wallTypes': set(names.get('wallTypes') or []),
            'floorType': set(names.get('floorTypes') or []),
            'roofTypes': set(names.get('roofTypes') or []),
            'doors': set(names.get('doors') or []),
            'windows': set(names.get('windows') or []),
            'titleBlock': set(names.get('titleBlocks') or []),
            'fixtures': set((names.get('furniture') or []) + (names.get('casework') or []) + (names.get('plumbing') or []) + (names.get('appliances') or []) + (names.get('genericModels') or [])),
        }
    rv = design.get('revit') or {}
    for w in design['walls']:
        check('wallTypes', w.get('revitType'), pools and pools['wallTypes'])
    check('floorType', rv.get('floorType'), pools and pools['floorType'])
    check('roofTypes', (rv.get('roofTypes') or {}).get('shingles'), pools and pools['roofTypes'])
    for d in design['doors']:
        check('doors', d.get('revitFamily'), pools and pools['doors'])
    for w in design['windows']:
        check('windows', w.get('revitFamily'), pools and pools['windows'])
    for f in design['fixtures']:
        check('fixtures', f.get('revitFamily'), pools and pools['fixtures'])
    check('titleBlock', rv.get('titleBlockFamily'), pools and pools['titleBlock'])
    # family names that match nothing in the family pool when no names file is given: just count the distinct names the mapping must cover
    distinct = {
        'wallTypes': sorted(set(w.get('revitType') for w in design['walls'] if w.get('revitType'))),
        'doors': sorted(set(d.get('revitFamily') for d in design['doors'] if d.get('revitFamily'))),
        'windows': sorted(set(w.get('revitFamily') for w in design['windows'] if w.get('revitFamily'))),
        'fixtures': sorted(set(f.get('revitFamily') for f in design['fixtures'] if f.get('revitFamily'))),
    }
    unmapped = {k: [n for n in v if n not in (mapping.get(k) or {})] for k, v in distinct.items()}
    info = {'counts': counts, 'mapping': map_path if os.path.exists(map_path) else None, 'distinctNames': distinct, 'unmappedNames': unmapped}
    return finish(errors, warnings, fallbacks, info, as_json)

def finish(errors, warnings, fallbacks, info, as_json):
    ok = not errors
    if as_json:
        print(json.dumps({'ok': ok, 'errors': errors, 'warnings': warnings, 'fallbacks': fallbacks, **info}, indent=2))
    else:
        print('SELFCHECK %s' % ('OK' if ok else 'FAILED'))
        for e in errors:
            print('  error:   ' + e)
        for w in warnings:
            print('  warning: ' + w)
        for f in fallbacks:
            print('  fallback: %s "%s" is not in the template' % (f['kind'], f['wanted']))
        if info.get('counts'):
            print('  counts:  ' + ', '.join('%s %d' % kv for kv in info['counts'].items()))
        if info.get('unmappedNames'):
            n = sum(len(v) for v in info['unmappedNames'].values())
            print('  names:   %d kit names have no entry in kit.revit.json yet (they are used as-is)' % n)
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main(sys.argv))
