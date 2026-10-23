# Immersive Lab - builds the TouchDesigner side of the Chatbot Designer's media connection.
#
# Run it inside TouchDesigner: open the Textport (Dialogs > Textport and DATs, or Alt+T) and type
#     exec(open('/full/path/to/build_immersive_lab.py').read())
# It (re)creates one component, /project1/immersive_lab, and leaves everything else alone.
#
# What it makes:
#   receiver           Web Server DAT on port 9980. The app connects with a WebSocket
#                      (ws://localhost:9980) and sends JSON messages; plain HTTP POSTs of the
#                      same JSON work too (handy for testing with curl).
#   area1 ... area11     the 11 projection outputs (Null TOPs, also out1 ... out11 as the
#                      component's TOP outputs). Each shows a picture or video, or black.
#   preview            all 11 areas in one grid, each numbered, for checking
#                      (open it with the component's Open Preview button).
#   sound1 ... sound8    audio slots (Audio File In CHOPs) - sounds are separate from pictures
#                      and video. Mixed, set to the app's volume / dip, out of audio_out.
#   message_guide      what each message means.
#   message_log        every message as it arrives (newest first) and what happened.
#   now_playing        what's on each area and audio slot right now.
#   media_list         the app's media list (sent on connecting): ID, file, path, and
#                      whether TouchDesigner can find it.
#
# The receiver also drives /project1/projector_out, the projector windows that projector_output.py
# makes, if there is one: the app's "Set up the projectors" step shows each projector's number and
# swaps which part of the picture each projector gets. It can also open Kantan Mapper's editor.
#
# The component's Media Folder parameter is where the files are; a message's path (the
# Media tab's column C) is found inside it.

import os

MEDIA_FOLDER = '/Users/grahamplumb/Documents/2. Post Snibbe/0. CCA Teaching/2026 Fall/1. Connected Hospital Project/1. Conversation App Media Folder'
PORT = 9980
WIDTH, HEIGHT = 1920, 1080
AREAS = 11
SOUND_SLOTS = 8

problems = []


def warn(text):
    problems.append(text)
    print('  ! ' + text)


def setp(o, name, value):
    """Sets a parameter, reporting (not failing) if this TouchDesigner names it differently."""
    p = getattr(o.par, name, None)
    if p is None:
        warn('%s has no parameter "%s"' % (o.path, name))
        return
    try:
        if p.isMenu and isinstance(value, str) and value not in p.menuNames:
            warn('%s.%s: no option "%s" (options: %s)' % (o.path, name, value, ', '.join(p.menuNames)))
            return
        p.val = value
    except Exception as e:
        warn('%s.%s = %r failed: %s' % (o.path, name, value, e))


def place(o, x, y):
    o.nodeX, o.nodeY = x, y
    return o


