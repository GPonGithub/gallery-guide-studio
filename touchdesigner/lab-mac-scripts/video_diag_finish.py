# Second half of video_diag.py (run by it 5 s later). Read-only.
import time, traceback
OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag.txt'
_diag = op('/').fetch('video_diag')
try:
    lines = []
    secs = time.time() - _diag['t0']
    frames = absTime.frame - _diag['f0']
    lines.append('measured fps: %.1f (%d frames in %.2f s)' % (frames / secs, frames, secs))
    lines.append('project.cookRate=%s realTime=%s timeline play=%s rate=%s' % (
        project.cookRate, project.realTime, op('/').time.play, op('/').time.rate))
    lines.append('file: %s' % project.name)
    lines.append('monitors: %s' % [(m.index, m.width, m.height, m.refreshRate if hasattr(m, 'refreshRate') else '?', m.isPrimary) for m in monitors])
    ops = root.findChildren(type=OP)
    lines.append('ops: %d' % len(ops))
    cost = []
    for o in ops:
        try:
            c = o.cpuCookTime + (o.gpuCookTime if hasattr(o, 'gpuCookTime') else 0)
        except Exception:
            continue
        if o.cookedThisFrame or c > 0.2:
            cost.append((c, o.cpuCookTime, getattr(o, 'gpuCookTime', 0), o.path, o.OPType))
    cost.sort(reverse=True)
    lines.append('--- top 40 by last cook time (ms: total cpu gpu)')
    for c in cost[:40]:
        lines.append('%7.2f %7.2f %7.2f  %s  (%s)' % c)
    lines.append('--- movie players')
    for o in root.findChildren(type=moviefileinTOP):
        try:
            lines.append('%s play=%s mode=%s cooked=%s %dx%d cpu=%.2f gpu=%.2f file=%s' % (
                o.path, o.par.play.eval(), o.par.playmode.eval(), o.cookedThisFrame, o.width, o.height,
                o.cpuCookTime, getattr(o, 'gpuCookTime', 0), o.par.file.eval()[-70:]))
        except Exception as e:
            lines.append('%s ? %s' % (o.path, e))
    lines.append('--- windows')
    for w in root.findChildren(type=windowCOMP):
        lines.append('%s open=%s display=%s vsync=%s' % (
            w.path, w.isOpen if hasattr(w, 'isOpen') else '?', w.par.display.eval(),
            w.par.vsyncmode.eval() if hasattr(w.par, 'vsyncmode') else '?'))
    open(OUT, 'w').write('\n'.join(lines))
    print('  video_diag.txt written')

except Exception:
    open(OUT, 'w').write(traceback.format_exc())
    print('  video_diag failed - see video_diag.txt')
