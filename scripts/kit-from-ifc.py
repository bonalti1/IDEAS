#!/usr/bin/env python3
"""
Read a Revit IFC4 export of one house with IfcOpenShell and write a Draft House style kit in
the same shape as src/kits/modern-farmhouse.js: rooms, doors, windows, fixtures, roof masses,
wall types, open pairs, plates, and the reference program.

    python3 scripts/kit-from-ifc.py <model.ifc> --id spanish --name "Spanish" [--out src/kits] [--json]
    python3 scripts/kit-from-ifc.py <model.ifc> --compare src/kits/modern-farmhouse.js   (round-trip report)

What it reads: IfcSpace (rooms), IfcWall (types by thickness and IsExternal), IfcDoor and
IfcWindow with their host wall (axis, width, sill, head), IfcFurnishingElement and IfcFlowTerminal
(fixtures), IfcSlab ROOF panels under IfcRoof (gable masses by pairing slopes that share a ridge).
The plan frame is the kit's: x along the front (east), y toward the street (south), origin at the
rear-left corner of the rooms' bounding box. A rotated building is straightened first by the
dominant wall direction. Needs IfcOpenShell 0.8+ and numpy (python3 -m pip install ifcopenshell numpy).
"""
import sys, os, json, math, re, argparse, collections, datetime
import numpy as np
import ifcopenshell, ifcopenshell.geom
import ifcopenshell.util.unit as U
import ifcopenshell.util.element as E

FT = 3.280839895  # metres → feet
OVERHANG = 1.33   # the kit's roof overhang: masses are wall lines, the roof engine adds it back

# ── room, fixture and door naming ─────────────────────────────────────────
ROOM_KINDS = [
    (r'half ?bath|powder', 'halfbath'), (r'primary bath|master bath|m\. ?bath|owner.*bath', 'mbath'),
    (r'jack|j ?& ?j', 'jackjill'), (r'bath', 'bath'), (r'hall|corridor|gallery', 'hall'),
    (r'primary closet|master closet|owner.*closet|w\.?i\.?c', 'mwic'), (r'closet|linen|wic|wardrobe', 'wic'),
    (r'mini primary|second suite|guest suite|suite', 'suite2'), (r'primary|master|owner', 'master'), (r'bed', 'bed'),
    (r'kitchen', 'kitchen'), (r'dining|breakfast|nook', 'dining'), (r'living|family|great|den', 'living'),
    (r'foyer|entry|vestibule', 'foyer'), (r'pantry', 'pantry'), (r'office|study|library', 'office'),
    (r'laundry|utility', 'laundry'), (r'mud', 'mud'), (r'garage', 'garage'), (r'porch|patio|lanai|veranda', 'porch'),
]
FIXTURE_KINDS = [
    (r'toilet|water closet|w\.?c\.?', 'toilet'), (r'shower|tub', 'shower'), (r'vanity|lavatory|lav\b', 'vanity'),
    (r'kitchen sink|sink', 'sink'), (r'refrigerator|fridge', 'fridge'), (r'range|stove|cooktop|oven', 'range'),
    (r'washer', 'washer'), (r'dryer', 'dryer'), (r'water heater|wh\b', 'wh'), (r'bed', 'bed'), (r'sofa|couch|sectional', 'sofa'),
    (r'coffee', 'coffee'), (r'dining table|table', 'table'), (r'desk', 'desk'), (r'island', 'island'), (r'linen', 'linen'),
    (r'base cabinet|counter|cabinet', 'counter'), (r'shelv', 'shelves'), (r'bench', 'bench'), (r'media|tv|television', 'tv'),
]
KNOWN_KINDS = set(k for _, k in ROOM_KINDS) | {'frontPorch', 'rearPorch', 'master', 'mwic', 'mbath', 'suite2'}
def kind_of(table, text, default=None):
    t = (text or '').lower()
    for pat, k in table:
        if re.search(pat, t):
            return k
    return default
def slug(s):
    s = re.sub(r'[^a-z0-9]+', '-', (s or '').lower()).strip('-')
    return s or 'x'

# ── geometry ───────────────────────────────────────────────────────────────
def shape_verts(settings, product):
    try:
        sh = ifcopenshell.geom.create_shape(settings, product)
    except Exception:
        return None
    v = np.array(sh.geometry.verts, dtype=float).reshape(-1, 3)
    return v if len(v) else None

def rot2(xy, a):
    c, s = math.cos(a), math.sin(a)
    return np.column_stack([xy[:, 0] * c - xy[:, 1] * s, xy[:, 0] * s + xy[:, 1] * c])

