# Measures how big each area number really comes out in Kantan's picture and corrects it, so every
# number is the same height on the wall (area_labels.py's NUMBER_PX) and not stretched.
#
# Run it inside TouchDesigner (StudioMap, after area_labels.py) from the Textport:
#     exec(open('/full/path/to/number_calibrate.py').read())
# Kantan maps a picture differently for rectangles (over the rectangle's original size, then warped by
# its corner moves) and freeforms (over their outline), so the size can't be worked out from the shape
# alone. This shows one number at a time, measures it in Kantan's output, writes the corrections to
# area_numbers_fit.json beside area_labels.py and runs area_labels.py again. Run it again after moving
# shapes a lot; each run refines the last.

import json
import os

HERE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner'
FIT_FILE = os.path.join(HERE, 'area_numbers_fit.json')
NUMBER_PX = 45
FRAMES = 8   # frames for Kantan to redraw after each change

labels = op('/project1/area_labels')
kantan = op('/project1/MAPPER/kantanMapper1/out1')
areas = sorted(int(o.name[6:]) for o in labels.findChildren(name='switch*', depth=1)) if labels else []
fit = json.load(open(FIT_FILE)) if os.path.exists(FIT_FILE) else {}
report = {}


def grab():
    a = kantan.numpyArray(delayed=False)
    return a[..., :3].sum(axis=2)


def number_box(mask):
    ys, xs = mask.nonzero()
    if len(xs) < 4:
        return None
    return xs.max() - xs.min() + 1, ys.max() - ys.min() + 1


def glyph_share(n):
    # How much of the font size the digits fill in the number's own picture (across, down).
    t = labels.op('number%d' % n)
    a = t.numpyArray(delayed=False)
    box = number_box(a[..., 3] > 0.5)
    if box is None:
        return None
    return box[0] / t.par.fontsizex.eval(), box[1] / t.par.fontsizey.eval()


def show_only(n):
    for k in areas:
        sw = labels.op('switch%d' % k)
        sw.par.index.expr = ''
        sw.par.index.val = 1 if k == n else 0


def restore():
    for k in areas:
        labels.op('switch%d' % k).par.index.expr = '1 if parent().par.Shownumbers else 0'


state = {}


def start():
    op('/').time.play = True
    show_only(None)
    run('args[0]()', baseline, delayFrames=FRAMES)


def baseline():
    state['off'] = grab()
    step(0)


def step(i):
    if i >= len(areas):
        finish()
        return
    show_only(areas[i])
    run('args[0](args[1])', measure, i, delayFrames=FRAMES)


def measure(i):
    n = areas[i]
    diff = abs(grab() - state['off']) > 0.3
    box = number_box(diff)
    share = glyph_share(n)
    if box and share:
        # The font size each way as it lands on the wall, in canvas pixels; the correction scales it to NUMBER_PX.
        wall_fx = box[0] / share[0]
        wall_fy = box[1] / share[1]
        mx, my = fit.get(str(n), [1.0, 1.0])
        fit[str(n)] = [round(mx * NUMBER_PX / wall_fx, 4), round(my * NUMBER_PX / wall_fy, 4)]
        report[n] = {'box_px': [int(box[0]), int(box[1])], 'wall_font': [round(wall_fx, 1), round(wall_fy, 1)],
                     'fit': fit[str(n)]}
    else:
        report[n] = 'not found (shape off-screen or hidden?)'
    step(i + 1)


def finish():
    restore()
    json.dump(fit, open(FIT_FILE, 'w'), indent=1)
    open(os.path.join(HERE, 'area_numbers_fit_report.json'), 'w').write(json.dumps(report, indent=1))
    exec(open(os.path.join(HERE, 'area_labels.py')).read(), globals())
    print('Numbers calibrated:', ', '.join('%s %s' % (n, r['fit'] if isinstance(r, dict) else r) for n, r in report.items()))


if labels is None or kantan is None:
    print('  ! area_labels or Kantan not found - run area_labels.py first')
else:
    start()
