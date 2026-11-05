/*! qrcode-generator
 * Copyright (c) 2009 Kazuhiko Arase
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import qrcode from "qrcode-generator";
import {safeGeneratedQrImage} from "./pairing-image.mjs";

// Bundled only inside the opaque hosted bridge. The vendor payload is used
// in memory to draw pixels, with no request, log, or raw payload on the port.
export function renderPairingImage(value, document = globalThis.document) {
  if (typeof value !== "string" || !value.length || value.length > 512 || /[^\x20-\x7e]/.test(value)) return null;
  try {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const canvas = document.createElement("canvas");
    const size = 256, modules = code.getModuleCount();
    const scale = Math.floor(size / (modules + 8));
    const offset = Math.floor((size - modules * scale) / 2);
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000";
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (code.isDark(row, column)) context.fillRect(offset + column * scale, offset + row * scale, scale, scale);
      }
    }
    return safeGeneratedQrImage(canvas.toDataURL("image/png"));
  } catch { return null; }
}
