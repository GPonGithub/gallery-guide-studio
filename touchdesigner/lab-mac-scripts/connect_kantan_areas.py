# Connects Kantan Mapper's region shapes to the Immersive Lab's projection areas.
#
# Run it inside TouchDesigner (after build_immersive_lab.py) from the Textport:
#     exec(open('/full/path/to/connect_kantan_areas.py').read())
# Each shape named region_N (or regionN) shows /project1/immersive_lab/areaN.
# Only each shape's Texture and Show Texture change; the old vidN / region_NN nodes stay,
# so pointing a shape's Texture back at /project1/MAPPER/vidN undoes it.

import re

LAB = '/project1/immersive_lab'
SHAPES = '/project1/MAPPER/kantanMapper1/project/allShapes'

lab = op(LAB)
shapes = op(SHAPES)
if lab is None:
    print('  ! %s not found - run build_immersive_lab.py first' % LAB)
elif shapes is None:
    print('  ! %s not found' % SHAPES)
else:
    done = []
    for item in sorted(shapes.findChildren(name='item*', depth=1), key=lambda o: o.digits or 0):
        params = item.op('parameters')
        if params is None or not hasattr(params.par, 'Texture'):
            continue
        name = params.par.Name.eval()
        m = re.search(r'(\d+)$', name)
        area = lab.op('area%d' % int(m.group(1))) if m else None
        if area is None:
            print('  ! %s (%s): no matching area - left as it was' % (item.name, name))
            continue
        before = params.par.Texture.eval()
        params.par.Texture = area.path
        params.par.Showtexture = True
        done.append(int(m.group(1)))
        print('  %s  %-10s %s -> %s' % (item.name, name, before, area.path))
    missing = [n for n in range(1, int(lab.par.Areas.eval()) + 1) if n not in done]
    print('Connected %d shapes to areas.%s' % (
        len(done), (' No shape yet for area ' + ', '.join(map(str, missing)) + '.') if missing else ''))
