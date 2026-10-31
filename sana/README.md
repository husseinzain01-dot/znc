# سنا (Sana)

مساعدة صوتية تحچي عراقي، بشكل ضوئي على الشاشة: كرة ذرات بحلقات تتحول لشكل
إنسان مضيء، وجهها يضوي وهي تحچي، وتلتفت يمين ويسار.

- **الشكل:** three.js، حوالي 10,000 ذرة تتحول بين الكرة والشكل، ويا توهّج (bloom). `src/figure.js` `src/scene.js`
- **السماع والصوت:** التعرّف على الكلام والأصوات الطبيعية بمتصفح Edge (عراقي إذا متوفر). بلا مفتاح. `src/voice.js`
- **الفهم:** أوامر عراقية بدون عقل أونلاين. `src/commands.js`، والفحوصات `node test/commands.test.mjs`
- **على ويندوز:** مساعد PowerShell صغير على `localhost:8780` يقدّم الصفحة ويفتح البرامج المسموحة، ونافذة Edge كاملة الشاشة. `installer/`

## البناء

```bash
npm install
node build.mjs                 # release/sana.html
node test/commands.test.mjs    # فهم الأوامر
bash installer/build.sh        # dist/Sana-Setup-<version>.exe (يحتاج makensis و Playwright)
```
