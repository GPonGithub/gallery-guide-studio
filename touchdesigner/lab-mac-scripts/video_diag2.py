# Measures frame timing while the Immersive Lab's videos play (about 5 s), then puts every
# movie player back as it was. Writes video_diag2.txt beside this file.
# Run in the Textport:
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag2.py').read())
import time, traceback

OUT2 = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag2.txt'
FRAMES = 300
lab = op('/project1/immersive_lab')
movies = [m for m in lab.findChildren(type=moviefileinTOP, depth=1) if m.name.startswith('movie')]
st = {'times': [], 'was': {m.path: m.par.play.eval() for m in movies}}


def cooks():
    out = {}
    for o in root.findChildren(type=OP):
        try:
            out[o.path] = o.totalCooks
        except Exception:
            pass
    return out


def tick():
    try:
        st['times'].append(time.perf_counter())
        if len(st['times']) < FRAMES:
            run("op('/').fetch('vd2')['tick']()", delayFrames=1)
        else:
            finish()
    except Exception:
        open(OUT2, 'w').write(traceback.format_exc())


def finish():
    try:
        after = cooks()
        for m in movies:
            m.par.play = st['was'][m.path]
        t = st['times']
        gaps = [(b - a) * 1000 for a, b in zip(t, t[1:])]
        gaps_sorted = sorted(gaps)
        lines = ['frames %d over %.2f s = %.1f fps' % (len(gaps), t[-1] - t[0], len(gaps) / (t[-1] - t[0]))]
        lines.append('frame ms: median %.1f  p95 %.1f  max %.1f' % (
            gaps_sorted[len(gaps) // 2], gaps_sorted[int(len(gaps) * 0.95)], gaps_sorted[-1]))
        for lim in (20, 25, 34, 50):
            lines.append('  frames longer than %d ms: %d' % (lim, sum(g > lim for g in gaps)))
        lines.append('gaps: ' + ' '.join('%.0f' % g for g in gaps))
        lines.append('--- playing during the test')
        for m in movies:
            if ONLY is not None and m.name not in ONLY:
                continue
            lines.append('%s %s %dx%d' % (m.name, m.par.file.eval().split('/')[-1][:60], m.width, m.height))
        lines.append('--- ops cooking most frames (cooks in test, cpu ms, gpu ms)')
        rows = []
        for path, n0 in st['before'].items():
            n = after.get(path, n0) - n0
            if n >= FRAMES * 0.5:
                o = op(path)
                rows.append((o.cpuCookTime + getattr(o, 'gpuCookTime', 0), n, o.cpuCookTime, getattr(o, 'gpuCookTime', 0), path, o.OPType))
        rows.sort(reverse=True)
        lines.append('count: %d' % len(rows))
        for r in rows[:60]:
            lines.append('%6.2f  n=%d cpu=%.2f gpu=%.2f  %s (%s)' % r)
        open(OUT2, 'w').write('\n'.join(lines))
        print('  video_diag2.txt written; players put back')
    except Exception:
        for m in movies:
            m.par.play = st['was'][m.path]
        open(OUT2, 'w').write(traceback.format_exc())


op('/').store('vd2', {'tick': tick})
ONLY = globals().get('VD_ONLY')  # e.g. VD_ONLY = ['movie2', 'movie3'] before exec: play just those
for m in movies:
    if ONLY is not None and m.name not in ONLY:
        continue
    if m.par.file.eval() and not m.par.file.eval().lower().endswith(('.tif', '.png', '.jpg')):
        m.par.play = True
st['before'] = cooks()
run("op('/').fetch('vd2')['tick']()", delayFrames=30)
print('  playing the lab videos and measuring for about 5 s...')
