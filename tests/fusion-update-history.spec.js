const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const ids = ['fusion_uma', 'fusion_maibo', 'fusion_bone', 'fusion_where', 'umaibo', 'uma_bone', 'where_uma', 'maibo_bone', 'where_maibo', 'where_bone', 'where_uma_bone_maibo', 'remote_participant_student', 'information_tired_student', 'corridor_student'];

test('0.24.0の更新情報に全14枚の現在の本文・能力値を個別掲載する', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  await page.goto(url);
  const records = await page.evaluate(ids => {
    showUpdatesScreen();
    const entry = UPDATE_HISTORY.find(entry => entry.version === 'ver.0.24.0');
    return ids.map(id => {
      const base = CARD_BASES[id];
      const changes = entry.changes.filter(change => change.title === base.name);
      return {name:base.name,count:changes.length,text:cardRulesText(createCardFromBase(id,'player')),
        after:changes[0]?.after,cost:base.cost,attack:base.attack,hp:base.hp,type:base.type,generated:base.generated};
    });
  },ids);
  const entry = page.locator('.update-entry').first();
  await entry.locator('summary').click();
  await expect(entry.locator('summary')).toContainText('ver.0.24.0');
  for (const card of records) {
    expect(card.count,card.name).toBe(1);
    expect(card.after.endsWith(card.text),card.name).toBe(true);
    expect(card.after).toContain(`戦意${card.cost}`);
    if(card.type==='student') { expect(card.after).toContain(`攻撃力${card.attack}`); expect(card.after).toContain(`体力${card.hp}`); }
    if(card.generated) expect(card.after).toContain('デッキ編成不可');
    await expect(entry.locator('.update-after > strong').filter({hasText:new RegExp(`^${card.name}$`)})).toHaveCount(1);
  }
  await expect(entry).toContainText('そのコピーを出席させる。');
  await expect(entry).toContainText('通路で粘る学生');
  await page.screenshot({path:test.info().outputPath('all-fusion-card-updates.png')});
});
