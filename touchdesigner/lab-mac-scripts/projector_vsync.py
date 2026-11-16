# Projector windows: only projector window 1 waits for its screen's refresh (vsync); windows 2-4 don't.
# With all four waiting, macOS presents them one after another and each frame takes 3-4 refreshes
# (about 15-20 fps whenever anything moves). Old values kept in projector_vsync.json beside this file.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/projector_vsync.py').read())
# Undo:  PV_UNDO = True; exec(open('.../projector_vsync.py').read())
import json, os

PV_FILE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/projector_vsync.json'
pv_windows = [op('/project1/projector_out/window%d' % n) for n in (1, 2, 3, 4)]

if globals().get('PV_UNDO'):
    for path, value in json.load(open(PV_FILE)).items():
        op(path).par.vsyncmode = value
    print('  projector vsync put back')
    PV_UNDO = False
else:
    old = json.load(open(PV_FILE)) if os.path.exists(PV_FILE) else {}
    for i, w in enumerate(pv_windows):
        if w is None:
            continue
        old.setdefault(w.path, w.par.vsyncmode.eval())
        w.par.vsyncmode = 'enabled' if i == 0 else 'disabled'
    json.dump(old, open(PV_FILE, 'w'), indent=1)
    print('  vsync only on projector window 1 now (menu: %s)' % ', '.join(pv_windows[0].par.vsyncmode.menuNames))
