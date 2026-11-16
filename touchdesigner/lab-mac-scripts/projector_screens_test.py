# Loads the new receiver code (update_receiver.py), then checks that projector windows find their own
# screens again after the monitor numbers change. Nothing moves on the projectors: window 1's number is
# set wrong without reopening it, and the receiver should put it back.
#     exec(open('/full/path/to/projector_screens_test.py').read())

HERE = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/'
exec(open(HERE + 'update_receiver.py').read())

rx = op('/project1/immersive_lab/receiver_callbacks').module
po = op('/project1/projector_out')
wins = rx.projector_windows(po)

print(rx.projectors({'action': 'status'})[1])
print('remembered screens:', [(w.name, w.par.display.eval(), w.fetch('screen_at', None, search=False)) for w in wins])

w1 = po.op('window1')
right = w1.par.display.eval()
w1.par.display = 2  # the Acer - wrong on purpose (window not reopened, so nothing moves)
rx.projectors({'action': 'status'})
print('window1 display: right %d, set wrong to 2, after status -> %d  %s' % (
    right, w1.par.display.eval(), 'PASS' if w1.par.display.eval() == right else 'FAIL'))
w1.par.display = right
