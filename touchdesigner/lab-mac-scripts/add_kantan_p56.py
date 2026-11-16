# A second Kantan Mapper for projectors 5 and 6 (the two new authoring spaces), 2026-11-09.
#
# Run it inside TouchDesigner (StudioMap) from the Textport:
#     exec(open('/full/path/to/add_kantan_p56.py').read())
#
# 1. Copies /project1/MAPPER/kantanMapper1 to /project1/MAPPER/kantanMapper_P56 (the original and its 11
#    shapes are not touched). Its canvas is 4480x1080: projector 5's 1920 on the left, projector 6's 2560
#    on the right.
# 2. In the copy: keeps 6 rectangles, resets them to plain coloured rectangles - p5_shape1..3 on projector
#    5's part, p6_shape1..3 on projector 6's - and deletes the other shapes.
# 3. Projector windows 5 and 6 (projector_out) show their part of its output (with PROJECTOR 5 / 6 over it
#    while projector IDs are on).
# Then open its editor with  op('/project1/MAPPER/kantanMapper_P56').par.Open.pulse()  and distort the
# shapes. Does nothing if kantanMapper_P56 already exists. Writes a log to add_kantan_p56.log.

LOG = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/add_kantan_p56.log'
NAME = 'kantanMapper_P56'
W5, W6, H = 1920, 2560, 1080
W = W5 + W6
KEEP = [1, 3, 4, 6, 7, 8]  # rectangle shapes in kantanMapper1 (tree type 1)
COLOURS = [(0.95, 0.25, 0.25), (0.25, 0.8, 0.35), (0.3, 0.45, 0.95),   # projector 5: red, green, blue
           (0.95, 0.8, 0.2), (0.85, 0.3, 0.85), (0.2, 0.8, 0.85)]      # projector 6: yellow, magenta, cyan
log = []


def say(*a):
    s = ' '.join(str(x) for x in a)
    log.append(s)
    print(s)


def rect_centres():
    # Canvas x runs from -W/2 to +W/2 (centre 0), as in kantanMapper1.
    left5, left6 = -W / 2, -W / 2 + W5
    out = []
    for k in range(3):
        out.append((left5 + W5 * (k + 0.5) / 3, 520, 640))  # (centre x, width, height)
    for k in range(3):
        out.append((left6 + W6 * (k + 0.5) / 3, 660, 640))
    return out


def tree_ids(kp):
    return [int(r[0].val) for r in kp.op('tree').rows()[1:]]


try:
    M = op('/project1/MAPPER')
    src = M.op('kantanMapper1')
    if M.op(NAME) is not None:
        raise Exception('%s already exists - nothing changed' % NAME)
    K = M.copy(src, name=NAME)
    K.nodeX, K.nodeY = src.nodeX, src.nodeY - 400
    kp = K.op('project')
    say('copied ->', K.path)
    kp.par.Resolutionw = W
    kp.par.Resolutionh = H
    if hasattr(kp.par, 'Bgmask'):
        kp.par.Bgmask = ''
    if hasattr(K.par, 'Project'):
        K.par.Project = ''  # don't point at Greg's saved project file

    shapes = kp.op('allShapes')
    for n, (cx, w, h) in zip(KEEP, rect_centres()):
        it = shapes.op('item%d' % n)
        i = KEEP.index(n)
        d = it.GetDefinition()
        p = d['parameters']
        p['Name'] = ('p5_shape%d' % (i + 1)) if i < 3 else ('p6_shape%d' % (i - 2))
        p['Colorr'], p['Colorg'], p['Colorb'] = COLOURS[i]
        p['Colora'] = 1.0
        p['Texture'] = ''
        p['Showtexture'] = False
        p['Handlelock'] = False
        p['Custompivotx'], p['Custompivoty'] = cx, 0.0
        sd = d['shapeDef']
        sd['keyOffset'] = 'id\tu\tv\r\n0\t0\t0\r\n1\t0\t0\r\n2\t0\t0\r\n3\t0\t0\r\n'
        sd['homography'] = '1\t0\t0\r\n0\t1\t0\r\n0\t0\t1\r\n'
        sd['uvOffsetTexture'] = 'index\tu\tv\r\n0\t0\t0\r\n1\t0\t0\r\n2\t0\t0\r\n3\t0\t0\r\n'
        d['shapeXform'] = 'tdu.Matrix([%r, 0.0, 0.0, 0.0, 0.0, %r, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, %r, 0.0, 0.0, 1.0])' % (
            float(w), float(h), float(cx))
        d['path'] = it.path
        it.SetDefinition(defDict=d, undo=False)
        say('  item%d -> %s at x %d, %dx%d' % (n, p['Name'], cx, w, h))

    drop = [i for i in tree_ids(kp) if i not in KEEP]
    deleted = False
    for attempt in (lambda: kp.DeleteShape(shapeId=drop), lambda: kp.DeleteShape(drop),
                    lambda: [kp.DeleteShape(shapeId=[i]) for i in drop]):
        try:
            attempt()
        except Exception as e:
            say('  DeleteShape attempt failed:', e)
            continue
        if not [i for i in tree_ids(kp) if i in drop]:
            deleted = True
            break
    say('  shapes now:', tree_ids(kp), '(deleted others)' if deleted else '(! some extra shapes remain)')

    # Projector windows 5 and 6 show their part of the new canvas.
    po = op('/project1/projector_out')
    for n, (l, r) in ((5, (0, W5 / W)), (6, (W5 / W, 1))):
        c = po.op('kantan%d' % n) or po.create(cropTOP, 'kantan%d' % n)
        c.inputConnectors[0].connect(K.op('out1'))
        c.par.cropleft, c.par.cropright = l, r
        c.nodeX, c.nodeY = -600, -(n - 1) * 150 - 30
        po.op('projector%d' % n).inputConnectors[0].connect(c)  # index 0: the shapes
        po.op('tagged%d' % n).inputConnectors[1].connect(c)     # IDs over the shapes
        say('  projector %d <- %s crop %.3f-%.3f' % (n, K.path, l, r))
    po.par.Identify = False
    op('/').time.play = True
    say('Done. Open the editor: op(%r).par.Open.pulse()' % K.path)
except Exception as e:
    say('! stopped:', e)
open(LOG, 'w').write('\n'.join(log))
