# Read-only: is Greg's particle sim (or anything else in MAPPER) cooking every frame, and who uses it?
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag4.py').read())
import traceback
OUT4 = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag4.txt'
vd4 = {}


def vd4_snap():
    return {o.path: o.totalCooks for o in op('/project1').findChildren(type=OP) if hasattr(o, 'totalCooks')}


def vd4_finish():
    try:
        after = vd4_snap()
        L = ['frames: %d' % (absTime.frame - vd4['f0'])]
        rows = []
        for p, n in after.items():
            d = n - vd4['before'].get(p, n)
            if d > 0:
                o = op(p)
                rows.append((o.cpuCookTime + getattr(o, 'gpuCookTime', 0), d, p, o.OPType))
        rows.sort(reverse=True)
        L.append('--- ops that cooked in 60 frames, by last cook ms (total, cooks)')
        for r in rows[:40]:
            L.append('%8.2f  n=%d  %s (%s)' % r)
        sp = op('/project1/MAPPER/Sim_particles')
        if sp is not None:
            L.append('--- Sim_particles: display=%s render=%s allowCooking=%s' % (sp.display, sp.render, sp.allowCooking))
            for o in sp.findChildren(depth=1):
                extra = ''
                for name in ('numpoints', 'numPoints'):
                    if hasattr(o, name):
                        extra += ' %s=%s' % (name, getattr(o, name))
                L.append('  %s (%s) cooks=%s cpu=%.2f%s' % (o.name, o.OPType, o.totalCooks, o.cpuCookTime, extra))
            L.append('  used by: %s' % [c.owner.path for c in sp.outputConnectors for c in c.connections])
            L.append('  referenced by: %s' % [str(x) for x in getattr(sp, 'dependents', [])][:20])
    except Exception:
        L = [traceback.format_exc()]
    open(OUT4, 'w').write('\n'.join(L))
    print('  video_diag4.txt written')


vd4['before'] = vd4_snap()
vd4['f0'] = absTime.frame
op('/').store('vd4', vd4_finish)
run("op('/').fetch('vd4')()", delayFrames=60)
print('  watching 60 frames...')