CALLBACKS = r'''# The Immersive Lab receiver: what each message from the Chatbot Designer does.
# (Made by build_immersive_lab.py - run that again rather than editing here.)

import json
import os
import time

lab = parent()
AREAS = int(lab.par.Areas.eval())
SLOTS = int(lab.par.Soundslots.eval())


def table(name):
    return lab.op(name)


def media_root():
    return lab.par.Mediafolder.eval()


def full_path(msg):
    """The file on disk: the message's path inside the media folder (or its ID looked up in media_list)."""
    path = msg.get('path') or ''
    if not path and msg.get('id'):
        ml = table('media_list')
        if ml[msg['id'], 'Path'] is not None:
            path = ml[msg['id'], 'Path'].val
    if not path:
        return ''
    return path if os.path.isabs(path) else os.path.join(media_root(), path)


def log(msg, where, result):
    t = table('message_log')
    loop = msg.get('loop')
    t.insertRow([
        time.strftime('%H:%M:%S'),
        msg.get('type', ''),
        msg.get('action', ''),
        where,
        msg.get('id', ''),
        msg.get('path', ''),
        '' if loop is None else ('yes' if loop else 'no'),
        result,
    ], 1)
    while t.numRows > 101:
        t.deleteRow(t.numRows - 1)


def now(row, msg=None):
    t = table('now_playing')
    if msg is None:
        for col in ('ID', 'File', 'Loop', 'Since'):
            t[row, col] = ''
    else:
        t[row, 'ID'] = msg.get('id', '')
        t[row, 'File'] = msg.get('path', '')
        t[row, 'Loop'] = 'yes' if msg.get('loop') else 'no'
        t[row, 'Since'] = time.strftime('%H:%M:%S')


def set_loop_audio(ch, loop):
    p = ch.par.repeat
    if p is None:
        return
    if p.isMenu:
        names = p.menuNames
        want = [n for n in names if (n.lower() not in ('off', 'none', 'no')) == loop]
        if want:
            p.val = want[0]
    else:
        p.val = 1 if loop else 0


# --- pictures and video -------------------------------------------------------

def show(msg):
    area = int(msg.get('area', 0))
    if not 1 <= area <= AREAS:
        return 'area %s?' % msg.get('area'), 'no such area'
    where = 'area %d' % area
    kind = msg.get('kind')
    if kind == 'color':
        # A colour wash: the area's colour layer (switch input 2).
        hexv = (msg.get('value') or '#000000').lstrip('#')
        try:
            r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
        except ValueError:
            return where, 'not a colour: %s' % msg.get('value')
        col = lab.op('color%d' % area)
        col.par.colorr, col.par.colorg, col.par.colorb = r, g, b
        lab.op('movie%d' % area).par.play = 0
        lab.op('switch%d' % area).par.index = 2
        now(where, dict(msg, path=msg.get('value')))
        return where, 'colour shown'
    if kind == 'text':
        # Words on the area: its text layer (switch input 3).
        lab.op('words%d' % area).par.text = msg.get('value') or ''
        lab.op('movie%d' % area).par.play = 0
        lab.op('switch%d' % area).par.index = 3
        now(where, dict(msg, path=(msg.get('value') or '')[:60]))
        return where, 'text shown'
    path = full_path(msg)
    if not path or not os.path.isfile(path):
        return where, 'file missing'
    movie = lab.op('movie%d' % area)
    movie.par.file = path
    movie.par.textendright = 'cycle' if msg.get('loop') else 'hold'
    movie.par.play = 1
    movie.par.cuepulse.pulse()
    lab.op('switch%d' % area).par.index = 1
    now(where, msg)
    return where, 'shown' if msg.get('kind') == 'image' else 'playing'


def hide_area(area):
    lab.op('switch%d' % area).par.index = 0
    lab.op('movie%d' % area).par.play = 0
    now('area %d' % area)


def hide(msg):
    area = int(msg.get('area', 0))
    if not 1 <= area <= AREAS:
        return 'area %s?' % msg.get('area'), 'no such area'
    hide_area(area)
    return 'area %d' % area, 'hidden'


# --- sound --------------------------------------------------------------------

def slot_rows():
    t = table('now_playing')
    return [(k, t['sound %d' % k, 'ID'].val, t['sound %d' % k, 'Loop'].val, t['sound %d' % k, 'Since'].val)
            for k in range(1, SLOTS + 1)]


def free_slot():
    rows = slot_rows()
    for k, sid, loop, since in rows:
        if not sid:
            return k
    # None free: the oldest sound that plays once, else the oldest of all.
    once = [r for r in rows if r[2] != 'yes'] or rows
    return min(once, key=lambda r: r[3])[0]


def stop_slot(k):
    lab.op('sound%d' % k).par.play = 0
    now('sound %d' % k)


def play_sound(msg):
    path = full_path(msg)
    if not path or not os.path.isfile(path):
        return 'sound', 'file missing'
    k = free_slot()
    ch = lab.op('sound%d' % k)
    ch.par.file = path
    set_loop_audio(ch, bool(msg.get('loop')))
    ch.par.play = 1
    ch.par.cuepulse.pulse()
    now('sound %d' % k, msg)
    return 'slot %d' % k, 'playing'


def stop_sound(msg):
    sid = msg.get('id')
    stopped = [k for k, rid, _, _ in slot_rows() if rid and (not sid or rid == sid)]
    for k in stopped:
        stop_slot(k)
    return ', '.join('slot %d' % k for k in stopped) or 'sound', 'stopped' if stopped else 'not playing'


def levels(msg):
    gain = max(0.0, min(1.0, float(msg.get('gain', 1))))
    seconds = max(0.0, float(msg.get('ms', 150))) / 1000
    lag = lab.op('level_lag')
    current = lab.op('level')
    if gain < float(current.par.value0):
        lag.par.lag2 = seconds
    else:
        lag.par.lag1 = seconds
    current.par.value0 = gain
    return 'audio', 'volume %d%%' % round(gain * 100)


def clear(msg):
    for area in range(1, AREAS + 1):
        hide_area(area)
    for k in range(1, SLOTS + 1):
        stop_slot(k)
    return 'everything', 'cleared'


# --- the media list -----------------------------------------------------------

def media_list(msg):
    t = table('media_list')
    t.clear(keepFirstRow=True)
    root = media_root()
    found = 0
    for item in msg.get('items', []):
        path = item.get('path', '')
        here = os.path.isfile(path if os.path.isabs(path) else os.path.join(root, path))
        found += here
        t.appendRow([item.get('id', ''), item.get('name', ''), path, item.get('kind', ''),
                     item.get('status', ''), 'yes' if here else 'NO'])
    n = len(msg.get('items', []))
    return 'media list', '%d of %d files found' % (found, n)


def hello(msg):
    return 'app', 'connected'


# --- the projectors (projector_output.py's windows) --------------------------

def projector_out():
    return lab.parent().op('projector_out')


def projector_windows(po):
    return sorted(po.findChildren(type=windowCOMP, depth=1), key=lambda w: w.digits or 0)


def projector_state():
    """What the app's projector step shows: how many projectors, and whether their numbers are up."""
    po = projector_out()
    if po is None:
        return None
    wins = projector_windows(po)
    return {'count': len(wins),
            'identify': bool(po.par.Identify.eval()) if hasattr(po.par, 'Identify') else False,
            'open': sum(1 for w in wins if getattr(w, 'isOpen', False))}


NO_PROJECTORS = 'no projector windows - run projector_output.py in TouchDesigner'


def projectors(msg):
    """projectors status / identify / open / close / assign."""
    action = msg.get('action', '')
    po = projector_out()
    if po is None:
        return 'projectors', NO_PROJECTORS, {'ok': False, 'projectors': None}
    wins = projector_windows(po)
    if action == 'identify':
        po.par.Identify = bool(msg.get('on'))
        result = 'numbers shown' if msg.get('on') else 'numbers hidden'
    elif action == 'open':
        for w in wins:
            w.par.winopen.pulse()
        # A paused timeline freezes per-frame work such as Kantan's corner dragging.
        op('/').time.play = True
        result = '%d windows opened' % len(wins)
    elif action == 'close':
        for w in wins:
            w.par.winclose.pulse()
        result = 'windows closed'
    elif action == 'assign':
        # shows[r-1] = the number projector r (as labelled in the room) shows now. Projector r
        # gets the screen that number was going to, so each shows its own number afterwards.
        try:
            shows = [int(n) for n in msg.get('shows', [])]
        except (TypeError, ValueError):
            shows = []
        if sorted(shows) != list(range(1, len(wins) + 1)):
            return 'projectors', 'each number 1-%d once, please' % len(wins), {
                'ok': False, 'projectors': projector_state()}
        before = [w.par.display.eval() for w in wins]
        for r, w in enumerate(wins):
            w.par.display = before[shows[r] - 1]
        reopen = [w for w in wins if getattr(w, 'isOpen', False)]
        for w in reopen:
            w.par.winclose.pulse()
        if reopen:
            run('for p in args[0]: op(p).par.winopen.pulse()', [w.path for w in reopen], delayFrames=5)
        # The reopened windows count as open (they reopen a few frames from now).
        return 'projectors', 'projectors reassigned', {
            'projectors': dict(projector_state(), open=len(reopen))}
    else:
        result = '%d projectors' % len(wins)
    return 'projectors', result, {'projectors': projector_state()}


# --- Kantan Mapper (the projection mapping editor) -----------------------------

def kantan_mapper():
    m = op('/project1/MAPPER/kantanMapper1')
    if m is None:
        found = [c for c in op('/').findChildren(type=COMP, name='kantanMapper*') if hasattr(c.par, 'Open')]
        m = found[0] if found else None
    return m


def kantan(msg):
    """kantan open / close: Kantan Mapper's editor window, on this computer's screen."""
    m = kantan_mapper()
    if m is None:
        return 'kantan', 'no Kantan Mapper in this project', {'ok': False}
    if msg.get('action') == 'close':
        m.par.Close.pulse()
        return 'kantan', 'editor closed'
    # Kantan drags corners frame by frame, so the timeline must play.
    op('/').time.play = True
    m.par.Open.pulse()
    return 'kantan', 'editor open'


HANDLERS = {
    ('media', 'show'): show,
    ('media', 'play'): show,
    ('media', 'hide'): hide,
    ('sound', 'play'): play_sound,
    ('sound', 'stop'): stop_sound,
    ('levels', ''): levels,
    ('clear', ''): clear,
    ('medialist', ''): media_list,
    ('hello', ''): hello,
    ('projectors', 'status'): projectors,
    ('projectors', 'identify'): projectors,
    ('projectors', 'open'): projectors,
    ('projectors', 'close'): projectors,
    ('projectors', 'assign'): projectors,
    ('kantan', 'open'): kantan,
    ('kantan', 'close'): kantan,
}


def handle(text):
    """Does what one message says; returns the reply for the app."""
    try:
        msg = json.loads(text)
    except Exception:
        log({'type': '?'}, '', 'not JSON')
        return {'type': 'result', 'ok': False, 'result': 'not JSON'}
    if 'cue' in msg and 'type' not in msg:
        # A stage cue from the app's server (the flow's TouchDesigner address).
        log({'type': 'cue', 'action': msg.get('cue', ''), 'id': msg.get('stage', '')}, '', 'cue')
        return {'type': 'result', 'ok': True, 'result': 'cue'}
    handler = HANDLERS.get((msg.get('type', ''), msg.get('action', '')))
    if handler is None:
        log(msg, '', 'unknown message')
        return {'type': 'result', 'ok': False, 'result': 'unknown message', 'ref': msg.get('ref')}
    extra = {}
    try:
        # A handler returns (where, result), or (where, result, more for the reply).
        where, result, *more = handler(msg)
        extra = more[0] if more else {}
    except Exception as e:
        where, result = '', 'error: %s' % e
    log(msg, where, result)
    reply = {'type': 'result', 'ok': result not in ('file missing', 'no such area') and not result.startswith('error'),
             'result': result, 'where': where, 'id': msg.get('id'), 'ref': msg.get('ref')}
    reply.update(extra)
    if msg.get('type') == 'hello':
        root = media_root()
        reply.update({'type': 'ready', 'areas': AREAS, 'soundSlots': SLOTS, 'mediaFolder': root,
                      'folderFound': os.path.isdir(root), 'project': project.name})
    return reply


# --- Web Server DAT callbacks -------------------------------------------------

def onWebSocketReceiveText(webServerDAT, client, data):
    webServerDAT.webSocketSendText(client, json.dumps(handle(data)))


def onHTTPRequest(webServerDAT, request, response):
    if request.get('method') == 'POST':
        body = request.get('data', '')
        if isinstance(body, (bytes, bytearray)):
            body = body.decode('utf-8', 'replace')
        reply = handle(body)
    else:
        reply = {'type': 'ready', 'result': 'Immersive Lab receiver - send JSON by WebSocket or POST'}
    response['statusCode'] = 200
    response['statusReason'] = 'OK'
    response['Content-Type'] = 'application/json'
    response['Access-Control-Allow-Origin'] = '*'
    response['data'] = json.dumps(reply)
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    return


def onWebSocketClose(webServerDAT, client):
    return


def onWebSocketReceiveBinary(webServerDAT, client, data):
    return


def onWebSocketReceivePing(webServerDAT, client, data):
    webServerDAT.webSocketSendPong(client, data=data)


def onWebSocketReceivePong(webServerDAT, client, data):
    return


def onServerStart(webServerDAT):
    return


def onServerStop(webServerDAT):
    return
'''

