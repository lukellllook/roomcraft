/* GitHub Pages 部署后的 SEO 收尾：
 * 1. 把构建产物里的 __SITE_URL__ / __OG_IMAGE__ 占位符替换成真实地址
 * 2. 输出 robots.txt、sitemap.xml 与 .nojekyll
 * 3. 复制一份 OG 分享图到产物根目录
 *
 * 用法：
 *   SITE_URL=https://<user>.github.io/<repo>/ TARO_OUTPUT_ROOT=dist-h5 npm run build:h5:pages
 */
import { access, copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outDir = process.env.TARO_OUTPUT_ROOT || 'dist-h5'
const rawSiteUrl = (process.env.SITE_URL || '').trim()

if (!/^https?:\/\/[^/]+/.test(rawSiteUrl)) {
  console.error(
    '[seo] 缺少 SITE_URL。示例：SITE_URL=https://<user>.github.io/<repo>/ npm run build:h5:pages'
  )
  process.exit(1)
}

/* 统一补上结尾斜杠，保证 canonical / sitemap 里是绝对目录地址 */
const siteUrl = rawSiteUrl.endsWith('/') ? rawSiteUrl : `${rawSiteUrl}/`
const ogImage = `${siteUrl}og-cover.png`
const indexPath = join(outDir, 'index.html')

let html = await readFile(indexPath, 'utf8')
html = html.replaceAll('__SITE_URL__', siteUrl).replaceAll('__OG_IMAGE__', ogImage)
await writeFile(indexPath, html, 'utf8')

/* OG 分享图：使用仓库里的 3D 全屋截图 */
const ogSource = join('.screenshots', 'desktop-1440x900.png')
try {
  await access(ogSource)
  await copyFile(ogSource, join(outDir, 'og-cover.png'))
} catch {
  console.warn(`[seo] 未找到 ${ogSource}，og:image 可能无法访问`)
}

const today = new Date().toISOString().slice(0, 10)
await writeFile(
  join(outDir, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}sitemap.xml\n`,
  'utf8'
)
await writeFile(
  join(outDir, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url>\n` +
    `    <loc>${siteUrl}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>monthly</changefreq>\n` +
    `    <priority>1.0</priority>\n` +
    `  </url>\n` +
    `</urlset>\n`,
  'utf8'
)
/* 让 GitHub Pages 跳过 Jekyll 处理，避免下划线开头的文件被忽略 */
await writeFile(join(outDir, '.nojekyll'), '', 'utf8')

console.log(`[seo] 已写入 ${siteUrl}`)
console.log(`[seo] 产物目录：${outDir}（robots.txt / sitemap.xml / og-cover.png / .nojekyll）`)
