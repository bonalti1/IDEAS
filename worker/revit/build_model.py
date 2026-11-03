# -*- coding: utf-8 -*-
"""
Builds a Revit model from a Draft House design file. Runs inside Revit through
`pyrevit run build_model.py <template.rte> --revit=2024`, so `revit.doc` is the
template already open. Reads DH_DESIGN (the design JSON), writes model.rvt,
sheets.pdf, model.ifc and report.json into DH_OUT.

UNTESTED against a live Revit as of this commit: written from the Revit API
reference, to be run on the office machine for the first time with a drafter
watching. Every step logs DH_PROGRESS lines the worker relays to the dashboard.
"""
import os, sys, json, math, traceback
from pyrevit import revit, DB

doc = revit.doc
DESIGN = json.load(open(os.environ['DH_DESIGN']))
OUT = os.environ['DH_OUT']
JOB = os.environ.get('DH_JOB', '')
report = {'ok': False, 'warnings': [], 'counts': {}}
FT = 1.0  # Revit internal units are feet; the design is in feet

def progress(pct, step, msg):
    print('DH_PROGRESS %d %s %s' % (pct, step, msg))
    sys.stdout.flush()

def warn(msg):
    report['warnings'].append(msg)
    print('WARN ' + msg)

def xyz(x, z, y=0.0):
    # design: x along the front, z toward the street, y up  →  Revit: X east, Y north, Z up
    return DB.XYZ(x, -z, y)

def by_name(cls, name, fallback_first=True):
    """Find an element type by 'Family : Type' or type name; fall back to the first of its class."""
    col = DB.FilteredElementCollector(doc).OfClass(cls).WhereElementIsElementType()
    first = None
    for t in col:
        first = first or t
        tn = DB.Element.Name.GetValue(t)
        fam = getattr(t, 'FamilyName', '') or ''
        if name and (tn == name or ('%s : %s' % (fam, tn)) == name):
            return t
    if name:
        warn('type "%s" not in template, using %s' % (name, DB.Element.Name.GetValue(first) if first else 'none'))
    return first if fallback_first else None

def family_symbol(name):
    """Family instance type by 'Family : Type'. Returns None when neither family nor type exists."""
    if not name:
        return None
    fam_name, _, type_name = [p.strip() for p in name.partition(':')]
    for s in DB.FilteredElementCollector(doc).OfClass(DB.FamilySymbol):
        if s.FamilyName == fam_name and (not type_name or DB.Element.Name.GetValue(s) == type_name):
            if not s.IsActive:
                s.Activate()
            return s
    return None

def level(name='Level 1'):
    for l in DB.FilteredElementCollector(doc).OfClass(DB.Level):
        if l.Name == name:
            return l
    return list(DB.FilteredElementCollector(doc).OfClass(DB.Level))[0]

