# -*- coding: utf-8 -*-
"""
Builds a Revit model from a Draft House design file. Runs inside Revit through
`pyrevit run build_model.py <template.rte> --revit=2024`, so `revit.doc` is the
template already open. Reads DH_DESIGN (the design JSON), writes model.rvt,
sheets.pdf, model.ifc and report.json into DH_OUT.

Name mapping: worker/kit.revit.json maps the kit's names (as they appear in the
design: wall types, door and window families, fixtures, floor and roof types,
title block) to the names in the office template. Every name that is not found
falls back to the template default and is listed in report.json under
"fallbacks" so the drafter can fill the mapping in.

Still to be proven on a live Revit: written from the Revit API reference and
corrected by review; the office machine runs it for the first time with a
drafter watching (docs/OFFICE-CHECKLIST.md). Every step logs DH_PROGRESS lines
the worker relays to the dashboard, and every failure is caught per element so
one bad family never stops the build.
"""
import os, sys, json, math, traceback
from pyrevit import revit, DB
from System.Collections.Generic import List

doc = revit.doc
DESIGN = json.load(open(os.environ['DH_DESIGN']))
OUT = os.environ['DH_OUT']
JOB = os.environ.get('DH_JOB', '')
HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.environ.get('DH_MAP') or os.path.join(HERE, '..', 'kit.revit.json')
MAP = json.load(open(MAP_PATH)) if os.path.exists(MAP_PATH) else {}
report = {'ok': False, 'warnings': [], 'fallbacks': [], 'counts': {}, 'revit': None, 'mapping': MAP_PATH if os.path.exists(MAP_PATH) else None}

try:
    report['revit'] = revit.HOST_APP.version
except Exception:
    pass

def progress(pct, step, msg):
    print('DH_PROGRESS %d %s %s' % (pct, step, msg))
    sys.stdout.flush()

def warn(msg):
    report['warnings'].append(msg)
    print('WARN ' + msg)

def fallback(kind, wanted, used):
    rec = {'kind': kind, 'wanted': wanted, 'used': used}
    if rec not in report['fallbacks']:
        report['fallbacks'].append(rec)
        warn('name fallback: %s "%s" is not in the template, used "%s"' % (kind, wanted, used))

def mapped(kind, name):
    """The template name for a kit name, from kit.revit.json; the kit name itself when unmapped."""
    if not name:
        return name
    m = MAP.get(kind) or {}
    return m.get(name) or name

def xyz(x, z, y=0.0):
    # design: x along the front, z toward the street, y up  ->  Revit: X east, Y north, Z up
    return DB.XYZ(float(x), -float(z), float(y))

def ename(e):
    try:
        return DB.Element.Name.GetValue(e)
    except Exception:
        return getattr(e, 'Name', '') or ''

def by_name(cls, kind, name, fallback_first=True):
    """An element type by 'Family : Type' or by type name; the first of its class when missing."""
    want = mapped(kind, name)
    col = list(DB.FilteredElementCollector(doc).OfClass(cls).WhereElementIsElementType())
    first = col[0] if col else None
    for t in col:
        tn = ename(t)
        fam = getattr(t, 'FamilyName', '') or ''
        if want and (tn == want or ('%s : %s' % (fam, tn)) == want):
            return t
    if want:
        fallback(kind, want, ename(first) if first else 'none')
    return first if fallback_first else None

def family_symbol(kind, name, category=None):
    """A loadable family type by 'Family : Type' (or family name alone). None when missing."""
    want = mapped(kind, name)
    if not want:
        return None
    fam_name, _, type_name = [p.strip() for p in want.partition(':')]
    col = DB.FilteredElementCollector(doc).OfClass(DB.FamilySymbol)
    if category is not None:
        col = col.OfCategory(category)
    first = None
    for s in col:
        first = first or s
        if s.FamilyName == fam_name and (not type_name or ename(s) == type_name):
            if not s.IsActive:
                s.Activate()
                doc.Regenerate()
            return s
    if first is not None:
        if not first.IsActive:
            first.Activate()
            doc.Regenerate()
        fallback(kind, want, '%s : %s' % (first.FamilyName, ename(first)))
        return first
    fallback(kind, want, 'none (no family of that category loaded)')
    return None

def level(name='Level 1'):
    levels = list(DB.FilteredElementCollector(doc).OfClass(DB.Level))
    for l in levels:
        if l.Name == name:
            return l
    if levels:
        warn('no level named %s, using %s' % (name, levels[0].Name))
    return levels[0]

