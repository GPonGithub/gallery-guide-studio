# 2026-11-10: the Mac's display arrangement changed (all six projectors now sit to the right of the Acer),
# so the remembered screen positions of the projector windows match nothing. Windows 2, 3, 4 and 6 still
# land on their own screens; windows 1 and 5 do not. This points 5 and 1 at the two 1920-wide screens no
# other window uses (5 = the left one, 1 = the right one, next to projector 2), remembers every window's
# screen by its new position, and reopens the six windows. Log -> fix_projector_screens_2026_11_10.log
# Run in the Textport:
#   exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fix_projector_screens_2026_11_10.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fix_projector_screens_2026_11_10.log'
L = []
try:
    po = op('/project1/projector_out')
    wins = {w.digits: w for w in po.findChildren(type=windowCOMP, depth=1)}
    mons = sorted(monitors, key=lambda m: m.left)
    for m in mons:
        L.append('monitor %d: %dx%d at %d,%d primary=%s' % (m.index, m.width, m.height, m.left, m.top, m.isPrimary))
    for n in sorted(wins):
        w = wins[n]
        L.append('before window%d display=%s screen_at=%r open=%s' % (n, w.par.display.eval(), w.fetch('screen_at', None, search=False), w.isOpen))
    keep = {n: wins[n].par.display.eval() for n in (2, 3, 4, 6)}
    by_index = {m.index: m for m in mons}
    ok = (len(wins) == 6 and len(mons) == 7 and len(set(keep.values())) == 4
          and all(by_index[keep[n]].width == 1920 and not by_index[keep[n]].isPrimary for n in (2, 3, 4))
          and by_index[keep[6]].width == 2560)
    free = [m for m in mons if m.index not in keep.values() and not m.isPrimary and m.width == 1920]
    if not ok or len(free) != 2:
        L.append('NOT CHANGED: screens are not as expected (free=%r)' % ([m.index for m in free],))
    else:
        wins[5].par.display = free[0].index
        wins[1].par.display = free[1].index
        for n in sorted(wins):
            w = wins[n]
            m = by_index[w.par.display.eval()]
            w.store('screen_at', [m.left, m.top])
            w.par.winclose.pulse()
            L.append('after  window%d display=%d screen_at=%r' % (n, m.index, [m.left, m.top]))
        run('for p in args[0]: op(p).par.winopen.pulse()', [wins[n].path for n in sorted(wins)], delayFrames=10)
        L.append('DONE')
except Exception as ex:
    L.append('FAILED: %r' % (ex,))
open(OUT, 'w').write('\n'.join(L))
print('fix_projector_screens: %s' % L[-1])
