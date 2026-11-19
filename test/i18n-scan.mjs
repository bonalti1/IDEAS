// Reads the homeowner screens as code (round 13, item 1) and reports, with file and line:
//   keys        every sentence handed to t(...) / tr(...) / rich(...) or written as a says([...]) part
//   violations  English a homeowner would read that is NOT handed to them: bare JSX text, a title / placeholder /
//               aria-label written as a plain string, or a sentence in a string anywhere in the file
// Used by test/round13-i18n.test.mjs. The parser is Babel's, which Vite's React plugin already brings.
import fs from 'node:fs'
import { parse } from '@babel/parser'

/** The screens a homeowner sees, and the pieces they are built from. */
export const HOMEOWNER_FILES = [
  'src/draft/DraftApp.jsx',
  'src/draft/screens/Start.jsx',
  'src/draft/screens/SignIn.jsx',
  'src/draft/screens/Lot.jsx',
  'src/draft/screens/Style.jsx',
  'src/draft/screens/Program.jsx',
  'src/draft/screens/Draft.jsx',
  'src/draft/screens/Send.jsx',
  'src/draft/RulesPanel.jsx',
  'src/draft/TrustBlock.jsx',
  'src/draft/HouseScene.jsx',
  'src/draft/PlanDrawing.jsx',
  'src/draft/ui.jsx',
]

const T_CALLS = new Set(['t', 'tr', 'rich', 'phrase'])
// props whose text is read (or heard) by the homeowner
const TEXT_PROPS = new Set(['title', 'placeholder', 'aria-label', 'alt', 'label', 'lede', 'k', 'v', 'suffix'])
// props that never hold words
const CODE_PROPS = new Set(['className', 'style', 'viewBox', 'points', 'd', 'fill', 'stroke', 'strokeDasharray', 'strokeLinejoin', 'strokeLinecap', 'key', 'id', 'type', 'accept', 'href', 'src', 'role', 'target', 'rel', 'data-testid', 'htmlFor', 'autoComplete', 'transform', 'loading', 'mode', 'view', 'value', 'min', 'max', 'position', 'args', 'attach', 'font', 'anchorX', 'anchorY'])
const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/
// two words in a row: a sentence, not an id or a class name
const WORDS = /[A-Za-zÀ-ÖØ-öø-ÿ']{2,}[,.:;]? +[A-Za-zÀ-ÖØ-öø-ÿ]{2,}/

const quasiText = (node) => node.quasis.map((q) => q.value.cooked).join('${}')

function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return
  if (visit(node, parents) === false) return
  const next = [...parents, node]
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue
    const v = node[key]
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit, next))
    else if (v && typeof v.type === 'string') walk(v, visit, next)
  }
}

