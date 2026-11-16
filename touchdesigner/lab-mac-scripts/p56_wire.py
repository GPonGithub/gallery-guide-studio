# Feeds kantanMapper_P56's output to projector windows 5 and 6 through a Select TOP (wires can't cross
# networks). Log: p56_wire.log
import numpy
LOG = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/p56_wire.log'
log = []
say = lambda *a: log.append(' '.join(str(x) for x in a))
try:
    po = op('/project1/projector_out')
    s = po.op('p56') or po.create(selectTOP, 'p56')
    s.par.top = '/project1/MAPPER/kantanMapper_P56/out1'
    s.nodeX, s.nodeY = -800, -680
    for n in (5, 6):
        c = po.op('kantan%d' % n)
        c.inputConnectors[0].connect(s)
        say('kantan%d inputs' % n, [i.path for i in c.inputs])
    for n in (5, 6):
        t = po.op('projector%d' % n)
        a = t.numpyArray()
        say('projector%d %dx%d mean %s' % (n, t.width, t.height, numpy.round(a.reshape(-1, 4).mean(0), 3)))
except Exception:
    import traceback
    say(traceback.format_exc())
open(LOG, 'w').write('\n'.join(log))
print('p56_wire done')
