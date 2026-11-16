# -*- coding: utf-8 -*-
"""
Runs inside Revit through `pyrevit run list_names.py <template.rte> --revit=2024`.
Writes template-names.json (into DH_OUT, else next to this file) with every name
the build script can use from the office template: wall, floor and roof types,
door, window, title block and other family types ("Family : Type"), levels and
view templates. The drafter copies the real names from it into kit.revit.json.
"""
import os, json
from pyrevit import revit, DB

doc = revit.doc
OUT = os.environ.get('DH_OUT') or os.path.dirname(os.path.abspath(__file__))

def ename(e):
    try:
        return DB.Element.Name.GetValue(e)
    except Exception:
        return getattr(e, 'Name', '') or ''

def types(cls):
    return sorted(set(ename(t) for t in DB.FilteredElementCollector(doc).OfClass(cls).WhereElementIsElementType()))

def symbols(category=None):
    col = DB.FilteredElementCollector(doc).OfClass(DB.FamilySymbol)
    if category is not None:
        col = col.OfCategory(category)
    return sorted(set('%s : %s' % (s.FamilyName, ename(s)) for s in col))

names = {
    'template': doc.Title,
    'revit': getattr(revit.HOST_APP, 'version', None),
    'wallTypes': types(DB.WallType),
    'floorTypes': types(DB.FloorType),
    'roofTypes': types(DB.RoofType),
    'doors': symbols(DB.BuiltInCategory.OST_Doors),
    'windows': symbols(DB.BuiltInCategory.OST_Windows),
    'titleBlocks': symbols(DB.BuiltInCategory.OST_TitleBlocks),
    'furniture': symbols(DB.BuiltInCategory.OST_Furniture),
    'casework': symbols(DB.BuiltInCategory.OST_Casework),
    'plumbing': symbols(DB.BuiltInCategory.OST_PlumbingFixtures),
    'appliances': symbols(DB.BuiltInCategory.OST_SpecialityEquipment),
    'genericModels': symbols(DB.BuiltInCategory.OST_GenericModel),
    'levels': sorted(l.Name for l in DB.FilteredElementCollector(doc).OfClass(DB.Level)),
    'viewTemplates': sorted(v.Name for v in DB.FilteredElementCollector(doc).OfClass(DB.View) if v.IsTemplate),
}
path = os.path.join(OUT, 'template-names.json')
json.dump(names, open(path, 'w'), indent=2)
print('DRAFT_HOUSE_NAMES_OK %s' % path)
for k, v in names.items():
    if isinstance(v, list):
        print('%s: %d' % (k, len(v)))
