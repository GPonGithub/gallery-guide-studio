# Measures how far two neighbouring projectors overlap on the wall.
#
# Run it inside TouchDesigner (StudioMap, after projector_output.py) from the Textport:
#     exec(open('/full/path/to/overlap_ruler.py').read())
# The left projector of the seam shows solid green; the right one shows a ruler measured from its left
# edge: a thin grey tick every 20 projector pixels and a thick line every 100 (100 red, 200 orange,
# 300 yellow, 400 green, 500 cyan, 600 blue, 700 magenta, 800 white). Where the green stops on the
# wall is the overlap. The other projectors go black. To put the projectors back, run it again with
#     RESTORE = True; exec(open('/full/path/to/overlap_ruler.py').read())
# For another seam, set RULER_SEAM = (left, right) first, e.g. RULER_SEAM = (3, 4).
# RULER_BOTH = True instead puts a ruler on both: the left projector's measured from its right edge,
# the right one's from its left edge (photograph each with the other covered).

LEFT, RIGHT = globals().get('RULER_SEAM', (2, 3))
RESTORE = globals().pop('RESTORE', False)
BOTH = globals().pop('RULER_BOTH', False)

RULER_CALLBACKS = r'''import numpy

FROM_RIGHT = %s

COLOURS = {100: (1, 0, 0), 200: (1, 0.5, 0), 300: (1, 1, 0), 400: (0, 1, 0),
           500: (0, 1, 1), 600: (0, 0.3, 1), 700: (1, 0, 1), 800: (1, 1, 1)}


def onSetupParameters(scriptOp):
    return


def onCook(scriptOp):
    w, h = 1920, 1080
    a = numpy.zeros((h, w, 4), dtype=numpy.float32)
    a[..., 3] = 1
    for d in range(20, 801, 20):
        x = w - d if FROM_RIGHT else d
        if d in COLOURS:
            a[:, x - 3:x + 3, :3] = COLOURS[d]
        else:
            a[h // 4:3 * h // 4, x - 1:x + 1, :3] = 0.8
    scriptOp.copyNumpyArray(a)
    return
'''

out = op('/project1/projector_out')
ruler = op('/project1/overlap_ruler')
if out is None:
    print('  ! /project1/projector_out not found - run projector_output.py first')
elif RESTORE:
    for w in out.findChildren(type=windowCOMP, depth=1):
        w.par.winop = out.op('projector%d' % w.digits).path
    if ruler is not None:
        ruler.destroy()
    print('Projectors back to normal.')
else:
    if ruler is not None:
        ruler.destroy()
    ruler = op('/project1').create(baseCOMP, 'overlap_ruler')
    ruler.nodeX, ruler.nodeY = 0, -1000
    rulers = {}
    for side in ('left', 'right'):
        cb = ruler.create(textDAT, 'ruler_%s_callbacks' % side)
        cb.text = RULER_CALLBACKS % ('True' if side == 'right' else 'False')
        st = ruler.create(scriptTOP, 'ruler_from_%s' % side)
        st.par.callbacks = cb
        rulers[side] = st
    tops = {}
    for name, rgb in (('green', (0, 1, 0)), ('black', (0, 0, 0))):
        c = ruler.create(constantTOP, name)
        c.par.outputresolution = 'custom'
        c.par.resolutionw, c.par.resolutionh = 1920, 1080
        c.par.colorr, c.par.colorg, c.par.colorb = rgb
        tops[name] = c
    for w in out.findChildren(type=windowCOMP, depth=1):
        n = w.digits
        left_top = rulers['right'] if BOTH else tops['green']
        w.par.winop = (left_top if n == LEFT else rulers['left'] if n == RIGHT else tops['black']).path
    if BOTH:
        print('Rulers on: projector %d from its right edge, projector %d from its left edge.' % (LEFT, RIGHT))
    else:
        print('Ruler on: projector %d green, projector %d ruler. Read where the green stops.' % (LEFT, RIGHT))
