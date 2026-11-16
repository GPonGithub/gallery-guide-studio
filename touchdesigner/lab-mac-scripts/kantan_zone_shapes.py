# Read-only: the six kantanMapper_P56 shapes (zones 1 and 3) as Kantan holds them -> kantan_zone_shapes.txt
# Changes nothing in the project. Run in the Textport:
#   exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_zone_shapes.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_zone_shapes.txt'
L = []
try:
    K = op('/project1/MAPPER/kantanMapper_P56')
    L.append('##### out1 %dx%d' % (K.op('out1').width, K.op('out1').height))
    shapes = K.op('project/allShapes')
    for n in (1, 3, 4, 6, 7, 8):
        it = shapes.op('item%d' % n)
        if it is None:
            L.append('##### item%d MISSING' % n)
            continue
        L.append('##### item%d' % n)
        try:
            d = it.GetDefinition()
            for k, v in d.items():
                if k == 'shapeDef':
                    for k2, v2 in v.items():
                        L.append('shapeDef.%s = %r' % (k2, v2))
                elif k == 'parameters':
                    L.append('parameters = %r' % (str(v)[:1500],))
                else:
                    L.append('%s = %r' % (k, v))
        except Exception as ex:
            L.append('GetDefinition failed: %r' % (ex,))
        # Every small SOP inside the item, with its points: the corners as drawn are among them.
        for c in it.findChildren(type=SOP, maxDepth=3):
            try:
                pts = c.points
                if 0 < len(pts) <= 40:
                    L.append('SOP %s (%s) %d points: %s' % (
                        it.relativePath(c), c.type, len(pts),
                        [(round(p.x, 3), round(p.y, 3), round(p.z, 3)) for p in pts]))
            except Exception as ex:
                L.append('SOP %s failed: %r' % (c.name, ex))
except Exception as ex:
    L.append('FAILED: %r' % (ex,))
open(OUT, 'w').write('\n'.join(L))
print('kantan_zone_shapes written, %d lines' % len(L))
