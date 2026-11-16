# Adds projectors 5 and 6 (the two new spaces, 2026-11-09) to /project1/projector_out, beside 1-4.
#
# Run it inside TouchDesigner (StudioMap) from the Textport:
#     exec(open('/full/path/to/add_projectors_5_6.py').read())
#
# Projectors 1-4 are left exactly as they are (their windows, screens and the blend). Projectors 5 and 6
# go on the projector screens that 1-4 aren't using, left to right. Each new window shows black, or
# "PROJECTOR 5" / "PROJECTOR 6" while projector_out's Identify toggle is on (the app's Show projector
# IDs), or a test colour while Testcolours is on. They don't take part in the 4-projector blend: they
# are for the two new authoring spaces, whose pictures come later.
#
# CAUTION: it trusts windows 1-4's "display" numbers to know which screens are taken. When monitors are
# added or removed, TouchDesigner renumbers them (by position, left to right) while open windows stay put,
# so those numbers can go stale - that's how projector 6 first landed on projector 3's screen
# (fixed by fix_projector_screens.py). Check windows 1-4 still show their own numbers before running it.
#
# Running it again rebuilds 5 and 6 only, keeping the screens they're on. The app's projector step
# (Immersive Media, 5) counts them too, so it can swap them if 5 and 6 come out the wrong way round.

NEW = (5, 6)
TEST_COLOURS = {5: (1, 0, 1), 6: (0, 1, 1)}  # magenta, cyan

po = op('/project1/projector_out')
if po is None:
    raise Exception('No /project1/projector_out - run projector_output.py first')


def mon(i):
    for m in monitors:
        if m.index == i:
            return m
    return None


print('Monitors TouchDesigner sees:')
for m in sorted(monitors, key=lambda m: (m.left, m.top)):
    print('  monitor %d: %dx%d at (%d, %d)%s %s' % (
        m.index, m.width, m.height, m.left, m.top, ' PRIMARY' if m.isPrimary else '',
        getattr(m, 'displayName', '')))

wins = {w.digits: w for w in po.findChildren(type=windowCOMP, depth=1) if w.digits}
used = {wins[n].par.display.eval() for n in wins if n not in NEW}
print('Projectors 1-4 are on monitors %s' % sorted(used))

screens = sorted([m for m in monitors if not m.isPrimary], key=lambda m: (m.left, m.top))
free = [m.index for m in screens if m.index not in used]
# Keep the screens 5 and 6 were on, if this has been run before.
kept = {n: wins[n].par.display.eval() for n in NEW if n in wins and wins[n].par.display.eval() in free}
order = [kept[n] for n in NEW if n in kept] + [i for i in free if i not in kept.values()]
if len(free) < len(NEW):
    print('  ! Only %d free projector screen(s): %s - check the new projectors are on and extending' % (len(free), free))

for n in NEW:
    for name in ('window%d', 'projector%d', 'black%d', 'tag%d', 'tagged%d', 'colour%d', 'testnumber%d', 'test%d'):
        o = po.op(name % n)
        if o is not None:
            if o.type == 'window':
                o.par.winclose.pulse()
            o.destroy()

for k, n in enumerate(NEW):
    screen = (kept[n] if n in kept else (order[k] if k < len(order) else None))
    m = mon(screen) if screen is not None else None
    w, h = (m.width, m.height) if m else (1920, 1080)
    y = -(n - 1) * 150

    def sized(o):
        o.par.outputresolution = 'custom'
        o.par.resolutionw = w
        o.par.resolutionh = h

    black = po.create(constantTOP, 'black%d' % n)
    sized(black)
    black.par.colorr = black.par.colorg = black.par.colorb = 0
    black.par.alpha = 1
    black.nodeX, black.nodeY = -400, y

    tag = po.create(textTOP, 'tag%d' % n)
    sized(tag)
    tag.par.text = 'PROJECTOR %d' % n
    tag.par.fontsizex = 160
    tag.par.alignx = 'center'
    tag.par.aligny = 'center'
    tag.par.bgalpha = 0
    tag.nodeX, tag.nodeY = -400, y - 60
    tagged = po.create(overTOP, 'tagged%d' % n)
    tagged.inputConnectors[0].connect(tag)
    tagged.inputConnectors[1].connect(black)
    tagged.nodeX, tagged.nodeY = -200, y

    solid = po.create(constantTOP, 'colour%d' % n)
    sized(solid)
    solid.par.colorr, solid.par.colorg, solid.par.colorb = TEST_COLOURS[n]
    solid.nodeX, solid.nodeY = -400, y - 120
    num = po.create(textTOP, 'testnumber%d' % n)
    sized(num)
    num.par.text = str(n)
    num.par.fontsizex = 500
    num.par.alignx = 'center'
    num.par.aligny = 'center'
    num.par.fontcolorr = num.par.fontcolorg = num.par.fontcolorb = 0
    num.par.bgalpha = 0
    num.nodeX, num.nodeY = -200, y - 120
    test = po.create(overTOP, 'test%d' % n)
    test.inputConnectors[0].connect(num)
    test.inputConnectors[1].connect(solid)
    test.nodeX, test.nodeY = -100, y - 60

    sw = po.create(switchTOP, 'projector%d' % n)
    sw.inputConnectors[0].connect(black)
    sw.inputConnectors[1].connect(tagged)
    sw.inputConnectors[2].connect(test)
    sw.par.index.expr = '2 if parent().par.Testcolours else (1 if parent().par.Identify else 0)'
    sw.nodeX, sw.nodeY = 0, y

    win = po.create(windowCOMP, 'window%d' % n)
    win.par.winop = sw.path
    win.par.justifyoffsetto = 'specifydisplay'
    if m is not None:
        win.par.display = m.index
    win.par.size = 'fill'
    win.par.borders = False
    win.par.alwaysontop = True
    win.nodeX, win.nodeY = 200, y
    win.par.winopen.pulse()
    print('  projector %d -> monitor %s (%dx%d)' % (n, m.index if m else '?', w, h))

po.par.Identify = True
op('/').time.play = True
print('Projectors 5 and 6 added; projector numbers are showing on all of them.')
