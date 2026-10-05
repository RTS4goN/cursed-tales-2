from pathlib import Path
import io,json,urllib.request,urllib.parse,concurrent.futures,zipfile,email.message,time
ROOT=Path(__file__).resolve().parent.parent
class RemoteZip(io.RawIOBase):
 def __init__(self,url):
  self.url=url;self.pos=0;self.cache={};self.total=None;self.filename=None
  self.prefix=self.fetch(0,3)
 def fetch(self,start,end):
  for attempt in range(3):
   try:
    with urllib.request.urlopen(urllib.request.Request(self.url,headers={'Range':f'bytes={start}-{end}'}),timeout=40) as res:
     cr=res.headers.get('Content-Range','');assert res.status==206 and cr.startswith(f'bytes {start}-'),f'Range unsupported: {res.status}'
     self.total=int(cr.split('/')[-1]);m=email.message.Message();m['Content-Disposition']=res.headers.get('Content-Disposition','');self.filename=m.get_filename()
     b=res.read(end-start+2);assert len(b)==end-start+1;return b
   except Exception:
    if attempt==2:raise
    time.sleep(1)
 def seekable(self):return True
 def readable(self):return True
 def tell(self):return self.pos
 def seek(self,n,whence=0):
  self.pos=n if whence==0 else self.pos+n if whence==1 else self.total+n
  return self.pos
 def read(self,n=-1):
  if n<0:n=self.total-self.pos
  n=min(n,self.total-self.pos)
  if n<=0:return b''
  assert n<4*1024**2,'Unexpected large index read'
  key=(self.pos,n)
  if key not in self.cache:self.cache[key]=self.fetch(self.pos,self.pos+n-1)
  self.pos+=n;return self.cache[key]
def inspect(pair):
 name,url=pair
 try:
  stream=RemoteZip(url);assert stream.prefix==b'PK\x03\x04','Response is not ZIP';assert stream.filename==name,f'Wrong filename: {stream.filename}'
  with zipfile.ZipFile(stream) as z:members=[{'name':x.filename,'bytes':x.file_size,'crc':x.CRC} for x in z.infolist() if not x.is_dir()]
  return name,{'status':'ok','url':url,'bytes':stream.total,'filename':stream.filename,'members':members}
 except Exception as e:return name,{'status':'failed','url':url,'error':str(e)}
if __name__=='__main__':
 import os
 private=Path(os.environ.get('CT2_PRIVATE_DIR',ROOT.parent/'Служебное/Тиры'))
 proof_path=private/'Архивы для тестов.json'
 if not proof_path.exists():raise SystemExit('Local archive inventory required; set CT2_PRIVATE_DIR')
 proof=json.loads(proof_path.read_text(encoding='utf-8'))
 pairs=[(name,a['url']) for name,a in proof.items()]
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:result=dict(pool.map(inspect,pairs))
 proof_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 for n,x in result.items():print(n,x['status'],len(x.get('members',[])),x.get('error',''),flush=True)
 assert all(x['status']=='ok' for x in result.values()),'Some archives failed verification'
