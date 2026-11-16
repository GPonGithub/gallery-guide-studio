# Puts each area's number (black) in the top-left corner of its Kantan shape, for lining up shapes on the wall.
#
# Run it inside TouchDesigner (StudioMap, after connect_kantan_areas.py) from the Textport:
#     exec(open('/full/path/to/area_labels.py').read())
# (Re)creates /project1/area_labels: for each area N, immersive_lab/areaN with a black number in
# its top-left corner (out1 ... out11), and points Kantan's region_N shape at it.
# The component's "Show Numbers" toggle turns the numbers off (the media passes straight through);
# to remove it entirely, run connect_kantan_areas.py again and delete /project1/area_labels.
# Its on_start DAT plays the timeline and re-points the shapes here each time the file opens.

import json
import os
import re

LAB = '/project1/immersive_lab'
SHAPES = '/project1/MAPPER/kantanMapper1/project/allShapes'
# Sizes on the wall, in Kantan canvas pixels (the same for every shape, whatever its size).
NUMBER_PX = 45       # number height
MARGIN_PX = 15       # gap from the shape's top-left corner
FALLBACK_SIZE = (470, 622)  # a shape's width and height in the canvas, if Kantan can't say
# Per-area corrections measured by number_calibrate.py (Kantan maps rectangles over their original
# size, not their outline, so the outline alone gets some sizes wrong).
FIT_FILE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/area_numbers_fit.json'
# Areas whose picture fades to black towards its right edge, and over what share of the width
# (softens a shape's edge where it meets a projector seam).
FADE_RIGHT = {}

FADE_CALLBACKS = r'''import numpy

SHARE = %f


def onSetupParameters(scriptOp):
    return


def onCook(scriptOp):
    w, h = 1920, 1080
    ramp = numpy.ones(w, dtype=numpy.float32)
    n = max(1, int(w * SHARE))
    t = numpy.linspace(0, 1, n)
    ramp[w - n:] = 1 - t * t * (3 - 2 * t)   # smoothstep: eases in and out, no hard start
    a = numpy.ones((h, w, 4), dtype=numpy.float32)
    a[..., 0] = a[..., 1] = a[..., 2] = a[..., 3] = ramp
    scriptOp.copyNumpyArray(a)
    return
'''

problems = []

ON_START = r"""# Made by area_labels.py: on start, play the timeline and point each Kantan shape at its number.
import re

SHAPES = '/project1/MAPPER/kantanMapper1/project/allShapes'


def relink():
    shapes = op(SHAPES)
    if shapes is None:
        return
    for item in shapes.findChildren(name='item*', depth=1):
        params = item.op('parameters')
        if params is None or not hasattr(params.par, 'Texture'):
            continue
        m = re.search(r'(\d+)$', params.par.Name.eval())
        target = parent().op('out%d' % int(m.group(1))) if m else None
        if target is not None:
            params.par.Texture = target.path


def onStart():
    op('/').time.play = True
    run('op(%r).module.relink()' % me.path, delayFrames=60)
    return


start = onStart
"""


def setp(o, name, value):
    p = getattr(o.par, name, None)
    if p is None:
        problems.append('%s has no parameter "%s"' % (o.path, name))
        return
    try:
        p.val = value
    except Exception as e:
        problems.append('%s.%s = %r failed: %s' % (o.path, name, value, e))


lab = op(LAB)
shapes = op(SHAPES)
if lab is None or shapes is None:
    print('  ! %s not found' % (LAB if lab is None else SHAPES))
