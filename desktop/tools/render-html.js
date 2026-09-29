/* Проверочный рендер HTML-файла: открывает его в скрытом окне Electron и делает снимок.
   Запуск: npx electron tools/render-html.js <файл.html> <выход.png> */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

const TARGET = process.argv[2];
const OUT = process.argv[3];

app.disableHardwareAcceleration();

app.whenReady().then(async function () {
  try {
    const win = new BrowserWindow({ width: 1440, height: 1100, show: false });
    await win.loadFile(TARGET);
    await new Promise(function (r) { setTimeout(r, 900); });
    const img = await win.webContents.capturePage();
    fs.writeFileSync(OUT, img.toPNG());
    console.log('RENDER_OK ' + OUT);
    app.exit(0);
  } catch (e) {
    console.log('RENDER_ERR ' + (e && e.message));
    app.exit(1);
  }
});
