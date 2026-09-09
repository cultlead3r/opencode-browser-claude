import json,urllib.request,subprocess,sys,time
from pathlib import Path
root=Path(__file__).parent
base='http://127.0.0.1:'+ (root/'port.txt').read_text()
if len(sys.argv)>1:
 urllib.request.urlopen(urllib.request.Request(base+'/phase',data=json.dumps({'phase':sys.argv[1]}).encode(),headers={'Content-Type':'application/json'})).close()
s=json.load(urllib.request.urlopen(base+'/state'))
def osa(script):return subprocess.check_output(['osascript','-e',script],text=True).strip()
r={'at':time.time(),'phase':s['phase'],'window':osa('tell application "Brave Browser" to get {id, active tab index, minimized} of window id 902659203'),'frontmost':osa('tell application "System Events" to get name of first application process whose frontmost is true'),'lastState':s['records'][-1] if s['records'] else None,'clicks':[r for r in s['records'] if r['kind']=='click']}
with (root/'observations.jsonl').open('a') as f:f.write(json.dumps(r)+'\n')
print(json.dumps({**r,'clicks':[{'count':x['count'],'visibility':x['visibility'],'isTrusted':x['isTrusted'],'hasFocus':x['hasFocus']} for x in r['clicks']]},indent=2))
