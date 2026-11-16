# Adds spatialized audio to the Immersive Lab that's already built, without rebuilding it
# (so Kantan's shapes, area labels and the Media Folder stay as they are).
#
# Run it inside TouchDesigner from the Textport:
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/add_spatial_audio.py').read())
#
# It does two things:
#   1. Builds the speaker network in /project1/immersive_lab (nodes named sp_...): each sound slot is
#      played by the room's four speakers (GIGAPORT eX outputs 1-4) at the levels the app sends.
#      audio_out is fed from it and set to the GIGAPORT. Run again any time: it replaces its own nodes.
#   2. Updates the receiver's code from the build script (as update_receiver.py does), so it
#      understands the app's "sound pan" messages.
# To undo: connect audio_out's input back to mix, and delete the sp_ nodes.

import ast

BUILD = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/build_immersive_lab.py'

lab = op('/project1/immersive_lab')
if lab is None:
    print('  ! /project1/immersive_lab not found - run build_immersive_lab.py first')
else:
    source = open(BUILD).read()
    tree = ast.parse(source)
    # Everything the build script defines, without running its build() (that would rebuild the lab).
    keep = [n for n in tree.body
            if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                    and getattr(n.value.func, 'id', '') == 'build')]
    defs = {}
    exec(compile(ast.Module(body=keep, type_ignores=[]), BUILD, 'exec'), globals(), defs)
    for name, value in defs.items():
        globals()[name] = value
    del defs['problems'][:]
    defs['build_spatial'](lab)
    lab.op('receiver_callbacks').text = defs['CALLBACKS']
    guide = lab.op('message_guide')
    if guide is not None:
        guide.clear()
        for row in defs['GUIDE']:
            guide.appendRow(row)
    print('Spatialized audio added to %s; receiver code updated.' % lab.path)
    print('%d problem(s): %s' % (len(defs['problems']), '; '.join(defs['problems'])) if defs['problems'] else 'No problems.')
