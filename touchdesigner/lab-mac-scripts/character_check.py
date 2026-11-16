# Reports what area 11 and its AI character are doing, and whether the projector chain shows anything.
# Run in the Textport:
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/character_check.py').read())
# Writes character_check.txt beside this file.
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/character_check.txt'
lines = []
lab = op('/project1/immersive_lab')


def sample(t):
    try:
        return [round(sum(t.sample(u=u, v=v)[:3]) / 3, 3) for u, v in ((0.5, 0.5), (0.25, 0.5), (0.75, 0.5))]
    except Exception as e:
        return 'sample failed: %s' % e


for name in ('switch11', 'raw11', 'placed11', 'fade11', 'area11', 'color11', 'character11'):
    o = lab.op(name)
    if o is None:
        lines.append('%s: missing' % name)
        continue
    info = '%s: %dx%d errors=%r warnings=%r avg=%s' % (name, o.width, o.height, o.errors(), o.warnings(), sample(o))
    if name.startswith('switch') or name.startswith('raw'):
        info += ' index=%s inputs=%s' % (o.par.index.eval(), [i.name for i in o.inputs])
    if name.startswith('fade'):
        info += ' brightness=%s' % o.par.brightness1.eval()
    lines.append(info)
w = lab.op('character11')
if w is not None:
    for p in w.pars():
        if p.name in ('active', 'url', 'outputresolution', 'resolutionw', 'resolutionh') or 'audio' in p.name:
            lines.append('  character11.%s = %r' % (p.name, p.eval()))
lines.append('kantan area texture TOPs:')
for path in ('/project1/area_labels/out11', '/project1/area_labels'):
    o = op(path)
    lines.append('  %s: %s' % (path, 'missing' if o is None else (sample(o) if o.isTOP else o.OPType)))
po = op('/project1/projector_out')
if po is not None:
    for t in po.findChildren(type=TOP, depth=1)[:12]:
        lines.append('projector_out/%s avg=%s' % (t.name, sample(t)))
k = op('/project1/MAPPER/kantanMapper1')
if k is not None:
    for t in k.findChildren(type=TOP, depth=1)[:8]:
        lines.append('kantan/%s avg=%s' % (t.name, sample(t)))
open(OUT, 'w').write('\n'.join(str(l) for l in lines) + '\n')
print('character_check.txt written')
