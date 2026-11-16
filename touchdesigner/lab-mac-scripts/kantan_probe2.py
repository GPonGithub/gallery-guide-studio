# Read-only: Kantan's AddRect / DeleteShape / CopyShape code and a shape's transform -> kantan_probe2.txt
import inspect
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_probe2.txt'
L = []
kp = op('/project1/MAPPER/kantanMapper1/project')
for e in kp.extensions:
    for name in ('AddRect', 'DeleteShape', 'CopyShape', 'newId', 'RectReset', 'createLayer', 'AddLayer'):
        f = getattr(e, name, None)
        if f is None:
            continue
        try:
            L.append('##### %s.%s\n%s' % (type(e).__name__, name, inspect.getsource(f)))
        except Exception as ex:
            L.append('##### %s.%s  (no source: %s) sig=%s' % (type(e).__name__, name, ex, getattr(f, '__doc__', '')))
it = kp.op('allShapes').op('item1')
d = it.GetDefinition()
L.append('##### item1 def keys: %s' % list(d.keys()))
L.append('##### item1 shapeDef keys: %s' % list(d.get('shapeDef', {}).keys()))
for k, v in d.items():
    if k not in ('parameters', 'shapeDef'):
        L.append('%s = %r' % (k, v))
for k, v in d.get('shapeDef', {}).items():
    if k in ('shapeXform', 'pointOffset', 'keyOffset', 'xform', 'transform'):
        L.append('shapeDef.%s = %r' % (k, v))
L.append('##### allShapes children: %s' % [c.name for c in kp.op('allShapes').children][:40])
L.append('##### tree table:\n' + '\n'.join('\t'.join(c.val for c in r) for r in kp.op('tree').rows()[:20]))
K = op('/project1/MAPPER/kantanMapper1')
L.append('##### out1 res %dx%d, out2 res %dx%d' % (K.op('out1').width, K.op('out1').height, K.op('out2').width, K.op('out2').height))
open(OUT, 'w').write('\n'.join(L))
print('probe2 written')
