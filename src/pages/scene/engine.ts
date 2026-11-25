// @ts-nocheck
/* 由 preview/index.html 的交互逻辑移植：H5 three.js 房间场景引擎 */
import * as THREE from 'three'
import { deflateSync, inflateSync } from 'fflate'
import { tr } from '../../i18n'
import {
  FLOORPLAN_CATALOG,
  FLOORPLAN_GROUPS,
  buildFloorplanFurniture,
  resetFloorplanMaterials,
  furnitureThumb
} from './floorplanFurniture'

export function initRoomScene() {
/* ---------- 家具数据 ---------- */
      /* 家具取消大中小，直接按米数调宽/深；旧存档的 sm/md/lg 只用于迁移 */
      const LEGACY_SIZE_SCALE = { sm: 0.86, md: 1, lg: 1.16 }
      const FURN_DIM = { min: 0.3, max: 4, step: 0.05 }
      /* 家具离地高度：所有家具都能上下调，0 为落地 */
      const FURN_Y = { min: 0, max: 2.6, step: 0.05 }
      const DIY_SCALE = { min: 0.5, max: 2, step: 0.05 }
      const STAGE_W = 375
      const SCENE_H = 504

      /* 家具全部改为 floorplan-3d 开源家具库 */
      const CATALOG = FLOORPLAN_CATALOG
      const FURNITURE_GROUPS = FLOORPLAN_GROUPS
      const TYPES = Object.keys(CATALOG)

      function isWallType(type: string) {
        const def = CATALOG[type]
        return !!(def && def.wall)
      }

      /* 家具实际宽/深：优先取用户调过的数据，否则用家具库默认尺寸 */
      function itemDims(item) {
        const def = item ? CATALOG[item.type] : null
        const baseW = def ? def.w : 1
        const baseD = def ? def.d : 1
        const pick = (value, fallback) => {
          const num = Number(value)
          if (!isFinite(num) || num <= 0) return fallback
          return clamp(num, FURN_DIM.min, FURN_DIM.max)
        }
        return { w: pick(item && item.w, baseW), d: pick(item && item.d, baseD) }
      }

      const TONE_SWATCHES = [
        /* 中性 / 米白 */
        '#f7f2e8', '#efe7d7', '#e2d5bf', '#d0c0a6',
        '#b8a88e', '#988a74', '#746756', '#4a443c',
        /* 木色 / 大地 */
        '#e8c9a0', '#d9b07c', '#c99a63', '#b5824c',
        '#9c6b3d', '#7d5430', '#5f3f26', '#3f2c1c',
        /* 暖色 / 艳色 */
        '#e8b04b', '#d98b45', '#c96f52', '#cf5f56',
        '#b8635a', '#b04a6a', '#c9a24a', '#d9b479',
        /* 冷色 / 绿蓝 */
        '#8fae7f', '#6f9a72', '#4f9a6a', '#7d9a8b',
        '#3f8fa0', '#5f7c8f', '#3f6fa8', '#6a72b8',
        /* 紫 / 灰 */
        '#ab93b8', '#8a5bb0', '#93a68b', '#a89a8a',
        '#8fa3b8', '#7d7a75', '#565a5c', '#2f3437',
        /* 浅灰 / 银白 */
        '#f8f8f6', '#eeeeec', '#e0e2e1', '#cfd3d3',
        '#bcc2c3', '#a8afb1', '#8f9799', '#737b7e'
      ]

      /* ---------- DIY 捏家具：只用基础体块，不再选家具类型 ---------- */
      const DIY_SHAPES = [
        { id: 'box', name: '方块' },
        { id: 'cyl', name: '圆柱' },
        { id: 'sphere', name: '圆球' },
        { id: 'cone', name: '圆锥' }
      ]
      const DIY_SHAPE_IDS = DIY_SHAPES.map(item => item.id)
      const DIY_SHAPE_NAME = { box: '方块', cyl: '圆柱', sphere: '圆球', cone: '圆锥' }
      const DIY_LIMIT = 24
      const DIY_DEFAULT_COLOR = '#d7bb95'
      const DIY_LIB_KEY = 'myhome-diy-works-v1'
      const DIY_PACKED = 'MYDIY1:'
      const DIY_PLAIN = 'MYDIY0:'

      /* 默认装修：城中村经典旧屋风格 —— 泛黄白墙 + 旧米灰地砖 + 发灰铝合金窗 + 深红棕铁门 */
      const SCENE_PARTS = {
        wall: { name: '墙面', tag: '结构', tones: ['#e4ded0', '#ddd6c6', '#d6cfbe', '#cfc7b5'] },
        floor: { name: '地板', tag: '结构', tones: ['#c2b8a4', '#b8ad97', '#aea28b', '#a4977f'] },
        baseboard: { name: '踢脚线', tag: '结构', tones: ['#9c9285', '#8f8578', '#a89e90', '#7f766b'] },
        window: { name: '窗户', tag: '墙面', tones: ['#b5b3ac', '#a9a7a0', '#9c9a93', '#8e8c85'] },
        door: { name: '门', tag: '墙面', tones: ['#5e3b2e', '#6a4436', '#523327', '#452b21'] }
      }
      const SCENE_TYPES = ['wall', 'floor', 'baseboard']
      const OPENING_TYPES = ['window', 'door']

      /* ---------- 墙面 / 地板铺装：瓷砖、木板 ---------- */
      const SURFACE_KINDS = [
        { id: 'plain', name: '素面' },
        { id: 'tile', name: '瓷砖' },
        { id: 'wood', name: '木板' }
      ]
      /* size 为单块瓷砖的边长 / 单条木板的宽度，单位米 */
      const SURFACE_SIZE = {
        tile: { min: 0.1, max: 1.2, step: 0.05, def: 0.3 },
        wood: { min: 0.06, max: 0.4, step: 0.01, def: 0.16 }
      }
      /* 木板纹理单元：4 条板并排，沿纹理方向长 1.2m */
      const WOOD_UNIT_LEN = 1.2
      const WOOD_UNIT_ROWS = 4
      /* 铺装色预设：瓷砖偏石色 / 冷灰，木板偏木色；null 表示跟随墙面 / 地板配色 */
      const SURFACE_TONES = {
        tile: ['#f2ede4', '#e2ddd3', '#c8d0ce', '#b0babc', '#9a9a94'],
        wood: ['#e6cba4', '#d3b083', '#bd8f5f', '#a67749', '#7d5735']
      }

      /* ---------- 颜色工具 ---------- */
      function hexToRgb(hex) {
        let clean = hex.replace('#', '')
        if (clean.length === 3) clean = clean.split('').map(ch => ch + ch).join('')
        const value = parseInt(clean, 16)
        return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
      }

      function rgbToHex(r, g, b) {
        const to = n => Math.round(Math.min(Math.max(n, 0), 255)).toString(16).padStart(2, '0')
        return '#' + to(r) + to(g) + to(b)
      }

      function mix(a, b, t) {
        const ca = hexToRgb(a)
        const cb = hexToRgb(b)
        return rgbToHex(ca.r + (cb.r - ca.r) * t, ca.g + (cb.g - ca.g) * t, ca.b + (cb.b - ca.b) * t)
      }

      function shade(hex, amount) {
        return amount >= 0 ? mix(hex, '#ffffff', amount) : mix(hex, '#000000', -amount)
      }

      function withAlpha(hex, alpha) {
        const c = hexToRgb(hex)
        return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + alpha + ')'
      }

      function toneColors(type, tone) {
        switch (type) {
          case 'plant':
            return { pot: tone, potDark: shade(tone, -0.24), leaf: mix(tone, '#6f9a72', 0.72), leaf2: mix(tone, '#8fb08a', 0.8) }
          case 'shelf':
            return { frame: shade(tone, -0.08), panel: mix(tone, '#f8f3e7', 0.74), accent: shade(tone, -0.16) }
          case 'cabinet':
            return { wood: tone, woodLight: shade(tone, 0.16), woodDark: shade(tone, -0.2), knob: shade(tone, -0.42) }
          case 'lamp':
            return { shade: tone, shadeDark: shade(tone, -0.16), glow: withAlpha(tone, 0.42), stand: shade(tone, -0.4) }
          case 'chair':
            return { seat: tone, seatLight: shade(tone, 0.18), seatDark: shade(tone, -0.16), leg: shade(tone, -0.4) }
          case 'rug':
            return { rug: tone, line: shade(tone, 0.28) }
          case 'frame':
            return { frame: tone, frameDark: shade(tone, -0.2), paper: mix(tone, '#fbf6ea', 0.86), art1: shade(tone, 0.24), art2: shade(tone, -0.28) }
          case 'table':
            return { top: shade(tone, 0.14), topLight: shade(tone, 0.3), wood: tone, leg: shade(tone, -0.36) }
          case 'sofa':
            return { fabric: tone, fabricLight: shade(tone, 0.16), fabricDark: shade(tone, -0.18), cushion: mix(tone, '#f6efe1', 0.4), leg: shade(tone, -0.46) }
          case 'stool':
            return { seat: tone, seatLight: shade(tone, 0.2), seatDark: shade(tone, -0.18), leg: shade(tone, -0.42) }
          case 'mirror':
            return { frame: tone, frameDark: shade(tone, -0.18), glass: mix(tone, '#dfeef0', 0.78), shine: withAlpha('#ffffff', 0.5) }
          case 'column':
            return { body: tone, bodyLight: shade(tone, 0.14), bodyDark: shade(tone, -0.2) }
          case 'fridge':
            return { body: tone, bodyLight: shade(tone, 0.16), bodyDark: shade(tone, -0.16), handle: shade(tone, -0.42), panel: shade(tone, -0.28) }
          case 'computer':
            return { body: tone, bodyLight: shade(tone, 0.18), bodyDark: shade(tone, -0.24), screen: mix(tone, '#22303c', 0.82), accent: mix(tone, '#8fa9bd', 0.5) }
          case 'washer':
            return { body: tone, bodyLight: shade(tone, 0.16), bodyDark: shade(tone, -0.16), drum: mix(tone, '#c6d2d6', 0.6), panel: shade(tone, -0.3) }
          case 'stove':
            return { body: tone, bodyLight: shade(tone, 0.16), bodyDark: shade(tone, -0.2), top: shade(tone, 0.1), burner: mix(tone, '#2a2c2e', 0.75), grill: shade(tone, -0.55) }
          case 'bed':
            return { frame: tone, frameDark: shade(tone, -0.22), sheet: mix(tone, '#f6f1e6', 0.72), blanket: shade(tone, -0.08), pillow: mix(tone, '#ffffff', 0.66) }
          case 'diningSet':
            return { top: shade(tone, 0.16), topLight: shade(tone, 0.32), wood: tone, leg: shade(tone, -0.34), seat: shade(tone, -0.06) }
          case 'cat':
          case 'dog':
            return { body: tone, bodyLight: shade(tone, 0.18), bodyDark: shade(tone, -0.2) }
          default:
            return { rim: tone, face: mix(tone, '#fdfaf1', 0.88), hand: shade(tone, -0.42) }
        }
      }

      function itemColors(item) {
        if (item.tone) return { color: item.tone }
        const def = CATALOG[item.type]
        return (def.palettes[item.palette] || def.palettes[0]).c
      }

      function sceneTone(part) {
        return sceneState[part].tone || SCENE_PARTS[part].tones[0]
      }

      function openingTone(o) {
        return o.tone || SCENE_PARTS[o.kind].tones[0]
      }

      function selectedOpening() {
        if (!selection || selection.kind !== 'opening') return null
        return openings.find(o => o.id === selection.id) || null
      }

      function sceneCss(part) {
        const tone = sceneTone(part)
        if (part === 'wall') {
          return {
            wall: 'linear-gradient(180deg, ' + shade(tone, 0.06) + ' 0%, ' + tone + ' 60%, ' + shade(tone, -0.05) + ' 100%)',
            board: shade(tone, -0.12),
            boardLine: shade(tone, -0.24)
          }
        }
        if (part === 'floor') {
          return {
            floor: 'linear-gradient(180deg, ' + shade(tone, 0.06) + ' 0%, ' + shade(tone, -0.08) + ' 100%)',
            plank: withAlpha(shade(tone, -0.6), 0.16),
            seam: withAlpha(shade(tone, -0.6), 0.09)
          }
        }
        if (part === 'window') {
          return {
            frame: tone,
            bar: tone,
            sill: tone,
            sillShadow: withAlpha(shade(tone, -0.6), 0.2)
          }
        }
        return {
          frame: shade(tone, -0.1),
          leaf: 'linear-gradient(90deg, ' + shade(tone, 0.08) + ' 0%, ' + shade(tone, -0.01) + ' 62%, ' + shade(tone, -0.1) + ' 100%)',
          panel: withAlpha(shade(tone, -0.45), 0.34),
          knob: '#c4a97f'
        }
      }

      let placed = [
        /* 沙发靠后墙居中，茶几/地毯在其前方，电视柜在对面；入口区（后墙右侧门旁）放鞋柜 */
        { id: 'std-rug', type: 'rug', name: '地毯', palette: 0, tone: null, style: 'std', size: 'md', wx: -0.45, wy: 0, wz: -0.55 },
        { id: 'std-sofa', type: 'sofa3', name: '三人沙发', palette: 0, tone: null, style: 'std', size: 'md', rotY: 0, wx: -0.33, wy: 0, wz: -1.93 },
        { id: 'std-coffee', type: 'coffeetable', name: '茶几', palette: 0, tone: null, style: 'std', size: 'md', wx: -0.45, wy: 0, wz: -0.6 },
        { id: 'std-tvstand', type: 'tvstand', name: '电视柜', palette: 0, tone: null, style: 'std', size: 'md', rotY: 180, wx: -0.4, wy: 0, wz: 2.18 },
        { id: 'std-armchair', type: 'armchair', name: '单人沙发', palette: 0, tone: null, style: 'std', size: 'md', rotY: -90, wx: 1.2, wy: 0, wz: -0.32 },
        { id: 'std-side', type: 'sidetable', name: '边几', palette: 0, tone: null, style: 'std', size: 'md', wx: 1.22, wy: 0, wz: -1.05 },
        { id: 'std-floorlamp', type: 'floorlamp', name: '落地灯', palette: 0, tone: null, style: 'std', size: 'md', wx: 1.5, wy: 0, wz: -2.155 },
        { id: 'std-plant', type: 'plantbig', name: '大绿植', palette: 0, tone: null, style: 'std', size: 'md', wx: -2.4, wy: 0, wz: 2.0 },
        { id: 'std-ac', type: 'acwall', name: '挂机空调', palette: 0, tone: null, style: 'std', size: 'md', wx: -0.45, wy: 0, wz: -2.3 }
      ]
      let sceneState = {
        /* 城中村经典做法：墙脚 1/3 高贴 300 瓷片，上半留白墙 */
        wall: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#ddd8cc', coverH: 1.20, hidden: false },
        /* 城中村旧屋默认地砖：500×500 旧米灰耐磨砖 */
        floor: { tone: null, finish: 'tile', finishSize: 0.5, finishTone: '#c2b8a4', hidden: false },
        baseboard: { tone: null, hidden: true }
      }
      /* 门窗独立摆件：side 决定贴在哪面墙，u 是沿墙位置，y 是中心高度 */
      let openings = [
        { id: 'win-1', kind: 'window', side: 'left', u: 0.85, y: 1.81, tone: null, curtain: true, curtainTone: null },
        { id: 'door-1', kind: 'door', side: 'left', u: -1.67, y: 0, tone: null },
        { id: 'door-3', kind: 'door', side: 'back', u: 2.5, y: 0, tone: null }
      ]
      let openingSeq = 8

      /* ---------- 户型：每间房有自己的平面坐标（cx/cz），可自由摆放 ---------- */
      /* 层高与窗高参照 floorplan-3d：层高 2.8m、窗台 0.9m、窗顶 2.4m */
      const ROOM_H = 2.8
      const WINDOW_HEAD = 2.4
      const rooms = [
        { id: 'living', name: '客厅', w: 6.4, d: 4.8, cx: 0, cz: 0, state: sceneState, openings: openings, placed: placed },
        {
          id: 'bedroom',
          name: '卧室',
          w: 5.6,
          d: 4.4,
          cx: 0.4,
          cz: -4.6,
          state: {
            wall: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#ddd8cc', coverH: 1.20, hidden: false },
            floor: { tone: null, finish: 'tile', finishSize: 0.5, finishTone: '#c2b8a4', hidden: false },
            baseboard: { tone: null, hidden: true }
          },
          openings: [
            /* 左墙外是厨房/浴室，窗户开在后墙偏右，给卧室采光 */
            { id: 'win-bd', kind: 'window', side: 'back', u: 0.53, y: 1.76, tone: null, curtain: true, curtainTone: null }
          ],
          placed: [
            /* 床转 90° 靠左墙、衣柜靠右墙、梳妆台和椅子在后墙左角 */
            { id: 'bd-bed', type: 'bed18', name: '双人床 1.8m', palette: 0, tone: null, style: 'std', size: 'md', rotY: 90, wx: -1.78, wy: 0, wz: 0.855 },
            { id: 'bd-wardrobe', type: 'wardrobe20', name: '衣柜', palette: 0, tone: null, style: 'std', size: 'md', rotY: -90, wx: 2.48, wy: 0, wz: -1.18 },
            { id: 'bd-dresser', type: 'dresser', name: '梳妆台', palette: 0, tone: null, style: 'std', size: 'md', rotY: 0, wx: -2.2, wy: 0, wz: -1.97 },
            { id: 'bd-chair', type: 'chair', name: '椅子', palette: 1, tone: null, style: 'std', size: 'md', rotY: 180, wx: -2.2, wy: 0, wz: -1.42 },
            { id: 'bd-ac', type: 'acwall', name: '挂机空调', palette: 0, tone: null, style: 'std', size: 'md', wx: -1.69, wy: 0, wz: -2.1 }
          ]
        },
        {
          id: 'kitchen',
          name: '厨房',
          w: 2.4,
          d: 2.6,
          cx: -3.6,
          cz: -3.7,
          state: {
            /* 城中村厨房：满墙白瓷片 + 300 防滑地砖 */
            wall: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#e7ebec', hidden: false },
            floor: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#c9cdc9', hidden: false },
            baseboard: { tone: null, hidden: true }
          },
          openings: [
            /* 门改到后墙，与浴室之间连通；左墙开一扇 1.25m 窄窗采光，不挂帘 */
            { id: 'door-6', kind: 'door', side: 'back', u: 0.47, y: 0, tone: null },
            { id: 'win-7', kind: 'window', side: 'left', u: 0.23, y: 2.01, tone: null, w: 1.25, h: 1.1, curtain: false, curtainTone: null }
          ],
          placed: [
            /* 一整条 2.5m 独立台面贴左墙 */
            { id: 'fx-worktop-1', type: 'worktop', name: '独立台面', palette: 0, tone: null, style: 'std', size: 'md', rotY: 90, wx: -0.88, wy: 0, wz: -0.05, w: 2.5 }
          ]
        },
        {
          id: 'bath',
          name: '浴室',
          w: 2.4,
          d: 1.8,
          cx: -3.6,
          cz: -5.9,
          state: {
            /* 城中村浴室：满墙浅灰瓷片 + 300 防滑地砖 */
            wall: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#e6ecee', hidden: false },
            floor: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#cbd1d1', hidden: false },
            baseboard: { tone: null, hidden: true }
          },
          openings: [
            /* 浴室左墙开一扇 1m 小窗，不挂帘 */
            { id: 'win-8', kind: 'window', side: 'left', u: 0, y: 1.96, tone: null, w: 1, h: 1.35, curtain: false, curtainTone: null }
          ],
          placed: [
            /* 浴室：蹲厕转 90° 贴左墙、浴室柜转 180° 贴左墙、淋浴设备在右后、热水器挂后墙 */
            { id: 'ba-squat', type: 'squattoilet', name: '蹲式厕所', palette: 0, tone: null, style: 'std', size: 'md', rotY: 90, wx: -0.63, wy: 0, wz: -0.42, d: 0.9 },
            { id: 'ba-vanity', type: 'vanity80', name: '浴室柜', palette: 0, tone: null, style: 'std', size: 'md', rotY: 180, wx: -0.62, wy: 0, wz: 0.63 },
            { id: 'ba-shower', type: 'showerset', name: '淋浴设备', palette: 0, tone: null, style: 'std', size: 'md', rotY: 0, wx: 0.73, wy: 0, wz: -0.43 },
            { id: 'ba-heater', type: 'waterheater', name: '电热水器', palette: 0, tone: null, style: 'std', size: 'md', wx: -0.32, wy: 0, wz: -0.8 }
          ]
        },
        {
          id: 'balcony',
          name: '阳台',
          w: 1.6,
          d: 4.8,
          cx: -4.0,
          cz: 0,
          state: {
            /* 城中村阳台：半墙瓷片 + 防滑地砖 */
            wall: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#dfe4e0', coverH: 1.2, hidden: false },
            floor: { tone: null, finish: 'tile', finishSize: 0.3, finishTone: '#c6c9c4', hidden: false },
            baseboard: { tone: null, hidden: true }
          },
          openings: [
            /* 后墙通厨房的小门 + 左墙整面大窗 */
            { id: 'door-4', kind: 'door', side: 'back', u: 0, y: 0, tone: null },
            { id: 'win-5', kind: 'window', side: 'left', u: 0, y: 1.84, tone: null, w: 3.9, h: 1.5, curtain: false, curtainTone: null }
          ],
          placed: [
            /* 洗衣机*/
            { id: 'bl-washer', type: 'washer', name: '洗衣机', palette: 0, tone: null, style: 'std', size: 'md',rotY: 180, wx: 0, wy: 0, wz: 2.0 },
          ]
        }
      ]
      let activeRoomId = 'living'
      let overviewMode = true
      let roomSeq = 3

      function roomById(id) { return rooms.find(r => r.id === id) }
      function activeRoom() { return roomById(activeRoomId) || rooms[0] }
      function roomTone(room, part) { return room.state[part].tone || SCENE_PARTS[part].tones[0] }
      function baseboardTone(room) {
        return room.state.baseboard.tone || shade(roomTone(room, 'wall'), -0.12)
      }
      function roomBackZ(room) { return room.cz - room.d / 2 }

      /* 房间占地矩形（可传入候选坐标） */
      function roomRect(room, cx, cz) {
        const x = cx === undefined ? room.cx : cx
        const z = cz === undefined ? room.cz : cz
        return { minX: x - room.w / 2, maxX: x + room.w / 2, minZ: z - room.d / 2, maxZ: z + room.d / 2, w: room.w, d: room.d }
      }

      /* 整套房子的包围盒，用于全屋机位与平移范围 */
      function houseBounds() {
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
        rooms.forEach(room => {
          const r = roomRect(room)
          minX = Math.min(minX, r.minX); maxX = Math.max(maxX, r.maxX)
          minZ = Math.min(minZ, r.minZ); maxZ = Math.max(maxZ, r.maxZ)
        })
        if (!isFinite(minX)) { minX = -4; maxX = 4; minZ = -4; maxZ = 4 }
        return {
          minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ,
          w: maxX - minX, d: maxZ - minZ,
          cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2
        }
      }

      /* 切换正在布置的房间：让全局状态指向该房间的数据 */
      function bindRoom(id) {
        const room = roomById(id)
        if (!room) return
        activeRoomId = room.id
        sceneState = room.state
        openings = room.openings
        placed = room.placed
      }
      let selection = null
      let entered = false
      let sheetOpen = false
      let sheetTab = 'storage'
      let pickerOpen = false
      /* 色盘目标：非空时是在给墙面 / 地板的铺装（瓷砖、木板）调色 */
      let finishPickerPart = null
      /* 色盘当前是否在给窗帘取色 */
      let curtainPicker = false
      let hintDismissed = false
      let sizeCustomOpen = false
      let roomRenameOpen = false
      let pendingDeleteId = null
      let deleteTimer = null
      let toastTimer = null
      let customSeq = 1
      let diySeq = 1
      let diy = starterDiy()
      let diyWorks = loadDiyWorks()

      const stage = document.getElementById('stage')
      const roomEl = document.getElementById('room')
      const furnitureLayer = document.getElementById('furnitureLayer')
      const dock = document.getElementById('dock')
      const picker = document.getElementById('picker')
      const sheet = document.getElementById('sheet')
      const sheetBody = document.getElementById('sheetBody')
      const sheetTitle = document.getElementById('sheetTitle')
      const sheetKicker = document.getElementById('sheetKicker')
      const toast = document.getElementById('toast')
      const hudCount = document.getElementById('hudCount')
      const hudHint = document.getElementById('hudHint')
      const lobbyMeta = document.getElementById('lobbyMeta')
      const roomTabs = document.getElementById('roomTabs')

      /* ---------- 家具插画 ---------- */
      function swatchColor(pal) {
        const c = pal.c
        return c.color || c.pot || c.frame || c.wood || c.top || c.shade || c.seat || c.fabric || c.rug || c.art1 || c.rim || c.body
      }

      function styleOfItem(item) {
        const styles = CATALOG[item.type].styles
        return styles.some(s => s.id === item.style) ? item.style : styles[0].id
      }

      /* ---------- 渲染 ---------- */
      /* ================= Three.js 3D 房间 ================= */
      const ROOM = { w: 6.4, d: 4.8, h: 2.8 }
      /* 家具由 floorplan-3d 家具库统一生成，新增时按网格自动落位 */

      let glRenderer = null
      let glScene = null
      let glCamera = null
      let glRay = null
      let glPointer = null
      let glReady = false
      let glBoxHelper = null
      let glDrag = null

      /* ---------- 镜头：环绕旋转 + 缩放 + 房间聚焦 ---------- */
      const CAM_HOME = { theta: 0.663, phi: 1.231, radius: 14.7, tx: 0, ty: 1.7, tz: 0 }
      /* maxPhi 允许越过水平线一点：镜头可以降到视平线附近并略微仰视
         minPhi 接近 0：向上拖到底就是正俯视；留 0.02 避免 lookAt 与 up 向量重合 */
      const CAM_LIMIT = { minR: 7.2, maxR: 64, minPhi: 0.02, maxPhi: 1.6 }
      const camState = Object.assign({}, CAM_HOME)
      const camGoal = Object.assign({}, CAM_HOME)
      let camAnim = false
      let camGesture = null
      let camPan = null
      let roomDrag = null
      /* 拖动墙面 / 地板上的铺贴区域 */
      let surfaceDrag = null
      /* 触屏长按待定：按住地板不动才进入房间拖动，直接拖动仍是转视角 */
      let roomHold = null
      const camPointers = new Map()
      let camPinch = null
      const glFurniture = new THREE.Group()
      const glRoom = new THREE.Group()
      const glOpenings = new THREE.Group()

      const mkMat = (color, opts) => {
        const mat = new THREE.MeshStandardMaterial(Object.assign({
          color: color,
          roughness: 0.78,
          metalness: 0.04
        }, opts || {}))
        mat.color.convertSRGBToLinear()
        if (mat.emissive) mat.emissive.convertSRGBToLinear()
        return mat
      }

      function mkBox(w, h, d, material, x, y, z) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
        mesh.position.set(x || 0, y || 0, z || 0)
        mesh.castShadow = true
        mesh.receiveShadow = true
        return mesh
      }

      function mkCyl(rt, rb, h, seg, material, x, y, z) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material)
        mesh.position.set(x || 0, y || 0, z || 0)
        mesh.castShadow = true
        mesh.receiveShadow = true
        return mesh
      }

      function mkSphere(r, material, x, y, z) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), material)
        mesh.position.set(x || 0, y || 0, z || 0)
        mesh.castShadow = true
        mesh.receiveShadow = true
        return mesh
      }

      /* ---------- 铺装纹理：Canvas 程序化生成，不依赖外部图片 ---------- */
      function seededRandom(seed) {
        let s = seed
        return function () {
          s = (s * 1664525 + 1013904223) % 4294967296
          return s / 4294967296
        }
      }

      /* 2×2 瓷砖纹理：主体接近白色，靠材质 color 染成当前配色 */
      function makeTileCanvas() {
        const size = 512
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        const rand = seededRandom(20240517)
        /* 砖缝底色 */
        ctx.fillStyle = '#b6b0a6'
        ctx.fillRect(0, 0, size, size)
        const cell = size / 2
        const grout = 6
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 2; col++) {
            const x = col * cell
            const y = row * cell
            const base = 240 + Math.round(rand() * 10)
            const grad = ctx.createLinearGradient(x, y, x + cell, y + cell)
            grad.addColorStop(0, 'rgb(' + base + ',' + (base - 2) + ',' + (base - 7) + ')')
            grad.addColorStop(1, 'rgb(' + (base - 14) + ',' + (base - 16) + ',' + (base - 21) + ')')
            ctx.fillStyle = grad
            ctx.fillRect(x + grout, y + grout, cell - grout * 2, cell - grout * 2)
            /* 釉面高光 */
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)'
            ctx.lineWidth = 2
            ctx.strokeRect(x + grout + 1, y + grout + 1, cell - grout * 2 - 2, cell - grout * 2 - 2)
            /* 细微斑驳 */
            for (let k = 0; k < 14; k++) {
              ctx.fillStyle = 'rgba(120, 112, 100, ' + (0.015 + rand() * 0.03).toFixed(3) + ')'
              const dot = 2 + rand() * 5
              ctx.fillRect(x + grout + rand() * (cell - grout * 2), y + grout + rand() * (cell - grout * 2), dot, dot)
            }
          }
        }
        return canvas
      }

      /* 4 条并排木纹，端头错缝；整体接近白色，由材质 color 染色 */
      function makeWoodCanvas() {
        const size = 512
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        const rand = seededRandom(770031)
        const ph = size / WOOD_UNIT_ROWS
        for (let i = 0; i < WOOD_UNIT_ROWS; i++) {
          const y = i * ph
          const base = 224 + Math.round(rand() * 18)
          const grad = ctx.createLinearGradient(0, y, size, y)
          grad.addColorStop(0, 'rgb(' + base + ',' + (base - 6) + ',' + (base - 14) + ')')
          grad.addColorStop(0.5, 'rgb(' + (base + 6) + ',' + base + ',' + (base - 10) + ')')
          grad.addColorStop(1, 'rgb(' + (base - 4) + ',' + (base - 10) + ',' + (base - 18) + ')')
          ctx.fillStyle = grad
          ctx.fillRect(0, y, size, ph)
          /* 木纹 */
          for (let k = 0; k < 20; k++) {
            const gy = y + 5 + rand() * (ph - 10)
            const amp = 0.6 + rand() * 1.6
            ctx.beginPath()
            ctx.moveTo(0, gy)
            for (let x = 0; x <= size; x += 12) {
              ctx.lineTo(x, gy + Math.sin(x * 0.021 + k * 1.7) * amp)
            }
            ctx.strokeStyle = 'rgba(116, 84, 48, ' + (0.04 + rand() * 0.07).toFixed(3) + ')'
            ctx.lineWidth = 0.7 + rand() * 1.1
            ctx.stroke()
          }
          /* 板缝 */
          ctx.fillStyle = 'rgba(96, 68, 40, 0.3)'
          ctx.fillRect(0, y, size, 1.4)
          ctx.fillRect(0, y + ph - 1.4, size, 1.4)
          /* 端头拼缝错开 */
          const joint = i % 2 === 0 ? Math.round(size * 0.28) : Math.round(size * 0.66)
          ctx.fillRect(joint, y, 1.4, ph)
        }
        return canvas
      }

      const surfaceTexCache = {}
      function surfaceTexture(kind) {
        if (!surfaceTexCache[kind]) {
          const canvas = kind === 'wood' ? makeWoodCanvas() : makeTileCanvas()
          const tex = new THREE.CanvasTexture(canvas)
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping
          tex.encoding = THREE.sRGBEncoding
          tex.anisotropy = glRenderer ? Math.min(8, glRenderer.capabilities.getMaxAnisotropy()) : 4
          surfaceTexCache[kind] = tex
        }
        return surfaceTexCache[kind]
      }

      /* 铺贴区域：宽高（米）与中心偏移；未设置时默认满铺，墙面默认贴墙脚 */
      function surfaceCover(room, part, wallIndex) {
        const st = room.state[part]
        const fullW = part === 'wall' && wallIndex === 1 ? room.d : room.w
        const fullH = part === 'wall' ? ROOM_H : room.d
        const minW = Math.min(0.2, fullW)
        const minH = Math.min(0.2, fullH)
        const w = clamp(numOr(st.coverW, fullW), minW, fullW)
        const h = clamp(numOr(st.coverH, fullH), minH, fullH)
        const maxU = Math.max(0, (fullW - w) / 2)
        const maxV = Math.max(0, (fullH - h) / 2)
        const defaultV = part === 'wall' ? -maxV : 0
        return {
          w: w,
          h: h,
          fullW: fullW,
          fullH: fullH,
          maxU: maxU,
          maxV: maxV,
          u: clamp(numOr(st.coverU, 0), -maxU, maxU),
          v: clamp(numOr(st.coverV, defaultV), -maxV, maxV)
        }
      }

      /* 铺贴片所在的平面，用于拖动时求交点 */
      function surfacePlane(room, part, wallIndex) {
        if (part === 'floor') return new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.013)
        if (wallIndex === 1) return new THREE.Plane(new THREE.Vector3(1, 0, 0), -(room.cx - room.w / 2 + 0.004))
        return new THREE.Plane(new THREE.Vector3(0, 0, 1), -(roomBackZ(room) + 0.004))
      }

      function surfacePoint(room, part, wallIndex) {
        const point = new THREE.Vector3()
        if (!glRay.ray.intersectPlane(surfacePlane(room, part, wallIndex), point)) return null
        if (part === 'floor') return { u: point.x - room.cx, v: point.z - room.cz }
        if (wallIndex === 1) return { u: point.z - room.cz, v: point.y - ROOM_H / 2 }
        return { u: point.x - room.cx, v: point.y - ROOM_H / 2 }
      }

      /* 铺装贴在独立的铺贴片上，可只覆盖墙面 / 地板的一部分 */
      function applySurface(room, part) {
        if (!glReady) return
        const st = room.state[part]
        const finish = st.finish === 'tile' || st.finish === 'wood' ? st.finish : 'plain'
        const patches = room.surfacePatches ? room.surfacePatches[part] : []
        const sizeDef = SURFACE_SIZE[finish]
        const size = sizeDef ? clamp(numOr(st.finishSize, sizeDef.def), sizeDef.min, sizeDef.max) : 0
        patches.forEach((mesh, wallIndex) => {
          const visible = roomVisible(room.id) && !st.hidden && finish !== 'plain'
          mesh.visible = visible
          if (!visible) return
          const cover = surfaceCover(room, part, wallIndex)
          if (part === 'floor') {
            mesh.rotation.set(-Math.PI / 2, 0, 0)
            mesh.position.set(room.cx + cover.u, 0.013, room.cz + cover.v)
          } else if (wallIndex === 1) {
            mesh.rotation.set(0, Math.PI / 2, 0)
            mesh.position.set(room.cx - room.w / 2 + 0.004, ROOM_H / 2 + cover.v, room.cz + cover.u)
          } else {
            mesh.rotation.set(0, 0, 0)
            mesh.position.set(room.cx + cover.u, ROOM_H / 2 + cover.v, roomBackZ(room) + 0.004)
          }
          mesh.scale.set(cover.w, cover.h, 1)
          const mat = mesh.material
          /* 铺装色独立于墙面 / 地板配色，未设置时跟随 */
          mat.color.set(st.finishTone || roomTone(room, part)).convertSRGBToLinear()
          mat.roughness = finish === 'tile' ? 0.42 : 0.72
          if (!mat.map || mat.userData.surfaceKind !== finish) {
            if (mat.map) mat.map.dispose()
            const tex = surfaceTexture(finish).clone()
            tex.needsUpdate = true
            mat.map = tex
            mat.userData.surfaceKind = finish
            mat.needsUpdate = true
          }
          if (finish === 'tile') {
            const unit = Math.max(0.05, size * 2)
            mat.map.repeat.set(Math.max(0.01, cover.w / unit), Math.max(0.01, cover.h / unit))
          } else {
            const unit = Math.max(0.02, size * WOOD_UNIT_ROWS)
            mat.map.repeat.set(Math.max(0.01, cover.w / WOOD_UNIT_LEN), Math.max(0.01, cover.h / unit))
          }
        })
      }

      /* 接地软阴影，让家具更稳地落在地板上 */
      let glShadowTex = null
      function makeShadowTexture() {
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 128
        const ctx = canvas.getContext('2d')
        const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62)
        grad.addColorStop(0, 'rgba(60, 44, 28, 0.5)')
        grad.addColorStop(0.62, 'rgba(60, 44, 28, 0.18)')
        grad.addColorStop(1, 'rgba(60, 44, 28, 0)')
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 128, 128)
        return new THREE.CanvasTexture(canvas)
      }

      function makeContactShadow(item) {
        const def = CATALOG[item.type]
        if (!def || def.wall || def.model === 'rug' || !glShadowTex) return null
        const dims = itemDims(item)
        const span = [Math.max(0.6, dims.w + 0.2), Math.max(0.5, dims.d + 0.2)]
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(span[0], span[1]),
          new THREE.MeshBasicMaterial({
            map: glShadowTex,
            transparent: true,
            opacity: 0.6,
            depthWrite: false,
            color: 0x7a5c3c
          })
        )
        mesh.rotation.x = -Math.PI / 2
        mesh.position.y = 0.014
        mesh.renderOrder = 2
        return mesh
      }

      /* wx / wz 是房间内坐标，叠加房心得到世界坐标 */
      function itemPos(item, room) {
        const target = room || activeRoom()
        if (item.wx !== undefined) {
          return { x: target.cx + item.wx, y: item.wy || 0, z: target.cz + item.wz }
        }
        if (isWallType(item.type)) return { x: target.cx + (item.wx || 0), y: item.wy || 0, z: roomBackZ(target) + 0.1 }
        return { x: target.cx, y: 0, z: target.cz }
      }

      function spawnPosition(type) {
        const room = activeRoom()
        const def = CATALOG[type]
        const count = placed.filter(p => p.type === type).length
        const limitX = room.w / 2 - roomInset(room.w, 0.6)
        const limitZ = room.d / 2 - roomInset(room.d, 0.6)
        if (def && def.wall) {
          return { x: clamp(((count % 3) - 1) * Math.min(1.7, limitX), -limitX, limitX), y: 0, z: -(room.d / 2) + 0.12 }
        }
        const x = ((count % 3) - 1) * Math.min(1.7, limitX)
        const z = ((Math.floor(count / 3) % 3) - 1) * Math.min(1.5, limitZ)
        return { x: clamp(x, -limitX, limitX), y: 0, z: clamp(z, -limitZ, limitZ) }
      }

      /* ---------- 家具模型 ---------- */
      function buildDiy(g, item) {
        const parts = item.parts || []
        parts.forEach((part, index) => {
          const mat = mkMat(part.c || DIY_DEFAULT_COLOR, { roughness: 0.84 })
          let mesh
          if (part.s === 'cyl') {
            mesh = mkCyl(part.w / 2, part.w / 2, part.h, 20, mat, 0, 0, 0)
            mesh.scale.z = part.d / Math.max(part.w, 0.01)
          } else if (part.s === 'sphere') {
            mesh = mkSphere(part.w / 2, mat, 0, 0, 0)
            mesh.scale.set(1, part.h / Math.max(part.w, 0.01), part.d / Math.max(part.w, 0.01))
          } else if (part.s === 'cone') {
            mesh = mkCyl(0.004, part.w / 2, part.h, 20, mat, 0, 0, 0)
            mesh.scale.z = part.d / Math.max(part.w, 0.01)
          } else {
            mesh = mkBox(part.w, part.h, part.d, mat, 0, 0, 0)
          }
          mesh.position.set(part.x, part.y + part.h / 2, part.z)
          mesh.rotation.y = THREE.MathUtils.degToRad(part.ry || 0)
          /* 记住体块序号，工坊预览里可直接拖拽它 */
          mesh.userData.diyPart = index
          g.add(mesh)
        })
      }

      function buildFurniture(item) {
        if (item.type === 'diy') {
          const g = new THREE.Group()
          buildDiy(g, item)
          return g
        }
        const def = CATALOG[item.type]
        if (!def) return new THREE.Group()
        let seed = 0
        const key = String(item.id || item.type)
        for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0
        const dims = itemDims(item)
        return buildFloorplanFurniture({
          type: def.model,
          w: dims.w,
          d: dims.d,
          color: itemColors(item).color,
          seed: Math.abs(seed) + 1
        })
      }

      /* ---------- 房间结构：每个房间各自的地板与两面墙 ---------- */
      function buildRoom(room) {
        const wallBackTone = mkMat(roomTone(room, 'wall'), { roughness: 0.96 })
        const wallLeftTone = mkMat(roomTone(room, 'wall'), { roughness: 0.96 })
        const floorTone = mkMat(roomTone(room, 'floor'), { roughness: 0.95 })
        room.mats = { wall: [wallBackTone, wallLeftTone], floor: [floorTone], baseboard: [] }
        room.parts = { wall: [], floor: [], baseboard: [] }

        const floor = mkBox(room.w, 0.2, room.d, floorTone, room.cx, -0.1, room.cz)
        floor.userData = { part: 'floor', roomId: room.id }
        glRoom.add(floor)
        room.parts.floor.push(floor)

        const seamCount = Math.max(2, Math.round(room.d / 1.75))
        for (let i = 1; i < seamCount; i++) {
          const z = room.cz - room.d / 2 + (room.d / seamCount) * i
          const seam = mkBox(room.w - 0.1, 0.012, 0.03, mkMat(shade(roomTone(room, 'floor'), -0.5)), room.cx, 0.006, z)
          seam.userData = { part: 'floor', roomId: room.id, seam: true }
          glRoom.add(seam)
          room.parts.floor.push(seam)
        }

        const back = mkBox(room.w, ROOM_H, 0.18, wallBackTone, room.cx, ROOM_H / 2, roomBackZ(room) - 0.09)
        back.userData = { part: 'wall', roomId: room.id }
        glRoom.add(back)

        const left = mkBox(0.18, ROOM_H, room.d, wallLeftTone, room.cx - room.w / 2 - 0.09, ROOM_H / 2, room.cz)
        left.userData = { part: 'wall', roomId: room.id }
        glRoom.add(left)

        const boardMat = mkMat(baseboardTone(room), { roughness: 0.9 })
        room.mats.baseboard.push(boardMat)
        const boardBack = mkBox(room.w, 0.12, 0.06, boardMat, room.cx, 0.06, roomBackZ(room) + 0.005)
        boardBack.userData = { part: 'baseboard', roomId: room.id }
        glRoom.add(boardBack)
        const boardLeft = mkBox(0.06, 0.12, room.d, boardMat, room.cx - room.w / 2 + 0.005, 0.06, room.cz)
        boardLeft.userData = { part: 'baseboard', roomId: room.id }
        glRoom.add(boardLeft)

        room.parts.wall = [back, left]
        room.parts.baseboard = [boardBack, boardLeft]

        /* 墙面 / 地板的铺贴片：独立平面，便于局部铺贴和拖动 */
        const mkPatch = (part, wallIndex) => {
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshStandardMaterial({
              color: 0xffffff,
              roughness: 0.8,
              polygonOffset: true,
              polygonOffsetFactor: -2,
              polygonOffsetUnits: -2
            })
          )
          mesh.visible = false
          mesh.receiveShadow = true
          mesh.userData = { part: part, roomId: room.id, surfacePatch: true, wallIndex: wallIndex }
          glRoom.add(mesh)
          return mesh
        }
        room.surfacePatches = {
          wall: [mkPatch('wall', 0), mkPatch('wall', 1)],
          floor: [mkPatch('floor', 0)]
        }
      }

      /* ---------- 门窗：可多个、可沿墙拖动 ---------- */
      /* 尺寸参照 floorplan-3d：门 0.9×2.1m，窗台 0.9m、窗顶 2.4m */
      const WIN_W = 2.2
      const WIN_H = 1.5
      const WIN_W_MIN = 1.0
      const WIN_H_MIN = 0.9
      const DOOR_W = 0.9
      const DOOR_H = 2.1
      const DOOR_W_MIN = 0.6
      const DOOR_W_MAX = 2.4
      const DOOR_H_MIN = 1.6
      const CURTAIN_TONES = ['#e6dccb', '#cdd8dc', '#b9a78e', '#8fa18c', '#5b5a5f']

      function windowSize(o) {
        return {
          w: o.w || WIN_W,
          h: o.h || WIN_H
        }
      }

      function doorSize(o) {
        return {
          w: o.w || DOOR_W,
          h: o.h || DOOR_H
        }
      }

      /* 当前墙面上这扇门窗允许的宽度/高度范围 */
      function openingLimits(o, room) {
        const r = room || activeRoom()
        const span = o.side === 'left' ? r.d : r.w
        if (o.kind === 'window') {
          return {
            wMin: WIN_W_MIN,
            wMax: Math.max(WIN_W_MIN, span - 0.9),
            hMin: WIN_H_MIN,
            hMax: ROOM_H - 0.4
          }
        }
        return {
          wMin: DOOR_W_MIN,
          wMax: Math.max(DOOR_W_MIN, Math.min(DOOR_W_MAX, span - 0.2)),
          hMin: DOOR_H_MIN,
          hMax: ROOM_H - 0.15
        }
      }

      /* 墙厚与墙外侧面（局部坐标）：门窗要在墙的两面都可见 */
      const WALL_T = 0.18
      const FACE_BACK = -0.2

      /* 窗：窗套 + 贯穿墙体的窗框 + 按 0.9m 分格的竖梃 + 两侧窗台板 */
      function buildWindowMesh(tone, size) {
        const w = size ? size.w : WIN_W
        const h = size ? size.h : WIN_H
        const g = new THREE.Group()
        const frameMat = mkMat(tone, { roughness: 0.6 })
        const trimMat = mkMat(shade(tone, 0.06), { roughness: 0.64 })
        const bar = 0.06
        const casing = z => {
          ;[
            [0, h / 2 + bar / 2, w + bar * 2, bar],
            [0, -h / 2 - bar / 2, w + bar * 2, bar],
            [-(w / 2 + bar / 2), 0, bar, h + bar * 2],
            [w / 2 + bar / 2, 0, bar, h + bar * 2]
          ].forEach(p => g.add(mkBox(p[2], p[3], 0.11, trimMat, p[0], p[1], z)))
        }
        /* 内外两面窗套 */
        casing(0.02)
        casing(FACE_BACK - 0.02)
        /* 窗框贯穿墙体 */
        ;[
          [0, h / 2 - bar / 2, w, bar],
          [0, -h / 2 + bar / 2, w, bar],
          [-w / 2 + bar / 2, 0, bar, h],
          [w / 2 - bar / 2, 0, bar, h]
        ].forEach(p => g.add(mkBox(p[2], p[3], WALL_T + 0.08, frameMat, p[0], p[1], FACE_BACK / 2)))
        /* 玻璃两面各一片，从墙外也能看到窗 */
        const glassGeo = new THREE.PlaneGeometry(w - 0.06, h - 0.06)
        const glassMat = mkMat('#cfe3f0', {
          roughness: 0.16,
          metalness: 0.1,
          emissive: '#9fc4de',
          emissiveIntensity: 0.55
        })
        const innerGlass = new THREE.Mesh(glassGeo, glassMat)
        innerGlass.position.z = 0.035
        g.add(innerGlass)
        const outerGlass = new THREE.Mesh(glassGeo, glassMat)
        outerGlass.position.z = FACE_BACK - 0.035
        outerGlass.rotation.y = Math.PI
        g.add(outerGlass)
        /* 竖梃按 0.9m 一格；较高的窗再加一道横梃 */
        const cols = Math.max(1, Math.round(w / 0.9))
        for (let i = 1; i < cols; i++) {
          g.add(mkBox(0.035, h - bar * 2, WALL_T + 0.04, frameMat, -w / 2 + (w / cols) * i, 0, FACE_BACK / 2))
        }
        if (h > 1.5) g.add(mkBox(w - bar * 2, 0.035, WALL_T + 0.04, frameMat, 0, 0, FACE_BACK / 2))
        return g
      }

      /* 窗簾：窗帘杆 + 左右两片带褶裥的布帘，帘头贴杆、下摆落地 */
      function buildCurtains(o, size) {
        const w = size ? size.w : WIN_W
        const h = size ? size.h : WIN_H
        const g = new THREE.Group()
        const tone = o.curtainTone || CURTAIN_TONES[0]
        const cloth = mkMat(tone, { roughness: 0.98 })
        const clothDark = mkMat(shade(tone, -0.12), { roughness: 0.98 })
        const rodMat = mkMat('#8c7a63', { roughness: 0.45, metalness: 0.55 })
        const baseY = o.y || (WINDOW_HEAD - h / 2)
        /* 窗户被拖高时窗帘杆也跟着压低，避免穿出天花板 */
        const rodY = Math.min(h / 2 + 0.16, ROOM_H - 0.14 - baseY)
        const rod = mkCyl(0.018, 0.018, w + 0.56, 12, rodMat, 0, rodY, 0.17)
        rod.rotation.z = Math.PI / 2
        g.add(rod)
        ;[-(w / 2 + 0.28), w / 2 + 0.28].forEach(x => {
          g.add(mkSphere(0.032, rodMat, x, rodY, 0.17))
        })
        const top = rodY - 0.03
        const bottom = -baseY + 0.02
        const panelH = Math.max(0.4, top - bottom)
        const panelW = clamp(w * 0.26, 0.3, 0.62)
        ;[-1, 1].forEach(side => {
          const outer = w / 2 + panelW * 0.62
          const cx = side * (outer - panelW / 2)
          const pleats = 5
          for (let i = 0; i < pleats; i++) {
            const px = cx - panelW / 2 + (panelW / pleats) * (i + 0.5)
            const fold = i % 2 === 0 ? 0.022 : -0.006
            g.add(mkBox(
              panelW / pleats + 0.012,
              panelH,
              0.05,
              i % 2 === 0 ? cloth : clothDark,
              px,
              top - panelH / 2,
              0.17 + fold
            ))
          }
          g.add(mkBox(panelW + 0.02, 0.05, 0.07, clothDark, cx, top - 0.02, 0.18))
        })
        return g
      }

      /* 门：内外两面门套 + 贯穿墙体的门板 + 两面装饰线与长拉手 */
      function buildDoorMesh(tone, size) {
        const w = size ? size.w : DOOR_W
        const h = size ? size.h : DOOR_H
        const g = new THREE.Group()
        const doorMat = mkMat(tone, { roughness: 0.72 })
        const darkMat = mkMat(shade(tone, -0.18), { roughness: 0.72 })
        const trimMat = mkMat(shade(tone, 0.08), { roughness: 0.7 })
        const metal = mkMat('#c9a24a', { metalness: 0.7, roughness: 0.3 })
        const jamb = 0.07
        const handleX = Math.max(0.08, w / 2 - 0.11)
        /* 内外两面门套 */
        ;[0.02, FACE_BACK - 0.02].forEach(z => {
          ;[-1, 1].forEach(side => {
            g.add(mkBox(jamb, h + jamb, 0.11, trimMat, side * (w / 2 + jamb / 2), (h + jamb) / 2, z))
          })
          g.add(mkBox(w + jamb * 2, jamb, 0.11, trimMat, 0, h + jamb / 2, z))
        })
        /* 门板贯穿墙体 */
        g.add(mkBox(w, h, WALL_T + 0.08, doorMat, 0, h / 2, FACE_BACK / 2))
        /* 两面装饰线：高度按门高比例分布 */
        const upY = h * 0.72
        const upH = h * 0.34
        const lowY = h * 0.3
        const lowH = h * 0.41
        const panelW = Math.max(0.18, w - 0.22)
        const innerW = Math.max(0.14, w - 0.3)
        ;[0.036, FACE_BACK - 0.036].forEach(z => {
          g.add(mkBox(panelW, upH, 0.014, darkMat, 0, upY, z))
          g.add(mkBox(innerW, Math.max(0.1, upH - 0.1), 0.012, doorMat, 0, upY, z + (z > 0 ? 0.008 : -0.008)))
          g.add(mkBox(panelW, lowH, 0.014, darkMat, 0, lowY, z))
          g.add(mkBox(innerW, Math.max(0.1, lowH - 0.1), 0.012, doorMat, 0, lowY, z + (z > 0 ? 0.008 : -0.008)))
        })
        /* 两面长拉手 */
        const handleY = h * 0.49
        const barH = Math.min(0.32, h * 0.16)
        ;[0.075, FACE_BACK - 0.075].forEach(z => {
          g.add(mkCyl(0.014, 0.014, barH, 10, metal, handleX, handleY, z))
          ;[-barH / 2 + 0.06, barH / 2 - 0.06].forEach(offset => {
            g.add(mkBox(0.02, 0.02, 0.05, metal, handleX, handleY + offset, z))
          })
        })
        return g
      }

      /* 沿墙位置约束：门窗（含窗套、窗帘）整体不能转出墙面 */
      function openingBounds(o, room) {
        const r = room || activeRoom()
        /* 窗：两侧留出窗套和窗帘的位置；门：留出门套 */
        const half = o.kind === 'window' ? windowSize(o).w / 2 + 0.45 : doorSize(o).w / 2 + 0.08
        const span = (o.side === 'left' ? r.d : r.w) / 2
        if (span <= half) return { min: 0, max: 0 }
        return { min: -span + half, max: span - half }
      }

      /* 窗户中心高度范围：保证窗框和窗台都留在墙面内 */
      function windowYRange(o) {
        const h = windowSize(o).h
        return { min: h / 2 + 0.3, max: ROOM_H - h / 2 - 0.1 }
      }

      function placeOpeningMesh(group, o, room) {
        if (o.side === 'left') {
          group.position.set(room.cx - room.w / 2 + 0.02, o.y, room.cz + o.u)
          group.rotation.y = Math.PI / 2
        } else {
          group.position.set(room.cx + o.u, o.y, roomBackZ(room) + 0.02)
          group.rotation.y = 0
        }
      }

      function syncOpenings3D() {
        if (!glReady) return
        glOpenings.children.slice().forEach(child => {
          glOpenings.remove(child)
          child.traverse(n => {
            if (n.geometry) n.geometry.dispose()
            if (n.material) {
              if (Array.isArray(n.material)) n.material.forEach(m => m.dispose())
              else n.material.dispose()
            }
          })
        })
        rooms.forEach(room => {
          room.openings.forEach(o => {
            const tone = openingTone(o)
            const size = o.kind === 'window' ? windowSize(o) : doorSize(o)
            const group = o.kind === 'window' ? buildWindowMesh(tone, size) : buildDoorMesh(tone, size)
            if (o.kind === 'window' && o.curtain !== false) {
              group.add(buildCurtains(o, size))
            }
            placeOpeningMesh(group, o, room)
            group.visible = roomVisible(room.id)
            group.userData = { openingId: o.id, roomId: room.id }
            glOpenings.add(group)
          })
        })
      }

      /* ---------- 初始化 ---------- */
      function init3D() {
        if (typeof THREE === 'undefined') {
          document.getElementById('gl').innerHTML =
            '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#8a7a66;font-size:11px">3D 引擎加载失败</div>'
          return
        }
        glRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
        glRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        glRenderer.shadowMap.enabled = true
        glRenderer.shadowMap.type = THREE.PCFSoftShadowMap
        glRenderer.outputEncoding = THREE.sRGBEncoding
        glRenderer.toneMapping = THREE.ACESFilmicToneMapping
        glRenderer.toneMappingExposure = 1.06
        /* Taro 会把 CSS 里的 canvas 标签选择器改成 taro-canvas-core，
           three.js 生成的 canvas 拿不到 100% 尺寸，这里直接写行内样式兜底 */
        const glCanvas = glRenderer.domElement
        glCanvas.className = 'gl-canvas'
        glCanvas.style.display = 'block'
        glCanvas.style.width = '100%'
        glCanvas.style.height = '100%'
        glCanvas.style.touchAction = 'none'
        glCanvas.style.setProperty('-webkit-user-select', 'none')
        glCanvas.style.setProperty('-webkit-touch-callout', 'none')
        document.getElementById('gl').appendChild(glCanvas)

        glScene = new THREE.Scene()
        glCamera = new THREE.PerspectiveCamera(49, 1, 0.1, 200)

        glScene.add(new THREE.HemisphereLight(0xfff6e8, 0x8b7a66, 0.44))
        glScene.add(new THREE.AmbientLight(0xffffff, 0.16))
        const sun = new THREE.DirectionalLight(0xffe6c4, 1.15)
        sun.position.set(-3.5, 14, 8)
        sun.castShadow = true
        sun.shadow.mapSize.width = 2048
        sun.shadow.mapSize.height = 2048
        sun.shadow.camera.left = -26
        sun.shadow.camera.right = 26
        sun.shadow.camera.top = 38
        sun.shadow.camera.bottom = -26
        sun.shadow.camera.near = 1
        sun.shadow.camera.far = 120
        sun.shadow.bias = -0.0006
        sun.shadow.normalBias = 0.02
        glScene.add(sun)
        const winLight = new THREE.PointLight(0xcfe6ff, 0.42, 8)
        winLight.position.set(-2.4, 2.1, -1.0)
        glScene.add(winLight)

        glScene.add(glFurniture)
        glScene.add(glRoom)
        glRoom.add(glOpenings)
        glShadowTex = makeShadowTexture()
        rooms.forEach(buildRoom)

        /* 初始机位：一屏看完整户型 */
        Object.assign(camState, overviewGoal())
        Object.assign(camGoal, camState)
        applyCamera()

        glRay = new THREE.Raycaster()
        glPointer = new THREE.Vector2()
        glReady = true

        syncViewport()
        window.addEventListener('resize', syncViewport)
        window.addEventListener('orientationchange', syncViewport)
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', syncViewport)
          /* 键盘弹出时 iOS 会把整页上推、底部露出白边，这里钉住滚动位置 */
          window.visualViewport.addEventListener('scroll', () => {
            const active = document.activeElement
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) window.scrollTo(0, 0)
          })
        }
        if (typeof ResizeObserver !== 'undefined') {
          const host = document.getElementById('gl')
          if (host) new ResizeObserver(() => glResize()).observe(host)
        }
        bind3D()
        glAnimate()
      }

      /* iOS Safari 的工具栏会遮住 100vh，用 visualViewport 的真实高度兜底 */
      function syncViewport() {
        const active = document.activeElement
        /* 输入中（含分享码文本框）不跟着键盘改高度，避免页面被顶起 */
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        const vv = window.visualViewport
        const h = Math.round(vv ? vv.height : window.innerHeight)
        if (h > 0) document.documentElement.style.setProperty('--app-h', h + 'px')
        glResize()
      }

      /* 满屏自适应：窄高视口按比例拉远镜头，保持接近原 375×600 的取景范围 */
      const BASE_ASPECT = 375 / 600
      let camFit = 1

      function viewFit(w, h) {
        const aspect = w / Math.max(h, 1)
        return aspect >= BASE_ASPECT ? 1 : clamp(BASE_ASPECT / aspect, 1, 1.9)
      }

      function glResize() {
        if (!glRenderer) return
        const host = document.getElementById('gl')
        const w = host.clientWidth || STAGE_W
        const h = host.clientHeight || 600
        glRenderer.setSize(w, h, false)
        glCamera.aspect = w / h
        glCamera.updateProjectionMatrix()

        const fit = viewFit(w, h)
        if (Math.abs(fit - camFit) > 0.001) {
          const ratio = fit / camFit
          camState.radius = clamp(camState.radius * ratio, CAM_LIMIT.minR, CAM_LIMIT.maxR)
          camGoal.radius = clamp(camGoal.radius * ratio, CAM_LIMIT.minR, CAM_LIMIT.maxR)
          camFit = fit
          applyCamera()
        }
      }

      function glAnimate() {
        requestAnimationFrame(glAnimate)
        if (camAnim) {
          const keys = ['theta', 'phi', 'radius', 'tx', 'ty', 'tz']
          let settled = true
          keys.forEach(key => {
            const diff = camGoal[key] - camState[key]
            if (Math.abs(diff) > 0.002) {
              camState[key] += diff * 0.14
              settled = false
            } else {
              camState[key] = camGoal[key]
            }
          })
          applyCamera()
          if (settled) camAnim = false
        }
        if (glRenderer && glScene && glCamera) glRenderer.render(glScene, glCamera)
      }

      /* ---------- 镜头计算 ---------- */
      function applyCamera() {
        if (!glCamera) return
        const sinPhi = Math.sin(camState.phi)
        glCamera.position.set(
          camState.tx + camState.radius * sinPhi * Math.sin(camState.theta),
          camState.ty + camState.radius * Math.cos(camState.phi),
          camState.tz + camState.radius * sinPhi * Math.cos(camState.theta)
        )
        glCamera.lookAt(camState.tx, camState.ty, camState.tz)
      }

      function tweenCamera(goal) {
        Object.assign(camGoal, goal)
        camAnim = true
      }

      /* 用户手动操作时立刻接管镜头，避免和补间打架 */
      function stopCamAnim() {
        camAnim = false
        Object.assign(camGoal, camState)
      }

      /* 机位距离同时受视口宽高比影响，窄屏时自动退远 */
      function fitRadius(radius) {
        return clamp(radius * camFit, CAM_LIMIT.minR, CAM_LIMIT.maxR)
      }

      function roomFocusGoal(room) {
        return {
          theta: 0.52,
          phi: 1.16,
          radius: fitRadius(clamp(6.6 + Math.max(room.w, room.d) * 0.8, 7, 30)),
          tx: room.cx,
          ty: 1.5,
          tz: room.cz
        }
      }

      function overviewGoal() {
        const box = houseBounds()
        return {
          theta: 0.16,
          /* 总览用更接近户型图的俯视角，剩余倾斜感由墙面厚度给出 */
          phi: 0.38,
          radius: fitRadius(clamp(Math.max(box.w * 1.58, box.d * 1.4) + 4, 16, 64)),
          tx: box.cx,
          ty: 1.0,
          tz: box.cz
        }
      }

      function zoomBy(delta) {
        stopCamAnim()
        camState.radius = clamp(camState.radius * Math.exp(delta), CAM_LIMIT.minR, CAM_LIMIT.maxR)
        applyCamera()
      }

      function resetCamera() {
        tweenCamera(overviewMode ? overviewGoal() : roomFocusGoal(activeRoom()))
      }

      function pointerSpread() {
        const pts = Array.from(camPointers.values())
        if (pts.length < 2) return 0
        return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      }

      /* 画面平移：房屋跟着手指走 */
      function panBy(dx, dy) {
        if (!glCamera || !glRenderer) return
        const height = glRenderer.domElement.clientHeight || 1
        const scale = (2 * camState.radius * Math.tan(THREE.MathUtils.degToRad(glCamera.fov / 2))) / height
        const right = new THREE.Vector3().setFromMatrixColumn(glCamera.matrix, 0)
        right.y = 0
        right.normalize()
        const forward = new THREE.Vector3(camState.tx - glCamera.position.x, 0, camState.tz - glCamera.position.z)
        forward.normalize()
        const box = houseBounds()
        const padX = Math.max(10, box.w * 0.35)
        const padZ = Math.max(10, box.d * 0.35)
        camState.tx = clamp(camState.tx + (-dx * right.x + dy * forward.x) * scale,
          box.minX - padX, box.maxX + padX)
        camState.tz = clamp(camState.tz + (-dx * right.z + dy * forward.z) * scale,
          box.minZ - padZ, box.maxZ + padZ)
        applyCamera()
      }

      /* ---------- 房间自由摆放：吸附 + 贴边校验 ---------- */
      const SNAP_GRID = 0.25
      const ROOM_SHARE_MIN = 1.2
      /* 小房间贴边时要求的重叠长度按自身尺寸收缩 */
      function shareMin(a, b) { return Math.min(ROOM_SHARE_MIN, Math.min(a.w, b.w) - 0.02) }
      /* 小房间内家具的收纳边距，尺寸不足时自动收紧 */
      function roomInset(dim, want) { return Math.max(0.05, Math.min(want, dim / 2 - 0.05)) }
      /* 落地家具的贴墙半径：按旋转后的实际半宽计算，可直接贴着墙面摆放 */
      function floorInset(item, axis) {
        const def = CATALOG[item && item.type]
        if (!def || def.wall) return 0.55
        const dims = itemDims(item)
        const rot = ((Number(item.rotY) || 0) % 180 + 180) % 180
        const rad = rot * Math.PI / 180
        const cos = Math.abs(Math.cos(rad))
        const sin = Math.abs(Math.sin(rad))
        const half = (axis === 'z'
          ? dims.w * sin + dims.d * cos
          : dims.w * cos + dims.d * sin) / 2
        return Math.max(0.05, half + 0.02)
      }

      function roomPlacementValid(room, cx, cz) {
        const self = roomRect(room, cx, cz)
        let attached = false
        for (let i = 0; i < rooms.length; i++) {
          const other = rooms[i]
          if (other.id === room.id) continue
          const r = roomRect(other)
          const share = shareMin(room, other)
          const ox = Math.min(self.maxX, r.maxX) - Math.max(self.minX, r.minX)
          const oz = Math.min(self.maxZ, r.maxZ) - Math.max(self.minZ, r.minZ)
          if (ox > 0.08 && oz > 0.08) return false
          const eps = 0.08
          if ((Math.abs(self.maxZ - r.minZ) < eps || Math.abs(r.maxZ - self.minZ) < eps) && ox >= share) attached = true
          if ((Math.abs(self.maxX - r.minX) < eps || Math.abs(r.maxX - self.minX) < eps) && oz >= share) attached = true
        }
        return attached
      }

      /* 网格吸附 + 靠近邻房时自动贴边 */
      function snapRoomPosition(room, cx, cz) {
        const others = rooms.filter(r => r.id !== room.id)
        let sx = Math.round(cx / SNAP_GRID) * SNAP_GRID
        let sz = Math.round(cz / SNAP_GRID) * SNAP_GRID
        const magnet = 0.85
        const overlapsZ = (o, x) => {
          const self = roomRect(room, x, sz)
          const r = roomRect(o)
          return Math.min(self.maxZ, r.maxZ) - Math.max(self.minZ, r.minZ) >= shareMin(room, o)
        }
        const overlapsX = (o, z) => {
          const self = roomRect(room, sx, z)
          const r = roomRect(o)
          return Math.min(self.maxX, r.maxX) - Math.max(self.minX, r.minX) >= shareMin(room, o)
        }
        others.forEach(o => {
          const r = roomRect(o)
          ;[r.minX - room.w / 2, r.maxX + room.w / 2].forEach(cand => {
            if (Math.abs(cand - sx) < magnet && overlapsZ(o, sx)) sx = cand
          })
        })
        others.forEach(o => {
          const r = roomRect(o)
          ;[r.minZ - room.d / 2, r.maxZ + room.d / 2].forEach(cand => {
            if (Math.abs(cand - sz) < magnet && overlapsX(o, sz)) sz = cand
          })
        })
        return { cx: sx, cz: sz }
      }

      function translateRoom3D(room, dx, dz) {
        const parts = room.parts ? room.parts.wall.concat(room.parts.floor, room.parts.baseboard) : []
        parts.forEach(mesh => {
          mesh.position.x += dx
          mesh.position.z += dz
        })
        /* 铺贴片（瓷砖/木板）也要跟着房间一起移动，否则会留在原地 */
        const patches = room.surfacePatches ? room.surfacePatches.wall.concat(room.surfacePatches.floor) : []
        patches.forEach(mesh => {
          mesh.position.x += dx
          mesh.position.z += dz
        })
        room.openings.forEach(o => {
          const group = glOpenings.children.find(g => g.userData.openingId === o.id)
          if (group) {
            group.position.x += dx
            group.position.z += dz
          }
        })
        room.placed.forEach(item => {
          const holder = glFurniture.children.find(g => g.userData.itemId === item.id)
          if (holder) {
            holder.position.x += dx
            holder.position.z += dz
          }
        })
      }

      function moveRoomTo(room, cx, cz) {
        const dx = cx - room.cx
        const dz = cz - room.cz
        if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return
        room.cx = cx
        room.cz = cz
        translateRoom3D(room, dx, dz)
        if (glBoxHelper) glBoxHelper.update()
      }

      /* 中断房间拖动：恢复原色并退回原位 */
      function cancelRoomDrag() {
        if (roomHold) {
          clearTimeout(roomHold.timer)
          roomHold = null
        }
        if (!roomDrag) return
        const drag = roomDrag
        roomDrag = null
        const room = roomById(drag.id)
        if (!room) return
        if (drag.tone !== null && room.mats && room.mats.floor[0]) {
          room.mats.floor[0].color.setHex(drag.tone)
        }
        if (drag.moved) moveRoomTo(room, drag.cx, drag.cz)
      }

      /* ---------- 房间尺寸：常用布局预设 + 自动避让 ---------- */
      const ROOM_SIZES = [[3, 2],[5, 4], [6, 5], [7, 5]]
      const ROOM_DIM = { min: 1, max: 20, step: 0.5 }

      function disposeRoomParts(room) {
        const patches = room.surfacePatches
          ? room.surfacePatches.wall.concat(room.surfacePatches.floor)
          : []
        room.parts.wall.concat(room.parts.floor, room.parts.baseboard, patches).forEach(mesh => {
          glRoom.remove(mesh)
          if (mesh.geometry) mesh.geometry.dispose()
          if (mesh.material) {
            if (mesh.material.map) mesh.material.map.dispose()
            mesh.material.dispose()
          }
        })
        room.surfacePatches = null
      }

      /* 尺寸变化后把重叠的邻居沿最小方向推开，保持贴边 */
      function resolveRoomOverlaps(anchor) {
        const order = [anchor].concat(rooms.filter(r => r.id !== anchor.id))
        for (let pass = 0; pass < 4; pass++) {
          let moved = false
          for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
              const a = order[i]
              const b = order[j]
              const ra = roomRect(a)
              const rb = roomRect(b)
              const ox = Math.min(ra.maxX, rb.maxX) - Math.max(ra.minX, rb.minX)
              const oz = Math.min(ra.maxZ, rb.maxZ) - Math.max(ra.minZ, rb.minZ)
              if (ox <= 0.02 || oz <= 0.02) continue
              if (ox < oz) {
                moveRoomTo(b, b.cx + (rb.cx >= ra.cx ? 1 : -1) * ox, b.cz)
              } else {
                moveRoomTo(b, b.cx, b.cz + (rb.cz >= ra.cz ? 1 : -1) * oz)
              }
              moved = true
            }
          }
          if (!moved) break
        }
      }

      /* 门窗与家具收回新尺寸范围内；放不下的门窗直接移除，返回移除数量 */
      function clampRoomContents(room) {
        const before = room.openings.length
        for (let i = room.openings.length - 1; i >= 0; i--) {
          const o = room.openings[i]
          const half = (o.kind === 'window' ? windowSize(o).w + 0.2 : doorSize(o).w + 0.16) / 2
          const span = o.side === 'left' ? room.d : room.w
          if (span < half * 2 + 0.1) room.openings.splice(i, 1)
        }
        room.openings.forEach(o => {
          const bounds = openingBounds(o, room)
          o.u = clamp(o.u, bounds.min, bounds.max)
          if (o.kind === 'window') {
            const yr = windowYRange(o)
            o.y = clamp(o.y, yr.min, yr.max)
          }
        })
        const inset = roomInset
        room.placed.forEach(item => {
          const pos = itemPos(item, room)
          const wall = isWallType(item.type)
          if (wall) {
            const mx = inset(room.w, 0.8)
            item.wx = clamp(pos.x - room.cx, -room.w / 2 + mx, room.w / 2 - mx)
            item.wz = -room.d / 2 + 0.1
          } else {
            const mx = inset(room.w, floorInset(item, 'x'))
            const mz = inset(room.d, floorInset(item, 'z'))
            item.wx = clamp(pos.x - room.cx, -room.w / 2 + mx, room.w / 2 - mx)
            item.wz = clamp(pos.z - room.cz, -room.d / 2 + mz, room.d / 2 - mz)
          }
        })
        return before - room.openings.length
      }

      /* 两间房是否贴边，返回贴边所在的轴 */
      function contactAxis(a, b) {
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
        const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
        const eps = 0.08
        if (ox >= shareMin(a, b) && (Math.abs(a.maxZ - b.minZ) < eps || Math.abs(b.maxZ - a.minZ) < eps)) return 'z'
        if (oz >= shareMin(a, b) && (Math.abs(a.maxX - b.minX) < eps || Math.abs(b.maxX - a.minX) < eps)) return 'x'
        return null
      }

      /* 尺寸改变后按原有贴边关系把整条户型重新拼紧 */
      function restoreContacts(pairs) {
        for (let pass = 0; pass < 5; pass++) {
          let moved = false
          pairs.forEach(pair => {
            const a = roomById(pair.a)
            const b = roomById(pair.b)
            if (!a || !b) return
            const ra = roomRect(a)
            if (pair.axis === 'z') {
              const target = pair.aBeforeB ? ra.minZ - b.d / 2 : ra.maxZ + b.d / 2
              if (Math.abs(b.cz - target) > 0.02) {
                moveRoomTo(b, b.cx, target)
                moved = true
              }
            } else {
              const target = pair.aBeforeB ? ra.minX - b.w / 2 : ra.maxX + b.w / 2
              if (Math.abs(b.cx - target) > 0.02) {
                moveRoomTo(b, target, b.cz)
                moved = true
              }
            }
          })
          if (!moved) break
        }
      }

      function applyRoomSize(w, d) {
        const room = activeRoom()
        if (!room) return
        sizeCustomOpen = false
        if (room.w === w && room.d === d) {
          renderDock()
          return
        }
        const contacts = []
        rooms.forEach((a, i) => {
          rooms.forEach((b, j) => {
            if (j <= i) return
            const axis = contactAxis(roomRect(a), roomRect(b))
            if (!axis) return
            contacts.push({
              a: a.id,
              b: b.id,
              axis: axis,
              aBeforeB: axis === 'z' ? b.cz < a.cz : b.cx < a.cx
            })
          })
        })
        disposeRoomParts(room)
        room.w = w
        room.d = d
        buildRoom(room)
        restoreContacts(contacts)
        resolveRoomOverlaps(room)
        const removed = clampRoomContents(room)
        syncOpenings3D()
        syncFurniture3D()
        updateSelectionVisuals()
        renderDock()
        renderHUD()
        tweenCamera(roomFocusGoal(room))
        showToast('「' + room.name + '」改为 ' + w + '×' + d + ' m' + (removed ? '，' + removed + ' 个门窗已移除' : ''))
      }

      /* 读取自定义输入并按 0.5m 取整、限制在 1–20m */
      function applyCustomRoomSize() {
        const room = activeRoom()
        const wi = dock.querySelector('[data-dim="w"]')
        const di = dock.querySelector('[data-dim="d"]')
        if (!room || !wi || !di) return
        const norm = (raw, fallback) => {
          const n = Number(raw)
          const base = isFinite(n) && n > 0 ? n : fallback
          return Math.round(clamp(base, ROOM_DIM.min, ROOM_DIM.max) / ROOM_DIM.step) * ROOM_DIM.step
        }
        applyRoomSize(norm(wi.value, room.w), norm(di.value, room.d))
      }

      /* ---------- 房间管理：改名 / 删除 ---------- */
      function applyRoomRename() {
        const room = activeRoom()
        const input = dock.querySelector('[data-room-name]')
        if (!room || !input) return
        const name = input.value.trim().slice(0, 8)
        roomRenameOpen = false
        if (!name) {
          renderAll()
          showToast('房间名不能为空')
          return
        }
        room.name = name
        renderAll()
        showToast('已改名为「' + name + '」')
      }

      function deleteRoom(id) {
        if (rooms.length <= 1) {
          showToast('至少保留一个房间')
          return
        }
        const index = rooms.findIndex(r => r.id === id)
        if (index < 0) return
        const room = rooms[index]
        disposeRoomParts(room)
        rooms.splice(index, 1)
        pendingDeleteId = null
        if (deleteTimer) { clearTimeout(deleteTimer); deleteTimer = null }
        roomRenameOpen = false
        sizeCustomOpen = false
        selection = null
        if (activeRoomId === id) bindRoom(rooms[Math.min(index, rooms.length - 1)].id)
        renderAll()
        tweenCamera(overviewMode ? overviewGoal() : roomFocusGoal(activeRoom()))
        showToast('已删除「' + room.name + '」')
      }

      /* 首次点击进入确认态，3 秒内再点一次才真正删除 */
      function requestDeleteRoom(id) {
        if (rooms.length <= 1) {
          showToast('至少保留一个房间')
          return
        }
        if (pendingDeleteId !== id) {
          pendingDeleteId = id
          renderRoomTabs()
          if (deleteTimer) clearTimeout(deleteTimer)
          deleteTimer = setTimeout(() => {
            pendingDeleteId = null
            deleteTimer = null
            renderRoomTabs()
          }, 3000)
          const room = roomById(id)
          showToast('再点一次删除「' + (room ? room.name : '房间') + '」')
          return
        }
        deleteRoom(id)
      }

      /* ---------- 3D 交互 ---------- */
      function findItemGroup(object) {
        let node = object
        while (node) {
          if (node.userData && node.userData.itemId) return node
          node = node.parent
        }
        return null
      }

      function findRoomPart(object) {
        let node = object
        while (node) {
          if (node.userData && node.userData.part) return node.userData
          node = node.parent
        }
        return null
      }

      /* 全屋视角显示所有房间；进入某间房布置时只显示这间 */
      function roomVisible(id) {
        return overviewMode || !id || id === activeRoomId
      }

      function pickVisible(hits) {
        for (let i = 0; i < hits.length; i++) {
          const hit = hits[i]
          let node = hit.object
          let roomId = null
          while (node) {
            if (node.userData && node.userData.roomId) { roomId = node.userData.roomId; break }
            node = node.parent
          }
          if (roomVisible(roomId)) return hit
        }
        return null
      }

      function findOpeningGroup(object) {
        let node = object
        while (node) {
          if (node.userData && node.userData.openingId) return node
          node = node.parent
        }
        return null
      }

      /* 门窗拖动用的墙面交点（当前房间） */
      function wallPoint(side) {
        const room = activeRoom()
        const plane = side === 'left'
          ? new THREE.Plane(new THREE.Vector3(1, 0, 0), -(room.cx - room.w / 2 + 0.02))
          : new THREE.Plane(new THREE.Vector3(0, 0, 1), -(roomBackZ(room) + 0.02))
        const point = new THREE.Vector3()
        return glRay.ray.intersectPlane(plane, point) ? point : null
      }

      /* 地面（y=0）与射线的交点，房间拖动用 */
      function floorPoint() {
        const point = new THREE.Vector3()
        return glRay.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point) ? point : null
      }

      function setRayFromEvent(e) {
        const rect = glRenderer.domElement.getBoundingClientRect()
        glPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        glPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        glRay.setFromCamera(glPointer, glCamera)
      }

      function planePoint(type) {
        const room = activeRoom()
        const wall = isWallType(type)
        const plane = wall
          ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -(roomBackZ(room) + 0.1))
          : new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const point = new THREE.Vector3()
        return glRay.ray.intersectPlane(plane, point) ? point : null
      }

      function bind3D() {
        const canvas = glRenderer.domElement

        canvas.addEventListener('wheel', e => {
          e.preventDefault()
          zoomBy(e.deltaY * 0.0016)
        }, { passive: false })

        canvas.addEventListener('contextmenu', e => e.preventDefault())

        /* iOS Safari：拦掉双指页面缩放，交给场景自己的捏合手势 */
        canvas.addEventListener('touchstart', e => {
          if (e.touches.length > 1) e.preventDefault()
        }, { passive: false })
        canvas.addEventListener('touchmove', e => {
          if (e.touches.length > 1) e.preventDefault()
        }, { passive: false })

        canvas.addEventListener('pointerdown', e => {
          camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

          /* 双指：缩放 + 平移 */
          if (camPointers.size === 2) {
            glDrag = null
            camGesture = null
            cancelRoomDrag()
            const pts = Array.from(camPointers.values())
            camPinch = {
              dist: pointerSpread(),
              radius: camState.radius,
              mx: (pts[0].x + pts[1].x) / 2,
              my: (pts[0].y + pts[1].y) / 2
            }
            stopCamAnim()
            e.preventDefault()
            return
          }
          if (camPointers.size > 2) return

          /* 右键 / Shift + 拖动：平移画面 */
          if (e.button === 2 || e.shiftKey) {
            glDrag = null
            camGesture = null
            cancelRoomDrag()
            camPan = { x: e.clientX, y: e.clientY }
            stopCamAnim()
            e.preventDefault()
            return
          }

          setRayFromEvent(e)
          const hits = glRay.intersectObjects(glFurniture.children, true)
          const furnitureHit = pickVisible(hits)
          if (furnitureHit) {
            const group = findItemGroup(furnitureHit.object)
            if (group) {
              const id = group.userData.itemId
              if (group.userData.roomId && group.userData.roomId !== activeRoomId) {
                bindRoom(group.userData.roomId)
                overviewMode = false
                tweenCamera(roomFocusGoal(activeRoom()))
                renderAll()
              }
              const item = placed.find(p => p.id === id)
              if (!item) return
              camGesture = null
              selectFurniture(id)
              const pos = itemPos(item)
              const point = planePoint(item.type)
              glDrag = {
                id: id,
                wall: isWallType(item.type),
                offsetX: point ? pos.x - point.x : 0,
                offsetY: point ? pos.y - point.y : 0,
                offsetZ: point ? pos.z - point.z : 0
              }
              e.preventDefault()
              return
            }
            /* 工坊预览：按住某个体块直接拖，位置随手改 */
            const previewPart = findDiyPreviewPart(furnitureHit.object)
            if (previewPart !== null && makerPreviewVisible()) {
              const part = diy.parts[previewPart]
              if (part) {
                camGesture = null
                diy.selected = previewPart
                renderSheet()
                renderHUD()
                const point = diyPlanePoint(part)
                /* 用按下瞬间的世界坐标与体块原位置做增量，避免模型居中带来的跳变 */
                glDrag = {
                  kind: 'diyPart',
                  index: previewPart,
                  startX: part.x,
                  startZ: part.z,
                  anchorX: point ? point.x : 0,
                  anchorZ: point ? point.z : 0,
                  hasPoint: !!point
                }
                e.preventDefault()
                return
              }
            }
          }
          const openingHits = glRay.intersectObjects(glOpenings.children, true)
          const openingHit = pickVisible(openingHits)
          if (openingHit) {
            const group = findOpeningGroup(openingHit.object)
            if (group && group.userData.roomId && group.userData.roomId !== activeRoomId) {
              bindRoom(group.userData.roomId)
              overviewMode = false
              tweenCamera(roomFocusGoal(activeRoom()))
              renderAll()
            }
            const opening = group && openings.find(o => o.id === group.userData.openingId)
            if (opening) {
              camGesture = null
              selectOpening(opening.id)
              const point = wallPoint(opening.side)
              glDrag = {
                kind: 'opening',
                id: opening.id,
                offsetU: point
                  ? opening.u - (opening.side === 'left' ? point.z - activeRoom().cz : point.x - activeRoom().cx)
                  : 0,
                offsetY: point ? opening.y - point.y : 0
              }
              e.preventDefault()
              return
            }
          }

          /* 全屋视角里拖动房间地板：自由摆放（吸附网格、不能脱离主体） */
          const roomHits = glRay.intersectObjects(glRoom.children, true)
          const roomHit = pickVisible(roomHits)
          const hit = roomHit ? findRoomPart(roomHit.object) : null
          const patchData = roomHit && roomHit.object ? roomHit.object.userData : null
          if (!overviewMode && patchData && patchData.surfacePatch && roomHit.object.visible) {
            const room = roomById(patchData.roomId)
            if (room) {
              if (room.id !== activeRoomId) {
                bindRoom(room.id)
                tweenCamera(roomFocusGoal(activeRoom()))
                renderAll()
              }
              const part = patchData.part
              const wallIndex = patchData.wallIndex || 0
              const cover = surfaceCover(room, part, wallIndex)
              const point = surfacePoint(room, part, wallIndex)
              const st = room.state[part]
              st.coverU = cover.u
              st.coverV = cover.v
              camGesture = null
              surfaceDrag = {
                roomId: room.id,
                part: part,
                wallIndex: wallIndex,
                sx: e.clientX,
                sy: e.clientY,
                moved: false,
                offsetU: point ? cover.u - point.u : 0,
                offsetV: point ? cover.v - point.v : 0
              }
              e.preventDefault()
              return
            }
          }
          if (overviewMode && hit && hit.roomId && hit.part === 'floor') {
            const room = roomById(hit.roomId)
            const makeRoomDrag = () => ({
              id: hit.roomId,
              sx: e.clientX,
              sy: e.clientY,
              cx: room.cx,
              cz: room.cz,
              point: floorPoint(),
              moved: false,
              tone: room.mats && room.mats.floor[0] ? room.mats.floor[0].color.getHex() : null
            })
            /* 鼠标保持原逻辑：按住地板直接拖动房间 */
            if (e.pointerType === 'mouse') {
              camGesture = null
              roomDrag = makeRoomDrag()
              return
            }
            /* 触屏：原地按住 240ms 才进入拖房间，直接滑动仍是转视角 */
            roomHold = Object.assign(makeRoomDrag(), {
              timer: window.setTimeout(() => {
                if (!roomHold) return
                const hold = roomHold
                roomHold = null
                camGesture = null
                roomDrag = hold
              }, 240)
            })
            camGesture = { x: e.clientX, y: e.clientY, moved: false, part: null, roomId: null }
            return
          }
          camGesture = {
            x: e.clientX,
            y: e.clientY,
            moved: false,
            part: hit ? hit.part : null,
            roomId: hit ? hit.roomId : null
          }
        })

        window.addEventListener('pointermove', e => {
          if (camPointers.has(e.pointerId)) {
            camPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
          }

          /* 长按期间一移动就取消，交还给视角旋转 */
          if (roomHold) {
            if (Math.hypot(e.clientX - roomHold.sx, e.clientY - roomHold.sy) > 6) {
              clearTimeout(roomHold.timer)
              roomHold = null
            } else {
              return
            }
          }

          /* 右键 / Shift 拖动：平移画面 */
          if (camPan) {
            panBy(e.clientX - camPan.x, e.clientY - camPan.y)
            camPan.x = e.clientX
            camPan.y = e.clientY
            return
          }

          /* 双指：缩放 + 平移 */
          if (camPinch) {
            const spread = pointerSpread()
            const pts = Array.from(camPointers.values())
            if (spread > 0 && camPinch.dist > 0) {
              stopCamAnim()
              camState.radius = clamp(camPinch.radius * (camPinch.dist / spread), CAM_LIMIT.minR, CAM_LIMIT.maxR)
            }
            if (pts.length >= 2) {
              const mx = (pts[0].x + pts[1].x) / 2
              const my = (pts[0].y + pts[1].y) / 2
              panBy(mx - camPinch.mx, my - camPinch.my)
              camPinch.mx = mx
              camPinch.my = my
            }
            applyCamera()
            return
          }

          /* 拖动房间：在地面上自由移动，松手时校验是否贴住主体 */
          if (roomDrag) {
            if (!roomDrag.moved && Math.hypot(e.clientX - roomDrag.sx, e.clientY - roomDrag.sy) < 4) return
            roomDrag.moved = true
            const room = roomById(roomDrag.id)
            if (!room || !roomDrag.point) return
            setRayFromEvent(e)
            const point = floorPoint()
            if (!point) return
            const target = snapRoomPosition(
              room,
              roomDrag.cx + point.x - roomDrag.point.x,
              roomDrag.cz + point.z - roomDrag.point.z
            )
            moveRoomTo(room, target.cx, target.cz)
            const ok = roomPlacementValid(room, target.cx, target.cz)
            if (room.mats && room.mats.floor[0]) {
              const mat = room.mats.floor[0]
              if (ok) {
                if (roomDrag.tone !== null) mat.color.setHex(roomDrag.tone)
              } else {
                mat.color.setStyle('#c25a45').convertSRGBToLinear()
              }
            }
            return
          }

          /* 拖动铺贴区域：沿墙面 / 地板平面移动 */
          if (surfaceDrag) {
            if (!surfaceDrag.moved && Math.hypot(e.clientX - surfaceDrag.sx, e.clientY - surfaceDrag.sy) < 4) return
            surfaceDrag.moved = true
            const room = roomById(surfaceDrag.roomId)
            if (!room || !room.state[surfaceDrag.part]) return
            setRayFromEvent(e)
            const point = surfacePoint(room, surfaceDrag.part, surfaceDrag.wallIndex)
            if (!point) return
            const cover = surfaceCover(room, surfaceDrag.part, surfaceDrag.wallIndex)
            const st = room.state[surfaceDrag.part]
            st.coverU = Math.round(clamp(point.u + surfaceDrag.offsetU, -cover.maxU, cover.maxU) * 1000) / 1000
            st.coverV = Math.round(clamp(point.v + surfaceDrag.offsetV, -cover.maxV, cover.maxV) * 1000) / 1000
            applySurface(room, surfaceDrag.part)
            return
          }

          /* 单指 / 鼠标拖动空白：环绕转视角 */
          if (camGesture) {
            const dx = e.clientX - camGesture.x
            const dy = e.clientY - camGesture.y
            if (!camGesture.moved && Math.hypot(dx, dy) < 5) return
            camGesture.moved = true
            camGesture.x = e.clientX
            camGesture.y = e.clientY
            stopCamAnim()
            camState.theta -= dx * 0.0075
            camState.phi = clamp(camState.phi + dy * 0.006, CAM_LIMIT.minPhi, CAM_LIMIT.maxPhi)
            applyCamera()
            return
          }

          if (!glDrag) return
          if (e.buttons !== undefined && e.buttons === 0) return
          setRayFromEvent(e)
          if (glDrag.kind === 'diyPart') {
            const part = diy.parts[glDrag.index]
            const point = part ? diyPlanePoint(part) : null
            if (!part || !point) return
            if (!glDrag.hasPoint) {
              /* 按下时没取到平面点（比如点了天空），用第一次移动的点当起点 */
              glDrag.hasPoint = true
              glDrag.anchorX = point.x
              glDrag.anchorZ = point.z
            }
            const scale = diyPreviewSpot().scale
            const dx = (point.x - glDrag.anchorX) / scale
            const dz = (point.z - glDrag.anchorZ) / scale
            part.x = Math.round(clamp(glDrag.startX + dx, -1.6, 1.6) * 100) / 100
            part.z = Math.round(clamp(glDrag.startZ + dz, -1.6, 1.6) * 100) / 100
            moveDiyPreviewPart(glDrag.index, part)
            syncDiySliders(part)
            return
          }
          if (glDrag.kind === 'opening') {
            const opening = openings.find(o => o.id === glDrag.id)
            if (!opening) return
            const room = activeRoom()
            const point = wallPoint(opening.side)
            if (!point) return
            const bounds = openingBounds(opening, room)
            const along = (opening.side === 'left' ? point.z - room.cz : point.x - room.cx) + glDrag.offsetU
            opening.u = clamp(along, bounds.min, bounds.max)
            if (opening.kind === 'window') {
              const yr = windowYRange(opening)
              opening.y = clamp(point.y + glDrag.offsetY, yr.min, yr.max)
            }
            const group = glOpenings.children.find(g => g.userData.openingId === opening.id)
            if (group) {
              placeOpeningMesh(group, opening, room)
              if (glBoxHelper) glBoxHelper.update()
            }
            return
          }
          const item = placed.find(p => p.id === glDrag.id)
          if (!item) return
          const room = activeRoom()
          const point = planePoint(item.type)
          if (!point) return
          if (glDrag.wall) {
            /* 壁挂家具只沿墙水平移动，高度由「高度」滑杆单独调整，拖动时保留 */
            item.wx = clamp(point.x + glDrag.offsetX - room.cx, -room.w / 2 + roomInset(room.w, 0.6), room.w / 2 - roomInset(room.w, 0.6))
            item.wz = -(room.d / 2) + 0.1
          } else {
            const insetX = floorInset(item, 'x')
            const insetZ = floorInset(item, 'z')
            item.wx = clamp(point.x + glDrag.offsetX - room.cx, -room.w / 2 + roomInset(room.w, insetX), room.w / 2 - roomInset(room.w, insetX))
            item.wz = clamp(point.z + glDrag.offsetZ - room.cz, -room.d / 2 + roomInset(room.d, insetZ), room.d / 2 - roomInset(room.d, insetZ))
          }
          const group = glFurniture.children.find(g => g.userData.itemId === item.id)
          if (group) {
            group.position.set(room.cx + item.wx, item.wy, room.cz + item.wz)
            if (glBoxHelper && selection && selection.id === item.id) glBoxHelper.update()
          }
        })

        window.addEventListener('pointerup', e => {
          if (camPointers.has(e.pointerId)) camPointers.delete(e.pointerId)
          if (camPointers.size < 2) camPinch = null
          camPan = null
          /* 触屏点按地板：进入该房间（长按未成立时） */
          if (roomHold) {
            clearTimeout(roomHold.timer)
            const hold = roomHold
            roomHold = null
            if (!hold.moved) focusRoom(hold.id)
          }
          if (roomDrag) {
            const drag = roomDrag
            roomDrag = null
            const room = roomById(drag.id)
            if (room) {
              if (drag.tone !== null && room.mats && room.mats.floor[0]) {
                room.mats.floor[0].color.setHex(drag.tone)
              }
              if (!drag.moved) {
                focusRoom(drag.id)
              } else if (!roomPlacementValid(room, room.cx, room.cz)) {
                moveRoomTo(room, drag.cx, drag.cz)
                showToast('房间要贴着其他房间，不能悬空')
              } else {
                showToast('已移动「' + room.name + '」')
              }
            }
          }
          if (surfaceDrag) {
            const drag = surfaceDrag
            surfaceDrag = null
            if (!drag.moved) {
              if (drag.roomId !== activeRoomId) focusRoom(drag.roomId)
              else togglePart(drag.part)
            } else {
              scheduleHistory()
            }
          }
          if (camGesture) {
            const gesture = camGesture
            camGesture = null
            if (!gesture.moved) {
              if (gesture.roomId && gesture.roomId !== activeRoomId) {
                focusRoom(gesture.roomId)
              } else if (gesture.part && SCENE_PARTS[gesture.part]) {
                togglePart(gesture.part)
              } else if (selection) {
                selection = null
                applySelection()
                renderDock()
                renderPicker()
                renderHUD()
              }
            }
          }
          /* 拖完体块刷新一下工坊缩略图 */
          if (glDrag && glDrag.kind === 'diyPart' && sheetOpen && sheetTab === 'maker') {
            renderSheet()
          }
          glDrag = null
        })
        window.addEventListener('pointercancel', e => {
          if (camPointers.has(e.pointerId)) camPointers.delete(e.pointerId)
          if (camPointers.size < 2) camPinch = null
          camPan = null
          cancelRoomDrag()
          camGesture = null
          surfaceDrag = null
          glDrag = null
        })
      }

      function disposeBoxHelper() {
        if (!glBoxHelper) return
        const helper = glBoxHelper
        if (helper.parent) helper.parent.remove(helper)
        if (helper.geometry) helper.geometry.dispose()
        if (helper.material) helper.material.dispose()
        glBoxHelper = null
      }

      /* 家具选择框：按家具自身尺寸和朝向画线框，贴合家具而不是世界轴对齐包围盒 */
      function addFurnitureSelectionBox(holder) {
        const pivot = holder.children.find(n => n && !(n.userData && n.userData.contactShadow))
        if (!pivot) return
        glScene.updateMatrixWorld(true)
        const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert()
        const local = new THREE.Box3()
        const rel = new THREE.Matrix4()
        pivot.traverse(node => {
          /* 跳过线框自身与灯 / 粒子等无体积对象 */
          const geo = node.geometry
          if (!geo || node.isLine || node.isLineSegments) return
          if (!geo.boundingBox) geo.computeBoundingBox()
          if (!geo.boundingBox) return
          rel.multiplyMatrices(inv, node.matrixWorld)
          local.union(geo.boundingBox.clone().applyMatrix4(rel))
        })
        if (local.isEmpty()) return
        const size = local.getSize(new THREE.Vector3())
        const center = local.getCenter(new THREE.Vector3())
        const helper = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)),
          new THREE.LineBasicMaterial({ color: 0xd68e3c, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
        )
        helper.position.copy(center)
        helper.renderOrder = 30
        /* 挂在家具节点上：拖动 / 旋转 / 缩放 / 调高度都会自动跟随，无需手动 update */
        helper.update = () => {}
        helper.raycast = () => {}
        pivot.add(helper)
        glBoxHelper = helper
      }

      function updateSelectionVisuals() {
        if (!glReady) return
        disposeBoxHelper()
        if (selection && selection.kind === 'furniture') {
          const group = glFurniture.children.find(g => g.userData.itemId === selection.id)
          if (group) addFurnitureSelectionBox(group)
        } else if (selection && selection.kind === 'opening') {
          const group = glOpenings.children.find(g => g.userData.openingId === selection.id)
          if (group) {
            glBoxHelper = new THREE.BoxHelper(group, 0xd68e3c)
            glBoxHelper.material.depthTest = false
            glScene.add(glBoxHelper)
          }
        } else if (selection && selection.kind === 'scene') {
          const target = activeRoom().parts[selection.part]
          const first = target && target[0]
          if (first) {
            glBoxHelper = new THREE.BoxHelper(first, 0xd68e3c)
            glBoxHelper.material.depthTest = false
            glScene.add(glBoxHelper)
          }
        }
      }

      function syncRoom3D() {
        if (!glReady) return
        const setColor = (list, hex) => list.forEach(m => m.color.set(hex).convertSRGBToLinear())
        rooms.forEach(room => {
          if (!room.mats) return
          const vis = roomVisible(room.id)
          setColor(room.mats.wall, roomTone(room, 'wall'))
          setColor(room.mats.floor, roomTone(room, 'floor'))
          setColor(room.mats.baseboard, baseboardTone(room))
          room.parts.wall.forEach(m => { m.visible = vis && !room.state.wall.hidden })
          room.parts.floor.forEach(m => { m.visible = vis && !room.state.floor.hidden })
          room.parts.baseboard.forEach(m => { m.visible = vis && !room.state.baseboard.hidden })
          applySurface(room, 'wall')
          applySurface(room, 'floor')
        })
        syncOpenings3D()
        updateSelectionVisuals()
      }

      function addFurnitureHolder(item, room, extra) {
        const model = buildFurniture(item)
        const pivot = new THREE.Group()
        pivot.rotation.set(
          THREE.MathUtils.degToRad(item.rotX || 0),
          THREE.MathUtils.degToRad(item.rotY || 0),
          THREE.MathUtils.degToRad(item.rotZ || 0)
        )
        pivot.add(model)

        const holder = new THREE.Group()
        holder.add(pivot)
        const shadow = makeContactShadow(item)
        if (shadow) {
          shadow.userData.contactShadow = true
          /* 家具离地后不收接地阴影，避免阴影悬空 */
          shadow.visible = (item.wy || 0) <= 0.001
          holder.add(shadow)
        }
        const pos = itemPos(item, room)
        holder.position.set(pos.x, pos.y, pos.z)
        holder.scale.setScalar(item.type === 'diy' ? (item.scale || 1) : 1)
        holder.visible = roomVisible(room.id)
        holder.userData = { roomId: room.id }
        if (item.id) holder.userData.itemId = item.id
        Object.assign(holder.userData, extra || {})
        glFurniture.add(holder)
      }

      /* 只重建单件家具，拖尺寸滑杆时不整屋刷新 */
      function removeFurnitureHolder(id) {
        const group = glFurniture.children.find(g => g.userData.itemId === id)
        if (!group) return false
        glFurniture.remove(group)
        /* 材质由家具库统一缓存复用，这里只释放几何体 */
        group.traverse(n => {
          if (n.geometry) n.geometry.dispose()
        })
        return true
      }

      /* 制作家具面板打开时，把草稿实时摆进房间当预览 */
      function makerPreviewVisible() {
        return sheetOpen && sheetTab === 'maker' && diy.parts.length > 0
      }

      /* 工坊预览固定摆在当前房间后方，拖拽时做世界坐标换算 */
      function diyPreviewSpot() {
        const room = activeRoom()
        return {
          x: room.cx,
          z: room.cz - room.d / 2 + 1.5,
          scale: diy.scale || 1
        }
      }

      /* 拖拽体块时用体块中心高度的水平面取点，手和体块的跟随感更一致 */
      function diyPlanePoint(part) {
        const scale = diy.scale || 1
        const height = (part.y + part.h / 2) * scale
        const point = new THREE.Vector3()
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height)
        return glRay.ray.intersectPlane(plane, point) ? point : null
      }

      function findDiyPreviewPart(object) {
        let node = object
        let part = null
        while (node) {
          if (node.userData && node.userData.diyPart !== undefined && part === null) part = node.userData.diyPart
          if (node.userData && node.userData.diyPreview) return part
          node = node.parent
        }
        return null
      }

      /* 拖动时只挪这一块，不整屋重建，手感更跟手 */
      function moveDiyPreviewPart(index, part) {
        if (!glReady) return
        const holder = glFurniture.children.find(g => g.userData.diyPreview)
        if (!holder) return
        let mesh = null
        holder.traverse(node => {
          if (!mesh && node.userData && node.userData.diyPart === index) mesh = node
        })
        if (mesh) mesh.position.set(part.x, part.y + part.h / 2, part.z)
      }

      function syncDiySliders(part) {
        ['x', 'y', 'z', 'ry', 'w', 'h', 'd'].forEach(key => {
          const input = sheetBody.querySelector('[data-diy="' + key + '"]')
          const label = sheetBody.querySelector('[data-diy-val="' + key + '"]')
          if (input) input.value = part[key]
          if (label) label.textContent = key === 'ry' ? Math.round(part[key]) + '°' : Number(part[key]).toFixed(2) + 'm'
        })
      }

      function syncFurniture3D() {
        /* 制作面板打开时把画布整体上移，让草稿露在面板上方，方便直接拖 */
        if (roomEl) roomEl.classList.toggle('is-maker', makerPreviewVisible())
        if (!glReady) return
        glFurniture.children.slice().forEach(group => {
          glFurniture.remove(group)
          group.traverse(o => {
            if (o.geometry) o.geometry.dispose()
            if (o.material) {
              if (Array.isArray(o.material)) o.material.forEach(m => m.dispose())
              else o.material.dispose()
            }
          })
        })
        resetFloorplanMaterials()
        rooms.forEach(room => {
          room.placed.forEach(item => addFurnitureHolder(item, room))
        })
        if (makerPreviewVisible()) {
          const room = activeRoom()
          addFurnitureHolder({
            type: 'diy',
            parts: diy.parts,
            scale: diy.scale || 1,
            rotX: 0,
            rotY: 0,
            rotZ: 0,
            wx: 0,
            wy: 0,
            wz: -(room.d / 2) + 1.5
          }, room, { diyPreview: true })
        }
        updateSelectionVisuals()
      }

      function renderScene() {
        syncRoom3D()
        scheduleHistory()
      }

      function renderFurniture() {
        syncFurniture3D()
        scheduleHistory()
      }

      function renderHUD() {
        hudCount.textContent = activeRoom().name + ' · 家具 ' + placed.length
        lobbyMeta.textContent = '已排 ' + rooms.length + ' 间房 · 点选任何元素都能编辑'
        hudHint.classList.toggle('is-hidden', hintDismissed)
        renderRoomTabs()
        scheduleHistory()
      }

      /* ---------- 户型切换 ---------- */
      function renderRoomTabs() {
        if (!roomTabs) return
        const manage = overviewMode ? '' :
          '<span class="room-chip room-chip--act" data-room-rename="1">改名</span>' +
          '<span class="room-chip room-chip--act room-chip--del' + (pendingDeleteId === activeRoomId ? ' is-confirm' : '') +
          '" data-room-delete="1">' + (pendingDeleteId === activeRoomId ? '确认删除？' : '删除') + '</span>'
        roomTabs.innerHTML =
          '<span class="room-chip' + (overviewMode ? ' is-on' : '') + '" data-room="__all">全屋</span>' +
          rooms.map(room =>
            '<span class="room-chip' + (!overviewMode && room.id === activeRoomId ? ' is-on' : '') +
            '" data-room="' + room.id + '">' + escapeHTML(room.name) + '</span>'
          ).join('') +
          '<span class="room-chip room-chip--add" data-room-add="1">＋ 房间</span>' +
          manage
        roomTabs.classList.toggle('is-scrollable', roomTabs.scrollWidth > roomTabs.clientWidth + 1)
      }

      /* 把当前选中的房间标签滚动到可见范围 */
      function revealActiveTab() {
        const chip = roomTabs.querySelector('.room-chip.is-on')
        if (!chip) return
        const left = chip.offsetLeft
        const right = left + chip.offsetWidth
        if (left < roomTabs.scrollLeft) roomTabs.scrollLeft = left - 8
        else if (right > roomTabs.scrollLeft + roomTabs.clientWidth) roomTabs.scrollLeft = right - roomTabs.clientWidth + 8
      }

      function focusRoom(id) {
        const room = roomById(id)
        if (!room) return
        bindRoom(id)
        overviewMode = false
        selection = null
        pickerOpen = false
        hintDismissed = true
        sizeCustomOpen = false
        roomRenameOpen = false
        pendingDeleteId = null
        closeSheet()
        tweenCamera(roomFocusGoal(room))
        renderAll()
        revealActiveTab()
      }

      function showOverview() {
        overviewMode = true
        selection = null
        pickerOpen = false
        sizeCustomOpen = false
        roomRenameOpen = false
        pendingDeleteId = null
        closeSheet()
        tweenCamera(overviewGoal())
        renderAll()
      }

      /* 新增房间：接在最后一间房的后方（-z）扩出一间 */
      function addRoom() {
        const last = rooms[rooms.length - 1]
        const depth = 4.2
        const room = {
          id: 'room-' + (++roomSeq),
          name: '房间 ' + (rooms.length + 1),
          w: 5.2,
          d: depth,
          cx: last.cx,
          cz: roomBackZ(last) - depth / 2,
          state: {
            wall: {
              tone: SCENE_PARTS.wall.tones[0],
              finish: 'tile',
              finishSize: 0.3,
              finishTone: '#ddd8cc',
              coverH: 1.20,
              hidden: false
            },
            floor: {
              tone: SCENE_PARTS.floor.tones[0],
              finish: 'tile',
              finishSize: 0.5,
              finishTone: '#c2b8a4',
              hidden: false
            },
            baseboard: { tone: null, hidden: true }
          },
          openings: [],
          placed: []
        }
        rooms.push(room)
        buildRoom(room)
        bindRoom(room.id)
        overviewMode = false
        selection = null
        roomRenameOpen = false
        pendingDeleteId = null
        tweenCamera(roomFocusGoal(room))
        renderAll()
        revealActiveTab()
        showToast('已添加「' + room.name + '」')
      }

      /* 门窗宽/高：滑杆 + 米数输入，替代原来的固定尺寸选项 */
      function openingSizeRows(opening) {
        const isWin = opening.kind === 'window'
        const size = isWin ? windowSize(opening) : doorSize(opening)
        const lim = openingLimits(opening)
        const dimItem = (axis, label, min, max, value) =>
          '<label class="rot-item">' +
            '<span class="rot-key">' + label + '</span>' +
            '<input class="rot-slider" type="range" min="' + min + '" max="' + max + '" step="0.05" data-osize="' + axis +
              '" value="' + value + '">' +
            '<span class="rot-val-wrap">' +
              '<input class="rot-val rot-val--dim" type="number" inputmode="decimal" min="' + min + '" max="' + max +
                '" step="0.05" data-osize-num="' + axis + '" value="' + value.toFixed(2) + '">' +
              '<span class="rot-deg">m</span>' +
            '</span>' +
          '</label>'
        return (
          '<div class="dock-row rot-row">' +
            dimItem('w', '宽', lim.wMin, lim.wMax, Math.round(size.w * 100) / 100) +
            dimItem('h', '高', lim.hMin, lim.hMax, Math.round(size.h * 100) / 100) +
          '</div>' +
          (isWin
            ? '<div class="dock-row">' +
                '<span class="dock-tip">窗簾</span>' +
                '<div class="styles">' +
                  '<span class="style-chip' + (opening.curtain !== false ? ' is-on' : '') + '" data-curtain="1">懸掛</span>' +
                  '<span class="style-chip' + (opening.curtain === false ? ' is-on' : '') + '" data-curtain="0">收起</span>' +
                '</div>' +
              '</div>' +
              (opening.curtain !== false
                ? '<div class="dock-row">' +
                    '<div class="swatches">' +
                      CURTAIN_TONES.map(tone =>
                        '<span class="swatch' + ((opening.curtainTone || CURTAIN_TONES[0]) === tone ? ' is-on' : '') +
                        '" data-curtain-tone="' + tone + '" style="background:' + tone + '"></span>'
                      ).join('') +
                      '<span class="swatch swatch--tone' + (curtainPicker ? ' is-on' : '') + '" data-curtain-tone-open="1"><i class="swatch-dot"></i></span>' +
                    '</div>' +
                    '<span class="dock-tip">窗簾配色</span>' +
                  '</div>'
                : '')
            : '')
        )
      }

      /* 墙面 / 地板：素面、瓷砖、木板的铺装选择与尺寸调节 */
      function surfaceRowsHTML(part, st) {
        const finish = st.finish === 'tile' || st.finish === 'wood' ? st.finish : 'plain'
        const def = SURFACE_SIZE[finish]
        const size = Math.round((def ? clamp(numOr(st.finishSize, def.def), def.min, def.max) : 0) * 100) / 100
        const chips = SURFACE_KINDS.map(kind =>
          '<span class="style-chip' + (finish === kind.id ? ' is-on' : '') + '" data-surface="' + kind.id + '">' + kind.name + '</span>'
        ).join('')
        let coverRows = ''
        if (def) {
          const room = activeRoom()
          const cover = surfaceCover(room, part, 0)
          const coverItem = (axis, label, value, max) =>
            '<label class="rot-item">' +
              '<span class="rot-key">' + label + '</span>' +
              '<input class="rot-slider" type="range" min="0.2" max="' + Math.round(max * 100) / 100 +
                '" step="0.05" data-cover="' + axis + '" value="' + value + '">' +
              '<span class="rot-val-wrap">' +
                '<input class="rot-val rot-val--dim" type="number" inputmode="decimal" min="0.2" max="' +
                  Math.round(max * 100) / 100 + '" step="0.05" data-cover-num="' + axis + '" value="' + value.toFixed(2) + '">' +
                '<span class="rot-deg">m</span>' +
              '</span>' +
            '</label>'
          coverRows =
            '<div class="dock-row rot-row">' +
              coverItem('w', '铺贴宽', Math.round(cover.w * 100) / 100, cover.fullW) +
              coverItem('h', '铺贴高', Math.round(cover.h * 100) / 100, cover.fullH) +
              '<span class="rot-reset" data-surface-full="1">满铺</span>' +
            '</div>' +
            '<div class="dock-row"><span class="dock-tip">铺贴区域可直接拖动调整位置</span></div>'
        }
        const sizeRow = def
          ? '<div class="dock-row rot-row">' +
              '<label class="rot-item">' +
                '<span class="rot-key">' + (finish === 'tile' ? '砖尺寸' : '板宽') + '</span>' +
                '<input class="rot-slider" type="range" min="' + def.min + '" max="' + def.max + '" step="' + def.step +
                  '" data-surface-size="1" value="' + size + '">' +
                '<span class="rot-val-wrap">' +
                  '<input class="rot-val rot-val--dim" type="number" inputmode="decimal" min="' + def.min + '" max="' + def.max +
                    '" step="' + def.step + '" data-surface-size-num="1" value="' + size.toFixed(2) + '">' +
                  '<span class="rot-deg">m</span>' +
                '</span>' +
              '</label>' +
            '</div>'
          : ''
        /* 铺装色：预设色板 + 自由取色 + 跟随墙面 / 地板配色 */
        const toneRow = def
          ? '<div class="dock-row">' +
              '<span class="dock-tip">铺装色</span>' +
              '<div class="swatches">' +
                SURFACE_TONES[finish].map(t =>
                  '<span class="swatch' + (st.finishTone === t ? ' is-on' : '') + '" data-finish-tone="' + t + '" style="background:' + t + '"></span>'
                ).join('') +
                '<span class="swatch swatch--tone' + (st.finishTone ? ' is-on' : '') + '" data-finish-tone-open="1"><i class="swatch-dot"></i></span>' +
              '</div>' +
              '<span class="style-chip' + (st.finishTone ? '' : ' is-on') + '" data-finish-follow="1">跟随</span>' +
            '</div>'
          : ''
        return (
          '<div class="dock-row">' +
            '<span class="dock-tip">表面</span>' +
            '<div class="styles">' + chips + '</div>' +
          '</div>' +
          toneRow +
          sizeRow +
          coverRows
        )
      }

      function rotationRowsHTML(item) {
        return (
          '<div class="dock-row rot-row">' +
            ['x', 'y', 'z'].map(axis => {
              const value = Math.round(item['rot' + axis.toUpperCase()] || 0)
              return (
                '<label class="rot-item">' +
                  '<span class="rot-key">' + axis.toUpperCase() + '</span>' +
                  '<input class="rot-slider" type="range" min="-180" max="180" step="1" data-rot="' + axis + '" value="' + value + '">' +
                  '<span class="rot-val-wrap">' +
                    '<input class="rot-val" type="number" inputmode="numeric" min="-180" max="180" step="1" data-rot-num="' + axis + '" value="' + value + '">' +
                    '<span class="rot-deg">°</span>' +
                  '</span>' +
                '</label>'
              )
            }).join('') +
            '<span class="rot-reset" data-rot-reset="1">归零</span>' +
          '</div>'
        )
      }

      /* 家具尺寸：宽/深直接用米数调，替代原来的大中小 */
      function dimensionRowsHTML(item) {
        const dims = itemDims(item)
        return (
          '<div class="dock-row rot-row">' +
            ['w', 'd'].map(axis => {
              const value = Math.round(dims[axis] * 100) / 100
              const label = axis === 'w' ? '宽' : '深'
              return (
                '<label class="rot-item">' +
                  '<span class="rot-key">' + label + '</span>' +
                  '<input class="rot-slider" type="range" min="' + FURN_DIM.min + '" max="' + FURN_DIM.max +
                    '" step="' + FURN_DIM.step + '" data-fdim="' + axis + '" value="' + value + '">' +
                  '<span class="rot-val-wrap">' +
                    '<input class="rot-val rot-val--dim" type="number" inputmode="decimal" min="' + FURN_DIM.min +
                      '" max="' + FURN_DIM.max + '" step="' + FURN_DIM.step + '" data-fdim-num="' + axis +
                      '" value="' + value.toFixed(2) + '">' +
                    '<span class="rot-deg">m</span>' +
                  '</span>' +
                '</label>'
              )
            }).join('') +
          '</div>'
        )
      }

      /* 所有家具统一的离地高度调整 */
      function heightRowHTML(item) {
        const value = Math.round(clamp(numOr(item.wy, 0), FURN_Y.min, FURN_Y.max) * 100) / 100
        return (
          '<div class="dock-row rot-row">' +
            '<label class="rot-item">' +
              '<span class="rot-key">高度</span>' +
              '<input class="rot-slider" type="range" min="' + FURN_Y.min + '" max="' + FURN_Y.max +
                '" step="' + FURN_Y.step + '" data-fwy="1" value="' + value + '">' +
              '<span class="rot-val-wrap">' +
                '<input class="rot-val rot-val--dim" type="number" inputmode="decimal" min="' + FURN_Y.min +
                  '" max="' + FURN_Y.max + '" step="' + FURN_Y.step + '" data-fwy-num="1" value="' + value.toFixed(2) + '">' +
                '<span class="rot-deg">m</span>' +
              '</span>' +
            '</label>' +
            '<span class="rot-reset" data-fwy-reset="1">落地</span>' +
          '</div>'
        )
      }

      function renderDock() {
        const item = selectedItem()
        if (item) {
          if (item.type === 'diy') {
            dock.innerHTML =
              '<div class="dock-row">' +
                '<div class="dock-head">' +
                  '<span class="dock-name">' + escapeHTML(item.name) + '</span>' +
                  '<span class="dock-tag">自制 · ' + (item.parts ? item.parts.length : 0) + ' 块</span>' +
                '</div>' +
                '<span class="dock-del" id="delBtn">删除</span>' +
              '</div>' +
              '<div class="dock-row rot-row">' +
                '<label class="rot-item">' +
                  '<span class="rot-key">缩放</span>' +
                  '<input class="rot-slider" type="range" min="' + Math.round(DIY_SCALE.min * 100) + '" max="' + Math.round(DIY_SCALE.max * 100) +
                    '" step="' + Math.round(DIY_SCALE.step * 100) + '" data-diy-scale="1" value="' + Math.round((item.scale || 1) * 100) + '">' +
                  '<span class="rot-val-wrap">' +
                    '<input class="rot-val rot-val--dim" type="number" inputmode="numeric" min="' + Math.round(DIY_SCALE.min * 100) +
                      '" max="' + Math.round(DIY_SCALE.max * 100) + '" step="' + Math.round(DIY_SCALE.step * 100) +
                      '" data-diy-scale-num="1" value="' + Math.round((item.scale || 1) * 100) + '">' +
                    '<span class="rot-deg">%</span>' +
                  '</span>' +
                '</label>' +
                '<span class="dock-tip">拖动摆放</span>' +
              '</div>' +
              heightRowHTML(item) +
              rotationRowsHTML(item)
            scheduleHistory()
            return
          }
          const def = CATALOG[item.type]
          dock.innerHTML =
            '<div class="dock-row">' +
              '<div class="dock-head">' +
                '<span class="dock-name">' + item.name + '</span>' +
                '<span class="dock-tag">' + def.tag + '</span>' +
              '</div>' +
              '<span class="dock-del" id="delBtn">删除</span>' +
            '</div>' +
            '<div class="dock-row">' +
              '<div class="swatches">' +
                def.palettes.map((pal, i) =>
                  '<span class="swatch' + (!item.tone && item.palette === i ? ' is-on' : '') + '" data-pal="' + i + '" title="' + pal.name + '" style="background:' + swatchColor(pal) + '"></span>'
                ).join('') +
                '<span class="swatch swatch--tone' + (item.tone ? ' is-on' : '') + '" data-tone-open="1"><i class="swatch-dot"></i></span>' +
              '</div>' +
            '</div>' +
            dimensionRowsHTML(item) +
            heightRowHTML(item) +
            (def.styles.length > 1
              ? '<div class="dock-row">' +
                '<span class="dock-tip">造型</span>' +
                '<div class="styles">' +
                  def.styles.map(st =>
                    '<span class="style-chip' + (styleOfItem(item) === st.id ? ' is-on' : '') + '" data-style="' + st.id + '">' + st.name + '</span>'
                  ).join('') +
                '</div>' +
              '</div>'
              : '') +
            '<div class="dock-row rot-row">' +
              ['x', 'y', 'z'].map(axis => {
                const value = Math.round(item['rot' + axis.toUpperCase()] || 0)
                return (
                  '<label class="rot-item">' +
                    '<span class="rot-key">' + axis.toUpperCase() + '</span>' +
                    '<input class="rot-slider" type="range" min="-180" max="180" step="1" data-rot="' + axis + '" value="' + value + '">' +
                    '<span class="rot-val-wrap">' +
                      '<input class="rot-val" type="number" inputmode="numeric" min="-180" max="180" step="1" data-rot-num="' + axis + '" value="' + value + '">' +
                      '<span class="rot-deg">°</span>' +
                    '</span>' +
                  '</label>'
                )
              }).join('') +
              '<span class="rot-reset" data-rot-reset="1">归零</span>' +
            '</div>'
        } else if (selection && selection.kind === 'opening') {
          const opening = selectedOpening()
          if (opening) {
            const def = SCENE_PARTS[opening.kind]
            dock.innerHTML =
              '<div class="dock-row">' +
                '<div class="dock-head">' +
                  '<span class="dock-name">' + def.name + '</span>' +
                  '<span class="dock-tag">' + (opening.side === 'left' ? '左墙' : '后墙') + ' · 可拖动</span>' +
                '</div>' +
                '<span class="dock-del" id="delBtn">移除</span>' +
              '</div>' +
              '<div class="dock-row">' +
                '<div class="swatches">' +
                  def.tones.map(tone =>
                    '<span class="swatch' + (opening.tone === tone ? ' is-on' : '') + '" data-tone="' + tone + '" style="background:' + tone + '"></span>'
                  ).join('') +
                  '<span class="swatch swatch--tone' + (opening.tone ? ' is-on' : '') + '" data-tone-open="1"><i class="swatch-dot"></i></span>' +
                '</div>' +
                '<span class="dock-tip">拖动可沿墙移动</span>' +
              '</div>' +
              '<div class="dock-row dock-row--side">' +
                '<span class="side-label">所在墙面</span>' +
                '<span class="side-opts">' +
                  '<span class="side-chip' + (opening.side === 'left' ? ' is-on' : '') + '" data-opening-side="left">左墙</span>' +
                  '<span class="side-chip' + (opening.side === 'back' ? ' is-on' : '') + '" data-opening-side="back">后墙</span>' +
                '</span>' +
              '</div>' +
              openingSizeRows(opening)
          }
        } else if (selection && selection.kind === 'scene') {
          const part = selection.part
          const st = sceneState[part]
          dock.innerHTML =
            '<div class="dock-row">' +
              '<div class="dock-head">' +
                '<span class="dock-name">' + SCENE_PARTS[part].name + '</span>' +
                '<span class="dock-tag">' + activeRoom().name + ' · ' + SCENE_PARTS[part].tag + '</span>' +
              '</div>' +
              '<span class="dock-del" id="delBtn">移除</span>' +
            '</div>' +
            '<div class="dock-row">' +
              '<div class="swatches">' +
                SCENE_PARTS[part].tones.map(tone =>
                  '<span class="swatch' + (st.tone === tone ? ' is-on' : '') + '" data-tone="' + tone + '" style="background:' + tone + '"></span>'
                ).join('') +
                '<span class="swatch swatch--tone' + (st.tone ? ' is-on' : '') + '" data-tone-open="1"><i class="swatch-dot"></i></span>' +
              '</div>' +
              '<span class="dock-tip">色盘可自由配色</span>' +
            '</div>' +
            (part === 'wall' || part === 'floor' ? surfaceRowsHTML(part, st) : '')
        } else {
          const room = activeRoom()
          const isPreset = ROOM_SIZES.some(s => s[0] === room.w && s[1] === room.d)
          const customFields = sizeCustomOpen
            ? '<div class="dock-row">' +
                '<span class="dock-tip">自定义尺寸</span>' +
                '<div class="dim-fields">' +
                  '<label class="dim-item">' +
                    '<span class="dim-key">宽</span>' +
                    '<input class="dim-val" type="number" inputmode="decimal" min="' + ROOM_DIM.min + '" max="' + ROOM_DIM.max + '" step="' + ROOM_DIM.step + '" value="' + room.w + '" data-dim="w">' +
                    '<span class="dim-unit">m</span>' +
                  '</label>' +
                  '<span class="dim-key">×</span>' +
                  '<label class="dim-item">' +
                    '<span class="dim-key">深</span>' +
                    '<input class="dim-val" type="number" inputmode="decimal" min="' + ROOM_DIM.min + '" max="' + ROOM_DIM.max + '" step="' + ROOM_DIM.step + '" value="' + room.d + '" data-dim="d">' +
                    '<span class="dim-unit">m</span>' +
                  '</label>' +
                  '<span class="dim-apply" data-room-dim-apply="1">应用</span>' +
                '</div>' +
              '</div>'
            : ''
          const renameRow = roomRenameOpen
            ? '<div class="dock-row">' +
                '<span class="dock-tip">房间名</span>' +
                '<div class="dim-fields">' +
                  '<input class="dim-val room-name-input" type="text" maxlength="8" value="' + escapeHTML(room.name) + '" data-room-name>' +
                  '<span class="dim-apply" data-room-rename-apply="1">保存</span>' +
                '</div>' +
              '</div>'
            : ''
          const sizeRow = overviewMode ? '' :
            '<div class="dock-row">' +
              '<span class="dock-tip">房间尺寸 ' + room.w + '×' + room.d + ' m</span>' +
              '<div class="sizes">' +
                ROOM_SIZES.map(s =>
                  '<span class="size' + (room.w === s[0] && room.d === s[1] ? ' is-on' : '') + '" data-room-size="' + s[0] + 'x' + s[1] + '">' + s[0] + '×' + s[1] + '</span>'
                ).join('') +
                '<span class="size size--custom' + (isPreset ? '' : ' is-on') + '" data-room-custom="1">自定义</span>' +
              '</div>' +
            '</div>' +
            customFields
          dock.innerHTML =
            '<div class="dock-row">' +
              '<div>' +
                '<span class="dock-name" style="font-size:12px">改造模式</span>' +
                '<div class="dock-sub" style="margin-top:4px">' +
                  (overviewMode ? '点房间改造 · 拖动家具 · 色盘换色' : '拖动家具 · 色盘换色 · 选布局或自定义尺寸') +
                '</div>' +
              '</div>' +
              '<div class="dock-acts">' +
                '<span class="craft-btn" id="craftBtn">制作</span>' +
                '<span class="add-btn" id="addBtn"><span class="add-plus">+</span>添加</span>' +
              '</div>' +
            '</div>' +
            sizeRow +
            renameRow
        }
        scheduleHistory()
      }

      function cardHTML(type, tag) {
        const def = CATALOG[type]
        if (!def) return ''
        return (
          '<div class="cat-card" data-add="' + type + '">' +
            furnitureThumb(def) +
            '<span class="cat-name">' + def.name + '</span>' +
            '<span class="cat-tag">' + (tag || def.tag) + '</span>' +
          '</div>'
        )
      }

      function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, ch => (
          { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        ))
      }

      /* ---------- DIY 捏家具 ---------- */
      function starterDiy() {
        return {
          name: '',
          scale: 1,
          selected: 0,
          parts: [
            { s: 'box', c: '#dcc09a', w: 1.2, h: 0.12, d: 0.7, x: 0, y: 0.72, z: 0, ry: 0 },
            { s: 'cyl', c: '#b08a5e', w: 0.1, h: 0.72, d: 0.1, x: -0.5, y: 0, z: -0.25, ry: 0 },
            { s: 'cyl', c: '#b08a5e', w: 0.1, h: 0.72, d: 0.1, x: 0.5, y: 0, z: -0.25, ry: 0 },
            { s: 'cyl', c: '#b08a5e', w: 0.1, h: 0.72, d: 0.1, x: -0.5, y: 0, z: 0.25, ry: 0 },
            { s: 'cyl', c: '#b08a5e', w: 0.1, h: 0.72, d: 0.1, x: 0.5, y: 0, z: 0.25, ry: 0 }
          ]
        }
      }

      function defaultDiyPart(shape) {
        const part = { s: shape, c: DIY_DEFAULT_COLOR, w: 0.8, h: 0.3, d: 0.6, x: 0, y: 0, z: 0, ry: 0 }
        if (shape === 'cyl') { part.w = 0.5; part.h = 0.6; part.d = 0.5 }
        else if (shape === 'sphere') { part.w = 0.5; part.h = 0.5; part.d = 0.5 }
        else if (shape === 'cone') { part.w = 0.55; part.h = 0.7; part.d = 0.55 }
        return part
      }

      function cloneDiyParts(parts) {
        return (parts || []).map(part => Object.assign({}, part))
      }

      function currentDiyPart() {
        return diy.parts[diy.selected] || null
      }

      function diyShapeName(id) {
        return DIY_SHAPE_NAME[id] || '体块'
      }

      /* 作品缩略图：按体块正投影堆叠，够看清造型即可 */
      function diyArtHTML(parts) {
        const list = (parts || []).filter(Boolean)
        if (!list.length) return '<div class="diy-art diy-art--empty">空</div>'
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        list.forEach(part => {
          minX = Math.min(minX, part.x - part.w / 2)
          maxX = Math.max(maxX, part.x + part.w / 2)
          minY = Math.min(minY, part.y)
          maxY = Math.max(maxY, part.y + part.h)
        })
        const scale = Math.min(80 / Math.max(0.4, maxX - minX), 58 / Math.max(0.4, maxY - minY))
        const midX = (minX + maxX) / 2
        const padY = Math.max(0, (58 - (maxY - minY) * scale) / 2)
        const sorted = list.slice().sort((a, b) => (a.z - b.z) || (a.y - b.y))
        return (
          '<div class="diy-art">' +
            sorted.map(part => {
              const w = Math.max(3, part.w * scale)
              const h = Math.max(3, part.h * scale)
              const offset = (part.x - part.w / 2 - midX) * scale
              const bottom = 4 + padY + (part.y - minY) * scale
              const deep = Math.max(2, Math.min(6, part.d * scale * 0.16))
              const radius = part.s === 'sphere' ? '50%' : part.s === 'cyl' ? '50% / 20%' : '3PX'
              const clip = part.s === 'cone' ? 'clip-path:polygon(50% 0%, 100% 100%, 0% 100%);' : ''
              return (
                '<span class="diy-art-piece" style="left:calc(50% + ' + offset.toFixed(1) + 'PX - ' + (w / 2).toFixed(1) + 'PX);bottom:' + bottom.toFixed(1) +
                'PX;width:' + w.toFixed(1) + 'PX;height:' + h.toFixed(1) + 'PX;border-radius:' + radius +
                ';background:linear-gradient(180deg, ' + shade(part.c, 0.16) + ' 0%, ' + part.c + ' 62%, ' + shade(part.c, -0.14) + ' 100%);box-shadow:0 ' +
                deep.toFixed(1) + 'PX 0 ' + shade(part.c, -0.3) + ';' + clip + '"></span>'
              )
            }).join('') +
          '</div>'
        )
      }

      function diySlider(label, key, value, min, max, step, unit) {
        const text = unit ? Math.round(value) + unit : Number(value).toFixed(2) + 'm'
        return (
          '<label class="diy-slider">' +
            '<span class="diy-slider-key">' + label + '</span>' +
            '<input type="range" data-diy="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
            '<span class="diy-slider-val" data-diy-val="' + key + '">' + text + '</span>' +
          '</label>'
        )
      }

      /* 作品库：存在本地，可整库导出 / 导入 */
      function normalizeDiyWork(raw, index) {
        if (!raw || typeof raw !== 'object') return null
        const parts = normDiyParts(raw.parts)
        if (!parts.length) return null
        const id = typeof raw.id === 'string' ? raw.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) : ''
        return { id: id || 'work-import-' + index, name: normName(raw.name, '自制家具'), parts: parts }
      }

      function loadDiyWorks() {
        try {
          const raw = window.localStorage.getItem(DIY_LIB_KEY)
          if (!raw) return []
          const list = JSON.parse(raw)
          return (Array.isArray(list) ? list : []).slice(0, 60).map(normalizeDiyWork).filter(Boolean)
        } catch (err) {
          return []
        }
      }

      function saveDiyWorks() {
        try {
          window.localStorage.setItem(DIY_LIB_KEY, JSON.stringify(diyLibrarySnapshot()))
        } catch (err) { /* 隐私模式下写不了就只留在内存里 */ }
      }

      function diyLibrarySnapshot() {
        return diyWorks.map(work => ({ id: work.id, name: work.name, parts: cloneDiyParts(work.parts) }))
      }

      function diyWorkId() {
        let id
        do {
          id = 'work-' + Date.now().toString(36) + '-' + (++diySeq)
        } while (diyWorks.some(work => work.id === id))
        return id
      }

      function makerHTML() {
        const part = currentDiyPart()
        const list = diy.parts
        const works = diyWorks.length
          ? diyWorks.map(work =>
              '<div class="diy-work" data-work="' + work.id + '">' +
                '<span class="diy-work-del" data-work-del="' + work.id + '">×</span>' +
                '<div class="diy-work-art">' + diyArtHTML(work.parts) + '</div>' +
                '<span class="diy-work-name">' + escapeHTML(work.name) + '</span>' +
              '</div>'
            ).join('')
          : '<div class="cat-empty">作品库还是空的，捏好一件后会自动收进来</div>'
        return (
          '<div class="maker">' +
            '<div class="maker-preview">' +
              '<div class="maker-preview-art">' + diyArtHTML(list) + '</div>' +
              '<div>' +
                '<span class="maker-name">' + escapeHTML(diy.name || '未命名作品') + '</span>' +
                '<span class="maker-cap">' + (list.length ? list.length + ' 个体块 · 房间里可直接拖动' : '还没有体块，点下方开始拼') + '</span>' +
              '</div>' +
            '</div>' +
            '<span class="maker-label">添加体块</span>' +
            '<div class="maker-types">' +
              DIY_SHAPES.map(shape =>
                '<div class="maker-type" data-diy-add="' + shape.id + '">＋' + shape.name + '</div>'
              ).join('') +
            '</div>' +
            (list.length
              ? '<span class="maker-label">作品体块 · 点选编辑，房间里可拖</span>' +
                '<div class="diy-parts">' +
                  list.map((piece, index) =>
                    '<span class="diy-part' + (index === diy.selected ? ' is-on' : '') + '" data-diy-part="' + index + '">' +
                      '<i style="background:' + piece.c + '"></i>' + diyShapeName(piece.s) +
                    '</span>'
                  ).join('') +
                '</div>'
              : '') +
            (part
              ? '<span class="maker-label">体块颜色</span>' +
                '<div class="tone-grid">' +
                  TONE_SWATCHES.map(tone =>
                    '<div class="tone' + (part.c === tone ? ' is-on' : '') + '" data-diy-tone="' + tone + '" style="background:' + tone + '"></div>'
                  ).join('') +
                '</div>' +
                '<span class="maker-label">尺寸</span>' +
                diySlider('宽', 'w', part.w, 0.06, 3, 0.02) +
                diySlider('高', 'h', part.h, 0.06, 3, 0.02) +
                diySlider('深', 'd', part.d, 0.06, 3, 0.02) +
                '<span class="maker-label">位置</span>' +
                diySlider('左右', 'x', part.x, -1.6, 1.6, 0.02) +
                diySlider('上下', 'y', part.y, 0, 3, 0.02) +
                diySlider('前后', 'z', part.z, -1.6, 1.6, 0.02) +
                diySlider('转角', 'ry', part.ry, -180, 180, 5, '°') +
                '<div class="diy-part-acts">' +
                  '<span class="diy-act" data-diy-duplicate="1">复制这块</span>' +
                  '<span class="diy-act diy-act--danger" data-diy-del="1">删除这块</span>' +
                '</div>'
              : '') +
            '<input class="maker-input" id="makerName" placeholder="给作品起个名字" value="' + escapeHTML(diy.name) + '" />' +
            '<span class="maker-label">整体缩放</span>' +
            '<label class="diy-slider">' +
              '<span class="diy-slider-key">比例</span>' +
              '<input type="range" data-diy-scale="1" min="' + Math.round(DIY_SCALE.min * 100) + '" max="' + Math.round(DIY_SCALE.max * 100) +
                '" step="' + Math.round(DIY_SCALE.step * 100) + '" value="' + Math.round((diy.scale || 1) * 100) + '">' +
              '<span class="diy-slider-val" data-diy-scale-val="1">' + Math.round((diy.scale || 1) * 100) + '%</span>' +
            '</label>' +
            '<div class="maker-bottom" style="justify-content:flex-end">' +
              '<span class="maker-craft" data-craft="1">放进房间</span>' +
            '</div>' +
            '<span class="maker-label">我的作品库 · ' + diyWorks.length + ' 件</span>' +
            '<div class="diy-works">' + works + '</div>' +
            '<div class="diy-lib-acts">' +
              '<span class="diy-lib-btn" data-diy-new="1">新建作品</span>' +
              '<span class="diy-lib-btn" data-diy-export="1">导出作品库</span>' +
              '<span class="diy-lib-btn" data-diy-import="1">导入作品库</span>' +
            '</div>' +
          '</div>'
        )
      }

      function renderSheet() {
        sheetKicker.textContent = sheetTab === 'maker' ? 'WORKSHOP' : 'STORAGE'
        sheetTitle.textContent = sheetTab === 'maker' ? '制作家具' : '添加元素'
        document.querySelectorAll('.sheet-tab').forEach(tab => {
          tab.classList.toggle('is-on', tab.dataset.tab === sheetTab)
        })
        /* 重绘时保留滚动位置，避免点色盘/加体块后跳回顶部 */
        const scrollTop = sheet.scrollTop
        if (sheetTab === 'maker') {
          sheetBody.innerHTML = makerHTML()
          sheet.scrollTop = scrollTop
          return
        }
        /* 墙面、地板、踢脚线、门窗统一归到「房间结构」 */
        const hidden = SCENE_TYPES.filter(part => sceneState[part].hidden && part !== 'baseboard')
        const baseboardHidden = !!sceneState.baseboard.hidden
        const furnitureGroups = FURNITURE_GROUPS.map(group =>
          '<span class="cat-section-title">' + group.name + '</span>' +
          '<div class="cat-grid">' +
            group.ids.map(id => cardHTML(id)).join('') +
          '</div>'
        ).join('')
        sheetBody.innerHTML =
          '<span class="cat-section-title">房间结构</span>' +
          '<div class="cat-grid">' +
            hidden.map(part =>
              '<div class="cat-card" data-restore="' + part + '">' +
                '<div class="cat-part-art" style="background:' + sceneTone(part) + '"></div>' +
                '<span class="cat-name">' + SCENE_PARTS[part].name + '</span>' +
                '<span class="cat-tag">点击恢复</span>' +
              '</div>'
            ).join('') +
            OPENING_TYPES.map(kind =>
              '<div class="cat-card" data-add-opening="' + kind + '">' +
                '<div class="cat-part-art" style="background:' +
                  (kind === 'window' ? 'linear-gradient(180deg, #dbe9ee, #b7d3da)' : SCENE_PARTS[kind].tones[0]) +
                '"></div>' +
                '<span class="cat-name">' + SCENE_PARTS[kind].name + '</span>' +
                '<span class="cat-tag">点击添加</span>' +
              '</div>'
            ).join('') +
            cardHTML('column', '点击添加') +
            '<div class="cat-card" data-edit-part="baseboard">' +
              '<div class="cat-part-art" style="background:linear-gradient(180deg, ' + baseboardTone(activeRoom()) + ' 0%, ' + shade(baseboardTone(activeRoom()), -0.1) + ' 100%)"></div>' +
              '<span class="cat-name">踢脚线</span>' +
              '<span class="cat-tag">' + (baseboardHidden ? '点击恢复' : '点击编辑') + '</span>' +
            '</div>' +
          '</div>' +
          furnitureGroups
        sheet.scrollTop = scrollTop
      }

      function currentTone() {
        if (curtainPicker) {
          const opening = selectedOpening()
          return opening ? opening.curtainTone || CURTAIN_TONES[0] : null
        }
        if (finishPickerPart) {
          const st = sceneState[finishPickerPart]
          return st ? st.finishTone || roomTone(activeRoom(), finishPickerPart) : null
        }
        const item = selectedItem()
        if (item) {
          if (item.type === 'diy') return null
          return item.tone || swatchColor(CATALOG[item.type].palettes[item.palette])
        }
        const opening = selectedOpening()
        if (opening) return openingTone(opening)
        if (selection && selection.kind === 'scene') {
          return selection.part === 'baseboard' ? baseboardTone(activeRoom()) : sceneTone(selection.part)
        }
        return null
      }

      function renderPicker() {
        picker.classList.toggle('is-open', pickerOpen)
        if (!pickerOpen) {
          finishPickerPart = null
          curtainPicker = false
          picker.innerHTML = ''
          return
        }
        const item = selectedItem()
        const opening = selectedOpening()
        const name = curtainPicker
          ? '窗簾'
          : finishPickerPart
          ? (finishPickerPart === 'wall' ? '墙面' : '地板') + '铺装色'
          : item
            ? item.name
            : opening
              ? SCENE_PARTS[opening.kind].name
              : selection && selection.kind === 'scene'
                ? SCENE_PARTS[selection.part].name
                : ''
        const tone = currentTone()
        picker.innerHTML =
          '<div class="picker-head">' +
            '<span class="picker-title">色盘</span>' +
            '<span class="picker-sub">' + name + '</span>' +
          '</div>' +
          '<div class="tone-grid">' +
            TONE_SWATCHES.map(t =>
              '<div class="tone' + (tone === t ? ' is-on' : '') + '" data-tone="' + t + '" style="background:' + t + '"></div>'
            ).join('') +
          '</div>'
        scheduleHistory()
      }

      /* ---------- 撤销（返回上一步） ---------- */
      const undoStack = []
      const UNDO_MAX = 30
      let lastSnapshot = null
      let lastSnapshotKey = ''
      let historyTimer = 0

      function clonePlaced(item) {
        const copy = Object.assign({}, item)
        if (item.parts) copy.parts = cloneDiyParts(item.parts)
        return copy
      }

      function snapshotState() {
        return {
          rooms: rooms.map(room => ({
            id: room.id,
            name: room.name,
            w: room.w,
            d: room.d,
            cx: room.cx,
            cz: room.cz,
            state: {
              wall: {
                tone: room.state.wall.tone,
                hidden: room.state.wall.hidden,
                finish: room.state.wall.finish || null,
                finishSize: room.state.wall.finishSize || null,
                finishTone: room.state.wall.finishTone || null,
                coverW: room.state.wall.coverW || null,
                coverH: room.state.wall.coverH || null,
                coverU: room.state.wall.coverU == null ? null : room.state.wall.coverU,
                coverV: room.state.wall.coverV == null ? null : room.state.wall.coverV
              },
              floor: {
                tone: room.state.floor.tone,
                hidden: room.state.floor.hidden,
                finish: room.state.floor.finish || null,
                finishSize: room.state.floor.finishSize || null,
                finishTone: room.state.floor.finishTone || null,
                coverW: room.state.floor.coverW || null,
                coverH: room.state.floor.coverH || null,
                coverU: room.state.floor.coverU == null ? null : room.state.floor.coverU,
                coverV: room.state.floor.coverV == null ? null : room.state.floor.coverV
              },
              baseboard: { tone: room.state.baseboard.tone, hidden: room.state.baseboard.hidden }
            },
            openings: room.openings.map(o => Object.assign({}, o)),
            placed: room.placed.map(clonePlaced)
          })),
          roomSeq: roomSeq,
          openingSeq: openingSeq,
          customSeq: customSeq
        }
      }

      function scheduleHistory() {
        if (historyTimer) clearTimeout(historyTimer)
        historyTimer = window.setTimeout(commitHistory, 320)
      }

      function commitHistory() {
        historyTimer = 0
        if (!lastSnapshot) return
        const next = snapshotState()
        const nextKey = JSON.stringify(next)
        if (nextKey === lastSnapshotKey) return
        undoStack.push(lastSnapshot)
        if (undoStack.length > UNDO_MAX) undoStack.shift()
        lastSnapshot = next
        lastSnapshotKey = nextKey
        updateUndoBtn()
      }

      function undo() {
        if (historyTimer) {
          clearTimeout(historyTimer)
          commitHistory()
        }
        const snap = undoStack.pop()
        if (!snap) {
          showToast('没有可返回的步骤')
          return
        }
        restoreSnapshot(snap)
        showToast('已返回上一步')
      }

      function restoreSnapshot(snap) {
        const keepActive = snap.rooms.some(r => r.id === activeRoomId)
        rooms.forEach(room => {
          if (room.parts) disposeRoomParts(room)
        })
        rooms.length = 0
        snap.rooms.forEach(room => rooms.push(room))
        roomSeq = snap.roomSeq
        openingSeq = snap.openingSeq
        customSeq = snap.customSeq
        selection = null
        pickerOpen = false
        sizeCustomOpen = false
        roomRenameOpen = false
        pendingDeleteId = null
        if (deleteTimer) {
          clearTimeout(deleteTimer)
          deleteTimer = null
        }
        closeSheet()
        if (glReady) snap.rooms.forEach(room => buildRoom(room))
        if (!keepActive) {
          overviewMode = true
          bindRoom(rooms[0].id)
          tweenCamera(overviewGoal())
        } else {
          bindRoom(activeRoomId)
        }
        renderAll()
        /* 以重建后的真实状态作为新基线，避免重建差异被记成额外一步 */
        lastSnapshot = snapshotState()
        lastSnapshotKey = JSON.stringify(lastSnapshot)
        updateUndoBtn()
      }

      function updateUndoBtn() {
        const btn = document.querySelector('[data-view="undo"]')
        if (btn) btn.classList.toggle('is-off', !undoStack.length)
      }

      /* ---------- 导入 / 导出（预览图 + 分享码） ---------- */
      const LAYOUT_APP = 'my-home-room'
      const LAYOUT_VERSION = 1
      /* MYHOME1 为 deflate 压缩后的分享码，MYHOME0 为未压缩兜底 */
      const SHARE_PACKED = 'MYHOME1:'
      const SHARE_PLAIN = 'MYHOME0:'
      const shareMask = document.getElementById('shareMask')
      const shareTitle = document.getElementById('shareTitle')
      const shareBody = document.getElementById('shareBody')
      const menuWrap = document.getElementById('menu')
      let shareMode = ''
      let shareCode = ''
      let sharePreview = ''

      function numOr(value, fallback) {
        /* 存档 / 撤销快照里缺省字段是 null，Number(null) === 0 会误判成数字 */
        if (value == null || value === '') return fallback
        const n = Number(value)
        return isFinite(n) ? n : fallback
      }

      function normHex(value) {
        return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null
      }

      /* 铺装类型与尺寸：非法值退回素面 */
      function normSurface(raw) {
        const src = raw && typeof raw === 'object' ? raw : {}
        const finish = src.finish === 'tile' || src.finish === 'wood' ? src.finish : 'plain'
        const def = SURFACE_SIZE[finish]
        const cover = v => {
          const num = Number(v)
          return isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : null
        }
        const offset = v => {
          if (v == null || v === '') return null
          const num = Number(v)
          return isFinite(num) ? Math.round(num * 1000) / 1000 : null
        }
        const coverW = cover(src.coverW)
        const coverH = cover(src.coverH)
        const coverU = offset(src.coverU)
        const coverV = offset(src.coverV)
        const finishTone = normHex(src.finishTone)
        if (!def) return { finish: 'plain', finishSize: null, finishTone: finishTone, coverW: coverW, coverH: coverH, coverU: coverU, coverV: coverV }
        const size = clamp(numOr(src.finishSize, def.def), def.min, def.max)
        return {
          finish: finish,
          finishSize: Math.round(size * 100) / 100,
          finishTone: finishTone,
          coverW: coverW,
          coverH: coverH,
          coverU: coverU,
          coverV: coverV
        }
      }

      function normName(value, fallback) {
        const text = typeof value === 'string' ? value.replace(/[<>&"'`]/g, '').trim().slice(0, 8) : ''
        return text || fallback
      }

      /* DIY 体块：尺寸/位置都夹在可操作范围内，颜色只收 #rrggbb */
      function normDiyParts(raw) {
        const round = value => Math.round(value * 100) / 100
        return (Array.isArray(raw) ? raw : []).slice(0, DIY_LIMIT).map(piece => {
          if (!piece || typeof piece !== 'object') return null
          return {
            s: DIY_SHAPE_IDS.indexOf(piece.s) >= 0 ? piece.s : 'box',
            c: normHex(piece.c) || DIY_DEFAULT_COLOR,
            w: round(clamp(numOr(piece.w, 0.5), 0.06, 3)),
            h: round(clamp(numOr(piece.h, 0.5), 0.06, 3)),
            d: round(clamp(numOr(piece.d, 0.5), 0.06, 3)),
            x: round(clamp(numOr(piece.x, 0), -1.6, 1.6)),
            y: round(clamp(numOr(piece.y, 0), 0, 3)),
            z: round(clamp(numOr(piece.z, 0), -1.6, 1.6)),
            ry: round(clamp(numOr(piece.ry, 0), -180, 180))
          }
        }).filter(Boolean)
      }

      function normPlaced(raw, index) {
        if (!raw || typeof raw !== 'object') return null
        if (raw.type === 'diy') {
          const parts = normDiyParts(raw.parts)
          if (!parts.length) return null
          const diyItem = {
            id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : 'imp-' + index + '-diy',
            type: 'diy',
            name: normName(raw.name, '自制家具'),
            palette: 0,
            tone: null,
            style: 'diy',
            scale: clamp(numOr(raw.scale, LEGACY_SIZE_SCALE[raw.size] || 1), DIY_SCALE.min, DIY_SCALE.max),
            rotX: clamp(numOr(raw.rotX, 0), -180, 180),
            rotY: clamp(numOr(raw.rotY, 0), -180, 180),
            rotZ: clamp(numOr(raw.rotZ, 0), -180, 180),
            x: 0,
            y: 0,
            parts: parts
          }
          if (raw.wx !== undefined || raw.wz !== undefined) {
            diyItem.wx = clamp(numOr(raw.wx, 0), -80, 80)
            diyItem.wy = clamp(numOr(raw.wy, 0), 0, 8)
            diyItem.wz = clamp(numOr(raw.wz, 0), -80, 80)
          }
          return diyItem
        }
        const type = TYPES.indexOf(raw.type) >= 0 ? raw.type : null
        if (!type) return null
        const def = CATALOG[type]
        const styleOk = def.styles.some(s => s.id === raw.style)
        const paletteOk = Number.isInteger(raw.palette) && raw.palette >= 0 && raw.palette < def.palettes.length
        /* 旧存档的大中小折算成具体宽深，保持外观接近 */
        const legacyScale = LEGACY_SIZE_SCALE[raw.size] || 1
        const item = {
          id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : 'imp-' + index + '-' + type,
          type: type,
          name: normName(raw.name, def.name),
          palette: paletteOk ? raw.palette : 0,
          tone: normHex(raw.tone),
          style: styleOk ? raw.style : def.styles[0].id,
          w: Math.round(clamp(numOr(raw.w, def.w * legacyScale), FURN_DIM.min, FURN_DIM.max) * 100) / 100,
          d: Math.round(clamp(numOr(raw.d, def.d * legacyScale), FURN_DIM.min, FURN_DIM.max) * 100) / 100,
          rotX: clamp(numOr(raw.rotX, 0), -180, 180),
          rotY: clamp(numOr(raw.rotY, 0), -180, 180),
          rotZ: clamp(numOr(raw.rotZ, 0), -180, 180),
          x: 0,
          y: 0
        }
        /* 没有 wx/wz 的旧存档会落到房心；新家具都带 wx/wz */
        if (raw.wx !== undefined || raw.wz !== undefined) {
          item.wx = clamp(numOr(raw.wx, 0), -80, 80)
          item.wy = clamp(numOr(raw.wy, 0), 0, 8)
          item.wz = clamp(numOr(raw.wz, 0), -80, 80)
        }
        return item
      }

      function normOpening(raw, index, room) {
        if (!raw || typeof raw !== 'object') return null
        if (raw.kind !== 'window' && raw.kind !== 'door') return null
        const side = raw.side === 'back' ? 'back' : 'left'
        const span = side === 'left' ? room.d : room.w
        const isWin = raw.kind === 'window'
        const winW = isWin
          ? clamp(numOr(raw.w, WIN_W), WIN_W_MIN, Math.max(WIN_W_MIN, span - 0.9))
          : clamp(numOr(raw.w, DOOR_W), DOOR_W_MIN, Math.max(DOOR_W_MIN, Math.min(DOOR_W_MAX, span - 0.2)))
        const winH = isWin
          ? clamp(numOr(raw.h, WIN_H), WIN_H_MIN, ROOM_H - 0.4)
          : clamp(numOr(raw.h, DOOR_H), DOOR_H_MIN, ROOM_H - 0.15)
        const half = isWin ? winW / 2 + 0.45 : winW / 2 + 0.08
        const edge = Math.max(0.05, span / 2 - half)
        const opening = {
          id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : 'imp-open-' + index,
          kind: raw.kind,
          side: side,
          u: clamp(numOr(raw.u, 0), -edge, edge),
          y: isWin
            ? clamp(numOr(raw.y, WINDOW_HEAD - winH / 2), winH / 2 + 0.3, ROOM_H - winH / 2 - 0.1)
            : 0,
          tone: normHex(raw.tone),
          w: winW,
          h: winH
        }
        if (isWin) {
          opening.curtain = raw.curtain !== false
          opening.curtainTone = normHex(raw.curtainTone)
        }
        return opening
      }

      function normRoom(raw, index, ids) {
        if (!raw || typeof raw !== 'object') throw new Error('bad room')
        let id = typeof raw.id === 'string' ? raw.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) : ''
        if (!id) id = 'room-' + index
        if (ids.has(id)) id = id + '-' + index
        ids.add(id)
        const w = Math.round(clamp(numOr(raw.w, 6.4), ROOM_DIM.min, ROOM_DIM.max) / ROOM_DIM.step) * ROOM_DIM.step
        const d = Math.round(clamp(numOr(raw.d, 4.8), ROOM_DIM.min, ROOM_DIM.max) / ROOM_DIM.step) * ROOM_DIM.step
        const state = raw.state && typeof raw.state === 'object' ? raw.state : {}
        const wall = state.wall && typeof state.wall === 'object' ? state.wall : {}
        const floor = state.floor && typeof state.floor === 'object' ? state.floor : {}
        const baseboard = state.baseboard && typeof state.baseboard === 'object' ? state.baseboard : {}
        const room = {
          id: id,
          name: normName(raw.name, '房间' + (index + 1)),
          w: w,
          d: d,
          cx: clamp(numOr(raw.cx, 0), -200, 200),
          cz: clamp(numOr(raw.cz, 0), -200, 200),
          state: {
            wall: Object.assign({ tone: normHex(wall.tone), hidden: !!wall.hidden }, normSurface(wall)),
            floor: Object.assign({ tone: normHex(floor.tone), hidden: !!floor.hidden }, normSurface(floor)),
            baseboard: { tone: normHex(baseboard.tone), hidden: !!baseboard.hidden }
          },
          openings: [],
          placed: []
        }
        room.openings = (Array.isArray(raw.openings) ? raw.openings : [])
          .slice(0, 12)
          .map((o, i) => normOpening(o, i, room))
          .filter(Boolean)
        room.placed = (Array.isArray(raw.placed) ? raw.placed : [])
          .slice(0, 60)
          .map((p, i) => normPlaced(p, i))
          .filter(Boolean)
        return room
      }

      function layoutSnapshot() {
        return {
          app: LAYOUT_APP,
          version: LAYOUT_VERSION,
          exportedAt: new Date().toISOString(),
          roomSeq: roomSeq,
          openingSeq: openingSeq,
          customSeq: customSeq,
          rooms: rooms.map(room => ({
            id: room.id,
            name: room.name,
            w: room.w,
            d: room.d,
            cx: room.cx,
            cz: room.cz,
            state: {
              wall: {
                tone: room.state.wall.tone,
                hidden: room.state.wall.hidden,
                finish: room.state.wall.finish || null,
                finishSize: room.state.wall.finishSize || null,
                finishTone: room.state.wall.finishTone || null,
                coverW: room.state.wall.coverW || null,
                coverH: room.state.wall.coverH || null,
                coverU: room.state.wall.coverU == null ? null : room.state.wall.coverU,
                coverV: room.state.wall.coverV == null ? null : room.state.wall.coverV
              },
              floor: {
                tone: room.state.floor.tone,
                hidden: room.state.floor.hidden,
                finish: room.state.floor.finish || null,
                finishSize: room.state.floor.finishSize || null,
                finishTone: room.state.floor.finishTone || null,
                coverW: room.state.floor.coverW || null,
                coverH: room.state.floor.coverH || null,
                coverU: room.state.floor.coverU == null ? null : room.state.floor.coverU,
                coverV: room.state.floor.coverV == null ? null : room.state.floor.coverV
              },
              baseboard: { tone: room.state.baseboard.tone, hidden: room.state.baseboard.hidden }
            },
            openings: room.openings.map(o => Object.assign({}, o)),
            placed: room.placed.map(clonePlaced)
          }))
        }
      }

      function fileStamp() {
        const now = new Date()
        const pad = n => String(n).padStart(2, '0')
        return '' + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
          '-' + pad(now.getHours()) + pad(now.getMinutes())
      }

      function toBase64Url(bytes) {
        let bin = ''
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
        }
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }

      function fromBase64Url(text) {
        const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
        const pad = clean.length % 4 ? '='.repeat(4 - (clean.length % 4)) : ''
        const bin = atob(clean + pad)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
      }

      /* 压缩成短分享码；用纯 JS 的 deflate，避免手机浏览器不支持 CompressionStream 导致解不开 */
      async function packCode(packedPrefix, plainPrefix, payload) {
        const bytes = new TextEncoder().encode(JSON.stringify(payload))
        try {
          return packedPrefix + toBase64Url(deflateSync(bytes, { level: 9 }))
        } catch (err) {
          return plainPrefix + toBase64Url(bytes)
        }
      }

      function packShareCode() {
        return packCode(SHARE_PACKED, SHARE_PLAIN, layoutSnapshot())
      }

      function packDiyCode() {
        return packCode(DIY_PACKED, DIY_PLAIN, {
          app: 'my-home-diy',
          version: 1,
          exportedAt: new Date().toISOString(),
          works: diyLibrarySnapshot()
        })
      }

      /* 从任意粘贴内容中提取分享码：容忍空行、引号、全角冒号、连带说明文字 */
      function extractShareCode(text) {
        const source = String(text || '')
          .replace(/：/g, ':')
          /* 去掉零宽等不可见字符，避免混进码体导致解压失败 */
          .replace(/[\u200b-\u200f\u2060\ufeff\u00a0]/g, '')
        const found = source.match(/my(?:home|diy)[01]:/i)
        if (!found) return ''
        const rest = source.slice(found.index + found[0].length)
        const run = rest.match(/^[\sA-Za-z0-9_-]+/)
        return found[0].toUpperCase() + (run ? run[0].replace(/\s+/g, '') : '')
      }

      /* 只接受分享码（布置码 MYHOME，作品库码 MYDIY） */
      async function unpackShareCode(text) {
        const raw = extractShareCode(text)
        if (!raw) throw new Error('prefix')
        const body = raw.slice(raw.indexOf(':') + 1)
        if (/^MY(HOME|DIY)1:/.test(raw)) {
          let bytes
          try {
            bytes = inflateSync(fromBase64Url(body))
          } catch (err) {
            throw new Error('broken')
          }
          return JSON.parse(new TextDecoder().decode(bytes))
        }
        try {
          return JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
        } catch (err) {
          throw new Error('broken')
        }
      }

      /* ---------- 导出图：2D 室内平面布置图 ---------- */
      function planFont(size, weight) {
        return (weight || 500) + ' ' + size + 'px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
      }

      /* 按投影尺寸把房子缩放到图框里 */
      function planLayout(roomsList) {
        let minX = Infinity
        let maxX = -Infinity
        let minZ = Infinity
        let maxZ = -Infinity
        roomsList.forEach(r => {
          minX = Math.min(minX, r.cx - r.w / 2 - WALL_T)
          maxX = Math.max(maxX, r.cx + r.w / 2 + WALL_T)
          minZ = Math.min(minZ, r.cz - r.d / 2 - WALL_T)
          maxZ = Math.max(maxZ, r.cz + r.d / 2 + WALL_T)
        })
        if (!isFinite(minX)) {
          minX = 0
          maxX = 4
          minZ = 0
          maxZ = 3
        }
        return { minX, maxX, minZ, maxZ }
      }

      /* 门 / 窗平面图例：按墙带方向画开口和符号 */
      function drawPlanOpening(ctx, o, room, box, s, paper) {
        const isWin = o.kind === 'window'
        const span = o.side === 'left' ? room.d : room.w
        const ow = clamp(numOr(o.w, isWin ? WIN_W : DOOR_W), 0.3, Math.max(0.4, span - 0.3))
        const half = ow / 2
        const line = (x1, y1, x2, y2) => {
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }
        ctx.strokeStyle = '#5d5548'
        ctx.lineWidth = 1.1
        if (o.side === 'left') {
          const inner = box.px(room.cx - room.w / 2)
          const outer = box.px(room.cx - room.w / 2 - WALL_T)
          const za = box.pz(room.cz + o.u - half)
          const zb = box.pz(room.cz + o.u + half)
          ctx.fillStyle = paper
          ctx.fillRect(outer, za, inner - outer, zb - za)
          if (isWin) {
            const m1 = outer + (inner - outer) * 0.34
            const m2 = outer + (inner - outer) * 0.66
            line(m1, za, m1, zb)
            line(m2, za, m2, zb)
            line(outer, za, inner, za)
            line(outer, zb, inner, zb)
          } else if (ow > 0.15) {
            line(inner, za, box.px(room.cx - room.w / 2 + ow), za)
            ctx.beginPath()
            ctx.arc(inner, za, ow * s, 0, Math.PI / 2)
            ctx.stroke()
          }
        } else {
          const inner = box.pz(room.cz - room.d / 2)
          const outer = box.pz(room.cz - room.d / 2 - WALL_T)
          const xa = box.px(room.cx + o.u - half)
          const xb = box.px(room.cx + o.u + half)
          ctx.fillStyle = paper
          ctx.fillRect(xa, outer, xb - xa, inner - outer)
          if (isWin) {
            const m1 = outer + (inner - outer) * 0.34
            const m2 = outer + (inner - outer) * 0.66
            line(xa, m1, xb, m1)
            line(xa, m2, xb, m2)
            line(xa, outer, xa, inner)
            line(xb, outer, xb, inner)
          } else if (ow > 0.15) {
            line(xa, inner, xa, box.pz(room.cz - room.d / 2 + ow))
            ctx.beginPath()
            ctx.arc(xa, inner, ow * s, Math.PI / 2, 0, true)
            ctx.stroke()
          }
        }
      }


      /* 平面图里家具的主色：优先用户自定义色，否则取调色板第一个颜色 */
      function planTone(item, fallback) {
        if (item.tone) return item.tone
        const def = CATALOG[item.type]
        const pal = def && def.palettes ? (def.palettes[item.palette] || def.palettes[0] || {}).c : null
        if (!pal) return fallback
        const keys = Object.keys(pal)
        for (let i = 0; i < keys.length; i++) {
          const v = pal[keys[i]]
          if (typeof v === 'string' && v.charAt(0) === '#') return v
        }
        return fallback
      }

      /* 把当前布置画成一张纯平面布置图：地面铺装、墙体、门窗、家具、房间标注、四边尺寸链 */
      function capturePreview() {
        const W = 1440
        const H = 1580
        const paper = '#fcfbf7'
        const ink = '#2f2a23'
        const muted = '#8b8070'
        const out = document.createElement('canvas')
        out.width = W
        out.height = H
        const ctx = out.getContext('2d')
        if (!ctx) return ''

        /* 图纸底，不画图框 / 页眉 / 标题栏，让平面图铺满画布 */
        ctx.fillStyle = paper
        ctx.fillRect(0, 0, W, H)

        const text = (str, x, y, font, color, align) => {
          str = tr(str)
          ctx.font = font
          ctx.fillStyle = color
          ctx.textAlign = align || 'left'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(str, x, y)
          ctx.textAlign = 'left'
        }
        const line = (x1, y1, x2, y2) => {
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
        }

        const bounds = planLayout(rooms)
        /* 平面图居中铺满画布，四周预留两条尺寸链的宽度 */
        const padX = 150
        const padY = 150
        const houseW = Math.max(0.5, bounds.maxX - bounds.minX)
        const houseD = Math.max(0.5, bounds.maxZ - bounds.minZ)
        const s = Math.min((W - padX * 2) / houseW, (H - padY * 2) / houseD)
        const ox = W / 2 - ((bounds.minX + bounds.maxX) / 2) * s
        const oy = H / 2 - ((bounds.minZ + bounds.maxZ) / 2) * s
        const box = {
          px: x => ox + x * s,
          pz: z => oy + z * s
        }

        /* 地面：按房间铺装色与材质（瓷砖 / 木地板）画出纹理 */
        rooms.forEach(room => {
          const st = (room.state && room.state.floor) || {}
          const tone = st.finishTone || st.tone || '#e3d9c6'
          const x = box.px(room.cx - room.w / 2)
          const y = box.pz(room.cz - room.d / 2)
          const w = room.w * s
          const d = room.d * s
          ctx.save()
          ctx.beginPath()
          ctx.rect(x, y, w, d)
          ctx.clip()
          ctx.fillStyle = tone
          ctx.fillRect(x, y, w, d)
          const cell = Math.max(5, (st.finishSize || 0.3) * s)
          ctx.lineWidth = 1
          if (st.finish === 'tile') {
            ctx.strokeStyle = withAlpha(shade(tone, -0.45), 0.28)
            for (let gx = x + cell; gx < x + w - 0.5; gx += cell) line(gx, y, gx, y + d)
            for (let gy = y + cell; gy < y + d - 0.5; gy += cell) line(x, gy, x + w, gy)
          } else if (st.finish === 'wood') {
            ctx.strokeStyle = withAlpha(shade(tone, -0.4), 0.26)
            const row = Math.max(6, cell)
            let idx = 0
            for (let gy = y; gy < y + d - 0.5; gy += row) {
              line(x, gy, x + w, gy)
              const off = idx % 2 === 0 ? row * 1.5 : 0
              for (let gx = x + off + row * 4; gx < x + w - 0.5; gx += row * 8) line(gx, gy, gx, Math.min(y + d, gy + row))
              idx++
            }
          }
          ctx.restore()
        })

        /* 家具俯视符号：颜色取自家具调色板，按类型画大概形体 */
        const drawItem = (item, fw, fd) => {
          const base = planTone(item, '#c9bba4')
          const stroke = 'rgba(78, 68, 56, 0.72)'
          const light = mix(base, '#ffffff', 0.55)
          const deep = shade(base, -0.26)
          const rect = (x, y, w, h, fill, outline) => {
            ctx.fillStyle = fill
            ctx.fillRect(x, y, w, h)
            if (outline !== false) {
              ctx.strokeStyle = outline || stroke
              ctx.lineWidth = 1
              ctx.strokeRect(x, y, w, h)
            }
          }
          /* type 是库里的具体型号（bed18 / sofa3…），符号统一按 model 分类绘制 */
          const def = CATALOG[item.type]
          const type = (def && def.model) || item.type
          if (type === 'rug') {
            ctx.fillStyle = withAlpha(base, 0.32)
            ctx.fillRect(-fw / 2, -fd / 2, fw, fd)
            ctx.setLineDash([5, 4])
            ctx.strokeStyle = withAlpha(deep, 0.8)
            ctx.strokeRect(-fw / 2, -fd / 2, fw, fd)
            ctx.setLineDash([])
            return
          }
          if (type === 'bed' || type === 'crib' || type === 'baycushion') {
            rect(-fw / 2, -fd / 2, fw, fd, light)
            rect(-fw / 2 + 1.5, -fd / 2 + 1.5, fw - 3, fd - 3, '#fbf9f4')
            const pw = fw * 0.36
            const ph = Math.max(5, fd * 0.15)
            rect(-fw / 2 + fw * 0.08, -fd / 2 + fd * 0.05, pw, ph, '#ffffff', 'rgba(120,110,96,0.55)')
            rect(fw / 2 - fw * 0.08 - pw, -fd / 2 + fd * 0.05, pw, ph, '#ffffff', 'rgba(120,110,96,0.55)')
            ctx.fillStyle = withAlpha(base, 0.55)
            ctx.fillRect(-fw / 2 + 3, -fd / 2 + fd * 0.32, fw - 6, fd * 0.62)
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.strokeRect(-fw / 2 + 3, -fd / 2 + fd * 0.32, fw - 6, fd * 0.62)
            return
          }
          if (type === 'beanbag') {
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.44, 0, Math.PI * 2)
            ctx.fillStyle = withAlpha(base, 0.9)
            ctx.fill()
            ctx.strokeStyle = withAlpha(deep, 0.6)
            ctx.lineWidth = 1
            ctx.stroke()
            return
          }
          if (type === 'sofa' || type === 'armchair' || type === 'readingchair' || type === 'cornersofa') {
            rect(-fw / 2, -fd / 2, fw, fd, withAlpha(base, 0.72))
            rect(-fw / 2, -fd / 2, fw, fd * 0.24, withAlpha(base, 0.95))
            const armW = Math.max(3, fw * 0.05)
            rect(-fw / 2, -fd / 2, armW, fd, withAlpha(deep, 0.32))
            rect(fw / 2 - armW, -fd / 2, armW, fd, withAlpha(deep, 0.32))
            const seats = type === 'cornersofa' ? 3 : fw > 1.5 ? 3 : fw > 1 ? 2 : 1
            const innerW = fw - 4 - armW * 2
            const cw = innerW / seats
            for (let i = 0; i < seats; i++) {
              rect(-fw / 2 + 2 + armW + i * cw, -fd / 2 + fd * 0.26, cw, fd * 0.66, withAlpha(light, 0.9))
            }
            if (type === 'cornersofa') {
              /* 转角沙发：末端加一段贵妃位 */
              rect(-fw / 2, fd / 2 - fd * 0.3, fw * 0.45, fd * 0.3, withAlpha(light, 0.92))
            }
            return
          }
          if (type === 'roundtable') {
            const r = Math.min(fw, fd) * 0.46
            ctx.beginPath()
            ctx.arc(0, 0, r, 0, Math.PI * 2)
            ctx.fillStyle = withAlpha(base, 0.9)
            ctx.fill()
            ctx.strokeStyle = withAlpha(deep, 0.55)
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2)
            ctx.stroke()
            const cr = Math.min(9, r * 0.3)
            const spots = [[0, -1], [0, 1], [-1, 0], [1, 0]]
            spots.forEach(p => {
              ctx.fillStyle = withAlpha(deep, 0.55)
              ctx.fillRect(p[0] ? (p[0] > 0 ? r + 2 : -r - 2 - cr) : -cr / 2, p[1] ? (p[1] > 0 ? r + 2 : -r - 2 - cr) : -cr / 2, cr, cr)
            })
            return
          }
          if (type === 'table' || type === 'desk' || type === 'coffeetable' || type === 'sidetable' || type === 'island' || type === 'counter' || type === 'worktop') {
            rect(-fw / 2, -fd / 2, fw, fd, withAlpha(base, 0.85))
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.strokeRect(-fw / 2 + 3, -fd / 2 + 3, fw - 6, fd - 6)
            if (type === 'worktop' || type === 'counter' || type === 'island') {
              /* 台面：一侧画挡水 / 柜体进深线 */
              line(-fw / 2 + 2, -fd / 2 + fd * 0.24, fw / 2 - 2, -fd / 2 + fd * 0.24)
            }
            return
          }
          if (type === 'chair' || type === 'stool' || type === 'barstool' || type === 'officechair') {
            rect(-fw / 2, -fd / 2, fw, fd, withAlpha(base, 0.85))
            ctx.fillStyle = withAlpha(deep, 0.75)
            ctx.fillRect(-fw / 2, -fd / 2, fw, Math.max(2, fd * 0.2))
            return
          }
          if (type === 'plant') {
            ctx.fillStyle = mix(base, '#5f8f6a', 0.6)
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.42, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = withAlpha(shade('#4f7f5a', -0.2), 0.7)
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.beginPath()
            for (let i = 0; i < 6; i++) {
              const a = (i / 6) * Math.PI * 2
              ctx.moveTo(Math.cos(a) * 2, Math.sin(a) * 2)
              ctx.lineTo(Math.cos(a) * Math.min(fw, fd) * 0.4, Math.sin(a) * Math.min(fw, fd) * 0.4)
            }
            ctx.stroke()
            return
          }
          if (type === 'lamp' || type === 'floorlamp') {
            ctx.strokeStyle = withAlpha(deep, 0.85)
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.42, 0, Math.PI * 2)
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.2, 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'tv') {
            /* 壁挂电视：贴墙的细黑条 */
            ctx.fillStyle = 'rgba(43, 51, 58, 0.9)'
            ctx.fillRect(-fw / 2, -Math.max(3, fd / 2), fw, Math.max(6, fd))
            return
          }
          if (type === 'fridge') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f2f1ec')
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            line(-fw / 2 + 2, 0, fw / 2 - 2, 0)
            ctx.fillStyle = withAlpha(deep, 0.3)
            ctx.fillRect(-fw / 2 + fw * 0.14, -fd / 2 + 3, 2, fd - 6)
            return
          }
          if (type === 'washer' || type === 'dryer' || type === 'dishwasher') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f2f1ec')
            ctx.strokeStyle = withAlpha(deep, 0.55)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.34, 0, Math.PI * 2)
            ctx.stroke()
            ctx.beginPath()
            ctx.arc(0, 0, Math.min(fw, fd) * 0.2, 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'stove') {
            rect(-fw / 2, -fd / 2, fw, fd, '#eceff1')
            ctx.strokeStyle = 'rgba(58, 58, 58, 0.7)'
            ctx.lineWidth = 1
            const br = Math.min(fw, fd) * 0.15
            const burners = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
            burners.forEach(p => {
              ctx.beginPath()
              ctx.arc(p[0] * fw * 0.22, p[1] * fd * 0.24, br, 0, Math.PI * 2)
              ctx.stroke()
            })
            return
          }
          if (type === 'ksink') {
            rect(-fw / 2, -fd / 2, fw, fd, '#e9edf0')
            rect(-fw / 2 + fw * 0.1, -fd / 2 + fd * 0.18, fw * 0.8, fd * 0.64, '#f8fbfc')
            ctx.strokeStyle = withAlpha(deep, 0.6)
            ctx.lineWidth = 1
            line(0, -fd / 2 + fd * 0.18, 0, -fd / 2 + fd * 0.34)
            return
          }
          if (type === 'vanity') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f1f1ee')
            ctx.strokeStyle = withAlpha(deep, 0.45)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(0, fd * 0.02, fw * 0.3, fd * 0.26, 0, 0, Math.PI * 2)
            ctx.stroke()
            line(-fw * 0.3, -fd * 0.26, -fw * 0.3, -fd * 0.04)
            return
          }
          if (type === 'toilet') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f7f7f4')
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(0, fd * 0.1, fw * 0.4, fd * 0.3, 0, 0, Math.PI * 2)
            ctx.stroke()
            rect(-fw / 2 + fw * 0.08, -fd / 2 + 1.5, fw * 0.84, fd * 0.18, '#fbfbf9')
            return
          }
          if (type === 'squattoilet') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f4f5f3')
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(0, fd * 0.06, fw * 0.28, fd * 0.3, 0, 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'shower' || type === 'showerset') {
            ctx.fillStyle = withAlpha(mix(base, '#dbe7ea', 0.7), 0.7)
            ctx.fillRect(-fw / 2, -fd / 2, fw, fd)
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.strokeRect(-fw / 2, -fd / 2, fw, fd)
            line(-fw / 2 + 3, -fd / 2 + 3, fw / 2 - 3, fd / 2 - 3)
            line(-fw / 2 + 3, fd / 2 - 3, fw / 2 - 3, -fd / 2 + 3)
            ctx.beginPath()
            ctx.arc(fw * 0.3, -fd * 0.3, Math.max(2.5, Math.min(fw, fd) * 0.07), 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'bathtub') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f2f6f7')
            ctx.strokeStyle = withAlpha(deep, 0.5)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(0, 0, fw * 0.4, fd * 0.36, 0, 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'waterheater') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f4f4f2')
            ctx.strokeStyle = withAlpha(deep, 0.45)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.ellipse(0, 0, fw * 0.3, fd * 0.3, 0, 0, Math.PI * 2)
            ctx.stroke()
            return
          }
          if (type === 'aircon' || type === 'acwall' || type === 'purifier') {
            rect(-fw / 2, -fd / 2, fw, fd, '#f5f6f7')
            ctx.strokeStyle = withAlpha(deep, 0.4)
            ctx.lineWidth = 1
            const rows = type === 'purifier' ? 2 : 3
            for (let i = 1; i <= rows; i++) line(-fw / 2 + 3, -fd / 2 + (fd / (rows + 1)) * i, fw / 2 - 3, -fd / 2 + (fd / (rows + 1)) * i)
            return
          }
          if (type === 'piano') {
            rect(-fw / 2, -fd / 2, fw, fd, '#262523')
            ctx.fillStyle = '#f6f4ef'
            ctx.fillRect(-fw / 2 + 2, fd / 2 - Math.max(4, fd * 0.22), fw - 4, Math.max(3, fd * 0.18))
            return
          }
          if (type === 'treadmill') {
            rect(-fw / 2, -fd / 2, fw, fd, '#3a3a3c')
            ctx.fillStyle = '#242426'
            ctx.fillRect(-fw / 2 + 3, -fd / 2 + fd * 0.2, fw - 6, fd * 0.6)
            ctx.fillStyle = '#8b8f93'
            ctx.fillRect(-fw / 2 + 3, -fd / 2 + 2, fw - 6, Math.max(2, fd * 0.06))
            return
          }
          if (type === 'column') {
            ctx.fillStyle = '#605a52'
            ctx.fillRect(-fw / 2, -fd / 2, fw, fd)
            return
          }
          if (type === 'cabinet' || type === 'shelf' || type === 'bookshelf' || type === 'wardrobe' || type === 'shoecab' || type === 'tvstand' || type === 'dresser' || type === 'nightstand' || type === 'ovencol' || type === 'storagecab' || type === 'mirror') {
            rect(-fw / 2, -fd / 2, fw, fd, withAlpha(base, 0.88))
            ctx.strokeStyle = withAlpha(deep, 0.55)
            ctx.lineWidth = 1
            const n = type === 'wardrobe' ? 3 : type === 'tvstand' ? 2 : 0
            if (n) for (let i = 1; i < n; i++) line(-fw / 2 + (fw / n) * i, -fd / 2, -fw / 2 + (fw / n) * i, fd / 2)
            if (type !== 'dresser' && type !== 'nightstand' && type !== 'mirror') {
              ctx.setLineDash([4, 3])
              line(-fw / 2, 0, fw / 2, 0)
              ctx.setLineDash([])
            }
            if (type === 'dresser' || type === 'mirror') {
              ctx.beginPath()
              ctx.ellipse(0, 0, fw * 0.26, fd * 0.26, 0, 0, Math.PI * 2)
              ctx.stroke()
            }
            return
          }
          rect(-fw / 2, -fd / 2, fw, fd, withAlpha(base, 0.55))
        }

        /* 家具平面投影：先画家具、后压墙体，靠墙家具会被墙带裁住，不会盖到墙上 */
        const furnLabels = []
        rooms.forEach(room => {
          ctx.save()
          ctx.beginPath()
          ctx.rect(box.px(room.cx - room.w / 2), box.pz(room.cz - room.d / 2), room.w * s, room.d * s)
          ctx.clip()
          room.placed.forEach(item => {
            const dims = itemDims(item)
            ctx.save()
            ctx.translate(box.px(room.cx + (item.wx || 0)), box.pz(room.cz + (item.wz || 0)))
            ctx.rotate(-THREE.MathUtils.degToRad(item.rotY || 0))
            const fw = Math.max(2, dims.w * s)
            const fd = Math.max(2, dims.d * s)
            drawItem(item, fw, fd)
            ctx.restore()
            const itemDef = CATALOG[item.type]
            const model = (itemDef && itemDef.model) || item.type
            const label = (itemDef && itemDef.name) || item.name || ''
            /* 小件不标注，避免小房间（浴室）里文字互相压住 */
            if (label && model !== 'rug' && model !== 'column' && Math.min(fw, fd) >= 30 && dims.w * dims.d >= 0.5) {
              furnLabels.push({
                x: box.px(room.cx + (item.wx || 0)),
                y: box.pz(room.cz + (item.wz || 0)),
                name: label
              })
            }
          })
          ctx.restore()
        })

        /* 墙体：房间自带后墙 / 左墙；外侧再补右墙 / 前墙，围合出完整户型轮廓 */
        ctx.fillStyle = '#605a52'
        const near = (a, b) => Math.abs(a - b) < 0.06
        const hasRightNeighbor = room => rooms.some(other => {
          if (other === room) return false
          if (!near(other.cx - other.w / 2, room.cx + room.w / 2)) return false
          return Math.min(other.cz + other.d / 2, room.cz + room.d / 2) - Math.max(other.cz - other.d / 2, room.cz - room.d / 2) > 0.05
        })
        const hasFrontNeighbor = room => rooms.some(other => {
          if (other === room) return false
          if (!near(other.cz - other.d / 2, room.cz + room.d / 2)) return false
          return Math.min(other.cx + other.w / 2, room.cx + room.w / 2) - Math.max(other.cx - other.w / 2, room.cx - room.w / 2) > 0.05
        })
        rooms.forEach(room => {
          const left = room.cx - room.w / 2
          const right = room.cx + room.w / 2
          const top = room.cz - room.d / 2
          const bottom = room.cz + room.d / 2
          /* 后墙 + 左墙 */
          ctx.fillRect(box.px(left), box.pz(top - WALL_T), room.w * s, WALL_T * s)
          ctx.fillRect(box.px(left - WALL_T), box.pz(top), WALL_T * s, room.d * s)
          /* 后墙与左墙的转角补齐 */
          ctx.fillRect(box.px(left - WALL_T), box.pz(top - WALL_T), WALL_T * s, WALL_T * s)
          /* 只有临空的一侧才补外墙，避免与相邻房间的墙重叠 */
          const openRight = !hasRightNeighbor(room)
          const openFront = !hasFrontNeighbor(room)
          if (openRight) ctx.fillRect(box.px(right), box.pz(top), WALL_T * s, room.d * s)
          if (openFront) ctx.fillRect(box.px(left), box.pz(bottom), room.w * s, WALL_T * s)
          if (openRight && openFront) ctx.fillRect(box.px(right), box.pz(bottom), WALL_T * s, WALL_T * s)
        })

        /* 门窗开口与符号 */
        rooms.forEach(room => {
          room.openings.forEach(o => drawPlanOpening(ctx, o, room, box, s, paper))
        })

        /* 家具名称：水平书写，不随家具旋转；白色描边保证压在家具上也看得清 */
        ctx.font = planFont(15, 500)
        ctx.textAlign = 'center'
        ctx.lineWidth = 3.2
        ctx.strokeStyle = 'rgba(252, 251, 247, 0.88)'
        furnLabels.forEach(l => {
          const name = tr(l.name)
          ctx.strokeText(name, l.x, l.y + 4)
          ctx.fillStyle = '#6b6154'
          ctx.fillText(name, l.x, l.y + 4)
        })
        ctx.textAlign = 'left'

        /* 房间名称与面积 */
        rooms.forEach(room => {
          const labelSize = Math.min(22, Math.max(13, Math.min(room.w, room.d) * s * 0.17))
          const cx = box.px(room.cx)
          const cz = box.pz(room.cz)
          ctx.font = planFont(labelSize, 600)
          ctx.textAlign = 'center'
          ctx.lineWidth = 4
          ctx.strokeStyle = 'rgba(252, 251, 247, 0.92)'
          const roomLabel = tr(room.name)
          ctx.strokeText(roomLabel, cx, cz - 2)
          ctx.fillStyle = '#2f2a23'
          ctx.fillText(roomLabel, cx, cz - 2)
          const area = (room.w * room.d).toFixed(2) + ' m²'
          ctx.font = planFont(Math.max(11, labelSize - 8), 500)
          ctx.strokeText(area, cx, cz + labelSize * 0.95)
          ctx.fillStyle = '#6f6558'
          ctx.fillText(area, cx, cz + labelSize * 0.95)
          ctx.textAlign = 'left'
        })

        /* 尺寸链：按房间边界分段标注，外侧再叠一道总尺寸 */
        const uniq = list => {
          const result = []
          list.slice().sort((a, b) => a - b).forEach(v => {
            if (!result.length || Math.abs(v - result[result.length - 1]) > 0.02) result.push(v)
          })
          return result
        }
        /* 每条边只用贴着这条边的房间边界，分段尺寸才能加总到总尺寸 */
        const edgeXs = edgeZ => {
          const picks = rooms.filter(r => Math.abs(r.cz - r.d / 2 - edgeZ) < 0.02 || Math.abs(r.cz + r.d / 2 - edgeZ) < 0.02)
          const list = [bounds.minX, bounds.maxX]
          picks.forEach(r => list.push(r.cx - r.w / 2, r.cx + r.w / 2))
          return uniq(list)
        }
        const edgeZs = edgeX => {
          const picks = rooms.filter(r => Math.abs(r.cx - r.w / 2 - edgeX) < 0.02 || Math.abs(r.cx + r.w / 2 - edgeX) < 0.02)
          const list = [bounds.minZ, bounds.maxZ]
          picks.forEach(r => list.push(r.cz - r.d / 2, r.cz + r.d / 2))
          return uniq(list)
        }
        const xsTop = edgeXs(bounds.minZ + WALL_T)
        const xsBottom = edgeXs(bounds.maxZ - WALL_T)
        const zsLeft = edgeZs(bounds.minX + WALL_T)
        const zsRight = edgeZs(bounds.maxX - WALL_T)
        const mmText = v => String(Math.round(v * 1000))
        ctx.strokeStyle = '#9a8f7d'
        ctx.lineWidth = 1
        const tickH = (x, y) => line(x - 5, y + 5, x + 5, y - 5)
        const tickV = (x, y) => line(x - 5, y - 5, x + 5, y + 5)

        /* 水平尺寸链：above=true 画在户型上方 */
        const dimChainX = (coords, y, above) => {
          line(box.px(coords[0]), y, box.px(coords[coords.length - 1]), y)
          coords.forEach(v => {
            const x = box.px(v)
            tickH(x, y)
            line(x, y + (above ? 10 : -10), x, y + (above ? 26 : -26))
          })
          for (let i = 0; i < coords.length - 1; i++) {
            const a = box.px(coords[i])
            const b = box.px(coords[i + 1])
            const mid = (a + b) / 2
            const label = mmText(coords[i + 1] - coords[i])
            const ty = y + (above ? -8 : 20)
            if (b - a < 34) {
              ctx.save()
              ctx.translate(mid + 3, ty)
              ctx.rotate(above ? -Math.PI / 2 : Math.PI / 2)
              text(label, 0, 0, planFont(10, 500), '#5c5347', 'center')
              ctx.restore()
            } else {
              text(label, mid, ty, planFont(13, 500), '#5c5347', 'center')
            }
          }
        }
        const dimChainZ = (coords, x, left) => {
          line(x, box.pz(coords[0]), x, box.pz(coords[coords.length - 1]))
          coords.forEach(v => {
            const y = box.pz(v)
            tickV(x, y)
            line(x + (left ? 10 : -10), y, x + (left ? 26 : -26), y)
          })
          for (let i = 0; i < coords.length - 1; i++) {
            const a = box.pz(coords[i])
            const b = box.pz(coords[i + 1])
            const label = mmText(coords[i + 1] - coords[i])
            ctx.save()
            /* 竖向尺寸链的窄段也统一旋转，避免小字横躺压住刻度 */
            ctx.translate(x + (left ? -8 : 20), (a + b) / 2)
            ctx.rotate(-Math.PI / 2)
            text(label, 0, 0, planFont(b - a < 34 ? 10 : 13, 500), '#5c5347', 'center')
            ctx.restore()
          }
        }
        const dimTotalX = (span, y, above) => {
          line(box.px(span[0]), y, box.px(span[1]), y)
          tickH(box.px(span[0]), y)
          tickH(box.px(span[1]), y)
          text((span[1] - span[0]).toFixed(2) + ' m', (box.px(span[0]) + box.px(span[1])) / 2, y + (above ? -8 : 22), planFont(17, 600), '#3c352d', 'center')
        }
        const dimTotalZ = (span, x, left) => {
          line(x, box.pz(span[0]), x, box.pz(span[1]))
          tickV(x, box.pz(span[0]))
          tickV(x, box.pz(span[1]))
          ctx.save()
          ctx.translate(x + (left ? -10 : 24), (box.pz(span[0]) + box.pz(span[1])) / 2)
          ctx.rotate(-Math.PI / 2)
          text((span[1] - span[0]).toFixed(2) + ' m', 0, 0, planFont(17, 600), '#3c352d', 'center')
          ctx.restore()
        }

        const topEdge = box.pz(bounds.minZ)
        const bottomEdge = box.pz(bounds.maxZ)
        const leftEdge = box.px(bounds.minX)
        const rightEdge = box.px(bounds.maxX)
        dimChainX(xsTop, topEdge - 34, true)
        dimTotalX([bounds.minX, bounds.maxX], topEdge - 74, true)
        dimChainX(xsBottom, bottomEdge + 34, false)
        dimTotalX([bounds.minX, bounds.maxX], bottomEdge + 74, false)
        dimChainZ(zsLeft, leftEdge - 34, true)
        dimTotalZ([bounds.minZ, bounds.maxZ], leftEdge - 74, true)
        dimChainZ(zsRight, rightEdge + 34, false)
        dimTotalZ([bounds.minZ, bounds.maxZ], rightEdge + 74, false)

        return out.toDataURL('image/png')
      }

      /* ---------- 3D 机位截图：临时放大渲染尺寸取高清图，取完恢复现场 ---------- */
      function capture3DView(goal, focusRoomId) {
        if (!glRenderer || !glScene || !glCamera) return ''
        /* 竖幅取景，和 PDF 的 A4 竖版页面一致，图片能铺满正文区 */
        const W = 1260
        const H = 1680
        const saved = {
          theta: camState.theta, phi: camState.phi, radius: camState.radius,
          tx: camState.tx, ty: camState.ty, tz: camState.tz
        }
        const helperVisible = glBoxHelper ? glBoxHelper.visible : true
        if (glBoxHelper) glBoxHelper.visible = false
        camAnim = false
        /* 单间全景时只留这个房间的结构 / 家具 / 门窗，避免邻墙挡住视线 */
        const hidden = []
        if (focusRoomId) {
          const hideOthers = list => {
            list.forEach(node => {
              const rid = node.userData && node.userData.roomId
              if (rid && rid !== focusRoomId && node.visible) {
                node.visible = false
                hidden.push(node)
              }
            })
          }
          hideOthers(glRoom.children)
          hideOthers(glFurniture.children)
          hideOthers(glOpenings.children)
        }
        /* 场景默认透明（靠 CSS 背景），PDF 截图需要浅色底，避免透明处变黑 */
        const prevBg = glScene.background
        glScene.background = new THREE.Color('#f6f3ec')
        glRenderer.setSize(W, H, false)
        glCamera.aspect = W / H
        glCamera.updateProjectionMatrix()
        Object.assign(camState, goal)
        applyCamera()
        glRenderer.render(glScene, glCamera)
        const url = glRenderer.domElement.toDataURL('image/jpeg', 0.92)
        Object.assign(camState, saved)
        Object.assign(camGoal, saved)
        hidden.forEach(node => { node.visible = true })
        if (glBoxHelper) glBoxHelper.visible = helperVisible
        glScene.background = prevBg
        glResize()
        applyCamera()
        return url
      }

      /* 正俯视：相机几乎垂直向下，取景按 1260×1680 竖幅算 */
      function topDownGoal() {
        const box = houseBounds()
        const tanV = Math.tan(THREE.MathUtils.degToRad(glCamera.fov / 2))
        const aspect = 1260 / 1680
        const rV = (box.d / 2) / (0.86 * tanV)
        const rH = (box.w / 2) / (0.86 * tanV * aspect)
        return {
          theta: 0,
          phi: 0.03,
          radius: clamp(Math.max(rV, rH) + 1.4, CAM_LIMIT.minR, CAM_LIMIT.maxR),
          tx: box.cx,
          ty: 1.0,
          tz: box.cz
        }
      }

      /* 各房间 3D 全景：只留本房间，按房间尺寸取 3/4 俯视角 */
      function roomShotGoal(room) {
        const tanV = Math.tan(THREE.MathUtils.degToRad(glCamera.fov / 2))
        const aspect = 1260 / 1680
        const span = Math.hypot(room.w, room.d)
        const rV = (span * 0.5) / (0.82 * tanV)
        const rH = (span * 0.5) / (0.82 * tanV * aspect)
        return {
          theta: 0.52,
          phi: 1.0,
          radius: clamp(Math.max(rV, rH) * 0.85 + 0.8, 3.6, CAM_LIMIT.maxR),
          tx: room.cx,
          ty: 1.2,
          tz: room.cz
        }
      }

      /* ---------- 导出 PDF：2D 平面图 + 3D 正俯视 + 每个房间一页 3D 全景 ---------- */
      function pdfLoadImage(src) {
        return new Promise(resolve => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = src
        })
      }

      function pdfPageImage(img, title, subtitle, pageNo, total) {
        const PW = 1240
        const PH = 1754
        const c = document.createElement('canvas')
        c.width = PW
        c.height = PH
        const g = c.getContext('2d')
        g.fillStyle = '#ffffff'
        g.fillRect(0, 0, PW, PH)
        g.textAlign = 'left'
        g.fillStyle = '#2f2a23'
        g.font = planFont(36, 700)
        g.fillText(tr(title), 80, 116)
        g.fillStyle = '#8b8070'
        g.font = planFont(15, 500)
        g.fillText(tr(subtitle), 82, 148)
        g.strokeStyle = '#d9d2c4'
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(80, 176)
        g.lineTo(PW - 80, 176)
        g.stroke()
        const bx = 70
        const by = 200
        const bw = PW - 140
        const bh = PH - 286
        const scale = Math.min(bw / img.width, bh / img.height)
        const iw = img.width * scale
        const ih = img.height * scale
        g.drawImage(img, bx + (bw - iw) / 2, by + (bh - ih) / 2, iw, ih)
        g.fillStyle = '#b3a898'
        g.font = planFont(12, 500)
        g.fillText(tr('农民房改造 · 平面方案'), 80, PH - 48)
        g.textAlign = 'right'
        g.fillText(pageNo + ' / ' + total, PW - 80, PH - 48)
        return c
      }

      function pdfDataToBytes(url) {
        const bin = atob(url.split(',')[1])
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
      }

      /* 手写最小 PDF：每页一张 A4 满版 JPEG，不引第三方库 */
      function buildPdf(pages) {
        const enc = new TextEncoder()
        const chunks = []
        let total = 0
        const push = data => {
          const bytes = typeof data === 'string' ? enc.encode(data) : data
          chunks.push(bytes)
          total += bytes.length
        }
        const objCount = 2 + pages.length * 3
        const offsets = new Array(objCount + 1).fill(0)
        const mark = num => { offsets[num] = total }
        const PW = 595
        const PH = 842
        push('%PDF-1.4\n')
        mark(1)
        push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
        mark(2)
        const kids = pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ')
        push('2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>\nendobj\n')
        pages.forEach((page, i) => {
          const pageNum = 3 + i * 3
          const contentNum = pageNum + 1
          const imageNum = pageNum + 2
          mark(pageNum)
          push(pageNum + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH +
            '] /Resources << /XObject << /Im0 ' + imageNum + ' 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ' +
            contentNum + ' 0 R >>\nendobj\n')
          const stream = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q'
          mark(contentNum)
          push(contentNum + ' 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream\nendobj\n')
          mark(imageNum)
          push(imageNum + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + page.w + ' /Height ' + page.h +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.bytes.length +
            ' >>\nstream\n')
          push(page.bytes)
          push('\nendstream\nendobj\n')
        })
        const xref = total
        let table = 'xref\n0 ' + (objCount + 1) + '\n0000000000 65535 f \n'
        for (let i = 1; i <= objCount; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
        push(table)
        push('trailer\n<< /Size ' + (objCount + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
        return new Blob(chunks, { type: 'application/pdf' })
      }

      async function downloadPlanPdf() {
        if (!glReady) {
          showToast('3D 场景还在加载')
          return
        }
        showToast('正在生成 PDF…')
        const views = [
          { src: capturePreview(), title: '平面布置图', subtitle: '2D FLOOR PLAN' },
          { src: capture3DView(topDownGoal()), title: '3D 正俯视图', subtitle: '3D TOP VIEW' }
        ]
        rooms.forEach(room => {
          views.push({
            src: capture3DView(roomShotGoal(room), room.id),
            title: room.name + ' · 3D 全景',
            subtitle: '3D ROOM VIEW'
          })
        })
        const validViews = views.filter(view => !!view.src)
        const pages = []
        for (let i = 0; i < validViews.length; i++) {
          const img = await pdfLoadImage(validViews[i].src)
          if (!img) continue
          const canvas = pdfPageImage(img, validViews[i].title, validViews[i].subtitle, pages.length + 1, validViews.length)
          const url = canvas.toDataURL('image/jpeg', 0.95)
          pages.push({ bytes: pdfDataToBytes(url), w: canvas.width, h: canvas.height })
        }
        if (!pages.length) {
          showToast('PDF 生成失败，请重试')
          return
        }
        const blob = buildPdf(pages)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'my-home-plan-' + fileStamp() + '.pdf'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 4000)
        showToast('已导出 PDF（2D + 各房间 3D）')
      }

      function blurActiveInput() {
        const el = document.activeElement
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.blur === 'function') el.blur()
      }

      function closeShare() {
        shareMode = ''
        blurActiveInput()
        if (shareMask) shareMask.classList.remove('is-open')
      }

      function openShare(mode) {
        if (!shareMask) return
        blurActiveInput()
        shareMode = mode
        shareCode = ''
        sharePreview = ''
        shareMask.classList.add('is-open')
        if (mode === 'export') renderShareExport()
        else if (mode === 'diy-export') renderDiyExport()
        else if (mode === 'diy-import') renderDiyImport()
        else renderShareImport()
      }

      function renderShareExport() {
        if (shareTitle) shareTitle.textContent = '导出布置'
        sharePreview = capturePreview()
        const roomCount = rooms.length
        const furnCount = rooms.reduce((n, room) => n + room.placed.length, 0)
        const openCount = rooms.reduce((n, room) => n + room.openings.length, 0)
        shareBody.innerHTML =
          '<div class="share-preview">' +
            (sharePreview
              ? '<img src="' + sharePreview + '" alt="房间预览" />'
              : '<span class="share-preview-tip">3D 场景准备中…</span>') +
          '</div>' +
          '<div class="share-stats">' +
            '<span><b>' + roomCount + '</b>房间</span>' +
            '<span><b>' + furnCount + '</b>家具</span>' +
            '<span><b>' + openCount + '</b>门窗</span>' +
          '</div>' +
          '<div class="share-actions">' +
            '<span class="share-btn share-btn--main" data-share="copy">复制分享码</span>' +
            '<span class="share-btn" data-share="pack">保存分享包</span>' +
            '<span class="share-btn" data-share="pdf">保存 PDF</span>' +
          '</div>' +
          '<div class="share-code" id="shareCode">正在生成分享码…</div>' +
          '<div class="share-tip">分享包是一个 zip，内含分享码文本和预览图。对方在「导入布置」粘贴分享码即可还原整套农民房。</div>'
        packShareCode().then(code => {
          if (shareMode !== 'export') return
          shareCode = code
          const codeEl = document.getElementById('shareCode')
          if (codeEl) codeEl.textContent = code
        }).catch(() => {
          const codeEl = document.getElementById('shareCode')
          if (codeEl) codeEl.textContent = '分享码生成失败，请关闭后重试'
        })
      }

      function renderShareImport() {
        if (shareTitle) shareTitle.textContent = '导入布置'
        shareBody.innerHTML =
          '<div class="share-label">粘贴分享码</div>' +
          '<textarea class="share-input" id="shareInput" placeholder="MYHOME1:..."></textarea>' +
          '<div class="share-actions">' +
            '<span class="share-btn share-btn--main" data-share="code">导入分享码</span>' +
          '</div>' +
          '<div class="share-tip">分享码由「导出布置 → 复制分享码 / 保存分享包」获得；导入会替换当前改造方案，并清空撤销记录。</div>'
      }

      /* ---------- DIY 作品库导出 / 导入 ---------- */
      function renderDiyExport() {
        if (shareTitle) shareTitle.textContent = '导出作品库'
        const blockCount = diyWorks.reduce((n, work) => n + work.parts.length, 0)
        const cards = diyWorks.slice(0, 9).map(work =>
          '<div class="diy-share-item">' +
            '<div class="diy-share-art">' + diyArtHTML(work.parts) + '</div>' +
            '<span>' + escapeHTML(work.name) + '</span>' +
          '</div>'
        ).join('')
        shareBody.innerHTML =
          '<div class="share-preview share-preview--works">' +
            (diyWorks.length ? cards : '<span class="share-preview-tip">作品库还是空的</span>') +
          '</div>' +
          '<div class="share-stats">' +
            '<span><b>' + diyWorks.length + '</b>作品</span>' +
            '<span><b>' + blockCount + '</b>体块</span>' +
          '</div>' +
          '<div class="share-actions">' +
            '<span class="share-btn share-btn--main" data-share="copy">复制分享码</span>' +
            '<span class="share-btn" data-share="diy-file">保存作品库</span>' +
          '</div>' +
          '<div class="share-code" id="shareCode">正在生成分享码…</div>' +
          '<div class="share-tip">作品库分享码包含所有自制家具。对方在「制作家具 → 导入作品库」粘贴即可合并到自己的作品库。</div>'
        packDiyCode().then(code => {
          if (shareMode !== 'diy-export') return
          shareCode = code
          const codeEl = document.getElementById('shareCode')
          if (codeEl) codeEl.textContent = code
        }).catch(() => {
          const codeEl = document.getElementById('shareCode')
          if (codeEl) codeEl.textContent = '分享码生成失败，请关闭后重试'
        })
      }

      function renderDiyImport() {
        if (shareTitle) shareTitle.textContent = '导入作品库'
        shareBody.innerHTML =
          '<div class="share-label">粘贴作品库分享码</div>' +
          '<textarea class="share-input" id="shareInput" placeholder="MYDIY1:..."></textarea>' +
          '<div class="share-actions">' +
            '<span class="share-btn share-btn--main" data-share="diy-code">导入作品库</span>' +
          '</div>' +
          '<div class="share-tip">导入只会把作品合并进作品库，不会改动当前的改造方案。</div>'
      }

      function applyDiyLibrary(raw) {
        if (!raw || !Array.isArray(raw.works) || !raw.works.length) throw new Error('bad library')
        const incoming = raw.works.slice(0, 60).map(normalizeDiyWork).filter(Boolean)
        if (!incoming.length) throw new Error('bad library')
        let added = 0
        incoming.forEach(work => {
          const index = diyWorks.findIndex(item => item.id === work.id)
          if (index >= 0) diyWorks[index] = work
          else {
            diyWorks.unshift(work)
            added++
          }
        })
        diyWorks = diyWorks.slice(0, 60)
        saveDiyWorks()
        renderSheet()
        closeShare()
        showToast(added ? '已导入 ' + added + ' 件作品' : '作品库已是最新')
      }

      async function importDiyFromCode() {
        const input = document.getElementById('shareInput')
        const text = input ? input.value : ''
        if (!String(text).trim()) {
          showToast('先粘贴作品库分享码')
          return
        }
        try {
          applyDiyLibrary(await unpackShareCode(text))
        } catch (err) {
          const reason = err && err.message
          if (reason === 'prefix') showToast('格式不对：请粘贴 MYDIY1: 开头的分享码')
          else if (reason === 'broken') showToast('分享码不完整，请重新完整复制')
          else showToast('导入失败：分享码里没有可用作品')
        }
      }

      function downloadDiyPack() {
        const stamp = fileStamp()
        const bytes = new TextEncoder().encode(JSON.stringify({
          app: 'my-home-diy',
          version: 1,
          exportedAt: new Date().toISOString(),
          works: diyLibrarySnapshot()
        }, null, 2))
        const blob = new Blob([bytes], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'my-home-diy-' + stamp + '.json'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1500)
        showToast('已保存作品库文件')
      }

      function copyShareCode() {
        if (!shareCode) {
          showToast('分享码还在生成')
          return
        }
        const codeEl = document.getElementById('shareCode')
        const selectCode = () => {
          const sel = window.getSelection()
          if (!codeEl || !sel) return false
          const range = document.createRange()
          range.selectNodeContents(codeEl)
          sel.removeAllRanges()
          sel.addRange(range)
          return true
        }
        /* 手机多为 http 局域网，clipboard API 不可用；直接选中可见文字再 execCommand 最稳 */
        const fallback = () => {
          const selected = selectCode()
          let ok = false
          if (selected) {
            try { ok = document.execCommand('copy') } catch (err) { ok = false }
          }
          if (ok) showToast('分享码已复制')
          else showToast('已选中分享码，请点「拷贝」')
        }
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareCode)
            .then(() => showToast('分享码已复制'))
            .catch(fallback)
        } else {
          fallback()
        }
      }

      /* 极简 zip（store 不压缩），只为实现“分享码文本 + 预览图”打包 */
      let crcTable = null

      function crc32(bytes) {
        if (!crcTable) {
          crcTable = new Uint32Array(256)
          for (let i = 0; i < 256; i++) {
            let c = i
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
            crcTable[i] = c >>> 0
          }
        }
        let crc = -1
        for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff]
        return (crc ^ -1) >>> 0
      }

      function zipStore(files) {
        const now = new Date()
        const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
        const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
        const chunks = []
        const central = []
        let offset = 0
        files.forEach(file => {
          const nameBytes = new TextEncoder().encode(file.name)
          const crc = crc32(file.data)
          const local = new Uint8Array(30 + nameBytes.length)
          const lv = new DataView(local.buffer)
          lv.setUint32(0, 0x04034b50, true)
          lv.setUint16(4, 20, true)
          lv.setUint16(6, 0x0800, true)
          lv.setUint16(10, time, true)
          lv.setUint16(12, date, true)
          lv.setUint32(14, crc, true)
          lv.setUint32(18, file.data.length, true)
          lv.setUint32(22, file.data.length, true)
          lv.setUint16(26, nameBytes.length, true)
          local.set(nameBytes, 30)
          chunks.push(local, file.data)

          const cd = new Uint8Array(46 + nameBytes.length)
          const cv = new DataView(cd.buffer)
          cv.setUint32(0, 0x02014b50, true)
          cv.setUint16(4, 20, true)
          cv.setUint16(6, 20, true)
          cv.setUint16(8, 0x0800, true)
          cv.setUint16(12, time, true)
          cv.setUint16(14, date, true)
          cv.setUint32(16, crc, true)
          cv.setUint32(20, file.data.length, true)
          cv.setUint32(24, file.data.length, true)
          cv.setUint16(28, nameBytes.length, true)
          cv.setUint32(42, offset, true)
          cd.set(nameBytes, 46)
          central.push(cd)
          offset += local.length + file.data.length
        })
        const cdSize = central.reduce((n, c) => n + c.length, 0)
        const end = new Uint8Array(22)
        const ev = new DataView(end.buffer)
        ev.setUint32(0, 0x06054b50, true)
        ev.setUint16(8, files.length, true)
        ev.setUint16(10, files.length, true)
        ev.setUint32(12, cdSize, true)
        ev.setUint32(16, offset, true)
        const all = chunks.concat(central, [end])
        const total = all.reduce((n, c) => n + c.length, 0)
        const out = new Uint8Array(total)
        let pos = 0
        all.forEach(part => {
          out.set(part, pos)
          pos += part.length
        })
        return out
      }

      function dataUrlBytes(dataUrl) {
        const bin = atob(String(dataUrl).split(',')[1] || '')
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        return bytes
      }

      /* 下载分享包：zip 内含分享码文本 + 预览图 */
      async function downloadSharePack() {
        if (!sharePreview) {
          showToast('预览图还在生成')
          return
        }
        const code = shareCode || (await packShareCode())
        const stamp = fileStamp()
        const text = [
          '农民房改造 · 布置分享码',
          '生成时间：' + stamp,
          '',
          code,
          '',
          '导入方法：打开「农民房装修指南」→ 右上角菜单 → 导入布置，粘贴上面的分享码即可还原。'
        ].join('\n')
        const bytes = zipStore([
          { name: 'village-house-share-' + stamp + '.txt', data: new TextEncoder().encode(text) },
          { name: 'village-house-preview-' + stamp + '.png', data: dataUrlBytes(sharePreview) }
        ])
        const blob = new Blob([bytes], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = 'village-house-' + stamp + '.zip'
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1500)
        showToast('已保存分享包')
      }

      async function importFromCode() {
        const input = document.getElementById('shareInput')
        const text = input ? input.value : ''
        if (!String(text).trim()) {
          showToast('先粘贴分享码')
          return
        }
        try {
          applyLayout(await unpackShareCode(text))
        } catch (err) {
          const reason = err && err.message
          if (reason === 'prefix') showToast('格式不对：分享码应以 MYHOME1: 开头')
          else if (reason === 'broken') showToast('分享码不完整，请重新完整复制')
          else showToast('导入失败：分享码内容已损坏')
        }
      }

      function applyLayout(raw) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rooms) || !raw.rooms.length) {
          throw new Error('bad layout')
        }
        const ids = new Set()
        const list = raw.rooms.slice(0, 12).map((room, i) => normRoom(room, i, ids))
        if (!list.length) throw new Error('bad layout')

        rooms.forEach(room => {
          if (room.parts) disposeRoomParts(room)
        })
        rooms.length = 0
        list.forEach(room => rooms.push(room))

        roomSeq = Math.max(list.length + 1, Math.round(numOr(raw.roomSeq, list.length + 1)))
        openingSeq = Math.max(1, Math.round(numOr(raw.openingSeq, 1)))
        customSeq = Math.max(0, Math.round(numOr(raw.customSeq, 0)))

        selection = null
        pickerOpen = false
        sizeCustomOpen = false
        roomRenameOpen = false
        pendingDeleteId = null
        if (deleteTimer) {
          clearTimeout(deleteTimer)
          deleteTimer = null
        }
        closeSheet()
        closeShare()

        if (glReady) list.forEach(room => buildRoom(room))
        overviewMode = true
        bindRoom(list[0].id)
        tweenCamera(overviewGoal())
        renderAll()
        /* 导入视为新的起点，清空撤销历史 */
        undoStack.length = 0
        lastSnapshot = snapshotState()
        lastSnapshotKey = JSON.stringify(lastSnapshot)
        updateUndoBtn()
        showToast('已导入 ' + list.length + ' 间房')
      }

      function renderAll() {
        renderScene()
        renderFurniture()
        renderHUD()
        renderDock()
        renderPicker()
      }

      /* ---------- 交互 ---------- */
      function showToast(text) {
        toast.textContent = text
        toast.classList.add('is-show')
        if (toastTimer) clearTimeout(toastTimer)
        toastTimer = setTimeout(() => toast.classList.remove('is-show'), 1600)
      }

      function selectedItem() {
        if (!selection || selection.kind !== 'furniture') return null
        return placed.find(p => p.id === selection.id) || null
      }

      function applySelection() {
        furnitureLayer.querySelectorAll('.f-item').forEach(el => {
          el.classList.toggle(
            'is-selected',
            !!(selection && selection.kind === 'furniture' && selection.id === el.dataset.id)
          )
        })
        renderScene()
      }

      function selectFurniture(id) {
        selection = { kind: 'furniture', id }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        applySelection()
        renderDock()
        renderPicker()
        renderHUD()
      }

      function selectOpening(id) {
        selection = { kind: 'opening', id }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        applySelection()
        renderDock()
        renderPicker()
        renderHUD()
      }

      /* 门窗换墙：位置按新墙重新夹取，并同步 3D 与操作栏 */
      function switchOpeningSide(side) {
        const opening = selectedOpening()
        if (!opening || opening.side === side) return
        const room = activeRoom()
        const half = (opening.kind === 'window' ? windowSize(opening).w + 0.2 : doorSize(opening).w + 0.16) / 2
        const span = side === 'left' ? room.d : room.w
        if (span < half * 2 + 0.1) {
          showToast('这面墙太短，放不下' + SCENE_PARTS[opening.kind].name)
          return
        }
        opening.side = side
        const bounds = openingBounds(opening, room)
        opening.u = clamp(opening.u, bounds.min, bounds.max)
        if (opening.kind === 'window') {
          const yr = windowYRange(opening)
          opening.y = clamp(opening.y, yr.min, yr.max)
        }

        /* 新墙上如果已经有门窗占位，就往旁边挪开 */
        const minGap = opening.kind === 'window' ? 2.3 : 1.1
        const others = openings.filter(o => o.id !== opening.id && o.side === side)
        if (others.some(o => Math.abs(o.u - opening.u) < minGap)) {
          let found = null
          for (let i = 1; i <= 8 && found === null; i++) {
            ;[1, -1].forEach(dir => {
              if (found !== null) return
              const candidate = clamp(opening.u + dir * i * minGap, bounds.min, bounds.max)
              if (!others.some(o => Math.abs(o.u - candidate) < minGap)) found = candidate
            })
          }
          if (found !== null) opening.u = found
        }

        syncOpenings3D()
        updateSelectionVisuals()
        renderDock()
        showToast('已移到' + (side === 'left' ? '左墙' : '后墙'))
      }

      /* 调整门窗宽高：重新夹取沿墙位置和窗中心高度 */
      function changeOpeningSize(axis, value) {
        const opening = selectedOpening()
        if (!opening) return
        const room = activeRoom()
        const num = Number(value)
        if (!isFinite(num)) return
        const lim = openingLimits(opening, room)
        const isWin = opening.kind === 'window'
        if (axis === 'w') {
          opening.w = Math.round(clamp(num, lim.wMin, lim.wMax) * 100) / 100
        } else {
          opening.h = Math.round(clamp(num, lim.hMin, lim.hMax) * 100) / 100
        }
        const bounds = openingBounds(opening, room)
        opening.u = clamp(opening.u, bounds.min, bounds.max)
        /* 窗顶统一保持在 2.4m，改变窗高时窗台随之升降；门始终落地 */
        if (isWin) {
          /* 未手动调过高度的窗没有 h 字段，必须走 windowSize 取默认高度，否则 y 会变成 NaN */
          const curH = windowSize(opening).h
          const yr = windowYRange(opening)
          opening.y = clamp(WINDOW_HEAD - curH / 2, yr.min, yr.max)
        }
        syncOpenings3D()
        updateSelectionVisuals()
        const range = dock.querySelector('[data-osize="' + axis + '"]')
        if (range) range.value = String(opening[axis])
        const numInput = dock.querySelector('[data-osize-num="' + axis + '"]')
        if (numInput && document.activeElement !== numInput) numInput.value = Number(opening[axis]).toFixed(2)
        scheduleHistory()
      }

      /* 窗簾开关与配色 */
      function setCurtainVisible(visible) {
        const opening = selectedOpening()
        if (!opening || opening.kind !== 'window') return
        opening.curtain = visible
        renderScene()
        renderDock()
      }

      function setCurtainTone(tone) {
        const opening = selectedOpening()
        if (!opening || opening.kind !== 'window') return
        opening.curtainTone = tone
        renderScene()
        renderDock()
        renderPicker()
      }

      function addOpening(kind) {
        const room = activeRoom()
        /* 窗按最小 1m 宽判断能否放下，新窗宽度再按墙面自适应 */
        const need = (kind === 'window' ? WIN_W_MIN + 0.9 : DOOR_W + 0.16) + 0.1
        const spots = kind === 'window'
          ? [
              { side: 'left', u: 0.4, y: WINDOW_HEAD - WIN_H / 2 },
              { side: 'left', u: -0.4, y: WINDOW_HEAD - WIN_H / 2 },
              { side: 'back', u: 0, y: WINDOW_HEAD - WIN_H / 2 }
            ]
          : [
              { side: 'left', u: 0.4, y: 0 },
              { side: 'left', u: -0.4, y: 0 },
              { side: 'back', u: 1.2, y: 0 }
            ]
        const usable = spots.filter(s => (s.side === 'left' ? room.d : room.w) >= need)
        if (!usable.length) {
          showToast('房间太小，放不下' + SCENE_PARTS[kind].name)
          return
        }
        const spot = usable.find(s =>
          !openings.some(o => o.side === s.side && Math.abs(o.u - s.u) < (kind === 'window' ? 2.3 : 1.1))
        ) || usable[0]
        const opening = {
          id: (kind === 'window' ? 'win-' : 'door-') + (++openingSeq),
          kind,
          side: spot.side,
          u: spot.u,
          y: spot.y,
          tone: null
        }
        if (kind === 'window') {
          /* 墙面较窄时窗宽收窄，最小 1m */
          const span = spot.side === 'left' ? room.d : room.w
          opening.w = Math.round(clamp(WIN_W, WIN_W_MIN, Math.max(WIN_W_MIN, span - 0.9)) * 100) / 100
          opening.h = WIN_H
          opening.curtain = true
          opening.curtainTone = null
        }
        const bounds = openingBounds(opening, room)
        opening.u = clamp(opening.u, bounds.min, bounds.max)
        openings.push(opening)
        selection = { kind: 'opening', id: opening.id }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        renderAll()
        showToast('已添加「' + SCENE_PARTS[kind].name + '」')
      }

      function togglePart(part) {
        if (selection && selection.kind === 'scene' && selection.part === part) {
          selection = null
        } else {
          selection = { kind: 'scene', part }
        }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        applySelection()
        renderDock()
        renderPicker()
        renderHUD()
      }

      function changePalette(index) {
        const item = selectedItem()
        if (!item) return
        item.palette = index
        item.tone = null
        renderFurniture()
        renderDock()
        renderPicker()
      }

      function applyTone(tone) {
        if (curtainPicker) {
          const opening = selectedOpening()
          if (opening && opening.kind === 'window') {
            opening.curtainTone = normHex(tone)
            renderScene()
          }
        } else if (finishPickerPart) {
          const st = sceneState[finishPickerPart]
          if (st && SURFACE_SIZE[st.finish]) {
            st.finishTone = normHex(tone)
            renderScene()
          }
        } else {
          const item = selectedItem()
          if (item) {
            item.tone = tone
            renderFurniture()
          } else if (selection && selection.kind === 'opening') {
            const opening = selectedOpening()
            if (opening) {
              opening.tone = tone
              renderScene()
            }
          } else if (selection && selection.kind === 'scene') {
            sceneState[selection.part].tone = tone
            renderScene()
          }
        }
        renderDock()
        renderPicker()
      }

      /* 铺装色：预设色 / 自由取色 / 跟随墙地配色（null） */
      function setFinishTone(tone) {
        if (!selection || selection.kind !== 'scene') return
        const part = selection.part
        if (part !== 'wall' && part !== 'floor') return
        const st = sceneState[part]
        if (!SURFACE_SIZE[st.finish]) return
        st.finishTone = tone == null ? null : normHex(tone)
        renderScene()
        renderDock()
        renderPicker()
      }

      /* 墙面 / 地板切换铺装：素面 / 瓷砖 / 木板 */
      function changeSurface(finish) {
        if (!selection || selection.kind !== 'scene') return
        const part = selection.part
        if (part !== 'wall' && part !== 'floor') return
        const st = sceneState[part]
        const def = SURFACE_SIZE[finish]
        st.finish = def ? finish : 'plain'
        if (def) {
          st.finishSize = Math.round(clamp(numOr(st.finishSize, def.def), def.min, def.max) * 100) / 100
        }
        renderScene()
        renderDock()
      }

      function changeSurfaceSize(value) {
        if (!selection || selection.kind !== 'scene') return
        const part = selection.part
        if (part !== 'wall' && part !== 'floor') return
        const st = sceneState[part]
        const def = SURFACE_SIZE[st.finish]
        if (!def) return
        const num = Number(value)
        if (!isFinite(num)) return
        const snapped = Math.round(clamp(num, def.min, def.max) / def.step) * def.step
        st.finishSize = Math.round(snapped * 100) / 100
        renderScene()
        const range = dock.querySelector('[data-surface-size]')
        if (range) range.value = String(st.finishSize)
        const numInput = dock.querySelector('[data-surface-size-num]')
        if (numInput && document.activeElement !== numInput) numInput.value = st.finishSize.toFixed(2)
      }

      /* 局部铺贴：调整铺贴宽 / 高，未覆盖部分保持素面 */
      function changeSurfaceCover(axis, value) {
        if (!selection || selection.kind !== 'scene') return
        const part = selection.part
        if (part !== 'wall' && part !== 'floor') return
        const st = sceneState[part]
        if (!SURFACE_SIZE[st.finish]) return
        const num = Number(value)
        if (!isFinite(num)) return
        const room = activeRoom()
        const cover = surfaceCover(room, part, 0)
        const max = axis === 'w' ? cover.fullW : cover.fullH
        const next = Math.round(clamp(num, 0.2, max) * 100) / 100
        if (axis === 'w') st.coverW = next
        else st.coverH = next
        renderScene()
        const range = dock.querySelector('[data-cover="' + axis + '"]')
        if (range) range.value = String(next)
        const numInput = dock.querySelector('[data-cover-num="' + axis + '"]')
        if (numInput && document.activeElement !== numInput) numInput.value = next.toFixed(2)
        scheduleHistory()
      }

      function resetSurfaceCover() {
        if (!selection || selection.kind !== 'scene') return
        const part = selection.part
        if (part !== 'wall' && part !== 'floor') return
        const st = sceneState[part]
        st.coverW = null
        st.coverH = null
        st.coverU = null
        st.coverV = null
        renderScene()
        renderDock()
        scheduleHistory()
      }

      /* 按数据调家具宽度/深度，只重建这一件 */
      function changeFurnitureDim(axis, value) {
        const item = selectedItem()
        if (!item || item.type === 'diy') return
        const room = activeRoom()
        const num = Number(value)
        if (!isFinite(num)) return
        const snapped = Math.round(clamp(num, FURN_DIM.min, FURN_DIM.max) / FURN_DIM.step) * FURN_DIM.step
        item[axis] = Math.round(snapped * 100) / 100
        const wx = Number(item.wx) || 0
        const wz = Number(item.wz) || 0
        if (isWallType(item.type)) {
          const mx = roomInset(room.w, 0.8)
          item.wx = clamp(wx, -room.w / 2 + mx, room.w / 2 - mx)
          item.wz = -(room.d / 2) + 0.1
        } else {
          const insetX = floorInset(item, 'x')
          const insetZ = floorInset(item, 'z')
          item.wx = clamp(wx, -room.w / 2 + roomInset(room.w, insetX), room.w / 2 - roomInset(room.w, insetX))
          item.wz = clamp(wz, -room.d / 2 + roomInset(room.d, insetZ), room.d / 2 - roomInset(room.d, insetZ))
        }
        removeFurnitureHolder(item.id)
        addFurnitureHolder(item, room)
        updateSelectionVisuals()
        const range = dock.querySelector('[data-fdim="' + axis + '"]')
        if (range) range.value = String(item[axis])
        const numInput = dock.querySelector('[data-fdim-num="' + axis + '"]')
        if (numInput && document.activeElement !== numInput) numInput.value = item[axis].toFixed(2)
        scheduleHistory()
      }

      /* 所有家具上下调整：改离地高度 */
      function changeFurnitureHeight(value) {
        const item = selectedItem()
        if (!item) return
        const num = Number(value)
        if (!isFinite(num)) return
        const snapped = Math.round(clamp(num, FURN_Y.min, FURN_Y.max) / FURN_Y.step) * FURN_Y.step
        item.wy = Math.round(snapped * 100) / 100
        const group = glFurniture.children.find(g => g.userData.itemId === item.id)
        if (group) {
          group.position.y = item.wy
          const shadow = group.children.find(n => n.userData && n.userData.contactShadow)
          if (shadow) shadow.visible = item.wy <= 0.001
        }
        if (glBoxHelper) glBoxHelper.update()
        const range = dock.querySelector('[data-fwy]')
        if (range) range.value = String(item.wy)
        const numInput = dock.querySelector('[data-fwy-num]')
        if (numInput && document.activeElement !== numInput) numInput.value = item.wy.toFixed(2)
        scheduleHistory()
      }

      /* 自制家具整体缩放，按百分比存 */
      function changeDiyScale(percent) {
        const item = selectedItem()
        if (!item || item.type !== 'diy') return
        const num = Number(percent)
        if (!isFinite(num)) return
        item.scale = clamp(Math.round(num) / 100, DIY_SCALE.min, DIY_SCALE.max)
        const holder = glFurniture.children.find(g => g.userData.itemId === item.id)
        if (holder) holder.scale.setScalar(item.scale)
        if (glBoxHelper) glBoxHelper.update()
        const range = dock.querySelector('[data-diy-scale]')
        if (range) range.value = String(Math.round(item.scale * 100))
        const numInput = dock.querySelector('[data-diy-scale-num]')
        if (numInput && document.activeElement !== numInput) numInput.value = String(Math.round(item.scale * 100))
        scheduleHistory()
      }

      function changeStyle(style) {
        const item = selectedItem()
        if (!item) return
        item.style = style
        renderFurniture()
        renderDock()
      }

      function changeRotation(axis, value) {
        const item = selectedItem()
        if (!item) return
        item['rot' + axis.toUpperCase()] = value
        const holder = glFurniture.children.find(g => g.userData.itemId === item.id)
        const pivot = holder && holder.children[0]
        if (pivot) {
          pivot.rotation[axis] = THREE.MathUtils.degToRad(value)
          if (glBoxHelper) glBoxHelper.update()
        }
        const range = dock.querySelector('[data-rot="' + axis + '"]')
        if (range) range.value = value
        const num = dock.querySelector('[data-rot-num="' + axis + '"]')
        if (num && document.activeElement !== num) num.value = String(Math.round(value))
        scheduleHistory()
      }

      function removeSelected() {
        const item = selectedItem()
        if (item) {
          const name = item.name
          selection = null
          pickerOpen = false
          const index = placed.findIndex(p => p.id === item.id)
          if (index >= 0) placed.splice(index, 1)
          renderAll()
          showToast('已移除「' + name + '」')
          return
        }
        if (selection && selection.kind === 'opening') {
          const opening = selectedOpening()
          if (opening) {
            const name = SCENE_PARTS[opening.kind].name
            const index = openings.findIndex(o => o.id === opening.id)
            if (index >= 0) openings.splice(index, 1)
            selection = null
            pickerOpen = false
            renderAll()
            showToast('已移除「' + name + '」')
          }
          return
        }
        if (selection && selection.kind === 'scene') {
          const part = selection.part
          sceneState[part].hidden = true
          selection = null
          pickerOpen = false
          renderAll()
          showToast('已移除「' + SCENE_PARTS[part].name + '」')
        }
      }

      let itemSeq = 0

      function addFurniture(type) {
        const def = CATALOG[type]
        let id
        do {
          id = 'fx-' + type + '-' + (++itemSeq)
        } while (rooms.some(r => r.placed.some(p => p.id === id)))
        const spot = spawnPosition(type)
        placed.push({
          id, type, name: def.name, palette: 0, tone: null,
          style: def.styles[0].id, size: 'md',
          x: 0, y: 0,
          wx: spot.x, wy: spot.y, wz: spot.z
        })
        selection = { kind: 'furniture', id }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        renderAll()
        showToast('已添加「' + def.name + '」')
      }

      function restorePart(part) {
        sceneState[part].hidden = false
        selection = { kind: 'scene', part }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        renderAll()
        showToast('已恢复「' + SCENE_PARTS[part].name + '」')
      }

      /* 从“门窗与构件”卡片直接进入结构件的颜色编辑 */
      function editScenePart(part) {
        if (!SCENE_PARTS[part]) return
        if (sceneState[part].hidden) {
          restorePart(part)
          return
        }
        selection = { kind: 'scene', part }
        hintDismissed = true
        pickerOpen = false
        closeSheet()
        applySelection()
        renderDock()
        renderPicker()
        renderHUD()
      }

      function addDiyPart(shape) {
        if (diy.parts.length >= DIY_LIMIT) {
          showToast('最多 ' + DIY_LIMIT + ' 块')
          return
        }
        const prev = currentDiyPart()
        const part = defaultDiyPart(shape)
        /* 新体块默认叠在当前体块上面，捏起来省事 */
        if (prev) {
          part.x = prev.x
          part.z = prev.z
          part.y = Math.min(3, Math.round((prev.y + prev.h) * 100) / 100)
        }
        diy.parts.push(part)
        diy.selected = diy.parts.length - 1
        renderSheet()
        syncFurniture3D()
      }

      function duplicateDiyPart() {
        const part = currentDiyPart()
        if (!part) return
        if (diy.parts.length >= DIY_LIMIT) {
          showToast('最多 ' + DIY_LIMIT + ' 块')
          return
        }
        const copy = Object.assign({}, part)
        copy.x = clamp(part.x + 0.3, -1.6, 1.6)
        diy.parts.push(copy)
        diy.selected = diy.parts.length - 1
        renderSheet()
        syncFurniture3D()
      }

      function deleteDiyPart() {
        if (!diy.parts.length) return
        diy.parts.splice(diy.selected, 1)
        diy.selected = Math.max(0, Math.min(diy.selected, diy.parts.length - 1))
        renderSheet()
        syncFurniture3D()
      }

      function updateDiyPartField(key, value) {
        const part = currentDiyPart()
        if (!part) return
        const ranges = {
          w: [0.06, 3], h: [0.06, 3], d: [0.06, 3],
          x: [-1.6, 1.6], y: [0, 3], z: [-1.6, 1.6],
          ry: [-180, 180]
        }
        const range = ranges[key]
        if (!range || !isFinite(value)) return
        part[key] = Math.round(clamp(value, range[0], range[1]) * 100) / 100
        syncFurniture3D()
        const label = sheetBody.querySelector('[data-diy-val="' + key + '"]')
        if (label) {
          label.textContent = key === 'ry'
            ? Math.round(part[key]) + '°'
            : part[key].toFixed(2) + 'm'
        }
      }

      function newDiy() {
        diy = { name: '', scale: 1, selected: 0, parts: [] }
        renderSheet()
        syncFurniture3D()
      }

      function loadDiyWork(id) {
        const work = diyWorks.find(item => item.id === id)
        if (!work) return
        diy = {
          name: work.name,
          scale: 1,
          selected: 0,
          parts: cloneDiyParts(work.parts)
        }
        renderSheet()
        syncFurniture3D()
        showToast('已载入「' + work.name + '」，可继续改')
      }

      function deleteDiyWork(id) {
        const index = diyWorks.findIndex(item => item.id === id)
        if (index < 0) return
        const name = diyWorks[index].name
        diyWorks.splice(index, 1)
        saveDiyWorks()
        renderSheet()
        showToast('已删除「' + name + '」')
      }

      function craftFurniture() {
        const parts = cloneDiyParts(diy.parts)
        if (!parts.length) {
          showToast('先加一个体块')
          return
        }
        const name = diy.name.trim() || '自制家具'
        const id = 'custom-' + customSeq++
        const spot = spawnPosition('diy')
        const item = {
          id,
          type: 'diy',
          name,
          palette: 0,
          tone: null,
          style: 'diy',
          scale: diy.scale || 1,
          parts,
          x: 0,
          y: 0,
          wx: spot.x,
          wy: 0,
          wz: spot.z
        }
        placed.push(item)
        diyWorks.unshift({ id: diyWorkId(), name, parts: cloneDiyParts(parts) })
        diyWorks = diyWorks.slice(0, 60)
        saveDiyWorks()
        selection = { kind: 'furniture', id }
        hintDismissed = true
        pickerOpen = false
        diy.name = ''
        closeSheet()
        renderAll()
        showToast('已做好「' + name + '」')
      }

      function openSheet(tab) {
        sheetTab = tab || 'storage'
        sheetOpen = true
        pickerOpen = false
        renderPicker()
        sheet.scrollTop = 0
        renderSheet()
        sheet.classList.add('is-open')
        syncFurniture3D()
      }

      function closeSheet() {
        if (!sheetOpen) return
        sheetOpen = false
        sheet.classList.remove('is-open')
        syncFurniture3D()
      }

      function enterRoom() {
        entered = true
        stage.classList.add('is-entered')
        renderAll()
      }

      function exitRoom() {
        entered = false
        selection = null
        pickerOpen = false
        closeSheet()
        stage.classList.remove('is-entered')
        renderAll()
      }

      function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max)
      }

      /* ---------- 绑定 ---------- */
      document.getElementById('enterBtn').addEventListener('click', enterRoom)

      /* 右上角菜单：导入 / 导出 / 退出 */
      const menuBtn = document.getElementById('menuBtn')
      const menuPanel = document.getElementById('menuPanel')
      function setMenu(open) {
        if (menuWrap) menuWrap.classList.toggle('is-open', open)
      }
      menuBtn.addEventListener('click', e => {
        e.stopPropagation()
        setMenu(!(menuWrap && menuWrap.classList.contains('is-open')))
      })
      menuPanel.addEventListener('click', e => {
        const item = e.target.closest('[data-menu]')
        if (!item) return
        setMenu(false)
        const action = item.dataset.menu
        if (action === 'export') openShare('export')
        else if (action === 'import') openShare('import')
        else if (action === 'exit') exitRoom()
      })
      document.addEventListener('click', e => {
        if (!menuWrap || !menuWrap.classList.contains('is-open')) return
        if (menuWrap.contains(e.target)) return
        setMenu(false)
      })

      /* 点空白/按钮时先收键盘，避免打开分享卡后键盘仍挂着把页面上推 */
      document.addEventListener('pointerdown', e => {
        const active = document.activeElement
        if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) return
        if (e.target === active) return
        active.blur()
      })

      shareMask.addEventListener('click', e => {
        if (e.target.closest('#shareClose') || e.target === shareMask) closeShare()
      })
      shareBody.addEventListener('click', e => {
        const btn = e.target.closest('[data-share]')
        if (!btn) return
        const action = btn.dataset.share
        if (action === 'copy') copyShareCode()
        else if (action === 'pack') downloadSharePack()
        else if (action === 'pdf') downloadPlanPdf()
        else if (action === 'code') importFromCode()
        else if (action === 'diy-code') importDiyFromCode()
        else if (action === 'diy-file') downloadDiyPack()
      })

      /* iOS Safari：页面级双指缩放会抢走场景手势，直接禁用 */
      ;(document as any).addEventListener('gesturestart', (e: Event) => e.preventDefault())

      document.getElementById('viewCtrl').addEventListener('click', e => {
        const btn = e.target.closest('[data-view]')
        if (!btn) return
        if (btn.dataset.view === 'in') zoomBy(-0.16)
        else if (btn.dataset.view === 'out') zoomBy(0.16)
        else if (btn.dataset.view === 'undo') undo()
        else resetCamera()
      })
      /* 房间标签横向滚动：滚轮 / 鼠标拖拽 / 触摸滑动 */
      let tabDrag = null
      let tabDragMoved = false
      let tabDragTimer = 0
      roomTabs.addEventListener('wheel', e => {
        if (roomTabs.scrollWidth <= roomTabs.clientWidth + 1) return
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (!delta) return
        roomTabs.scrollLeft += delta
        e.preventDefault()
      }, { passive: false })
      roomTabs.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return
        tabDrag = { x: e.clientX, left: roomTabs.scrollLeft, moved: false }
      })
      window.addEventListener('pointermove', e => {
        if (!tabDrag || e.pointerType !== 'mouse') return
        const dx = e.clientX - tabDrag.x
        if (!tabDrag.moved && Math.abs(dx) < 5) return
        if (!tabDrag.moved) roomTabs.classList.add('is-dragging')
        tabDrag.moved = true
        roomTabs.scrollLeft = tabDrag.left - dx
      })
      window.addEventListener('pointerup', () => {
        if (!tabDrag) return
        tabDragMoved = tabDrag.moved
        tabDrag = null
        roomTabs.classList.remove('is-dragging')
        clearTimeout(tabDragTimer)
        tabDragTimer = setTimeout(() => { tabDragMoved = false }, 0)
      })
      window.addEventListener('pointercancel', () => {
        tabDrag = null
        roomTabs.classList.remove('is-dragging')
      })

      roomTabs.addEventListener('click', e => {
        if (tabDragMoved) {
          tabDragMoved = false
          return
        }
        if (e.target.closest('[data-room-add]')) {
          addRoom()
          return
        }
        if (e.target.closest('[data-room-rename]')) {
          sizeCustomOpen = false
          roomRenameOpen = true
          renderDock()
          const input = dock.querySelector('[data-room-name]')
          if (input) { input.focus(); input.select() }
          return
        }
        if (e.target.closest('[data-room-delete]')) {
          requestDeleteRoom(activeRoomId)
          return
        }
        const chip = e.target.closest('[data-room]')
        if (!chip) return
        if (chip.dataset.room === '__all') showOverview()
        else focusRoom(chip.dataset.room)
      })
      document.getElementById('sheetClose').addEventListener('click', closeSheet)

      dock.addEventListener('click', e => {
        const target = e.target
        if (target.closest('#addBtn')) {
          openSheet('storage')
          return
        }
        if (target.closest('#craftBtn')) {
          openSheet('maker')
          return
        }
        if (target.closest('#delBtn')) {
          removeSelected()
          return
        }
        if (target.closest('[data-finish-follow]')) {
          setFinishTone(null)
          return
        }
        const finishToneSwatch = target.closest('[data-finish-tone]')
        if (finishToneSwatch) {
          setFinishTone(finishToneSwatch.dataset.finishTone)
          return
        }
        if (target.closest('[data-finish-tone-open]')) {
          if (!selection || selection.kind !== 'scene') return
          pickerOpen = !pickerOpen
          curtainPicker = false
          finishPickerPart = pickerOpen ? selection.part : null
          renderPicker()
          return
        }
        if (target.closest('[data-curtain-tone-open]')) {
          const opening = selectedOpening()
          if (!opening || opening.kind !== 'window') return
          pickerOpen = !pickerOpen
          finishPickerPart = null
          curtainPicker = pickerOpen
          renderPicker()
          return
        }
        if (target.closest('[data-tone-open]')) {
          finishPickerPart = null
          curtainPicker = false
          pickerOpen = !pickerOpen
          renderPicker()
          return
        }
        const curtainChip = target.closest('[data-curtain]')
        if (curtainChip) {
          setCurtainVisible(curtainChip.dataset.curtain === '1')
          return
        }
        const curtainSwatch = target.closest('[data-curtain-tone]')
        if (curtainSwatch) {
          setCurtainTone(curtainSwatch.dataset.curtainTone)
          return
        }
        const sideChip = target.closest('[data-opening-side]')
        if (sideChip) {
          switchOpeningSide(sideChip.dataset.openingSide)
          return
        }
        const pal = target.closest('[data-pal]')
        if (pal) {
          changePalette(Number(pal.dataset.pal))
          return
        }
        const tone = target.closest('[data-tone]')
        if (tone) {
          applyTone(tone.dataset.tone)
          return
        }
        const surface = target.closest('[data-surface]')
        if (surface) {
          changeSurface(surface.dataset.surface)
          return
        }
        if (target.closest('[data-surface-full]')) {
          resetSurfaceCover()
          return
        }
        const roomCustom = target.closest('[data-room-custom]')
        if (roomCustom) {
          sizeCustomOpen = !sizeCustomOpen
          renderDock()
          if (sizeCustomOpen) {
            const wi = dock.querySelector('[data-dim="w"]')
            if (wi) { wi.focus(); wi.select() }
          }
          return
        }
        if (target.closest('[data-room-rename-apply]')) {
          applyRoomRename()
          return
        }
        if (target.closest('[data-room-dim-apply]')) {
          applyCustomRoomSize()
          return
        }
        const roomSize = target.closest('[data-room-size]')
        if (roomSize) {
          const dims = roomSize.dataset.roomSize.split('x').map(Number)
          applyRoomSize(dims[0], dims[1])
          return
        }
        const style = target.closest('[data-style]')
        if (style) {
          changeStyle(style.dataset.style)
          return
        }
        if (target.closest('[data-rot-reset]')) {
          ;['x', 'y', 'z'].forEach(axis => changeRotation(axis, 0))
          renderDock()
          return
        }
        if (target.closest('[data-fwy-reset]')) {
          changeFurnitureHeight(0)
          return
        }
      })

      dock.addEventListener('input', e => {
        const osize = e.target.closest('[data-osize]')
        if (osize) {
          changeOpeningSize(osize.dataset.osize, Number(osize.value))
          return
        }
        const osizeNum = e.target.closest('[data-osize-num]')
        if (osizeNum && osizeNum.value !== '') {
          changeOpeningSize(osizeNum.dataset.osizeNum, Number(osizeNum.value))
          return
        }
        const fdim = e.target.closest('[data-fdim]')
        if (fdim) {
          changeFurnitureDim(fdim.dataset.fdim, Number(fdim.value))
          return
        }
        const fdimNum = e.target.closest('[data-fdim-num]')
        if (fdimNum && fdimNum.value !== '') {
          changeFurnitureDim(fdimNum.dataset.fdimNum, Number(fdimNum.value))
          return
        }
        const fwy = e.target.closest('[data-fwy]')
        if (fwy) {
          changeFurnitureHeight(Number(fwy.value))
          return
        }
        const fwyNum = e.target.closest('[data-fwy-num]')
        if (fwyNum && fwyNum.value !== '') {
          changeFurnitureHeight(Number(fwyNum.value))
          return
        }
        const diyScale = e.target.closest('[data-diy-scale]')
        if (diyScale) {
          changeDiyScale(Number(diyScale.value))
          return
        }
        const diyScaleNum = e.target.closest('[data-diy-scale-num]')
        if (diyScaleNum && diyScaleNum.value !== '') {
          changeDiyScale(Number(diyScaleNum.value))
          return
        }
        const surfaceSize = e.target.closest('[data-surface-size]')
        if (surfaceSize) {
          changeSurfaceSize(Number(surfaceSize.value))
          return
        }
        const cover = e.target.closest('[data-cover]')
        if (cover) {
          changeSurfaceCover(cover.dataset.cover, Number(cover.value))
          return
        }
        const range = e.target.closest('[data-rot]')
        if (range) {
          changeRotation(range.dataset.rot, Number(range.value))
          return
        }
        const num = e.target.closest('[data-rot-num]')
        if (num && num.value !== '') {
          const value = Number(num.value)
          if (isFinite(value) && Math.abs(value) <= 180) {
            changeRotation(num.dataset.rotNum, value)
          }
        }
      })

      dock.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return
        if (e.target.closest('[data-dim]')) {
          e.preventDefault()
          applyCustomRoomSize()
        } else if (e.target.closest('[data-room-name]')) {
          e.preventDefault()
          applyRoomRename()
        } else if (e.target.closest('[data-fdim-num]') || e.target.closest('[data-fwy-num]') || e.target.closest('[data-diy-scale-num]') || e.target.closest('[data-osize-num]') || e.target.closest('[data-surface-size-num]') || e.target.closest('[data-cover-num]')) {
          e.preventDefault()
          e.target.blur()
        }
      })

      dock.addEventListener('change', e => {
        const osizeNum = e.target.closest('[data-osize-num]')
        if (osizeNum) {
          const opening = selectedOpening()
          if (!opening) return
          const axis = osizeNum.dataset.osizeNum
          const lim = openingLimits(opening)
          const size = opening.kind === 'window' ? windowSize(opening) : doorSize(opening)
          const fallback = size[axis]
          const raw = Number(osizeNum.value)
          const min = axis === 'w' ? lim.wMin : lim.hMin
          const max = axis === 'w' ? lim.wMax : lim.hMax
          const value = osizeNum.value === '' || !isFinite(raw) ? fallback : clamp(raw, min, max)
          changeOpeningSize(axis, value)
          const current = opening.kind === 'window' ? windowSize(opening) : doorSize(opening)
          osizeNum.value = Number(current[axis]).toFixed(2)
          return
        }
        const fdimNum = e.target.closest('[data-fdim-num]')
        if (fdimNum) {
          const item = selectedItem()
          const dims = item ? itemDims(item) : { w: 1, d: 1 }
          const axis = fdimNum.dataset.fdimNum
          const raw = Number(fdimNum.value)
          const value = fdimNum.value === '' || !isFinite(raw)
            ? dims[axis]
            : clamp(raw, FURN_DIM.min, FURN_DIM.max)
          changeFurnitureDim(axis, value)
          fdimNum.value = Number(itemDims(selectedItem())[axis]).toFixed(2)
          return
        }
        const fwyNum = e.target.closest('[data-fwy-num]')
        if (fwyNum) {
          const item = selectedItem()
          const fallback = item ? numOr(item.wy, 0) : 0
          const raw = Number(fwyNum.value)
          const value = fwyNum.value === '' || !isFinite(raw) ? fallback : clamp(raw, FURN_Y.min, FURN_Y.max)
          changeFurnitureHeight(value)
          if (item) fwyNum.value = numOr(item.wy, 0).toFixed(2)
          return
        }
        const diyScaleNum = e.target.closest('[data-diy-scale-num]')
        if (diyScaleNum) {
          const item = selectedItem()
          const fallback = item && item.type === 'diy' ? Math.round((item.scale || 1) * 100) : 100
          const raw = Number(diyScaleNum.value)
          const value = diyScaleNum.value === '' || !isFinite(raw)
            ? fallback
            : clamp(raw, DIY_SCALE.min * 100, DIY_SCALE.max * 100)
          changeDiyScale(value)
          diyScaleNum.value = String(Math.round((item && item.scale ? item.scale : 1) * 100))
          return
        }
        const surfaceSizeNum = e.target.closest('[data-surface-size-num]')
        if (surfaceSizeNum) {
          const part = selection && selection.kind === 'scene' ? selection.part : ''
          const def = SURFACE_SIZE[sceneState[part] ? sceneState[part].finish : '']
          if (!def) return
          const st = sceneState[part]
          const current = clamp(numOr(st.finishSize, def.def), def.min, def.max)
          const raw = Number(surfaceSizeNum.value)
          const value = surfaceSizeNum.value === '' || !isFinite(raw) ? current : raw
          changeSurfaceSize(value)
          surfaceSizeNum.value = Number(clamp(numOr(st.finishSize, def.def), def.min, def.max)).toFixed(2)
          return
        }
        const coverNum = e.target.closest('[data-cover-num]')
        if (coverNum) {
          const part = selection && selection.kind === 'scene' ? selection.part : ''
          if ((part !== 'wall' && part !== 'floor') || !SURFACE_SIZE[sceneState[part].finish]) return
          const axis = coverNum.dataset.coverNum
          const cover = surfaceCover(activeRoom(), part, 0)
          const fallback = axis === 'w' ? cover.w : cover.h
          const raw = Number(coverNum.value)
          const value = coverNum.value === '' || !isFinite(raw) ? fallback : raw
          changeSurfaceCover(axis, value)
          const next = surfaceCover(activeRoom(), part, 0)
          coverNum.value = (axis === 'w' ? next.w : next.h).toFixed(2)
          return
        }
        const num = e.target.closest('[data-rot-num]')
        if (!num) return
        const item = selectedItem()
        const fallback = item ? Math.round(item['rot' + num.dataset.rotNum.toUpperCase()] || 0) : 0
        const raw = Number(num.value)
        const value = num.value === '' || !isFinite(raw)
          ? fallback
          : Math.max(-180, Math.min(180, Math.round(raw)))
        num.value = String(value)
        changeRotation(num.dataset.rotNum, value)
      })

      picker.addEventListener('click', e => {
        const tone = e.target.closest('[data-tone]')
        if (tone) applyTone(tone.dataset.tone)
      })

      sheet.querySelectorAll('.sheet-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          sheetTab = tab.dataset.tab
          sheet.scrollTop = 0
          renderSheet()
          syncFurniture3D()
        })
      })

      sheetBody.addEventListener('click', e => {
        const add = e.target.closest('[data-add]')
        if (add) {
          addFurniture(add.dataset.add)
          return
        }
        const addOpeningCard = e.target.closest('[data-add-opening]')
        if (addOpeningCard) {
          addOpening(addOpeningCard.dataset.addOpening)
          return
        }
        const restore = e.target.closest('[data-restore]')
        if (restore) {
          restorePart(restore.dataset.restore)
          return
        }
        const editPart = e.target.closest('[data-edit-part]')
        if (editPart) {
          editScenePart(editPart.dataset.editPart)
          return
        }
        const addShape = e.target.closest('[data-diy-add]')
        if (addShape) {
          addDiyPart(addShape.dataset.diyAdd)
          return
        }
        const diyPart = e.target.closest('[data-diy-part]')
        if (diyPart) {
          diy.selected = Number(diyPart.dataset.diyPart) || 0
          renderSheet()
          return
        }
        const diyTone = e.target.closest('[data-diy-tone]')
        if (diyTone) {
          const part = currentDiyPart()
          if (part) {
            part.c = diyTone.dataset.diyTone
            renderSheet()
            syncFurniture3D()
          }
          return
        }
        if (e.target.closest('[data-diy-duplicate]')) {
          duplicateDiyPart()
          return
        }
        if (e.target.closest('[data-diy-del]')) {
          deleteDiyPart()
          return
        }
        if (e.target.closest('[data-diy-new]')) {
          newDiy()
          return
        }
        if (e.target.closest('[data-diy-export]')) {
          if (!diyWorks.length) {
            showToast('作品库还是空的')
            return
          }
          openShare('diy-export')
          return
        }
        if (e.target.closest('[data-diy-import]')) {
          openShare('diy-import')
          return
        }
        const workDel = e.target.closest('[data-work-del]')
        if (workDel) {
          deleteDiyWork(workDel.dataset.workDel)
          return
        }
        const work = e.target.closest('[data-work]')
        if (work) {
          loadDiyWork(work.dataset.work)
          return
        }
        if (e.target.closest('[data-craft]')) {
          craftFurniture()
        }
      })

      /* 名称和体块滑块不触发重绘，避免输入框/滑杆丢失手势 */
      sheetBody.addEventListener('input', e => {
        if (e.target.id === 'makerName') {
          diy.name = e.target.value
          return
        }
        const scaleInput = e.target.closest('[data-diy-scale]')
        if (scaleInput) {
          const percent = Number(scaleInput.value)
          if (!isFinite(percent)) return
          diy.scale = clamp(percent / 100, DIY_SCALE.min, DIY_SCALE.max)
          syncFurniture3D()
          const label = sheetBody.querySelector('[data-diy-scale-val]')
          if (label) label.textContent = Math.round(diy.scale * 100) + '%'
          return
        }
        const slider = e.target.closest('[data-diy]')
        if (slider) updateDiyPartField(slider.dataset.diy, Number(slider.value))
      })

      document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return
        if (shareMask.classList.contains('is-open')) {
          closeShare()
        } else if (menuWrap && menuWrap.classList.contains('is-open')) {
          setMenu(false)
        } else if (pickerOpen) {
          pickerOpen = false
          renderPicker()
        } else if (sheetOpen) {
          closeSheet()
        } else if (selection) {
          selection = null
          applySelection()
          renderDock()
          renderPicker()
        } else if (entered) {
          exitRoom()
        }
      })

      init3D()
      renderAll()
      /* 首次渲染完成后才记录基线，避免初始化本身被当成一步可撤销操作 */
      lastSnapshot = snapshotState()
      lastSnapshotKey = JSON.stringify(lastSnapshot)
      updateUndoBtn()
}
