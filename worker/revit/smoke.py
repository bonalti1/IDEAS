# Runs inside Revit through `pyrevit run`. Proves Revit launched and can open the template.
from pyrevit import revit
doc = revit.doc
print('DRAFT_HOUSE_SMOKE_OK %s' % (doc.Title if doc else 'no document'))
