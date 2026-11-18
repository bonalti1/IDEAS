// The fit check off the main thread: the rooms step posts { id, program, styleId, lot } and gets
// { id, check } back, so a +/- tap never freezes the screen while a draft is drawn and checked.
import { fitsLot } from './fit.js'
import { STYLES } from './styles.js'

self.onmessage = (e) => {
  const { id, program, styleId, lot } = e.data || {}
  try {
    const style = STYLES.find((s) => s.id === styleId) || STYLES.find((s) => s.ready) || STYLES[0]
    self.postMessage({ id, check: fitsLot(program, style, lot) })
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) })
  }
}