def with_out_param(fn, *args):
    """IronPython returns `out` parameters in a tuple when they are omitted; some builds want them passed."""
    try:
        res = fn(*args)
        if isinstance(res, tuple):
            return res[0], res[1]
        return res, None
    except TypeError:
        holder = DB.ModelCurveArray()
        res = fn(*(args + (holder,)))
        if isinstance(res, tuple):
            return res[0], res[1]
        return res, holder

def main():
    lvl = level((DESIGN.get('levels') or [{}])[0].get('name', 'Level 1'))
    created = {'walls': 0, 'doors': 0, 'windows': 0, 'rooms': 0, 'floors': 0, 'fixtures': 0, 'roofs': 0, 'sheets': 0}
    wall_elems = []
    wall_type_cache = {}

    # ── walls ────────────────────────────────────────────────────────────────
    with revit.Transaction('Draft House: walls'):
        progress(15, 'walls', 'placing %d walls' % len(DESIGN['walls']))
        for w in DESIGN['walls']:
            key = w.get('revitType')
            if key not in wall_type_cache:
                wall_type_cache[key] = by_name(DB.WallType, 'wallTypes', key)
            wt = wall_type_cache[key]
            a = xyz(w['a'][0], w['a'][1]); b = xyz(w['b'][0], w['b'][1])
            if a.DistanceTo(b) < 0.3:
                continue
            try:
                line = DB.Line.CreateBound(a, b)
                height = float(w['plate']) - float(w.get('base', 0))
                wall = DB.Wall.Create(doc, line, wt.Id, lvl.Id, height, float(w.get('base', 0)), False, False)
                wall_elems.append((wall, w))
                created['walls'] += 1
            except Exception as e:
                warn('wall %s: %s' % (w['id'], e))
        doc.Regenerate()

    def host_for(x, z, tol=1.5):
        p = xyz(x, z)
        best, bd = None, tol
        for wall, w in wall_elems:
            try:
                d = wall.Location.Curve.Distance(p)
            except Exception:
                continue
            if d < bd:
                best, bd = wall, d
        return best

    # ── doors and windows ────────────────────────────────────────────────────
    with revit.Transaction('Draft House: openings'):
        progress(35, 'doors', 'placing %d doors and %d windows' % (len(DESIGN['doors']), len(DESIGN['windows'])))
        for d in DESIGN['doors']:
            if d.get('cased'):
                continue  # cased openings are left to the drafter (an opening family varies by template)
            sym = family_symbol('doors', d.get('revitFamily'), DB.BuiltInCategory.OST_Doors)
            host = host_for(d['x'], d['z'])
            if not sym or not host:
                warn('door %s skipped (%s)' % (d['id'], 'no door family loaded' if not sym else 'no host wall within 1.5 ft'))
                continue
            try:
                inst = doc.Create.NewFamilyInstance(xyz(d['x'], d['z']), sym, host, lvl, DB.Structure.StructuralType.NonStructural)
                # the kit's swing: -1 opens toward -z (away from the street); Revit flips hand and facing on the instance
                if d.get('swing') == 1 and inst.CanFlipFacing:
                    inst.flipFacing()
                if d.get('hinge') == 'end' and inst.CanFlipHand:
                    inst.flipHand()
                created['doors'] += 1
            except Exception as e:
                warn('door %s: %s' % (d['id'], e))
        for win in DESIGN['windows']:
            if win.get('dormer'):
                continue
            sym = family_symbol('windows', win.get('revitFamily'), DB.BuiltInCategory.OST_Windows)
            host = host_for(win['x'], win['z'])
            if not sym or not host:
                warn('window %s skipped (%s)' % (win['id'], 'no window family loaded' if not sym else 'no host wall within 1.5 ft'))
                continue
            try:
                inst = doc.Create.NewFamilyInstance(xyz(win['x'], win['z'], float(win['sill'])), sym, host, lvl, DB.Structure.StructuralType.NonStructural)
                p = inst.get_Parameter(DB.BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
                if p and not p.IsReadOnly:
                    p.Set(float(win['sill']))
                created['windows'] += 1
            except Exception as e:
                warn('window %s: %s' % (win['id'], e))

    # ── slab and rooms ───────────────────────────────────────────────────────
    with revit.Transaction('Draft House: slab and rooms'):
        progress(50, 'rooms', 'slab and rooms')
        rings = DESIGN.get('footprints') or ([DESIGN['footprint']] if DESIGN.get('footprint') else [])
        rings = [r for r in rings if len(r) >= 3]
        if rings:
            ft = by_name(DB.FloorType, 'floorType', (DESIGN.get('revit') or {}).get('floorType'))
        for ri, fp in enumerate(rings):
            try:
                loop = DB.CurveLoop()
                pts = [xyz(p[0], p[1]) for p in fp]
                if pts[0].DistanceTo(pts[-1]) < 0.01:
                    pts = pts[:-1]
                for i in range(len(pts)):
                    a, b = pts[i], pts[(i + 1) % len(pts)]
                    if a.DistanceTo(b) > 0.01:
                        loop.Append(DB.Line.CreateBound(a, b))
                loops = List[DB.CurveLoop]([loop])
                if hasattr(DB.Floor, 'Create'):
                    DB.Floor.Create(doc, loops, ft.Id, lvl.Id)  # Revit 2022+
                else:
                    arr = DB.CurveArray()
                    for c in loop:
                        arr.Append(c)
                    doc.Create.NewFloor(arr, ft, lvl, False)
                created['floors'] += 1
            except Exception as e:
                warn('slab %d: %s' % (ri + 1, e))
        if not rings:
            warn('no footprint in the design, no slab placed')
        doc.Regenerate()
        for r in DESIGN['rooms']:
            if r.get('open'):
                continue
            try:
                room = doc.Create.NewRoom(lvl, DB.UV(float(r['x']), -float(r['z'])))
                room.Name = r['name']
                created['rooms'] += 1
            except Exception as e:
                warn('room %s: %s' % (r['name'], e))

    # ── fixtures ─────────────────────────────────────────────────────────────
    with revit.Transaction('Draft House: fixtures'):
        progress(60, 'fixtures', 'placing %d fixtures and cabinets' % len(DESIGN['fixtures']))
        for f in DESIGN['fixtures']:
            sym = family_symbol('fixtures', f.get('revitFamily'))
            if not sym:
                continue
            try:
                inst = doc.Create.NewFamilyInstance(xyz(f['x'], f['z']), sym, lvl, DB.Structure.StructuralType.NonStructural)
                # a fixture drawn deeper than wide sits turned a quarter
                if float(f.get('d', 0)) > float(f.get('w', 0)) * 1.3:
                    axis = DB.Line.CreateBound(xyz(f['x'], f['z']), xyz(f['x'], f['z'], 1.0))
                    DB.ElementTransformUtils.RotateElement(doc, inst.Id, axis, math.pi / 2)
                created['fixtures'] += 1
            except Exception as e:
                warn('fixture %s: %s' % (f['name'], e))

    # ── roof: one footprint roof per gable mass, slopes on the eaves ─────────
    with revit.Transaction('Draft House: roof'):
        roof = DESIGN.get('roof') or {}
        masses = [m for m in roof.get('masses', []) if m.get('kind') == 'gable']
        progress(70, 'roof', 'placing %d roof masses' % len(masses))
        slope_units = (MAP.get('roofSlopeUnits') or 'ratio')  # 'ratio' (rise over run) or 'radians'; see the checklist
        cx, cy = (roof.get('centre') or [0, 0])
        k = float(roof.get('scale') or 1)
        oh = float(roof.get('overhang') or 1.33)
        pitch_in = float(roof.get('pitch') or 10)
        rt = by_name(DB.RoofType, 'roofTypes', ((DESIGN.get('revit') or {}).get('roofTypes') or {}).get('shingles'))
        for m in masses:
            try:
                # mass boxes are in plan feet about the plan centre; the frame is x = (x - cx) * k, z = (y - cy) * k
                x0, x1 = (m['x0'] - cx) * k - oh, (m['x1'] - cx) * k + oh
                z0, z1 = (m['y0'] - cy) * k - oh, (m['y1'] - cy) * k + oh
                pts = [xyz(x0, z0), xyz(x1, z0), xyz(x1, z1), xyz(x0, z1)]
                arr = DB.CurveArray()
                for i in range(4):
                    arr.Append(DB.Line.CreateBound(pts[i], pts[(i + 1) % 4]))
                fproof, mapping = with_out_param(doc.Create.NewFootPrintRoof, arr, lvl, rt)
                ew = m.get('ridge') == 'ew'
                slope = pitch_in / 12.0 if slope_units == 'ratio' else math.atan(pitch_in / 12.0)
                if mapping is not None:
                    for i, mc in enumerate(mapping):
                        # the eaves (slope defining) are the sides parallel to the ridge: pts 0-1 and 2-3 run along x
                        is_eave = (i in (0, 2)) if ew else (i in (1, 3))
                        fproof.set_DefinesSlope(mc, is_eave)
                        if is_eave:
                            fproof.set_SlopeAngle(mc, slope)
                else:
                    warn('roof %s: no edge mapping returned, roof placed flat' % m.get('id'))
                p = fproof.get_Parameter(DB.BuiltInParameter.ROOF_LEVEL_OFFSET_PARAM)
                if p and not p.IsReadOnly:
                    p.Set(float(m.get('plate', 9)))
                created['roofs'] += 1
            except Exception as e:
                warn('roof %s: %s' % (m.get('id'), e))
        if masses:
            try:
                doc.Regenerate()
                sp = None
                for r in DB.FilteredElementCollector(doc).OfClass(DB.FootPrintRoof):
                    sp = r.get_Parameter(DB.BuiltInParameter.ROOF_SLOPE)
                    break
                if sp:
                    report['roofSlopeRead'] = sp.AsValueString()
                    warn('roof slope reads %s in the model; expected %s/12. If it is wrong, set roofSlopeUnits in kit.revit.json to the other value.' % (sp.AsValueString(), int(pitch_in)))
            except Exception:
                pass

    # ── sheets ───────────────────────────────────────────────────────────────
    with revit.Transaction('Draft House: sheets'):
        progress(80, 'sheets', 'sheet set')
        tb = family_symbol('titleBlock', (DESIGN.get('revit') or {}).get('titleBlockFamily'), DB.BuiltInCategory.OST_TitleBlocks)
        plan_view = None
        for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewPlan):
            if not v.IsTemplate and v.ViewType == DB.ViewType.FloorPlan and v.GenLevel is not None and v.GenLevel.Id == lvl.Id:
                plan_view = v
                break
        for s in DESIGN.get('sheets', []):
            try:
                sheet = DB.ViewSheet.Create(doc, tb.Id if tb else DB.ElementId.InvalidElementId)
                sheet.SheetNumber = str(s['no'])
                sheet.Name = s['title']
                if str(s['no']) == '200' and plan_view and DB.Viewport.CanAddViewToSheet(doc, sheet.Id, plan_view.Id):
                    DB.Viewport.Create(doc, sheet.Id, plan_view.Id, DB.XYZ(1.3, 1.0, 0))
                created['sheets'] += 1
            except Exception as e:
                warn('sheet %s: %s' % (s.get('no'), e))
        tbt = DESIGN.get('titleBlock') or {}
        try:
            pi = doc.ProjectInformation
            pi.ClientName = DESIGN.get('client') or ''
            pi.Address = (DESIGN.get('lot') or {}).get('address') or ''
            pi.Name = '%s - %s' % (DESIGN.get('client') or 'Draft House', (DESIGN.get('style') or {}).get('name') or '')
            pi.Number = JOB
        except Exception as e:
            warn('project information: %s' % e)

    # ── save and export ──────────────────────────────────────────────────────
    progress(88, 'save', 'saving model')
    out_rvt = os.path.join(OUT, 'model.rvt')
    opts = DB.SaveAsOptions()
    opts.OverwriteExistingFile = True
    doc.SaveAs(out_rvt, opts)
    try:
        progress(92, 'export', 'exporting IFC')
        ifc = DB.IFCExportOptions()
        ifc.FileVersion = DB.IFCVersion.IFC4
        doc.Export(OUT, 'model', ifc)
        if os.path.exists(os.path.join(OUT, 'model.ifc')) is False and os.path.exists(os.path.join(OUT, 'model.ifc.ifc')):
            os.rename(os.path.join(OUT, 'model.ifc.ifc'), os.path.join(OUT, 'model.ifc'))
    except Exception as e:
        warn('ifc export: %s' % e)
    try:
        progress(96, 'export', 'exporting PDF')
        sheets = [s.Id for s in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet) if not s.IsPlaceholder]
        if hasattr(DB, 'PDFExportOptions') and sheets:
            po = DB.PDFExportOptions()
            po.Combine = True
            po.FileName = 'sheets'
            ids = List[DB.ElementId](sheets)
            doc.Export(OUT, ids, po)
        elif not sheets:
            warn('no sheets to print')
        else:
            warn('this Revit has no PDFExportOptions (2022+); print the sheets by hand')
    except Exception as e:
        warn('pdf export: %s' % e)
    report['counts'] = created
    report['outputs'] = [n for n in ['model.rvt', 'sheets.pdf', 'model.ifc'] if os.path.exists(os.path.join(OUT, n))]
    report['ok'] = True

try:
    if DESIGN.get('contract') != 1:
        raise RuntimeError('design contract %s is not 1' % DESIGN.get('contract'))
    main()
except Exception as e:
    report['error'] = str(e)
    report['trace'] = traceback.format_exc()
finally:
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=2)
    progress(100, 'done', 'ok' if report['ok'] else ('failed: ' + str(report.get('error'))))
