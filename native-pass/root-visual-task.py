import json,pathlib,socket,uuid,time
root=pathlib.Path('[QA-LAB]/dual-lab-v8')
ep=json.loads((root/'data-b/seldon-endpoint.json').read_text())
def call(command,args):
 q={'version':1,'token':pathlib.Path(ep['token_file']).read_text(),'workspace':'keep0001','folder':None,'command':'service invoke','args':{'command':command,'arguments':args},'request_id':str(uuid.uuid4())}
 while True:
  h,p=ep['address'].rsplit(':',1)
  with socket.create_connection((h,int(p)),timeout=60) as c:
   c.sendall((json.dumps(q)+'\n').encode());r=json.loads(c.makefile().readline())
  if r.get('result',{}).get('pending'):time.sleep(.1);continue
  if 'value' not in (r.get('result') or {}):raise RuntimeError(r)
  return r['result']['value']
task=call('create_empty_session',{'provider':'claude','project':'','title':'Figura remota sin carpeta'})['session']
call('send_message',{'provider':'claude','project':'','session':task,'prompt':'Figura remota B sin carpeta','model':'sonnet','permissionMode':'auto'})
time.sleep(1)
paths=[p for p in (root/'data-b').rglob(task) if p.is_dir()];p=paths[0]/'exchange/visuals';p.mkdir(parents=True,exist_ok=True);(p/'qa-figure.html').write_text('<!doctype html><meta name="harness-artefacto" content="web"><h1>HTML REAL ENGINE B</h1><p>Archivo exclusivo de B, tarea sin carpeta</p>')
(root/'root-task.json').write_text(json.dumps({'project':'','session':task,'visual':str(p/'qa-figure.html')}))
print(json.dumps({'task':task,'session':call('load_session',{'project':'','id':task})}))
