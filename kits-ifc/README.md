# kits-ifc

Drop one IFC4 export per house style here, exported from Revit (File, Export, IFC, setup "IFC4 Reference View" or "IFC4 Design Transfer View", with rooms exported as IfcSpace: tick "Export rooms in 3D views" / IFC Space Boundaries 1st level). Name the file by the style id:

    modern.ifc  spanish.ifc  hillcountry.ifc  ranch.ifc  craftsman.ifc  transitional.ifc  tuscan.ifc  midcentury.ifc  coastal.ifc

Then run:

    node scripts/convert-kits.mjs          # converts every file here, registers the styles, prints a report

or one file:

    python3 scripts/kit-from-ifc.py kits-ifc/spanish.ifc --id spanish --name "Spanish"

What the export must contain for a good kit: Rooms placed and named in Revit (they become the plan), doors and windows hosted in walls, furniture and plumbing fixtures placed (they become the fixture layer), one roof made of footprint roofs or roof-by-element (gable masses are read from pairs of sloped panels), and exterior walls flagged as exterior (Function = Exterior). Multi-storey houses are read as one level for now (the stats list the storeys seen).

The IFC files are not committed (see .gitignore); the generated kits in src/kits/*.ifc.js are.
