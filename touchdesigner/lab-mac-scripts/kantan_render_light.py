# Makes Kantan Mapper's room render light enough for 60 fps: 8-bit colour (was 32-bit float) and
# 2x antialiasing (was 4x) on kantanMapper1's render TOPs. The projectors show 8 bits per colour,
# so the picture on the walls is the same; the graphics card does a small fraction of the work.
# The old values are kept in kantan_render_light.json beside this file.
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_render_light.py').read())
# To undo, set KRL_UNDO = True first:
#     KRL_UNDO = True; exec(open('.../kantan_render_light.py').read())
import json, os

KRL_FILE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/kantan_render_light.json'
KRL_CHANGES = {
    '/project1/MAPPER/kantanMapper1/project/render1': {'format': 'rgba8fixed', 'antialias': 'aa2'},
    '/project1/MAPPER/kantanMapper1/project/render2': {'format': 'rgba8fixed'},
}

if globals().get('KRL_UNDO'):
    old = json.load(open(KRL_FILE))
    for path, pars in old.items():
        for name, value in pars.items():
            setattr(op(path).par, name, value)
    print('  Kantan render put back: %s' % old)
    KRL_UNDO = False
else:
    old = json.load(open(KRL_FILE)) if os.path.exists(KRL_FILE) else {}
    for path, pars in KRL_CHANGES.items():
        o = op(path)
        if o is None:
            print('  ! %s not found' % path)
            continue
        keep = old.setdefault(path, {})
        for name, value in pars.items():
            keep.setdefault(name, getattr(o.par, name).eval())
            setattr(o.par, name, value)
    json.dump(old, open(KRL_FILE, 'w'), indent=1)
    print('  Kantan render lightened (old values in kantan_render_light.json)')
