# Read-only: how big the Immersive Lab's tables are, and how many messages arrive per second.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag5.py').read())
import time, traceback
OUT5 = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag5.txt'
lab5 = op('/project1/immersive_lab')
vd5 = {'t0': time.time(), 'rows0': lab5.op('message_log').numRows}


def vd5_finish():
    try:
        L = []
        secs = time.time() - vd5['t0']
        log5 = lab5.op('message_log')
        L.append('message_log rows: %d (was %d %.1f s ago)' % (log5.numRows, vd5['rows0'], secs))
        for d in lab5.findChildren(type=DAT, depth=1):
            L.append('  %s (%s) rows=%s chars=%d' % (d.name, d.OPType, getattr(d, 'numRows', '?'), len(d.text)))
        L.append('newest 15 messages:')
        for r in range(min(16, log5.numRows)):
            L.append('  ' + ' | '.join(c.val[:80] for c in log5.row(r)))
        # Anything in the whole project with very large tables.
        big = sorted(((len(d.text), d.path) for d in root.findChildren(type=DAT) if d.isTable or True), reverse=True)[:12]
        L.append('largest DATs (chars):')
        for n, p in big:
            L.append('  %10d %s' % (n, p))
    except Exception:
        L = [traceback.format_exc()]
    open(OUT5, 'w').write('\n'.join(L))
    print('  video_diag5.txt written')


op('/').store('vd5', vd5_finish)
run("op('/').fetch('vd5')()", delayMilliSeconds=5000)
print('  counting messages for 5 s...')