class Reader:
    def __init__(self, path, log=print):
        self.f = ifcopenshell.open(path)
        self.scale = U.calculate_unit_scale(self.f) * FT  # file units → feet
        self.s = ifcopenshell.geom.settings()
        try:
            self.s.set('use-world-coords', True)
        except Exception:
            self.s.set(self.s.USE_WORLD_COORDS, True)
        self.log = log
        self.angle = 0.0
        self.origin = np.zeros(2)
        self.cache = {}

    def verts(self, p):
        if p.id() not in self.cache:
            v = shape_verts(self.s, p)
            self.cache[p.id()] = v * self.scale if v is not None else None
        return self.cache[p.id()]

    def plan_xy(self, v):
        """world feet → plan frame (x east along the front, y toward the street)."""
        xy = rot2(v[:, :2], -self.angle)
        return np.column_stack([xy[:, 0] - self.origin[0], -(xy[:, 1]) - self.origin[1]])

    def bbox(self, p):
        v = self.verts(p)
        if v is None:
            return None
        xy = self.plan_xy(v)
        return {'x0': float(xy[:, 0].min()), 'x1': float(xy[:, 0].max()), 'y0': float(xy[:, 1].min()), 'y1': float(xy[:, 1].max()), 'z0': float(v[:, 2].min()), 'z1': float(v[:, 2].max())}

    def wall_axis_world(self, w):
        v = self.verts(w)
        if v is None:
            return None
        xy = v[:, :2]
        c = xy - xy.mean(0)
        cov = c.T @ c
        val, vec = np.linalg.eigh(cov)
        d = vec[:, int(np.argmax(val))]
        return math.atan2(d[1], d[0])

    def straighten(self):
        """rotate the model so the walls run along x and y; origin at the rooms' rear-left corner."""
        walls = self.f.by_type('IfcWall')
        angs = []
        for w in walls:
            a = self.wall_axis_world(w)
            if a is None:
                continue
            v = self.verts(w)
            length = float(np.ptp(v[:, 0]) + np.ptp(v[:, 1]))
            angs.append(((a % (math.pi / 2)), length))
        if angs:
            # weighted circular mean with period 90°
            z = sum(l * complex(math.cos(4 * a), math.sin(4 * a)) for a, l in angs)
            self.angle = math.atan2(z.imag, z.real) / 4
        spaces = self.f.by_type('IfcSpace')
        pts = []
        for sp in spaces:
            v = self.verts(sp)
            if v is not None:
                pts.append(rot2(v[:, :2], -self.angle))
        if not pts:
            for w in walls:
                v = self.verts(w)
                if v is not None:
                    pts.append(rot2(v[:, :2], -self.angle))
        allp = np.vstack(pts)
        # plan y grows toward the street (south = -Y in IFC); the rear-left corner is min x, max Y
        self.origin = np.array([allp[:, 0].min(), -allp[:, 1].max()])
        self.log('straightened: rotated %.1f°, origin at world (%.1f, %.1f) ft' % (math.degrees(self.angle), self.origin[0], -self.origin[1]))

    def pset_text(self, el, key):
        try:
            for ps in E.get_psets(el).values():
                if key in ps and ps[key] not in (None, ''):
                    return str(ps[key])
        except Exception:
            pass
        return None

    def snap_to_edges(self, rooms, axis, cx, cy, tol=1.0):
        """an opening read off a wall box sits on the nearest room edge across the wall (the kit draws rooms to wall centrelines)"""
        edges = [e for r in rooms if r['kind'] not in ('frontPorch', 'rearPorch') for e in ((r['y'], r['y'] + r['d']) if axis == 'h' else (r['x'], r['x'] + r['w']))]
        v = cy if axis == 'h' else cx
        near = min(edges, key=lambda e: abs(e - v)) if edges else v
        if abs(near - v) <= tol:
            v = near
        return (cx, v) if axis == 'h' else (v, cy)

    def named_room(self, rooms, el, fallback):
        """the room an opening belongs to, when the export says so"""
        rid = self.pset_text(el, 'Room')
        return next((r for r in rooms if r['id'] == rid), fallback) if rid else fallback

    def is_external(self, w):
        for ps in E.get_psets(w).values():
            if 'IsExternal' in ps:
                return bool(ps['IsExternal'])
        return 'exterior' in (w.Name or '').lower() or 'ext' in ((getattr(w, 'ObjectType', '') or '')).lower()

    # ── rooms ──
    def rooms(self):
        out = []
        for sp in self.f.by_type('IfcSpace'):
            b = self.bbox(sp)
            if not b:
                continue
            name = sp.LongName if (sp.LongName and (not sp.Name or re.fullmatch(r'[\d.]+', sp.Name or ''))) else (sp.Name or sp.LongName or 'Room')
            kind = self.pset_text(sp, 'Reference')
            if kind not in KNOWN_KINDS:
                kind = kind_of(ROOM_KINDS, name, 'hall')
            w, d = b['x1'] - b['x0'], b['y1'] - b['y0']
            if w < 1.5 or d < 1.5:
                continue
            out.append({'ifc': sp.GlobalId, 'id': self.pset_text(sp, 'Id') or slug(name), 'kind': kind, 'name': name.strip(), 'x': b['x0'], 'y': b['y0'], 'w': w, 'd': d, 'plate': b['z1'] - b['z0'], 'cz': (b['z0'] + b['z1']) / 2})
        # porches: front (max y) or rear (min y) by position
        if out:
            ys = [r['y'] + r['d'] / 2 for r in out]
            mid = (min(ys) + max(ys)) / 2
            for r in out:
                if r['kind'] == 'porch':
                    r['kind'] = 'frontPorch' if r['y'] + r['d'] / 2 > mid else 'rearPorch'
        # unique ids
        seen = collections.Counter()
        for r in out:
            seen[r['id']] += 1
            if seen[r['id']] > 1:
                r['id'] = '%s-%d' % (r['id'], seen[r['id']])
        return out

    def room_at(self, rooms, x, y, pad=1.0):
        best, bd = None, 1e9
        for r in rooms:
            if r['kind'] in ('frontPorch', 'rearPorch'):
                continue
            inside = r['x'] - pad <= x <= r['x'] + r['w'] + pad and r['y'] - pad <= y <= r['y'] + r['d'] + pad
            if not inside:
                continue
            d = math.hypot(x - (r['x'] + r['w'] / 2), y - (r['y'] + r['d'] / 2))
            if d < bd:
                best, bd = r, d
        return best

    # ── walls ──
    def walls(self):
        out = []
        for w in self.f.by_type('IfcWall'):
            b = self.bbox(w)
            if not b:
                continue
            dx, dy = b['x1'] - b['x0'], b['y1'] - b['y0']
            axis = 'h' if dx >= dy else 'v'
            thick = (dy if axis == 'h' else dx) * 12
            out.append({'ifc': w.GlobalId, 'name': w.Name, 'axis': axis, 'x0': b['x0'], 'x1': b['x1'], 'y0': b['y0'], 'y1': b['y1'], 'thicknessIn': round(thick, 1), 'exterior': self.is_external(w), 'height': b['z1'] - b['z0'], 'type': (E.get_type(w).Name if E.get_type(w) else None)})
        return out

    # ── doors and windows ──
    def host_of(self, el):
        try:
            for rel in el.FillsVoids:
                op = rel.RelatingOpeningElement
                for rv in op.VoidsElements:
                    return rv.RelatingBuildingElement
        except Exception:
            pass
        return None

    def openings(self, rooms, walls):
        by_ifc = {w['ifc']: w for w in walls}
        doors, windows = [], []
        for d in self.f.by_type('IfcDoor'):
            b = self.bbox(d)
            if not b:
                continue
            host = self.host_of(d)
            hw = by_ifc.get(host.GlobalId) if host else None
            axis = hw['axis'] if hw else ('h' if b['x1'] - b['x0'] >= b['y1'] - b['y0'] else 'v')
            cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
            width = (d.OverallWidth * self.scale) if d.OverallWidth else ((b['x1'] - b['x0']) if axis == 'h' else (b['y1'] - b['y0']))
            op = str(getattr(d, 'OperationType', '') or '')
            pair = 'DOUBLE' in op or width > 4.5
            exterior = bool(hw and hw['exterior'])
            size = 'exteriorPair' if exterior and pair else 'exteriorSingle' if exterior else 'closet' if width <= 2.1 and not pair else 'interior' if width <= 2.6 else 'interiorWide' if width <= 2.8 else 'pantry'
            if pair and not exterior:
                size = 'closet'
            cx, cy = self.snap_to_edges(rooms, axis, cx, cy)
            room = self.room_at(rooms, cx, cy)
            room = self.named_room(rooms, d, room)
            # the swing side, hinge and a sliding leaf come from the DraftHouse_Opening set when the file carries it
            # (our own export does); else the operation type says sliding, and the leaf swings toward -y / -x
            swing_txt = self.pset_text(d, 'Swing')
            swing = int(float(swing_txt)) if swing_txt not in (None, '') else -1
            hinge_txt = self.pset_text(d, 'Hinge')
            hinge = hinge_txt if hinge_txt in ('start', 'end') else ('end' if 'LEFT' in op else None)
            pocket = self.pset_text(d, 'Pocket') == 'true' or 'SLIDING' in op
            barn = self.pset_text(d, 'Barn') == 'true'
            door = {'id': self.pset_text(d, 'Id') or 'd-' + slug(d.Name or (room['id'] if room else 'door')), 'room': room['id'] if room else None, 'axis': axis, 'x': cx, 'y': cy, 'w': width, 'swing': swing, 'hinge': hinge, 'pair': pair, 'exterior': exterior, 'size': size, 'ifcType': (E.get_type(d).Name if E.get_type(d) else d.Name)}
            if pocket:
                door['pocket'] = True
            if barn:
                door['barn'] = True
            doors.append(door)
        # cased openings: voids in walls with nothing in them, wider than a window
        filled = set(r.RelatingOpeningElement.GlobalId for r in self.f.by_type('IfcRelFillsElement'))
        for op in self.f.by_type('IfcOpeningElement'):
            if op.GlobalId in filled:
                continue
            b = self.bbox(op)
            if not b:
                continue
            host = None
            for rv in op.VoidsElements:
                host = rv.RelatingBuildingElement
            hw = by_ifc.get(host.GlobalId) if host else None
            if not hw:
                continue
            width = (b['x1'] - b['x0']) if hw['axis'] == 'h' else (b['y1'] - b['y0'])
            if width < 2.5 or b['z0'] > 1.0:
                continue
            cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
            cx, cy = self.snap_to_edges(rooms, hw['axis'], cx, cy)
            room = self.room_at(rooms, cx, cy)
            room = self.named_room(rooms, op, room)
            doors.append({'id': self.pset_text(op, 'Id') or 'o-' + slug(op.Name or (room['id'] if room else 'opening')), 'room': room['id'] if room else None, 'axis': hw['axis'], 'x': cx, 'y': cy, 'w': width, 'cased': True})
        marks = {}
        for w in self.f.by_type('IfcWindow'):
            b = self.bbox(w)
            if not b:
                continue
            host = self.host_of(w)
            hw = by_ifc.get(host.GlobalId) if host else None
            axis = hw['axis'] if hw else ('h' if b['x1'] - b['x0'] >= b['y1'] - b['y0'] else 'v')
            cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
            width = (w.OverallWidth * self.scale) if w.OverallWidth else ((b['x1'] - b['x0']) if axis == 'h' else (b['y1'] - b['y0']))
            height = (w.OverallHeight * self.scale) if w.OverallHeight else (b['z1'] - b['z0'])
            m = re.search(r'window\s+([A-Z])\b', w.Name or '', re.I)
            mark = m.group(1).upper() if m else None
            if not mark:
                key = (round(width * 12), round(height * 12))
                if key not in marks:
                    marks[key] = chr(ord('A') + len(marks))
                mark = marks[key]
            cx, cy = self.snap_to_edges(rooms, axis, cx, cy)
            room = self.room_at(rooms, cx, cy, pad=1.5)
            windows.append({'mark': mark, 'room': room['id'] if room else None, 'axis': axis, 'x': cx, 'y': cy, 'w': width, 'h': height, 'sill': b['z0'] - (self.level_z or 0), 'head': b['z1'] - (self.level_z or 0), 'ifcType': (E.get_type(w).Name if E.get_type(w) else w.Name)})
        return doors, windows

    # ── fixtures ──
    def fixtures(self, rooms):
        out = []
        seen = set()
        for cls in ['IfcFurnishingElement', 'IfcFlowTerminal', 'IfcElectricAppliance', 'IfcBuildingElementProxy']:
            for p in self.f.by_type(cls):
                if p.GlobalId in seen:
                    continue
                seen.add(p.GlobalId)
                b = self.bbox(p)
                if not b:
                    continue
                text = ' '.join(filter(None, [p.Name, getattr(p, 'ObjectType', None), str(getattr(p, 'PredefinedType', '') or ''), (E.get_type(p).Name if E.get_type(p) else '')]))
                k = self.pset_text(p, 'Kind') or kind_of(FIXTURE_KINDS, text)
                if not k:
                    continue
                cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
                room = self.room_at(rooms, cx, cy, pad=0.5)
                fx = {'k': k, 'room': room['id'] if room else None, 'x': b['x0'], 'y': b['y0'], 'w': b['x1'] - b['x0'], 'd': b['y1'] - b['y0'], 'h': b['z1'] - b['z0'], 'ifcType': (E.get_type(p).Name if E.get_type(p) else p.Name)}
                face = self.pset_text(p, 'Face')
                head = self.pset_text(p, 'Head')
                if face in ('n', 's', 'e', 'w'):
                    fx['face'] = face
                if head in ('n', 's', 'e', 'w'):
                    fx['head'] = head
                out.append(fx)
        return out

    # ── roof ──
    def roof(self, rooms):
        slabs = [s for s in self.f.by_type('IfcSlab') if str(s.PredefinedType) == 'ROOF'] + list(self.f.by_type('IfcRoof'))
        panels = []
        for s in slabs:
            v = self.verts(s)
            if v is None or len(v) < 3:
                continue
            xy = self.plan_xy(v)
            z = v[:, 2]
            # slope direction from the plane fit: which way does z rise?
            A = np.column_stack([xy, np.ones(len(xy))])
            try:
                coef, *_ = np.linalg.lstsq(A, z, rcond=None)
            except Exception:
                continue
            gx, gy = coef[0], coef[1]
            slope = math.hypot(gx, gy)
            if slope < 0.08:
                continue  # flat piece (fascia, cheek)
            direction = ('x+' if gx > 0 else 'x-') if abs(gx) > abs(gy) else ('y+' if gy > 0 else 'y-')
            panels.append({'name': s.Name, 'x0': xy[:, 0].min(), 'x1': xy[:, 0].max(), 'y0': xy[:, 1].min(), 'y1': xy[:, 1].max(), 'z0': z.min(), 'z1': z.max(), 'dir': direction, 'pitch': slope * 12})
        # pair opposite slopes that share a ridge (same axis, ridges at the same height and line)
        masses = []
        used = set()
        for i, a in enumerate(panels):
            if i in used:
                continue
            best = None
            for j, b in enumerate(panels):
                if j <= i or j in used or b['dir'][0] != a['dir'][0] or b['dir'] == a['dir']:
                    continue
                if abs(a['z1'] - b['z1']) > 1.0:
                    continue
                if a['dir'][0] == 'y':
                    ridge_a = a['y1'] if a['dir'] == 'y+' else a['y0']
                    ridge_b = b['y1'] if b['dir'] == 'y+' else b['y0']
                    overlap = min(a['x1'], b['x1']) - max(a['x0'], b['x0'])
                else:
                    ridge_a = a['x1'] if a['dir'] == 'x+' else a['x0']
                    ridge_b = b['x1'] if b['dir'] == 'x+' else b['x0']
                    overlap = min(a['y1'], b['y1']) - max(a['y0'], b['y0'])
                if abs(ridge_a - ridge_b) < 1.5 and overlap > 2:
                    score = abs(ridge_a - ridge_b) - overlap / 100
                    if best is None or score < best[0]:
                        best = (score, j)
            if best is None:
                continue
            j = best[1]
            used.update([i, j])
            b = panels[j]
            x0, x1 = min(a['x0'], b['x0']), max(a['x1'], b['x1'])
            y0, y1 = min(a['y0'], b['y0']), max(a['y1'], b['y1'])
            ridge = 'ew' if a['dir'][0] == 'y' else 'ns'
            plate = min(a['z0'], b['z0']) - (self.level_z or 0)
            masses.append({'kind': 'gable', 'x0': x0, 'x1': x1, 'y0': y0, 'y1': y1, 'ridge': ridge, 'ridgeAt': (ridge_a + ridge_b) / 2, 'ridgeZ': max(a['z1'], b['z1']), 'plate': plate, 'pitch': (a['pitch'] + b['pitch']) / 2, 'panels': [a['name'], b['name']]})
        # clipped pieces of one mass share the ridge line: merge them
        merged = []
        for m in sorted(masses, key=lambda m: (m['ridge'], m['ridgeAt'], m['x0'], m['y0'])):
            hit = None
            for g in merged:
                if g['ridge'] != m['ridge'] or abs(g['ridgeAt'] - m['ridgeAt']) > 1.0 or abs(g['ridgeZ'] - m['ridgeZ']) > 1.0:
                    continue
                along = (m['x0'] <= g['x1'] + 14 and m['x1'] >= g['x0'] - 14) if m['ridge'] == 'ew' else (m['y0'] <= g['y1'] + 14 and m['y1'] >= g['y0'] - 14)
                if along:
                    hit = g
                    break
            if hit:
                hit['x0'], hit['x1'] = min(hit['x0'], m['x0']), max(hit['x1'], m['x1'])
                hit['y0'], hit['y1'] = min(hit['y0'], m['y0']), max(hit['y1'], m['y1'])
                hit['plate'] = min(hit['plate'], m['plate'])
                hit['panels'] += m['panels']
            else:
                merged.append(dict(m))
        out = []
        for i, m in enumerate(merged):
            out.append({'id': 'm%d' % (i + 1), 'kind': 'gable', 'x0': m['x0'] + OVERHANG, 'x1': m['x1'] - OVERHANG, 'y0': m['y0'] + OVERHANG, 'y1': m['y1'] - OVERHANG, 'ridge': m['ridge'], 'plate': round(m['plate'], 2), 'pitch': round(m['pitch'], 1), 'ends': ['w', 'e'] if m['ridge'] == 'ew' else ['n', 's'], 'panels': m['panels']})
        unpaired = [p['name'] for i, p in enumerate(panels) if i not in used]
        return out, unpaired, len(panels)

    # ── open pairs: rooms that touch with no wall between ──
    def open_pairs(self, rooms, walls):
        pairs = []
        solid = [r for r in rooms if r['kind'] not in ('frontPorch', 'rearPorch')]
        def wall_covers(x, y):
            for w in walls:
                if w['x0'] - 0.3 <= x <= w['x1'] + 0.3 and w['y0'] - 0.3 <= y <= w['y1'] + 0.3:
                    return True
            return False
        for i, a in enumerate(solid):
            for b in solid[i + 1:]:
                # the two rooms' facing edges (each may carry the wall); a gap over 0.6 ft is not adjacency
                lines = []
                if abs((a['x'] + a['w']) - b['x']) < 0.6 or abs((b['x'] + b['w']) - a['x']) < 0.6:
                    y0, y1 = max(a['y'], b['y']), min(a['y'] + a['d'], b['y'] + b['d'])
                    if y1 - y0 < 3:
                        continue
                    xa, xb = (a['x'] + a['w'], b['x']) if abs((a['x'] + a['w']) - b['x']) < 0.6 else (a['x'], b['x'] + b['w'])
                    lines = [[(xa, y0 + (y1 - y0) * t) for t in np.linspace(0.1, 0.9, 9)], [(xb, y0 + (y1 - y0) * t) for t in np.linspace(0.1, 0.9, 9)]]
                elif abs((a['y'] + a['d']) - b['y']) < 0.6 or abs((b['y'] + b['d']) - a['y']) < 0.6:
                    x0, x1 = max(a['x'], b['x']), min(a['x'] + a['w'], b['x'] + b['w'])
                    if x1 - x0 < 3:
                        continue
                    ya, yb = (a['y'] + a['d'], b['y']) if abs((a['y'] + a['d']) - b['y']) < 0.6 else (a['y'], b['y'] + b['d'])
                    lines = [[(x0 + (x1 - x0) * t, ya) for t in np.linspace(0.1, 0.9, 9)], [(x0 + (x1 - x0) * t, yb) for t in np.linspace(0.1, 0.9, 9)]]
                else:
                    continue
                covered = max(sum(1 for p in pts if wall_covers(*p)) for pts in lines)
                if os.environ.get('KIT_DEBUG'):
                    self.log('  pair %s / %s: %d of 9 points on a wall' % (a['id'], b['id'], covered))
                # walls of the neighbouring rooms reach into the ends of a short shared edge; under half covered means open
                if covered < 5:
                    pairs.append([a['id'], b['id']])
        return pairs

    def read(self):
        storeys = self.f.by_type('IfcBuildingStorey')
        self.level_z = None
        self.straighten()
        rooms = self.rooms()
        if rooms:
            self.level_z = min(r['cz'] - r['plate'] / 2 for r in rooms)
            for r in rooms:
                r.pop('cz', None)
        walls = self.walls()
        doors, windows = self.openings(rooms, walls)
        fixtures = self.fixtures(rooms)
        masses, unpaired, npanels = self.roof(rooms)
        pairs = self.open_pairs(rooms, walls)
        return {'rooms': rooms, 'walls': walls, 'doors': doors, 'windows': windows, 'fixtures': fixtures, 'roof': masses, 'roofUnpaired': unpaired, 'roofPanels': npanels, 'open': pairs, 'storeys': [s.Name for s in storeys]}