else:
    areas = int(lab.par.Areas.eval())
    width, height = int(lab.par.Width.eval()), int(lab.par.Height.eval())
    # Each shape squeezes the whole width x height picture into its own size in the canvas, so the
    # number is drawn at that shape's scale: the same size on the wall and not stretched.
    fit = json.load(open(FIT_FILE)) if os.path.exists(FIT_FILE) else {}
    size = {}
    for item in shapes.findChildren(name='item*', depth=1):
        params = item.op('parameters')
        m = re.search(r'(\d+)$', params.par.Name.eval()) if params is not None and hasattr(params.par, 'Name') else None
        if m:
            b = item.computeBounds()
            w, h = b.max[0] - b.min[0], b.max[1] - b.min[1]
            if w > 1 and h > 1:
                size[int(m.group(1))] = (w, h)

    old = op('/project1/area_labels')
    if old is not None:
        old.destroy()
    comp = op('/project1').create(baseCOMP, 'area_labels')
    comp.nodeX, comp.nodeY = 0, -700
    page = comp.appendCustomPage('Labels')
    page.appendToggle('Shownumbers', label='Show Numbers')
    comp.par.Shownumbers = True

    for n in range(1, areas + 1):
        y = -(n - 1) * 160
        src = comp.create(selectTOP, 'area%d' % n)
        src.par.top = '%s/area%d' % (LAB, n)
        src.nodeX, src.nodeY = -600, y
        txt = comp.create(textTOP, 'number%d' % n)
        txt.nodeX, txt.nodeY = -400, y
        setp(txt, 'text', str(n))
        setp(txt, 'outputresolution', 'custom')
        setp(txt, 'resolutionw', width)
        setp(txt, 'resolutionh', height)
        # Picture pixels per canvas pixel, across and down, for this shape.
        sw_, sh_ = size.get(n, FALLBACK_SIZE)
        fx, fy = fit.get(str(n), (1.0, 1.0))
        kx, ky = width / sw_ * fx, height / sh_ * fy
        setp(txt, 'keepfontratio', False)   # otherwise the down size is ignored
        setp(txt, 'fontsizey', NUMBER_PX * ky)
        setp(txt, 'fontsizex', NUMBER_PX * kx)
        # Top-left corner, with a margin.
        setp(txt, 'alignx', 'left')
        setp(txt, 'aligny', 'top')
        setp(txt, 'positionx', MARGIN_PX * kx)
        setp(txt, 'positiony', -MARGIN_PX * ky)
        setp(txt, 'fontcolorr', 0)
        setp(txt, 'fontcolorg', 0)
        setp(txt, 'fontcolorb', 0)
        setp(txt, 'bgalpha', 0)
        over = comp.create(overTOP, 'labelled%d' % n)
        over.inputConnectors[0].connect(txt)
        over.inputConnectors[1].connect(src)
        over.nodeX, over.nodeY = 0, y
        setp(over, 'outputresolution', 'custom')
        setp(over, 'resolutionw', width)
        setp(over, 'resolutionh', height)
        sw = comp.create(switchTOP, 'switch%d' % n)
        sw.inputConnectors[0].connect(src)
        sw.inputConnectors[1].connect(over)
        sw.par.index.expr = "1 if parent().par.Shownumbers else 0"
        sw.nodeX, sw.nodeY = 200, y
        out = comp.create(nullTOP, 'out%d' % n)
        last = sw
        if n in FADE_RIGHT:
            cb = comp.create(textDAT, 'fade%d_callbacks' % n)
            cb.text = FADE_CALLBACKS % FADE_RIGHT[n]
            cb.nodeX, cb.nodeY = 200, y - 120
            mask = comp.create(scriptTOP, 'fade%d' % n)
            mask.par.callbacks = cb
            mask.nodeX, mask.nodeY = 200, y - 60
            faded = comp.create(compositeTOP, 'faded%d' % n)
            faded.inputConnectors[0].connect(sw)
            faded.inputConnectors[1].connect(mask)
            setp(faded, 'operand', 'multiply')
            faded.nodeX, faded.nodeY = 300, y
            last = faded
        out.inputConnectors[0].connect(last)
        out.nodeX, out.nodeY = 400, y

    # Kantan can hand its shapes the wrong texture when the file is reopened, and the timeline must
    # play for Kantan's corner dragging: on start, play the timeline and point each shape back here.
    ex = comp.create(executeDAT, 'on_start')
    ex.nodeX, ex.nodeY = 600, 0
    ex.text = ON_START
    setp(ex, 'start', True)
    setp(ex, 'active', True)

    linked = []
    for item in shapes.findChildren(name='item*', depth=1):
        params = item.op('parameters')
        if params is None or not hasattr(params.par, 'Texture'):
            continue
        m = re.search(r'(\d+)$', params.par.Name.eval())
        target = comp.op('out%s' % int(m.group(1))) if m else None
        if target is not None:
            params.par.Texture = target.path
            linked.append(int(m.group(1)))

    for p in problems:
        print('  ! ' + p)
    print('Numbers on %d shapes (%s). Toggle: /project1/area_labels "Show Numbers".' % (
        len(linked), ', '.join(map(str, sorted(linked)))))
