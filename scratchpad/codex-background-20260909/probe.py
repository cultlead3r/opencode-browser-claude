import json, time
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
ROOT = Path(__file__).parent
records = []
phase = 'setup'
PAGE = '''<!doctype html><meta charset="utf-8"><title>Codex background input probe</title>
<style>body{font:18px system-ui;margin:36px;background:#f0f5fc;color:#17243a}button,input{font:20px system-ui;padding:18px;margin:12px 12px 12px 0}pre{font:14px monospace;white-space:pre-wrap}h1{font-size:26px}</style>
<h1>Codex background input probe — 2026-09-09</h1>
<button id="target">Click target</button><input id="entry" placeholder="Typing probe"><h2 id="count">count: 0</h2><pre id="log"></pre>
<script>
let count=0, clicks=[];
function state(){return {count,visibility:document.visibilityState,hasFocus:document.hasFocus(),value:entry.value,time:Date.now()}}
function send(kind,event){let record={kind,...state(),...(event?{isTrusted:event.isTrusted,target:event.target.id,eventType:event.type}: {})};fetch('/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record),keepalive:true});return record}
for(let type of ['pointerdown','mousedown','mouseup','click'])target.addEventListener(type,e=>{if(type==='click'){count++;document.getElementById('count').textContent='count: '+count}let r=send(type,e);if(type==='click'){clicks.push(r);log.textContent=clicks.map((x,i)=>`${i+1}. count=${x.count} visibility=${x.visibility} trusted=${x.isTrusted} focus=${x.hasFocus}`).join('\\n')}});
for(let type of ['input','change'])entry.addEventListener(type,e=>send(type,e));
for(let type of ['focus','blur'])window.addEventListener(type,e=>send(type));
document.addEventListener('visibilitychange',()=>send('visibilitychange'));
setInterval(()=>send('heartbeat'),1000);send('loaded');
</script>'''
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  if self.path == '/state': data=json.dumps({'phase':phase,'records':records}).encode(); mime='application/json'
  elif self.path == '/cover': data=b'<title>Codex probe cover tab</title><h1>Cover tab - probe should be hidden</h1>'; mime='text/html'
  else:data=PAGE.encode();mime='text/html'
  self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def do_POST(self):
  global phase
  data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  if self.path=='/phase':phase=data['phase']
  else:
   row={**data,'phase':phase,'receivedAt':time.time()};records.append(row)
   with (ROOT/'events.jsonl').open('a') as f:f.write(json.dumps(row)+'\n')
  self.send_response(204);self.end_headers()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
(ROOT/'port.txt').write_text(str(server.server_port))
print(f'PORT={server.server_port}',flush=True)
server.serve_forever()
