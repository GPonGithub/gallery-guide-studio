# Adds zones 1 and 3 to the running Immersive Lab, without rebuilding it (Kantan's shapes, the area
# labels and the Media Folder stay as they are):
#   - areas 12-17 in /project1/immersive_lab, each the same chain as areas 1-11
#     (12-14 = zone 1's faces 1-3 on projector 5; 15-17 = zone 3's faces 1-3 on projector 6);
#   - Projection Areas = 17, the now_playing rows, and the receiver's code from the build script;
#   - kantanMapper_P56's six shapes take their picture from those areas instead of the coloured,
#     labelled test textures (/project1/MAPPER/p56_textures/shape1...6, which stay: pointing a
#     shape's Texture back at one undoes it - the "before" paths are in the log).
# Safe to run again: what's there already is left alone. Log: add_zone_areas.log beside this file.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/add_zone_areas.py').read())
import ast
import traceback

HERE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/'
LOG = HERE + 'add_zone_areas.log'
BUILD = HERE + 'build_immersive_lab.py'
NEW = range(12, 18)
# Kantan item (its test label) -> area. From Graham's photos of the room:
#   zone 1: face 1 left wall = 5-1, face 2 right wall = 5-3, face 3 panel = 5-2
#   zone 3: face 1 right wall = 6-3, face 2 left wall = 6-2, face 3 panel = 6-1
SHAPE_AREA = {1: 12, 3: 14, 4: 13, 6: 17, 7: 16, 8: 15}

log = []
say = lambda *a: log.append(' '.join(str(x) for x in a))


def setp(o, name, value):
    p = getattr(o.par, name, None)
    if p is None:
        say('  ! %s has no parameter %s' % (o.path, name))
        return
    try:
        p.val = value
    except Exception as e:
        say('  ! %s.%s = %r: %s' % (o.path, name, value, e))


def sized(o):
    setp(o, 'outputresolution', 'custom')
    o.par.resolutionw.expr = 'parent().par.Width'
    o.par.resolutionh.expr = 'parent().par.Height'


def add_area(lab, a, y):
    black, shader = lab.op('black'), lab.op('placed_shader')
    movie = lab.create(moviefileinTOP, 'movie%d' % a)
    setp(movie, 'playmode', 'sequential')
    setp(movie, 'play', False)
    setp(movie, 'textendright', 'cycle')
    fit = lab.create(fitTOP, 'fit%d' % a)
    fit.inputConnectors[0].connect(movie)
    setp(fit, 'fit', 'fitoutside')
    sized(fit)
    col = lab.create(constantTOP, 'color%d' % a)
    sized(col)
    setp(col, 'alpha', 1)
    words = lab.create(textTOP, 'words%d' % a)
    sized(words)
    setp(words, 'alignx', 'center')
    setp(words, 'aligny', 'center')
    setp(words, 'fontsizex', 110)
    setp(words, 'wordwrap', True)
    setp(words, 'bgalpha', 1)
    sw = lab.create(switchTOP, 'switch%d' % a)
    raw = lab.create(switchTOP, 'raw%d' % a)
    for s, media in ((sw, fit), (raw, movie)):
        s.inputConnectors[0].connect(black)
        s.inputConnectors[1].connect(media)
        s.inputConnectors[2].connect(col)
        s.inputConnectors[3].connect(words)
        setp(s, 'index', 0)
    g = lab.create(glslTOP, 'placed%d' % a)
    g.inputConnectors[0].connect(sw)
    g.inputConnectors[1].connect(raw)
    setp(g, 'pixeldat', shader.path)
    sized(g)
    for i, name in enumerate(('uRow0', 'uRow1', 'uRow2', 'uPlaced')):
        for pname in ('vec%dname' % i, 'uniname%d' % i):
            if getattr(g.par, pname, None) is not None:
                setp(g, pname, name)
                break
        else:
            say('  ! %s: no uniform name parameter for %s' % (g.path, name))
    fade = lab.create(levelTOP, 'fade%d' % a)
    fade.inputConnectors[0].connect(g)
    setp(fade, 'brightness1', 1)
    area = lab.create(nullTOP, 'area%d' % a)
    area.inputConnectors[0].connect(fade)
    out = lab.create(outTOP, 'out%d' % a)
    out.inputConnectors[0].connect(area)
    for o, x, dy in ((movie, -200, 0), (fit, 0, 0), (col, 0, -50), (words, 0, -100), (sw, 200, 0),
                     (raw, 200, -60), (g, 300, 0), (fade, 350, 0), (area, 400, 0), (out, 600, 0)):
        o.nodeX, o.nodeY = x, y + dy
        o.viewer = False


try:
    lab = op('/project1/immersive_lab')
    if lab is None or lab.op('black') is None or lab.op('placed_shader') is None or lab.op('area11') is None:
        raise Exception('immersive_lab (with black, placed_shader and area11) not found')
    say('before: Areas = %s, %dx%d' % (lab.par.Areas.eval(), lab.par.Width.eval(), lab.par.Height.eval()))
    y11 = lab.op('movie11').nodeY
    for a in NEW:
        if lab.op('area%d' % a) is not None:
            say('area%d is there already - left alone' % a)
            continue
        add_area(lab, a, y11 - (a - 11) * 160)
        say('area%d made' % a)

    nowt = lab.op('now_playing')
    for a in NEW:
        if nowt['area %d' % a, 0] is None:
            first_sound = nowt['sound 1', 0]
            row = ['area %d' % a, '', '', '', '']
            if first_sound is not None:
                nowt.insertRow(row, first_sound.row)
            else:
                nowt.appendRow(row)
    say('now_playing rows: %d' % nowt.numRows)

    p = lab.par.Areas
    p.readOnly = False
    p.val = max(NEW)
    p.readOnly = True

    tree = ast.parse(open(BUILD).read())
    code = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                and getattr(n.targets[0], 'id', '') == 'CALLBACKS')
    cb = lab.op('receiver_callbacks')
    cb.text = code
    say('receiver code reloaded; it now sees AREAS = %s' % cb.module.AREAS)

    shapes = op('/project1/MAPPER/kantanMapper_P56/project/allShapes')
    if shapes is None:
        say('! kantanMapper_P56 not found - shapes not connected')
    else:
        for n, a in SHAPE_AREA.items():
            item = shapes.op('item%d' % n)
            prm = item.op('parameters') if item is not None else None
            if prm is None or not hasattr(prm.par, 'Texture'):
                say('! item%d: not found - not connected' % n)
                continue
            before = prm.par.Texture.eval()
            prm.par.Texture = lab.op('area%d' % a).path
            prm.par.Showtexture = True
            say('item%d %-10s %s -> %s' % (n, prm.par.Name.eval(), before, prm.par.Texture.eval()))
        op('/').time.play = True  # Kantan only redraws while the timeline plays.
    missing = [n for a in NEW for n in ('movie', 'fit', 'color', 'words', 'switch', 'raw', 'placed', 'fade', 'area', 'out')
               if lab.op('%s%d' % (n, a)) is None]
    errs = [o.path + ': ' + o.errors() for a in NEW for o in (lab.op('placed%d' % a), lab.op('area%d' % a)) if o is not None and o.errors()]
    say('missing: %s' % (missing or 'none'))
    say('errors: %s' % (errs or 'none'))
    say('DONE')
except Exception:
    say('! stopped:', traceback.format_exc())
open(LOG, 'w').write('\n'.join(log) + '\n')
print('\n'.join(log))
