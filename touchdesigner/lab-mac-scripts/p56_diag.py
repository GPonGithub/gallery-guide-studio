# Read-only: where the projector 5/6 picture goes dark. Log: p56_diag.log
import numpy
LOG = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/p56_diag.log'
log = []
say = lambda *a: log.append(' '.join(str(x) for x in a))
def mean(path):
    t = op(path)
    if t is None:
        return 'missing'
    try:
        a = t.numpyArray()
        return '%dx%d mean %s max %s' % (t.width, t.height, numpy.round(a.reshape(-1, 4).mean(0), 3), numpy.round(a.reshape(-1, 4).max(0), 3))
    except Exception as e:
        return 'err %s' % e
try:
    K = '/project1/MAPPER/kantanMapper_P56'
    for p in (K + '/out1', K + '/out2', K + '/project/out1', K + '/project/out2', K + '/cache1',
              '/project1/MAPPER/p56_textures/shape1', '/project1/projector_out/kantan5', '/project1/projector_out/kantan6',
              '/project1/projector_out/projector5', '/project1/projector_out/projector6', '/project1/MAPPER/kantanMapper1/out1'):
        say(p, '->', mean(p))
    sw = op('/project1/projector_out/projector5')
    say('projector5 index', sw.par.index.eval(), 'inputs', [i.path for i in sw.inputs])
    say('kantan5 inputs', [i.path for i in op('/project1/projector_out/kantan5').inputs])
    kp = op(K + '/project')
    for it in sorted(kp.op('allShapes').findChildren(name='item*', depth=1), key=lambda o: o.digits):
        d = it.GetDefinition()
        say(it.name, d['parameters']['Name'], 'tex', d['parameters']['Texture'], d['parameters']['Showtexture'], d['shapeXform'][:120])
    K1 = op(K)
    say('K children', [c.name for c in K1.children])
    say('K out1 input', [i.path for i in K1.op('out1').inputs])
except Exception:
    import traceback
    say(traceback.format_exc())
open(LOG, 'w').write('\n'.join(log))
print('p56_diag done')
