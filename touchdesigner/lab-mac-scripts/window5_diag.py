# Read-only: how window5 differs from window1 in /project1/projector_out -> window5_diag.txt
#   exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/window5_diag.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/window5_diag.txt'
L = []
try:
    po = op('/project1/projector_out')
    for m in sorted(monitors, key=lambda m: m.left):
        L.append('monitor %d: %dx%d at %d,%d primary=%s scale=%s' % (m.index, m.width, m.height, m.left, m.top, m.isPrimary, getattr(m, 'dpiScale', '?')))
    a, b = po.op('window1'), po.op('window5')
    for w in po.findChildren(type=windowCOMP, depth=1):
        L.append('%s open=%s display=%s x=%s y=%s w=%s h=%s screen_at=%r' % (
            w.name, w.isOpen, w.par.display.eval(), getattr(w, 'x', '?'), getattr(w, 'y', '?'),
            getattr(w, 'width', '?'), getattr(w, 'height', '?'), w.fetch('screen_at', None, search=False)))
    for p in b.pars():
        q = getattr(a.par, p.name, None)
        va, vb = (q.eval() if q is not None else None), p.eval()
        if va != vb or p.mode != (q.mode if q is not None else None):
            L.append('DIFF %s: window1=%r window5=%r mode5=%s expr5=%r' % (p.name, va, vb, p.mode, p.expr))
    for n in ('location', 'display', 'winoffsetx', 'winoffsety', 'winw', 'winh', 'size', 'borders', 'justifyh', 'justifyv', 'dpiscaling', 'single', 'area'):
        for w in (a, b):
            p = getattr(w.par, n, None)
            if p is not None:
                L.append('%s.%s = %r (%s)' % (w.name, n, p.eval(), p.mode))
except Exception as ex:
    L.append('FAILED: %r' % (ex,))
open(OUT, 'w').write('\n'.join(L))
print('window5_diag written, %d lines' % len(L))
