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
  '<defs>' +
  '<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#202027"/><stop offset="1" stop-color="#121216"/></linearGradient>' +
  '<radialGradient id="aura" cx="0.5" cy="0.44" r="0.62"><stop offset="0" stop-color="#8b7bf7" stop-opacity="0.30"/><stop offset="0.6" stop-color="#8b7bf7" stop-opacity="0.08"/><stop offset="1" stop-color="#8b7bf7" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="edge" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#d3cbff"/><stop offset="0.55" stop-color="#9d8ffa"/><stop offset="1" stop-color="#6a5bd8"/></linearGradient>' +
  '<linearGradient id="fac" x1="0.5" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#c3b8ff"/><stop offset="1" stop-color="#8b7bf7"/></linearGradient>' +
  '</defs>' +
  '<rect width="64" height="64" rx="14" fill="url(#bg)"/>' +
  '<rect width="64" height="64" rx="14" fill="url(#aura)"/>' +
  '<rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.4" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1.5"/>' +
  '<path d="M32 8.5 55.5 32 32 55.5 8.5 32z" fill="#8b7bf7" fill-opacity="0.10" stroke="url(#edge)" stroke-width="4.2" stroke-linejoin="round"/>' +
  '<path d="M32 16 48 32 32 48 16 32z" fill="none" stroke="url(#fac)" stroke-width="2.8" stroke-linejoin="round" stroke-opacity="0.9"/>' +
  '</svg>';

const TRAY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">' +
  '<rect width="64" height="64" rx="13" fill="#1b1b20"/>' +
  '<path d="M32 8 56 32 32 56 8 32z" fill="#8b7bf7" fill-opacity="0.22" stroke="#a99bff" stroke-width="5" stroke-linejoin="round"/>' +
  '<path d="M32 17.5 46.5 32 32 46.5 17.5 32z" fill="none" stroke="#d3cbff" stroke-width="4" stroke-linejoin="round"/>' +
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

    // Нормализуем снимок к ровно 768×768 (не зависим от масштаба экрана)
    const shot = await win.webContents.capturePage();
    const raised = shot.resize({ width: 768, height: 768, quality: 'best' });
    const bmp = raised.toBitmap(); // BGRA
    const W = 768, H = 768;
    if (bmp.length !== W * H * 4) console.log('ВНИМАНИЕ: bmp ' + bmp.length + ' байт, ожидалось ' + (W * H * 4));
    const R = RADIUS_RATIO * Math.min(W, H);

    // Маска скруглённого квадрата: SDF (отрицательно внутри), антиалиасинг 1px
    const cx0 = W / 2, cy0 = H / 2, hw0 = W / 2, hh0 = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const qx = Math.abs(x + 0.5 - cx0) - (hw0 - R);
        const qy = Math.abs(y + 0.5 - cy0) - (hh0 - R);
        const ax = Math.max(qx, 0);
        const ay = Math.max(qy, 0);
        const d = Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - R;
        let a = 1;
        if (d >= 0.5) a = 0;
        else if (d > -0.5) a = 0.5 - d;
        if (a < 1) bmp[(y * W + x) * 4 + 3] = Math.round(bmp[(y * W + x) * 4 + 3] * a);
      }
    }

    const masked = nativeImage.createFromBitmap(bmp, { width: W, height: H });
    const finalImg = masked.resize({ width: SIZE, height: SIZE, quality: 'best' });
    const out = path.join(__dirname, '..', 'build', 'icon.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, finalImg.toPNG());
    console.log('ICON_OK ' + out + ' (' + SIZE + 'x' + SIZE + ', рендер ' + W + 'x' + H + ')');

    // Значок для трея: упрощённая плитка с кристаллом, рендер 256 → 32
    try {
      const TR = 256;
      const trayHtml =
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
        'html,body{margin:0;padding:0;width:' + TR + 'px;height:' + TR + 'px;overflow:hidden;background:#1b1b20}' +
        '</style></head><body>' + TRAY_SVG + '</body></html>';
      const twin = new BrowserWindow({ width: TR, height: TR, show: false, frame: false, backgroundColor: '#1b1b20' });
      await twin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(trayHtml));
      await new Promise(function (r) { setTimeout(r, 600); });
      const tshot = await twin.webContents.capturePage();
      const timg = tshot.resize({ width: 32, height: 32, quality: 'best' });
      const tout = path.join(__dirname, '..', 'build', 'tray.png');
      fs.writeFileSync(tout, timg.toPNG());
      console.log('TRAY_OK ' + tout + ' (32x32)');
    } catch (e2) { console.log('TRAY_ERR ' + (e2 && e2.message)); }

    app.exit(0);
  } catch (e) {
    console.log('ICON_ERR ' + (e && e.message));
    app.exit(1);
  }
});
