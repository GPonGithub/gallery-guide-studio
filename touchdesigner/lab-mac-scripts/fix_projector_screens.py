# One-off fix (2026-11-09) after the two new projectors were plugged in.
#
# macOS put the new projectors to the LEFT of the others, so TouchDesigner's monitor numbers all moved
# up by 2 (0 = new PJ (4), 1 = new PJ (5) 2560 wide, 2 = Acer, 3-6 = the four wall projectors). Windows
# 1-4 still sat on their own screens, but their saved "display" numbers were now 2 too low, so
# add_projectors_5_6.py took monitor 5 (projector 3's screen) as free and put projector 6 there.
#
# This sets windows 1-4 to their real screens (+2, once only), projector 5 to monitor 0, projector 6 to
# monitor 1 (sized 2560x1080), and reopens all six windows.
#     exec(open('/full/path/to/fix_projector_screens.py').read())

po = op('/project1/projector_out')
if not po.fetch('displays_shifted_20261109', False):
    for n in (1, 2, 3, 4):
        w = po.op('window%d' % n)
        w.par.display = w.par.display.eval() + 2
    po.store('displays_shifted_20261109', True)
    print('windows 1-4 moved +2')
else:
    print('windows 1-4 already fixed - left alone')

po.op('window5').par.display = 0
po.op('window6').par.display = 1
for name in ('black6', 'tag6', 'colour6', 'testnumber6'):
    po.op(name).par.resolutionw = 2560

for n in range(1, 7):
    po.op('window%d' % n).par.winclose.pulse()
run("[op('/project1/projector_out/window%d' % n).par.winopen.pulse() for n in range(1, 7)]", delayFrames=10)
op('/').time.play = True
for n in range(1, 7):
    d = po.op('window%d' % n).par.display.eval()
    m = [x for x in monitors if x.index == d]
    print('  projector %d -> monitor %d %s' % (n, d, ('%dx%d at x %d' % (m[0].width, m[0].height, m[0].left)) if m else '?'))
