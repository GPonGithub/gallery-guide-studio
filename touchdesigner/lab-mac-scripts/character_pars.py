# Writes every parameter of area 11's AI character viewer (Web Render TOP) to character_pars.txt.
w = op('/project1/immersive_lab/character11')
rows = ['%s/%s = %r' % (p.page.name if p.page else '-', p.name, p.eval()) for p in w.pars()]
rows.append('cookFrame=%s absFrame=%s time.play=%s' % (w.cookFrame, absTime.frame, op('/').time.play))
open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/character_pars.txt', 'w').write('\n'.join(rows) + '\n')
print('character_pars.txt written')
