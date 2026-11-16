# Writes what TouchDesigner knows about area 10 (and the latest messages) to area10_diag.txt beside this file.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/area10_diag.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/area10_diag.txt'
lines = []
say = lambda *a: lines.append(' '.join(str(x) for x in a))
try:
    lab = op('/project1/immersive_lab')
    say('media folder:', lab.par.Mediafolder.eval())
    log = lab.op('message_log')
    say('## message_log (newest first)')
    for r in range(min(log.numRows, 30)):
        say(' | '.join(c.val for c in log.row(r)))
    now = lab.op('now_playing')
    say('## now_playing')
    for r in range(now.numRows):
        say(' | '.join(c.val for c in now.row(r)))
    for a in (6,):
        m, sw, raw, g, f = (lab.op('%s%d' % (n, a)) for n in ('movie', 'switch', 'raw', 'placed', 'fade'))
        say('## area', a)
        say('movie file:', m.par.file.eval(), 'res', m.width, m.height)
        say('switch index:', sw.par.index.eval(), 'raw index:', raw.par.index.eval())
        say('fade brightness:', f.par.brightness1.eval())
        for i in range(4):
            names = [p for p in g.pars('vec%d*' % i)]
            say('placed vec%d:' % i, [(p.name, p.eval()) for p in names])
        say('area null input:', [i.path for i in lab.op('area%d' % a).inputs])
    labels = op('/project1/area_labels')
    say('## area_labels', labels is not None, labels and labels.par.Shownumbers.eval())
    shapes = op('/project1/MAPPER/kantanMapper1/project/allShapes')
    for item in shapes.findChildren(name='item*', depth=1):
        p = item.op('parameters')
        if p is not None and hasattr(p.par, 'Texture'):
            say(p.par.Name.eval(), '->', p.par.Texture.eval())
except Exception as e:
    import traceback
    say('ERROR', traceback.format_exc())
open(OUT, 'w').write('\n'.join(lines) + '\n')
print('area10_diag written, %d lines' % len(lines))
