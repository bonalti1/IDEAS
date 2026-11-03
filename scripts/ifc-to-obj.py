# Convert an exported Draft House IFC to OBJ for the preview page.
# usage: python3.13 scripts/ifc-to-obj.py draft.ifc public/ifc-preview.obj   (needs: pip install ifcopenshell)
import sys, ifcopenshell, ifcopenshell.geom as geom
f = ifcopenshell.open(sys.argv[1])
st = geom.settings()
st.set(st.USE_WORLD_COORDS, True)
out = []; off = 1
for kind in ['IfcSlab', 'IfcWall', 'IfcSpace']:
    for e in f.by_type(kind):
        sh = geom.create_shape(st, e)
        v = sh.geometry.verts; fc = sh.geometry.faces
        out.append(f'o {kind}_{e.id()}')
        for i in range(0, len(v), 3): out.append(f'v {v[i]:.4f} {v[i+1]:.4f} {v[i+2]:.4f}')
        for i in range(0, len(fc), 3): out.append(f'f {fc[i]+off} {fc[i+1]+off} {fc[i+2]+off}')
        off += len(v) // 3
open(sys.argv[2], 'w').write('\n'.join(out))
print('objects', sum(1 for l in out if l.startswith('o ')))
