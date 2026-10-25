"""Check by default. Explicit code-only web rollback, preserving collector, data and credentials."""
import argparse,fcntl,hashlib,json,os,pathlib,subprocess,time,urllib.request
os.umask(0o077)
ROOT=pathlib.Path('/opt/star-office-ui');BACKUP=pathlib.Path('/home/star-office-backups/20261008-before-workstation-shift-06')
OLD='office-v5-short-status-04';NEW='office-v5-layout-shift-06';WEB='star-office-production-office-web-1'
ENV=ROOT/'private/office.env';WRAPPER=ROOT/'ingress/nginx.conf';INGRESS=ROOT/'ingress/office-public-employee.conf';NGINX='/www/server/nginx/sbin/nginx'
def sha(p):
 h=hashlib.sha256()
 with pathlib.Path(p).open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def out(args):return subprocess.check_output([str(a) for a in args])
def call(args):return subprocess.check_call([str(a) for a in args])
def ids():return {c['Name']:dict(id=c['Id'],image=c['Image'],started=c['State']['StartedAt'],restarts=c['RestartCount'],mounts=sorted([dict(type=m['Type'],source=m['Source'],target=m['Destination'],rw=m['RW']) for m in c.get('Mounts',[])],key=lambda m:m['target'])) for c in json.loads(out(['docker','inspect']+out(['docker','ps','-q']).decode().split()))}
def conf():
 code="import sqlite3,hashlib,json;d=sqlite3.connect('file:/data/office/office-config.sqlite3?mode=ro',uri=True);assert d.execute('PRAGMA quick_check').fetchone()[0]=='ok';r=d.execute('SELECT v.version,v.payload FROM config_head h JOIN config_versions v ON v.version=h.version WHERE h.singleton=1').fetchone();print(json.dumps(dict(version=r[0],sha=hashlib.sha256(r[1].encode()).hexdigest(),audit=d.execute('SELECT COUNT(*) FROM audit').fetchone()[0])));d.close()"
 return json.loads(out(['docker','exec',WEB,'python','-c',code]))
def compose(rid):return call(['docker','compose','--env-file',ENV,'-f',ROOT/'releases'/rid/'deploy/office/compose.yaml','up','-d','--no-build','--pull','never','--no-deps','office-web'])
def rollback_env(raw):
 assert raw.count('OFFICE_RELEASE_ID='+NEW)==1 and raw.count('OFFICE_IMAGE=local/star-office-ui:'+NEW)==1
 return raw.replace('OFFICE_RELEASE_ID='+NEW,'OFFICE_RELEASE_ID='+OLD).replace('OFFICE_IMAGE=local/star-office-ui:'+NEW,'OFFICE_IMAGE=local/star-office-ui:'+OLD)
def rollback_ingress(raw):
 assert NEW in raw and OLD not in raw
 return raw.replace(NEW,OLD)
def atomic_text(path,text,mode):
 tmp=path.with_name(path.name+'.layout-rollback.tmp');assert not tmp.exists();tmp.write_text(text);tmp.chmod(mode);os.replace(str(tmp),str(path))
def main():
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--check',action='store_true');g.add_argument('--confirm-web-only-cutover',action='store_true');a=p.parse_args()
 with (ROOT/'private/office-deploy.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  before=ids();config=conf();meta=json.loads((BACKUP/'metadata.json').read_text());effective=json.loads((BACKUP/'effective-ingress-metadata.json').read_text());assert meta['old_release']==OLD
  for r in meta['volumes']:assert sha(r['archive'])==r['sha256'] and r['isolated_restore_verified']
  assert sha(BACKUP/'office-v5-short-status-04.image.tar.gz')==meta['image_archive_sha256']
  assert sha(effective['backup'])==effective['sha256'];assert sha(WRAPPER)==effective['wrapper_sha256']
  assert json.loads(out(['docker','image','inspect',meta['old_image']]))[0]['Id']==meta['old_image_id']
  for rid in (OLD,NEW):call(['python3','-B',ROOT/'releases'/rid/'deploy/office/validate_release.py','verify',ROOT/'releases'/rid])
  raw=ENV.read_text();ingress=INGRESS.read_text();wrapper=WRAPPER.read_text();env_old=rollback_env(raw);ingress_old=rollback_ingress(ingress)
  assert hashlib.sha256(ingress_old.encode()).hexdigest()==effective['sha256'],'Ingress changed independently; inspect before rollback'
  assert wrapper.count('include '+str(INGRESS)+';')==1
  # Only create a syntax-check file under the private backup directory, no active config writes.
  check_wrapper=BACKUP/'nginx.rollback-check.conf';expected=wrapper.replace('include '+str(INGRESS)+';','include '+str(BACKUP/'office-public-employee.conf')+';')
  if check_wrapper.exists():assert check_wrapper.read_text()==expected
  else:check_wrapper.write_text(expected);check_wrapper.chmod(0o600)
  call([NGINX,'-t','-c',WRAPPER]);call([NGINX,'-t','-c',check_wrapper])
  assert ids()==before and conf()==config
  if not a.confirm_web_only_cutover:
   print(json.dumps(dict(check='passed',old_release=OLD,new_release=NEW,containers_unchanged=True,configuration_unchanged=True,no_rollback_executed=True)));return
  atomic_text(ENV,env_old,0o600)
  try:
   compose(OLD)
   for _ in range(45):
    c=json.loads(out(['docker','inspect',WEB]))[0]
    if c['Image']==meta['old_image_id'] and c['State'].get('Health',{}).get('Status')=='healthy':break
    time.sleep(2)
   else:raise RuntimeError('Web rollback health deadline exceeded')
   assert conf()==config;atomic_text(INGRESS,ingress_old,0o644);call([NGINX,'-t','-c',WRAPPER]);call(['systemctl','reload','star-office-ingress.service'])
   op=urllib.request.build_opener(urllib.request.ProxyHandler({}))
   with op.open('http://192.168.100.221:19000/',timeout=15) as r:assert ('/static/releases/'+OLD).encode() in r.read()
   after=ids()
   for n,c in before.items():
    if n!='/'+WEB:assert after[n]==c
   assert after['/'+WEB]['mounts']==before['/'+WEB]['mounts'] and conf()==config
   print(json.dumps(dict(rollback='passed',release_id=OLD,web_only=True,data_and_credentials_preserved=True)))
  except Exception:
   atomic_text(ENV,raw,0o600);atomic_text(INGRESS,ingress,0o644);compose(NEW);call([NGINX,'-t','-c',WRAPPER]);call(['systemctl','reload','star-office-ingress.service']);raise
if __name__=='__main__':main()
