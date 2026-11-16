# Brings the Immersive Lab receiver's code up to date without rebuilding immersive_lab
# (so Kantan's shapes, area labels and the Media Folder stay as they are).
#
# Run it inside TouchDesigner from the Textport (BUILD below is the build script on this Mac):
#     exec(open('/full/path/to/update_receiver.py').read())
# It copies the build script's receiver code into /project1/immersive_lab/receiver_callbacks.

import ast

BUILD = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/build_immersive_lab.py'

cb = op('/project1/immersive_lab/receiver_callbacks')
if cb is None:
    print('  ! /project1/immersive_lab/receiver_callbacks not found - run build_immersive_lab.py first')
else:
    tree = ast.parse(open(BUILD, encoding='utf-8').read())
    code = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                and getattr(n.targets[0], 'id', '') == 'CALLBACKS')
    cb.text = code
    print('Receiver code updated from %s.' % BUILD)
