import { toString as qrToString } from 'qrcode'

/**
 * A QR code as an inline SVG string, rendered **server-side**.
 *
 * No canvas, no client bundle, and no image request — which matters more here than it looks. A QR code
 * that arrives as a second HTTP request is a QR code that can fail to arrive, on the one screen whose
 * entire job is proving the network works (PRD 2 §4). As inline SVG it is part of the page or the page
 * did not render.
 *
 * `margin: 1` rather than the spec's default 4: the surrounding layout already provides quiet space,
 * and four modules of white inside a small box wastes the scannable area a phone camera needs.
 */
export function qrSvg(text: string): Promise<string> {
  return qrToString(text, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  })
}