GUIDE = [
    ['Message', 'What TouchDesigner does', 'Example'],
    ['media show', 'Shows a picture in an area (1-11)',
     '{"type":"media","action":"show","area":3,"id":"M-001","path":"Maya.jpg","kind":"image"}'],
    ['media show (colour)', 'Fills an area with a colour (hex), no file',
     '{"type":"media","action":"show","area":4,"id":"M-020","kind":"color","value":"#0b1d36"}'],
    ['media show (text)', 'Shows words in an area (white on black, centred), no file',
     '{"type":"media","action":"show","area":5,"id":"M-021","kind":"text","value":"Welcome to the clinic"}'],
    ['media play', 'Plays a video in an area; loop true = loops, false = plays once and holds the last frame',
     '{"type":"media","action":"play","area":5,"id":"M-007","path":"monitor.mov","kind":"video","loop":true}'],
    ['media hide', 'Clears an area to black', '{"type":"media","action":"hide","area":5}'],
    ['sound play', 'Plays a sound on a free audio slot (1-8); loop true = until stopped',
     '{"type":"sound","action":"play","id":"M-014","path":"ding.mp3","loop":false}'],
    ['sound stop', 'Stops that sound (no id = every sound)', '{"type":"sound","action":"stop","id":"M-014"}'],
    ['levels', 'Sets the sounds\' volume (0-1), easing over ms - the Music / Sounds volume and the dip under the voice',
     '{"type":"levels","gain":0.4,"ms":400}'],
    ['clear', 'Hides every area and stops every sound (restart, new scene)', '{"type":"clear"}'],
    ['medialist', 'The app\'s media list (the sheet\'s Media tab) - fills media_list and checks each file is there',
     '{"type":"medialist","items":[{"id":"M-001","name":"Maya.jpg","path":"Maya.jpg","kind":"image","status":"present"}]}'],
    ['hello', 'The app checking in; TouchDesigner replies "ready" with its folder', '{"type":"hello"}'],
    ['projectors status', 'How many projector windows projector_output.py made, and whether their numbers show',
     '{"type":"projectors","action":"status"}'],
    ['projectors identify', 'Shows (on true) or hides "PROJECTOR N" on each projector',
     '{"type":"projectors","action":"identify","on":true}'],
    ['projectors open / close', 'Opens (and plays the timeline) or closes the projector windows',
     '{"type":"projectors","action":"open"}'],
    ['kantan open / close', 'Opens (and plays the timeline) or closes Kantan Mapper\'s editor window',
     '{"type":"kantan","action":"open"}'],
    ['projectors assign', 'shows: the number each projector (1, 2, ... as labelled in the room) shows now; '
     'swaps their screens so each shows its own', '{"type":"projectors","action":"assign","shows":[2,3,1,4]}'],
    ['(cue)', 'A stage cue from the app\'s server (the flow\'s TouchDesigner address) - logged only',
     '{"cue":"...","trigger":"...","stage":"2","sessionId":"...","slots":{}}'],
]