# ── kit assembly ───────────────────────────────────────────────────────────
def r4(v):
    return round(float(v) * 4) / 4
def r2(v):
    return round(float(v), 2)

def build_kit(raw, kit_id, name, source):
    rooms = raw['rooms']
    xs = [r['x'] for r in rooms] + [r['x'] + r['w'] for r in rooms]
    ys = [r['y'] for r in rooms] + [r['y'] + r['d'] for r in rooms]
    x0, y0 = min(xs), min(ys)
    footprint = {'w': r2(max(xs) - x0), 'd': r2(max(ys) - y0)}
    plan_rooms = [{'id': r['id'], 'kind': r['kind'], 'name': r['name'], 'x': r4(r['x'] - x0), 'y': r4(r['y'] - y0), 'w': r4(r['w']), 'd': r4(r['d'])} for r in rooms]
    plates = {}
    for r in rooms:
        if r['kind'] not in ('frontPorch', 'rearPorch') and r['plate'] > 6:
            plates.setdefault(r['kind'], []).append(round(r['plate'] * 2) / 2)
    by_room = {k: max(set(v), key=v.count) for k, v in plates.items()}
    default_plate = max(set(sum(plates.values(), [])), key=sum(plates.values(), []).count) if plates else 9
    doors = []
    for d in raw['doors']:
        if not d.get('room'):
            continue
        e = {'id': d['id'], 'room': d['room'], 'axis': d['axis'], 'x': r2(d['x'] - x0), 'y': r2(d['y'] - y0), 'w': r2(d['w'])}
        if d.get('cased'):
            e['cased'] = True
        else:
            e.update({'swing': d['swing'], 'size': d['size']})
            if d.get('hinge'):
                e['hinge'] = d['hinge']
            if d.get('pair'):
                e['pair'] = True
            if d.get('exterior'):
                e['exterior'] = True
            if d.get('pocket'):
                e['pocket'] = True
            if d.get('barn'):
                e['barn'] = True
        doors.append(e)
    windows = [{'mark': w['mark'], 'room': w['room'], 'axis': w['axis'], 'x': r2(w['x'] - x0), 'y': r2(w['y'] - y0), 'w': r2(w['w']), 'sill': r2(w['sill']), 'head': r2(w['head'])} for w in raw['windows'] if w.get('room')]
    fixtures = [dict({'k': f['k'], 'room': f['room'], 'x': r2(f['x'] - x0), 'y': r2(f['y'] - y0), 'w': r2(f['w']), 'd': r2(f['d'])}, **{k: f[k] for k in ('face', 'head') if f.get(k)}) for f in raw['fixtures'] if f.get('room')]
    roof = [{'id': m['id'], 'kind': 'gable', 'x0': r2(m['x0'] - x0), 'x1': r2(m['x1'] - x0), 'y0': r2(m['y0'] - y0), 'y1': r2(m['y1'] - y0), 'ridge': m['ridge'], 'plate': m['plate'], 'pitch': m['pitch'], 'ends': m['ends']} for m in raw['roof']]
    wall_types = sorted(set(w['type'] for w in raw['walls'] if w.get('type')))
    thick = collections.Counter((round(w['thicknessIn']), w['exterior']) for w in raw['walls'])
    cond = [r for r in plan_rooms if r['kind'] not in ('frontPorch', 'rearPorch', 'garage')]
    living = sum(r['w'] * r['d'] for r in cond)
    kinds = collections.Counter(r['kind'] for r in plan_rooms)
    garage = next((r for r in plan_rooms if r['kind'] == 'garage'), None)
    program = {
        'beds': kinds['bed'] + kinds['master'], 'baths': kinds['bath'] + kinds['mbath'] + kinds['jackjill'], 'halfBath': kinds['halfbath'] > 0,
        'suite2': kinds['suite2'] > 0, 'office': kinds['office'] > 0, 'garage': int(round(garage['w'] / 11)) if garage else 0, 'stories': 1,
        'sqft': int(round(living / 50.0) * 50), 'frontPorch': kinds['frontPorch'] > 0, 'rearPorch': kinds['rearPorch'] > 0,
    }
    return {
        'id': kit_id, 'name': name, 'generated': True,
        'source': source,
        'plan': {'footprint': footprint, 'facing': 'street', 'rooms': plan_rooms, 'roof': roof, 'open': raw['open'], 'doors': doors, 'windows': windows, 'fixtures': fixtures},
        'plates': {'default': default_plate, 'byRoom': by_room},
        'wallsSeen': {'types': wall_types, 'thicknessIn': [{'in': k[0], 'exterior': k[1], 'count': n} for k, n in sorted(thick.items())]},
        'reference': {'program': program, 'livingSf': int(round(living)), 'footprint': footprint},
        'stats': {'rooms': len(plan_rooms), 'walls': len(raw['walls']), 'doors': len(doors), 'cased': sum(1 for d in doors if d.get('cased')), 'windows': len(windows), 'fixtures': len(fixtures), 'roofMasses': len(roof), 'roofPanels': raw['roofPanels'], 'roofUnpaired': raw['roofUnpaired'], 'open': len(raw['open']), 'storeys': raw['storeys']},
    }

