# Opens window5 and reports, 1 s and 4 s later, whether it is open and where -> window5_open_test.txt
#   exec(open('/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/window5_open_test.py').read())
W5_OUT = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/window5_open_test.txt'
open(W5_OUT, 'w').write('')
w5 = op('/project1/projector_out/window5')
w5.par.winclose.pulse()
REPORT = ("w = op('/project1/projector_out/window5')\n"
          "open(args[0], 'a').write('%s open=%s display=%s x=%s y=%s w=%s h=%s errors=%r warnings=%r\\n' % "
          "(args[1], w.isOpen, w.par.display.eval(), w.x, w.y, w.width, w.height, w.errors(), w.warnings()))")
run("op('/project1/projector_out/window5').par.winopen.pulse()", delayFrames=20)
run(REPORT, W5_OUT, 'after 1s', delayFrames=80)
run(REPORT, W5_OUT, 'after 4s', delayFrames=260)
print('window5 open test started')
