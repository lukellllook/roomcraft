import { useEffect, useRef, useState } from 'react'

import { getLang, installDomI18n, setLang, type Lang } from '../../i18n'
import { initRoomScene } from './engine'

import './scene3d.scss'

installDomI18n()

/**
 * H5 房间场景页：three.js 实时渲染 + preview 同款交互。
 * RN 暂不支持该 WebGL 页面。
 */
export default function Scene() {
  const started = useRef(false)
  const [lang, setLangState] = useState<Lang>(getLang())

  useEffect(() => {
    if (started.current) return
    started.current = true
    initRoomScene()
  }, [])

  return (
    <div className='page'>
      <div className='stage' id='stage'>
        {/* ========== 入口 ========== */}
        <section className='lobby' id='lobby'>
          <div className='lobby-glow' />
          <div className='lobby-door'>
            <div className='lobby-leaf'>
              <div className='lobby-panel lobby-panel--top' />
              <div className='lobby-panel lobby-panel--bottom' />
              <div className='lobby-knob' />
            </div>
            <div className='lobby-mat' />
          </div>
          <div className='lobby-copy'>
            <span className='lobby-kicker'>ROOMCRAFT · DECOR</span>
            <h1 className='lobby-title'>我的家</h1>
            <span className='lobby-sub'>
              多个房间一起布置，墙面、地板、门窗和家具都能换色，
              <br />
              也能自己动手做一件新家具。
            </span>
          </div>
          <button className='enter-btn' id='enterBtn'>
            <span>进入房间</span>
            <i className='enter-arrow' />
          </button>
          <div className='lobby-meta' id='lobbyMeta' />
        </section>

        {/* ========== 房间 ========== */}
        <section className='room' id='room'>
          <div className='arch' id='arch'>
            <div className='gl-wrap' id='gl' />
          </div>

          <div className='furniture-layer' id='furnitureLayer' />

          <div className='hud'>
            <div className='hud-left'>
              <span className='hud-room'>ROOMCRAFT</span>
              <span className='hud-name'>MY HOME / 我的家</span>
            </div>
            <div className='hud-right'>
              <span className='hud-count' id='hudCount' />
              <span
                className='lang-btn'
                data-i18n-skip
                onClick={() => {
                  const next = lang === 'zh' ? 'en' : 'zh'
                  setLang(next)
                  setLangState(next)
                }}
              >
                {lang === 'zh' ? 'EN' : '中文'}
              </span>
              <div className='menu' id='menu'>
                <span className='menu-btn' id='menuBtn'>
                  菜单
                </span>
                <div className='menu-panel' id='menuPanel'>
                  <div className='menu-item' data-menu='export'>
                    导出布置
                  </div>
                  <div className='menu-item' data-menu='import'>
                    导入布置
                  </div>
                  <div className='menu-item menu-item--exit' data-menu='exit'>
                    退出房间
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className='room-tabs' id='roomTabs' />

          <div className='hud-hint' id='hudHint'>
            <div className='hud-hint-dot' />
            <span className='hud-hint-text'>
              点房间布置 · 拖地板挪房间 · 拖空白转视角 · 滚轮/双指缩放平移
            </span>
          </div>

          <div className='view-ctrl' id='viewCtrl'>
            <span className='view-btn view-btn--undo is-off' data-view='undo' title='返回上一步'>
              撤销
            </span>
            <span className='view-btn' data-view='in'>
              ＋
            </span>
            <span className='view-btn' data-view='out'>
              －
            </span>
            <span className='view-btn view-btn--reset' data-view='reset'>
              复位
            </span>
          </div>

          <div className='dock' id='dock' />

          <div className='picker' id='picker' />

          <div className='sheet' id='sheet'>
            <div className='sheet-head'>
              <div>
                <span className='sheet-kicker' id='sheetKicker'>
                  STORAGE
                </span>
                <span className='sheet-title' id='sheetTitle'>
                  添加元素
                </span>
              </div>
              <div className='sheet-close' id='sheetClose'>
                <i />
                <i />
              </div>
            </div>
            <div className='sheet-tabs'>
              <div className='sheet-tab is-on' data-tab='storage'>
                仓库
              </div>
              <div className='sheet-tab' data-tab='maker'>
                制作家具
              </div>
            </div>
            <div id='sheetBody' />
          </div>

          <div className='toast' id='toast' />
        </section>

        {/* ========== 分享卡（预览图 + 分享码） ========== */}
        <div className='share-mask' id='shareMask'>
          <div className='share-card'>
            <div className='share-head'>
              <span className='share-title' id='shareTitle'>
                导出布置
              </span>
              <span className='share-close' id='shareClose' />
            </div>
            <div className='share-body' id='shareBody' />
          </div>
        </div>
      </div>
    </div>
  )
}
