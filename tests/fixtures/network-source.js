// Same rule shapes as the user-provided Legado source; all text is synthetic.
export const sampleSource = {
  bookSourceName:'模拟书源',bookSourceUrl:'https://books.example.org',bookSourceType:0,enabled:true,
  searchUrl:"/modules/article/search.php,{ 'charset':'gbk', 'method':'POST', 'body':'searchkey={{key}}&page={{page}}' }",
  ruleSearch:{bookList:'.novelslistss li||.l li',name:'a.0@text',bookUrl:'a.0@href',author:'.s4@text',kind:'.s1@text&&.s7@text##小说|\\[|\\]|\\s.*',coverUrl:'a.0@href<js>throw new Error("must never execute")</js>'},
  ruleBookInfo:{name:'[property="og:novel:book_name"]@content',author:'[property="og:novel:author"]@content',intro:'#intro@html',kind:'[property="og:novel:category"]@content&&[property="og:novel:status"]@content##小说|\\s.*'},
  ruleToc:{chapterList:'#list dd a',chapterName:'text',chapterUrl:'href'},
  ruleContent:{content:'#content@html',replaceRegex:'##一秒记住.*免费阅读.|笔趣阁.*'},
}
export function mockSourceFetcher(requests = []) {
  return async (url,options={}) => {
    requests.push({url,options})
    const pathname=new URL(url).pathname
    if(pathname==='/sources.json')return {url,text:JSON.stringify([sampleSource,{...sampleSource,bookSourceName:'无效书源',ruleContent:{content:'@js:java.readFile("secret")'}}])}
    if(pathname==='/modules/article/search.php') return {url,text:'<ul class="l"><li><a href="/book/1">测试小说</a><span class="s4">测试作者</span><span class="s1">[悬疑小说]</span></li></ul>'}
    if(pathname==='/book/1') return {url,text:'<meta property="og:novel:book_name" content="测试小说"><meta property="og:novel:author" content="测试作者"><div id="intro">这是模拟简介。</div><div id="list"><dd><a href="/chapter/1">测试第一章</a></dd><dd><a href="/chapter/2">测试第二章</a></dd></div>'}
    if(pathname.startsWith('/chapter/')) return {url,text:'<div id="content">一秒记住广告免费阅读。<br>测试正文。<br><p>这是第二段。</p><script>window.bad=true</script></div>'}
    throw new Error('mock source offline')
  }
}
