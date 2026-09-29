import { http, HttpResponse } from 'msw'
import { seedSamples } from './seed'
import type { Sample } from './types'

let samples = structuredClone(seedSamples)

/**
 * 正式版本副本：与种子数据分叉，模拟离线期间正式版本被他人改过。
 * 离线批次合并时以此为"正式版本"输入。
 */
function buildOfficialSamples(): Sample[] {
  const list = structuredClone(seedSamples)
  const target = list.find((item) => item.id === 'SMP-26018')
  if (target) {
    // 正式版本把第三轮胸围实测改到 111.2（与离线批次的 110.9 冲突）
    const chest = target.measurements['第三轮'].find((item) => item.key === 'chest')
    if (chest) chest.actual = 111.2
    // 正式版本更新了后衣长（离线批次未改 -> 正式侧干净合并）
    const length = target.measurements['第三轮'].find((item) => item.key === 'length')
    if (length) length.actual = 72.0
    // 正式版本新增一条批注
    target.annotations.push({
      id: 'AN-OFF-01',
      x: 30,
      y: 60,
      part: '下摆',
      content: '正式版本：下摆卷边量需统一，已更新工艺包。',
      author: '陈曼 / 产品',
      status: '待处理',
    })
  }
  return list
}

let officialSamples = buildOfficialSamples()
let officialVersion = 1

export const handlers = [
  http.get('/api/samples', () => HttpResponse.json(samples)),
  http.get('/api/samples/:id', ({ params }) => {
    const sample = samples.find((item) => item.id === params.id)
    return sample ? HttpResponse.json(sample) : new HttpResponse(null, { status: 404 })
  }),
  http.post('/api/samples/:id/annotations', async ({ params, request }) => {
    const body = (await request.json()) as { x: number; y: number; part: string; content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.annotations.push({ id: `AN-${Date.now()}`, author: '当前用户', status: '待处理', ...body })
    return HttpResponse.json(sample, { status: 201 })
  }),
  http.post('/api/samples/:id/comments', async ({ params, request }) => {
    const body = (await request.json()) as { content: string }
    const sample = samples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    sample.comments.push({ id: `CM-${Date.now()}`, author: '当前用户', content: body.content, date: '刚刚' })
    return HttpResponse.json(sample, { status: 201 })
  }),
  /** 获取正式版本（含版本号与来源标记） */
  http.get('/api/samples/:id/official', ({ params }) => {
    const sample = officialSamples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    return HttpResponse.json({ ...sample, version: officialVersion, source: 'official', lastModified: '2026-09-28 14:30' })
  }),
  /** 演示：模拟正式版本被他人改过 */
  http.post('/api/samples/:id/official/simulate-change', ({ params, request }) => {
    const sample = officialSamples.find((item) => item.id === params.id)
    if (!sample) return new HttpResponse(null, { status: 404 })
    return request.json().then((body) => {
      const { partKey, field, value } = body as { partKey: string; field: string; value: unknown }
      const [round, key] = partKey.split(':')
      const measurement = sample.measurements[round as keyof Sample['measurements']]?.find((item) => item.key === key)
      if (measurement && field in measurement) {
        ;(measurement as Record<string, unknown>)[field] = value
      }
      officialVersion += 1
      return HttpResponse.json({ ...sample, version: officialVersion, source: 'official', lastModified: new Date().toLocaleString('zh-CN') })
    })
  }),
]
