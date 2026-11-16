# Read-only: the area fade levels and their modes now. Writes fade_check.txt.
lab = op('/project1/immersive_lab')
L = []
for a in range(1, 12):
    f = lab.op('fade%d' % a)
    p = f.par.brightness1
    L.append('fade%d mode=%s val=%.3f expr=%s input=%s' % (a, p.mode, p.eval(), p.expr, f.inputs[0].name if f.inputs else None))
L.append('fades=%r' % (lab.fetch('fades', None),))
open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fade_check.txt', 'w').write('\n'.join(L))
