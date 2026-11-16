# Read-only: writes how /project1/MAPPER and kantanMapper1 are built to kantan_probe.txt beside this file.
#     exec(open('/full/path/to/kantan_probe.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_probe.txt'
L = []
p = L.append
M = op('/project1/MAPPER')
p('== MAPPER children')
for c in M.children:
    ins = [i.path for i in c.inputs] if hasattr(c, 'inputs') else []
    p('%s  %s  in=%s' % (c.name, c.OPType, ins))
K = op('/project1/MAPPER/kantanMapper1')
p('== kantanMapper1 custom pars')
for par in K.customPars:
    p('  %s (%s) = %r' % (par.name, par.page.name, par.eval() if not par.isPulse else 'pulse'))
p('== kantanMapper1 children')
for c in K.children:
    p('  %s %s' % (c.name, c.OPType))
p('== kantanMapper1 outputs')
for i, oc in enumerate(K.outputConnectors):
    try:
        p('  out%d -> %s' % (i, [c.owner.path for c in oc.connections]))
    except Exception as e:
        p('  out%d ? %s' % (i, e))
p('  outputCOMPs: %s' % [o.path for o in K.outputs])
kp = op('/project1/MAPPER/kantanMapper1/project')
p('== project custom pars')
for par in kp.customPars:
    p('  %s = %r' % (par.name, par.eval() if not par.isPulse else 'pulse'))
p('== project ext members')
for e in kp.extensions:
    p('  ext %s: %s' % (type(e).__name__, [m for m in dir(e) if not m.startswith('__')]))
p('== project children')
for c in kp.children:
    p('  %s %s' % (c.name, c.OPType))
items = sorted(kp.op('allShapes').findChildren(name='item*', depth=1), key=lambda o: o.digits or 0)
p('== %d shapes' % len(items))
for it in items[:2]:
    p('  %s def=%r' % (it.name, it.GetDefinition()))
    pa = it.op('parameters')
    p('    pars: %s' % [(x.name, x.eval()) for x in pa.customPars if not x.isPulse])
p('== shape item ext members')
p('  ' + str([m for m in dir(items[0]) if m[:1].isupper()]))
B = op('/project1/MAPPER/projectorBlend')
if B:
    p('== projectorBlend custom pars')
    for par in B.customPars:
        p('  %s = %r' % (par.name, par.eval() if not par.isPulse else 'pulse'))
    p('  inputs: %s' % [i.path for i in B.inputs])
open(OUT, 'w').write('\n'.join(str(x) for x in L))
print('probe written', len(L), 'lines')
