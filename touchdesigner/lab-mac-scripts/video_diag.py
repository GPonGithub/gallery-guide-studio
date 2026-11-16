# Read-only: measures TouchDesigner's frame rate and what costs the most, for jerky video.
# Run in the Textport:
#     exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag.py').read())
# Writes video_diag.txt beside this file after about 5 seconds. Changes nothing.
import time, json

OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag.txt'
op('/').store('video_diag', {'t0': time.time(), 'f0': absTime.frame})


run("exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/video_diag_finish.py').read())", delayMilliSeconds=5000)
print('  measuring for 5 s...')
