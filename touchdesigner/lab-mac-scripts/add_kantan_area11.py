# Adds a Kantan Mapper shape for area 11 and connects it to the Immersive Lab.
#
# Run it inside TouchDesigner (after connect_kantan_areas.py) from the Textport:
#     exec(open('/full/path/to/add_kantan_area11.py').read())
# Copies region_10's shape, names the copy region_11, puts it in the widest empty margin of
# Kantan's canvas (shrunk if it doesn't fit) so it overlaps nothing, gives it its own colour and
# shows /project1/immersive_lab/area11 on it. Move it into place in Kantan's editor afterwards.
# Does nothing if a region_11 shape already exists. Undo: delete the shape in Kantan.

import re

PROJECT = '/project1/MAPPER/kantanMapper1/project'
AREA = '/project1/immersive_lab/area11'
NEW_NAME = 'region_11'
GAP = 40  # pixels kept clear of the canvas edge and the neighbouring shape


def items(kp):
    return {o.digits: o for o in kp.op('allShapes').findChildren(name='item*', depth=1) if o.digits is not None}


def name_of(item):
    return item.op('parameters').par.Name.eval()


def xform_values(defn):
    """The shape's 4x4 transform as 16 numbers (scale on the diagonal, translate in 12 and 13)."""
    x = defn['shapeXform']
    text = x if isinstance(x, str) else str(list(x.vals)) if hasattr(x, 'vals') else str(x)
    return [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?(?:e-?\d+)?', text.split('[', 1)[-1])][:16]


def xform_text(vals):
    return 'tdu.Matrix([%s])' % ', '.join(repr(float(v)) for v in vals)


kp = op(PROJECT)
area = op(AREA)
if kp is None or area is None:
    print('  ! %s not found' % (PROJECT if kp is None else AREA))
else:
    before = items(kp)
    if any(re.search(r'(^|\D)11$', name_of(o)) for o in before.values()):
        print('  A shape for area 11 already exists - nothing changed.')
    else:
        source = next((o for o in before.values() if re.search(r'(^|\D)10$', name_of(o))), None)
        source = source or before[max(before)]
        boxes = []
        for o in before.values():
            v = xform_values(o.GetDefinition())
            boxes.append((v[12] - abs(v[0]) / 2, v[12] + abs(v[0]) / 2))
        half = kp.par.Resolutionw.eval() / 2
        left_room = min(b[0] for b in boxes) - (-half) - 2 * GAP
        right_room = half - max(b[1] for b in boxes) - 2 * GAP

        kp.CopyShape(shapeId=[source.digits])
        new = [o for d, o in items(kp).items() if d not in before]
        if not new:
            print('  ! Kantan did not make a copy - nothing else changed.')
        else:
            shape = new[0]
            defn = shape.GetDefinition()
            v = xform_values(defn)
            w, h = abs(v[0]), abs(v[5])
            room = max(left_room, right_room)
            k = min(1.0, room / w) if room > 0 else 0.5
            w, h = w * k, h * k
            if right_room >= left_room:
                cx = max(b[1] for b in boxes) + GAP + w / 2
            else:
                cx = min(b[0] for b in boxes) - GAP - w / 2
            v[0], v[5], v[12] = w if v[0] >= 0 else -w, h if v[5] >= 0 else -h, cx
            defn['shapeXform'] = xform_text(v)
            shape.SetDefinition(defDict=defn, undo=False)
            params = shape.op('parameters')
            params.par.Name = NEW_NAME
            params.par.Texture = area.path
            params.par.Showtexture = True
            params.par.Colorr, params.par.Colorg, params.par.Colorb = 1.0, 0.55, 0.0
            print('  %s  %s  at x=%d, %dx%d (copy of %s) -> %s' % (
                shape.name, NEW_NAME, cx, w, h, name_of(source) if source.valid else '?', area.path))
            print('Added a shape for area 11 - move it into place in Kantan, then save.')
