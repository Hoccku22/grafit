/* Генератор значка приложения «Графит».
   Рендерит фирменный SVG (ромб-кристалл на графитовой плашке) в PNG 512×512
   средствами Electron и накладывает скруглённую маску с антиалиасингом.
   Запуск: npm run icon (результат: build/icon.png — используется окном и сборщиком). */
'use strict';

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const RADIUS_RATIO = 14 / 64; // как в favicon.svg (rx=14 при канве 64)

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">' +
  '<rect width="64" height="64" rx="14" fill="#1e1e21"/>' +
  '<path d="M32 9 55 32 32 55 9 32z" fill="none" stroke="#8b7bf7" stroke-width="4" stroke-linejoin="round"/>' +
  '<path d="M32 9v46M9 32h46" stroke="#8b7bf7" stroke-width="1.6" opacity="0.45"/>' +
  '</svg>';

app.disableHardwareAcceleration();

app.whenReady().then(async function () {
  try {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:0;width:' + SIZE + 'px;height:' + SIZE + 'px;overflow:hidden;background:#1e1e21}' +
      '</style></head><body>' + SVG + '</body></html>';

    const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(function (r) { setTimeout(r, 700); });

    const img = await win.webContents.capturePage();
    const dip = img.getSize(); // логический размер
    const bmp = img.toBitmap(); // BGRA
    const scale = Math.sqrt(bmp.length / 4 / (dip.width * dip.height));
    const W = Math.round(dip.width * scale);
    const H = Math.round(dip.height * scale);
    const R = RADIUS_RATIO * Math.min(W, H);

    // Маска скруглённого квадрата: расстояние до границы (SDF), антиалиасинг 1px
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const qx = Math.min(x + 0.5, W - x - 0.5) - R;
        const qy = Math.min(y + 0.5, H - y - 0.5) - R;
        const dx = Math.max(qx, 0);
        const dy = Math.max(qy, 0);
        const d = Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(qx, qy), 0);
        let a = 1;
        if (d >= 0.5) a = 0;
        else if (d > -0.5) a = 0.5 - d;
        if (a < 1) bmp[(y * W + x) * 4 + 3] = Math.round(bmp[(y * W + x) * 4 + 3] * a);
      }
    }

    const masked = nativeImage.createFromBitmap(bmp, { width: W, height: H });
    const out = path.join(__dirname, '..', 'build', 'icon.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, masked.toPNG());
    console.log('ICON_OK ' + out + ' (' + W + 'x' + H + ')');
    app.exit(0);
  } catch (e) {
    console.log('ICON_ERR ' + (e && e.message));
    app.exit(1);
  }
});
