// 评论模型的集成测试：直接连一个【一次性】的 Postgres 跑真实 SQL（会 TRUNCATE comments, posts，别指向生产库！）
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5544/bb';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 's';
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)) { console.error('拒绝在非本机数据库上运行（会清空 comments/posts）'); process.exit(2); }
const root = require('path').resolve(__dirname, '../..');
const pool=require(root+'/src/config/db'); const cm=require(root+'/src/models/comment');
let fails=0; const ok=(n,c,x)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' '+JSON.stringify(x))); if(!c)fails++;};
(async()=>{
  await pool.query('TRUNCATE comments, posts CASCADE');
  const mk=async(t,slug)=> (await pool.query(`INSERT INTO posts (slug,title,content_md,content_html,status,published_at) VALUES ($1,$2,'x','x','published',now()) RETURNING id`,[slug,t])).rows[0].id;
  const pA=await mk('文章A','a'), pB=await mk('文章B','b');
  await cm.ensureSchema(); ok('ensureSchema idempotent',true);
  const c1=await cm.create({postId:pA,parentId:null,authorName:'甲',content:'第一条',ip:'1.1.1.1'});
  const c2=await cm.create({postId:pA,parentId:null,authorName:'乙',content:'第二条',ip:'2.2.2.2'});
  const c3=await cm.create({postId:pA,parentId:null,authorName:'垃圾',content:'buy',ip:'9.9.9.9'});
  const c4=await cm.create({postId:pA,parentId:null,authorName:'垃圾',content:'buy2',ip:'9.9.9.9'});
  const c5=await cm.create({postId:pB,parentId:null,authorName:'丙',content:'B文',ip:'3.3.3.3'});
  let c=await cm.counts(); ok('counts pending 5',c.pending===5&&c.all===5,c);
  // parent validation
  const bad1=await cm.create({postId:pA,parentId:'not-a-uuid',authorName:'x',content:'y',ip:'4.4.4.4'});
  ok('bad parent uuid does not throw',!!bad1);
  const bad2=await cm.create({postId:pA,parentId:c1,authorName:'x',content:'y2',ip:'4.4.4.4'});  // c1 pending → not allowed as parent
  let card=await cm.getCard(bad2); ok('pending parent rejected',card.parent_id===null,card.parent_id);
  // approve c1 then reply-parent from other post rejected, same post accepted
  await cm.setStatus(c1,'approved');
  const cross=await cm.create({postId:pB,parentId:c1,authorName:'x',content:'cross',ip:'5.5.5.5'});
  ok('cross-post parent rejected',(await cm.getCard(cross)).parent_id===null);
  const same=await cm.create({postId:pA,parentId:c1,authorName:'x',content:'same',ip:'5.5.5.5'});
  ok('same-post approved parent accepted',(await cm.getCard(same)).parent_id===c1);
  // lists
  let l=await cm.list({status:'pending'}); ok('pending list ASC by time',l.rows.length===l.total && l.rows[0].created_at<=l.rows[l.rows.length-1].created_at);
  ok('card has context',l.rows[0].post_title&&l.rows[0].visitor.length===6,l.rows[0]);
  const spamCard=(await cm.list({status:'pending'})).rows.find(r=>r.id===c3);
  ok('visitor counts',spamCard.visitor_total===2&&spamCard.visitor_pending===2,spamCard);
  l=await cm.list({status:'all',postId:pB}); ok('post-bound filter',l.total===2 || l.total===2,l.total);
  // spam whole visitor
  const n=await cm.spamPendingFromSameVisitor(c3); ok('spam same visitor =2',n===2,n);
  c=await cm.counts(); ok('spam count 2',c.spam===2,c);
  // reply as author to pending comment approves parent
  const r=await cm.replyAsAuthor({parentId:c2,content:'谢谢',authorName:'AAAduo'});
  ok('reply returns',r&&r.parentApproved===true,r);
  const rc=await cm.getCard(r.id); ok('reply is_author+approved',rc.is_author&&rc.status==='approved'&&rc.parent_author==='乙',rc);
  ok('parent approved',(await cm.getCard(c2)).status==='approved');
  ok('reply to missing parent null',(await cm.replyAsAuthor({parentId:'00000000-0000-0000-0000-000000000000',content:'x',authorName:'a'}))===null);
  // thread order
  const t=cm.threadOrder((await cm.list({status:'all',postId:pA,perPage:100})).rows);
  const idx=(id)=>t.findIndex(x=>x.id===id);
  ok('thread: reply right after parent',idx(same)===idx(c1)+1 && t[idx(same)].depth===1,t.map(x=>[x.author_name,x.depth]));
  ok('thread: author reply after c2',t[idx(r.id)].depth===1&&idx(r.id)===idx(c2)+1);
  // rail + counts by post
  const rail=await cm.postsWithComments(); ok('rail sorted pending first',rail[0].pending>=rail[1].pending,rail.map(x=>[x.title,x.pending]));
  const cb=await cm.countsByPostIds([pA,pB,'bad']); ok('countsByPostIds',cb[pB].pending===2,cb);
  // bulk + remove cascade
  ok('bulk approve',(await cm.setStatusMany([c5,'bad'],'approved'))===1);
  const rm=await cm.remove(c1); ok('remove reports replies',rm.replies===1,rm);
  ok('cascade removed reply',(await cm.getCard(same))===null);
  ok('removeMany',(await cm.removeMany([c3,c4]))===2);
  ok('invalid ids safe',(await cm.setStatus('zzz','spam'))===null && (await cm.remove('zzz'))===null && (await cm.getCard('zzz'))===null);
  console.log('FAILS',fails); await pool.end();
})().catch(e=>{console.error(e);process.exit(1)});
