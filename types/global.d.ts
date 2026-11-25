/// <reference types="@tarojs/taro" />

declare module '*.scss' {
  const content: string
  export default content
}

declare module '*.png'
declare module '*.svg'
declare module '*.jpg'

declare namespace NodeJS {
  interface ProcessEnv {
    /** 当前构建平台 */
    TARO_ENV: 'weapp' | 'h5' | 'rn'
    /** 是否开发模式 */
    NODE_ENV: 'development' | 'production'
  }
}
