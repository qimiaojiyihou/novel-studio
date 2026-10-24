import catalog from '../../reader-service/default-sources.json' with {type:'json'}

export function catalogBeforeBiqugeTW(){
  const previous=structuredClone(catalog),id='28c9887c04f0431f790d3af9e914a780'
  previous.sources=previous.sources.filter(s=>s.id!==id)
  previous.version='global-all-sources-109bc02c839854d2'
  previous.previousVersion='global-all-sources-ace6f3dbe195e4f8'
  previous.total=47
  previous.name='用户指定44条书源：浏览器与规则兼容 + 番茄官网公开章节 + 挖矿成神专用'
  previous.addedSourceIds=[]
  delete previous.managedSourceVersions[id]
  delete previous.upgradeFrom[previous.version]
  for(const version of Object.keys(previous.upgradeFrom))previous.upgradeFrom[version]=previous.upgradeFrom[version].filter(value=>value!==id)
  return previous
}

// Pin historical rollout tests to the exact preceding content digest.
export function catalogBeforePhonePagination(){
  const previous=catalogBeforeBiqugeTW()
  previous.version='global-all-sources-ace6f3dbe195e4f8'
  previous.previousVersion='global-all-sources-10ae2a8ba1ae452d'
  previous.addedSourceIds=['6cfafad5bc407b7319d093a0cf0e6909']
  delete previous.upgradeFrom[previous.version]
  const phone=previous.sources.find(s=>s.id==='8992ef30eefdcd511519a0780f9d8bcd')
  delete phone.rules.ruleToc.nextTocUrl
  phone.version='674d7430af2c87c0e1c89b16138c6eb5b6d7d7f680239b4b29e9b73bee576d74'
  return previous
}
