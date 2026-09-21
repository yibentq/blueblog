// 不连数据库的编辑器测试桩：真实的 editor.ejs + 真实的 renderMarkdown，/admin/preview 逻辑与正式路由一致
// 只用来测编辑器的前端行为（工具栏/智能回车/预览/草稿…），不经过登录和 CSRF。
const path = require('path');
const root = path.resolve(__dirname, '../..');
const express = require(root + '/node_modules/express');
const {renderMarkdown,estimateReadingMinutes}=require(root+'/src/utils/markdown');
const app=express();
app.set('view engine','ejs'); app.set('views',root+'/views');
app.use(express.urlencoded({extended:true,limit:'200kb'}));
app.use(express.static(root+'/public'));
app.get('/editor',(req,res)=>res.render('admin/editor',{post:null,tags:[],tagValue:'',query:req.query,csrfToken:'tok',cspNonce:'n',assetVersion:1,maxUploadMb:8,currentPath:'/admin/posts/new'}));
app.post('/admin/preview',(req,res)=>{const md=typeof req.body.content_md==='string'?req.body.content_md:'';res.json({html:renderMarkdown(md),minutes:estimateReadingMinutes(md)});});
app.post('/admin/posts',(req,res)=>res.redirect('/editor?saved=1'));
app.post('/admin/upload',(req,res)=>setTimeout(()=>res.json({url:'/img/og-default.png',name:'x.png'}),500));
const PORT = process.env.STUB_PORT || 4317;
app.listen(PORT, () => console.log('stub up on ' + PORT));
