# Adds fades to an Immersive Lab that's already built (without rebuilding it, so Kantan's shapes, area
# labels and the Media Folder stay as they are): a levelTOP fadeN between each area's placedN and areaN,
# then the receiver code that drives them (from the build script beside this file).
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/add_fades.py').read())
lab = op('/project1/immersive_lab')
added = []
for a in range(1, int(lab.par.Areas.eval()) + 1):
    if lab.op('fade%d' % a) is not None:
        continue
    g, area = lab.op('placed%d' % a), lab.op('area%d' % a)
    if g is None or area is None:
        print('  ! area %d: placed%d or area%d missing' % (a, a, a))
        continue
    fade = lab.create(levelTOP, 'fade%d' % a)
    fade.nodeX, fade.nodeY = (g.nodeX + area.nodeX) // 2, g.nodeY - 60
    fade.inputConnectors[0].connect(g)
    fade.par.brightness1 = 1
    area.inputConnectors[0].connect(fade)
    added.append(a)
print('Fades added to areas: %s' % (added or 'none needed'))
exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/update_receiver.py').read())
