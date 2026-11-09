# Sends the pictures to the projectors, one full-screen window each: the 4 wall projectors (the blend)
# and, since 2026-11-09, projectors 5 and 6 (the two new authoring spaces).
#
# Run it inside TouchDesigner (StudioMap) from the Textport:
#     exec(open('/full/path/to/projector_output.py').read())
# (Re)creates /project1/projector_out:
#   projectors 1-4  the blend output (7680x1080) cut into 4 sections, section N on projector N;
#   projectors 5-6  Kantan Mapper kantanMapper_P56's canvas (4480x1080): its left 1920 px on projector 5,
#                   its right 2560 px on projector 6 (black if that mapper doesn't exist yet - make it with
#                   add_kantan_p56.py, then run this again).
# Each window shows "PROJECTOR N" over its picture while the component's Identify toggle is on, or a solid
# test colour while Testcolours is on. The Chatbot Designer's "Set up the projectors" step (Immersive
# Media, 5) shows those numbers and swaps which projector gets which screen.
#
# Running it again keeps each window on the screen it was on - found by the screen's POSITION (the
# receiver stores it as 'screen_at'), because TouchDesigner renumbers monitors when one is plugged in or
# out - and keeps whether Identify / Testcolours were on.
# To close the windows:
#     [w.par.winclose.pulse() for w in op('/project1/projector_out').findChildren(type=windowCOMP)]

SOURCE = '/project1/MAPPER/projectorBlend/out1'
BLENDED = 4                      # projectors 1-4 share the blend
P56 = '/project1/MAPPER/kantanMapper_P56/out1'
EXTRA = {5: (0.0, 1920 / 4480), 6: (1920 / 4480, 1.0)}  # projector: (crop left, crop right) of P56's canvas
PROJECTORS = BLENDED + len(EXTRA)

# Which screen each projector is, counting the projector screens (every monitor but the main one) from
# the left, used only for a window with no screen remembered. On the studio Mac since 2026-11-09 the
# screens from the left are: projector 5, projector 6 (the new ones, left of the main screen), then the
# wall projectors 1, 2, 3, 4. If they're rearranged, fix them in the app's projector step instead.
SCREEN_OF_PROJECTOR = {1: 3, 2: 4, 3: 5, 4: 6, 5: 1, 6: 2}

# Test Colours: each projector a solid colour and its number, without the blend, so the light mixes where
# neighbours overlap on the wall (red + green = yellow, green + blue = cyan, ...).
TEST_COLOURS = {1: (1, 0, 0), 2: (0, 1, 0), 3: (0, 0, 1), 4: (1, 1, 1), 5: (1, 0, 1), 6: (0, 1, 1)}

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


def sized(o, w, h):
    setp(o, 'outputresolution', 'custom')
    setp(o, 'resolutionw', w)
    setp(o, 'resolutionh', h)


# The projector screens: every monitor except the primary, left to right.
screens = sorted([m for m in monitors if not m.isPrimary], key=lambda m: (m.left, m.top))
if len(screens) < PROJECTORS:
    print('  ! Only %d projector screens found (need %d) - check they are on and extending' % (len(screens), PROJECTORS))
by_index = {m.index: m for m in screens}


def monitor_at(at):
    for m in screens:
        if at and m.left == at[0] and m.top == at[1]:
            return m
    return None


old = op('/project1/projector_out')
# Each projector's screen as it was: by remembered position first, else by its (possibly stale) number.
kept = {}
identify, testcolours = True, False
if old is not None:
    identify = bool(getattr(old.par, 'Identify', None) and old.par.Identify.eval())
    testcolours = bool(getattr(old.par, 'Testcolours', None) and old.par.Testcolours.eval())
    for w in old.findChildren(type=windowCOMP, depth=1):
        if not w.digits:
            continue
        m = monitor_at(w.fetch('screen_at', None, search=False)) or by_index.get(w.par.display.eval())
        if m is not None:
            kept[w.digits] = m
    for w in old.findChildren(type=windowCOMP):
        w.par.winclose.pulse()
    old.destroy()

