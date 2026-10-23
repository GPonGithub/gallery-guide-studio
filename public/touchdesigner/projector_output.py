# Sends the projector blend's output to the 4 projectors, one full-screen window each.
#
# Run it inside TouchDesigner (StudioMap) from the Textport:
#     exec(open('/full/path/to/projector_output.py').read())
# (Re)creates /project1/projector_out: the blend output (7680x1080) cut into 4 sections, section N
# shown full-screen on projector N, with "PROJECTOR N" over it while the component's
# "Identify" toggle is on, or a solid test colour per projector while "Testcolours" is on. The Chatbot Designer's "Set up the projectors" step (Immersive Media, 5)
# shows those numbers and swaps which projector gets which section; running this script again keeps
# what it set. To close the windows:
#     [w.par.winclose.pulse() for w in op('/project1/projector_out').findChildren(type=windowCOMP)]

SOURCE = '/project1/MAPPER/projectorBlend/out1'
PROJECTORS = 4

# Which screen each projector is, counting the projector screens from the left as macOS arranges
# them (Displays settings). On the studio Mac after the 2026-10-22 restart the screens from the left were
# macOS's PJ (1), PJ (4), PJ (3), PJ (2), but those names don't match the numbered projectors in the room;
# this mapping was checked against the room with the PROJECTOR N labels.
# If the projectors are rearranged, re-plugged or reconnected, fix this and run the script again.
# Test Colours: each projector a solid colour and its number, without the blend, so the light
# mixes where neighbours overlap on the wall (red + green = yellow, green + blue = cyan, ...).
TEST_COLOURS = {1: (1, 0, 0), 2: (0, 1, 0), 3: (0, 0, 1), 4: (1, 1, 1)}

SCREEN_OF_PROJECTOR = {1: 3, 2: 1, 3: 4, 4: 2}

problems = []


def setp(o, name, value):
    p = getattr(o.par, name, None)
    if p is None:
        problems.append('%s has no parameter "%s"' % (o.path, name))
        return
    try:
        p.val = value
    except Exception as e:
        problems.append('%s.%s = %r failed: %s' % (o.path, name, value, e))


# The projector screens: every monitor except the primary, left to right.
screens = sorted([m for m in monitors if not m.isPrimary], key=lambda m: (m.left, m.top))
if len(screens) < PROJECTORS:
    print('  ! Only %d projector screens found (need %d) - check they are on and extending' % (len(screens), PROJECTORS))

old = op('/project1/projector_out')
# Projector N's monitor as the app's projector step last set it, kept over SCREEN_OF_PROJECTOR.
kept = {}
if old is not None:
    for w in old.findChildren(type=windowCOMP, depth=1):
        if w.digits and w.par.display.eval() in [m.index for m in screens]:
            kept[w.digits] = w.par.display.eval()
    for w in old.findChildren(type=windowCOMP):
        w.par.winclose.pulse()
    old.destroy()

out = op('/project1').create(baseCOMP, 'projector_out')
out.nodeX, out.nodeY = 0, -400
page = out.appendCustomPage('Output')
page.appendToggle('Identify', label='Show Projector Numbers')
page.appendToggle('Testcolours', label='Test Colours')
out.par.Identify = True
src = out.create(selectTOP, 'blend')
src.par.top = SOURCE
src.nodeX, src.nodeY = -600, 0
for n in range(1, PROJECTORS + 1):
    y = -(n - 1) * 150
    crop = out.create(cropTOP, 'section%d' % n)
    crop.inputConnectors[0].connect(src)
    setp(crop, 'cropleft', (n - 1) / PROJECTORS)
    setp(crop, 'cropright', n / PROJECTORS)
    crop.nodeX, crop.nodeY = -400, y
    tag = out.create(textTOP, 'tag%d' % n)
    tag.nodeX, tag.nodeY = -400, y - 60
    setp(tag, 'text', 'PROJECTOR %d' % n)
    setp(tag, 'outputresolution', 'custom')
    setp(tag, 'resolutionw', 1920)
    setp(tag, 'resolutionh', 1080)
    setp(tag, 'fontsizex', 160)
    setp(tag, 'alignx', 'center')
    setp(tag, 'aligny', 'center')
    setp(tag, 'bgalpha', 0)
    over = out.create(overTOP, 'tagged%d' % n)
    over.inputConnectors[0].connect(tag)
    over.inputConnectors[1].connect(crop)
    over.nodeX, over.nodeY = -200, y
    solid = out.create(constantTOP, 'colour%d' % n)
    solid.nodeX, solid.nodeY = -400, y - 120
    setp(solid, 'outputresolution', 'custom')
    setp(solid, 'resolutionw', 1920)
    setp(solid, 'resolutionh', 1080)
    r, g, b = TEST_COLOURS.get(n, (1, 1, 1))
    setp(solid, 'colorr', r)
    setp(solid, 'colorg', g)
    setp(solid, 'colorb', b)
    num = out.create(textTOP, 'testnumber%d' % n)
    num.nodeX, num.nodeY = -200, y - 120
    setp(num, 'text', str(n))
    setp(num, 'outputresolution', 'custom')
    setp(num, 'resolutionw', 1920)
    setp(num, 'resolutionh', 1080)
    setp(num, 'fontsizex', 500)
    setp(num, 'alignx', 'center')
    setp(num, 'aligny', 'center')
    setp(num, 'fontcolorr', 0)
    setp(num, 'fontcolorg', 0)
    setp(num, 'fontcolorb', 0)
    setp(num, 'bgalpha', 0)
    test = out.create(overTOP, 'test%d' % n)
    test.inputConnectors[0].connect(num)
    test.inputConnectors[1].connect(solid)
    test.nodeX, test.nodeY = -100, y - 60
    sw = out.create(switchTOP, 'projector%d' % n)
    sw.inputConnectors[0].connect(crop)
    sw.inputConnectors[1].connect(over)
    sw.inputConnectors[2].connect(test)
    sw.par.index.expr = '2 if parent().par.Testcolours else (1 if parent().par.Identify else 0)'
    sw.nodeX, sw.nodeY = 0, y
    win = out.create(windowCOMP, 'window%d' % n)
    win.nodeX, win.nodeY = 200, y
    setp(win, 'winop', sw.path)
    setp(win, 'justifyoffsetto', 'specifydisplay')
    k = SCREEN_OF_PROJECTOR.get(n, n)
    if len(kept) == PROJECTORS and n in kept:
        k = [m.index for m in screens].index(kept[n]) + 1
    if k <= len(screens):
        setp(win, 'display', screens[k - 1].index)
    setp(win, 'size', 'fill')
    setp(win, 'borders', False)
    setp(win, 'alwaysontop', True)
    win.par.winopen.pulse()
    print('  projector %d: section %d of the blend -> projector screen %d from the left (monitor %s)' % (
        n, n, k, screens[k - 1].index if k <= len(screens) else '?'))

for p in problems:
    print('  ! ' + p)
print('Projector output open on %d screens.' % min(PROJECTORS, len(screens)))
