import { EN, EN_KEYS } from './dictionary'

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'roomcraft-lang'
const ATTRS = ['placeholder', 'title', 'alt', 'aria-label']
const SKIP = 'script,style,noscript,canvas,textarea,[data-i18n-skip]'

function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh' || saved === 'en') return saved
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return /^zh/i.test(nav) ? 'zh' : 'en'
}

let current: Lang = detectLang()

const textOriginals = new WeakMap<Text, string>()
const attrOriginals = new WeakMap<Element, Record<string, string>>()

let observer: MutationObserver | null = null

export function getLang(): Lang {
  return current
}

/** 翻译任意字符串（供 canvas / PDF 等非 DOM 场景使用）。 */
export function tr(input: string): string {
  if (current === 'zh' || !input) return input
  const matched = /^(\s*)([\s\S]*?)(\s*)$/.exec(input)
  if (!matched) return input
  const [, lead, core, tail] = matched
  if (!core) return input
  const exact = EN[core]
  if (exact !== undefined) return lead + exact + tail
  let out = core
  for (const key of EN_KEYS) {
    if (out.indexOf(key) === -1) continue
    out = out.split(key).join(EN[key])
  }
  return lead + out + tail
}

export function setLang(next: Lang): void {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  if (typeof document === 'undefined') return
  document.documentElement.lang = next === 'en' ? 'en' : 'zh-CN'
  document.title = next === 'en' ? 'RoomCraft · 3D Room Planner' : 'RoomCraft · 房间工坊'
  if (document.body) walk(document.body)
}

function translateText(node: Text): void {
  const raw = node.nodeValue
  if (!raw) return
  const parent = node.parentElement
  if (!parent || parent.closest(SKIP)) return

  const stored = textOriginals.get(node)
  if (current === 'zh') {
    if (stored !== undefined && raw !== stored) node.nodeValue = stored
    return
  }
  if (!/[\u4e00-\u9fa5]/.test(raw)) return

  if (stored === undefined) {
    textOriginals.set(node, raw)
  } else if (raw !== tr(stored)) {
    /* engine 重新渲染了这段文字：以新的中文原文为准 */
    textOriginals.set(node, raw)
  }

  const original = textOriginals.get(node) || raw
  const next = tr(original)
  if (node.nodeValue !== next) node.nodeValue = next
}

function translateAttrs(el: Element, only?: string | null): void {
  if (el.closest(SKIP)) return
  const names = only ? [only] : ATTRS
  for (const name of names) {
    if (!ATTRS.includes(name)) continue
    const raw = el.getAttribute(name)
    if (!raw) continue

    let map = attrOriginals.get(el)
    if (!map) {
      map = {}
      attrOriginals.set(el, map)
    }
    const stored = map[name]

    if (current === 'zh') {
      if (stored !== undefined && raw !== stored) el.setAttribute(name, stored)
      continue
    }
    if (!/[\u4e00-\u9fa5]/.test(raw)) continue

    if (stored === undefined) {
      map[name] = raw
    } else if (raw !== tr(stored)) {
      map[name] = raw
    }

    const original = map[name] || raw
    const next = tr(original)
    if (raw !== next) el.setAttribute(name, next)
  }
}

function walk(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    translateText(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  render(root as Element)
}

function render(el: Element): void {
  translateAttrs(el)
  if (el.closest(SKIP)) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node as Text)
    else translateAttrs(node as Element)
    node = walker.nextNode()
  }
}

/** 安装 DOM 文案翻译与语言切换监听，可重复调用。 */
export function installDomI18n(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  document.documentElement.lang = current === 'en' ? 'en' : 'zh-CN'
  if (current === 'en') document.title = 'RoomCraft · 3D Room Planner'

  const start = () => {
    if (!document.body) return
    walk(document.body)
    if (observer) observer.disconnect()
    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          translateText(mutation.target as Text)
        } else if (mutation.type === 'attributes') {
          translateAttrs(mutation.target as Element, mutation.attributeName)
        } else {
          mutation.addedNodes.forEach(walk)
        }
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS
    })
  }

  if (document.body) start()
  else document.addEventListener('DOMContentLoaded', start, { once: true })
}
