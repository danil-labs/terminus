            def consume(message, peer=client, target=target_computer):
                if message.get('type') == 'call':
                    request = json.loads(json.dumps(message))
                    def respond(request=request, peer=peer, target=target):
                        request_id=request['id'];command=request['command']
                        result=fake.connections[target].call(command,request.get('args'),request.get('workspace'))
                        original_id=result.get('id')
                        result=dict(result, id=request_id)
                        value=result.get('value')
                        audit={'request_id':request_id,'command':command,'engine_result_id':original_id,'response_id':result['id'],'response_session':value.get('id') if isinstance(value,dict) else None,'value_kind':type(value).__name__,'result_keys':list(result)}
                        with pathlib.Path('[QA-LAB]/correlation-v8.jsonl').open('a') as log:
                            log.write(json.dumps(audit)+'\n')
                        peer.send(result)
                    threading.Thread(target=respond,daemon=True).start()
