# Gives kantanMapper_P56's six shapes a coloured, labelled texture each (Kantan draws shapes through their
# texture), and logs how its shape list is stored. Log: p56_textures.log beside this file.
#     exec(open('/full/path/to/p56_textures.py').read())
LOG = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/p56_textures.log'
KEEP = [1, 3, 4, 6, 7, 8]
LABELS = ['5-1', '5-2', '5-3', '6-1', '6-2', '6-3']
COLOURS = [(0.95, 0.25, 0.25), (0.25, 0.8, 0.35), (0.3, 0.45, 0.95),
           (0.95, 0.8, 0.2), (0.85, 0.3, 0.85), (0.2, 0.8, 0.85)]
log = []
say = lambda *a: log.append(' '.join(str(x) for x in a))
try:
    M = op('/project1/MAPPER')
    K = M.op('kantanMapper_P56')
    kp = K.op('project')
    T = M.op('p56_textures') or M.create(baseCOMP, 'p56_textures')
    T.nodeX, T.nodeY = K.nodeX + 300, K.nodeY
    for i, n in enumerate(KEEP):
        c = T.op('colour%d' % (i + 1)) or T.create(constantTOP, 'colour%d' % (i + 1))
        c.par.outputresolution = 'custom'
        c.par.resolutionw, c.par.resolutionh = 800, 800
        c.par.colorr, c.par.colorg, c.par.colorb = COLOURS[i]
        c.par.alpha = 1
        c.nodeX, c.nodeY = 0, -i * 150
        t = T.op('label%d' % (i + 1)) or T.create(textTOP, 'label%d' % (i + 1))
        t.par.outputresolution = 'custom'
        t.par.resolutionw, t.par.resolutionh = 800, 800
        t.par.text = LABELS[i]
        t.par.fontsizex = 260
        t.par.alignx, t.par.aligny = 'center', 'center'
        t.par.fontcolorr = t.par.fontcolorg = t.par.fontcolorb = 0
        t.par.bgalpha = 0
        t.nodeX, t.nodeY = 0, -i * 150 - 60
        o = T.op('shape%d' % (i + 1)) or T.create(overTOP, 'shape%d' % (i + 1))
        o.inputConnectors[0].connect(t)
        o.inputConnectors[1].connect(c)
        o.nodeX, o.nodeY = 200, -i * 150
        prm = kp.op('allShapes').op('item%d' % n).op('parameters')
        prm.par.Texture = o.path
        prm.par.Showtexture = True
        say('item%d texture -> %s' % (n, o.path))
    for name in ('tree', 'allShapes/table1', 'allShapes/elements', 'allShapes/selectTree'):
        d = kp.op(name)
        if d is None:
            say('## %s: none' % name)
            continue
        say('## %s (%s) %d rows' % (name, d.OPType, d.numRows if hasattr(d, 'numRows') else -1))
        if hasattr(d, 'rows'):
            for r in d.rows()[:14]:
                say('   ' + ' | '.join(c.val[:40] for c in r[:8]))
        if hasattr(d, 'inputs'):
            say('   inputs: %s' % [i.path for i in d.inputs])
    rep = kp.op('allShapes/replicator1')
    say('## replicator1 template:', rep.par.template.eval() if rep else None)
    out = K.op('out1')
    import numpy
    a = out.numpyArray()
    say('## P56 out1 %dx%d mean rgba %s' % (out.width, out.height, numpy.round(a.reshape(-1, 4).mean(0), 3)))
except Exception as e:
    import traceback
    say('! stopped:', traceback.format_exc())
open(LOG, 'w').write('\n'.join(log))
print('p56_textures done')
