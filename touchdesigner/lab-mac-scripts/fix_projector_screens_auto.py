# Puts the six projector windows on their screens whichever way macOS has arranged the displays, remembers
# the positions (screen_at) and reopens the windows. Log -> fix_projector_screens_auto.log
#
# macOS flips between two arrangements on this Mac (seen 2026-11-09/10/11):
#   A  [P5 1920][P6 2560][Acer][P1][P2][P3][P4]      two projectors left of the Acer
#   B  [Acer][P6 2560][P5][P1][P2][P3][P4]           everything right of the Acer
# Rule: the 2560-wide screen is projector 6. Of the five 1920-wide projector screens, left to right:
# the first is projector 5, the other four are wall projectors 1, 2, 3, 4.
# (If two wall projectors show each other's picture, macOS reshuffled identical Epsons: use the swap
#  message, e.g. {"type":"projectors","action":"assign","shows":[2,1,3,4,5,6]}.)
# Run in the Textport:
#   exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fix_projector_screens_auto.py').read())
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/fix_projector_screens_auto.log'
L = []
try:
    po = op('/project1/projector_out')
    wins = {w.digits: w for w in po.findChildren(type=windowCOMP, depth=1)}
    mons = sorted(monitors, key=lambda m: m.left)
    for m in mons:
        L.append('monitor %d: %dx%d at %d,%d primary=%s' % (m.index, m.width, m.height, m.left, m.top, m.isPrimary))
    wide = [m for m in mons if not m.isPrimary and m.width == 2560]
    small = [m for m in mons if not m.isPrimary and m.width == 1920]
    if len(wins) != 6 or len(wide) != 1 or len(small) != 5:
        L.append('NOT CHANGED: expected one 2560 screen and five 1920 screens besides the Acer')
    else:
        screen = {6: wide[0], 5: small[0], 1: small[1], 2: small[2], 3: small[3], 4: small[4]}
        for n in sorted(wins):
            w, m = wins[n], screen[n]
            L.append('window%d display %s -> %d, screen_at %r -> %r' % (
                n, w.par.display.eval(), m.index, w.fetch('screen_at', None, search=False), [m.left, m.top]))
            w.par.winclose.pulse()
            w.par.display = m.index
            w.store('screen_at', [m.left, m.top])
        # One at a time, a few frames apart: opened together, one window sometimes does not stay open.
        for k, n in enumerate(sorted(wins)):
            run('op(args[0]).par.winopen.pulse()', wins[n].path, delayFrames=15 + 12 * k)
        L.append('DONE')
except Exception as ex:
    L.append('FAILED: %r' % (ex,))
open(OUT, 'w').write('\n'.join(L))
print('fix_projector_screens_auto: %s' % L[-1])