def build():
    home = op('/project1') or root
    old = home.op('immersive_lab')
    if old is not None:
        old.destroy()
    lab = place(home.create(baseCOMP, 'immersive_lab'), 0, 0)
    lab.color = (0.2, 0.35, 0.65)

    page = lab.appendCustomPage('Immersive Lab')
    page.appendFolder('Mediafolder', label='Media Folder')
    page.appendInt('Port', label='Port')
    page.appendInt('Width', label='Output Width')
    page.appendInt('Height', label='Output Height')
    page.appendInt('Areas', label='Projection Areas')
    page.appendInt('Soundslots', label='Sound Slots')
    page.appendPulse('Openpreview', label='Open Preview')
    lab.par.Mediafolder = MEDIA_FOLDER
    lab.par.Port = PORT
    lab.par.Width = WIDTH
    lab.par.Height = HEIGHT
    lab.par.Areas = AREAS
    lab.par.Soundslots = SOUND_SLOTS
    for name in ('Areas', 'Soundslots'):
        try:
            lab.par[name].readOnly = True
        except Exception:
            pass

    # Tables
    guide = place(lab.create(tableDAT, 'message_guide'), -800, 600)
    guide.clear()
    for row in GUIDE:
        guide.appendRow(row)

    logt = place(lab.create(tableDAT, 'message_log'), -800, 400)
    logt.clear()
    logt.appendRow(['Time', 'Type', 'Action', 'Area / slot', 'ID', 'File', 'Loop', 'Result'])

    nowt = place(lab.create(tableDAT, 'now_playing'), -800, 200)
    nowt.clear()
    nowt.appendRow(['Output', 'ID', 'File', 'Loop', 'Since'])
    for a in range(1, AREAS + 1):
        nowt.appendRow(['area %d' % a, '', '', '', ''])
    for k in range(1, SOUND_SLOTS + 1):
        nowt.appendRow(['sound %d' % k, '', '', '', ''])

    ml = place(lab.create(tableDAT, 'media_list'), -800, 0)
    ml.clear()
    ml.appendRow(['ID', 'File name', 'Path', 'Type', 'Status', 'Found'])

    # Receiver
    cb = place(lab.create(textDAT, 'receiver_callbacks'), -600, 800)
    cb.text = CALLBACKS
    ws = place(lab.create(webserverDAT, 'receiver'), -800, 800)
    setp(ws, 'callbacks', cb.name)
    ws.par.port.expr = "parent().par.Port"
    setp(ws, 'active', True)

    # Pictures and video: movie -> fit -> switch (black / media) -> area null -> out
    black = place(lab.create(constantTOP, 'black'), -400, 600)
    setp(black, 'outputresolution', 'custom')
    black.par.resolutionw.expr = 'parent().par.Width'
    black.par.resolutionh.expr = 'parent().par.Height'
    for c in ('colorr', 'colorg', 'colorb'):
        setp(black, c, 0)
    setp(black, 'alpha', 1)

    preview = place(lab.create(layoutTOP, 'preview'), 900, 600)
    for a in range(1, AREAS + 1):
        y = 600 - (a - 1) * 160
        movie = place(lab.create(moviefileinTOP, 'movie%d' % a), -200, y)
        setp(movie, 'playmode', 'sequential')
        setp(movie, 'play', False)
        setp(movie, 'textendright', 'cycle')
        fit = place(lab.create(fitTOP, 'fit%d' % a), 0, y)
        fit.inputConnectors[0].connect(movie)
        setp(fit, 'fit', 'fitoutside')
        setp(fit, 'outputresolution', 'custom')
        fit.par.resolutionw.expr = 'parent().par.Width'
        fit.par.resolutionh.expr = 'parent().par.Height'
        # A colour wash and words, for text and colour items (no file).
        col = place(lab.create(constantTOP, 'color%d' % a), 0, y - 50)
        setp(col, 'outputresolution', 'custom')
        col.par.resolutionw.expr = 'parent().par.Width'
        col.par.resolutionh.expr = 'parent().par.Height'
        setp(col, 'alpha', 1)
        words = place(lab.create(textTOP, 'words%d' % a), 0, y - 100)
        setp(words, 'outputresolution', 'custom')
        words.par.resolutionw.expr = 'parent().par.Width'
        words.par.resolutionh.expr = 'parent().par.Height'
        setp(words, 'alignx', 'center')
        setp(words, 'aligny', 'center')
        setp(words, 'fontsizex', 110)
        setp(words, 'wordwrap', True)
        setp(words, 'bgalpha', 1)
        sw = place(lab.create(switchTOP, 'switch%d' % a), 200, y)
        sw.inputConnectors[0].connect(black)
        sw.inputConnectors[1].connect(fit)
        sw.inputConnectors[2].connect(col)
        sw.inputConnectors[3].connect(words)
        setp(sw, 'index', 0)
        area = place(lab.create(nullTOP, 'area%d' % a), 400, y)
        area.inputConnectors[0].connect(sw)
        out = place(lab.create(outTOP, 'out%d' % a), 600, y)
        out.inputConnectors[0].connect(area)
        # The preview only: the area's number in its corner, so even black areas can be told apart.
        label = place(lab.create(textTOP, 'label%d' % a), 600, y - 60)
        setp(label, 'text', str(a))
        setp(label, 'outputresolution', 'custom')
        label.par.resolutionw.expr = 'parent().par.Width'
        label.par.resolutionh.expr = 'parent().par.Height'
        setp(label, 'fontsizex', 90)
        setp(label, 'alignx', 'left')
        setp(label, 'aligny', 'top')
        setp(label, 'positionx', 30)
        setp(label, 'positiony', -20)
        setp(label, 'bgalpha', 0)
        tile = place(lab.create(overTOP, 'tile%d' % a), 750, y)
        tile.inputConnectors[0].connect(label)
        tile.inputConnectors[1].connect(area)
        preview.inputConnectors[a - 1].connect(tile)
    setp(preview, 'align', 'gridrows')

    # Sound: slots -> mix (with the app's volume, eased by level_lag) -> audio_out
    level = place(lab.create(constantCHOP, 'level'), 0, -1500)
    setp(level, 'name0', 'gain')
    setp(level, 'value0', 1)
    lag = place(lab.create(lagCHOP, 'level_lag'), 200, -1500)
    lag.inputConnectors[0].connect(level)
    setp(lag, 'lag1', 1.2)
    setp(lag, 'lag2', 0.4)
    mix = place(lab.create(mathCHOP, 'mix'), 200, -1300)
    for k in range(1, SOUND_SLOTS + 1):
        ch = place(lab.create(audiofileinCHOP, 'sound%d' % k), -200, -1100 - (k - 1) * 130)
        setp(ch, 'playmode', 'sequential')
        setp(ch, 'play', False)
        mix.inputConnectors[k - 1].connect(ch)
    setp(mix, 'chopop', 'add')
    mix.par.gain.expr = "op('level_lag')['gain']"
    dev = place(lab.create(audiodeviceoutCHOP, 'audio_out'), 400, -1300)
    dev.inputConnectors[0].connect(mix)
    aout = place(lab.create(outCHOP, 'out_audio'), 400, -1450)
    aout.inputConnectors[0].connect(mix)

    # The Open Preview button: a window with all 11 areas.
    pe = place(lab.create(parameterexecuteDAT, 'open_preview'), -600, 600)
    pe.text = "def onPulse(par):\n    if par.name == 'Openpreview':\n        par.owner.op('preview').openViewer()\n    return\n"
    setp(pe, 'op', '..')
    setp(pe, 'pars', 'Openpreview')
    setp(pe, 'valuechange', False)
    setp(pe, 'onpulse', True)
    preview.openViewer()

    print('Immersive Lab built at %s - receiver on port %d (ws://localhost:%d).' % (lab.path, PORT, PORT))
    if not os.path.isdir(MEDIA_FOLDER):
        warn('Media folder not found: ' + MEDIA_FOLDER)
    print('%d problem(s).' % len(problems) if problems else 'No problems.')
    return lab


build()
