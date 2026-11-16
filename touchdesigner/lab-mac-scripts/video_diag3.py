# Read-only: sizes and pixel formats along the chain to the projectors. Writes video_diag3.txt.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag3.py').read())
import traceback
OUT3 = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag3.txt'
L = []


def desc(o):
    s = '%s (%s) %sx%s' % (o.path, o.OPType, getattr(o, 'width', '?'), getattr(o, 'height', '?'))
    for name in ('format', 'outputresolution', 'resolutionw', 'resolutionh', 'resmult', 'antialias', 'top'):
        p = getattr(o.par, name, None)
        if p is not None:
            s += ' %s=%s' % (name, p.eval())
    s += ' in=[%s]' % ', '.join(i.path for i in o.inputs)
    return s


try:
    pb = op('/project1/MAPPER/projectorBlend')
    L.append('== projectorBlend children')
    for o in pb.findChildren(type=TOP, depth=1):
        L.append(desc(o))
    L.append('== projectorBlend inputs (outside)')
    for c in pb.inputConnectors:
        for i in c.connections:
            L.append('  conn ' + i.owner.path)
    L.append('== walk upstream from projectorBlend/in1 (via component inputs), 12 steps')
    o = pb
    for _ in range(12):
        ins = o.inputs
        if not ins:
            break
        o = ins[0]
        L.append(desc(o))
        if o.isCOMP:
            outs = o.findChildren(type=outTOP, depth=1)
            for x in outs:
                L.append('   out: ' + desc(x))
    km = op('/project1/MAPPER/kantanMapper1')
    if km is not None:
        L.append('== kantanMapper1 TOPs (depth 2)')
        for x in km.findChildren(type=TOP, maxDepth=2):
            L.append(desc(x))
        L.append('kantanMapper1 custom pars: ' + ', '.join('%s=%s' % (p.name, p.eval()) for p in km.customPars if p.name.lower().startswith(('res', 'width', 'height', 'canvas', 'output', 'format', 'aa', 'anti'))))
    L.append('== projector_out')
    for x in op('/project1/projector_out').findChildren(type=TOP, depth=1):
        L.append(desc(x))
    try:
        L.append('gpu: %s' % (app.gpus if hasattr(app, 'gpus') else '?'))
    except Exception:
        pass
except Exception:
    L.append(traceback.format_exc())
open(OUT3, 'w').write('\n'.join(L))
print('  video_diag3.txt written')
