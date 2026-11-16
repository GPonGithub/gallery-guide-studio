# Records how bright area 11's AI character is, 10 times a second for 6 seconds, to see it move with the voice.
# Run in the Textport (start the voice first):
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/character_motion.py').read())
# Writes character_motion.txt beside this file.
STEP = r'''
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/character_motion.txt'
i = args[0]
a = op('/project1/immersive_lab/area11')
pts = ((0.5, 0.5), (0.5, 0.78), (0.62, 0.5))
row = ['%.1f' % (i / 10)] + ['%.3f' % (sum(a.sample(u=u, v=v)[:3]) / 3) for u, v in pts]
rows = op('/project1').fetch('cm_rows', [])
rows.append(' '.join(row))
op('/project1').store('cm_rows', rows)
if i == 59:
    open(OUT, 'w').write('t centre halo edge\n' + '\n'.join(rows) + '\n')
    op('/project1').unstore('cm_rows')
    print('character_motion.txt written')
'''
op('/project1').store('cm_rows', [])
for _i in range(60):
    run(STEP, _i, delayFrames=1 + _i * 6)
print('recording area 11 for 6 seconds...')