/** { keys: [{ file, line, key }], violations: [{ file, line, kind, text }], dynamic: [{ file, line, code }] } for one file. */
export function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8')
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  const keys = []
  const violations = []
  const dynamic = []
  const done = new Set() // string nodes already accounted for
  const at = (n) => n.loc.start.line
  const calleeName = (c) => (c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && c.property.type === 'Identifier' ? c.property.name : '')

  // pass 1: the sentences that are handed to the dictionary
  walk(ast.program, (node) => {
    if (node.type !== 'CallExpression') return
    const name = node.callee.type === 'Identifier' ? node.callee.name : ''
    if (T_CALLS.has(name)) {
      const a = node.arguments[0]
      const leaves = []
      const collect = (e) => {
        if (!e) return
        if (e.type === 'StringLiteral') leaves.push(e)
        else if (e.type === 'TemplateLiteral' && e.expressions.length === 0) leaves.push(e)
        else if (e.type === 'ConditionalExpression') (collect(e.consequent), collect(e.alternate))
        else if (e.type === 'LogicalExpression') (collect(e.left), collect(e.right))
        else dynamic.push({ file, line: at(e), code: src.slice(e.start, e.end) })
      }
      collect(a)
      for (const leaf of leaves) {
        done.add(leaf)
        keys.push({ file, line: at(leaf), key: leaf.type === 'StringLiteral' ? leaf.value : leaf.quasis[0].value.cooked })
      }
    }
    // says(['Back to version {n}.', { n }], …) and DraftApp's notes.push(['…', { … }])
    const tuples = name === 'says' || (node.callee.type === 'MemberExpression' && calleeName(node.callee) === 'push' && node.callee.object.type === 'Identifier' && node.callee.object.name === 'notes')
    if (tuples)
      node.arguments.forEach((arg) =>
        walk(arg, (n) => {
          if (n.type === 'ArrayExpression' && n.elements[0]?.type === 'StringLiteral') {
            done.add(n.elements[0])
            keys.push({ file, line: at(n.elements[0]), key: n.elements[0].value })
          }
        }),
      )
  })

  // pass 2: English that is not handed to it
  const report = (node, kind, text) => violations.push({ file, line: at(node), kind, text: String(text).trim().replace(/\s+/g, ' ') })
  // the values an expression can come out as: both arms of a ?:, the right side of &&, the pieces of a + or a template
  const outcomes = (e, out = []) => {
    if (!e) return out
    if (e.type === 'ConditionalExpression') (outcomes(e.consequent, out), outcomes(e.alternate, out))
    else if (e.type === 'LogicalExpression') (e.operator !== '&&' && outcomes(e.left, out), outcomes(e.right, out))
    else if (e.type === 'BinaryExpression' && e.operator === '+') (outcomes(e.left, out), outcomes(e.right, out))
    else if (e.type === 'TemplateLiteral') (out.push(e), e.expressions.forEach((x) => outcomes(x, out)))
    else if (e.type === 'StringLiteral') out.push(e)
    else if (e.type === 'ParenthesizedExpression') outcomes(e.expression, out)
    return out
  }
  const flagOutcomes = (expr, kind) => {
    for (const leaf of outcomes(expr)) {
      if (done.has(leaf)) continue
      const text = leaf.type === 'StringLiteral' ? leaf.value : quasiText(leaf)
      if (LETTER.test(text.replace(/\$\{\}/g, ''))) (done.add(leaf), report(leaf, kind, text))
    }
  }
  walk(ast.program, (node, parents) => {
    if (node.type === 'ImportDeclaration') return false
    const parent = parents[parents.length - 1]
    if (node.type === 'JSXText') {
      if (LETTER.test(node.value)) report(node, 'JSX text', node.value)
      return
    }
    if (node.type === 'JSXAttribute') {
      const name = node.name.name
      if (CODE_PROPS.has(name)) return false
      if (TEXT_PROPS.has(name)) {
        if (node.value?.type === 'StringLiteral' && LETTER.test(node.value.value)) (done.add(node.value), report(node.value, `${name}="…"`, node.value.value))
        else if (node.value?.type === 'JSXExpressionContainer') flagOutcomes(node.value.expression, `${name}={…}`)
      }
      return
    }
    // a value written straight into the page: {cond ? 'English' : …}
    if (node.type === 'JSXExpressionContainer' && (parent?.type === 'JSXElement' || parent?.type === 'JSXFragment')) {
      flagOutcomes(node.expression, 'JSX value')
      return
    }
    // a sentence in a string anywhere else (an error line, a chat line, a note)
    if ((node.type === 'StringLiteral' || node.type === 'TemplateLiteral') && !done.has(node)) {
      const text = node.type === 'StringLiteral' ? node.value : quasiText(node)
      if (!WORDS.test(text.replace(/\$\{\}/g, ' ')) || /^<svg /.test(text)) return
      // compared, not shown: parcel.reason === 'the address was not found'
      if (parent?.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) return
      if (parent?.type === 'ObjectProperty' && parent.key === node) return
      done.add(node)
      report(node, 'string', text)
    }
  })
  return { keys, violations, dynamic }
}

/** Every homeowner file at once. */
export function scanAll(files = HOMEOWNER_FILES) {
  const out = { keys: [], violations: [], dynamic: [] }
  for (const f of files) {
    const r = scanFile(f)
    out.keys.push(...r.keys)
    out.violations.push(...r.violations)
    out.dynamic.push(...r.dynamic)
  }
  return out
}