JS_TEMPLATE = """// %(name)s kit, generated by scripts/kit-from-ifc.py from %(file)s on %(date)s.
// Do not edit by hand: re-run the script on a new export. Room templates, rules, sheets and
// finish schedules come from the base kit; everything in `plan` came off this export.
import { KIT as BASE } from './modern-farmhouse.js'

const PLAN = %(json)s

export const KIT = {
  ...BASE,
  id: PLAN.id,
  name: PLAN.name,
  generated: true,
  source: PLAN.source,
  plates: { ...BASE.plates, default: PLAN.plates.default, byRoom: { ...BASE.plates.byRoom, ...PLAN.plates.byRoom } },
  plan: PLAN.plan,
  reference: PLAN.reference,
  stats: PLAN.stats,
  wallsSeen: PLAN.wallsSeen,
}
export default KIT
"""

def write_kit(kit, out_dir, src_file):
    js = JS_TEMPLATE % {'name': kit['name'], 'file': os.path.basename(src_file), 'date': datetime.date.today().isoformat(), 'json': json.dumps(kit, indent=2)}
    path = os.path.join(out_dir, '%s.ifc.js' % kit['id'])
    open(path, 'w', encoding='utf-8').write(js)
    return path

def write_registry(out_dir):
    """src/kits/generated.js: every *.ifc.js kit, by id."""
    ids = sorted(f[:-7] for f in os.listdir(out_dir) if f.endswith('.ifc.js'))
    lines = ['// Generated kits, one per IFC export converted by scripts/kit-from-ifc.py. Rewritten by that script.']
    for i in ids:
        lines.append("import { KIT as K_%s } from './%s.ifc.js'" % (i.replace('-', '_'), i))
    lines.append('export const GENERATED = { %s }' % ', '.join("'%s': K_%s" % (i, i.replace('-', '_')) for i in ids))
    lines.append('export default GENERATED')
    open(os.path.join(out_dir, 'generated.js'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    return ids

# ── round-trip comparison against a traced kit (a JS module: the plan is read with node) ──
def load_js_kit(path):
    import subprocess
    code = "import('%s').then(m => console.log(JSON.stringify(m.KIT || m.default)))" % os.path.abspath(path).replace('\\', '/')
    out = subprocess.run(['node', '-e', code], capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(path)))
    if out.returncode != 0:
        raise RuntimeError(out.stderr)
    return json.loads(out.stdout)

def scaled_plan(gp, k):
    import copy
    p = copy.deepcopy(gp)
    for r in p['rooms']:
        r['x'] *= k; r['y'] *= k; r['w'] *= k; r['d'] *= k
    for d in p['doors']:
        d['x'] *= k; d['y'] *= k; d['w'] *= k
    for w in p['windows']:
        w['x'] *= k; w['y'] *= k; w['w'] *= k
    for f in p['fixtures']:
        f['x'] *= k; f['y'] *= k; f['w'] *= k; f['d'] *= k
    for m in p['roof']:
        for key in ('x0', 'x1', 'y0', 'y1'):
            if key in m:
                m[key] *= k
    p['footprint'] = {'w': p['footprint']['w'] * k, 'd': p['footprint']['d'] * k}
    return p

def shifted_plan(tp, dx, dy):
    import copy
    p = copy.deepcopy(tp)
    for r in p['rooms']:
        r['x'] -= dx; r['y'] -= dy
    for d in p['doors']:
        d['x'] -= dx; d['y'] -= dy
    for w in p['windows']:
        w['x'] -= dx; w['y'] -= dy
    for f in p['fixtures']:
        f['x'] -= dx; f['y'] -= dy
    for m in p['roof']:
        for key, d in (('x0', dx), ('x1', dx), ('y0', dy), ('y1', dy)):
            if key in m:
                m[key] -= d
    return p

def rooms_bbox(rooms):
    xs = [r['x'] for r in rooms] + [r['x'] + r['w'] for r in rooms]
    ys = [r['y'] for r in rooms] + [r['y'] + r['d'] for r in rooms]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

def compare(kit, traced, log=print):
    # both plans at the rooms' rear-left corner; the export may be a plan scaled to a square footage
    tx0, ty0, tw, td = rooms_bbox(traced['plan']['rooms'])
    tp = shifted_plan(traced['plan'], tx0, ty0)
    tp['footprint'] = {'w': tw, 'd': td}
    gx0, gy0, gw, gd = rooms_bbox(kit['plan']['rooms'])
    k = math.sqrt((tw * td) / (gw * gd))
    gp = scaled_plan(kit['plan'], k)
    gp['footprint'] = {'w': gw * k, 'd': gd * k}
    report = {'ok': True, 'lines': [], 'scale': k}
    report['lines'].append('  traced rooms start at (%.2f, %.2f) in the kit; scale between the export and the traced plan: %.3f' % (tx0, ty0, k))
    def line(s, bad=False):
        report['lines'].append(('  ' if not bad else '! ') + s)
        if bad:
            report['ok'] = False
    line('rooms bounding box traced %.1fx%.1f, read %.1fx%.1f' % (tp['footprint']['w'], tp['footprint']['d'], gp['footprint']['w'], gp['footprint']['d']), abs(tp['footprint']['w'] - gp['footprint']['w']) > 1 or abs(tp['footprint']['d'] - gp['footprint']['d']) > 1)
    line('rooms traced %d, read %d' % (len(tp['rooms']), len(gp['rooms'])), len(tp['rooms']) != len(gp['rooms']))
    # match rooms by nearest centre
    off = []
    kinds_wrong = []
    for r in tp['rooms']:
        cx, cy = r['x'] + r['w'] / 2, r['y'] + r['d'] / 2
        best = min(gp['rooms'], key=lambda g: math.hypot(g['x'] + g['w'] / 2 - cx, g['y'] + g['d'] / 2 - cy))
        dpos = math.hypot(best['x'] + best['w'] / 2 - cx, best['y'] + best['d'] / 2 - cy)
        dsize = max(abs(best['w'] - r['w']), abs(best['d'] - r['d']))
        if dpos > 0.6 or dsize > 0.6:
            off.append('%s (%.1f ft off, size %.1f)' % (r['name'], dpos, dsize))
        if best['kind'] != r['kind']:
            kinds_wrong.append('%s: traced %s, read %s' % (r['name'], r['kind'], best['kind']))
    line('rooms within 0.6 ft in place and size: %d of %d%s' % (len(tp['rooms']) - len(off), len(tp['rooms']), ('; off: ' + ', '.join(off)) if off else ''), len(off) > 0)
    line('room kinds: %d differ%s' % (len(kinds_wrong), ('; ' + '; '.join(kinds_wrong)) if kinds_wrong else ''), len(kinds_wrong) > 2)
    tdoors = [d for d in tp['doors']]
    line('doors traced %d (%d cased), read %d (%d cased)' % (len(tdoors), sum(1 for d in tdoors if d.get('cased')), len(gp['doors']), sum(1 for d in gp['doors'] if d.get('cased'))), abs(len(tdoors) - len(gp['doors'])) > 2)
    far = 0
    for d in tdoors:
        best = min(gp['doors'], key=lambda g: math.hypot(g['x'] - d['x'], g['y'] - d['y']))
        if math.hypot(best['x'] - d['x'], best['y'] - d['y']) > 0.75 or best['axis'] != d['axis']:
            far += 1
    line('doors within 0.75 ft and on the same axis: %d of %d' % (len(tdoors) - far, len(tdoors)), far > 2)
    line('windows traced %d, read %d' % (len(tp['windows']), len(gp['windows'])), len(tp['windows']) != len(gp['windows']))
    wm = 0
    for w in tp['windows']:
        best = min(gp['windows'], key=lambda g: math.hypot(g['x'] - w['x'], g['y'] - w['y']))
        if math.hypot(best['x'] - w['x'], best['y'] - w['y']) < 0.75 and best['mark'] == w['mark']:
            wm += 1
    line('windows in place with the same mark: %d of %d' % (wm, len(tp['windows'])), wm < len(tp['windows']) - 2)
    line('fixtures traced %d, read %d' % (len(tp['fixtures']), len(gp['fixtures'])), abs(len(tp['fixtures']) - len(gp['fixtures'])) > 3)
    fk = collections.Counter(f['k'] for f in tp['fixtures'])
    gk = collections.Counter(f['k'] for f in gp['fixtures'])
    diffk = {k: (fk[k], gk[k]) for k in set(fk) | set(gk) if fk[k] != gk[k]}
    line('fixture kinds that differ: %s' % (diffk or 'none'), len(diffk) > 3)
    tg = [m for m in tp['roof'] if m.get('kind') == 'gable']
    line('roof masses traced %d gable, read %d from %d sloped panels (%d unpaired)' % (len(tg), len(gp['roof']), kit['stats']['roofPanels'], len(kit['stats']['roofUnpaired'])), len(gp['roof']) < len(tg) * 0.6)
    # pairs compared through the room match (the converter names rooms from the export, not with the traced ids)
    def centre(r):
        return (r['x'] + r['w'] / 2, r['y'] + r['d'] / 2)
    gid_to_tid = {}
    for g in gp['rooms']:
        t = min(tp['rooms'], key=lambda r: math.hypot(centre(r)[0] - centre(g)[0], centre(r)[1] - centre(g)[1]))
        gid_to_tid[g['id']] = t['id']
    tpairs = set(tuple(sorted(p)) for p in tp.get('open', []))
    gpairs = set(tuple(sorted(gid_to_tid.get(x, x) for x in p)) for p in gp['open'])
    line('open pairs traced %d, read %d; missing %s; extra %s' % (len(tpairs), len(gpairs), sorted(tpairs - gpairs) or 'none', sorted(gpairs - tpairs) or 'none'), len(tpairs - gpairs) > 1 or len(gpairs - tpairs) > 3)
    line('plates: read default %s, by room %s' % (kit['plates']['default'], kit['plates']['byRoom']))
    line('program traced %s' % json.dumps(traced['reference']['program']))
    line('program read   %s' % json.dumps(kit['reference']['program']))
    line('living sf traced %s, read %s' % (traced['reference'].get('livingSf'), kit['reference']['livingSf']))
    return report

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('ifc')
    ap.add_argument('--id', default=None, help='style id (modern, spanish, hillcountry, ranch, craftsman, transitional, tuscan, midcentury, coastal)')
    ap.add_argument('--name', default=None)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'kits'))
    ap.add_argument('--json', action='store_true', help='print the kit JSON to stdout instead of writing the module')
    ap.add_argument('--compare', default=None, help='a traced kit module to compare against (round-trip report)')
    ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()
    log = (lambda *x: None) if a.quiet or a.json else print
    rd = Reader(a.ifc, log=log)
    raw = rd.read()
    kit_id = a.id or re.sub(r'[^a-z0-9]+', '', os.path.splitext(os.path.basename(a.ifc))[0].lower())
    name = a.name or kit_id.title()
    try:
        exported_with = rd.f.header.file_name.originating_system
    except Exception:
        exported_with = None
    kit = build_kit(raw, kit_id, name, {'file': os.path.basename(a.ifc), 'exportedWith': exported_with, 'schema': rd.f.schema, 'convertedAt': datetime.datetime.now().isoformat(timespec='seconds')})
    if a.compare:
        traced = load_js_kit(a.compare)
        rep = compare(kit, traced, log)
        if a.json:
            print(json.dumps({'kit': kit, 'compare': rep}, indent=2))
        else:
            print('ROUND TRIP %s' % ('OK' if rep['ok'] else 'DIFFERS'))
            for l in rep['lines']:
                print(l)
        return 0 if rep['ok'] else 1
    if a.json:
        print(json.dumps(kit, indent=2))
        return 0
    os.makedirs(a.out, exist_ok=True)
    path = write_kit(kit, a.out, a.ifc)
    ids = write_registry(a.out)
    s = kit['stats']
    log('wrote %s: %d rooms, %d doors (%d cased), %d windows, %d fixtures, %d roof masses from %d panels, %d open pairs' % (path, s['rooms'], s['doors'], s['cased'], s['windows'], s['fixtures'], s['roofMasses'], s['roofPanels'], s['open']))
    log('registry: %s' % ', '.join(ids))
    return 0

if __name__ == '__main__':
    sys.exit(main())
