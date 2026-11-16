# Removes the 5 shapes kantanMapper_P56 copied from kantanMapper1 but doesn't need (ids 9-13), by deleting
# their rows from its shape list (project/tree) and the matching layer rows (allShapes/table1). Only the copy.
#     exec(open('/full/path/to/p56_remove_extra.py').read())
LOG = '/Users/ixdstudio/Documents/2026 Grahams Work/Fall 2026 Grahams Work/Claude/TouchDesigner/p56_remove_extra.log'
DROP = {'9', '10', '11', '12', '13'}
log = []
say = lambda *a: log.append(' '.join(str(x) for x in a))
try:
    kp = op('/project1/MAPPER/kantanMapper_P56/project')
    assert kp is not None and 'P56' in kp.path
    tree, t1 = kp.op('tree'), kp.op('allShapes/table1')
    rows = [r for r in range(1, tree.numRows) if tree[r, 0].val in DROP]
    say('tree rows to drop', rows, [tree[r, 0].val for r in rows])
    if t1.numRows == tree.numRows:
        for r in reversed(rows):
            t1.deleteRow(r)
    else:
        say('! table1 has %d rows, tree %d - table1 left alone' % (t1.numRows, tree.numRows))
    for r in reversed(rows):
        tree.deleteRow(r)
    shapes = sorted(o.name for o in kp.op('allShapes').findChildren(name='item*', depth=1))
    say('tree ids now', [tree[r, 0].val for r in range(1, tree.numRows)])
    say('items now', shapes)
except Exception:
    import traceback
    say('! stopped:', traceback.format_exc())
open(LOG, 'w').write('\n'.join(log))
print('p56_remove_extra done')
