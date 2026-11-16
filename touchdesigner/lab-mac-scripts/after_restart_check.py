# Read-only: after reopening the StudioMap, are the projector windows open, the app link listening,
# the speakers on the GigaPort, and Greg's background players still paused? Writes after_restart_check.txt.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/after_restart_check.py').read())
import traceback, json
OUTC = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/after_restart_check.txt'
L = []
try:
    L.append('file: %s  realTime=%s cookRate=%s play=%s' % (project.name, project.realTime, project.cookRate, op('/').time.play))
    for n in (1, 2, 3, 4):
        w = op('/project1/projector_out/window%d' % n)
        L.append('projector window %d: open=%s display=%s' % (n, w.isOpen if w else None, w.par.display.eval() if w else None))
    lab = op('/project1/immersive_lab')
    r = lab.op('receiver')
    L.append('receiver active=%s port=%s clients=%s' % (r.par.active.eval(), r.par.port.eval(), getattr(r, 'webSocketConnections', '?')))
    a = lab.op('audio_out')
    L.append('audio_out device=%s active=%s chans=%s' % (a.par.device.eval(), a.par.active.eval(), a.numChans))
    L.append('sp_ nodes: %d' % len(lab.findChildren(name='sp_*', depth=1)))
    paused = json.load(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/mapper_players_paused.json'))
    paths = paused if isinstance(paused, list) else list(paused)
    playing = [p for p in paths if op(p) is not None and op(p).par.play.eval()]
    L.append('Greg background players listed: %d, playing again: %s' % (len(paths), playing))
except Exception:
    L.append(traceback.format_exc())
open(OUTC, 'w').write('\n'.join(L))
print('  after_restart_check.txt written')
