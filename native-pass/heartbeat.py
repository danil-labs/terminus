import pathlib,json,socket,uuid,time,os
root=pathlib.Path('[QA-LAB]/dual-lab-v8')
while not (root/'stop').exists():
 for key in ['a','b']:
  ep=json.loads((root/('data-'+key)/'seldon-endpoint.json').read_text());os.kill(ep['pid'],0);h,p=ep['address'].rsplit(':',1)
  args={'project':json.loads((root/'tasks.json').read_text())[key]['project'],'open':[]}
  req={'version':1,'token':pathlib.Path(ep['token_file']).read_text(),'workspace':'keep0001','folder':None,'command':'service invoke','args':{'command':'list_live_sessions','arguments':args},'request_id':str(uuid.uuid4())}
  with socket.create_connection((h,int(p)),timeout=10) as s:
   s.sendall((json.dumps(req)+'\n').encode());r=json.loads(s.makefile().readline())
  print(json.dumps({'at':time.time(),'engine':key,'pid':ep['pid'],'alive':True,'has_value':'value' in (r.get('result') or {}),'error':r.get('error')}),flush=True)
 time.sleep(30)
