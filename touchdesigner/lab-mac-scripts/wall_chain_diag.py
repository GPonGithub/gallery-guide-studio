# Measures how bright each step of the wall-projector chain is (area 10 -> area_labels -> Kantan ->
# projectorBlend -> projector_out -> windows) and writes it to wall_chain_diag.txt beside this file.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/wall_chain_diag.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/wall_chain_diag.txt'
lines = []
say = lambda *a: lines.append(' '.join(str(x) for x in a))


def level(path):
    o = op(path)
    if o is None:
        return 'MISSING'
    try:
        a = o.numpyArray(delayed=False)
        return '%dx%d mean rgba %s' % (o.width, o.height, [round(float(v), 3) for v in a.reshape(-1, a.shape[-1]).mean(axis=0)])
    except Exception as e:
        return '%dx%d (no pixels: %s)' % (getattr(o, 'width', 0), getattr(o, 'height', 0), e)


try:
    say('timeline playing:', op('/').time.play, 'frame', op('/').time.frame, 'fps', round(project.cookRate, 1))
    for p in ['/project1/immersive_lab/area10', '/project1/area_labels/out10', '/project1/area_labels/out2',
              '/project1/MAPPER/kantanMapper1', '/project1/MAPPER/projectorBlend/out1']:
        say(p, '->', level(p))
    km = op('/project1/MAPPER/kantanMapper1')
    if km is not None:
        say('kantanMapper1 outputs:', [o.path for o in km.outputConnectors[0].connections] if km.outputConnectors else [])
        for c in km.findChildren(type=TOP, name='out*', depth=1):
            say('  ', c.path, '->', level(c.path))
    pb = op('/project1/MAPPER/projectorBlend')
    if pb is not None:
        say('projectorBlend inputs:', [i.path for i in pb.inputs])
        for c in pb.findChildren(type=TOP, depth=1)[:40]:
            if c.name.startswith(('in', 'out')):
                say('  ', c.path, '->', level(c.path))
    po = op('/project1/projector_out')
    say('projector_out:', po is not None)
    if po is not None:
        say('blend select ->', po.op('blend').par.top.eval(), level(po.op('blend').path))
        for n in range(1, 7):
            sw = po.op('projector%d' % n)
            w = po.op('window%d' % n)
            say('projector%d switch index' % n, sw.par.index.eval() if sw else None, '->', level(sw.path) if sw else '',
                '| window open:', w.isOpen if w is not None else None,
                'monitor', w.par.monitor.eval() if w is not None and hasattr(w.par, 'monitor') else '')
        for n in range(1, 5):
            say('section%d ->' % n, level(po.path + '/section%d' % n))
except Exception:
    import traceback
    say('ERROR', traceback.format_exc())
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('wall_chain_diag written, %d lines' % len(lines))