out = op('/project1').create(baseCOMP, 'projector_out')
out.nodeX, out.nodeY = 0, -400
page = out.appendCustomPage('Output')
page.appendToggle('Identify', label='Show Projector Numbers')
page.appendToggle('Testcolours', label='Test Colours')
out.par.Identify = identify
out.par.Testcolours = testcolours
src = out.create(selectTOP, 'blend')
src.par.top = SOURCE
src.nodeX, src.nodeY = -800, 0
if op(P56) is not None:
    p56 = out.create(selectTOP, 'p56')
    p56.par.top = P56
    p56.nodeX, p56.nodeY = -800, -680
else:
    p56 = None
    print('  ! %s not found - projectors 5 and 6 show black (run add_kantan_p56.py, then this again)' % P56)

used = set()
for n in range(1, PROJECTORS + 1):
    y = -(n - 1) * 150
    # Its screen: kept, else the default (if that screen isn't already taken).
    m = kept.get(n)
    if m is None or m.index in used:
        k = SCREEN_OF_PROJECTOR.get(n, n)
        m = screens[k - 1] if k <= len(screens) and screens[k - 1].index not in used else None
    if m is None:
        m = next((s for s in screens if s.index not in used), None)
    if m is not None:
        used.add(m.index)
    w, h = (m.width, m.height) if m is not None else (1920, 1080)

    # The picture.
    if n <= BLENDED:
        pic = out.create(cropTOP, 'section%d' % n)
        pic.inputConnectors[0].connect(src)
        setp(pic, 'cropleft', (n - 1) / BLENDED)
        setp(pic, 'cropright', n / BLENDED)
    elif p56 is not None:
        pic = out.create(cropTOP, 'kantan%d' % n)
        pic.inputConnectors[0].connect(p56)
        setp(pic, 'cropleft', EXTRA[n][0])
        setp(pic, 'cropright', EXTRA[n][1])
    else:
        pic = out.create(constantTOP, 'black%d' % n)
        sized(pic, w, h)
        setp(pic, 'colorr', 0)
        setp(pic, 'colorg', 0)
        setp(pic, 'colorb', 0)
        setp(pic, 'alpha', 1)
    pic.nodeX, pic.nodeY = -400, y

    tag = out.create(textTOP, 'tag%d' % n)
    tag.nodeX, tag.nodeY = -400, y - 60
    setp(tag, 'text', 'PROJECTOR %d' % n)
    sized(tag, w, h)
    setp(tag, 'fontsizex', 160)
    setp(tag, 'alignx', 'center')
    setp(tag, 'aligny', 'center')
    setp(tag, 'bgalpha', 0)
    over = out.create(overTOP, 'tagged%d' % n)
    over.inputConnectors[0].connect(tag)
    over.inputConnectors[1].connect(pic)
    over.nodeX, over.nodeY = -200, y

    solid = out.create(constantTOP, 'colour%d' % n)
    solid.nodeX, solid.nodeY = -400, y - 120
    sized(solid, w, h)
    r, g, b = TEST_COLOURS.get(n, (1, 1, 1))
    setp(solid, 'colorr', r)
    setp(solid, 'colorg', g)
    setp(solid, 'colorb', b)
    num = out.create(textTOP, 'testnumber%d' % n)
    num.nodeX, num.nodeY = -200, y - 120
    setp(num, 'text', str(n))
    sized(num, w, h)
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
    sw.inputConnectors[0].connect(pic)
    sw.inputConnectors[1].connect(over)
    sw.inputConnectors[2].connect(test)
    sw.par.index.expr = '2 if parent().par.Testcolours else (1 if parent().par.Identify else 0)'
    sw.nodeX, sw.nodeY = 0, y

    win = out.create(windowCOMP, 'window%d' % n)
    win.nodeX, win.nodeY = 200, y
    setp(win, 'winop', sw.path)
    setp(win, 'justifyoffsetto', 'specifydisplay')
    if m is not None:
        setp(win, 'display', m.index)
        win.store('screen_at', [m.left, m.top])
    setp(win, 'size', 'fill')
    setp(win, 'borders', False)
    setp(win, 'alwaysontop', True)
    win.par.winopen.pulse()
    print('  projector %d: %s -> monitor %s (%dx%d at x %s)%s' % (
        n, 'section %d of the blend' % n if n <= BLENDED else 'kantanMapper_P56',
        m.index if m else '?', w, h, m.left if m else '?', '' if n in kept else '  [default screen]'))

op('/').time.play = True
for p in problems:
    print('  ! ' + p)
print('Projector output open on %d screens.' % min(PROJECTORS, len(screens)))
