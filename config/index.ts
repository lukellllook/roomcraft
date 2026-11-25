import { defineConfig, type UserConfigExport } from '@tarojs/cli'

import devConfig from './dev'
import prodConfig from './prod'

export default defineConfig<'webpack5'>(async (merge, { command, mode }) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'roomcraft',
    date: '2026-11-11',
    // 设计稿以 375 逻辑像素为基准，样式里直接用 px 书写，Taro 会按端换算
    designWidth: 375,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      828: 1.81 / 2,
      375: 2
    },
    sourceRoot: 'src',
    // 部署 H5 到静态托管时用 TARO_OUTPUT_ROOT 指定独立目录
    outputRoot: process.env.TARO_OUTPUT_ROOT || 'dist',
    plugins: [],
    defineConstants: {},
    copy: {
      patterns: [],
      options: {}
    },
    framework: 'react',
    compiler: {
      type: 'webpack5',
      prebundle: { enable: false }
    },
    cache: {
      enable: false
    },
    h5: {
      // GitHub Pages 项目页部署在 /<仓库名>/ 子路径下，构建时用 TARO_PUBLIC_PATH 注入
      publicPath: process.env.TARO_PUBLIC_PATH || '/',
      staticDirectory: 'static',
      esnextModules: [],
      router: {
        // 单页应用使用浏览器路由，网址不显示 #；404.html 负责刷新回退。
        // 把页面路径的别名设为 /，避免 Taro 启动时把地址改写成 /pages/scene/index。
        mode: 'browser',
        basename: (process.env.TARO_PUBLIC_PATH || '/').replace(/\/$/, ''),
        customRoutes: {
          '/pages/scene/index': '/'
        }
      },
      postcss: {
        // 舞台按 375×600 固定尺寸绘制，家具位置由 JS 写入 px；
        // 关闭 px→rem 换算，避免样式表被缩放而内联坐标不缩放导致错位
        pxtransform: {
          enable: false,
          config: {}
        },
        autoprefixer: {
          enable: true,
          config: {}
        },
        cssModules: {
          enable: false
        }
      }
    },
    rn: {
      appName: 'taroRoomDemo',
      postcss: {
        cssModules: {
          enable: false
        }
      }
    }
  }

  if (process.env.NODE_ENV === 'development') {
    return merge({}, baseConfig, devConfig)
  }
  return merge({}, baseConfig, prodConfig)
})
