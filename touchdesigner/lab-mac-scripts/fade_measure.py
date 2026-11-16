# Measures a fade frame by frame: fades area 11 out over 2 s (red), recording each frame's time, the
# fade11 brightness, whether fade11 / the Kantan render cooked, and the pixel formats along the chain.
# Writes fade_measure.txt. Run from the Textport:
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fade_measure.py').read())
P = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/'
lab = op('/project1/immersive_lab')
if not op('/').fetch('fm_on', False):
    op('/').store('fm_on', True)
    op('/').store('fm', [])
    rc = lab.op('receiver_callbacks').module
    rc.show({'area': 11, 'kind': 'color', 'value': '#ff0000'})
    op('/').store('fm_t0', absTime.seconds)
    rc.hide({'area': 11, 'fade': 2})
    for i in range(1, 151):
        run("exec(open(%r).read())" % (P + 'fade_measure.py'), delayFrames=i)
    print('  measuring the fade for 150 frames...')
else:
    f = lab.op('fade11')
    rows = op('/').fetch('fm')
    rows.append((absTime.frame, round(absTime.seconds - op('/').fetch('fm_t0'), 4), round(f.par.brightness1.eval(), 4),
                 f.cookFrame, str(f.par.brightness1.mode)))
    op('/').store('fm', rows)
    if len(rows) >= 150:
        L = ['frame  t  brightness  fade11.cookFrame  mode']
        L += ['%s' % (r,) for r in rows]
        for name in ('placed11', 'fade11', 'area11'):
            o = lab.op(name)
            fmt = getattr(o.par, 'format', None)
            L.append('%s format=%s pixelFormat=%s res=%dx%d' % (name, fmt.eval() if fmt is not None else '?', getattr(o, 'pixelFormat', '?'), o.width, o.height))
        k = op('/project1/MAPPER/kantanMapper1')
        L.append('cookRate=%s realTime=%s' % (project.cookRate, project.realTime))
        open(P + 'fade_measure.txt', 'w').write('\n'.join(L))
        op('/').unstore('fm'); op('/').unstore('fm_on'); op('/').unstore('fm_t0')
        print('  fade_measure.txt written')