def main():
    lvl = level()
    created = {'walls': 0, 'doors': 0, 'windows': 0, 'rooms': 0, 'fixtures': 0, 'roofs': 0, 'sheets': 0}
    wall_elems = []
    with revit.Transaction('Draft House: walls'):
        progress(15, 'walls', 'placing %d walls' % len(DESIGN['walls']))
        for w in DESIGN['walls']:
            wt = by_name(DB.WallType, w.get('revitType'))
            a = xyz(w['a'][0], w['a'][1]); b = xyz(w['b'][0], w['b'][1])
            if a.DistanceTo(b) < 0.3:
                continue
            line = DB.Line.CreateBound(a, b)
            try:
                wall = DB.Wall.Create(doc, line, wt.Id, lvl.Id, float(w['plate'] - w.get('base', 0)), float(w.get('base', 0)), False, False)
                wall_elems.append((wall, w))
                created['walls'] += 1
            except Exception as e:
                warn('wall %s: %s' % (w['id'], e))

    def host_for(x, z):
        p = xyz(x, z)
        best, bd = None, 1.5
        for wall, w in wall_elems:
            c = wall.Location.Curve
            d = c.Distance(p)
            if d < bd:
                best, bd = wall, d
        return best

    with revit.Transaction('Draft House: openings'):
        progress(35, 'doors', 'placing doors and windows')
        for d in DESIGN['doors']:
            if d.get('cased'):
                continue
            sym = family_symbol(d.get('revitFamily'))
            host = host_for(d['x'], d['z'])
            if not sym or not host:
                warn('door %s skipped (%s)' % (d['id'], 'no family' if not sym else 'no host wall'))
                continue
            try:
                doc.Create.NewFamilyInstance(xyz(d['x'], d['z']), sym, host, lvl, DB.Structure.StructuralType.NonStructural)
                created['doors'] += 1
            except Exception as e:
                warn('door %s: %s' % (d['id'], e))
        for win in DESIGN['windows']:
            sym = family_symbol(win.get('revitFamily'))
            host = host_for(win['x'], win['z'])
            if not sym or not host:
                warn('window %s skipped' % win['id'])
                continue
            try:
                inst = doc.Create.NewFamilyInstance(xyz(win['x'], win['z'], float(win['sill'])), sym, host, lvl, DB.Structure.StructuralType.NonStructural)
                p = inst.get_Parameter(DB.BuiltInParameter.INSTANCE_SILL_HEIGHT_PARAM)
                if p and not p.IsReadOnly:
                    p.Set(float(win['sill']))
                created['windows'] += 1
            except Exception as e:
                warn('window %s: %s' % (win['id'], e))

    with revit.Transaction('Draft House: rooms and floor'):
        progress(50, 'rooms', 'rooms and slab')
        for r in DESIGN['rooms']:
            if r.get('open'):
                continue
            try:
                room = doc.Create.NewRoom(lvl, DB.UV(r['x'], -r['z']))
                room.Name = r['name']
                created['rooms'] += 1
            except Exception as e:
                warn('room %s: %s' % (r['name'], e))
        try:
            ft = by_name(DB.FloorType, DESIGN.get('revit', {}).get('floorType'))
            for r in DESIGN['rooms']:
                if r.get('open'):
                    continue
                loop = DB.CurveLoop()
                pts = [xyz(r['x'] - r['w'] / 2, r['z'] - r['d'] / 2), xyz(r['x'] + r['w'] / 2, r['z'] - r['d'] / 2), xyz(r['x'] + r['w'] / 2, r['z'] + r['d'] / 2), xyz(r['x'] - r['w'] / 2, r['z'] + r['d'] / 2)]
                for i in range(4):
                    loop.Append(DB.Line.CreateBound(pts[i], pts[(i + 1) % 4]))
                if hasattr(DB.Floor, 'Create'):
                    DB.Floor.Create(doc, [loop], ft.Id, lvl.Id)
        except Exception as e:
            warn('floor: %s' % e)

    with revit.Transaction('Draft House: fixtures'):
        progress(60, 'fixtures', 'cabinets and fixtures')
        for f in DESIGN['fixtures']:
            sym = family_symbol(f.get('revitFamily'))
            if not sym:
                continue
            try:
                doc.Create.NewFamilyInstance(xyz(f['x'], f['z']), sym, lvl, DB.Structure.StructuralType.NonStructural)
                created['fixtures'] += 1
            except Exception as e:
                warn('fixture %s: %s' % (f['name'], e))

    with revit.Transaction('Draft House: roof'):
        progress(70, 'roof', 'roof masses')
        roof = DESIGN.get('roof') or {}
        pitch = 10.0 / 12.0
        for m in roof.get('masses', []):
            if m.get('kind') != 'gable':
                continue
            try:
                rt = by_name(DB.RoofType, None)
                oh = 1.33
                x0, x1 = m['x0'] - oh, m['x1'] + oh
                z0, z1 = m['y0'] - oh, m['y1'] + oh
                cx = DESIGN['roof'].get('centre', [36, 26.5])
                pts = [xyz(x0 - cx[0], z0 - cx[1]), xyz(x1 - cx[0], z0 - cx[1]), xyz(x1 - cx[0], z1 - cx[1]), xyz(x0 - cx[0], z1 - cx[1])]
                arr = DB.CurveArray()
                for i in range(4):
                    arr.Append(DB.Line.CreateBound(pts[i], pts[(i + 1) % 4]))
                mapping = DB.ModelCurveArray()
                fp = doc.Create.NewFootPrintRoof(arr, lvl, rt, mapping)
                ew = m.get('ridge') == 'ew'
                for i, mc in enumerate(mapping):
                    # eaves (slope defining) are the long sides; gable ends are not
                    is_eave = (i in (0, 2)) if ew else (i in (1, 3))
                    fp.set_DefinesSlope(mc, is_eave)
                    if is_eave:
                        fp.set_SlopeAngle(mc, math.atan(pitch))
                fp.get_Parameter(DB.BuiltInParameter.ROOF_LEVEL_OFFSET_PARAM).Set(float(m.get('plate', 9)))
                created['roofs'] += 1
            except Exception as e:
                warn('roof %s: %s' % (m.get('id'), e))

    with revit.Transaction('Draft House: sheets'):
        progress(80, 'sheets', 'sheet set')
        tb = family_symbol(DESIGN.get('titleBlockFamily') or '') or by_name(DB.FamilySymbol, None, False)
        plan_view = None
        for v in DB.FilteredElementCollector(doc).OfClass(DB.ViewPlan):
            if not v.IsTemplate and v.ViewType == DB.ViewType.FloorPlan:
                plan_view = v
                break
        for s in DESIGN.get('sheets', []):
            try:
                sheet = DB.ViewSheet.Create(doc, tb.Id if tb else DB.ElementId.InvalidElementId)
                sheet.SheetNumber = str(s['no'])
                sheet.Name = s['title']
                if s['no'] == '200' and plan_view and DB.Viewport.CanAddViewToSheet(doc, sheet.Id, plan_view.Id):
                    DB.Viewport.Create(doc, sheet.Id, plan_view.Id, DB.XYZ(1.3, 1.0, 0))
                created['sheets'] += 1
            except Exception as e:
                warn('sheet %s: %s' % (s.get('no'), e))

    progress(88, 'save', 'saving model')
    out_rvt = os.path.join(OUT, 'model.rvt')
    opts = DB.SaveAsOptions(); opts.OverwriteExistingFile = True
    doc.SaveAs(out_rvt, opts)
    try:
        progress(92, 'export', 'exporting IFC')
        ifc = DB.IFCExportOptions()
        doc.Export(OUT, 'model.ifc', ifc)
    except Exception as e:
        warn('ifc export: %s' % e)
    try:
        progress(96, 'export', 'exporting PDF')
        sheets = [s.Id for s in DB.FilteredElementCollector(doc).OfClass(DB.ViewSheet)]
        if hasattr(DB, 'PDFExportOptions') and sheets:
            po = DB.PDFExportOptions(); po.Combine = True; po.FileName = 'sheets'
            from System.Collections.Generic import List
            ids = List[DB.ElementId](sheets)
            doc.Export(OUT, ids, po)
    except Exception as e:
        warn('pdf export: %s' % e)
    report['counts'] = created
    report['ok'] = True

try:
    main()
except Exception as e:
    report['error'] = str(e)
    report['trace'] = traceback.format_exc()
finally:
    json.dump(report, open(os.path.join(OUT, 'report.json'), 'w'), indent=2)
    progress(100, 'done', 'ok' if report['ok'] else ('failed: ' + str(report.get('error'))))
