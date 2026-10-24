export async function returnShelf(page){if(await page.locator('#discovery').isVisible())await page.locator('#discovery-back').click()}
export async function networkShelf(page){await returnShelf(page);await page.locator('#network-library').click();await page.locator('#shelf').waitFor({state:'visible'})}
export async function sourcePage(page){
  if(await page.locator('#discovery').isVisible()){if(await page.locator('#discovery-sources').getAttribute('aria-pressed')!=='true')await page.locator('#discovery-sources').click()}
  else await page.locator('#manage-sources').click()
  await page.locator('#source-manager').waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.getElementById('network-tools').hasAttribute('aria-busy'))
  if(await page.locator('#source-manager').getAttribute('open')===null)await page.locator('#source-manager > summary').click()
}
export async function searchPage(page){
  if(await page.locator('#discovery').isVisible()){if(await page.locator('#discovery-search').getAttribute('aria-pressed')!=='true')await page.locator('#discovery-search').click()}
  else await page.locator('#find-books').click()
  await page.locator('#network-search-page').waitFor({state:'visible'})
  await page.waitForFunction(()=>!document.getElementById('network-tools').hasAttribute('aria-busy'))
}
